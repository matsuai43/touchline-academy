// v3.4 M1: 選手ごとの試合スタッツ（DESIGN_V3_4.md 2章）。
// 15分の区間処理（lib/game.ts の simulateSegment）の「後」に呼ぶ純粋な追加モジュール。
// 既存の試合結果（スコア・シュート数・xG・ハイライト・勝敗・s.seed の消費）には
// 一切影響しないよう、ここでの乱数はすべて s.seed を消費しないハッシュ関数（h32/hf、
// lib/squad.ts の決定的疑似乱数と同じ方式）で作る。同じセーブ・同じ操作なら
// 常に同じスタッツになる。
import { clamp, type State, type Match, type Player, type Position, type Stat } from './game.ts';
import { formationSlots, basePos, type DetailPos, type SkillCategory, type ExtraStat } from './squad.ts';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------
export type PlayerMatchStats = {
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passesAttempted: number;
  passesCompleted: number;
  keyPasses: number;
  // Jリーグ公式サイトの選手スタッツを参考にした追加項目（採点式は独自）。
  longPassAttempted: number;
  longPassCompleted: number;
  finalThirdPassAttempted: number;
  finalThirdPassCompleted: number;
  crossAttempted: number;
  crossCompleted: number;
  dribblesAttempted: number;
  dribblesCompleted: number;
  duelsAttempted: number;
  duelsWon: number;
  aerialsAttempted: number;
  aerialsWon: number;
  tackles: number;
  interceptions: number;
  clearances: number;
  turnovers: number;
  distanceKm: number;
  sprints: number;
  /** その試合で記録した最速スピード(km/h)。区間ごとの合計ではなく最大値。 */
  topSpeedKmh: number;
  // GK専用（フィールドプレイヤーは常に0）。
  saves: number;
  shotsFaced: number;
  goalsConceded: number;
  highClaims: number;
};
export type TeamMatchTotals = {
  shots: number;
  shotsOnTarget: number;
  goals: number;
  passesAttempted: number;
  passesCompleted: number;
  duelsAttempted: number;
  duelsWon: number;
};
export function zeroPlayerStats(): PlayerMatchStats {
  return {
    minutes: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    keyPasses: 0,
    longPassAttempted: 0,
    longPassCompleted: 0,
    finalThirdPassAttempted: 0,
    finalThirdPassCompleted: 0,
    crossAttempted: 0,
    crossCompleted: 0,
    dribblesAttempted: 0,
    dribblesCompleted: 0,
    duelsAttempted: 0,
    duelsWon: 0,
    aerialsAttempted: 0,
    aerialsWon: 0,
    tackles: 0,
    interceptions: 0,
    clearances: 0,
    turnovers: 0,
    distanceKm: 0,
    sprints: 0,
    topSpeedKmh: 0,
    saves: 0,
    shotsFaced: 0,
    goalsConceded: 0,
    highClaims: 0,
  };
}
export function zeroTeamTotals(): TeamMatchTotals {
  return {
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    duelsAttempted: 0,
    duelsWon: 0,
  };
}
const PLAYER_STATS_KEYS: (keyof PlayerMatchStats)[] = [
  'minutes', 'goals', 'assists', 'shots', 'shotsOnTarget',
  'passesAttempted', 'passesCompleted', 'keyPasses',
  'longPassAttempted', 'longPassCompleted',
  'finalThirdPassAttempted', 'finalThirdPassCompleted',
  'crossAttempted', 'crossCompleted',
  'dribblesAttempted', 'dribblesCompleted',
  'duelsAttempted', 'duelsWon',
  'aerialsAttempted', 'aerialsWon',
  'tackles', 'interceptions', 'clearances', 'turnovers',
  'distanceKm', 'sprints', 'topSpeedKmh',
  'saves', 'shotsFaced', 'goalsConceded', 'highClaims',
];
const TEAM_TOTALS_KEYS: (keyof TeamMatchTotals)[] = [
  'shots', 'shotsOnTarget', 'goals', 'passesAttempted', 'passesCompleted', 'duelsAttempted', 'duelsWon',
];
const numOk = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function isValidPlayerMatchStats(v: unknown): v is PlayerMatchStats {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return PLAYER_STATS_KEYS.every((k) => numOk(o[k], 0, 100000));
}
export function isValidTeamMatchTotals(v: unknown): v is TeamMatchTotals {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return TEAM_TOTALS_KEYS.every((k) => numOk(o[k], 0, 1000000));
}
/** m.playerStats の全選手を合算した自チーム合計（表示・バランス検証用）。 */
export function ownTeamTotals(m: Match): TeamMatchTotals {
  const t = zeroTeamTotals();
  for (const st of Object.values(m.playerStats ?? {})) {
    t.shots += st.shots;
    t.shotsOnTarget += st.shotsOnTarget;
    t.goals += st.goals;
    t.passesAttempted += st.passesAttempted;
    t.passesCompleted += st.passesCompleted;
    t.duelsAttempted += st.duelsAttempted;
    t.duelsWon += st.duelsWon;
  }
  return t;
}

