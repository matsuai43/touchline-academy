import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame,
  act,
  type State,
  type Training,
  type Stat,
  type Fixture,
} from '../lib/game.ts';
import {
  LIFE_EVENTS,
  LIFE_EVENTS_BY_ID,
  LIFE_CATEGORIES,
  LIFE_EVENT_CHANCE,
  hydrateLife,
  readLifeState,
  validateLife,
  defaultLifeState,
  getCurrentLifeEvent,
  maybeTriggerLifeEvent,
  handleLife,
  type LifeCategory,
} from '../lib/school-life.ts';

// school-life.ts は単体で完結するモジュールなので、このテストでは
// lib/v3.ts / lib/game.ts の act() にまだ配線されていない前提で、
// hydrateLife / maybeTriggerLifeEvent / handleLife を直接呼び出して検証する。
// （統括側が配線した後は、これらは週の進行フックの中から自動的に呼ばれる想定。）

void test('30〜40種のイベントが定義され、各イベントは2〜3個の選択肢を持つ', () => {
  assert.ok(LIFE_EVENTS.length >= 30 && LIFE_EVENTS.length <= 40, `イベント数: ${LIFE_EVENTS.length}`);
  const ids = new Set(LIFE_EVENTS.map((e) => e.id));
  assert.equal(ids.size, LIFE_EVENTS.length, 'イベントIDが重複しています');
  for (const e of LIFE_EVENTS) {
    assert.ok(e.choices.length >= 2 && e.choices.length <= 3, `${e.id} の選択肢数が範囲外`);
    const choiceIds = new Set(e.choices.map((c) => c.id));
    assert.equal(choiceIds.size, e.choices.length, `${e.id} 内で選択肢IDが重複`);
    assert.ok(e.prompt('テスト太郎').includes('テスト太郎'));
    for (const c of e.choices) assert.ok(c.resultText('テスト太郎').length > 0);
  }
  for (const cat of LIFE_CATEGORIES) {
    assert.ok(LIFE_EVENTS.some((e) => e.category === cat), `カテゴリ「${cat}」のイベントがありません`);
  }
});

void test('hydrateLife は不足データを決定的に補完し、validateLife はそれを受理する', () => {
  const s = newGame('新規高校', 8);
  hydrateLife(s);
  validateLife(s);
  assert.deepEqual(readLifeState(s), defaultLifeState());

  // 旧セーブ相当：v3.life が存在しない状態からの復元
  const clone = JSON.parse(JSON.stringify(s));
  delete clone.v3.life;
  hydrateLife(clone);
  validateLife(clone);
  assert.deepEqual(readLifeState(clone), defaultLifeState());

  // 決定的：同じ入力を2回 hydrate しても結果は同じ
  const clone2 = JSON.parse(JSON.stringify(s));
  delete clone2.v3.life;
  hydrateLife(clone2);
  assert.deepEqual(readLifeState(clone2), readLifeState(clone));
});

void test('validateLife は不正なデータを拒否する', () => {
  const s = newGame('不正検証高校', 2);
  hydrateLife(s);
  const bad = JSON.parse(JSON.stringify(s));
  bad.v3.life.current = {
    eventId: 'no_such_event',
    playerId: bad.players[0].id,
    week: 0,
    season: 1,
  };
  assert.throws(() => validateLife(bad));

  const bad2 = JSON.parse(JSON.stringify(s));
  bad2.v3.life.history = Array(20).fill('sports_day_relay');
  assert.throws(() => validateLife(bad2));
});

void test('maybeTriggerLifeEvent は試合週（pending/match中）には何も発生させない', () => {
  const s = newGame('試合週検証高校', 1);
  hydrateLife(s);
  s.pending = {
    label: '練習試合',
    kind: 'friendly',
    round: 0,
    strength: 50,
    opponent: '対戦校',
    style: 'balanced',
  } satisfies Fixture;
  let anyTriggered = false;
  for (let w = 0; w < 48; w++) {
    s.week = w;
    if (maybeTriggerLifeEvent(s)) anyTriggered = true;
  }
  assert.equal(anyTriggered, false);
  assert.equal(readLifeState(s).current, null);
});

