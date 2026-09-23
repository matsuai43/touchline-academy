import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame,
  act,
  validateSave,
  autoLineup,
  type State,
  type Training,
  type Fixture,
} from '../lib/game.ts';
import {
  basePos,
  DETAIL_POS,
  archetypes,
  SKILLS,
  grantSkill,
  grantMatchAchievements,
  skillMatchFactors,
  trainSquadSkills,
  formationSlots,
  positionFitMult,
  type DetailPos,
} from '../lib/squad.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';

// 学校生活イベント（W3）が出ている週は、解決するまで 'train' が進められない。
// テストは常に先頭の選択肢を選んで先へ進める。
function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}

// S1: 日次コマンド化により「1回のtrain操作=1週」の前提が崩れたため、
// 「1週間進める」ヘルパーに置き換える（月〜土の6日を同じ練習メニューで進める）。
function step(s: State, t: Training = 'balance') {
  const week0 = s.week;
  while (s.week === week0) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    s = resolveLife(s);
    s = act(s, { type: 'train', training: t });
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
    s = resolveLife(s);
    s = act(s, { type: 'train', training: t });
  }
  return s;
}

void test('fresh game gives every player a detailed position, archetype and extra stats consistent with their base position', () => {
  const s = newGame('検証高校', 3);
  assert.equal(Object.keys(s.v3.squad.players).length, 20);
  for (const p of s.players) {
    const ps = s.v3.squad.players[p.id];
    assert.ok(ps, `${p.id} に編成データがありません`);
    assert.ok((DETAIL_POS as readonly string[]).includes(ps.detail));
    assert.equal(basePos(ps.detail), p.pos);
    assert.ok(Object.hasOwn(archetypes, ps.archetype));
    for (const v of [ps.dribble, ps.stamina, ps.power])
      assert.ok(v >= 20 && v <= 99);
    assert.equal(ps.skills.length, 0);
    assert.equal(ps.negatives.length, 0);
  }
  assert.deepEqual(validateSave(JSON.parse(JSON.stringify(s))).v3, s.v3);
});

void test('legacy save without v3 data is migrated deterministically, preserving names/stats/year/records', () => {
  const s = newGame('旧世代高校', 77);
  const old = JSON.parse(JSON.stringify(s));
  delete old.v3;
  const loaded = validateSave(old);
  assert.equal(Object.keys(loaded.v3.squad.players).length, 20);
  assert.deepEqual(
    loaded.players.map((p) => [p.name, p.stats, p.year, p.goals, p.appearances]),
    s.players.map((p) => [p.name, p.stats, p.year, p.goals, p.appearances]),
  );
  // deterministic: hydrating the same original state twice gives the same squad data
  const old2 = JSON.parse(JSON.stringify(s));
  delete old2.v3;
  const loaded2 = validateSave(old2);
  assert.deepEqual(loaded2.v3, loaded.v3);
});

void test('A/B team assignment is automatic by overall and respects a manual override with a 20-player A cap', () => {
  let s = newGame('編成高校', 5);
  const aCount = Object.values(s.v3.squad.players).filter((p) => p.team === 'A').length;
  assert.equal(aCount, s.players.length); // 18 players, all fit under the cap of 20
  const someone = s.players[0].id;
  s = act(s, { type: 'squadTeam', id: someone, team: 'B' });
  assert.equal(s.v3.squad.players[someone].team, 'B');
  assert.equal(s.v3.squad.players[someone].teamManual, true);
  // auto-reassignment (e.g. from training) must not override the manual choice
  s = step(s, 'rest');
  assert.equal(s.v3.squad.players[someone].team, 'B');
  s = act(s, { type: 'squadAuto' });
  assert.equal(s.v3.squad.players[someone].teamManual, false);
});

void test('grantSkill enforces the 5 positive / 2 negative caps and records a feed message; caller API used by other modules', () => {
  const s = newGame('スキル高校', 9);
  const id = s.players[0].id;
  const positives = Object.values(SKILLS)
    .filter((sk) => !sk.negative)
    .map((sk) => sk.id);
  assert.ok(positives.length >= 5);
  let ok = true;
  for (let i = 0; i < 5; i++) ok = grantSkill(s, id, positives[i]) && ok;
  assert.ok(ok);
  assert.equal(s.v3.squad.players[id].skills.length, 5);
  assert.equal(grantSkill(s, id, positives[5]), false);
  const negatives = Object.values(SKILLS)
    .filter((sk) => sk.negative)
    .map((sk) => sk.id);
  assert.ok(negatives.length >= 2);
  assert.ok(grantSkill(s, id, negatives[0]));
  assert.ok(grantSkill(s, id, negatives[1]));
  assert.equal(grantSkill(s, id, negatives[1]), false); // already has it
  assert.match(s.feed[0], /習得|表れ/);
  validateSave(s);
});

void test('skills change skillMatchFactors and produce a real, measurable difference in match outcomes for the same seed', () => {
  const attackers = [
    'dribble_break',
    'killer_pass',
    'long_shot',
    'header',
    'poacher',
  ];
  function playSeason(boost: boolean, seed: number) {
    let s = newGame('効果検証高校', seed);
    if (boost) {
      const forwards = s.players.filter((p) => p.pos === 'FW' || p.pos === 'MF');
      for (const p of forwards.slice(0, 3))
        for (const sk of attackers) grantSkill(s, p.id, sk);
    }
    s.week = 3;
    s = toMatchDay(s, 'rest');
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    return s.match!.home;
  }
  const baseFx = skillMatchFactors(newGame('', 1));
  assert.equal(baseFx.attack, 1);
  assert.equal(baseFx.finish, 1);
  let baselineGoals = 0,
    boostedGoals = 0;
  for (let seed = 1; seed <= 25; seed++) {
    baselineGoals += playSeason(false, seed);
    boostedGoals += playSeason(true, seed);
  }
  assert.ok(
    boostedGoals > baselineGoals,
    `boosted attackers should score more across seeds: ${boostedGoals} vs ${baselineGoals}`,
  );
});

