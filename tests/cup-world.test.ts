import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, validateSave, type State } from '../lib/game.ts';
import { readCompetition, drawPendingCup, advanceCupWeek, computeSeedIds, competitionFixture, resolveCompetitionMatch, hydrateCompetition, computeLeagueTable, type CupBracket } from '../lib/competition.ts';

function qualifiers(s: State): CupBracket {
  s.week = 6; drawPendingCup(s);
  for (const week of [8, 9, 10, 11]) { s.week = week; advanceCupWeek(s, week); }
  return readCompetition(s).ih.national!;
}

void test('V4-6: qualifiers use real school identities, mixed tiers and a nearby first opponent', () => {
  let gap = 0;
  for (let seed = 1; seed <= 48; seed++) {
    const s = newGame('県予選高校', seed * 17);
    const comp = readCompetition(s), bracket = comp.ih.qualifier!;
    assert.equal(bracket.teams.length, 16);
    assert.ok(new Set(bracket.teams.map((t) => t.tier)).size >= 3);
    for (const team of bracket.teams.filter((t) => t.id !== 'self')) {
      const school = comp.world.homeSchools.find((school) => school.id === team.id)!;
      assert.equal(team.strength, school.strength);
      assert.equal(team.tier, school.tier);
      assert.equal(school.isYouth, false);
    }
    s.week = 6; drawPendingCup(s);
    const self = bracket.teams.find((t) => t.id === 'self')!;
    gap += competitionFixture(s, 8)!.strength - self.strength;
  }
  assert.ok(Math.abs(gap / 48) <= 5, `mean first-round gap ${gap / 48}`);
});

void test('V4-6: representatives arrive on their final week, all 48 are needed before drawing', () => {
  const s = newGame('全国代表高校', 42), cup = readCompetition(s).ih;
  assert.equal(cup.national, undefined);
  assert.equal(cup.representatives!.districts.filter((d) => d.winner).length, 0);
  s.week = 6; drawPendingCup(s);
  for (const week of [8, 9, 10, 11]) {
    s.week = week; advanceCupWeek(s, week);
    for (const district of cup.representatives!.districts) assert.equal(!!district.winner, district.finalWeek <= week);
    if (week < 11) assert.equal(cup.national, undefined);
  }
  const national = cup.national!;
  assert.equal(national.teams.length, 48);
  assert.equal(new Set(national.teams.map((t) => t.districtId)).size, 48);
  assert.equal(national.drawn, false);
  s.week = 12; drawPendingCup(s);
  assert.equal(national.drawn, true);
  const byes = national.rounds[0].filter((m) => !m.homeId || !m.awayId);
  assert.equal(byes.length, 16);
  assert.deepEqual(new Set(byes.map((m) => m.homeId ?? m.awayId)), new Set(computeSeedIds(national, 16, false)));
  assert.ok(s.feed.some((line) => line.includes('初出場')));
});

