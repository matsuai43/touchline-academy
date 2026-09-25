import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, newGame, validateSave, type State } from '../lib/game.ts';
import { ownTeamTotals } from '../lib/match-stats.ts';
import { matchRatings } from '../lib/match-rating.ts';
import { simulateCupMatch, simulateCupRegulation } from '../lib/competition.ts';

function cup(seed: number): State {
  let s = newGame('延長検証高校', seed);
  s.day = 6;
  s.pending = { label: '県予選', kind: 'summer', round: 0, strength: 50, opponent: '架空高校', style: 'balanced' };
  s = act(s, { type: 'start' });
  return s;
}
function to90(seed: number): State {
  let s = cup(seed);
  for (let i = 0; i < 6; i++) s = act(s, { type: 'segment' });
  assert.equal(s.match!.minute, 90);
  assert.equal(s.match!.done, false);
  return s;
}
function toShootout(seed: number): State {
  let s = to90(seed);
  for (let i = 0; i < 2; i++) s = act(s, { type: 'segment' });
  assert.equal(s.match!.minute, 120);
  assert.ok(s.match!.pk);
  return s;
}

void test('T-10: tied cup match plays two extra-time halves and can be decided at 120 minutes', () => {
  let s = to90(3);
  const fatigueAt90 = s.players.find((p) => p.id === s.lineup[1])!.fatigue;
  s = act(s, { type: 'tactic', tactic: 'press' });
  s = act(s, { type: 'segment' });
  assert.equal(s.match!.minute, 105);
  assert.equal(s.match!.done, false);
  assert.ok(s.players.find((p) => p.id === s.lineup[1])!.fatigue > fatigueAt90);
  s = act(s, { type: 'segment' });
  assert.equal(s.match!.minute, 120);
  assert.equal(s.match!.done, true);
  assert.equal(s.match!.pk, undefined);
  assert.notEqual(s.match!.home, s.match!.away);
  const totals = ownTeamTotals(s.match!);
  assert.equal(totals.shots, s.match!.shots[0]);
  assert.equal(totals.goals, s.match!.home);
  assert.equal(s.match!.opponentTotals!.shots, s.match!.shots[1]);
  validateSave(JSON.parse(JSON.stringify(s)));
});

void test('T-10: chosen kickers, one-kick progress and resume from a saved shootout are deterministic', () => {
  let s = toShootout(5);
  const chosen = [s.lineup[9], s.lineup[8], s.lineup[7], s.lineup[6], s.lineup[5]];
  s = act(s, { type: 'pkOrder', ids: chosen });
  const saved = validateSave(JSON.parse(JSON.stringify(s)));
  s = act(s, { type: 'segment' });
  assert.equal(s.match!.minute, 120);
  assert.equal(s.match!.pk!.kicks.length, 1);
  assert.equal(s.match!.pk!.kicks[0].kickerId, chosen[0]);
  assert.equal(s.match!.penalties, null);
  assert.deepEqual(act(saved, { type: 'segment' }), s);
  assert.throws(() => act(s, { type: 'pkOrder', ids: chosen.slice().reverse() }));
  while (!s.match!.done) {
    s = act(s, { type: 'segment' });
    validateSave(JSON.parse(JSON.stringify(s)));
  }
  const kicks = s.match!.pk!.kicks;
  assert.ok(kicks.length >= 6 && kicks.length <= 22);
  const ownGoals = kicks.filter((kick) => kick.side === 0 && kick.scored).length;
  const rivalGoals = kicks.filter((kick) => kick.side === 1 && kick.scored).length;
  assert.equal(s.match!.penalties, `${ownGoals} - ${rivalGoals}`);
  assert.equal(s.match!.won, ownGoals > rivalGoals);
  assert.equal(ownTeamTotals(s.match!).goals, s.match!.home, 'PK goals stay separate from open-play goals');
});

void test('T-10: sudden death waits for both teams and legacy 90-minute PK saves still load', () => {
  const selected = toShootout(38);
  const fullOrder = [...selected.lineup].reverse();
  assert.deepEqual(act(selected, { type: 'pkOrder', ids: fullOrder }).match!.pk!.order, fullOrder);
  let s = toShootout(38);
  while (!s.match!.done) s = act(s, { type: 'segment' });
  assert.ok(s.match!.pk!.kicks.length > 10);
  assert.equal(s.match!.pk!.kicks.length % 2, 0, 'both sides must take a sudden-death kick');
  assert.notEqual(s.match!.penalties, '5 - 4');

  const old = to90(5);
  old.match!.done = true;
  old.match!.won = true;
  old.match!.penalties = '5 - 4';
  const loaded = validateSave(JSON.parse(JSON.stringify(old)));
  assert.equal(loaded.match!.penalties, '5 - 4');
  assert.equal(loaded.match!.pk, undefined);
});

void test('T-10: scored and saved penalties affect ratings and specialist learning', () => {
  let s = toShootout(5);
  const keeperId = s.lineup[0];
  const oldKeeperSkills = [...s.v3.squad.players[keeperId].skills];
  while (!s.match!.done) s = act(s, { type: 'segment' });
  const scorer = s.match!.pk!.kicks.find((kick) => kick.side === 0 && kick.scored)!.kickerId!;
  const withPk = matchRatings(s);
  const withoutPk = structuredClone(s);
  delete withoutPk.match!.pk;
  const base = matchRatings(withoutPk);
  assert.ok(withPk.find((row) => row.id === scorer)!.rating > base.find((row) => row.id === scorer)!.rating);
  assert.ok(s.match!.pk!.kicks.some((kick) => kick.side === 1 && kick.saved));
  assert.ok(withPk.find((row) => row.id === keeperId)!.rating > base.find((row) => row.id === keeperId)!.rating);
  assert.ok(!oldKeeperSkills.includes('pk_stopper'));
  assert.ok(s.v3.squad.players[keeperId].skills.includes('pk_stopper'));
  assert.ok(s.match!.pk!.kicks.some((kick) => kick.side === 0 && kick.scored &&
    s.v3.squad.players[kick.kickerId!].skills.includes('pk_killer')));
});

void test('T-10: rival cup ties play extra time and record actual shootout scores', () => {
  const a = { id: 'a', name: '架空A高校', strength: 60, style: 'balanced' as const, districtId: 'yamagata' };
  const b = { id: 'b', name: '架空B高校', strength: 60, style: 'balanced' as const, districtId: 'yamagata' };
  let extraDecisions = 0;
  const shootoutScores = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const s = newGame('他校検証高校', seed);
    const regulation = simulateCupRegulation(s, 'ih', false, 0, 1, a, b);
    if (regulation.home !== regulation.away) continue;
    const result = simulateCupMatch(s, 'ih', false, 0, 1, a, b);
    assert.deepEqual(result, simulateCupMatch(s, 'ih', false, 0, 1, a, b));
    if (result.home !== result.away) {
      extraDecisions++;
      assert.equal(result.penalties, null);
    } else {
      assert.ok(result.penalties);
      shootoutScores.add(result.penalties);
      const [own, rival] = result.penalties!.split(' - ').map(Number);
      assert.equal(result.winnerId, own > rival ? a.id : b.id);
    }
  }
  assert.ok(extraDecisions > 0);
  assert.ok(shootoutScores.size > 2, `shootout scores: ${[...shootoutScores].join(', ')}`);
  assert.ok([...shootoutScores].some((score) => score !== '5 - 4' && score !== '4 - 5'));
});
