import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, coachActions, newGame, validateSave, type State } from '../lib/game.ts';
import { formationSlots } from '../lib/squad.ts';

function started(seed: number, cup = false): State {
  const s = newGame('進行検証高校', seed);
  s.day = 6;
  s.pending = { kind: cup ? 'summer' : 'friendly', round: 0, label: '検証試合', strength: 50, opponent: '架空高校', style: 'balanced' };
  return act(s, { type: 'start' });
}

void test('V4-3: automatic coaching uses manual commands and preserves growth, stats and seeded outcomes', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const initial = started(seed, true);
    let manual = structuredClone(initial);
    while (!manual.match!.done) {
      for (const command of coachActions(manual)) manual = act(manual, command);
      manual = act(manual, { type: 'segment' });
    }
    const auto = act(initial, { type: 'autoMatch' });
    assert.deepEqual(auto, manual);
    assert.deepEqual(act(validateSave(JSON.parse(JSON.stringify(initial))), { type: 'autoMatch' }), auto);
    validateSave(auto);
  }
});

void test('V4-3: highlights stop at the first shot or half boundary and match manual progress', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let manual = started(seed, true);
    let highlight = structuredClone(manual);
    while (!manual.match!.done) {
      do { manual = act(manual, { type: 'segment' }); }
      while (!manual.match!.done && !manual.match!.pk && !manual.match!.details.highlights.length && ![45, 90, 105, 120].includes(manual.match!.minute));
      highlight = act(highlight, { type: 'nextHighlight' });
      assert.deepEqual(highlight, manual);
    }
  }
});

void test('V4-3: coach respects proficiency, healthy bench, used players, substitution cap and score', () => {
  let s = started(42);
  s.match!.minute = 60;
  s.match!.away = 1;
  s.match!.subs = 4;
  for (const p of s.players) p.fatigue = s.lineup.includes(p.id) ? 85 : 0;
  const actions = coachActions(s);
  assert.deepEqual(actions[0], { type: 'mentality', mentality: 'attack' });
  const swaps = actions.filter((a) => a.type === 'swap');
  assert.equal(swaps.length, 1);
  for (const a of swaps) {
    assert.ok(s.v3.squad.players[a.id].prof[formationSlots(s.formation)[a.index]]! >= 50);
    s = act(s, a);
  }
  assert.equal(coachActions(s).filter((a) => a.type === 'swap').length, 0);
  s.match!.minute = 75;
  s.match!.home = 2;
  assert.deepEqual(coachActions(s), [{ type: 'mentality', mentality: 'safe' }]);
  s.match!.pk = { order: [], kicks: [] };
  assert.deepEqual(coachActions(s), []);
});

void test('V4-3: settings migrate off, reject malformed saves, and pre-match choices carry into kickoff', () => {
  const raw = JSON.parse(JSON.stringify(newGame()));
  delete raw.autoLeagueMatches;
  delete raw.matchPlan;
  assert.equal(validateSave(raw).autoLeagueMatches, false);
  assert.throws(() => validateSave({ ...raw, autoLeagueMatches: 'yes' }));
  let s = started(1);
  s.match = null;
  s = act(s, { type: 'matchPlan', tactic: 'counter', mentality: 'safe' });
  s = act(s, { type: 'start' });
  assert.equal(s.match!.tactic, 'counter');
  assert.equal(s.match!.mentality, 'safe');
});

void test('V4-3: automatic week finishes only league fixtures and leaves the result for review', () => {
  for (const auto of [false, true]) {
    let s = newGame('リーグ検証', 42);
    s.week = 3; s.day = 5;
    s = act(s, { type: 'autoLeagueMatches', on: auto });
    s = act(s, { type: 'autoWeek' });
    assert.equal(s.pending?.kind, 'league');
    assert.equal(!!s.match?.done, auto);
    assert.equal(s.week, 3);
  }
  let s = newGame('練習検証', 42);
  s.week = 2; s.day = 5;
  s = act(s, { type: 'autoLeagueMatches', on: true });
  s = act(s, { type: 'autoWeek' });
  assert.equal(s.pending?.kind, 'friendly');
  assert.equal(s.match, null);
});