// ---------------------------------------------------------------------------
// 決定的な疑似乱数（s.seed を消費しない。lib/squad.ts の h32/hf と同じ方式）。
// ---------------------------------------------------------------------------
function h32(...ns: number[]): number {
  let x = 2166136261 >>> 0;
  for (const n of ns) x = Math.imul(x ^ (n >>> 0), 16777619) >>> 0;
  return x >>> 0;
}
function hf(...ns: number[]): number {
  return h32(...ns) / 4294967296;
}

/** 合計totalを保ったまま重み比例で整数配分する（決定的な最大剰余法）。 */
function distributeInt(total: number, weights: number[], key: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const t = Math.max(0, Math.round(total));
  if (t <= 0) return weights.map(() => 0);
  const sumW = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (sumW <= 0) {
    const base = Math.floor(t / n);
    let rem = t - base * n;
    return weights.map(() => base + (rem-- > 0 ? 1 : 0));
  }
  const raw = weights.map((w) => (Math.max(0, w) / sumW) * t);
  const floors = raw.map(Math.floor);
  const rem = t - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), h: hf(...key, i, 31) }))
    .sort((a, b) => b.frac - a.frac || b.h - a.h);
  const result = [...floors];
  for (let k = 0; k < rem; k++) result[order[k].i]++;
  return result;
}

