// DESIGN_V3_5.md 3.1〜3.5 の受け入れ条件（長期・多数試行シミュレーション）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, strength, overall, facilityUpgradeCost, validateSave, type State, type Match, type Formation } from '../lib/game.ts';
import { statCeiling, applyStatGrowth } from '../lib/growth.ts';
import { candidatePool } from '../lib/development.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import {
  hydrateCompetition,
  readCompetition,
  computeLeagueTable,
  competitionFixture,
  simulateCupRegulation,
  DISTRICTS,
  WC_NATIONAL_WEEKS,
} from '../lib/competition.ts';
import {
  computeMatchGrowth,
  zeroPlayerStats,
  matchImportanceMult,
  opponentStrengthMult,
  matchXpMultiplier,
} from '../lib/match-stats.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー（他の tests/*.test.ts と同じ方針）。
// ---------------------------------------------------------------------------
function resolveLife(s: State): State {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function toMatchDay(s: State, t: 'rest' = 'rest'): State {
  let guard = 0;
  while (!s.pending && guard++ < 60) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    s = resolveLife(s);
    s = act(s, { type: 'train', training: t });
  }
  return s;
}
/** キックオフ直後に相手の強さだけを操作して、自チーム強さとの差を作った状態で
 *  1試合（練習試合＝PK無し）を最後まで進める。3.1 は「強さの差」に対する反応を見るため、
 *  自チームの強さを直接いじれない代わりに fixture.strength 側を動かす。 */
function playWithDiff(seed: number, diff: number): Match {
  let s = newGame('バランス検証高校', seed);
  s = toMatchDay(s);
  s = act(s, { type: 'start' });
  const rating = strength(s);
  s.match!.fixture.strength = Math.max(1, Math.min(99, Math.round(rating - diff)));
  s.match!.fixture.kind = 'friendly';
  while (!s.match!.done) s = act(s, { type: 'segment' });
  return s.match!;
}
function winDrawLose(diff: number, n: number, seedBase: number) {
  let win = 0,
    draw = 0,
    lose = 0;
  for (let i = 0; i < n; i++) {
    const m = playWithDiff(seedBase + i, diff);
    if (m.home > m.away) win++;
    else if (m.home === m.away) draw++;
    else lose++;
  }
  return { win: win / n, draw: draw / n, lose: lose / n };
}

// ---------------------------------------------------------------------------
// 3.1: 勝率曲線。強さの差 +15/+8/0/-8/-15 で、DESIGN_V3_5.md の目安表に入ること。
// 準決勝・決勝でも同じ式（ラウンドに依存しない）ことも合わせて確認する。
// ---------------------------------------------------------------------------
void test('3.1: win rate reacts consistently to the strength difference (friendly, round 1)', () => {
  const N = 300;
  const table: [number, [number, number]][] = [
    [15, [0.8, 0.9]],
    [8, [0.65, 0.75]],
    [0, [0.35, 0.45]],
    [-8, [0.15, 0.25]],
    [-15, [0.05, 0.12]],
  ];
  for (const [diff, [lo, hi]] of table) {
    const { win } = winDrawLose(diff, N, 900000 + diff * 1000);
    assert.ok(
      win >= lo - 0.05 && win <= hi + 0.05,
      `diff=${diff}: win=${(win * 100).toFixed(1)}% expected in [${lo * 100},${hi * 100}]%`,
    );
  }
});

void test('3.1: the win-rate curve does not change between round 1 and a final (semifinal/final)', () => {
  const N = 220;
  for (const diff of [15, 0, -15]) {
    let win1 = 0,
      win4 = 0;
    for (let i = 0; i < N; i++) {
      let s = newGame('ラウンド検証高校', 500000 + diff * 10 + i);
      s = toMatchDay(s);
      s = act(s, { type: 'start' });
      const rating = strength(s);
      s.match!.fixture.strength = Math.max(1, Math.min(99, Math.round(rating - diff)));
      s.match!.fixture.kind = 'friendly';
      s.match!.fixture.round = i % 2 === 0 ? 0 : 4; // 1回戦 vs 決勝相当のラウンド番号
      while (!s.match!.done) s = act(s, { type: 'segment' });
      if (i % 2 === 0) {
        if (s.match!.home > s.match!.away) win1++;
      } else {
        if (s.match!.home > s.match!.away) win4++;
      }
    }
    const r1 = win1 / (N / 2);
    const r4 = win4 / (N / 2);
    assert.ok(
      Math.abs(r1 - r4) <= 0.15,
      `diff=${diff}: round1 win=${(r1 * 100).toFixed(1)}% vs final win=${(r4 * 100).toFixed(1)}% differ too much`,
    );
  }
});

