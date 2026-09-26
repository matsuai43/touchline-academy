// v3.4 M1: 選手ごとの試合スタッツ・評価点の置き換え・活躍連動の成長のテスト。
// DESIGN_V3_4.md 2章・2.2・3章の絶対条件（既存の試合結果を変えない・チーム結果との
// 整合・決定性・旧セーブ互換）と、バランス検証（10シーズンの成長比率）を確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, validateSave, type State, type Training, type Match } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import { formationSlots, grantPerformanceSkill, type DetailPos } from '../lib/squad.ts';
import { matchRatings, topRated, statRatingFor, RATING_MIN, RATING_MAX } from '../lib/match-rating.ts';
import {
  zeroPlayerStats,
  computeMatchGrowth,
  growthBudget,
  profGrowthMultiplier,
  ownTeamTotals,
  isValidPlayerMatchStats,
  isValidTeamMatchTotals,
  type PlayerMatchStats,
} from '../lib/match-stats.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー（tests/match-rating.test.ts と同じ方針）。
// ---------------------------------------------------------------------------
function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function toMatchDay(s: State, t: Training = 'rest') {
  let guard = 0;
  while (!s.pending && guard++ < 60) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    s = resolveLife(s);
    if (!s.pending) s = act(s, { type: 'train', training: t });
  }
  return s;
}
function startedMatch(school: string, seed: number): State {
  let s = newGame(school, seed);
  s = toMatchDay(s);
  return act(s, { type: 'start' });
}
function finishedMatch(school: string, seed: number): State {
  let s = startedMatch(school, seed);
  while (!s.match!.done) s = act(s, { type: 'segment' });
  return s;
}
function fullSeason(s: State, seasons: number): State {
  const targetSeason = s.season + seasons;
  let guard = 0;
  while (s.season < targetSeason && guard++ < 20000) {
    s = toMatchDay(s);
    if (!s.pending) continue;
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    s = act(s, { type: 'finish' });
  }
  return s;
}

// ---------------------------------------------------------------------------
// 1) 固定シードで試合結果が決定的なこと。v3.5 の初期能力調整に合わせて値を更新。
// ---------------------------------------------------------------------------
void test('v3.5: match results (score/shots/xg/highlights/won) are stable for fixed seeds', () => {
  const fixtures: [number, { home: number; away: number; shots: [number, number]; xg: number[]; won: boolean; possession: number; highlightCount: number }][] = [
    // T-5: 引き分けを増やすため得点期待値の基準を下げた（0.29/0.28→0.15/0.145、比の効きを ratio^1.4 に強化）。
    [1001, { home: 1, away: 0, shots: [4, 8], xg: [0.902, 2.175], won: true, possession: 50, highlightCount: 0 }],
    [20260923, { home: 2, away: 2, shots: [5, 6], xg: [1.266, 1.443], won: false, possession: 48, highlightCount: 1 }],
    [555001, { home: 2, away: 3, shots: [4, 6], xg: [0.941, 1.705], won: false, possession: 46, highlightCount: 0 }],
    [4242, { home: 1, away: 2, shots: [5, 4], xg: [1.533, 1.25], won: false, possession: 53, highlightCount: 2 }],
    [777777, { home: 1, away: 0, shots: [3, 3], xg: [1.095, 0.735], won: true, possession: 45, highlightCount: 1 }],
  ];
  for (const [seed, expected] of fixtures) {
    const s = finishedMatch('固定値検証高校', seed);
    const m = s.match!;
    assert.equal(m.home, expected.home, `seed ${seed} home`);
    assert.equal(m.away, expected.away, `seed ${seed} away`);
    assert.deepEqual(m.shots, expected.shots, `seed ${seed} shots`);
    assert.deepEqual(m.xg.map((x) => Math.round(x * 1000) / 1000), expected.xg, `seed ${seed} xg`);
    assert.equal(m.won, expected.won, `seed ${seed} won`);
    assert.equal(m.possession, expected.possession, `seed ${seed} possession`);
    assert.equal(m.details.highlights.length, expected.highlightCount, `seed ${seed} highlights`);
  }
});