// ---------------------------------------------------------------------------
// ポジション別の重み（DESIGN_V3_4.md 2.1: CB・DMのデュエルが多い、突破型ウイングの
// ドリブルが多い、等）。
// ---------------------------------------------------------------------------
type W = Record<DetailPos, number>;
const PASS_W: W = { GK: 0.5, CB: 1.6, LSB: 1.3, RSB: 1.3, LWB: 1.2, RWB: 1.2, DM: 2.0, CM: 1.8, LSH: 1.1, RSH: 1.1, AM: 1.4, LWG: 0.8, RWG: 0.8, SS: 0.9, CF: 0.7 };
const DUEL_W: W = { GK: 0.2, CB: 2.1, LSB: 1.4, RSB: 1.4, LWB: 1.3, RWB: 1.3, DM: 1.9, CM: 1.2, LSH: 1.0, RSH: 1.0, AM: 0.9, LWG: 0.8, RWG: 0.8, SS: 0.9, CF: 1.2 };
const AERIAL_W: W = { GK: 0.3, CB: 2.2, LSB: 0.8, RSB: 0.8, LWB: 0.7, RWB: 0.7, DM: 1.1, CM: 0.8, LSH: 0.5, RSH: 0.5, AM: 0.6, LWG: 0.5, RWG: 0.5, SS: 0.8, CF: 1.6 };
const TACKLE_W: W = { GK: 0.1, CB: 1.7, LSB: 1.6, RSB: 1.6, LWB: 1.5, RWB: 1.5, DM: 1.9, CM: 1.1, LSH: 0.9, RSH: 0.9, AM: 0.6, LWG: 0.5, RWG: 0.5, SS: 0.5, CF: 0.4 };
const INTERCEPT_W: W = { GK: 0.1, CB: 1.6, LSB: 1.2, RSB: 1.2, LWB: 1.1, RWB: 1.1, DM: 1.9, CM: 1.2, LSH: 0.8, RSH: 0.8, AM: 0.7, LWG: 0.4, RWG: 0.4, SS: 0.5, CF: 0.4 };
const CLEARANCE_W: W = { GK: 0.6, CB: 2.4, LSB: 1.5, RSB: 1.5, LWB: 1.1, RWB: 1.1, DM: 0.9, CM: 0.5, LSH: 0.3, RSH: 0.3, AM: 0.2, LWG: 0.2, RWG: 0.2, SS: 0.2, CF: 0.2 };
const DRIBBLE_W: W = { GK: 0.05, CB: 0.2, LSB: 0.5, RSB: 0.5, LWB: 0.9, RWB: 0.9, DM: 0.4, CM: 0.7, LSH: 1.3, RSH: 1.3, AM: 1.4, LWG: 2.2, RWG: 2.2, SS: 1.3, CF: 1.0 };
const SHOT_W: W = { GK: 0.02, CB: 0.15, LSB: 0.2, RSB: 0.2, LWB: 0.3, RWB: 0.3, DM: 0.25, CM: 0.5, LSH: 0.7, RSH: 0.7, AM: 1.2, LWG: 1.3, RWG: 1.3, SS: 1.7, CF: 2.0 };
const KEYPASS_W: W = { GK: 0.05, CB: 0.2, LSB: 0.5, RSB: 0.5, LWB: 0.7, RWB: 0.7, DM: 0.8, CM: 1.3, LSH: 1.2, RSH: 1.2, AM: 1.8, LWG: 1.4, RWG: 1.4, SS: 0.9, CF: 0.5 };
const LONG_PASS_FRAC: W = { GK: 0.35, CB: 0.3, LSB: 0.18, RSB: 0.18, LWB: 0.16, RWB: 0.16, DM: 0.22, CM: 0.14, LSH: 0.12, RSH: 0.12, AM: 0.1, LWG: 0.08, RWG: 0.08, SS: 0.07, CF: 0.06 };
const FINAL_THIRD_FRAC: W = { GK: 0.05, CB: 0.12, LSB: 0.3, RSB: 0.3, LWB: 0.35, RWB: 0.35, DM: 0.22, CM: 0.4, LSH: 0.45, RSH: 0.45, AM: 0.55, LWG: 0.5, RWG: 0.5, SS: 0.48, CF: 0.42 };
const CROSS_FRAC: W = { GK: 0, CB: 0, LSB: 0.1, RSB: 0.1, LWB: 0.14, RWB: 0.14, DM: 0, CM: 0.02, LSH: 0.12, RSH: 0.12, AM: 0.03, LWG: 0.16, RWG: 0.16, SS: 0.02, CF: 0.02 };
export const WIDE_POS: readonly DetailPos[] = ['LSB', 'RSB', 'LWB', 'RWB', 'LSH', 'RSH', 'LWG', 'RWG'];

function segmentVolumes(m: Match) {
  const possFrac = clamp(m.possession, 0, 100) / 100;
  const tacticBoost = m.tactic === 'possession' ? 1.15 : m.tactic === 'counter' ? 0.85 : m.tactic === 'press' ? 1.05 : 1;
  return {
    pass: (60 + possFrac * 40) * tacticBoost,
    duel: 10 + (1 - possFrac) * 4 + (m.tactic === 'press' ? 2 : 0),
    aerial: 4 + (1 - possFrac) * 2,
    tackle: 3 + (1 - possFrac) * 3 + (m.tactic === 'press' ? 1 : 0),
    intercept: 2 + (1 - possFrac) * 3,
    clearance: 2 + (1 - possFrac) * 4,
    dribble: 3 + possFrac * 3,
  };
}

