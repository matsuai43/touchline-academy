import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, autoLineup, GROWTH_MIN_PROF, type State } from '../lib/game.ts';
import { formationSlots } from '../lib/squad.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';

// ユーザー報告（2026-09-26）: 育成重視で編成すると習熟度G（19以下）の選手が枠に入ることがあった。
// 育成重視でも、その枠の習熟度がD（50）未満の選手は、候補がほかにいる限り起用しない。
function checkLineup(s: State, label: string) {
  const slots = formationSlots(s.formation);
  const teamA = s.players.filter((p) => s.v3.squad.players[p.id]?.team === 'A' && !p.injury);
  s.lineup.forEach((id, i) => {
    const slot = slots[i];
    const prof = s.v3.squad.players[id].prof[slot] ?? 0;
    const min = slot === 'GK' ? 60 : GROWTH_MIN_PROF;
    if (prof >= min) return;
    // 基準を満たす選手がほかに空いていた場合は不合格。
    const available = teamA.filter(
      (p) => !s.lineup.includes(p.id) && (s.v3.squad.players[p.id].prof[slot] ?? 0) >= min,
    );
    assert.equal(available.length, 0, `${label}: ${slot} に習熟度${Math.round(prof)}の選手が起用され、基準を満たす${available.length}人が控えにいる`);
  });
}

void test('growth-focused lineups never field a player below rank D in a slot when a qualified player is available', () => {
  for (const formation of ['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      let s = newGame('育成重視検証高校', seed);
      s = act(s, { type: 'formation', formation });
      autoLineup(s, 'growth');
      checkLineup(s, `${formation} seed${seed} 初期`);
    }
  }
  // シーズンが進み部員の顔ぶれが変わっても同じ（育成重視の自動編成で2シーズン進める）。
  for (const seed of [3, 8]) {
    let s = newGame('育成重視検証高校', seed);
    (s as { autoLineupPolicy: string }).autoLineupPolicy = 'growth';
    (s as { autoLineupOnMatch: boolean }).autoLineupOnMatch = true;
    let guard = 0;
    while (s.season <= 2 && guard++ < 20000) {
      if (s.match) s = act(s, s.match.done ? { type: 'finish' } : { type: 'segment' });
      else if (s.pending) {
        s = act(s, { type: 'start' });
        checkLineup(s, `seed${seed} S${s.season} 第${s.week}週`);
      } else if (s.event) s = act(s, { type: 'event', choice: 'team' });
      else if ((s as { cupDraw?: unknown }).cupDraw) s = act(s, { type: 'cupDrawAck' } as never);
      else {
        const life = getCurrentLifeEvent(s);
        s = life
          ? act(s, { type: 'life', choiceId: life.event.choices[0].id } as never)
          : act(s, { type: 'autoWeek' } as never);
      }
    }
    assert.ok(guard < 20000, `seed ${seed} stopped progressing`);
  }
});

void test('thinSlots reports a formation slot with no rank-D candidate in the A team, and nothing when every slot is covered', async () => {
  const { thinSlots } = await import('../lib/squad.ts');
  const s = newGame('手薄枠検証高校', 1);
  // 初期メンバーはポジションが均衡しているので、どの布陣でも手薄な枠は無い。
  for (const f of ['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'] as const) assert.deepEqual(thinSlots(s, f), []);
  // 右ウイングにD以上の選手がいない状況を作ると、その枠だけが返る。
  for (const p of s.players) {
    const prof = s.v3.squad.players[p.id].prof;
    if ((prof.RWG ?? 0) >= 50) prof.RWG = 30;
  }
  assert.deepEqual(thinSlots(s, '4-3-3'), ['RWG']);
  assert.deepEqual(thinSlots(s, '4-4-2'), []); // 4-4-2 には右ウイングの枠が無い
});