void test('T-2: rival cup matches follow the same strength-to-win curve as player matches', () => {
  const N = 300;
  const results: { diff: number; selfWin: number; rivalWin: number; selfDraw: number; rivalDraw: number }[] = [];
  for (const diff of [15, 8, 0, -8, -15]) {
    const self = winDrawLose(diff, N, 1_200_000 + diff * 1000);
    let win = 0;
    let draw = 0;
    for (let i = 0; i < N; i++) {
      const s = newGame('カップ曲線検証高校', 1_200_000 + diff * 1000 + i);
      const a = { id: 'a', name: '架空A高校', strength: 65, style: 'balanced' as const, districtId: 'yamagata' };
      const b = { id: 'b', name: '架空B高校', strength: 65 - diff, style: 'balanced' as const, districtId: 'yamagata' };
      const result = simulateCupRegulation(s, 'ih', false, 0, 1, a, b);
      if (result.home > result.away) win++;
      if (result.home === result.away) draw++;
    }
    const rivalWin = win / N;
    const rivalDraw = draw / N;
    results.push({ diff, selfWin: self.win, rivalWin, selfDraw: self.draw, rivalDraw });
  }
  for (const row of results) {
    assert.ok(Math.abs(row.rivalWin - row.selfWin) <= 0.08,
      `cup rival curve differs: ${JSON.stringify(results)}`);
    assert.ok(Math.abs(row.rivalDraw - row.selfDraw) <= 0.08,
      `cup rival draws differ: ${JSON.stringify(results)}`);
  }
});

void test('T-3: low stamina and high pressing increase match fatigue, which hurts late strength', () => {
  const setup = () => {
    const s = newGame('疲労検証高校', 24680);
    s.players.forEach((p) => { p.fatigue = 0; });
    s.pending = { label: '練習試合', kind: 'friendly', round: 0, strength: 55, opponent: '架空高校', style: 'balanced' };
    return act(s, { type: 'start' });
  };
  const press = setup();
  const lowId = press.lineup[1];
  const highId = press.lineup[2];
  const low = press.v3.squad.players[lowId];
  const high = press.v3.squad.players[highId];
  high.style = low.style;
  high.skills = [...low.skills];
  high.negatives = [...low.negatives];
  low.stamina = 30;
  high.stamina = 90;
  const pressed = act(act(press, { type: 'tactic', tactic: 'press' }), { type: 'segment' });
  const lowFatigue = pressed.players.find((p) => p.id === lowId)!.fatigue;
  const highFatigue = pressed.players.find((p) => p.id === highId)!.fatigue;
  assert.ok(lowFatigue > highFatigue + 3, `low=${lowFatigue}, high=${highFatigue}`);
  const balanced = act(press, { type: 'segment' });
  assert.ok(lowFatigue > balanced.players.find((p) => p.id === lowId)!.fatigue + 3);

  let late = pressed;
  for (let segment = 0; segment < 3; segment++) late = act(late, { type: 'segment' });
  assert.ok(strength(late) < strength(press) - 5, `kickoff=${strength(press)}, late=${strength(late)}`);
  const lateLow = late.players.find((p) => p.id === lowId)!.fatigue;
  const lateHigh = late.players.find((p) => p.id === highId)!.fatigue;
  assert.ok(lateLow - lateHigh > lowFatigue - highFatigue);
});