type PlayerCtx = { id: number; slot: DetailPos; player: Player; profFactor: number };

/** 選手の能力・疲労・調子・習熟度・相手の強さから、成功率のベースを決める。 */
function baseRate(
  base: number,
  skillStat: number,
  oppStrength: number,
  fatigue: number,
  mood: number,
  profFactor: number,
): number {
  const edge = (skillStat - oppStrength) / 220;
  const fatiguePenalty = fatigue * 0.0012;
  const moodEdge = (mood - 50) / 500;
  return clamp(base + edge + moodEdge - fatiguePenalty, 0.12, 0.92) * profFactor;
}

/**
 * 15分区間ぶんのスタッツを生成し、s.match.playerStats / opponentTotals に加算する。
 * lib/game.ts の act() が simulateSegment(s) の直後に呼ぶ。s.seed は一切消費しない。
 */
export function applyMatchSegmentStats(s: State, startMinute: number): void {
  const m = s.match;
  if (!m) return;
  if (!m.playerStats) m.playerStats = {};
  if (!m.opponentTotals) m.opponentTotals = zeroTeamTotals();
  const dslots = formationSlots(s.formation);
  if (s.lineup.length !== 11) return;
  const segMinutes = clamp(m.minute - startMinute, 0, 45) || 15;
  const players = s.lineup.map((id) => s.players.find((p) => p.id === id)!);
  if (players.some((p) => !p)) return;

  const sq = s.v3?.squad;
  const ctx: PlayerCtx[] = players.map((p, i) => {
    const slot = dslots[i];
    const ps = sq?.players[p.id];
    const prof = ps?.prof?.[slot] ?? (p.pos === basePos(slot) ? 40 : 10);
    return { id: p.id, slot, player: p, profFactor: 0.82 + 0.18 * clamp(prof, 0, 100) / 100 };
  });
  const statsFor = (id: number): PlayerMatchStats => {
    if (!m.playerStats![id]) m.playerStats![id] = zeroPlayerStats();
    return m.playerStats![id];
  };
  const oppStrength = clamp(m.fixture.strength, 1, 200);
  const key = [s.seed, startMinute];

  // 出場時間
  for (const c of ctx) statsFor(c.id).minutes += segMinutes;

  const vol = segmentVolumes(m);

  // パス（試行・成功）。ロングパス・敵陣パス・クロスは総数の内訳として分配する。
  const passAttempted = distributeInt(
    vol.pass,
    ctx.map((c) => PASS_W[c.slot] * (0.6 + c.player.stats.pass / 130)),
    [...key, 1],
  );
  ctx.forEach((c, i) => {
    const attempted = passAttempted[i];
    if (attempted <= 0) return;
    const st = statsFor(c.id);
    const rate = baseRate(0.78, c.player.stats.pass, oppStrength, c.player.fatigue, sq?.players[c.id]?.mood ?? 50, c.profFactor);
    const completed = clamp(Math.round(attempted * rate), 0, attempted);
    st.passesAttempted += attempted;
    st.passesCompleted += completed;
    const longAtt = Math.round(attempted * LONG_PASS_FRAC[c.slot]);
    const longRate = clamp(rate - 0.16, 0.15, 0.9);
    st.longPassAttempted += longAtt;
    st.longPassCompleted += clamp(Math.round(longAtt * longRate), 0, longAtt);
    const ftAtt = Math.round(attempted * FINAL_THIRD_FRAC[c.slot]);
    const ftRate = clamp(rate - 0.08, 0.15, 0.92);
    st.finalThirdPassAttempted += ftAtt;
    st.finalThirdPassCompleted += clamp(Math.round(ftAtt * ftRate), 0, ftAtt);
    const crossAtt = Math.round(attempted * CROSS_FRAC[c.slot]);
    const crossRate = clamp(rate - 0.4, 0.1, 0.6);
    st.crossAttempted += crossAtt;
    st.crossCompleted += clamp(Math.round(crossAtt * crossRate), 0, crossAtt);
    const failed = attempted - completed;
    st.turnovers += Math.round(failed * 0.25);
  });

  // デュエル
  const duelAttempted = distributeInt(vol.duel, ctx.map((c) => DUEL_W[c.slot] * (0.6 + (c.player.stats.defend + c.player.stats.speed) / 260)), [...key, 2]);
  ctx.forEach((c, i) => {
    const attempted = duelAttempted[i];
    if (attempted <= 0) return;
    const st = statsFor(c.id);
    const rate = baseRate(0.5, (c.player.stats.defend + c.player.stats.speed) / 2, oppStrength, c.player.fatigue, sq?.players[c.id]?.mood ?? 50, c.profFactor);
    const won = clamp(Math.round(attempted * rate), 0, attempted);
    st.duelsAttempted += attempted;
    st.duelsWon += won;
    st.turnovers += Math.round((attempted - won) * 0.08);
  });

  // 空中戦
  const aerialAttempted = distributeInt(vol.aerial, ctx.map((c) => AERIAL_W[c.slot] * (0.6 + c.player.stats.defend / 150)), [...key, 3]);
  ctx.forEach((c, i) => {
    const attempted = aerialAttempted[i];
    if (attempted <= 0) return;
    const st = statsFor(c.id);
    const rate = baseRate(0.5, c.player.stats.defend, oppStrength, c.player.fatigue, sq?.players[c.id]?.mood ?? 50, c.profFactor);
    st.aerialsAttempted += attempted;
    st.aerialsWon += clamp(Math.round(attempted * rate), 0, attempted);
  });

  // タックル・インターセプト・クリア（試行を持たない単発カウント）
  const tackles = distributeInt(vol.tackle, ctx.map((c) => TACKLE_W[c.slot] * (0.6 + c.player.stats.defend / 150)), [...key, 4]);
  const intercepts = distributeInt(vol.intercept, ctx.map((c) => INTERCEPT_W[c.slot] * (0.6 + c.player.stats.defend / 150)), [...key, 5]);
  const clearances = distributeInt(vol.clearance, ctx.map((c) => CLEARANCE_W[c.slot] * (0.6 + c.player.stats.defend / 150)), [...key, 6]);
  ctx.forEach((c, i) => {
    const st = statsFor(c.id);
    st.tackles += tackles[i];
    st.interceptions += intercepts[i];
    st.clearances += clearances[i];
  });

  // ドリブル
  const dribbleAttempted = distributeInt(vol.dribble, ctx.map((c) => DRIBBLE_W[c.slot] * (0.6 + (c.player.stats.speed + (sq?.players[c.id]?.dribble ?? 55)) / 260)), [...key, 7]);
  ctx.forEach((c, i) => {
    const attempted = dribbleAttempted[i];
    if (attempted <= 0) return;
    const st = statsFor(c.id);
    const dribbleStat = sq?.players[c.id]?.dribble ?? 55;
    const rate = baseRate(0.55, dribbleStat, oppStrength, c.player.fatigue, sq?.players[c.id]?.mood ?? 50, c.profFactor);
    const completed = clamp(Math.round(attempted * rate), 0, attempted);
    st.dribblesAttempted += attempted;
    st.dribblesCompleted += completed;
    st.turnovers += Math.round((attempted - completed) * 0.4);
  });

  // 走行距離・スプリント・トップスピード（区間15分ぶん）
  ctx.forEach((c) => {
    const st = statsFor(c.id);
    const stamina = sq?.players[c.id]?.stamina ?? 55;
    const targetPer90 = clamp(9 + (stamina - 50) / 50 * 1.6 + (m.tactic === 'press' ? 0.7 : 0), 7.5, 12.5);
    st.distanceKm += (targetPer90 / 90) * segMinutes;
    const sprintTarget = 1.6 + c.player.stats.speed / 45 + (m.tactic === 'press' ? 0.4 : 0);
    st.sprints += Math.round(sprintTarget);
    const speedCandidate =
      22 + c.player.stats.speed / 100 * 10 + hf(s.seed, startMinute, c.id, 909) * 2 - c.player.fatigue * 0.015;
    st.topSpeedKmh = Math.max(st.topSpeedKmh, Math.round(speedCandidate * 10) / 10);
  });

  // シュート・アシスト・キーパス（この区間のハイライトから、決定的に配分する）。
  const highlights = m.details.highlights;
  const gkId = ctx[0].id;
  const outfield = ctx.slice(1);
  highlights.forEach((h, idx) => {
    if (h.side === 0) {
      let shooterId = h.playerId;
      let onTarget = true;
      if (h.kind !== 'goal') {
        const weights = outfield.map((c) => SHOT_W[c.slot] * (0.6 + c.player.stats.shoot / 140));
        const picks = distributeInt(1, weights, [...key, 100, idx]);
        const pickIdx = picks.findIndex((v) => v > 0);
        shooterId = outfield[pickIdx >= 0 ? pickIdx : 0].id;
        onTarget = hf(s.seed, startMinute, idx, 501) < 0.5;
      }
      const shooterSt = statsFor(shooterId);
      shooterSt.shots += 1;
      if (onTarget) shooterSt.shotsOnTarget += 1;
      if (h.kind === 'goal') shooterSt.goals += 1;
      // キーパス／アシスト: シューター以外から、パス能力で重み付けして決定的に選ぶ。
      if (hf(s.seed, startMinute, idx, 502) < 0.55) {
        const others = ctx.filter((c) => c.id !== shooterId);
        const weights = others.map((c) => KEYPASS_W[c.slot] * (0.6 + c.player.stats.pass / 130));
        const picks = distributeInt(1, weights, [...key, 101, idx]);
        const pickIdx = picks.findIndex((v) => v > 0);
        const assisterId = others[pickIdx >= 0 ? pickIdx : 0].id;
        const assisterSt = statsFor(assisterId);
        assisterSt.keyPasses += 1;
        if (h.kind === 'goal') assisterSt.assists += 1;
      }
    } else {
      const onTarget = h.kind === 'goal' ? true : hf(s.seed, startMinute, idx, 503) < 0.5;
      const opp = m.opponentTotals!;
      opp.shots += 1;
      if (onTarget) opp.shotsOnTarget += 1;
      if (h.kind === 'goal') opp.goals += 1;
      if (onTarget) {
        const gkSt = statsFor(gkId);
        gkSt.shotsFaced += 1;
        if (h.kind === 'save') gkSt.saves += 1;
        else gkSt.goalsConceded += 1;
      }
    }
  });
  // ハイボール処理（GK専用、シュート以外のクロス対応）。
  const gkSt = statsFor(gkId);
  const possFrac = clamp(m.possession, 0, 100) / 100;
  gkSt.highClaims += Math.round((1 - possFrac) * 2 + hf(s.seed, startMinute, 777) * 1.4);

  // 相手チームの合計（表示は合計のみ、選手別は生成しない）。
  const opp = m.opponentTotals!;
  const oppPossFrac = 1 - possFrac;
  const oppPass = Math.round(60 + oppPossFrac * 40);
  const oppPassRate = clamp(0.68 + (oppPossFrac - 0.5) * 0.2 + (hf(s.seed, startMinute, 555) - 0.5) * 0.08, 0.5, 0.92);
  opp.passesAttempted += oppPass;
  opp.passesCompleted += Math.round(oppPass * oppPassRate);
  const oppDuel = Math.round(10 + possFrac * 4);
  const oppDuelWinRate = clamp(0.5 + (hf(s.seed, startMinute, 556) - 0.5) * 0.2, 0.3, 0.7);
  opp.duelsAttempted += oppDuel;
  opp.duelsWon += Math.round(oppDuel * oppDuelWinRate);
}

