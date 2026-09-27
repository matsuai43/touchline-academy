// T3-2: 選手ごとの月次トレーニング方針。
import { newGame, act, validateSave, stats, type State, type Training } from '../lib/game.ts';
import { PLAY_STYLES, MASTERY_THRESHOLD, basePos, extraStatNames, type DetailPos } from '../lib/squad.ts';
import {
  needsMonthlyReview,
  monthBlock,
  POLICY_KEYS,
  POSITION_GROUPS,
  GRADE_YEARS,
  groupKey,
  policyInfo,
  resolveEffectivePolicy,
} from '../lib/training-policy.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
// 1日ぶん練習を進める（試合・イベントが挟まっても先頭の選択肢で流す）。
function day(s: State, t: Training = 'balance') {
  if (s.event) s = act(s, { type: 'event', choice: 'team' });
  while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
  s = resolveLife(s);
  if (!s.pending) s = act(s, { type: 'train', training: t });
  if (s.pending) {
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    s = act(s, { type: 'finish' });
  }
  return s;
}

void test('T3-2: fresh game defaults every player to "auto" and exposes all 10 policy keys', () => {
  const s = newGame('', 501);
  assert.equal(Object.keys(s.v3.trainingPolicy.players).length, s.players.length);
  for (const p of s.players) assert.equal(s.v3.trainingPolicy.players[p.id].key, 'auto');
  assert.equal(POLICY_KEYS.length, 10);
});

void test('T3-2: monthly review flag is due at game start, cleared by acknowledging, and due again after 4 weeks', () => {
  let s = newGame('', 502);
  assert.equal(monthBlock(s.week), 0);
  assert.equal(needsMonthlyReview(s), true);
  s = act(s, { type: 'trainingPolicyReviewed' });
  assert.equal(needsMonthlyReview(s), false);
  s.week = 4; // 次のブロック（4週ごと）
  assert.equal(needsMonthlyReview(s), true);
});

void test('T3-2: growth is split 60% team menu / 40% individual policy — a policy targeting a stat outside the team menu still grows it', () => {
  let s = newGame('', 503);
  const pid = s.players[0].id;
  // 'attack'メニュー（決定力・精神力）は守備を伸ばさないので、個人方針「守備」の
  // 効果だけが守備の伸びとして観測できる（40%ぶんの個人方針が働いている証拠）。
  s = act(s, { type: 'trainingPolicySet', id: pid, policy: 'defend' });
  const before = s.players.find((p) => p.id === pid)!.stats.defend;
  s = act(s, { type: 'train', training: 'attack' });
  const after = s.players.find((p) => p.id === pid)!.stats.defend;
  assert.ok(after > before, `個人方針「守備」で守備が伸びるはず: ${before} -> ${after}`);
});

void test('T3-2: team-menu growth is reduced to the 60% share when an individual policy is layered on top', () => {
  // 同じ選手・同じ日を、個人方針「決定力」(攻撃メニューと同じ対象) と
  // 個人方針「守備」(攻撃メニューと無関係) で比較する。前者は決定力に
  // チーム60%＋個人40%の両方が乗るので、後者（チーム60%のみ）より決定力の伸びが大きいはず。
  const base = newGame('', 510);
  const pid = base.players[0].id;
  const withShootPolicy = act(
    act(base, { type: 'trainingPolicySet', id: pid, policy: 'shoot' }),
    { type: 'train', training: 'attack' },
  );
  const withDefendPolicy = act(
    act(base, { type: 'trainingPolicySet', id: pid, policy: 'defend' }),
    { type: 'train', training: 'attack' },
  );
  const shootGainWithOwnPolicy =
    withShootPolicy.players.find((p) => p.id === pid)!.stats.shoot - base.players[0].stats.shoot;
  const shootGainWithOtherPolicy =
    withDefendPolicy.players.find((p) => p.id === pid)!.stats.shoot - base.players[0].stats.shoot;
  assert.ok(shootGainWithOtherPolicy > 0, 'チームメニュー分(60%)は個人方針に関わらず伸びるはず');
  assert.ok(
    shootGainWithOwnPolicy > shootGainWithOtherPolicy,
    '個人方針も決定力を対象にすると、チーム60%+個人40%でさらに伸びるはず',
  );
});