void test('T-3: three equal-strength fresh substitutes at 60 minutes improve late defense and win rate', () => {
  const N = 350;
  let keepWins = 0;
  let subWins = 0;
  let keepConcededXg = 0;
  let subConcededXg = 0;
  for (let i = 0; i < N; i++) {
    let s = newGame('交代検証高校', 1_500_000 + i);
    s.players.forEach((p) => { p.fatigue = 0; });
    s.pending = { label: '練習試合', kind: 'friendly', round: 0, strength: 55, opponent: '架空高校', style: 'press' };
    s = act(s, { type: 'start' });
    s.match!.fixture.strength = Math.min(99, strength(s) + 8);
    s = act(s, { type: 'tactic', tactic: 'press' });
    for (let segment = 0; segment < 4; segment++) s = act(s, { type: 'segment' });
    const at60AwayXg = s.match!.xg[1];
    const indices = Array.from({ length: 10 }, (_, index) => index + 1).sort((a, b) =>
      s.players.find((p) => p.id === s.lineup[b])!.fatigue -
      s.players.find((p) => p.id === s.lineup[a])!.fatigue).slice(0, 3);
    const reserves = s.players.filter((p) => !s.lineup.includes(p.id) && s.v3.squad.players[p.id]?.team === 'A').slice(0, 3);
    assert.equal(reserves.length, 3);
    for (let j = 0; j < 3; j++) {
      const starter = s.players.find((p) => p.id === s.lineup[indices[j]])!;
      const reserve = reserves[j];
      reserve.stats = { ...starter.stats };
      reserve.pos = starter.pos;
      reserve.injury = 0;
      reserve.fatigue = 0;
      s.v3.squad.players[reserve.id] = { ...structuredClone(s.v3.squad.players[starter.id]), team: 'A' };
    }
    let keep = s;
    let withSubs = s;
    for (let j = 0; j < 3; j++) withSubs = act(withSubs, { type: 'swap', index: indices[j], id: reserves[j].id });
    for (let segment = 0; segment < 2; segment++) {
      keep = act(keep, { type: 'segment' });
      withSubs = act(withSubs, { type: 'segment' });
    }
    keepWins += Number(keep.match!.home > keep.match!.away);
    subWins += Number(withSubs.match!.home > withSubs.match!.away);
    keepConcededXg += keep.match!.xg[1] - at60AwayXg;
    subConcededXg += withSubs.match!.xg[1] - at60AwayXg;
  }
  assert.ok(subConcededXg < keepConcededXg * 0.93,
    `late conceded xG: subs=${subConcededXg / N}, keep=${keepConcededXg / N}`);
  assert.ok(subWins >= keepWins + N * 0.025,
    `wins: subs=${subWins / N}, keep=${keepWins / N}`);
});

void test('T-3: an equal and equally rested kickoff substitute does not create a fitness bonus', () => {
  let s = newGame('交代検証高校', 1_600_000);
  s.players.forEach((p) => { p.fatigue = 0; });
  s.pending = { label: '練習試合', kind: 'friendly', round: 0, strength: 55, opponent: '架空高校', style: 'press' };
  s = act(s, { type: 'start' });
  s = act(s, { type: 'tactic', tactic: 'press' });
  const index = 7;
  const starter = s.players.find((p) => p.id === s.lineup[index])!;
  const reserve = s.players.find((p) => !s.lineup.includes(p.id) && s.v3.squad.players[p.id]?.team === 'A')!;
  reserve.stats = { ...starter.stats };
  reserve.pos = starter.pos;
  reserve.fatigue = starter.fatigue;
  reserve.injury = starter.injury;
  s.v3.squad.players[reserve.id] = { ...structuredClone(s.v3.squad.players[starter.id]), team: 'A' };
  let keep = s;
  let withSub = act(s, { type: 'swap', index, id: reserve.id });
  while (!keep.match!.done) {
    keep = act(keep, { type: 'segment' });
    withSub = act(withSub, { type: 'segment' });
  }
  assert.deepEqual([withSub.match!.home, withSub.match!.away, withSub.match!.shots, withSub.match!.xg],
    [keep.match!.home, keep.match!.away, keep.match!.shots, keep.match!.xg]);
});

// ---------------------------------------------------------------------------
// 3.2: 大会の相手 — 全国大会には自県係数を掛けず、県予選は半分に弱める。
// ---------------------------------------------------------------------------
function setDistrictNow(s: State, districtId: string): void {
  const comp = readCompetition(s);
  comp.districtId = districtId;
  comp.seasonGenerated = 0;
  hydrateCompetition(s);
}