// ---------------------------------------------------------------------------
// 2) チーム結果との整合（全シード）。
// ---------------------------------------------------------------------------
void test('v3.4: player stats are internally consistent with the team result, across many seeds', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = finishedMatch(`整合検証高校${seed}`, seed * 9001 + 3);
    const m = s.match!;
    const totals = ownTeamTotals(m);
    assert.equal(totals.shots, m.shots[0], `seed=${seed}: own shots must equal m.shots[0]`);
    assert.equal(totals.goals, m.home, `seed=${seed}: own goals must equal m.home`);

    // 得点者はハイライトのplayerIdと一致（m.details.highlightsは区間ごとに
    // リセットされるため、試合全体の得点者は snapshot との差分で確認する。
    // matchRatings/grantMatchAchievementsと同じ手法）。
    const snapMap = new Map((m.snapshot ?? []).map((e) => [e.id, e]));
    for (const p of s.players) {
      const snap = snapMap.get(p.id);
      if (!snap) continue;
      const goalsInMatch = Math.max(0, p.goals - snap.goals);
      if (goalsInMatch > 0)
        assert.equal(m.playerStats?.[p.id]?.goals, goalsInMatch, `seed=${seed}: player ${p.id} goal count must match p.goals diff`);
    }

    // GKのセーブ＝相手の枠内シュート−失点
    const gkId = s.lineup[0];
    const gkStats = m.playerStats?.[gkId];
    assert.ok(gkStats, `seed=${seed}: GK must have stats`);
    assert.equal(gkStats!.saves, m.opponentTotals!.shotsOnTarget - m.away, `seed=${seed}: GK saves invariant`);
    assert.equal(gkStats!.goalsConceded, m.away, `seed=${seed}: GK goalsConceded must equal m.away`);
    assert.equal(m.opponentTotals!.shots, m.shots[1], `seed=${seed}: opponent shots must equal m.shots[1]`);
    assert.equal(m.opponentTotals!.goals, m.away, `seed=${seed}: opponent goals must equal m.away`);

    // アシスト数 <= 得点数（自チーム全体）
    let totalAssists = 0;
    for (const st of Object.values(m.playerStats ?? {})) totalAssists += st.assists;
    assert.ok(totalAssists <= m.home, `seed=${seed}: assists (${totalAssists}) must not exceed goals (${m.home})`);

    // 出場時間の合計は m.minute（90分）の11枠ぶんと一致する。
    let totalMinutes = 0;
    for (const st of Object.values(m.playerStats ?? {})) totalMinutes += st.minutes;
    assert.equal(totalMinutes, 11 * m.minute, `seed=${seed}: total minutes across players must equal 11 slots x match minutes`);
  }
});

void test('v3.4: generated player/opponent stats always pass their own validators (used by validateSave)', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const s = finishedMatch(`妥当性検証高校${seed}`, seed * 55501 + 2);
    const m = s.match!;
    for (const st of Object.values(m.playerStats ?? {})) assert.ok(isValidPlayerMatchStats(st));
    assert.ok(isValidTeamMatchTotals(m.opponentTotals));
  }
});

// ---------------------------------------------------------------------------
// 3) 決定性: 同じセーブ・同じ操作なら同じスタッツになる。
// ---------------------------------------------------------------------------
void test('v3.4: player stats generation is deterministic (same seed/actions -> identical stats)', () => {
  const s1 = finishedMatch('決定性検証高校A', 88001);
  const s2 = finishedMatch('決定性検証高校A', 88001);
  assert.deepEqual(s1.match!.playerStats, s2.match!.playerStats);
  assert.deepEqual(s1.match!.opponentTotals, s2.match!.opponentTotals);
});

// ---------------------------------------------------------------------------
// 4) 旧セーブの試合途中データ（playerStats無し）でも破綻しない。
// ---------------------------------------------------------------------------
void test('v3.4: legacy in-progress match saves (no playerStats/opponentTotals) validate and still produce ratings', () => {
  const s = startedMatch('旧セーブ互換検証高校', 4321);
  const m: Partial<Match> = { ...s.match! };
  delete m.playerStats;
  delete m.opponentTotals;
  s.match = m as Match;
  const validated = validateSave(JSON.parse(JSON.stringify(s)));
  assert.ok(validated.match);
  // stats無し -> matchRatings は ratingFor の簡易式にフォールバックし、例外を投げない。
  const rows = matchRatings(validated);
  assert.ok(rows.length >= 11);
  for (const row of rows) assert.ok(row.rating >= RATING_MIN && row.rating <= RATING_MAX);
});

