import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, type State } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import type { Highlight } from '../lib/development.ts';
import {
  buildSequence,
  frameAt,
  kickoffFrame,
  commentaryFor,
  sceneAriaLabel,
  PITCH_W,
  PITCH_H,
  GOAL_Y,
  GOAL_HALF,
  type Frame,
} from '../lib/match-2d.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー: 学校生活イベントを先頭の選択肢で解決しつつ週を進め、
// 試合が発生したら15分ずつ最後まで進めて Highlight[] を採取する。
// ---------------------------------------------------------------------------
function resolveLife(s: State) {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function playOneMatch(seed: number): { s: State; highlights: Highlight[] } {
  let s = newGame('観測高校', seed);
  for (let i = 0; i < 40 && !s.match; i++) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    s = resolveLife(s);
    if (!s.pending) s = act(s, { type: 'train', training: 'balance' });
    if (s.pending) s = act(s, { type: 'start' });
  }
  assert.ok(s.match, '試合が開始しませんでした（テスト前提が崩れています）');
  while (!s.match!.done) s = act(s, { type: 'segment' });
  const highlights = s.match!.details.highlights.slice();
  return { s, highlights };
}

function assertWithinPitch(f: Frame) {
  assert.equal(f.players.length, 22, '常に自11+相手11=22人がいること');
  const selfCount = f.players.filter((p) => p.team === 'self').length;
  const oppoCount = f.players.filter((p) => p.team === 'oppo').length;
  assert.equal(selfCount, 11);
  assert.equal(oppoCount, 11);
  for (const p of f.players) {
    assert.ok(p.x >= 0 && p.x <= PITCH_W, `選手 ${p.id} の x=${p.x} がピッチ外`);
    assert.ok(p.y >= 0 && p.y <= PITCH_H, `選手 ${p.id} の y=${p.y} がピッチ外`);
  }
  assert.ok(Number.isFinite(f.ball.x) && Number.isFinite(f.ball.y));
}

function insideGoal(x: number, y: number, side0: boolean) {
  const onLine = side0 ? x === PITCH_W : x === 0;
  return onLine && Math.abs(y - GOAL_Y) < GOAL_HALF;
}
function outsideGoalBand(y: number) {
  return Math.abs(y - GOAL_Y) > GOAL_HALF;
}

// ---------------------------------------------------------------------------
// 1) 決定性: 同じ Highlight + State なら、何度呼んでも同じ軌跡になる。
// ---------------------------------------------------------------------------
void test('same highlight + state always produces the same trajectory (determinism)', () => {
  const { s, highlights } = playOneMatch(101);
  assert.ok(highlights.length > 0, 'この種では最低1件のハイライトが必要（前提が崩れていたらseedを変える）');
  const h = highlights[0];
  const seqA = buildSequence(h, s);
  const seqB = buildSequence(h, s);
  assert.deepEqual(seqA, seqB, 'buildSequence は同じ入力から同じ結果を返す必要がある');
  for (const t of [0, 0.1, 0.33, 0.6, 0.6001, 0.85, 0.851, 0.99, 1]) {
    const f1 = frameAt(seqA, t);
    const f2 = frameAt(buildSequence(h, s), t);
    assert.deepEqual(f1, f2, `t=${t} で軌跡が一致しない`);
  }
});

// ---------------------------------------------------------------------------
// 2) 22人+ボールが常に存在し、全フレームで選手の点がピッチ内に収まる。
// ---------------------------------------------------------------------------
void test('22 players + ball always exist, and every player dot stays on the pitch for every frame', () => {
  const seeds = [1, 2, 3, 4, 5, 11, 22, 33, 44, 55];
  let checked = 0;
  for (const seed of seeds) {
    const { s, highlights } = playOneMatch(seed);
    for (const h of highlights) {
      const seq = buildSequence(h, s);
      for (let i = 0; i <= 20; i++) {
        const f = frameAt(seq, i / 20);
        assertWithinPitch(f);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, '検証対象のフレームが1つもありませんでした');
});

void test('kickoffFrame (no highlight yet) also gives 22 players + ball, all on the pitch', () => {
  const s = newGame('キックオフ高校', 7);
  const f = kickoffFrame(s);
  assertWithinPitch(f);
  assert.equal(f.ball.x, PITCH_W / 2);
  assert.equal(f.ball.y, PITCH_H / 2);
});

// ---------------------------------------------------------------------------
// 3) 結果の不変条件: ゴールはゴール内、セーブはGK位置、枠外はゴール外。
// ---------------------------------------------------------------------------
void test('goal scenes end with the ball inside the correct goal mouth', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50];
  let goals = 0;
  for (const seed of seeds) {
    const { s, highlights } = playOneMatch(seed);
    for (const h of highlights.filter((h) => h.kind === 'goal')) {
      const seq = buildSequence(h, s);
      const f = frameAt(seq, 1);
      assert.ok(
        insideGoal(f.ball.x, f.ball.y, h.side === 0),
        `goal highlight ${h.id} (side ${h.side}) final ball ${JSON.stringify(f.ball)} is not inside the goal`,
      );
      goals++;
    }
  }
  assert.ok(goals > 0, 'ゴール場面が1件も採取できませんでした（前提が崩れています）');
});