void test('training a matching menu for several weeks can unlock a category-appropriate skill deterministically', () => {
  let s = newGame('育成高校', 21);
  let gained = false;
  for (let i = 0; i < 40 && !gained; i++) {
    s = step(s, 'attack');
    gained = s.players.some((p) =>
      s.v3.squad.players[p.id].skills.some((id) => SKILLS[id].category === '攻撃'),
    );
  }
  assert.ok(gained, 'attack-focused training should eventually unlock an attacking skill');
  validateSave(s);
});

void test('direct trainSquadSkills call tracks a training streak and stays within the 5-skill cap', () => {
  const s = newGame('継続高校', 44);
  const id = s.players[0].id;
  for (let i = 0; i < 30; i++) trainSquadSkills(s, 'physical');
  const ps = s.v3.squad.players[id];
  assert.ok(ps.streakCount >= 3);
  assert.ok(ps.skills.length <= 5);
  for (const skId of ps.skills) assert.equal(SKILLS[skId].category, '身体');
});

void test('match achievements (hat-trick) can grant a skill through grantMatchAchievements', () => {
  let granted = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = newGame('達成高校', seed);
    const scorer = s.players.find((p) => p.pos === 'FW')!;
    s.match = {
      details: {
        commands: { lane: 'mixed', tempo: 'normal', line: 'normal', player: null, role: 'free' },
        highlights: [0, 1, 2].map((i) => ({
          id: `h${i}`,
          minute: 10 + i * 10,
          kind: 'goal' as const,
          side: 0 as const,
          playerId: scorer.id,
          name: scorer.name,
          lane: 'mixed' as const,
        })),
        moment: null,
      },
      fixture: {
        label: '練習試合',
        kind: 'friendly',
        round: 0,
        strength: 50,
        opponent: '対戦校',
        style: 'balanced',
      } satisfies Fixture,
      minute: 90,
      home: 3,
      away: 0,
      shots: [5, 2],
      xg: [2, 1],
      logs: [],
      tactic: 'balanced',
      mentality: 'normal',
      subs: 0,
      used: s.lineup,
      original: s.lineup,
      done: true,
      won: true,
      penalties: null,
      possession: 55,
      lastSide: 0,
    };
    const before = s.v3.squad.players[scorer.id].skills.length;
    grantMatchAchievements(s);
    if (s.v3.squad.players[scorer.id].skills.length > before) granted++;
  }
  assert.ok(granted > 0, 'hat-trick achievements should grant a skill in at least some of the trials');
});

void test('each formation exposes 11 DetailPos slots whose basePos matches the legacy 4/4/2-style Position layout', () => {
  for (const f of ['4-3-3', '4-4-2', '3-4-3'] as const) {
    const ds = formationSlots(f);
    assert.equal(ds.length, 11);
    assert.ok(ds.every((d) => (DETAIL_POS as readonly string[]).includes(d)));
    assert.equal(ds.filter((d) => basePos(d) === 'GK').length, 1);
    assert.equal(ds.filter((d) => basePos(d) === 'DF').length, +f[0]);
    assert.equal(ds.filter((d) => basePos(d) === 'MF').length, +f[2]);
    assert.equal(ds.filter((d) => basePos(d) === 'FW').length, +f[4]);
  }
});

void test('positionFitMult is staged: exact match beats a same-basePos mismatch, which beats crossing basePos, and GK crossovers are penalized most', () => {
  const cases: [DetailPos, DetailPos][] = [
    ['CB', 'LSB'],
    ['CM', 'DM'],
    ['LWG', 'RWG'],
  ];
  for (const [a, b] of cases) {
    assert.equal(positionFitMult(a, a), 1);
    const sameBase = positionFitMult(a, b);
    assert.ok(sameBase < 1 && sameBase >= 0.9, `${a}->${b} should be a mild penalty, got ${sameBase}`);
    const crossBase = positionFitMult('CB', 'CM');
    assert.ok(crossBase < sameBase, 'crossing basePos should be penalized more than staying within it');
    const gkCross = positionFitMult('GK', 'CB');
    assert.ok(gkCross < crossBase, 'GK<->outfield should be the heaviest penalty');
  }
});

void test('10 seasons of play keep squad data valid, capped at 99, and A team never exceeds 20', () => {
  let s = newGame('通し高校', 303);
  let actions = 0;
  let sawGrowth = false;
  while (s.season <= 10) {
    const f = s.players.reduce((a, p) => a + p.fatigue, 0) / s.players.length;
    s = step(s, f > 35 ? 'rest' : s.week % 3 === 0 ? 'possession' : 'attack');
    autoLineup(s);
    validateSave(JSON.parse(JSON.stringify(s)));
    for (const ps of Object.values(s.v3.squad.players)) {
      assert.ok(ps.dribble <= 99 && ps.stamina <= 99 && ps.power <= 99);
      assert.ok(ps.skills.length <= 5 && ps.negatives.length <= 2);
    }
    assert.equal(Object.keys(s.v3.squad.players).length, s.players.length);
    if (s.players.length > 18) sawGrowth = true;
    const aCount = Object.values(s.v3.squad.players).filter((p) => p.team === 'A').length;
    const bCount = Object.values(s.v3.squad.players).filter((p) => p.team === 'B').length;
    assert.ok(aCount <= 20);
    assert.equal(aCount + bCount, s.players.length);
    actions++;
    assert.ok(actions < 600);
  }
  assert.ok(sawGrowth, 'roster should grow past the initial 18 at some point over 10 seasons');
});
