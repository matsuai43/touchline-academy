// DESIGN_V3_5.md 3.1〜3.5 の受け入れ条件（長期・多数試行シミュレーション）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, strength, overall, facilityUpgradeCost, validateSave, type State, type Match } from '../lib/game.ts';
import { statCeiling, applyStatGrowth } from '../lib/growth.ts';
import { candidatePool } from '../lib/development.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import {
  hydrateCompetition,
  readCompetition,
  computeLeagueTable,
  competitionFixture,
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
  const initial = candidatePool(low);
  const popular = candidatePool(high);
  assert.ok(popular.reduce((n, c) => n + c.ability, 0) > initial.reduce((n, c) => n + c.ability, 0));
  assert.ok(popular.reduce((n, c) => n + c.potential, 0) > initial.reduce((n, c) => n + c.potential, 0));
  assert.deepEqual([1, 2, 3, 4].map(facilityUpgradeCost), [40, 80, 140, 500]);
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
    const mean = rows.reduce((n, r) => n + r.a, 0) / rows.length;
    assert.ok(mean >= 1 && mean <= 5, `season ${season} A-player mean=${mean}`);
  }
  for (const seed of seeds) {
    assert.ok(snapshots.some((r) => r.seed === seed && r.season >= 10 && r.facility === 5 && r.reputation >= 95 && r.a >= 8), `seed ${seed} never develops eight A players after season 10`);
  }
});