void test('save scenes end with the ball exactly at the reacting goalkeeper position', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50];
  let saves = 0;
  for (const seed of seeds) {
    const { s, highlights } = playOneMatch(seed);
    for (const h of highlights.filter((h) => h.kind === 'save')) {
      const seq = buildSequence(h, s);
      const f = frameAt(seq, 1);
      const defendingTeam = seq.attackingTeam === 'self' ? 'oppo' : 'self';
      const gk = f.players.find((p) => p.team === defendingTeam && p.isGK)!;
      assert.equal(f.ball.x, gk.x, `save highlight ${h.id}: ball.x should equal GK.x`);
      assert.equal(f.ball.y, gk.y, `save highlight ${h.id}: ball.y should equal GK.y`);
      saves++;
    }
  }
  assert.ok(saves > 0, 'セーブ場面が1件も採取できませんでした（前提が崩れています）');
});

void test('miss scenes end with the ball outside the goal band', () => {
  // 現行のシミュレーションは goal/save のみを生成するため、miss は合成データで検証する。
  const s = newGame('検証高校', 9);
  const misses: Highlight[] = [
    { id: 'm-wide', minute: 12, kind: 'miss', side: 0, playerId: s.lineup[9], name: 'テスト選手', lane: 'wide' },
    { id: 'm-middle', minute: 34, kind: 'miss', side: 1, playerId: s.lineup[0], name: '対戦校', lane: 'middle' },
    { id: 'm-mixed', minute: 58, kind: 'miss', side: 0, playerId: s.lineup[8], name: 'テスト選手2', lane: 'mixed' },
  ];
  for (const h of misses) {
    const seq = buildSequence(h, s);
    const f = frameAt(seq, 1);
    assert.ok(outsideGoalBand(f.ball.y), `miss highlight ${h.id} final ball ${JSON.stringify(f.ball)} should be outside the goal band`);
  }
});

// ---------------------------------------------------------------------------
// 4) 結果の一致: buildSequence の outcome は Highlight.kind と食い違わない。
// ---------------------------------------------------------------------------
void test('sequence outcome always matches the highlight kind (no result drift on replay)', () => {
  const { s, highlights } = playOneMatch(3);
  for (const h of highlights) {
    const seq = buildSequence(h, s);
    const expected = h.kind === 'goal' ? 'goal' : h.kind === 'save' ? 'save' : 'miss';
    assert.equal(seq.outcome, expected);
  }
});

// ---------------------------------------------------------------------------
// 5) 実況テキスト・aria-label は決定的な純粋関数。
// ---------------------------------------------------------------------------
void test('commentary and aria label are deterministic pure text', () => {
  const h: Highlight = { id: 'x', minute: 23, kind: 'goal', side: 0, playerId: 5, name: '七瀬 悠', lane: 'middle' };
  assert.equal(commentaryFor(h), commentaryFor({ ...h }));
  assert.match(commentaryFor(h), /23′/);
  assert.match(commentaryFor(h), /七瀬 悠/);
  assert.equal(sceneAriaLabel(h), '前半23分、自チームのゴール場面');
  const h2: Highlight = { ...h, minute: 70, side: 1, kind: 'save' };
  assert.equal(sceneAriaLabel(h2), '後半70分、自チームGKのセーブ場面');
});

// ---------------------------------------------------------------------------
// 6) 陣形: 自チームのフォーメーション別に11人分の基準配置が壊れていない。
// ---------------------------------------------------------------------------
void test('formation base layout always yields 11 finite, on-pitch self positions per formation', () => {
  for (const formation of ['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'] as const) {
    let s = newGame('布陣高校', 12);
    s = act(s, { type: 'formation', formation });
    const f = kickoffFrame(s);
    const self = f.players.filter((p) => p.team === 'self');
    assert.equal(self.length, 11);
    for (const p of self) {
      assert.ok(p.x > 0 && p.x < PITCH_W);
      assert.ok(p.y > 0 && p.y < PITCH_H);
    }
    // GK must always be slot 0, deepest in their own half.
    const gk = self.find((p) => p.isGK)!;
    assert.ok(gk.x < PITCH_W / 2);
  }
});
