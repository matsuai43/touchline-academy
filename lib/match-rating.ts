// T1: 試合結果画面の「評価点」。10点満点・小数1桁・6.0が平均の純粋関数群。
// ランダム要素は一切使わない（Math.random禁止）。揺らぎはハッシュで決定的に作る。
// 低レベルの `ratingFor` はプレーンな入力から評価点だけを計算する純粋関数（単体テストしやすい）。
// 高レベルの `matchRatings` が実際の State/Match からその入力を組み立てる。
import { clamp, type State, type Position } from './game.ts';
import { formationSlots, basePos, type DetailPos } from './squad.ts';
import { WIDE_POS, type PlayerMatchStats } from './match-stats.ts';

export const RATING_MIN = 3.0;
export const RATING_MAX = 10.0;
export const RATING_AVERAGE = 6.0;

export type MatchOutcome = 'win' | 'draw' | 'loss';

export type RatingInput = {
  /** 表示の揺らぎを決定的にするためのシード（通常は試合開始時の s.seed）。 */
  seed: number;
  id: number;
  outcome: MatchOutcome;
  /** 自チーム視点の得失点差（home - away）。 */
  margin: number;
  /** この試合での得点数。 */
  goals: number;
  /** 出場時間（分、0〜90）。0以下は「出場していない」扱い。 */
  minutes: number;
  /** 出場したポジションでの習熟度（0〜100）。複数ポジションを兼務した場合は出場時間で加重平均する。 */
  fitProf: number;
  /** 試合終了時点の疲労（0〜100）。 */
  fatigueAfter: number;
  /** GK・DFが無失点で終えたか（クリーンシート加点の対象か）。 */
  cleanSheet: boolean;
};

