import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame,
  act,
  validateSave,
  autoLineup,
  strength,
  LINEUP_POLICIES,
  type State,
  type Training,
  type Fixture,
  type LineupPolicy,
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
  moodLevel,
  moodMultiplier,
  MOOD_DEFAULT,
  MASTERY_THRESHOLD,
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
  // S4: 全選手が常にプレースタイルを1つ持つため（スキルと違い「無し」が無い）、
  // スキル未習得でも試合係数がちょうど1になるとは限らない（11人ぶんの小さな効果が
  // 複合するため）。検証の意図（スキル無しの基準値が常識的な範囲に収まる）は保ったまま、
  // スタイル由来の複合ぶんの許容幅を設ける。
  const baseFx = skillMatchFactors(newGame('', 1));
  assert.ok(Math.abs(baseFx.attack - 1) < 0.3, `baseline attack factor should stay in a sane range, got ${baseFx.attack}`);
  assert.ok(Math.abs(baseFx.finish - 1) < 0.3, `baseline finish factor should stay in a sane range, got ${baseFx.finish}`);
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

// S4: 10→15ポジション化に伴い、フォーメーションの「数字」は表記上の呼称であって
// 実際のbasePos内訳とは一致しない場合がある（例: 3-4-3のウイングバックは
// basePos上はDF）。検証の意図（11枠・GK1・全て有効なDetailPos・設計書どおりの
// 内訳）は保ちつつ、内訳はDESIGN_V3_2.md 5.1の明示リストに合わせて固定値で確認する。
void test('each formation exposes 11 DetailPos slots matching the documented basePos breakdown (DESIGN_V3_2.md 5.1), including the new 4-2-3-1', () => {
  const expected: Record<string, { GK: number; DF: number; MF: number; FW: number }> = {
    '4-3-3': { GK: 1, DF: 4, MF: 3, FW: 3 },
    '4-4-2': { GK: 1, DF: 4, MF: 4, FW: 2 },
    '3-4-3': { GK: 1, DF: 5, MF: 2, FW: 3 },
    '4-2-3-1': { GK: 1, DF: 4, MF: 5, FW: 1 },
  };
  for (const f of ['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'] as const) {
    const ds = formationSlots(f);
    assert.equal(ds.length, 11);
    assert.ok(ds.every((d) => (DETAIL_POS as readonly string[]).includes(d)));
    const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const d of ds) counts[basePos(d)]++;
    assert.deepEqual(counts, expected[f], `formation ${f} basePos breakdown mismatch`);
  }
});