void test('handleLife は選択を1回だけ受け付け、現在のイベントを消費する（連打で稼げない）', () => {
  const s = newGame('単発検証高校', 3);
  hydrateLife(s);
  const id = s.players[0].id;
  readLifeState(s).current = { eventId: 'snacks', playerId: id, week: 0, season: 1 };
  assert.ok(handleLife(s, { type: 'life', choiceId: 'snacks_a' }));
  assert.equal(readLifeState(s).current, null);
  assert.throws(() => handleLife(s, { type: 'life', choiceId: 'snacks_a' }));
  assert.equal(handleLife(s, { type: 'train' }), false); // 無関係のアクションは false
});

void test('存在しない選択肢IDを渡すとエラーになる', () => {
  const s = newGame('選択検証高校', 4);
  hydrateLife(s);
  readLifeState(s).current = { eventId: 'snacks', playerId: s.players[0].id, week: 0, season: 1 };
  assert.throws(() => handleLife(s, { type: 'life', choiceId: 'no_such_choice' }));
});

void test('イベント経由で grantSkill が呼ばれ、特殊能力が習得されることがある', () => {
  let granted = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = newGame('スキル検証高校', seed);
    hydrateLife(s);
    const id = s.players[0].id;
    readLifeState(s).current = {
      eventId: 'captain_selection',
      playerId: id,
      week: 0,
      season: 1,
    };
    handleLife(s, { type: 'life', choiceId: 'captain_selection_a' });
    if (s.v3.squad.players[id].skills.includes('captaincy')) granted++;
  }
  assert.ok(granted > 0, '主将決めイベントで captaincy が習得されるケースが一度もありませんでした');
});

void test('好ましくない選択からマイナス特能（egoist）が身につくことがある', () => {
  let granted = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = newGame('マイナス検証高校', seed);
    hydrateLife(s);
    const id = s.players[0].id;
    readLifeState(s).current = {
      eventId: 'group_project',
      playerId: id,
      week: 0,
      season: 1,
    };
    handleLife(s, { type: 'life', choiceId: 'group_project_a' });
    if (s.v3.squad.players[id].negatives.includes('egoist')) granted++;
  }
  assert.ok(granted > 0, 'グループ課題イベントで egoist が身につくケースが一度もありませんでした');
});

void test('同じ選択肢でも性格が違えば結果の大きさが変わる（熱血 vs 研究家、規律タグ）', () => {
  const s = newGame('性格差検証高校', 5);
  hydrateLife(s);
  const p1 = s.players[0],
    p2 = s.players[1];
  p1.identity.personality = 'analyst'; // discipline バイアス 1.35
  p2.identity.personality = 'enthusiast'; // discipline バイアス 0.8
  s.v3.squad.players[p1.id].archetype = 'allrounder';
  s.v3.squad.players[p2.id].archetype = 'allrounder';
  const before1 = p1.stats.mental,
    before2 = p2.stats.mental;
  readLifeState(s).current = { eventId: 'midterm_exam', playerId: p1.id, week: 0, season: 1 };
  handleLife(s, { type: 'life', choiceId: 'midterm_exam_a' });
  readLifeState(s).current = { eventId: 'midterm_exam', playerId: p2.id, week: 1, season: 1 };
  handleLife(s, { type: 'life', choiceId: 'midterm_exam_a' });
  const growth1 = p1.stats.mental - before1,
    growth2 = p2.stats.mental - before2;
  assert.ok(
    growth1 > growth2,
    `規律を重んじる選択は研究家(${growth1})のほうが熱血(${growth2})より伸びるはず`,
  );
});

void test('同じ選択肢でもアーキタイプが違えば結果の大きさが変わる（ドリブラー vs 守備職人、大胆タグ）', () => {
  const s = newGame('アーキタイプ差検証高校', 6);
  hydrateLife(s);
  const p1 = s.players[0],
    p2 = s.players[1];
  p1.identity.personality = 'competitor';
  p2.identity.personality = 'competitor';
  s.v3.squad.players[p1.id].archetype = 'dribbler'; // bold バイアス 1.2
  s.v3.squad.players[p2.id].archetype = 'defender'; // bold バイアスなし(1.0)
  const before1 = p1.identity.trust,
    before2 = p2.identity.trust;
  readLifeState(s).current = { eventId: 'sports_day_relay', playerId: p1.id, week: 0, season: 1 };
  handleLife(s, { type: 'life', choiceId: 'sports_day_relay_a' });
  readLifeState(s).current = { eventId: 'sports_day_relay', playerId: p2.id, week: 1, season: 1 };
  handleLife(s, { type: 'life', choiceId: 'sports_day_relay_a' });
  const growth1 = p1.identity.trust - before1,
    growth2 = p2.identity.trust - before2;
  assert.ok(
    growth1 > growth2,
    `ドリブラー(${growth1})のほうが守備職人(${growth2})より大胆な選択の信頼上昇が大きいはず`,
  );
});