void test('T3-2: "position" policy grows the target position proficiency over the existing gainProficiency mastery flow (feed message at 60)', () => {
  let s = newGame('', 504);
  const candidatesByBase: DetailPos[] = ['CB', 'LSB', 'RSB', 'LWB', 'RWB', 'DM', 'CM', 'LSH', 'RSH', 'AM', 'LWG', 'RWG', 'SS', 'CF'];
  // 初期20人は「現実的なサブポジション習熟度」(DESIGN_V3_3 3.3)を持ち、一部は
  // 既に60に達しているので、まだ届いていない組み合わせを探す（伸びを観測するため）。
  let p = s.players[0];
  let target: DetailPos | undefined;
  for (const cand of s.players) {
    if (cand.pos === 'GK') continue;
    const sq = s.v3.squad.players[cand.id];
    const hit = candidatesByBase.find(
      (d) => basePos(d) === cand.pos && d !== sq.detail && sq.prof[d] < MASTERY_THRESHOLD,
    );
    if (hit) {
      p = cand;
      target = hit;
      break;
    }
  }
  assert.ok(target, 'まだ習熟度が60未満のサブポジションを持つ選手が見つかりません');
  s = act(s, { type: 'trainingPolicySet', id: p.id, policy: 'position', target });
  assert.equal(s.v3.trainingPolicy.players[p.id].key, 'position');
  assert.equal(s.v3.trainingPolicy.players[p.id].target, target);
  const before = s.v3.squad.players[p.id].prof[target];
  let guard = 0;
  while (s.v3.squad.players[p.id].prof[target] < MASTERY_THRESHOLD && guard++ < 120) {
    s = day(s, 'balance');
  }
  assert.ok(
    s.v3.squad.players[p.id].prof[target] > before,
    'ポジション習得の個人方針で習熟度が伸びるはず',
  );
  assert.ok(
    s.v3.squad.players[p.id].prof[target] >= MASTERY_THRESHOLD,
    `${guard}日以内に習熟度${MASTERY_THRESHOLD}へ到達するはず（現在${s.v3.squad.players[p.id].prof[target]}）`,
  );
  assert.ok(
    s.feed.some((f) => f.includes('サブポジションを習得')),
    '既存の習得通知(gainProficiency)の流れに乗っているはず',
  );
});

void test('T3-2: "keep" policy is GK-only and rejected for outfield players', () => {
  const s = newGame('', 505);
  const outfield = s.players.find((p) => p.pos !== 'GK')!;
  assert.throws(() => act(s, { type: 'trainingPolicySet', id: outfield.id, policy: 'keep' }));
  const gk = s.players.find((p) => p.pos === 'GK')!;
  const changed = act(s, { type: 'trainingPolicySet', id: gk.id, policy: 'keep' });
  assert.equal(changed.v3.trainingPolicy.players[gk.id].key, 'keep');
});

void test('T3-2: bulk "auto" resets every player back to auto, and monthlyGrowth is tracked per player', () => {
  let s = newGame('', 506);
  const pid = s.players[0].id;
  s = act(s, { type: 'trainingPolicySet', id: pid, policy: 'speed' });
  s = act(s, { type: 'train', training: 'defense' }); // 'speed'はdefenseメニューに含まれない
  assert.ok(
    Object.keys(s.v3.trainingPolicy.players[pid].monthlyGrowth).some((k) => k === 'speed'),
    '今月の伸びに個人方針で伸ばした能力が記録されているはず',
  );
  s = act(s, { type: 'trainingPolicyBulkAuto' });
  for (const p of s.players) {
    assert.equal(s.v3.trainingPolicy.players[p.id].key, 'auto');
    assert.equal(s.v3.trainingPolicy.players[p.id].target, null);
  }
});

void test('T3-2: "physical" grows the extra stats (stamina/power) and "dribble" grows the dribble extra stat', () => {
  let s = newGame('', 507);
  const pid = s.players[0].id;
  s = act(s, { type: 'trainingPolicySet', id: pid, policy: 'physical' });
  const before = { ...s.v3.squad.players[pid] };
  s = act(s, { type: 'train', training: 'possession' });
  const afterPhys = s.v3.squad.players[pid];
  assert.ok(afterPhys.stamina >= before.stamina && afterPhys.power >= before.power);
  assert.ok(afterPhys.stamina + afterPhys.power > before.stamina + before.power);

  s = act(s, { type: 'trainingPolicySet', id: pid, policy: 'dribble' });
  const beforeDribble = s.v3.squad.players[pid].dribble;
  s = act(s, { type: 'train', training: 'possession' });
  assert.ok(s.v3.squad.players[pid].dribble >= beforeDribble);
});

