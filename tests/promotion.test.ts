import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, validateSave, act } from '../lib/game.ts';
import { readCompetition, competitionFixture, resolveCompetitionMatch, advanceCupWeek, getDistrictSchools, DISTRICTS } from '../lib/competition.ts';
import { preparePromotion, wonPromotion } from '../lib/promotion.ts';

function champion(tier: 'pref1' | 'regional' = 'pref1') {
  const s = newGame('参入戦高校', 42);
  const comp = readCompetition(s);
  comp.districtId = 'shizuoka';
  comp.teamA.tier = tier;
  if (tier === 'regional') for (const p of s.players) for (const stat of Object.keys(p.stats) as (keyof typeof p.stats)[]) p.stats[stat] = 95;
  const team = comp.teamA;
  team.played = 14; team.win = 14; team.draw = team.lose = team.ga = 0; team.gf = 42; team.points = 42;
  team.results = team.schedule.map((e) => ({ week: e.week, opponentId: team.clubs[e.clubIndex].id, opponentName: team.clubs[e.clubIndex].name, gf: 3, ga: 0 }));
  s.week = 43;
  preparePromotion(s, comp);
  return s;
}

void test('V4-5: all regions have four unique local entrants; eight regional champions contest two national places', () => {
  for (const district of DISTRICTS) {
    const s = newGame('地域検証', 42);
    const c = readCompetition(s);
    c.districtId = district.id; s.week = 43;
    preparePromotion(s, c);
    assert.equal(c.promotion!.regional!.teams.length, 4);
    assert.equal(new Set(c.promotion!.regional!.teams.map((t) => t.id)).size, 4);
    assert.equal(c.promotion!.national!.teams.length, 8);
    advanceCupWeek(s, 44); advanceCupWeek(s, 45);
    assert.equal(c.promotion!.regional!.rounds[1].filter((m) => m.winnerId).length, 1);
    assert.equal(c.promotion!.national!.rounds[1].filter((m) => m.winnerId).length, 2);
    validateSave(s);
    const corrupted = JSON.parse(JSON.stringify(s));
    corrupted.v3.competition.promotion.national.teams[0].style = 'invalid';
    assert.throws(() => validateSave(corrupted));
  }
});

void test('V4-5: a league champion needs two playoff wins; actual results and saves determine the next opponent', () => {
  for (const tier of ['pref1', 'regional'] as const) {
    const s = champion(tier);
    const c = readCompetition(s);
    const seed = s.seed;
    for (const week of [44, 45]) {
      s.week = week;
      const fixture = competitionFixture(s, week)!;
      assert.ok(fixture.kind.startsWith('promotion_'));
      resolveCompetitionMatch(s, { fixture, home: 2, away: 0, won: true, penalties: null });
      advanceCupWeek(s, week);
      const save = validateSave(JSON.parse(JSON.stringify(s)));
      assert.deepEqual(save.v3.competition.promotion, c.promotion);
    }
    assert.equal(s.seed, seed);
    assert.ok(wonPromotion(c, tier));
    s.season++;
    assert.equal(readCompetition(s).teamA.tier, tier === 'pref1' ? 'regional' : 'national');
  }
});

void test('V4-5: elimination stops fixtures and blocks automatic promotion even for first place', () => {
  const s = champion();
  s.week = 44;
  const fixture = competitionFixture(s, 44)!;
  resolveCompetitionMatch(s, { fixture, home: 0, away: 1, won: false, penalties: null });
  advanceCupWeek(s, 44);
  assert.equal(competitionFixture(s, 45), null);
  advanceCupWeek(s, 45);
  s.season++;
  assert.equal(readCompetition(s).teamA.tier, 'pref1');
});

void test('V4-5: legacy seasons keep automatic promotion; new seasons enable playoffs', () => {
  const s = champion();
  const c = readCompetition(s);
  delete c.promotion;
  const restored = validateSave(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.v3.competition.promotion, undefined);
  restored.season++;
  assert.equal(readCompetition(restored).teamA.tier, 'regional');
  assert.deepEqual(readCompetition(restored).promotion, { regional: null, national: null });
});

void test('V4-5: real playoff fixtures support kickoff, extra time engine, save and automatic finish', () => {
  const s = champion();
  s.week = 44; s.day = 6;
  s.pending = competitionFixture(s, 44);
  const started = act(s, { type: 'start' });
  validateSave(started);
  const end = act(started, { type: 'autoMatch' });
  assert.ok(end.match!.done);
  validateSave(end);
  assert.ok(end.v3.competition.promotion!.regional!.rounds[0].some((m) => m.winnerId));
});

void test('V4-5: school identities remain stable as match RNG advances and promotions carry across seasons', () => {
  const s = champion();
  const schools = getDistrictSchools(s, 'aomori');
  s.seed = (s.seed + 999) >>> 0;
  assert.deepEqual(getDistrictSchools(s, 'aomori'), schools);
  advanceCupWeek(s, 44); advanceCupWeek(s, 45);
  const c = readCompetition(s);
  const promoted = c.promotion!.regional!.rounds[1][0].winnerId!;
  s.season++;
  const next = readCompetition(s);
  if (promoted !== 'self') assert.equal(next.world.tierChanges![promoted], 'regional');
  assert.deepEqual(getDistrictSchools(s, 'aomori').map((p) => p.name), schools.map((p) => p.name));
  // A region remains playable even after several stored membership changes depleted its old pool.
  for (const school of getDistrictSchools(s, 'hokkaido')) next.world.tierChanges![school.id] = 'national';
  s.week = 43;
  preparePromotion(s, next);
  assert.equal(next.promotion!.national!.teams.length, 8);
});