// ---------------------------------------------------------------------------
// 決定的なハッシュ（Math.randomを使わない揺らぎ）。app/match-ui.tsx の
// conditionHash と同じ作りだが、s.seed を消費しないこの純粋モジュール専用に複製する。
// ---------------------------------------------------------------------------
function ratingHash(seed: number, id: number, salt: number): number {
  let x = (seed ^ Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 出場していない選手（minutes<=0）には呼ばない前提の純粋関数。 */
export function ratingFor(input: RatingInput): number {
  const minutesFactor = clamp(input.minutes / 90, 0.2, 1);
  let r = RATING_AVERAGE;
  r += input.outcome === 'win' ? 0.3 : input.outcome === 'loss' ? -0.3 : 0;
  r += clamp(input.margin, -3, 3) * 0.08;
  // 得点は主役級の加点。ハットトリック以降は逓減させ、上限(10.0)手前で頭打ちにする。
  r += Math.min(input.goals, 3) * 0.8 + Math.max(0, input.goals - 3) * 0.25;
  // 起用ポジションの習熟度：60を基準に上下（100で+0.36、0で-0.54相当）。出場時間で減衰。
  r += ((input.fitProf - 60) / 100) * 0.9 * minutesFactor;
  // 疲労：最後まで運動量を落とさなかった選手にわずかな加点。
  r += clamp((input.fatigueAfter - 55) / 100, -0.15, 0.2) * 0.4;
  if (input.cleanSheet) r += 0.5;
  const noise = (ratingHash(input.seed, input.id, Math.round(input.minutes) * 13 + input.goals * 31 + 1) - 0.5) * 0.5;
  r += noise * minutesFactor;
  return clamp(round1(r), RATING_MIN, RATING_MAX);
}

// ---------------------------------------------------------------------------
// v3.4 M1: DESIGN_V3_4.md 2.2 のポジション別・スタッツ基準の採点。ユーザー要望に
// 沿い、Jリーグ公式サイトが選手ごとに公開しているスタッツ項目（得点・アシスト・
// デュエル・空中戦・クリーンシート・走行距離・スプリント・パス総数・ロングパス・
// 敵陣パス・クロス・ドリブル・タックル・インターセプト・セーブ・トップスピード・
// シュート）を材料にする（採点式自体はJリーグ非公開のため独自）。
// matchRatings() はスタッツが無い試合（旧セーブの途中データ）のみ ratingFor() の
// 簡易式にフォールバックする。
// ---------------------------------------------------------------------------
export type PositionRatingInput = {
  seed: number;
  id: number;
  pos: Position;
  detail: DetailPos;
  outcome: MatchOutcome;
  margin: number;
  minutes: number;
  fitProf: number;
  cleanSheet: boolean;
  stats: PlayerMatchStats;
};
// ポジションごとの「活躍度」の生スコアを、平均的な出場が概ね0（=6.0のまま）になる
// 大きさへ縮小する係数。試合を大量に回した実測（1試合平均のスタッツ量）から、
// 平均的な出場のポジション別加点がだいたい揃うよう校正した値。この係数のおかげで、
// 活躍した選手ほど評価点が上がる形はそのままに、6.0が本当に「平均的な出場」を表す。
const POS_ACTIVITY_SCALE: Record<Position, number> = { GK: 0.27, DF: 0.09, MF: 0.055, FW: 0.081 };
export function statRatingFor(input: PositionRatingInput): number {
  const st = input.stats;
  const minutesFactor = clamp(input.minutes / 90, 0.15, 1);
  const wide = (WIDE_POS as readonly DetailPos[]).includes(input.detail);
  let delta = 0;
  delta += input.outcome === 'win' ? 0.22 : input.outcome === 'loss' ? -0.22 : 0;
  delta += clamp(input.margin, -3, 3) * 0.05;
  delta += ((input.fitProf - 60) / 100) * 0.4;
  delta -= st.turnovers * 0.05;
  // 走行距離・スプリント・トップスピードは全員に小さく効く（運動量の多い選手が報われる）。
  delta += clamp(st.distanceKm - 9.5, -3, 3) * 0.05 + Math.min(st.sprints, 30) * 0.006 + clamp(st.topSpeedKmh - 27, -6, 8) * 0.01;
  const finalThirdRate = st.finalThirdPassAttempted > 0 ? st.finalThirdPassCompleted / st.finalThirdPassAttempted : 0.75;
  let posRaw = 0;
  if (input.pos === 'FW') {
    posRaw +=
      st.goals * 0.9 +
      st.assists * 0.5 +
      st.shotsOnTarget * 0.15 +
      st.shots * 0.03 +
      st.dribblesCompleted * 0.08 +
      st.aerialsWon * 0.05; // CFのポストプレイ等
  } else if (input.pos === 'MF') {
    posRaw +=
      st.passesCompleted * 0.02 +
      (finalThirdRate - 0.75) * 1.1 +
      st.longPassCompleted * 0.05 +
      st.dribblesCompleted * 0.07 +
      st.duelsWon * 0.06 +
      st.keyPasses * 0.15 +
      st.assists * 0.5 +
      st.interceptions * 0.05;
    if (wide) posRaw += st.crossCompleted * 0.12;
  } else if (input.pos === 'DF') {
    posRaw +=
      st.duelsWon * 0.08 +
      st.aerialsWon * 0.07 +
      st.tackles * 0.09 +
      st.interceptions * 0.08 +
      st.clearances * 0.05;
    if (wide) posRaw += st.crossCompleted * 0.06;
    if (input.cleanSheet) delta += 0.5;
  } else {
    // GK
    const saveRate = st.shotsFaced > 0 ? st.saves / st.shotsFaced : 1;
    posRaw += st.saves * 0.22 + (saveRate - 0.65) * 1.5 + st.highClaims * 0.05 - st.goalsConceded * 0.3;
    if (input.cleanSheet) delta += 0.6;
  }
  delta += posRaw * POS_ACTIVITY_SCALE[input.pos];
  const noise = (ratingHash(input.seed, input.id, Math.round(input.minutes) * 7 + st.goals * 17 + 3) - 0.5) * 0.3;
  delta += noise;
  const r = RATING_AVERAGE + delta * minutesFactor;
  return clamp(round1(r), RATING_MIN, RATING_MAX);
}

export type PlayerRating = {
  id: number;
  name: string;
  pos: Position;
  detail: DetailPos;
  rating: number;
  minutes: number;
  goals: number;
  started: boolean;
};

function fallbackProf(detail: DetailPos, slot: DetailPos): number {
  return detail === slot ? 100 : basePos(detail) === basePos(slot) ? 40 : 10;
}
function profAt(s: State, playerId: number, slot: DetailPos): number {
  const ps = s.v3.squad.players[playerId];
  if (ps?.prof) {
    const v = ps.prof[slot];
    if (typeof v === 'number') return v;
    return fallbackProf(ps.detail, slot);
  }
  const p = s.players.find((pp) => pp.id === playerId);
  if (!p) return 10;
  return p.pos === basePos(slot) ? 40 : 10;
}

/**
 * 試合データ（得点・スコア差・勝敗・出場ポジション・習熟度・疲労・無失点・出場時間・交代）
 * から、出場した全選手（途中出場を含む）の評価点を決定的に算出する。
 * grantMatchPositionExperience（lib/game.ts）と同じ手法で、交代記録(subEntries)から
 * 各スロット(0..10)をどの選手がどれだけの時間担当したかを割り出す。
 */
export function matchRatings(s: State): PlayerRating[] {
  const m = s.match;
  if (!m) return [];
  const dslots = formationSlots(s.formation);
  const snapMap = new Map((m.snapshot ?? []).map((e) => [e.id, e]));
  const total = m.minute > 0 ? m.minute : 90;

  type Occ = { slot: DetailPos; minutes: number };
  const occByPlayer = new Map<number, Occ[]>();
  const addOcc = (id: number, slot: DetailPos, minutes: number) => {
    if (minutes <= 0) return;
    const list = occByPlayer.get(id) ?? [];
    list.push({ slot, minutes });
    occByPlayer.set(id, list);
  };
  const entriesByIndex = new Map<number, { id: number; minute: number }[]>();
  for (const e of m.subEntries ?? []) {
    const list = entriesByIndex.get(e.index) ?? [];
    list.push({ id: e.id, minute: e.minute });
    entriesByIndex.set(e.index, list);
  }
  for (let i = 0; i < 11; i++) {
    const slot = dslots[i];
    const entries = (entriesByIndex.get(i) ?? []).slice().sort((a, b) => a.minute - b.minute);
    let cur = m.original[i];
    let from = 0;
    for (const e of entries) {
      addOcc(cur, slot, Math.min(e.minute, total) - from);
      cur = e.id;
      from = e.minute;
    }
    addOcc(cur, slot, total - from);
  }

  const outcome: MatchOutcome = m.home === m.away && !m.penalties ? 'draw' : m.won ? 'win' : 'loss';
  const margin = m.home - m.away;
  const cleanSheetTeam = m.away === 0;

  const rows: PlayerRating[] = [];
  for (const [id, occ] of occByPlayer) {
    const p = s.players.find((pp) => pp.id === id);
    if (!p) continue;
    const minutes = occ.reduce((a, o) => a + o.minutes, 0);
    if (minutes <= 0) continue;
    const fitProf =
      occ.reduce((a, o) => a + o.minutes * profAt(s, id, o.slot), 0) / minutes;
    const snap = snapMap.get(id);
    const goals = snap ? Math.max(0, p.goals - snap.goals) : 0;
    const cleanSheet = cleanSheetTeam && (p.pos === 'GK' || p.pos === 'DF');
    // 表示用の起用先詳細ポジションは、出場時間が最長だったスロットを採用する。
    const detail = occ.slice().sort((a, b) => b.minutes - a.minutes)[0].slot;
    // v3.4 M1: 選手ごとの試合スタッツ（lib/match-stats.ts）があればポジション別の
    // スタッツ採点（statRatingFor）を使う。旧セーブの試合途中データ（スタッツ無し）は
    // 従来の簡易式（ratingFor）にフォールバックする。
    const stStats = m.playerStats?.[id];
    const baseRating = stStats
      ? statRatingFor({
          seed: s.seed,
          id,
          pos: p.pos,
          detail,
          outcome,
          margin,
          minutes,
          fitProf,
          cleanSheet,
          stats: stStats,
        })
      : ratingFor({
          seed: s.seed,
          id,
          outcome,
          margin,
          goals,
          minutes,
          fitProf,
          fatigueAfter: p.fatigue,
          cleanSheet,
        });
    const pkGoals = m.pk?.kicks.filter((kick) => kick.side === 0 && kick.kickerId === id && kick.scored).length ?? 0;
    const pkSaves = s.lineup[0] === id
      ? m.pk?.kicks.filter((kick) => kick.side === 1 && kick.saved).length ?? 0
      : 0;
    const rating = clamp(Math.round((baseRating + pkGoals * 0.25 + pkSaves * 0.4) * 10) / 10,
      RATING_MIN, RATING_MAX);
    rows.push({
      id,
      name: p.name,
      pos: p.pos,
      detail,
      rating,
      minutes: Math.round(minutes),
      goals,
      started: m.original.includes(id),
    });
  }
  rows.sort((a, b) => b.rating - a.rating || b.goals - a.goals || a.id - b.id);
  return rows;
}

/** 評価点1位の選手（MOMと一致させる）。同点はゴール数、次いでidで決定的に決める。 */
export function topRated(rows: PlayerRating[]): PlayerRating | null {
  return rows.length ? rows[0] : null;
}
