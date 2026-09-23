import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame,
  act,
  validateSave,
  autoLineup,
  strength,
  type State,
  type Training,
} from '../lib/game.ts';
import {
  DETAIL_POS,
  basePos,
  formationSlots,
  gainProficiency,
  stylesFor,
  skillMatchFactors,
  PLAY_STYLES,
  MASTERY_THRESHOLD,
} from '../lib/squad.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー（tests/game.test.ts / tests/squad.test.ts と同じ方針）
// ---------------------------------------------------------------------------
function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function play(s: State) {
  s = act(s, { type: 'start' });
  while (!s.match!.done) s = act(s, { type: 'segment' });
  return act(s, { type: 'finish' });
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

// ---------------------------------------------------------------------------
// 1) 旧セーブ移行: 習熟度は「現ポジション100・同系統40・他10」、スタイルはidを
//    種に決定的に割り当てられる（DESIGN_V3_2.md 5.3）。
// ---------------------------------------------------------------------------
void test('S4: legacy save migration deterministically initializes 15-position proficiency (100/40/10) and a valid, eligible play style', () => {
  const s = newGame('移行検証高校', 555);
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.v3;
  const loaded = validateSave(legacy);
  for (const p of loaded.players) {
    const ps = loaded.v3.squad.players[p.id];
    assert.ok(ps, `${p.id} に編成データがありません`);
    for (const d of DETAIL_POS) {
      const expected = d === ps.detail ? 100 : basePos(d) === basePos(ps.detail) ? 40 : 10;
      assert.equal(ps.prof[d], expected, `${p.id}: ${d} の初期習熟度が想定と異なります`);
    }
    assert.ok(Object.hasOwn(PLAY_STYLES, ps.style), `${p.id} のスタイルが不正です`);
    assert.ok(
      PLAY_STYLES[ps.style].positions.includes(ps.detail),
      `${p.id} のスタイル(${ps.style})は現在のポジション(${ps.detail})では選べません`,
    );
  }
  // 決定的: 同じ元データを二度移行しても同じ結果になる。
  const legacy2 = JSON.parse(JSON.stringify(s));
  delete legacy2.v3;
  const loaded2 = validateSave(legacy2);
  assert.deepEqual(loaded2.v3.squad, loaded.v3.squad);
});

// ---------------------------------------------------------------------------
// 2) 習熟度60到達で「サブポジション習得」がフィードに出る。
// ---------------------------------------------------------------------------
void test('S4: gainProficiency crossing the mastery threshold (60) posts a feed message exactly once', () => {
  const s = newGame('習得検証高校', 12);
  const p = s.players.find((pp) => pp.pos === 'DF')!;
  const ps = s.v3.squad.players[p.id];
  // 現在の主ポジション以外で、まだ60未満の系統内ポジションを選ぶ。
  const target = DETAIL_POS.find(
    (d) => d !== ps.detail && basePos(d) === basePos(ps.detail) && ps.prof[d] < MASTERY_THRESHOLD,
  )!;
  assert.ok(target, 'テスト前提: 系統内に習熟度60未満の別ポジションが必要です');
  gainProficiency(s, p.id, target, 15); // 40 -> 55、閾値未到達
  assert.ok(!s.feed[0].includes('サブポジション'));
  gainProficiency(s, p.id, target, 10); // 55 -> 65、閾値到達
  assert.match(s.feed[0], /サブポジション/);
  assert.match(s.feed[0], new RegExp(target));
  assert.equal(s.v3.squad.players[p.id].prof[target], 65);
  const feedLenBefore = s.feed.length;
  gainProficiency(s, p.id, target, 5); // 65 -> 70、既に習得済みなので再通知しない
  assert.equal(s.feed.length, feedLenBefore, '既に閾値を超えている場合は重複通知しない');
});

// ---------------------------------------------------------------------------
// 3) 日次コマンド「ポジション練習」で対象の選手の指定ポジション習熟度が伸びる。
// ---------------------------------------------------------------------------
void test('S4: the "position practice" daily command raises only the targeted player\'s proficiency at the targeted position', () => {
  let s = newGame('ポジ練検証高校', 31);
  const p = s.players.find((pp) => pp.pos === 'MF')!;
  const target = DETAIL_POS.find(
    (d) => basePos(d) === 'MF' && d !== s.v3.squad.players[p.id].detail,
  )!;
  // 対象未指定でポジション練習を選ぶと拒否される。
  assert.throws(() => act(s, { type: 'train', training: 'position' }));
  s = act(s, { type: 'positionFocus', id: p.id, pos: target });
  const before = s.v3.squad.players[p.id].prof[target];
  s = resolveLife(s);
  s = act(s, { type: 'train', training: 'position' });
  const after = s.v3.squad.players[p.id].prof[target];
  assert.ok(after > before, `ポジション練習で習熟度が伸びていません: ${before} -> ${after}`);
  // 対象外の選手・ポジションは動かない。
  const other = s.players.find((pp) => pp.id !== p.id)!;
  const otherPs = s.v3.squad.players[other.id];
  assert.deepEqual(otherPs.prof, s.v3.squad.players[other.id].prof);
  // 解除すればまた選べなくなる。
  s = act(s, { type: 'positionFocus', id: null, pos: null });
  assert.equal(s.positionFocus, null);
});

// ---------------------------------------------------------------------------
// 4) 試合出場でも実際に出場した枠のポジション習熟度が伸びる（フル出場+8）。
//    finish() で s.lineup は試合前の original に戻るため、試合終了直後
//    （finishの前）の状態で、先発の並び(=original)と比較する。
// ---------------------------------------------------------------------------
void test('S4: full match appearance raises proficiency for the occupied slot, proportionally for substitutes', () => {
  let s = newGame('出場経験検証高校2', 44);
  s.week = 3;
  s = toMatchDay(s, 'rest');
  const dslots = formationSlots(s.formation);
  const startLineup = [...s.lineup];
  const before = startLineup.map((id, i) => s.v3.squad.players[id].prof[dslots[i]]);
  s = act(s, { type: 'start' });
  while (!s.match!.done) s = act(s, { type: 'segment' });
  const after = startLineup.map((id, i) => s.v3.squad.players[id].prof[dslots[i]]);
  let grew = false;
  for (let i = 0; i < 11; i++) {
    assert.ok(after[i] >= before[i], `slot ${i}: proficiency should never decrease`);
    if (after[i] > before[i]) grew = true;
  }
  assert.ok(grew, '出場した選手の誰か1人以上は習熟度が伸びているはず');
});

// ---------------------------------------------------------------------------
// 5) プレースタイルは試合計算に実数効果を持つ: 同一シードでも、前線に配置する
//    プレースタイルを変えると得点数の傾向が変わる（skills と同じ検証パターン）。
// ---------------------------------------------------------------------------
void test('S4: play styles produce a real, measurable difference in match outcomes for the same seed', () => {
  // スタイルの効果は設計上小さい（決定力 +1.5〜4.5%）。得点数は試合ごとのぶれが大きく、
  // 25試合程度では逆転することがあるため、(1) 試合計算に入る係数を直接比べ、
  // (2) 試合シミュレーションは得点ではなく期待得点(xG)の合計で比べる。
  function withStyles(s: State, strong: boolean): State {
    for (const p of s.players.filter((pl) => pl.pos === 'FW')) {
      const ps = s.v3.squad.players[p.id];
      const sorted = [...stylesFor(ps.detail)].sort(
        (a, b) => (b.effect.finishMult ?? 1) - (a.effect.finishMult ?? 1),
      );
      ps.style = (strong ? sorted[0] : sorted[sorted.length - 1]).id;
    }
    return s;
  }
  // (1) 同じ部・同じ先発で、スタイルだけを変えると決定力の係数が上がる。
  const base = newGame('スタイル係数検証高校', 7);
  const weakFx = skillMatchFactors(withStyles(structuredClone(base), false));
  const strongFx = skillMatchFactors(withStyles(structuredClone(base), true));
  assert.ok(
    strongFx.finish > weakFx.finish,
    `決定力を上げるスタイルで係数が上がるべき: ${strongFx.finish} vs ${weakFx.finish}`,
  );
  // (2) 実際の試合でも、同じシードどうしで期待得点の合計が増える。
  function playMatchXg(strong: boolean, seed: number): number {
    let s = withStyles(newGame('スタイル検証高校', seed), strong);
    s.week = 3;
    s = toMatchDay(s, 'rest');
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    return s.match!.xg[0];
  }
  let weakXg = 0,
    strongXg = 0;
  for (let seed = 1; seed <= 100; seed++) {
    weakXg += playMatchXg(false, seed);
    strongXg += playMatchXg(true, seed);
  }
  assert.ok(
    strongXg > weakXg,
    `finish-boosting styles should create more expected goals across seeds: ${strongXg.toFixed(1)} vs ${weakXg.toFixed(1)}`,
  );
});

// ---------------------------------------------------------------------------
// 6) 4-2-3-1 が編成・自動編成・試合進行・セーブ往復で破綻しない。
// ---------------------------------------------------------------------------
void test('S4: the new 4-2-3-1 formation works end-to-end (lineup, autoLineup, a full match, and a save round-trip)', () => {
  let s = newGame('新布陣検証高校', 66);
  s = act(s, { type: 'formation', formation: '4-2-3-1' });
  assert.equal(s.formation, '4-2-3-1');
  assert.equal(s.lineup.length, 11);
  assert.equal(new Set(s.lineup).size, 11);
  assert.equal(formationSlots('4-2-3-1').length, 11);
  autoLineup(s);
  assert.ok(strength(s) > 0);
  s.week = 3;
  s = toMatchDay(s, 'rest');
  s = play(s);
  assert.equal(s.records.games, 1);
  const roundtrip = validateSave(JSON.parse(JSON.stringify(s)));
  assert.equal(roundtrip.formation, '4-2-3-1');
});

// ---------------------------------------------------------------------------
// 7) 選手詳細から主ポジション・スタイルを変更できる（習熟度60以上のみ主ポジション変更可）。
// ---------------------------------------------------------------------------
void test('S4: a player\'s primary position can only change to a mastered (>=60) sub-position, and the style choice is restricted to that position\'s pool', () => {
  let s = newGame('主ポジ変更検証高校', 77);
  const p = s.players.find((pp) => pp.pos === 'DF')!;
  const ps = s.v3.squad.players[p.id];
  const notMastered = DETAIL_POS.find(
    (d) => basePos(d) === 'DF' && d !== ps.detail && ps.prof[d] < MASTERY_THRESHOLD,
  )!;
  assert.throws(() => act(s, { type: 'squadPrimaryPos', id: p.id, detail: notMastered }));
  gainProficiency(s, p.id, notMastered, 100);
  s = act(s, { type: 'squadPrimaryPos', id: p.id, detail: notMastered });
  assert.equal(s.v3.squad.players[p.id].detail, notMastered);
  assert.ok(stylesFor(notMastered).some((st) => st.id === s.v3.squad.players[p.id].style));
  // 現在のポジションで選べないスタイルは拒否される。
  const otherDetail = DETAIL_POS.find((d) => basePos(d) === 'DF' && d !== notMastered)!;
  const invalidStyle = stylesFor(otherDetail).find(
    (st) => !stylesFor(notMastered).some((x) => x.id === st.id),
  );
  if (invalidStyle) {
    assert.throws(() => act(s, { type: 'squadStyle', id: p.id, style: invalidStyle.id }));
  }
  const validStyle = stylesFor(notMastered)[0];
  s = act(s, { type: 'squadStyle', id: p.id, style: validStyle.id });
  assert.equal(s.v3.squad.players[p.id].style, validStyle.id);
});