void test('3.2: a high-coefficient district no longer inflates national tournament opponent strength', () => {
  // lib/competition.ts の DISTRICTS には強度係数が県ごとに定義されている。1.0近辺と
  // 最大級の係数を持つ県を比べ、全国大会（wc_national）では差がほとんど出ないことを見る。
  const sorted = [...DISTRICTS].sort((a, b) => a.strength - b.strength);
  const weakId = sorted[0].id;
  const strongId = sorted[sorted.length - 1].id;

  const weak = newGame('薄い係数高校', 42);
  setDistrictNow(weak, weakId);
  const strong = newGame('濃い係数高校', 42);
  setDistrictNow(strong, strongId);
  readCompetition(weak).wc.qualified = true;
  readCompetition(strong).wc.qualified = true;

  let maxDiff = 0;
  for (const week of WC_NATIONAL_WEEKS) {
    const w = competitionFixture(weak, week)!;
    const st = competitionFixture(strong, week)!;
    maxDiff = Math.max(maxDiff, Math.abs(st.strength - w.strength));
  }
  // 係数を掛けていた頃は最大1.35倍差（強さ90なら+31相当）が出ていた。今は乱数の揺れだけ。
  assert.ok(maxDiff <= 6, `national opponent strength gap too large: ${maxDiff}`);
});

// ---------------------------------------------------------------------------
// 追加依頼: 大会が進むほど強い学校が残るよう、リーグの他校同士の試合も自校と同じ
// 強さ→勝率カーブに揃える。複数シードで、強さ上位2校の平均順位が下位2校より
// 明確に上（数字が小さい）であることを確認する。
// ---------------------------------------------------------------------------
void test('additional: stronger clubs finish a league season higher on average than weaker clubs', () => {
  const seeds = [11, 22, 33, 44, 55, 66];
  let topAvg = 0,
    bottomAvg = 0;
  for (const seed of seeds) {
    const s = newGame('リーグ順位検証高校', seed);
    hydrateCompetition(s);
    const comp = readCompetition(s);
    // 他校同士の試合は team.played 節ぶんだけ再現されるため、実際に全試合を消化させずに
    // 「シーズン終了時点」を作る（自校の勝敗は無関係、他校同士の再現だけを見たいテスト）。
    comp.teamA.played = comp.teamA.schedule.length;
    const { rows } = computeLeagueTable(s, comp);
    const clubRows = rows.filter((r) => !r.isSelf);
    const byStrength = comp.teamA.clubs
      .map((c) => ({ id: c.id, strength: c.strength }))
      .sort((a, b) => b.strength - a.strength);
    const rankOf = (id: string) => rows.findIndex((r) => r.teamId === id) + 1;
    const top2 = byStrength.slice(0, 2);
    const bottom2 = byStrength.slice(-2);
    topAvg += (rankOf(top2[0].id) + rankOf(top2[1].id)) / 2;
    bottomAvg += (rankOf(bottom2[0].id) + rankOf(bottom2[1].id)) / 2;
    assert.equal(clubRows.length, 7);
  }
  topAvg /= seeds.length;
  bottomAvg /= seeds.length;
  assert.ok(
    topAvg < bottomAvg - 1,
    `strong clubs should rank clearly better on average: top2 avg rank=${topAvg.toFixed(2)}, bottom2 avg rank=${bottomAvg.toFixed(2)}`,
  );
});

// ---------------------------------------------------------------------------
// 3.5: 試合の経験値 — 重要度×相手の強さで成長倍率が変わる。
// ---------------------------------------------------------------------------
void test('3.5: match XP multiplier scales with match importance and opponent strength', () => {
  // 重要度: 練習試合0.8 < リーグ1.0 < 県予選1.1 < 全国1.3。
  assert.equal(matchImportanceMult('friendly'), 0.8);
  assert.equal(matchImportanceMult('league'), 1.0);
  assert.equal(matchImportanceMult('ih_qualifier'), 1.1);
  assert.equal(matchImportanceMult('wc_qualifier'), 1.1);
  assert.equal(matchImportanceMult('ih_national'), 1.3);
  assert.equal(matchImportanceMult('wc_national'), 1.3);
  // 相手の強さ: 格上ほど倍率が増え、clamp 0.7〜1.4。
  assert.equal(opponentStrengthMult(75, 75), 1);
  assert.ok(opponentStrengthMult(75, 90) > 1);
  assert.ok(opponentStrengthMult(75, 60) < 1);
  assert.equal(opponentStrengthMult(75, 999), 1.4);
  assert.equal(opponentStrengthMult(75, -999), 0.7);
  // 同じ相手の強さでも、全国のほうが練習試合より倍率が大きい（格上ほどさらに伸びる）。
  const friendlyMult = matchXpMultiplier(
    { fixture: { kind: 'friendly', strength: 90 } } as Match,
    75,
  );
  const nationalMult = matchXpMultiplier(
    { fixture: { kind: 'ih_national', strength: 90 } } as Match,
    75,
  );
  assert.ok(nationalMult > friendlyMult);
});