// ---------------------------------------------------------------------------
// 活躍に応じた成長（DESIGN_V3_4.md 3章）。
// ---------------------------------------------------------------------------
export type MatchGrowth = {
  statGrowth: Partial<Record<Stat, number>>;
  extraGrowth: Partial<Record<ExtraStat, number>>;
  /** 特殊能力の習得抽選で使うカテゴリ（最も記録した分野）。 */
  topCategory: SkillCategory;
  /** 習熟度の伸び係数（0.6〜1.5倍）。 */
  profMultiplier: number;
};
// 6.0（平均評価点）で従来の一律+0.5相当、5.0で微増、8.0以上で大きく伸びる。
export function growthBudget(rating: number, minutesFrac: number, talent: number): number {
  const base = clamp(0.08 + (rating - 5) * 0.22, 0.03, 2.2);
  return base * (0.5 + 0.5 * clamp(minutesFrac, 0, 1)) * talent;
}
export function profGrowthMultiplier(rating: number): number {
  return clamp(0.6 + ((rating - 3) / 7) * 0.9, 0.6, 1.5);
}
function categoryOf(key: Stat | ExtraStat): SkillCategory {
  if (key === 'shoot' || key === 'dribble') return '攻撃';
  if (key === 'pass') return '攻撃';
  if (key === 'defend' || key === 'power') return '守備';
  if (key === 'keep') return 'GK';
  if (key === 'speed' || key === 'stamina') return '身体';
  return '精神';
}
export function computeMatchGrowth(
  pos: Position,
  st: PlayerMatchStats,
  rating: number,
  minutes: number,
  talent: number,
): MatchGrowth {
  const minutesFrac = clamp(minutes / 90, 0, 1);
  const budget = growthBudget(rating, minutesFrac, talent);
  const w: Record<Stat, number> = {
    shoot: st.shots * 0.5 + st.goals * 2.2,
    pass: st.passesCompleted * 0.035 + st.finalThirdPassCompleted * 0.05 + st.longPassCompleted * 0.06 + st.crossCompleted * 0.1 + st.keyPasses * 0.45 + st.assists * 1.1,
    defend: st.duelsWon * 0.28 + st.tackles * 0.32 + st.interceptions * 0.3 + st.clearances * 0.2,
    speed: st.sprints * 0.07 + st.distanceKm * 0.045 + st.topSpeedKmh * 0.01,
    mental: 1.1,
    keep: st.saves * 0.5 + st.highClaims * 0.28,
  };
  const ew: Record<ExtraStat, number> = {
    dribble: st.dribblesCompleted * 0.3,
    stamina: st.distanceKm * 0.055 + st.sprints * 0.035,
    power: st.duelsWon * 0.12 + st.aerialsWon * 0.2,
  };
  if (pos !== 'GK') w.keep = 0;
  const total = Object.values(w).reduce((a, b) => a + b, 0) + Object.values(ew).reduce((a, b) => a + b, 0);
  const statGrowth: Partial<Record<Stat, number>> = {};
  const extraGrowth: Partial<Record<ExtraStat, number>> = {};
  let topKey: Stat | ExtraStat = 'mental';
  let topVal = -1;
  for (const k of Object.keys(w) as Stat[]) {
    const share = total > 0 ? w[k] / total : k === 'mental' ? 1 : 0;
    const val = budget * share;
    if (val > 0.0005) statGrowth[k] = val;
    if (w[k] > topVal) {
      topVal = w[k];
      topKey = k;
    }
  }
  for (const k of Object.keys(ew) as ExtraStat[]) {
    const share = total > 0 ? ew[k] / total : 0;
    const val = budget * share;
    if (val > 0.0005) extraGrowth[k] = val;
    if (ew[k] > topVal) {
      topVal = ew[k];
      topKey = k;
    }
  }
  return {
    statGrowth,
    extraGrowth,
    topCategory: categoryOf(topKey),
    profMultiplier: profGrowthMultiplier(rating),
  };
}
