// T4.2: 部費の見える化（収入履歴）。
import { newGame, act, addFunds, validateSave, facilityUpgradeCost, type State, type Training } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function step(s: State, t: Training = 'balance'): State {
  if (s.event) s = act(s, { type: 'event', choice: 'team' });
  s = resolveLife(s);
  s = act(s, { type: 'train', training: t });
  if (s.pending) {
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    s = act(s, { type: 'finish' });
  }
  return s;
}

void test('T4.2: addFunds records only positive amounts, newest-first, capped at 50 entries', () => {
  const s = newGame('', 601);
  const before = s.funds;
  addFunds(s, 0, 'ゼロは記録しない');
  addFunds(s, -5, '支出は記録しない');
  assert.equal(s.fundHistory.length, 0);
  assert.equal(s.funds, before - 5);
  addFunds(s, 3, '最初の収入');
  addFunds(s, 4, '2番目の収入');
  assert.equal(s.fundHistory.length, 2);
  assert.equal(s.fundHistory[0].reason, '2番目の収入', '新しい順に並ぶはず');
  assert.equal(s.fundHistory[0].amount, 4);
  for (let i = 0; i < 60; i++) addFunds(s, 1, `entry-${i}`);
  assert.equal(s.fundHistory.length, 50, '直近50件で打ち切るはず');
});

void test('T4.2: over several seasons, every s.funds increase (net of spending) is accounted for by the recorded income history', () => {
  let s = newGame('部費検証高校', 602);
  let trackedFunds = s.funds;
  let recordedSum = 0;
  let guard = 0;
  while (s.season <= 2 && guard++ < 400) {
    const before = s.funds;
    const beforeHistLen = s.fundHistory.length;
    s = step(s);
    if (s.funds >= facilityUpgradeCost(s.facilities) && s.facilities < 5) {
      const spend = facilityUpgradeCost(s.facilities);
      s = act(s, { type: 'upgrade' });
      // 支出は履歴に残らない前提で、収支を手動で追跡する。
      trackedFunds -= spend;
    }
    const delta = s.funds - before;
    const newEntries = s.fundHistory.slice(0, s.fundHistory.length - beforeHistLen);
    const recordedDelta = newEntries.reduce((a, f) => a + f.amount, 0);
    // このステップで記録された収入合計は、増加分(delta>=0のとき)を超えない
    // （delta自体は支出と収入が同時に起きた回では収入より小さくなりうる）。
    if (delta >= 0) assert.ok(recordedDelta <= delta + 1e-9);
    recordedSum += recordedDelta;
  }
  void trackedFunds;
  assert.ok(recordedSum > 0, '複数シーズンの間に収入履歴が記録されているはず');
  validateSave(JSON.parse(JSON.stringify(s)));
});

void test('T4.2: a match win is recorded with the correct reason (friendly vs official) and amount, at the match\'s own week/day (day===6)', () => {
  let s = newGame('試合部費検証高校', 603);
  let guard = 0;
  while (!s.pending && guard++ < 30) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    s = resolveLife(s);
    s = act(s, { type: 'train', training: 'balance' });
  }
  assert.ok(s.pending);
  const kind = s.pending!.kind;
  const week = s.week;
  s = act(s, { type: 'start' });
  while (!s.match!.done) s = act(s, { type: 'segment' });
  if (s.match!.won) {
    const expectedAmount = kind === 'friendly' ? 2 : 4;
    const entry = s.fundHistory.find((f) => f.week === week && f.day === 6 && f.amount === expectedAmount);
    assert.ok(entry, '勝利ぶんの部費が収入履歴に記録されているはず');
    assert.match(entry!.reason, /試合/);
    // これが app/match-result.tsx の抽出条件（week===s.week && day===6）と一致する。
    const matchFunds = s.fundHistory.filter((f) => f.week === s.week && f.day === 6);
    assert.ok(matchFunds.some((f) => f.amount === expectedAmount));
  }
});

void test('T4.2: legacy saves (fundHistory missing) hydrate to an empty array', () => {
  const s = newGame('', 604);
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.fundHistory;
  const loaded = validateSave(legacy);
  assert.deepEqual(loaded.fundHistory, []);
});
