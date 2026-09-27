import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, validateSave, type State } from '../lib/game.ts';
import { readCompetition, competitionFixture } from '../lib/competition.ts';
import { currentFriendlyOffer, FRIENDLY_CHOICES } from '../lib/friendlies.ts';
import { districtRegion } from '../lib/school-world.ts';
import { matchXpMultiplier } from '../lib/match-stats.ts';

function ready(seed = 42): State { const s = newGame('練習試合高校', seed); s.week = 1; readCompetition(s); return s; }

void test('V4-7: four distinct world schools, nearby peers and another-region expedition', () => {
  let gap = 0;
  for (let seed = 1; seed <= 48; seed++) {
    const s = ready(seed), comp = readCompetition(s), offer = currentFriendlyOffer(s, comp)!;
    assert.equal(offer.week, 2);
    assert.equal(new Set(offer.candidates.map((c) => c.school.id)).size, 4);
    const peer = offer.candidates.find((c) => c.choice === 'peer')!;
    gap += Math.abs(peer.school.strength - offer.rating);
    assert.equal(peer.school.districtId, comp.districtId);
    const away = offer.candidates.find((c) => c.choice === 'away')!;
    assert.notEqual(districtRegion(away.school.districtId).region, districtRegion(comp.districtId).region);
  }
  assert.ok(gap / 48 <= 3, `mean peer gap ${gap / 48}`);
});

void test('V4-7: offers freeze, selection survives reload and every choice costs no funds', () => {
  for (const choice of [...FRIENDLY_CHOICES, 'rest'] as const) {
    let s = ready(); const funds = s.funds;
    const initial = structuredClone(currentFriendlyOffer(s, readCompetition(s))!.candidates);
    s = act(s, { type: 'friendlyChoice', choice });
    s.seed += 123; s.players[0].fatigue = 50;
    s = validateSave(JSON.parse(JSON.stringify(s)));
    const offer = currentFriendlyOffer(s, readCompetition(s))!;
    assert.deepEqual(offer.candidates, initial);
    assert.equal(offer.choice, choice);
    assert.equal(s.funds, funds);
    const fixture = competitionFixture(s, 2);
    if (choice === 'rest') assert.equal(fixture, null);
    else assert.equal(fixture!.opponent, initial.find((c) => c.choice === choice)!.school.name);
  }
});

void test('V4-7: skipping leaves Sunday for recovery, with no match or XP award', () => {
  let s = act(ready(), { type: 'friendlyChoice', choice: 'rest' });
  s.week = 2; s.day = 5;
  for (const player of s.players) player.fatigue = 60;
  const games = s.records.games;
  s = act(s, { type: 'train', training: 'rest' });
  assert.equal(s.week, 3);
  assert.equal(s.pending, null);
  assert.equal(s.records.games, games);
  assert.ok(s.players.every((player) => player.fatigue < 30));
  assert.ok(s.feed.some((line) => line.includes('日曜日は休養')));
});

void test('V4-7: default is the offered peer; choosing after the deadline is rejected', () => {
  const s = ready(), offer = currentFriendlyOffer(s, readCompetition(s))!;
  const peer = offer.candidates.find((c) => c.choice === 'peer')!;
  assert.equal(competitionFixture(s, 2)!.opponent, peer.school.name);
  s.week = 2;
  assert.throws(() => act(s, { type: 'friendlyChoice', choice: 'away' }), /前の週/);
  assert.throws(() => act(newGame('期間外高校', 42), { type: 'friendlyChoice', choice: 'peer' }), /前の週/);
});

void test('V4-7: preview XP is the applied multiplier and extra fatigue accrues only for players on the pitch', () => {
  const s = ready();
  s.day = 6; s.pending = competitionFixture(s, 2)!;
  const base = act(s, { type: 'start' });
  const extra = structuredClone(base);
  extra.match!.fixture.friendlyFatigue = 4;
  const played = act(base, { type: 'segment' });
  const travelled = act(extra, { type: 'segment' });
  for (const player of played.players) {
    const actual = travelled.players.find((p) => p.id === player.id)!;
    assert.ok(Math.abs(actual.fatigue - player.fatigue - (base.lineup.includes(player.id) ? 4 / 6 : 0)) < 1e-8);
  }
  assert.equal(matchXpMultiplier(extra.match!, 10), 0.8 * extra.match!.fixture.friendlyXp!);
  assert.equal(matchXpMultiplier(extra.match!, 90), matchXpMultiplier(extra.match!, 10));
});

void test('V4-7: old pending fixtures remain intact and malformed offers are rejected', () => {
  const s = ready(); s.day = 6;
  s.pending = { kind: 'friendly', round: 0, strength: 50, label: '練習試合', opponent: '旧対戦高校', style: 'balanced' };
  delete s.v3.competition.friendlies;
  const loaded = validateSave(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(loaded.pending, s.pending);
  loaded.v3.competition.friendlies!.offers[2].candidates[0].xp = 99;
  assert.throws(() => validateSave(JSON.parse(JSON.stringify(loaded))), /候補/);
});
