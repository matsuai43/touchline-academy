import { addFunds, clamp, type State } from './game.ts';
import { computeLeagueTable, tierInfo, type CompState, type LeagueTier } from './competition.ts';

export type SchoolGoals = { season: number; tier: LeagueTier; leagueRank: number; cupRounds: number; national: boolean };
export type SchoolAssessment = { season: number; league: boolean; cup: boolean; funds: number; reputation: number; leagueLabel: string; cupLabel: string };

export function makeSchoolGoals(s: State, comp: CompState): SchoolGoals {
  const tier = comp.teamA.tier;
  return { season: s.season, tier, leagueRank: tier === 'pref2' || tier === 'national' ? 2 : 1,
    cupRounds: tier === 'pref2' ? 1 : tier === 'pref1' ? 2 : tier === 'regional' ? 4 : 3, national: tier === 'national' };
}
export function schoolGoalLabels(goal: SchoolGoals): { league: string; cup: string } {
  return {
    league: `${tierInfo[goal.tier].name}リーグ${goal.leagueRank}位以内${goal.tier === 'pref2' ? '・県1部へ昇格' : goal.tier !== 'national' ? '・参入戦へ' : ''}`,
    cup: goal.national ? '全国大会ベスト8' : goal.cupRounds === 4 ? '全国大会出場' : goal.cupRounds === 2 ? '県予選ベスト4' : '県予選で1勝',
  };
}
export function schoolGoalProgress(s: State, comp: CompState, rank?: number) {
  const goal = comp.schoolGoals;
  if (!goal) return null;
  const standing = rank ?? computeLeagueTable(s, comp, comp.seasonGenerated).rows.findIndex((row) => row.isSelf) + 1;
  const rounds = Math.max(...[comp.ih, comp.wc].map((cup) => goal.national ? cup.nationalRoundsWon : cup.qualifierRoundsWon));
  return { league: comp.teamA.played === 14 && standing <= goal.leagueRank, cup: rounds >= goal.cupRounds, rank: standing, rounds };
}
export function assessSchoolGoals(s: State, comp: CompState, rank: number): void {
  const goal = comp.schoolGoals;
  if (!goal || comp.schoolAssessment?.season === goal.season) return;
  const progress = schoolGoalProgress(s, comp, rank)!;
  const count = Number(progress.league) + Number(progress.cup);
  const labels = schoolGoalLabels(goal);
  comp.schoolAssessment = { season: goal.season, league: progress.league, cup: progress.cup, funds: count, reputation: count === 2 ? 0.1 : 0, leagueLabel: labels.league, cupLabel: labels.cup };
  if (count) addFunds(s, count, `${goal.season}年目・学校からの目標達成支援`);
  if (count === 2) s.reputation = clamp(s.reputation + 0.1);
  s.feed = [`${goal.season}年目の学校評価: ${count}/2目標達成。翌季の部費+${count}・評判+${count === 2 ? 0.1 : 0}。`, ...s.feed].slice(0, 30);
}
export function validateSchoolGoals(comp: CompState): void {
  const g = comp.schoolGoals, a = comp.schoolAssessment;
  if (g && (!Number.isInteger(g.season) || g.season < 1 || !Object.hasOwn(tierInfo, g.tier) || ![1, 2].includes(g.leagueRank) || ![1, 2, 3, 4].includes(g.cupRounds) || typeof g.national !== 'boolean')) throw Error('学校目標データが不正です。');
  if (a && (!Number.isInteger(a.season) || a.season < 1 || typeof a.league !== 'boolean' || typeof a.cup !== 'boolean' || ![0, 1, 2].includes(a.funds) || ![0, 0.1].includes(a.reputation) || typeof a.leagueLabel !== 'string' || a.leagueLabel.length > 100 || typeof a.cupLabel !== 'string' || a.cupLabel.length > 100)) throw Error('学校評価データが不正です。');
}