void test('3.5: playing a stronger, more important match grants more actual player growth', () => {
  // computeMatchGrowth に xpMult を渡すと、同じスタッツでも成長量が比例して増える。
  const st = { ...zeroPlayerStats(), shots: 3, goals: 1, passesCompleted: 20 };
  const base = computeMatchGrowth('FW', st, 7.0, 90, 1.0, 1);
  const boosted = computeMatchGrowth('FW', st, 7.0, 90, 1.0, 1.3 * 1.4);
  const sum = (g: Partial<Record<string, number>>) =>
    Object.values(g).reduce((a: number, b) => a + (b ?? 0), 0);
  assert.ok(sum(boosted.statGrowth) > sum(base.statGrowth) * 1.5);
});

void test('3.3: potential and facilities raise the ability ceiling, with growth tapering near it', () => {
  const s = newGame('成長上限検証高校', 31);
  const p = s.players[0];
  p.talent = 1.1;
  const low = statCeiling(s, p);
  p.talent = 1.8;
  const gifted = statCeiling(s, p);
  s.facilities = 5;
  const high = statCeiling(s, p);
  assert.ok(low < gifted && gifted < high && high >= 90 && high <= 99);
  p.stats.shoot = high - 20;
  const far = applyStatGrowth(s, p, 'shoot', 1);
  p.stats.shoot = high - 1;
  const near = applyStatGrowth(s, p, 'shoot', 1);
  assert.ok(far > near && near > 0);
  p.stats.shoot = 95;
  s.facilities = 1;
  applyStatGrowth(s, p, 'shoot', 10);
  assert.equal(p.stats.shoot, 95, 'legacy abilities above the new ceiling stay intact');
  validateSave(JSON.parse(JSON.stringify(s)));
});

void test('3.3 and 3.4: reputation improves recruits, and facility prices rise by stage', () => {
  const low = newGame('勧誘検証高校', 91);
  const high = newGame('勧誘検証高校', 91);
  high.reputation = 100;
  // T-11: 素質(potential)は「今の評判」ではなく repSustain（評判の持続）に連動するため、
  // ここでも合わせて上げておく。
  high.repSustain = 100;
  const initial = candidatePool(low);
  const popular = candidatePool(high);
  assert.ok(popular.reduce((n, c) => n + c.ability, 0) > initial.reduce((n, c) => n + c.ability, 0));
  assert.ok(popular.reduce((n, c) => n + c.potential, 0) > initial.reduce((n, c) => n + c.potential, 0));
  assert.deepEqual([1, 2, 3, 4].map(facilityUpgradeCost), [40, 80, 140, 450]);
});