// S4: positionFitMult は段階式(1.0/0.92/0.8/0.48)から、習熟度(0〜100)に基づく
// 連続的な倍率に置き換わった（目安: 100→1.00, 70→0.95, 50→0.90, 0→0.75）。
// 検証の意図（完全一致が最も高く、系統をまたぐほど不利、GKとの相互起用が最も
// 重いペナルティ）は保ったまま、新しい連続曲線で確認する。
void test('positionFitMult is continuous by proficiency: higher mastery always fits better, and GK<->outfield is capped at 0.5 regardless of mastery', () => {
  const cases: [DetailPos, DetailPos][] = [
    ['CB', 'LSB'],
    ['CM', 'DM'],
    ['LWG', 'RWG'],
  ];
  for (const [a, b] of cases) {
    assert.equal(positionFitMult({ detail: a, prof: { [a]: 100 } as Record<DetailPos, number> }, a), 1);
    // 習熟度が上がるほど、フィットは単調に上がる。
    const low = positionFitMult({ detail: a, prof: { [b]: 0 } as Record<DetailPos, number> }, b);
    const mid = positionFitMult({ detail: a, prof: { [b]: 50 } as Record<DetailPos, number> }, b);
    const high = positionFitMult({ detail: a, prof: { [b]: 100 } as Record<DetailPos, number> }, b);
    assert.ok(low < mid && mid < high && high === 1, `${a}->${b} fit should increase monotonically with mastery, got ${low},${mid},${high}`);
  }
  // GK⇔フィールドは習熟度が100でも×0.5に頭打ちする。
  const gkAtOutfield = positionFitMult({ detail: 'GK', prof: { CB: 100 } as Record<DetailPos, number> }, 'CB');
  assert.equal(gkAtOutfield, 0.5);
  const outfieldAtGK = positionFitMult({ detail: 'CB', prof: { GK: 100 } as Record<DetailPos, number> }, 'GK');
  assert.equal(outfieldAtGK, 0.5);
  // フォールバック（習熟度データが無い場合）でも、完全一致 > 同系統 > 系統またぎ > GK絡み、の順は保たれる。
  assert.equal(positionFitMult('CB', 'CB'), 1);
  const sameBase = positionFitMult('CB', 'LSB');
  const crossBase = positionFitMult('CB', 'CM');
  const gkCross = positionFitMult('GK', 'CB');
  assert.ok(sameBase < 1 && sameBase > crossBase, 'same-basePos fallback should beat cross-basePos fallback');
  assert.ok(gkCross < crossBase, 'GK<->outfield fallback should be the heaviest penalty');
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

// ---------------------------------------------------------------------------
// T2: 調子（5段階）
// ---------------------------------------------------------------------------
void test('T2: moodLevel/moodMultiplier boundaries match the documented 5 levels and multipliers', () => {
  assert.equal(moodLevel(100), 'excellent');
  assert.equal(moodLevel(80), 'excellent');
  assert.equal(moodLevel(79.9), 'good');
  assert.equal(moodLevel(60), 'good');
  assert.equal(moodLevel(59.9), 'normal');
  assert.equal(moodLevel(40), 'normal');
  assert.equal(moodLevel(39.9), 'poor');
  assert.equal(moodLevel(20), 'poor');
  assert.equal(moodLevel(19.9), 'bad');
  assert.equal(moodLevel(0), 'bad');
  assert.equal(moodMultiplier(90), 1.06);
  assert.equal(moodMultiplier(65), 1.03);
  assert.equal(moodMultiplier(MOOD_DEFAULT), 1.0);
  assert.equal(moodMultiplier(25), 0.97);
  assert.equal(moodMultiplier(5), 0.94);
});

void test('T2: every player has a required mood field from newGame, defaulting to "normal" (50)', () => {
  const s = newGame('調子検証高校', 8);
  for (const p of s.players) {
    const ps = s.v3.squad.players[p.id];
    assert.equal(typeof ps.mood, 'number');
    assert.equal(ps.mood, MOOD_DEFAULT);
    assert.equal(moodLevel(ps.mood), 'normal');
  }
});

void test('T2: mood drifts deterministically day to day (same seed/actions -> identical mood), and reacts to rest vs. hard training', () => {
  function run(seed: number) {
    let s = newGame('決定性検証高校', seed);
    s.week = 3;
    for (let i = 0; i < 12; i++) {
      if (s.event) s = act(s, { type: 'event', choice: 'team' });
      while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
      s = resolveLife(s);
      if (s.pending) break;
      s = act(s, { type: 'train', training: i % 2 === 0 ? 'physical' : 'rest' });
    }
    return s;
  }
  const a = run(555);
  const b = run(555);
  assert.deepEqual(
    Object.fromEntries(Object.entries(a.v3.squad.players).map(([id, ps]) => [id, ps.mood])),
    Object.fromEntries(Object.entries(b.v3.squad.players).map(([id, ps]) => [id, ps.mood])),
    'the same seed and action sequence must produce identical mood values',
  );
  for (const ps of Object.values(a.v3.squad.players)) assert.ok(ps.mood >= 0 && ps.mood <= 100);
});

void test('T2: legacy saves (mood field missing) migrate every player to "normal" (50), both when v3 is entirely absent and when only `mood` is missing', () => {
  const s = newGame('旧調子高校', 61);
  const noV3 = JSON.parse(JSON.stringify(s));
  delete noV3.v3;
  const loadedNoV3 = validateSave(noV3);
  for (const p of loadedNoV3.players)
    assert.equal(loadedNoV3.v3.squad.players[p.id].mood, MOOD_DEFAULT);

  const partial = JSON.parse(JSON.stringify(s));
  for (const id of Object.keys(partial.v3.squad.players)) delete partial.v3.squad.players[id].mood;
  const loadedPartial = validateSave(partial);
  for (const p of loadedPartial.players)
    assert.equal(loadedPartial.v3.squad.players[p.id].mood, MOOD_DEFAULT);
});

void test('T2: mood changes the effective ability used for team strength (excellent > normal > bad, same lineup and stats)', () => {
  const s = newGame('調子効果検証高校', 40);
  const base = strength(s);
  const better = JSON.parse(JSON.stringify(s)) as State;
  for (const id of better.lineup) better.v3.squad.players[id].mood = 95; // 絶好調
  const worse = JSON.parse(JSON.stringify(s)) as State;
  for (const id of worse.lineup) worse.v3.squad.players[id].mood = 5; // 絶不調
  assert.ok(strength(better) > base, 'excellent mood should raise team strength');
  assert.ok(strength(worse) < base, 'bad mood should lower team strength');
  assert.ok(strength(better) > strength(worse));
});

// ---------------------------------------------------------------------------
// T2: おまかせ編成の4方針
// ---------------------------------------------------------------------------
void test('T2: LINEUP_POLICIES exposes exactly the 4 documented policies', () => {
  assert.deepEqual([...LINEUP_POLICIES].sort(), ['fit', 'growth', 'mood', 'overall'].sort());
});

void test('T2: "fit" policy keeps every starter at or above the mastery threshold (60) for their slot, for a fresh roster in all 4 formations', () => {
  for (const seed of [2, 9, 40, 123]) {
    for (const f of ['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'] as const) {
      let s = newGame('適性重視検証高校', seed);
      s = act(s, { type: 'formation', formation: f });
      s = act(s, { type: 'autoLineupPolicy', policy: 'fit' });
      s = act(s, { type: 'auto' });
      const dslots = formationSlots(s.formation);
      s.lineup.forEach((id, i) => {
        const ps = s.v3.squad.players[id];
        assert.ok(
          ps.prof[dslots[i]] >= MASTERY_THRESHOLD,
          `seed ${seed} ${f} slot ${i} (${dslots[i]}): starter proficiency ${ps.prof[dslots[i]]} below ${MASTERY_THRESHOLD}`,
        );
      });
    }
  }
});

void test('T2: "mood" policy excludes a badly-out-of-form starter when a similar teammate in normal form is available', () => {
  let s = newGame('調子重視検証高校', 17);
  // 同じ枠(CBなど系統内で候補が複数いる枠)の先発の1人を絶不調にする。
  const dslots = formationSlots(s.formation);
  const cbIdx = dslots.findIndex((d) => d === 'CB');
  const targetId = s.lineup[cbIdx];
  s.v3.squad.players[targetId].mood = 2; // 絶不調
  s = act(s, { type: 'autoLineupPolicy', policy: 'mood' });
  s = act(s, { type: 'auto' });
  assert.ok(
    !s.lineup.includes(targetId),
    '絶不調の選手は、同枠に他候補がいれば調子重視の編成から外れるはず',
  );
});

void test('T2: "growth" policy favors younger players on average and only starts a GK with mastery (>=60) at GK', () => {
  function avgStarterYear(s: State, policy: LineupPolicy): number {
    let s2 = act(s, { type: 'autoLineupPolicy', policy });
    s2 = act(s2, { type: 'auto' });
    return s2.lineup.reduce((a, id) => a + s2.players.find((p) => p.id === id)!.year, 0) / 11;
  }
  let overallTotal = 0,
    growthTotal = 0;
  for (const seed of [3, 21, 58, 77, 140]) {
    const s = newGame('育成重視検証高校', seed);
    overallTotal += avgStarterYear(s, 'overall');
    growthTotal += avgStarterYear(s, 'growth');
    // GK制約: 育成重視でもGKは習熟度60以上の選手のみ起用する。
    let g = act(s, { type: 'autoLineupPolicy', policy: 'growth' });
    g = act(g, { type: 'auto' });
    const dslots = formationSlots(g.formation);
    const gkIdx = dslots.findIndex((d) => d === 'GK');
    const gkPs = g.v3.squad.players[g.lineup[gkIdx]];
    assert.ok(gkPs.prof['GK'] >= MASTERY_THRESHOLD, `seed ${seed}: growth policy started an unqualified GK`);
  }
  assert.ok(
    growthTotal < overallTotal,
    `growth policy should skew the starting XI younger on average: growth=${growthTotal} overall=${overallTotal}`,
  );
});

void test('T2: "auto" respects the currently selected policy stored on State, and "試合前に自動で編成する" applies it right before kickoff', () => {
  let s = newGame('自動適用検証高校', 5);
  s = act(s, { type: 'autoLineupPolicy', policy: 'fit' });
  assert.equal(s.autoLineupPolicy, 'fit');
  s = act(s, { type: 'auto' });
  const dslots = formationSlots(s.formation);
  s.lineup.forEach((id, i) => {
    assert.ok(s.v3.squad.players[id].prof[dslots[i]] >= MASTERY_THRESHOLD);
  });
  assert.equal(s.autoLineupOnMatch, false);
  // オンにすると、次の試合開始時に選んだ方針で自動編成される。手動でわざと
  // 崩した編成（習熟度の低い控えをスロット0に投入）でも、キックオフ時に
  // fit方針で編成し直されるはず。
  s = act(s, { type: 'autoLineupOnMatch', on: true });
  const bench = s.players.find(
    (p) => s.v3.squad.players[p.id].team === 'A' && !s.lineup.includes(p.id),
  )!;
  s = act(s, { type: 'swap', index: 0, id: bench.id });
  s.week = 3;
  s = toMatchDay(s, 'rest');
  s = act(s, { type: 'start' });
  const dslots2 = formationSlots(s.formation);
  s.match!.original.forEach((id, i) => {
    assert.ok(
      s.v3.squad.players[id].prof[dslots2[i]] >= MASTERY_THRESHOLD,
      '自動適用がキックオフ前に反映されているはず',
    );
  });
});

// ---------------------------------------------------------------------------
// T2: 初期ポジションのバランス（受け入れ条件）
// ---------------------------------------------------------------------------
void test('T2: a fresh 20-player roster has at least 2 candidates with proficiency >= 60 for every slot, in all 4 formations, across many seeds', () => {
  const formations = ['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'] as const;
  for (let seed = 1; seed <= 60; seed++) {
    const s = newGame('初期バランス検証高校', seed);
    const players = Object.values(s.v3.squad.players);
    for (const f of formations) {
      const slotSet = new Set(formationSlots(f));
      for (const slot of slotSet) {
        const count = players.filter((p) => p.prof[slot] >= MASTERY_THRESHOLD).length;
        assert.ok(
          count >= 2,
          `seed ${seed} formation ${f} slot ${slot}: only ${count} candidate(s) with proficiency >= ${MASTERY_THRESHOLD}`,
        );
      }
    }
  }
});

void test('T2: the fresh 20-player roster matches the documented composition (GK2/CB3/LSB1/RSB1/DM2/CM2/LSH1/RSH1/AM1/LWG1/RWG1/SS1/CF2 + 1 extra CB or CM)', () => {
  const s = newGame('内訳検証高校', 909);
  const counts: Partial<Record<DetailPos, number>> = {};
  for (const ps of Object.values(s.v3.squad.players)) counts[ps.detail] = (counts[ps.detail] ?? 0) + 1;
  const expectedMin: Partial<Record<DetailPos, number>> = {
    GK: 2,
    CB: 3,
    LSB: 1,
    RSB: 1,
    DM: 2,
    CM: 2,
    LSH: 1,
    RSH: 1,
    AM: 1,
    LWG: 1,
    RWG: 1,
    SS: 1,
    CF: 2,
  };
  for (const [d, min] of Object.entries(expectedMin))
    assert.ok((counts[d as DetailPos] ?? 0) >= min, `${d}: expected at least ${min}, got ${counts[d as DetailPos] ?? 0}`);
  assert.equal(Object.values(counts).reduce((a, n) => a + (n ?? 0), 0), 20);
});
