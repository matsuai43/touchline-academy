// T-12: 大会の組み合わせ抽選。
// - 抽選前は出場校の一覧だけが分かり、対戦（rounds[0]）は未定（homeId/awayId とも null）。
// - 抽選（drawPendingCup）でシード校が互いに別の組に分かれ、対戦が確定する。
// - 決定性（同じセーブ・同じ操作なら同じ抽選結果）。
// - 旧セーブ互換（drawn 未導入の表はそのまま続行し、翌シーズンから抽選対象になる）。
// - 週送りの自動進行（autoWeek）は抽選イベントでいったん止まる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, validateSave, type State } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import {
  readCompetition,
  hydrateCompetition,
  drawPendingCup,
  computeSeedIds,
  IH_QUALIFIER_DRAW_WEEK,
  IH_NATIONAL_DRAW_WEEK,
  type CupBracket,
} from '../lib/competition.ts';

void test('T-12: 抽選前は組み合わせ未定で、出場校の一覧だけ分かる', () => {
  const s = newGame('抽選前検証高校', 8);
  const bracket = readCompetition(s).ih.qualifier!;
  assert.equal(bracket.drawn, false);
  assert.equal(bracket.teams.length, 16);
  assert.ok(bracket.teams.some((t) => t.id === 'self'));
  for (const m of bracket.rounds[0]) {
    assert.equal(m.homeId, null);
    assert.equal(m.awayId, null);
  }
});

/** 1回戦の試合インデックス(0始まり)から、その試合がどの「組」に属すかを返す。
 *  グループサイズは常に4枠(2試合)なので、県予選(シード4/16校)・全国(シード8/32校)の
 *  どちらでも同じ式で「別の組に分かれているか」を検証できる。 */
function groupOf(matchIndex: number): number {
  return Math.floor(matchIndex / 2);
}
function matchIndexOf(bracket: CupBracket, id: string): number {
  return bracket.rounds[0].findIndex((m) => m.homeId === id || m.awayId === id);
}

void test('T-12: 抽選でシード校（初年度は強さ上位）が互いに別の組に分かれる（県予選=ベスト4/全国=ベスト8まで対戦しない）', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = newGame('シード検証高校', seed);
    const comp = readCompetition(s);
    // 県予選: 強さ上位4校
    s.week = IH_QUALIFIER_DRAW_WEEK;
    const qualifier = comp.ih.qualifier!;
    // シード集合そのものは strength の同点をどう並べ替えるかに依存するため、
    // 抽選前に実装と同じ computeSeedIds() で求めてから抽選する（初年度=history無しなので
    // forceSelf は常にfalseと同じ結果になる）。
    const qSeeds = computeSeedIds(qualifier, 4, false);
    drawPendingCup(s);
    const qGroups = qSeeds.map((id) => groupOf(matchIndexOf(qualifier, id)));
    assert.equal(new Set(qGroups).size, 4, `県予選のシード4校が同じ組に入っています: ${qGroups.join(',')}`);

    // 全国大会: 強さ上位8校（自校が出場していなくても、抽選そのものは季初に確定した
    // 出場校リストで行える）
    s.week = IH_NATIONAL_DRAW_WEEK;
    const national = comp.ih.national!;
    const nSeeds = computeSeedIds(national, 8, false);
    drawPendingCup(s);
    const nGroups = nSeeds.map((id) => groupOf(matchIndexOf(national, id)));
    assert.equal(new Set(nGroups).size, 8, `全国大会のシード8校が同じ組に入っています: ${nGroups.join(',')}`);
  }
});

void test('T-12: 抽選は決定的（同じセーブ・同じ操作なら同じ組み合わせ）', () => {
  function draw(): CupBracket {
    const s = newGame('決定性検証高校', 321);
    s.week = IH_QUALIFIER_DRAW_WEEK;
    drawPendingCup(s);
    return readCompetition(s).ih.qualifier!;
  }
  const a = draw();
  const b = draw();
  assert.deepEqual(a.rounds[0], b.rounds[0]);
  assert.deepEqual(a.teams, b.teams);
  assert.equal(a.drawn, true);
});