void test('T3-2: "auto" grows a stat favored by the player\'s play style even when the team menu targets something else', () => {
  const base = newGame('', 508);
  // 'physical'メニュー(走力のみ対象)では伸びない能力を成長キーに持つ選手を探す
  // （styleのgrowthキーは常に2つ、値は常に>1）。
  const p = base.players.find((pp) => {
    const ps = base.v3.squad.players[pp.id];
    const keys = Object.keys(PLAY_STYLES[ps.style].growth);
    return keys.length > 0 && !keys.includes('speed');
  })!;
  assert.ok(p, 'physical以外の能力を伸ばすスタイルの選手が見つかりません');
  const ps = base.v3.squad.players[p.id];
  const favored = Object.keys(PLAY_STYLES[ps.style].growth)[0] as keyof typeof p.stats;
  const before = p.stats[favored];
  const after = act(base, { type: 'train', training: 'physical' });
  const grown = after.players.find((x) => x.id === p.id)!.stats[favored];
  assert.ok(
    grown > before,
    `おまかせ方針でプレースタイル favored な能力(${String(favored)})が伸びるはず: ${before} -> ${grown}`,
  );
});

void test('T3-2: legacy saves (trainingPolicy missing) hydrate to "auto" for every player and survive validateSave', () => {
  const s = newGame('', 509);
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.v3.trainingPolicy;
  const loaded = validateSave(legacy);
  assert.equal(Object.keys(loaded.v3.trainingPolicy.players).length, loaded.players.length);
  for (const p of loaded.players) assert.equal(loaded.v3.trainingPolicy.players[p.id].key, 'auto');
  assert.deepEqual(validateSave(loaded), loaded);
});

// ---------------------------------------------------------------------------
// V4-2 (DESIGN_V4 6章): ポジション×学年の一括設定・個別上書き・重点育成の同一画面化。
// ---------------------------------------------------------------------------

void test('V4-2: fresh game has all 12 position×grade groups defaulted to "auto"', () => {
  const s = newGame('', 601);
  assert.equal(Object.keys(s.v3.trainingPolicy.groups).length, POSITION_GROUPS.length * GRADE_YEARS.length);
  for (const pos of POSITION_GROUPS)
    for (const year of GRADE_YEARS) assert.equal(s.v3.trainingPolicy.groups[groupKey(pos, year)], 'auto');
});

void test('V4-2: group setting resolution — changing a group\'s policy changes the effective policy for every non-individual player in that group, and only that group', () => {
  let s = newGame('', 602);
  const df1 = s.players.find((p) => p.pos === 'DF' && p.year === 1);
  assert.ok(df1, 'DF1年生が見つかりません');
  s = act(s, { type: 'trainingPolicyGroupSet', pos: 'DF', year: 1, policy: 'defend' });
  assert.equal(s.v3.trainingPolicy.groups[groupKey('DF', 1)], 'defend');
  assert.equal(resolveEffectivePolicy(s, s.players.find((p) => p.id === df1!.id)!).key, 'defend');
  // 他の学年・他ポジションの選手は変わらない（'auto'のまま）。
  const df2 = s.players.find((p) => p.pos === 'DF' && p.year === 2);
  if (df2) assert.equal(resolveEffectivePolicy(s, df2).key, 'auto');
  const mf1 = s.players.find((p) => p.pos === 'MF' && p.year === 1);
  if (mf1) assert.equal(resolveEffectivePolicy(s, mf1).key, 'auto');
});

void test('V4-2: an individually-overridden player keeps their own policy even after the group setting changes ("個別"のまま)', () => {
  let s = newGame('', 603);
  const df1 = s.players.find((p) => p.pos === 'DF' && p.year === 1)!;
  s = act(s, { type: 'trainingPolicySet', id: df1.id, policy: 'mental' });
  assert.equal(s.v3.trainingPolicy.players[df1.id].individual, true);
  s = act(s, { type: 'trainingPolicyGroupSet', pos: 'DF', year: 1, policy: 'defend' });
  // 個別設定した選手は一括設定の変更に影響されない。
  assert.equal(resolveEffectivePolicy(s, df1).key, 'mental');
  // 同じ集団の別の（個別未設定の）選手は一括設定に従う。
  const otherDf1 = s.players.find((p) => p.pos === 'DF' && p.year === 1 && p.id !== df1.id);
  if (otherDf1) assert.equal(resolveEffectivePolicy(s, otherDf1).key, 'defend');
});