void test('3.3 and 3.4: passive manager reaches A players over multiple seasons without a first-year national title', () => {
  const seeds = [17, 42, 789];
  const snapshots: { seed: number; season: number; top11: number; a: number; facility: number; reputation: number; trophies: number }[] = [];
  for (const seed of seeds) {
    let s = newGame('長期バランス検証高校', seed);
    let guard = 0;
    while (s.season <= 12 && guard++ < 50000) {
      if (s.event) s = act(s, { type: 'event', choice: 'team' });
      s = resolveLife(s);
      s = act(s, { type: 'train', training: s.weeklyMenu[s.day] });
      if (s.pending) {
        s = act(s, { type: 'start' });
        while (!s.match!.done) s = act(s, { type: 'segment' });
        s = act(s, { type: 'finish' });
      }
      if (s.facilities < 5 && s.funds >= facilityUpgradeCost(s.facilities))
        s = act(s, { type: 'upgrade' });
      if (s.week === 0 && s.day === 0 && s.season > 1) {
        const ranked = [...s.players].sort((a, b) => overall(b) - overall(a));
        snapshots.push({
          seed,
          season: s.season - 1,
          top11: ranked.slice(0, 11).reduce((n, p) => n + overall(p), 0) / 11,
          a: ranked.filter((p) => overall(p) >= 80).length,
          facility: s.facilities,
          reputation: s.reputation,
          trophies: s.records.trophies,
        });
      }
    }
    assert.ok(guard < 50000, `seed ${seed} stopped progressing`);
    validateSave(JSON.parse(JSON.stringify(s)));
  }
  for (const row of snapshots.filter((r) => r.season === 1)) {
    assert.ok(row.top11 <= 68 && row.a === 0 && row.trophies === 0, `first season, seed ${row.seed}: ${JSON.stringify(row)}`);
  }
  for (const row of snapshots.filter((r) => r.season < 4)) {
    assert.ok(row.facility < 5 && row.reputation < 100, `progress too fast: ${JSON.stringify(row)}`);
  }
  for (const season of [7, 8]) {
    const rows = snapshots.filter((r) => r.season === season);
    // Extra time changes cup results and the later random sequence. Retain the
    // 1–5 target across the three seeds while allowing individual schools to
    // reach it at different times.
    // T-11: talent quality now tracks sustained reputation (repSustain) instead of a
    // hard season-7 gate, so a school whose reputation happens to reach the cap in
    // season 4–5 (see seed 789 below) legitimately develops a bit faster than the
    // 1–5 mean target by season 8 — that is the intended fix, not noise. The per-seed
    // cap is loosened from the old gated system's 6 to 9 to allow for that.
    const meanA = rows.reduce((total, row) => total + row.a, 0) / rows.length;
    assert.ok(meanA >= 1 && meanA <= 5, `season ${season}: mean ${meanA} A players`);
    for (const row of rows) assert.ok(row.a <= 9, `season ${season}, seed ${row.seed}: ${row.a} A players`);
  }
  for (const seed of seeds) {
    assert.ok(snapshots.some((r) => r.seed === seed && r.season >= 10 && r.facility === 5 && r.reputation >= 95 && r.a >= 8), `seed ${seed} never develops eight A players after season 10`);
  }
});

// ---------------------------------------------------------------------------
// T-11: talent connects to sustained reputation (repSustain), not a season-7 gate.
// A school that raises and holds its reputation early should get A players sooner
// than the passive manager, and the A count should not jump off a cliff between
// consecutive seasons.
// ---------------------------------------------------------------------------
function simulateSeasons(seed: number, lastSeason: number, boostReputation: boolean) {
  let s = newGame('育成検証高校', seed);
  let guard = 0;
  const rows: { season: number; a: number; reputation: number; repSustain: number }[] = [];
  while (s.season <= lastSeason && guard++ < 50000) {
    // The "boosted" school keeps reputation artificially maxed from year 1
    // (e.g. an aggressive PR push), independent of match results, to see whether
    // *sustaining* a high reputation early — not just reaching it late — pulls A
    // players in sooner than the passive manager.
    if (boostReputation) s.reputation = 100;
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    s = resolveLife(s);
    s = act(s, { type: 'train', training: s.weeklyMenu[s.day] });
    if (s.pending) {
      s = act(s, { type: 'start' });
      while (!s.match!.done) s = act(s, { type: 'segment' });
      s = act(s, { type: 'finish' });
    }
    if (boostReputation) s.reputation = 100;
    if (s.facilities < 5 && s.funds >= facilityUpgradeCost(s.facilities))
      s = act(s, { type: 'upgrade' });
    if (s.week === 0 && s.day === 0 && s.season > 1) {
      const ranked = [...s.players].sort((a, b) => overall(b) - overall(a));
      rows.push({
        season: s.season - 1,
        a: ranked.filter((p) => overall(p) >= 80).length,
        reputation: s.reputation,
        repSustain: s.repSustain,
      });
    }
  }
  assert.ok(guard < 50000, `seed ${seed} stopped progressing`);
  validateSave(JSON.parse(JSON.stringify(s)));
  return rows;
}

