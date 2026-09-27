import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, validateSave } from '../lib/game.ts';
import { readCompetition, hydrateCompetition, LEAGUE_TIERS } from '../lib/competition.ts';
import { makeSchoolGoals, assessSchoolGoals, schoolGoalLabels, schoolGoalProgress } from '../lib/school-goals.ts';

void test('V4-8: school goals follow the current league and clearly describe the cup target', () => {
  const s = newGame('目標高校', 42), comp = readCompetition(s);
  for (const tier of LEAGUE_TIERS) {
    comp.teamA.tier = tier;
    const goals = makeSchoolGoals(s, comp), labels = schoolGoalLabels(goals);
    assert.equal(goals.tier, tier);
    assert.ok(labels.league.includes('リーグ'));
    assert.ok(labels.cup.includes(tier === 'regional' || tier === 'national' ? '全国' : '県予選'));
  }
});
void test('V4-8: assessment rewards each completed objective once, with a small bonus for both', () => {
  for (const count of [0, 1, 2]) {
    const s = newGame('評価高校', 42), comp = readCompetition(s);
    comp.teamA.played = 14; comp.teamA.draw = 14;
    comp.ih.qualifierRoundsWon = count > 0 ? 1 : 0;
    const funds = s.funds, reputation = s.reputation;
    assessSchoolGoals(s, comp, count === 2 ? 2 : 8);
    assert.equal(s.funds, funds + count);
    assert.equal(s.reputation, reputation + (count === 2 ? 0.1 : 0));
    assessSchoolGoals(s, comp, 1);
    assert.equal(s.funds, funds + count);
    const loaded = validateSave(JSON.parse(JSON.stringify(s)));
    assessSchoolGoals(loaded, readCompetition(loaded), 1);
    assert.equal(loaded.funds, s.funds);
  }
});
void test('V4-8: early standings are not a completed league goal, either cup may meet the OB goal', () => {
  const s = newGame('途中目標高校', 42), comp = readCompetition(s);
  comp.wc.qualifierRoundsWon = 1;
  const progress = schoolGoalProgress(s, comp, 1)!;
  assert.equal(progress.league, false);
  assert.equal(progress.cup, true);
});
void test('V4-8: old midseason saves start goals next spring; assessment stays visible after renewal', () => {
  const s = newGame('旧目標高校', 42);
  delete s.v3.competition.schoolGoals;
  const loaded = validateSave(JSON.parse(JSON.stringify(s)));
  assert.equal(readCompetition(loaded).schoolGoals, undefined);
  loaded.season++; hydrateCompetition(loaded);
  assert.equal(readCompetition(loaded).schoolGoals!.season, loaded.season);
  const comp = readCompetition(loaded);
  comp.ih.qualifierRoundsWon = 4;
  loaded.season++; hydrateCompetition(loaded);
  assert.equal(comp.schoolAssessment!.season, loaded.season - 1);
  assert.equal(comp.schoolGoals!.season, loaded.season);
});