void test('V4-2: clearing an individual override reverts the player to the current group setting', () => {
  let s = newGame('', 604);
  const fw1 = s.players.find((p) => p.pos === 'FW' && p.year === 1)!;
  s = act(s, { type: 'trainingPolicyGroupSet', pos: 'FW', year: 1, policy: 'shoot' });
  s = act(s, { type: 'trainingPolicySet', id: fw1.id, policy: 'speed' });
  assert.equal(resolveEffectivePolicy(s, fw1).key, 'speed');
  s = act(s, { type: 'trainingPolicyClearIndividual', id: fw1.id });
  assert.equal(s.v3.trainingPolicy.players[fw1.id].individual, false);
  assert.equal(resolveEffectivePolicy(s, fw1).key, 'shoot');
});

void test('V4-2: "keep" cannot be set as a group policy outside the GK group', () => {
  const s = newGame('', 605);
  assert.throws(() => act(s, { type: 'trainingPolicyGroupSet', pos: 'DF', year: 1, policy: 'keep' }));
  const changed = act(s, { type: 'trainingPolicyGroupSet', pos: 'GK', year: 1, policy: 'keep' });
  assert.equal(changed.v3.trainingPolicy.groups[groupKey('GK', 1)], 'keep');
});

void test('V4-2: legacy saves without groups/individual/previousMonthGrowth hydrate deterministically and survive validateSave', () => {
  const s = newGame('', 606);
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.v3.trainingPolicy.groups;
  for (const key of Object.keys(legacy.v3.trainingPolicy.players)) {
    delete legacy.v3.trainingPolicy.players[key].individual;
    delete legacy.v3.trainingPolicy.players[key].previousMonthGrowth;
  }
  const loaded = validateSave(legacy);
  assert.equal(Object.keys(loaded.v3.trainingPolicy.groups).length, POSITION_GROUPS.length * GRADE_YEARS.length);
  for (const pos of POSITION_GROUPS)
    for (const year of GRADE_YEARS) assert.equal(loaded.v3.trainingPolicy.groups[groupKey(pos, year)], 'auto');
  for (const p of loaded.players) {
    assert.equal(loaded.v3.trainingPolicy.players[p.id].individual, false);
    assert.deepEqual(loaded.v3.trainingPolicy.players[p.id].previousMonthGrowth, {});
  }
  assert.deepEqual(validateSave(loaded), loaded);
});

void test('V4-2: previousMonthGrowth captures the finished month\'s growth when the block advances, then monthlyGrowth resets', () => {
  let s = newGame('', 607);
  const pid = s.players[0].id;
  s = act(s, { type: 'trainingPolicySet', id: pid, policy: 'defend' });
  s = act(s, { type: 'train', training: 'attack' });
  const midMonthGrowth = { ...s.v3.trainingPolicy.players[pid].monthlyGrowth };
  assert.ok(Object.keys(midMonthGrowth).length > 0, '今月の伸びが記録されているはず');
  // 次のブロックへ週を進める（monthBlockは4週ごと）。
  s.week = 4;
  s = act(s, { type: 'trainingPolicyReviewed' }); // 何らかのactionでhydrateを一度通す
  assert.deepEqual(s.v3.trainingPolicy.players[pid].previousMonthGrowth, midMonthGrowth);
  assert.deepEqual(s.v3.trainingPolicy.players[pid].monthlyGrowth, {});
});

void test('V4-2: renamed policy labels match the exact ability names shown on the player screen', () => {
  assert.equal(policyInfo.speed.name, stats.speed);
  assert.equal(policyInfo.dribble.name, extraStatNames.dribble);
  assert.equal(policyInfo.physical.name, `${extraStatNames.stamina}・${extraStatNames.power}`);
  assert.equal(policyInfo.shoot.name, stats.shoot);
  assert.equal(policyInfo.pass.name, stats.pass);
  assert.equal(policyInfo.defend.name, stats.defend);
  assert.equal(policyInfo.mental.name, stats.mental);
  assert.equal(policyInfo.keep.name, stats.keep);
});

void test('V4-2: determinism — the same seed and the same sequence of group/individual actions produce an identical resulting state', () => {
  const run = () => {
    let s = newGame('', 608);
    s = act(s, { type: 'trainingPolicyGroupSet', pos: 'MF', year: 2, policy: 'pass' });
    const mf2 = s.players.find((p) => p.pos === 'MF' && p.year === 2);
    if (mf2) s = act(s, { type: 'trainingPolicySet', id: mf2.id, policy: 'mental' });
    s = act(s, { type: 'train', training: 'balance' });
    return s;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
});