void test('V4-6: save/resume preserves representatives and byes, six rounds finish and publish a champion', () => {
  let s = newGame('全国保存高校', 789);
  qualifiers(s); s.week = 12; drawPendingCup(s);
  const before = structuredClone(readCompetition(s).ih);
  s = validateSave(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(readCompetition(s).ih, before);
  const cup = readCompetition(s).ih;
  advanceCupWeek(s, 16);
  assert.ok(cup.national!.rounds[1].every((m) => m.homeId && m.awayId));
  for (const week of [17, 18, 19, 20, 21]) advanceCupWeek(s, week);
  assert.equal(cup.national!.completedRounds, 6);
  assert.ok(s.feed.some((line) => line.includes('全国優勝:')));
  assert.doesNotThrow(() => validateSave(JSON.parse(JSON.stringify(s))));
});

void test('V4-6: a seeded self has no phantom first-round fixture and only the sixth round awards a title', () => {
  const s = newGame('不戦勝高校', 42), comp = readCompetition(s);
  qualifiers(s);
  const cup = comp.ih, national = cup.national!;
  const local = national.teams.find((t) => t.districtId === comp.world.homeDistrictId)!;
  local.id = 'self'; local.name = s.school; local.strength = 99;
  cup.qualified = true; cup.alive = true;
  s.week = 12;
  const draw = drawPendingCup(s);
  assert.equal(draw?.firstRoundBye, true);
  assert.equal(competitionFixture(s, 16), null);
  advanceCupWeek(s, 16);
  assert.ok(competitionFixture(s, 17)?.opponent !== '勝者未定');
  const titles = s.records.trophies;
  const result = { fixture: { kind: 'ih_national', round: 4, label: '準決勝', opponent: '対戦校' }, home: 1, away: 0, won: true, penalties: null };
  resolveCompetitionMatch(s, result);
  assert.equal(s.records.trophies, titles);
  resolveCompetitionMatch(s, { ...result, fixture: { ...result.fixture, round: 5, label: '決勝' } });
  assert.equal(s.records.trophies, titles + 1);
  s.week = 21; s.day = 6;
  s.pending = competitionFixture(s, 21);
  assert.equal(s.pending!.round, 5);
  assert.doesNotThrow(() => validateSave(JSON.parse(JSON.stringify(s))), 'sixth-round fixture must survive loading');
});

void test('V4-6: other districts remain deterministic when the live match RNG changes', () => {
  const a = newGame('再現高校', 42), b = structuredClone(a);
  b.seed = 987654321;
  qualifiers(a); qualifiers(b);
  assert.deepEqual(readCompetition(a).ih.representatives!.districts.filter((d) => d.districtId !== readCompetition(a).world.homeDistrictId), readCompetition(b).ih.representatives!.districts.filter((d) => d.districtId !== readCompetition(b).world.homeDistrictId));
});

void test('V4-6: repeat representatives track appearances and previous semifinalists seed next season', () => {
  const s = newGame('連続出場高校', 42), comp = readCompetition(s);
  qualifiers(s);
  const entry = comp.ih.representatives!.districts.find((d) => d.winner!.id !== 'self')!;
  const winner = entry.winner!;
  entry.winner = null;
  comp.representativeHistory![`ih:${entry.districtId}:${winner.id}`] = { lastSeason: s.season - 1, appearances: 2, streak: 2 };
  delete comp.qualifierHistory![`ih:${entry.districtId}`];
  advanceCupWeek(s, 11);
  assert.equal(entry.winner!.id, winner.id);
  assert.equal(entry.appearances, 3);
  assert.equal(entry.streak, 3);
  const best4 = comp.qualifierHistory![`ih:${comp.world.homeDistrictId}`];
  s.season++; hydrateCompetition(s);
  assert.deepEqual(readCompetition(s).ih.qualifier!.previousBest4, best4);
  assert.equal(readCompetition(s).ih.national, undefined);
});

void test('V4-6: invalid representatives are rejected before rendering or continuing a save', () => {
  const s = newGame('不正代表高校', 42);
  readCompetition(s).ih.representatives!.districts[0].finalWeek = 47;
  assert.throws(() => validateSave(JSON.parse(JSON.stringify(s))), /代表/);
});

void test('V4-6: an old 32-school bracket and old league schedule survive loading until next spring', () => {
  let s = newGame('旧方式高校', 42), comp = readCompetition(s);
  const national = qualifiers(s);
  for (const key of ['ih', 'wc'] as const) delete comp[key].representatives;
  national.teams = national.teams.slice(0, 32);
  national.rounds = national.rounds.slice(1);
  comp.teamA.schedule.forEach((entry, i) => { entry.week = [0, 1, 3, 4, 5, 6, 7, 12, 14, 15, 21, 22, 23, 25][i]; });
  comp.teamA.played = 11; comp.teamA.draw = 11;
  const before = structuredClone(comp.teamA.schedule);
  const table = computeLeagueTable(s, comp, s.season);
  s = validateSave(JSON.parse(JSON.stringify(s))); comp = readCompetition(s);
  assert.deepEqual(comp.teamA.schedule, before);
  assert.deepEqual(computeLeagueTable(s, comp, s.season), table);
  assert.equal(competitionFixture(s, 21)?.kind, 'league');
  s.week = 12; drawPendingCup(s);
  for (const week of [16, 17, 18, 19, 20]) advanceCupWeek(s, week);
  assert.equal(comp.ih.national!.completedRounds, 5);
  s.season++; hydrateCompetition(s);
  assert.ok(comp.ih.representatives);
  assert.equal(comp.teamA.schedule.at(-1)!.week, 26);
});