void test('T-12: 前回大会でベスト4に勝ち上がった学校は、強さに関わらず翌シーズンの県予選でシードになる', () => {
  const s = newGame('シード実績検証高校', 999);
  const comp = readCompetition(s);
  const bracket = comp.ih.qualifier!;
  const selfTeam = bracket.teams.find((t) => t.id === 'self')!;
  // わざと最弱にして、強さ上位だけではシードに入らないようにする。
  selfTeam.strength = 1;
  // 前回大会（history[0]）で県予選ベスト4（準々決勝突破=2回戦分）まで勝ち上がった実績。
  comp.history.unshift({
    season: comp.seasonGenerated || 1,
    districtId: comp.districtId,
    tierA: 'pref2',
    rankA: null,
    pointsA: 0,
    tierB: null,
    ihBest: '準決勝敗退',
    wcBest: '県予選敗退',
    ihQualifierRounds: 2,
    ihNationalRounds: 0,
    wcQualifierRounds: 0,
    wcNationalRounds: 0,
  });
  s.week = IH_QUALIFIER_DRAW_WEEK;
  const result = drawPendingCup(s);
  assert.ok(result, '自校は県予選に出場しているので抽選結果が返るはず');
  assert.equal(result!.seeded, true, '前回ベスト4の実績で今季もシードになるはず');
});

void test('T-12: 旧セーブ互換（drawn未導入の表はそのまま続行し、翌シーズンの表は抽選対象で生成される）', () => {
  const s = newGame('旧セーブ互換検証高校', 55);
  const comp = readCompetition(s);
  const bracket = comp.ih.qualifier!;
  // T-12導入前を模して、既に組み合わせが決まっている（drawnフィールドが無い）状態を作る。
  bracket.rounds[0].forEach((m, i) => {
    m.homeId = bracket.teams[i * 2].id;
    m.awayId = bracket.teams[i * 2 + 1].id;
  });
  delete (bracket as Partial<CupBracket>).drawn;
  const raw = JSON.parse(JSON.stringify(s));
  const loaded = validateSave(raw);
  // 進行中の季はそのまま（drawnはtrueで補われ、追加の抽選は起きない）。
  assert.equal(readCompetition(loaded).ih.qualifier!.drawn, true);
  loaded.week = IH_QUALIFIER_DRAW_WEEK;
  assert.equal(drawPendingCup(loaded), null);
  // 翌シーズンに切り替わると、新しい表は drawn:false（抽選対象）で生成される。
  loaded.season = (loaded.season ?? 1) + 1;
  hydrateCompetition(loaded);
  assert.equal(readCompetition(loaded).ih.qualifier!.drawn, false);
});

void test('T-12: 週送りの自動進行(autoWeek)は抽選イベントでいったん止まり、閉じると再開できる', () => {
  let s: State = newGame('自動進行停止検証高校', 7);
  let guard = 0;
  while (!s.cupDraw && guard++ < 60) {
    if (s.pending) {
      s = act(s, { type: 'start' });
      while (!s.match!.done) s = act(s, { type: 'segment' });
      s = act(s, { type: 'finish' });
      continue;
    }
    if (s.event) {
      s = act(s, { type: 'event', choice: 'team' });
      continue;
    }
    const cur = getCurrentLifeEvent(s);
    if (cur) {
      s = act(s, { type: 'life', choiceId: cur.event.choices[0].id });
      continue;
    }
    s = act(s, { type: 'autoWeek' });
  }
  assert.ok(s.cupDraw, '抽選イベントで止まっているはず');
  assert.equal(s.day, 6, '抽選イベント中はまだ試合日の判定前(day===6)のはず');
  assert.throws(
    () => act(s, { type: 'autoWeek' }),
    '抽選イベントを閉じるまでは自動進行できないはず',
  );
  assert.throws(
    () => act(s, { type: 'train', training: 'rest' }),
    '抽選イベントを閉じるまでは練習も進められないはず',
  );
  const closed = act(s, { type: 'cupDrawAck' });
  assert.equal(closed.cupDraw, null);
  // 抽選を閉じたあとは、通常どおり進行できる（抽選週にちょうど試合が組まれていれば
  // それを消化し、無ければ次の週へ進む。いずれにせよ週は先へ進む）。
  let after: State = closed;
  let guard2 = 0;
  while (after.week === closed.week && guard2++ < 20) {
    if (after.pending) {
      after = act(after, { type: 'start' });
      while (!after.match!.done) after = act(after, { type: 'segment' });
      after = act(after, { type: 'finish' });
      continue;
    }
    if (after.event) {
      after = act(after, { type: 'event', choice: 'team' });
      continue;
    }
    const cur = getCurrentLifeEvent(after);
    if (cur) {
      after = act(after, { type: 'life', choiceId: cur.event.choices[0].id });
      continue;
    }
    if (after.cupDraw) {
      after = act(after, { type: 'cupDrawAck' });
      continue;
    }
    after = act(after, { type: 'autoWeek' });
  }
  assert.ok(after.week > closed.week, '抽選を閉じたあとは週が進むはず');
});