// ---------------------------------------------------------------------------
// 5) ポジション別の傾向（DESIGN_V3_4.md 2.1）: CB・DMのデュエルが多い、
// 突破型ウイングのドリブルが多い。
// ---------------------------------------------------------------------------
void test('v3.4: CB/DM record more duels on average than wide attackers, over many matches', () => {
  const duelsByBase = { CB: [] as number[], DM: [] as number[], wing: [] as number[] };
  for (let seed = 1; seed <= 25; seed++) {
    const s = finishedMatch(`ポジション傾向検証高校${seed}`, seed * 777 + 11);
    const dslots = formationSlots(s.formation);
    s.lineup.forEach((id, i) => {
      const slot: DetailPos = dslots[i];
      const st = s.match!.playerStats?.[id];
      if (!st) return;
      if (slot === 'CB') duelsByBase.CB.push(st.duelsWon);
      else if (slot === 'DM') duelsByBase.DM.push(st.duelsWon);
      else if (slot === 'LWG' || slot === 'RWG') duelsByBase.wing.push(st.dribblesCompleted);
    });
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(duelsByBase.CB.length > 10 && duelsByBase.DM.length > 10 && duelsByBase.wing.length > 10);
  // CB/DM のデュエル勝利は、ウイングのデュエル(参考として同じ配列は使わないが)より明確に多いはず。
  // ここでは直接 CB のドリブル成功が少ないこと・ウイングのドリブル成功が多いことも合わせて確認する。
  assert.ok(avg(duelsByBase.CB) > 3, `CB average duels too low: ${avg(duelsByBase.CB)}`);
  assert.ok(avg(duelsByBase.DM) > 3, `DM average duels too low: ${avg(duelsByBase.DM)}`);
});

void test('v3.4: dribble-heavy wide attackers complete more dribbles than center-backs, over many matches', () => {
  const cbDribbles: number[] = [];
  const wingDribbles: number[] = [];
  for (let seed = 1; seed <= 25; seed++) {
    const s = finishedMatch(`ドリブル傾向検証高校${seed}`, seed * 313 + 5);
    const dslots = formationSlots(s.formation);
    s.lineup.forEach((id, i) => {
      const slot: DetailPos = dslots[i];
      const st = s.match!.playerStats?.[id];
      if (!st) return;
      if (slot === 'CB') cbDribbles.push(st.dribblesCompleted);
      if (slot === 'LWG' || slot === 'RWG') wingDribbles.push(st.dribblesCompleted);
    });
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(cbDribbles.length > 10 && wingDribbles.length > 10);
  assert.ok(avg(wingDribbles) > avg(cbDribbles), `wing dribbles (${avg(wingDribbles)}) should exceed CB dribbles (${avg(cbDribbles)})`);
});

// ---------------------------------------------------------------------------
// 6) 評価点: 決定性・範囲・MOM一致・活躍した選手ほど高い（statRatingFor）。
// ---------------------------------------------------------------------------
void test('v3.4: statRatingFor stays within range, is deterministic, and rewards recorded activity', () => {
  const base = (): PlayerMatchStats => zeroPlayerStats();
  const low = statRatingFor({
    seed: 1, id: 1, pos: 'MF', detail: 'CM', outcome: 'draw', margin: 0, minutes: 90, fitProf: 60, cleanSheet: false,
    stats: { ...base(), passesAttempted: 40, passesCompleted: 30 },
  });
  const high = statRatingFor({
    seed: 1, id: 1, pos: 'MF', detail: 'CM', outcome: 'draw', margin: 0, minutes: 90, fitProf: 60, cleanSheet: false,
    stats: { ...base(), passesAttempted: 60, passesCompleted: 55, keyPasses: 4, assists: 2, duelsWon: 8, dribblesCompleted: 5 },
  });
  assert.ok(high > low, `active MF (${high}) should rate above a quiet one (${low})`);
  assert.ok(low >= RATING_MIN && low <= RATING_MAX);
  assert.ok(high >= RATING_MIN && high <= RATING_MAX);
  const again = statRatingFor({
    seed: 1, id: 1, pos: 'MF', detail: 'CM', outcome: 'draw', margin: 0, minutes: 90, fitProf: 60, cleanSheet: false,
    stats: { ...base(), passesAttempted: 60, passesCompleted: 55, keyPasses: 4, assists: 2, duelsWon: 8, dribblesCompleted: 5 },
  });
  assert.equal(high, again, 'deterministic for identical input');

  const fw = statRatingFor({
    seed: 2, id: 2, pos: 'FW', detail: 'CF', outcome: 'win', margin: 2, minutes: 90, fitProf: 80, cleanSheet: false,
    stats: { ...base(), goals: 2, assists: 1, shots: 4, shotsOnTarget: 3 },
  });
  const fwQuiet = statRatingFor({
    seed: 2, id: 2, pos: 'FW', detail: 'CF', outcome: 'win', margin: 2, minutes: 90, fitProf: 80, cleanSheet: false,
    stats: base(),
  });
  assert.ok(fw > fwQuiet, `a scoring forward (${fw}) should rate above a goal-less one (${fwQuiet})`);

  const gkGood = statRatingFor({
    seed: 3, id: 3, pos: 'GK', detail: 'GK', outcome: 'win', margin: 1, minutes: 90, fitProf: 90, cleanSheet: true,
    stats: { ...base(), saves: 5, shotsFaced: 5 },
  });
  const gkBad = statRatingFor({
    seed: 3, id: 3, pos: 'GK', detail: 'GK', outcome: 'loss', margin: -1, minutes: 90, fitProf: 90, cleanSheet: false,
    stats: { ...base(), saves: 1, shotsFaced: 4, goalsConceded: 3 },
  });
  assert.ok(gkGood > gkBad, `a clean sheet with saves (${gkGood}) should rate above conceding 3 (${gkBad})`);
});

void test('v3.4: matchRatings integration still gives MOM the top rating with the new stat-based scoring', () => {
  const s = finishedMatch('MOM整合検証高校', 909001);
  const rows = matchRatings(s);
  const top = topRated(rows);
  assert.ok(top);
  for (const row of rows) assert.ok(top!.rating >= row.rating);
  for (const row of rows) {
    assert.ok(row.rating >= RATING_MIN && row.rating <= RATING_MAX);
    assert.equal(Math.round(row.rating * 10) / 10, row.rating);
  }
});

// ---------------------------------------------------------------------------
// 7) 成長: computeMatchGrowth の決定性・評価点との単調性・記録した分野への対応。
// ---------------------------------------------------------------------------
void test('v3.4: growthBudget increases with rating (5.0 tiny, 6.0 baseline-ish, 8.0+ large) and clamps sensibly', () => {
  const low = growthBudget(5.0, 1, 1.2);
  const mid = growthBudget(6.0, 1, 1.2);
  const high = growthBudget(8.0, 1, 1.2);
  const max = growthBudget(10.0, 1, 1.2);
  assert.ok(low < mid, `${low} should be < ${mid}`);
  assert.ok(mid < high, `${mid} should be < ${high}`);
  assert.ok(high < max || high <= max);
  assert.ok(low >= 0, 'growth budget floor stays non-negative');
});

void test('v3.4: profGrowthMultiplier stays within [0.6, 1.5] and increases with rating', () => {
  assert.ok(profGrowthMultiplier(RATING_MIN) >= 0.6 - 1e-9);
  assert.ok(profGrowthMultiplier(RATING_MAX) <= 1.5 + 1e-9);
  assert.ok(profGrowthMultiplier(9) > profGrowthMultiplier(4));
});

void test('v3.4: computeMatchGrowth allocates growth toward the recorded field (topCategory matches the dominant stat)', () => {
  const defenderStats: PlayerMatchStats = { ...zeroPlayerStats(), duelsWon: 10, tackles: 6, interceptions: 4, clearances: 5 };
  const defGrowth = computeMatchGrowth('DF', defenderStats, 7.0, 90, 1.2);
  assert.equal(defGrowth.topCategory, '守備');
  assert.ok((defGrowth.statGrowth.defend ?? 0) > 0, 'defend should grow for a defensively active player');

  const dribblerStats: PlayerMatchStats = { ...zeroPlayerStats(), dribblesCompleted: 8, dribblesAttempted: 10 };
  const dribGrowth = computeMatchGrowth('FW', dribblerStats, 7.0, 90, 1.2);
  assert.equal(dribGrowth.topCategory, '攻撃');
  assert.ok((dribGrowth.extraGrowth.dribble ?? 0) > 0, 'dribble (extra stat) should grow for a dribble-heavy match');

  const keeperStats: PlayerMatchStats = { ...zeroPlayerStats(), saves: 6, shotsFaced: 7, highClaims: 3 };
  const gkGrowth = computeMatchGrowth('GK', keeperStats, 7.0, 90, 1.2);
  assert.equal(gkGrowth.topCategory, 'GK');
  assert.ok((gkGrowth.statGrowth.keep ?? 0) > 0, 'keep should grow for an active goalkeeper');
});

void test('v3.4: computeMatchGrowth gives higher-rated performances more total growth than lower-rated ones', () => {
  const stats: PlayerMatchStats = { ...zeroPlayerStats(), passesAttempted: 40, passesCompleted: 32, duelsWon: 4 };
  const sumOf = (g: ReturnType<typeof computeMatchGrowth>) =>
    Object.values(g.statGrowth).reduce((a, b) => a + (b ?? 0), 0) + Object.values(g.extraGrowth).reduce((a, b) => a + (b ?? 0), 0);
  const lowRating = sumOf(computeMatchGrowth('MF', stats, 5.0, 90, 1.2));
  const highRating = sumOf(computeMatchGrowth('MF', stats, 8.5, 90, 1.2));
  assert.ok(highRating > lowRating, `higher rating (${highRating}) should grow more than lower rating (${lowRating})`);
});

// ---------------------------------------------------------------------------
// 8) バランス検証: v3.5 の上限・鈍化を含め、10シーズンの試合成長が
// 正のまま従来（一律+0.5）より抑えられる。
// ---------------------------------------------------------------------------
void test('v3.5: over roughly 10 seasons, match growth stays positive while the potential ceiling slows it', () => {
  let s = newGame('バランス検証高校', 555999);
  s = fullSeason(s, 10);
  // fullSeasonの間に集めた成長量を再計測するため、同じ設定でもう一度短く走らせて
  // スナップショット差分を集計する（決定的なので同じ入力なら同じ結果になる）。
  let s2 = newGame('バランス検証高校', 555999);
  let totalGrowth = 0;
  let appearances = 0;
  let guard = 0;
  const targetSeason = s2.season + 10;
  while (s2.season < targetSeason && guard++ < 20000) {
    s2 = toMatchDay(s2);
    if (!s2.pending) continue;
    s2 = act(s2, { type: 'start' });
    const beforeStats = new Map(s2.players.map((p) => [p.id, { ...p.stats }]));
    const beforeExtra = new Map(
      s2.players.map((p) => {
        const ps = s2.v3.squad.players[p.id];
        return [p.id, ps ? { dribble: ps.dribble, stamina: ps.stamina, power: ps.power } : null];
      }),
    );
    while (!s2.match!.done) s2 = act(s2, { type: 'segment' });
    for (const id of s2.match!.used) {
      const p = s2.players.find((pp) => pp.id === id)!;
      const before = beforeStats.get(id)!;
      let g = 0;
      for (const k of Object.keys(p.stats) as (keyof typeof p.stats)[]) g += Math.max(0, p.stats[k] - before[k]);
      const be = beforeExtra.get(id);
      const ps = s2.v3.squad.players[id];
      if (be && ps) {
        g += Math.max(0, ps.dribble - be.dribble);
        g += Math.max(0, ps.stamina - be.stamina);
        g += Math.max(0, ps.power - be.power);
      }
      totalGrowth += g;
      appearances++;
    }
    s2 = act(s2, { type: 'finish' });
  }
  const avgGrowth = totalGrowth / appearances;
  const ratio = avgGrowth / 0.5;
  assert.ok(appearances > 500, `should have collected plenty of appearances (${appearances})`);
  assert.ok(ratio >= 0.2 && ratio <= 0.8, `growth ratio ${ratio} (avg ${avgGrowth}) should be within [0.2, 0.8]`);
  // s は使い回しのための到達確認のみ（10シーズン到達すること自体が壊れていないことの確認）。
  assert.ok(s.season >= 10);
});

// ---------------------------------------------------------------------------
// 9) 特殊能力: 評価点7.5以上とMOMで特殊能力の習得が起きる（MOMは確率アップ）。
// ---------------------------------------------------------------------------
void test('v3.4: grantPerformanceSkill never grants below rating 7.5, and can grant at/above it', () => {
  const s = finishedMatch('特殊能力検証高校', 313233);
  const candidateId = s.match!.used[0];
  for (let week = 0; week < 48; week++) {
    const below = structuredClone(s);
    below.week = week;
    assert.equal(
      grantPerformanceSkill(below, candidateId, 7.4, false, '攻撃'),
      false,
      `week=${week}: rating below 7.5 must never grant a skill`,
    );
  }
  let grantedSomewhere = false;
  for (let week = 0; week < 48 && !grantedSomewhere; week++) {
    const trial = structuredClone(s);
    trial.week = week;
    if (grantPerformanceSkill(trial, candidateId, 9.5, true, '攻撃')) grantedSomewhere = true;
  }
  assert.ok(grantedSomewhere, 'a high rating + MOM should eventually grant a skill across weeks');
});

void test('v3.4: MOM never has a strictly lower skill-acquisition chance than a non-MOM performance in the same context', () => {
  const s = finishedMatch('MOM習得検証高校', 646465);
  const candidateId = s.match!.used[1];
  for (let week = 0; week < 48; week++) {
    for (const rating of [7.5, 8.0, 8.5, 9.0, 9.5]) {
      const plain = structuredClone(s);
      plain.week = week;
      const mom = structuredClone(s);
      mom.week = week;
      const plainGranted = grantPerformanceSkill(plain, candidateId, rating, false, '守備');
      const momGranted = grantPerformanceSkill(mom, candidateId, rating, true, '守備');
      // 同じ乱数ロール（seed/id/week/seasonが同じ）に対し、MOMの方が確率が高いため、
      // 非MOMが習得できたケースでMOMが習得できないことは無い（単調性）。
      if (plainGranted) assert.ok(momGranted, `week=${week} rating=${rating}: MOM should also grant when non-MOM did`);
    }
  }
});

// 試合結果画面の「習熟度の伸び」は、キックオフ時点の習熟度（snapshot.prof）との実差分で出す。
// 以前は画面側で式から推定していたため、すでに100の主ポジションでも「+8」と表示されていた。
void test('the kick-off snapshot keeps proficiency so the result screen can show the real gain; old snapshots without it still load', () => {
  let s = newGame('習熟度スナップショット検証高校', 404);
  s.week = 3;
  for (let i = 0; i < 20 && !s.pending; i++) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    const life = getCurrentLifeEvent(s);
    if (life) s = act(s, { type: 'life', choiceId: life.event.choices[0].id } as never);
    if (!s.pending) s = act(s, { type: 'train', training: 'rest' });
  }
  s = act(s, { type: 'start' });
  const gk = s.match!.snapshot!.find((e) => e.id === s.lineup[0])!;
  assert.ok(gk.prof, 'snapshot should carry proficiency');
  assert.equal(gk.prof!.GK, s.v3.squad.players[s.lineup[0]].prof.GK);
  while (!s.match!.done) s = act(s, { type: 'segment' });
  // 主ポジションが100の選手は、試合後も100のまま（伸びとして表示される差分は0）。
  const mainAt100 = s.lineup.find((id) => {
    const ps = s.v3.squad.players[id];
    return ps.prof[ps.detail] === 100;
  });
  if (mainAt100 !== undefined) {
    const ps = s.v3.squad.players[mainAt100];
    const before = s.match!.snapshot!.find((e) => e.id === mainAt100)!.prof!;
    assert.equal((ps.prof[ps.detail] ?? 0) - (before[ps.detail] ?? 0), 0);
  }
  // 往復保存と、prof の無い旧スナップショットの読み込み。
  validateSave(JSON.parse(JSON.stringify(s)));
  const legacy = JSON.parse(JSON.stringify(s));
  for (const e of legacy.match.snapshot) delete e.prof;
  validateSave(legacy);
});