void test('T-11: a school that raises and sustains its reputation early develops A players sooner than a passive one', () => {
  // Two seeds are enough to show the direction (and keep this long-simulation test
  // within a few tens of seconds); seed 789 is the seed whose passive reputation
  // happens to reach its cap earliest, seed 17 the one that reaches it latest.
  const seeds = [17, 789];
  let boostedEverEarlier = false;
  for (const seed of seeds) {
    const passive = simulateSeasons(seed, 8, false);
    const boosted = simulateSeasons(seed, 8, true);
    const firstA = (rows: { season: number; a: number }[]) =>
      rows.find((r) => r.a > 0)?.season ?? Infinity;
    const passiveFirst = firstA(passive);
    const boostedFirst = firstA(boosted);
    assert.ok(
      boostedFirst <= passiveFirst,
      `seed ${seed}: boosted first A at season ${boostedFirst}, passive at ${passiveFirst}`,
    );
    if (boostedFirst < passiveFirst) boostedEverEarlier = true;
    // The boosted school's repSustain should track ahead of the passive one at every
    // checkpoint once both have some season history (it is an EMA, so it cannot beat
    // the passive school's reputation instantly at season 1).
    for (const row of boosted.filter((r) => r.season >= 2)) {
      const match = passive.find((r) => r.season === row.season);
      if (match) assert.ok(row.repSustain >= match.repSustain, `seed ${seed} season ${row.season}: boosted repSustain ${row.repSustain} < passive ${match.repSustain}`);
    }
  }
  assert.ok(boostedEverEarlier, 'no seed showed an earlier first A player for the reputation-boosted school');
});

void test('T-11: the A-player count grows smoothly across seasons, without a year-number cliff', () => {
  // A single 12-season run is enough to check for cliffs; the multi-seed magnitude
  // targets are already covered by the "passive manager" test above.
  const seeds = [42];
  for (const seed of seeds) {
    const rows = simulateSeasons(seed, 12, false);
    for (let i = 1; i < rows.length; i++) {
      const delta = Math.abs(rows[i].a - rows[i - 1].a);
      assert.ok(delta <= 10, `seed ${seed}: A players jumped from ${rows[i - 1].a} (season ${rows[i - 1].season}) to ${rows[i].a} (season ${rows[i].season})`);
    }
    // No hard cliff specifically at the old season-7/8/9 gate boundary: the jump
    // around those seasons should be no larger than jumps seen elsewhere in the run.
    const deltas = rows.slice(1).map((r, i) => r.a - rows[i].a);
    const aroundOldGate = deltas.slice(5, 8); // seasons 7-9 transitions (index 0 = season1->2)
    const maxElsewhere = Math.max(0, ...deltas.filter((_, i) => i < 5 || i > 7));
    for (const d of aroundOldGate) assert.ok(d <= maxElsewhere + 3, `seed ${seed}: cliff-sized jump (${d}) right at the old season gate`);
  }
});

// ---------------------------------------------------------------------------
// T-4: フォーメーションの相性。相手の布陣の弱点（サイド/中央）に合わせた布陣・攻撃の指示を
// 選ぶと、格上の相手（+8）に対する勝率が数ポイント〜10ポイント程度上がること。相性を
// 中立にした場合（バランス型4-4-2どうし、または指示が噛み合わない）は差が出ないこと。
// ---------------------------------------------------------------------------
function playFormationMatchup(
  seed: number,
  diff: number,
  myFormation: Formation,
  oppFormation: Formation,
  lane: 'mixed' | 'wide' | 'middle',
): Match {
  let s = newGame('布陣相性検証高校', seed);
  s = toMatchDay(s);
  s = act(s, { type: 'formation', formation: myFormation });
  s = act(s, { type: 'start' });
  const rating = strength(s);
  s.match!.fixture.strength = Math.max(1, Math.min(99, Math.round(rating - diff)));
  s.match!.fixture.kind = 'friendly';
  s.match!.fixture.style = 'balanced';
  s.match!.fixture.formation = oppFormation;
  if (lane !== 'mixed') s = act(s, { type: 'command', field: 'lane', value: lane });
  while (!s.match!.done) s = act(s, { type: 'segment' });
  return s.match!;
}
function winRate(
  n: number,
  seedBase: number,
  diff: number,
  myFormation: Formation,
  oppFormation: Formation,
  lane: 'mixed' | 'wide' | 'middle',
): number {
  let win = 0;
  for (let i = 0; i < n; i++) {
    const m = playFormationMatchup(seedBase + i, diff, myFormation, oppFormation, lane);
    if (m.home > m.away) win++;
  }
  return win / n;
}