function pickTraining(s: State, i: number): Training {
  const menus: Training[] = ['balance', 'attack', 'possession', 'defense', 'physical'];
  const fatigue = s.players.reduce((a, p) => a + p.fatigue, 0) / s.players.length;
  return fatigue > 45 ? 'rest' : menus[i % menus.length];
}

void test('10シーズン相当を進行させても士気・疲労・信頼・能力が上下限を突き抜けず、イベントは1週1つ・カテゴリも偏りすぎない', () => {
  let s = newGame('学校生活通し高校', 12345);
  hydrateLife(s);
  const categoryCounts: Record<LifeCategory, number> = {
    学校行事: 0,
    学業: 0,
    人間関係: 0,
    家庭: 0,
    部活: 0,
    身体: 0,
  };
  let totalTriggers = 0;
  let actions = 0;
  let weeksWithTrigger = 0;
  let lastTriggerWeekStamp = -1;
  // S1: 1回のtrain操作は「1日」。ループ本体は変えず（意図は「試合の無い日に限り
  // maybeTriggerLifeEventが呼ばれ、1週1回に収まる」ことの確認のまま）、
  // 週ではなく日単位で回す。
  while (s.season <= 10) {
    hydrateLife(s);
    const cur = getCurrentLifeEvent(s);
    if (cur) {
      const idx = s.week % cur.event.choices.length;
      handleLife(s, { type: 'life', choiceId: cur.event.choices[idx].id });
    }
    if (s.event) s = act(s, { type: 'event', choice: s.week % 2 === 0 ? 'team' : 'individual' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    if (!s.pending) s = act(s, { type: 'train', training: pickTraining(s, s.week) });
    if (s.pending) {
      s = act(s, { type: 'start' });
      while (!s.match!.done) s = act(s, { type: 'segment' });
      s = act(s, { type: 'finish' });
    } else {
      // act() の 'train' ハンドラは日ごとに maybeTriggerLifeEvent を呼ぶ（月〜金のみ）。
      // ここまでの時点で life.current が資格を持つのは、まさに今の act() 呼び出しで
      // 発生した場合だけ（前回分はループ先頭で resolve 済みのため）。
      hydrateLife(s);
      const cur2 = getCurrentLifeEvent(s);
      if (cur2) {
        totalTriggers++;
        categoryCounts[cur2.event.category]++;
        const stamp = s.season * 48 + s.week;
        assert.notEqual(stamp, lastTriggerWeekStamp, '同じ週に2回以上イベントが発生しています');
        lastTriggerWeekStamp = stamp;
        weeksWithTrigger++;
      }
      assert.ok(!readLifeState(s).current || getCurrentLifeEvent(s) !== null);
    }
    assert.ok(s.morale >= 0 && s.morale <= 100, `士気が範囲外: ${s.morale}`);
    assert.ok(s.cohesion >= 0 && s.cohesion <= 100, `連携が範囲外: ${s.cohesion}`);
    for (const p of s.players) {
      assert.ok(p.fatigue >= 0 && p.fatigue <= 100, `疲労が範囲外: ${p.fatigue}`);
      assert.ok(p.injury >= 0 && p.injury <= 5, `けが度が範囲外: ${p.injury}`);
      assert.ok(p.identity.trust >= 0 && p.identity.trust <= 100, `信頼が範囲外: ${p.identity.trust}`);
      for (const k of Object.keys(p.stats) as Stat[])
        assert.ok(p.stats[k] >= 20 && p.stats[k] <= 99, `${k} が範囲外: ${p.stats[k]}`);
    }
    validateLife(s);
    actions++;
    assert.ok(actions < 5000, '無限ループ防止');
  }
  // 目標: 1シーズン12〜18回（10シーズン平均でこの範囲、多少の幅は許容）。
  const perSeason = totalTriggers / 10;
  assert.ok(
    perSeason >= 8 && perSeason <= 24,
    `10シーズン平均のイベント発生回数が想定レンジ外です: ${perSeason}件/シーズン（合計${totalTriggers}件）`,
  );
  assert.equal(weeksWithTrigger, totalTriggers, '同じ週に複数回発生したケースがあります');
  for (const cat of LIFE_CATEGORIES) {
    assert.ok(categoryCounts[cat] > 0, `カテゴリ「${cat}」が一度も出現しませんでした`);
    assert.ok(
      categoryCounts[cat] / totalTriggers < 0.5,
      `カテゴリ「${cat}」に偏りすぎています: ${categoryCounts[cat]}/${totalTriggers}`,
    );
  }
});
void test('S1: 最初の8週以内に学校生活イベントが発生する（複数シードで高確率に）', () => {
  // 週あたりの発生確率は約1/3（LIFE_EVENT_CHANCE=0.075、月〜金の5日判定）なので、
  // 8週あれば1-(1-1/3)^8≒97%で発生する計算だが、外れシードもありうるので
  // 「全シードで必ず」ではなく「十分な数のシードで発生する」ことを確認する
  // （設計書2.5「複数シードで確認」の趣旨）。
  let seedsWithTrigger = 0;
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
  for (const seed of seeds) {
    let s = newGame('序盤発生検証高校', seed);
    hydrateLife(s);
    let triggeredWithin8Weeks = false;
    let actions = 0;
    while (s.week < 8 && s.season === 1 && actions < 100) {
      hydrateLife(s);
      const cur = getCurrentLifeEvent(s);
      if (cur) {
        handleLife(s, { type: 'life', choiceId: cur.event.choices[0].id });
        triggeredWithin8Weeks = true;
      }
      if (s.event) s = act(s, { type: 'event', choice: 'team' });
      while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
      if (!s.pending) s = act(s, { type: 'train', training: pickTraining(s, s.week) });
      if (s.pending) {
        s = act(s, { type: 'start' });
        while (!s.match!.done) s = act(s, { type: 'segment' });
        s = act(s, { type: 'finish' });
      }
      actions++;
    }
    if (triggeredWithin8Weeks) seedsWithTrigger++;
  }
  assert.ok(
    seedsWithTrigger / seeds.length >= 0.8,
    `最初の8週以内にイベントが発生したシードが少なすぎます: ${seedsWithTrigger}/${seeds.length}`,
  );
});

void test('決定性：同じシード・同じ操作列なら同じイベントと選手が選ばれる', () => {
  function run(seed: number) {
    let s = newGame('決定性検証高校', seed);
    hydrateLife(s);
    const picks: { eventId: string; playerId: number }[] = [];
    // S1: 1回のtrain操作は「1日」。日次判定になったことで機会そのものは増えたが、
    // 確実に複数回の発生を確保するため十分な日数（約100週相当）を回す。
    // act() の 'train' ハンドラが内部で maybeTriggerLifeEvent を呼んでいるので、
    // ここでは直接呼び直さず、trainの結果としてlife.currentが立ったかどうかを読む
    // （二重に呼ぶと lastTriggerStamp/current の1週1回ガードに阻まれて常にfalseになる）。
    for (let i = 0; i < 600; i++) {
      hydrateLife(s);
      const cur = getCurrentLifeEvent(s);
      if (cur) handleLife(s, { type: 'life', choiceId: cur.event.choices[0].id });
      if (s.event) s = act(s, { type: 'event', choice: 'team' });
      while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
      if (!s.pending) s = act(s, { type: 'train', training: pickTraining(s, i) });
      if (s.pending) {
        s = act(s, { type: 'start' });
        while (!s.match!.done) s = act(s, { type: 'segment' });
        s = act(s, { type: 'finish' });
      } else {
        hydrateLife(s);
        const c = getCurrentLifeEvent(s);
        if (c) picks.push({ eventId: c.event.id, playerId: c.player.id });
      }
    }
    return picks;
  }
  const a = run(777);
  const b = run(777);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0, '検証のため、少なくとも1件はイベントが発生している必要があります');
});

void test('LIFE_EVENT_CHANCE は妥当な確率レンジにある', () => {
  assert.ok(LIFE_EVENT_CHANCE > 0 && LIFE_EVENT_CHANCE < 1);
});

void test('LIFE_EVENTS_BY_ID はすべてのイベントを引ける', () => {
  for (const e of LIFE_EVENTS) assert.equal(LIFE_EVENTS_BY_ID[e.id], e);
});
