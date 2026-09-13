import {
  newGame,
  act,
  validateSave,
  type State,
  type Training,
} from '../lib/game.ts';
import { commandFactors } from '../lib/development.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const start = () => {
  let s = newGame('未来学園', 2026);
  s.week = 3;
  s = act(s, { type: 'train', training: 'rest' });
  return act(s, { type: 'start' });
};
function next(s: State, t: Training = 'rest') {
  if (s.event) s = act(s, { type: 'event', choice: 'team' });
  s = act(s, { type: 'train', training: t });
  if (s.pending) {
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    s = act(s, { type: 'finish' });
  }
  return s;
}

void test('v1 saves migrate without changing players, RNG, score, or schedule', () => {
  const s = start(),
    old = JSON.parse(JSON.stringify(s));
  delete old.development;
  delete old.match.details;
  old.players.forEach((p: {identity?:unknown}) => delete p.identity);
  const loaded = validateSave(old);
  assert.equal(loaded.seed, s.seed);
  assert.equal(loaded.week, s.week);
  assert.equal(loaded.match!.home, s.match!.home);
  assert.deepEqual(
    loaded.players.map((p) => [p.name, p.stats]),
    s.players.map((p) => [p.name, p.stats]),
  );
  assert.equal(loaded.development.candidates.length, 20);
  assert.equal(
    new Set(loaded.players.map((p) => p.identity.portrait)).size,
    18,
  );
  assert.deepEqual(validateSave(loaded), loaded);
});
void test('half-year policy grows matching skills, locks, rewards once and resets at 24 weeks', () => {
  const base = newGame('', 42);
  const planned = act(base, { type: 'plan', plan: 'technique' });
  assert.throws(() => act(planned, { type: 'plan', plan: 'attack' }));
  const a = act(base, { type: 'train', training: 'possession' }),
    b = act(planned, { type: 'train', training: 'possession' });
  assert.ok(
    Math.abs(
      (b.players[0].stats.pass - base.players[0].stats.pass) /
        (a.players[0].stats.pass - base.players[0].stats.pass) -
        1.25,
    ) < 0.001,
  );
  let s = planned;
  for (let i = 0; i < 8; i++) s = next(s, 'possession');
  assert.equal(s.development.rewarded, true);
  assert.ok(s.development.progress >= 8);
  while (s.week < 24) s = next(s);
  assert.equal(s.development.plan, null);
  assert.equal(s.development.progress, 0);
  assert.match(s.development.archive[0], /つないで崩す/);
  s = act(s, { type: 'plan', plan: 'defense' });
  assert.equal(s.development.plan, 'defense');
});
void test('manager care applies once per training week, selection never grants rewards', () => {
  let s = newGame('', 51);
  s = act(s, { type: 'manager', manager: 0 });
  s = act(s, { type: 'support', support: 'care' });
  const f = s.players[0].fatigue;
  for (let i = 0; i < 5; i++) s = act(s, { type: 'manager', manager: i % 4 });
  assert.equal(s.players[0].fatigue, f);
  const trained = act(s, { type: 'train', training: 'balance' });
  assert.equal(trained.players[0].fatigue, f + 7 - 4);
  const before = trained.morale;
  const changed = act(trained, { type: 'support', support: 'cheer' });
  assert.equal(changed.morale, before);
});
void test('scouts enforce reputation, information, weekly budgets, offers and spring entry', () => {
  let s = newGame('', 92);
  s.funds = 500;
  const foreign = s.development.candidates.find(
    (c) => c.origin === 'exchange',
  )!;
  assert.throws(() =>
    act(s, { type: 'scout', id: foreign.id, mode: 'observe' }),
  );
  const c = s.development.candidates.find(
    (c) => c.pos === 'GK' && c.origin === 'local',
  )!;
  assert.throws(() => act(s, { type: 'scout', id: c.id, mode: 'offer' }));
  s = act(s, { type: 'scout', id: c.id, mode: 'observe' });
  assert.throws(() => act(s, { type: 'scout', id: c.id, mode: 'visit' }));
  for (let i = 0; i < 3; i++) {
    s = next(s);
    s = act(s, { type: 'scout', id: c.id, mode: 'visit' });
  }
  s = next(s);
  s = act(s, { type: 'scout', id: c.id, mode: 'offer' });
  assert.ok(s.development.candidates.find((p) => p.id === c.id)!.promised);
  assert.throws(() => act(s, { type: 'scout', id: c.id, mode: 'offer' }));
  while (s.season === 1) s = next(s);
  const recruit = s.players.find((p) => p.name === c.name)!;
  assert.ok(recruit);
  assert.equal(recruit.year, 1);
  assert.equal(recruit.pos, c.pos);
  assert.equal(recruit.identity.portrait, c.portrait);
  assert.equal(s.players.length, 18);
  assert.equal(s.development.intake.length, 1);
  assert.ok(!s.development.candidates.some((p) => p.promised));
  validateSave(s);
});
void test('voice reacts to observed action, improves skill and memories, and cannot be farmed', () => {
  let s = act(start(), { type: 'segment' });
  const e = s.match!.details.moment!,
    p = s.players.find((p) => p.id === e.playerId)!;
  e.kind = 'challenge';
  const skill = p.stats.shoot;
  const trusted = p.identity.trust;
  s = act(s, { type: 'voice', voice: 'praise' });
  const changed = s.players.find((x) => x.id === p.id)!;
  assert.ok(changed.stats.shoot > skill);
  assert.equal(changed.identity.trust, trusted + 3);
  assert.equal(changed.identity.memories.length, 1);
  assert.throws(() => act(s, { type: 'voice', voice: 'praise' }));
  const restored = validateSave(JSON.parse(JSON.stringify(s)));
  assert.throws(() => act(restored, { type: 'voice', voice: 'correct' }));
  s = act(s, { type: 'segment' });
  const other = s.players.find(
    (p) => p.id === s.match!.details.moment!.playerId,
  )!;
  s.match!.details.moment!.kind = 'tired';
  other.identity.personality = 'sensitive';
  const before = other.identity.trust;
  s = act(s, { type: 'voice', voice: 'correct' });
  assert.equal(
    s.players.find((p) => p.id === other.id)!.identity.trust,
    before - 6,
  );
});
void test('detailed commands have measurable tradeoffs and survive a save roundtrip', () => {
  let s = start();
  const base = commandFactors(s);
  s = act(s, { type: 'command', field: 'tempo', value: 'quick' });
  assert.ok(commandFactors(s).attack > base.attack);
  assert.ok(commandFactors(s).fatigue > base.fatigue);
  s = act(s, { type: 'command', field: 'line', value: 'high' });
  s = act(s, { type: 'command', field: 'player', value: s.lineup[9] });
  s = act(s, { type: 'command', field: 'role', value: 'cover' });
  assert.deepEqual(
    validateSave(s).match!.details.commands,
    s.match!.details.commands,
  );
  assert.throws(() =>
    act(s, { type: 'command', field: 'tempo', value: 'invalid' }),
  );
});
void test('every animated goal matches a real scoreboard increment', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = start();
    s.seed = seed;
    for (let i = 0; i < 6; i++) {
      const before = [s.match!.home, s.match!.away];
      s = act(s, { type: 'segment' });
      const h = s.match!.details.highlights;
      for (const side of [0, 1])
        assert.equal(
          h.filter((x) => x.kind === 'goal' && x.side === side).length,
          (side === 0 ? s.match!.home : s.match!.away) - before[side],
        );
      assert.ok(
        h.every(
          (x) => x.minute > s.match!.minute - 15 && x.minute <= s.match!.minute,
        ),
      );
      for (let j = 1; j < h.length; j++)
        assert.ok(h[j].minute >= h[j - 1].minute);
      validateSave(s);
    }
  }
});
void test('malformed additions are rejected without changing the original save', () => {
  const s = newGame('', 2);
  for (const alter of [
    (x: State) => (x.players[0].identity.portrait = 100),
    (x: State) => (x.development.manager = 999),
    (x: State) => (x.development.candidates[0].potential = Infinity),
    (x: State) =>
      (x.development.candidates[1].id = x.development.candidates[0].id),
  ]) {
    const bad = structuredClone(s);
    alter(bad);
    assert.throws(() => validateSave(bad));
  }
  assert.equal(s.players[0].identity.portrait, 0);
});
void test('all v2 systems coexist over three years', () => {
  let s = newGame('', 71);
  s = act(s, { type: 'manager', manager: 2 });
  s = act(s, { type: 'support', support: 'analysis' });
  let guard = 0;
  while (s.season <= 3) {
    if (!s.development.plan) s = act(s, { type: 'plan', plan: 'technique' });
    s = next(s, s.players[0].fatigue > 35 ? 'rest' : 'possession');
    validateSave(s);
    assert.ok(++guard < 160);
  }
  assert.equal(s.history.length, 3);
  assert.equal(s.development.archive.length, 6);
});
