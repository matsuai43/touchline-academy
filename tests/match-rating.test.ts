import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, type State, type Training } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import {
  ratingFor,
  matchRatings,
  topRated,
  RATING_MIN,
  RATING_MAX,
  type RatingInput,
} from '../lib/match-rating.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー（tests/position-mastery.test.ts と同じ方針）。
// ---------------------------------------------------------------------------
function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function toMatchDay(s: State, t: Training = 'rest') {
  let guard = 0;
  while (!s.pending && guard++ < 20) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    s = resolveLife(s);
    s = act(s, { type: 'train', training: t });
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

function baseInput(overrides: Partial<RatingInput> = {}): RatingInput {
  return {
    seed: 12345,
    id: 1,
    outcome: 'draw',
    margin: 0,
    goals: 0,
    minutes: 90,
    fitProf: 60,
    fatigueAfter: 55,
    cleanSheet: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1) ratingFor: 純粋関数としての決定性・範囲・各種加点。
// ---------------------------------------------------------------------------
void test('ratingFor is deterministic for identical inputs', () => {
  const input = baseInput({ id: 7, goals: 1, minutes: 63, fitProf: 82, fatigueAfter: 70 });
  const a = ratingFor(input);
  const b = ratingFor({ ...input });
  assert.equal(a, b);
});

void test('ratingFor stays within [3.0, 10.0] even for extreme inputs', () => {
  const worst = ratingFor(
    baseInput({ outcome: 'loss', margin: -3, goals: 0, minutes: 90, fitProf: 0, fatigueAfter: 0 }),
  );
  const best = ratingFor(
    baseInput({
      outcome: 'win',
      margin: 3,
      goals: 6,
      minutes: 90,
      fitProf: 100,
      fatigueAfter: 100,
      cleanSheet: true,
    }),
  );
  assert.ok(worst >= RATING_MIN && worst <= RATING_MAX, `worst=${worst}`);
  assert.ok(best >= RATING_MIN && best <= RATING_MAX, `best=${best}`);
  assert.ok(best > worst);
});

void test('ratingFor rounds to one decimal place', () => {
  for (const goals of [0, 1, 2, 3, 4]) {
    const r = ratingFor(baseInput({ goals, minutes: 45 + goals * 7 }));
    assert.equal(Math.round(r * 10) / 10, r);
  }
});

void test('ratingFor: scoring more goals (all else equal) never lowers the rating', () => {
  const noGoal = ratingFor(baseInput({ id: 3, goals: 0 }));
  const oneGoal = ratingFor(baseInput({ id: 3, goals: 1 }));
  const twoGoals = ratingFor(baseInput({ id: 3, goals: 2 }));
  assert.ok(oneGoal > noGoal, `${oneGoal} should exceed ${noGoal}`);
  assert.ok(twoGoals >= oneGoal, `${twoGoals} should be >= ${oneGoal}`);
});

void test('ratingFor: a clean sheet raises a defender/keeper rating, all else equal', () => {
  const without = ratingFor(baseInput({ id: 9, cleanSheet: false }));
  const withCleanSheet = ratingFor(baseInput({ id: 9, cleanSheet: true }));
  assert.ok(withCleanSheet > without);
});

void test('ratingFor: higher positional proficiency raises the rating, all else equal', () => {
  const low = ratingFor(baseInput({ id: 4, fitProf: 10 }));
  const high = ratingFor(baseInput({ id: 4, fitProf: 95 }));
  assert.ok(high > low);
});

// ---------------------------------------------------------------------------
// 2) matchRatings: 実際の State/Match からの統合的な算出。
// ---------------------------------------------------------------------------
void test('matchRatings: every player who appeared gets one rating row within range, determinism holds', () => {
  const s = finishedMatch('評価点検証高校', 20260923);
  const rows = matchRatings(s);
  assert.ok(rows.length >= 11, '最低でも先発11人分は出るはず');
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, rows.length, '同じ選手が重複していないこと');
  for (const row of rows) {
    assert.ok(row.rating >= RATING_MIN && row.rating <= RATING_MAX, `rating=${row.rating}`);
    assert.equal(Math.round(row.rating * 10) / 10, row.rating);
    assert.ok(row.minutes > 0 && row.minutes <= 90);
  }
  // 同じ State から再計算しても同じ結果になる（決定的）。
  const rows2 = matchRatings(s);
  assert.deepEqual(rows, rows2);
});

void test('matchRatings: rows are sorted by rating descending, and topRated matches the sorted leader (MOM alignment)', () => {
  const s = finishedMatch('評価点順位検証高校', 555001);
  const rows = matchRatings(s);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].rating >= rows[i].rating);
  const top = topRated(rows);
  assert.ok(top);
  assert.equal(top!.id, rows[0].id);
  assert.equal(top!.rating, rows[0].rating);
  // 1位は他の全員以上の評価点を持つ。
  for (const row of rows) assert.ok(top!.rating >= row.rating);
});

void test('matchRatings: substitutes who came on are included with their own (shorter) minutes', () => {
  let s = startedMatch('途中出場検証高校', 4242);
  const benchId = s.players.find(
    (p) => !s.lineup.includes(p.id) && s.v3.squad.players[p.id]?.team === 'A' && !p.injury,
  )!.id;
  const outId = s.lineup[10];
  s = act(s, { type: 'swap', index: 10, id: benchId });
  while (!s.match!.done) s = act(s, { type: 'segment' });
  const rows = matchRatings(s);
  const subRow = rows.find((r) => r.id === benchId);
  const outRow = rows.find((r) => r.id === outId);
  assert.ok(subRow, '途中出場した選手にも評価点が付くこと');
  assert.equal(subRow!.started, false);
  if (outRow) {
    assert.ok(outRow.minutes < 90, '交代で下がった選手の出場時間は90分未満のはず');
    assert.ok(subRow!.minutes < 90);
    assert.equal(outRow.minutes + subRow!.minutes, s.match!.minute);
  }
});

void test('matchRatings returns an empty list when there is no match in progress', () => {
  const s = newGame('試合なし高校', 1);
  assert.deepEqual(matchRatings(s), []);
});
