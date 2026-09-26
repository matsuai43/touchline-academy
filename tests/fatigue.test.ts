import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, type State, type Player } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';

// DESIGN_V4 5.2 の受け入れ条件（長期シミュレーション、複数シード、ハイプレス＋おまかせ編成）:
//  - 先発の疲労が80を超える週が全体の5%未満
//  - 疲労が100に達する選手がいない
//  - 「先発の平均疲労」と「最も疲れた先発」の差が常時30を超えない
// 測定点は「各試合の開始直後（試合開始時点の先発11人）」に統一する。
function starters(s: State): Player[] {
  return s.lineup
    .map((id) => s.players.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
}

function simulateSeasons(seed: number, seasons: number) {
  let s = newGame('疲労シミュレーション高校', seed);
  (s as { autoLineupPolicy: string }).autoLineupPolicy = 'overall';
  (s as { autoLineupOnMatch: boolean }).autoLineupOnMatch = true;
  let starterWeeks = 0;
  let over80Weeks = 0;
  let maxFatigueSeen = 0;
  let maxGapSeen = 0;
  let guard = 0;
  while (s.season <= seasons && guard++ < 60000) {
    if (s.match) {
      // ハイプレスで固定し、疲労が最も出やすい条件でシミュレーションする。
      if (s.match.tactic !== 'press') s = act(s, { type: 'tactic', tactic: 'press' });
      s = act(s, s.match.done ? { type: 'finish' } : { type: 'segment' });
    } else if (s.pending) {
      s = act(s, { type: 'start' });
      const list = starters(s);
      if (list.length) {
        starterWeeks++;
        const avg = list.reduce((a, p) => a + p.fatigue, 0) / list.length;
        const worst = list.reduce((a, p) => (p.fatigue > a.fatigue ? p : a));
        if (worst.fatigue > 80) over80Weeks++;
        maxFatigueSeen = Math.max(maxFatigueSeen, worst.fatigue);
        maxGapSeen = Math.max(maxGapSeen, worst.fatigue - avg);
      }
    } else if (s.event) {
      s = act(s, { type: 'event', choice: 'team' });
    } else if ((s as { cupDraw?: unknown }).cupDraw) {
      s = act(s, { type: 'cupDrawAck' } as never);
    } else {
      const life = getCurrentLifeEvent(s);
      s = life
        ? act(s, { type: 'life', choiceId: life.event.choices[0].id } as never)
        : act(s, { type: 'autoWeek' } as never);
    }
  }
  assert.ok(guard < 60000, `seed ${seed} stopped progressing`);
  return { starterWeeks, over80Weeks, maxFatigueSeen, maxGapSeen };
}

void test('V4-1(5.2): high press + auto lineup keeps starter fatigue under control over multiple seasons', () => {
  const seeds = [1, 2, 3, 4, 5];
  let totalStarterWeeks = 0;
  let totalOver80 = 0;
  let overallMaxFatigue = 0;
  let overallMaxGap = 0;
  for (const seed of seeds) {
    const { starterWeeks, over80Weeks, maxFatigueSeen, maxGapSeen } = simulateSeasons(seed, 4);
    totalStarterWeeks += starterWeeks;
    totalOver80 += over80Weeks;
    overallMaxFatigue = Math.max(overallMaxFatigue, maxFatigueSeen);
    overallMaxGap = Math.max(overallMaxGap, maxGapSeen);
    assert.ok(starterWeeks > 0, `seed ${seed}: no starter-weeks measured`);
  }
  const over80Rate = totalOver80 / totalStarterWeeks;
  assert.ok(
    over80Rate < 0.05,
    `starter-weeks with a starter over fatigue 80: ${totalOver80}/${totalStarterWeeks} = ${over80Rate}`,
  );
  assert.ok(overallMaxFatigue < 100, `a starter reached fatigue >= 100: ${overallMaxFatigue}`);
  assert.ok(overallMaxGap <= 30, `starter avg vs most-tired starter gap exceeded 30: ${overallMaxGap}`);
});