void test('T-4: a formation/lane matchup exploiting the opponent\'s weak side beats a bad matchup against a stronger opponent', () => {
  const N = 300;
  // 良い相性: 4-3-3（サイドで数的優位）でサイド攻撃 vs 3バック（サイドが弱点）。
  const good = winRate(N, 2_100_000, 8, '4-3-3', '3-4-3', 'wide');
  // 悪い相性: 同じ4-3-3で中央攻撃 vs 4-2-3-1（中央が強み）。
  const bad = winRate(N, 2_200_000, 8, '4-3-3', '4-2-3-1', 'middle');
  const diffPts = (good - bad) * 100;
  assert.ok(
    diffPts >= 2 && diffPts <= 12,
    `good=${(good * 100).toFixed(1)}% bad=${(bad * 100).toFixed(1)}% diff=${diffPts.toFixed(1)}pt (expected 2〜12pt)`,
  );
});

void test('T-4: the formation compatibility bonus is small — at most as large as the tactic compatibility swing', () => {
  const N = 300;
  // 戦術の相性は+8で20%→33%(参考表)、幅にして約13pt。布陣の相性はそれ以下に収める。
  const good = winRate(N, 2_300_000, 8, '4-3-3', '3-4-3', 'wide');
  const bad = winRate(N, 2_400_000, 8, '4-3-3', '4-2-3-1', 'middle');
  assert.ok((good - bad) * 100 <= 13, `formation swing too large: ${((good - bad) * 100).toFixed(1)}pt`);
});

void test('T-4: with no formation trait engaged (own formation neutral, chosen lane does not match the opponent weakness), win rate does not react to the opponent formation', () => {
  const N = 300;
  // 自分は4-4-2（得意レーンなし）で中央攻撃。相手の3-4-3の弱点はサイドなので、中央攻撃には
  // 何のボーナスも乗らないはず（相手が4-4-2＝完全に中立でも同じ勝率になるはず）。
  // 同じ組（seedBase・レーン・自陣の布陣）を保ったまま相手の布陣だけを変えることで、
  // 「布陣の相性」を切り離して比較する（レーン自体の攻撃力補正は同一のまま）。
  const vsWeakSideButWrongLane = winRate(N, 2_500_000, 8, '4-4-2', '3-4-3', 'middle');
  const vsNeutral = winRate(N, 2_500_000, 8, '4-4-2', '4-4-2', 'middle');
  assert.ok(
    Math.abs(vsWeakSideButWrongLane - vsNeutral) <= 0.06,
    `no trait engaged should not react to opponent formation: vsWeakSideButWrongLane=${(vsWeakSideButWrongLane * 100).toFixed(1)}%, vsNeutral=${(vsNeutral * 100).toFixed(1)}%`,
  );
});

void test('T-4: exploiting the opponent weak lane (same own formation, same lane order) still raises the win rate over a neutral opponent', () => {
  const N = 300;
  // 上のテストと同じ自陣布陣・レーン（サイド攻撃）のまま、相手の布陣だけを弱点直撃(3-4-3)か
  // 中立(4-4-2)かで比較する。レーンの基礎補正は共通なので、差が出るのは布陣の相性だけ。
  // 勝率が天井付近(diff=+8はベース約75%)だと倍率の効きが見えにくいため、感度の高い互角
  // 勝負(diff=0)で比較する。
  const vsWeakSide = winRate(N, 2_600_000, 0, '4-4-2', '3-4-3', 'wide');
  const vsNeutral = winRate(N, 2_600_000, 0, '4-4-2', '4-4-2', 'wide');
  assert.ok(
    vsWeakSide - vsNeutral >= 0.02,
    `exploiting the opponent weak lane should raise the win rate: vsWeakSide=${(vsWeakSide * 100).toFixed(1)}%, vsNeutral=${(vsNeutral * 100).toFixed(1)}%`,
  );
});
