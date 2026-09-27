import {
  newGame,
  act,
  validateSave,
  ROSTER_MIN,
  ROSTER_MAX,
  type State,
  type Training,
} from '../lib/game.ts';
import { commandFactors } from '../lib/development.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
// 学校生活イベント（W3）が出ている週は、解決するまで 'train' が進められない。
// テストは常に先頭の選択肢を選んで先へ進める。
function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
// S1: 日次コマンド化により「1回のtrain操作=1週」の前提が崩れたため、
// 「1週間進める」ヘルパーに置き換える（月〜土の6日を同じ練習メニューで進める）。
function next(s: State, t: Training = 'rest') {
  const week0 = s.week;
  while (s.week === week0) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    s = resolveLife(s);
    if (!s.pending) s = act(s, { type: 'train', training: t });
    if (s.pending) {
      s = act(s, { type: 'start' });
      while (!s.match!.done) s = act(s, { type: 'segment' });
      s = act(s, { type: 'finish' });
    }
  }
  return s;
}
// 特定の週(試合が確実にある週)の試合日まで、同じメニューで日次コマンドを進める。
function toMatchDay(s: State, t: Training = 'rest') {
  let guard = 0;
  while (!s.pending && guard++ < 20) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    s = resolveLife(s);
    if (!s.pending) s = act(s, { type: 'train', training: t });
  }
  return s;
}
const start = () => {
  let s = newGame('未来学園', 2026);
  s.week = 3;
  s = toMatchDay(s, 'rest');
  return act(s, { type: 'start' });
};

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
  // T3-1: 目標は「対象メニューで練習した日数」＝30日（plans.technique.goal）。
  assert.ok(s.development.progress >= 30);
  while (s.week < 24) s = next(s);
  assert.equal(s.development.plan, null);
  assert.equal(s.development.progress, 0);
  assert.match(s.development.archive[0], /つないで崩す/);
  s = act(s, { type: 'plan', plan: 'defense' });
  assert.equal(s.development.plan, 'defense');
});
// T3-1: 半年方針の進捗は「週」ではなく「練習日数」で数える。対象メニューを24週の中で
// 30日実施すると、その日のうちに（達成8週目を待たず）目標達成する。
void test('T3-1: half-year progress counts practice days, not weeks, and rewards exactly once at the 30th day', () => {
  let s = act(newGame('', 7), { type: 'plan', plan: 'attack' });
  assert.equal(s.development.progress, 0);
  assert.equal(s.development.rewarded, false);
  const fundsBefore = s.funds;
  const rewardEntry = () => s.fundHistory.find((f) => f.reason === '半年目標');
  // 5週×6日('attack')=30日でちょうど目標に届く（'attack'は半年方針attackのmenus）。
  for (let w = 0; w < 5; w++) s = next(s, 'attack');
  assert.equal(s.development.progress, 30);
  assert.equal(s.development.rewarded, true);
  assert.ok(s.funds >= fundsBefore + 20, '半年目標の部費+20が反映されているはず');
  assert.ok(rewardEntry(), '部費の収入履歴に「半年目標」が記録されているはず');
  assert.equal(rewardEntry()!.amount, 20);
  const rewardedAt = s.development.progress;
  // さらに練習しても報酬は1回だけ（progressは伸び続けてよいが、達成報酬は増えない）。
  s = next(s, 'attack');
  assert.ok(s.development.progress > rewardedAt);
  assert.equal(s.development.rewarded, true);
  assert.equal(s.fundHistory.filter((f) => f.reason === '半年目標').length, 1);
});
// T3-1: 旧セーブ（schema 2、進捗が「週」単位）は、進捗を×4で日数換算して引き継ぐ（上限30）。
void test('T3-1: legacy week-based progress migrates to day-based progress (x4, capped at 30)', () => {
  const s = act(newGame('', 8), { type: 'plan', plan: 'defense' });
  const legacy = structuredClone(s) as unknown as {
    development: { schema: number; progress: number };
  };
  legacy.development.schema = 2;
  legacy.development.progress = 5; // 旧仕様: 5週ぶん実施済み -> 5*4=20日
  const migrated = validateSave(legacy as unknown as State);
  assert.equal(migrated.development.progress, 20);
  assert.equal(migrated.development.schema, 3);
  // 上限30（旧8週=満了扱いでも30に丸める）。
  legacy.development.progress = 8;
  const migratedCapped = validateSave(legacy as unknown as State);
  assert.equal(migratedCapped.development.progress, 30);
});
void test('manager care applies once per week at week-end (day===6 gate, not the Monday-only bug), selection never grants rewards', () => {
  let s = newGame('', 51);
  s.players.forEach((p) => (p.fatigue = 50)); // 0クランプに当たらないよう余裕を持たせる
  s = act(s, { type: 'manager', manager: 0 });
  s = act(s, { type: 'support', support: 'care' });
  const f = s.players[0].fatigue;
  for (let i = 0; i < 5; i++) s = act(s, { type: 'manager', manager: i % 4 });
  assert.equal(s.players[0].fatigue, f);
  // 回帰修正: developmentWeek（マネージャーの週次サポートもここで適用）は、
  // 「月曜(day===0)の練習内容だけ」ではなく、週の練習日(月〜土)が終わる時点
  // (day が6に達した時)に週1回だけ呼ばれる。月〜金(5日)はまだ適用されない。
  assert.equal(s.day, 0);
  let cur = s;
  for (let i = 0; i < 5; i++) {
    if (cur.event) cur = act(cur, { type: 'event', choice: 'team' });
    cur = resolveLife(cur);
    cur = act(cur, { type: 'train', training: 'balance' });
  }
  assert.equal(cur.day, 5);
  // V4-1(5.2): 回復が疲労に比例するようになったため（練習日の回復は
  // 2.35+疲労×0.038、lib/game.ts の advanceTrainingDay 参照）、単純な
  // 「1日あたり固定-3」の式では期待値が出せない。同じ漸化式をここでも
  // 1日ずつ辿って期待値を作る（ケアの週次-4はこの漸化式に含めず、別途引く）。
  let expected = f;
  for (let i = 0; i < 5; i++) expected += 7 / 6 - (2.35 + expected * 0.038);
  assert.ok(
    Math.abs(cur.players[0].fatigue - expected) < 1e-9,
    '月〜金はまだケアの-4が適用されていないはず',
  );
  if (cur.event) cur = act(cur, { type: 'event', choice: 'team' });
  cur = resolveLife(cur);
  const trained = act(cur, { type: 'train', training: 'balance' });
  assert.equal(trained.day, 6);
  expected += 7 / 6 - (2.35 + expected * 0.038);
  expected -= 4;
  assert.ok(
    Math.abs(trained.players[0].fatigue - expected) < 1e-9,
    '週の練習日が終わる土曜の時点でケアの-4が1回だけ適用されるはず',
  );
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
  assert.ok(s.players.length >= ROSTER_MIN && s.players.length <= ROSTER_MAX);
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
