import { strength, tactics, FORMATIONS, type State } from './game.ts';
import {
  computeLeagueTable, districtRegion, districtsInRegion, DISTRICTS, getDistrictSchools,
  simulateCupMatch, simulateGoalsBySegment, type CompState, type CupBracket, type CupTeam,
  type CompFixture, type LeagueTier, type ResolvableMatch,
} from './competition.ts';
import type { WorldSchool } from './school-world.ts';

export const PROMOTION_WEEKS = [44, 45];
export type PromotionState = { regional: CupBracket | null; national: CupBracket | null };

function asTeam(p: WorldSchool): CupTeam {
  return { id: p.id, name: p.name, districtId: p.districtId, tier: p.tier, strength: p.strength, style: p.tactic };
}
function leaguePool(s: State, ids: string[], tier: 'pref1' | 'regional'): CupTeam[] {
  const all = ids.flatMap((id) => getDistrictSchools(s, id));
  const target = tier === 'pref1' ? 62 : 73;
  // Populate an otherwise untracked league's vacancies from the nearest lower-tier schools.
  return all.sort((a, b) => Number(b.tier === tier) - Number(a.tier === tier) ||
    Math.abs(a.strength - target) - Math.abs(b.strength - target) || a.id.localeCompare(b.id)).slice(0, 8)
    .map((p) => ({ ...asTeam(p), tier }));
}
/** Other leagues use the same scoring curve and a frozen season seed. */
function standings(s: State, teams: CupTeam[], salt: number): CupTeam[] {
  const rows = teams.map((team) => ({ team, points: 0, gd: 0, gf: 0 }));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) for (let leg = 0; leg < 2; leg++) {
    const { home, away } = simulateGoalsBySegment([s.seed, s.season, salt, i, j, leg], teams[i].strength, teams[j].strength, 0, 6);
    rows[i].points += home > away ? 3 : home === away ? 1 : 0;
    rows[j].points += away > home ? 3 : home === away ? 1 : 0;
    rows[i].gd += home - away; rows[j].gd += away - home;
    rows[i].gf += home; rows[j].gf += away;
  }
  return rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.id.localeCompare(b.team.id)).map((r) => r.team);
}
function actualStandings(s: State, comp: CompState): CupTeam[] {
  return computeLeagueTable(s, comp).rows.map((row) => {
    if (row.isSelf) return { id: 'self', name: s.school, strength: strength(s), style: 'balanced', districtId: comp.districtId, tier: comp.teamA.tier };
    const club = comp.teamA.clubs.find((c) => c.id === row.teamId)!;
    return { id: club.id, name: club.name, strength: club.strength, style: 'balanced', districtId: club.districtId ?? comp.districtId, tier: comp.teamA.tier };
  });
}
function bracket(teams: CupTeam[]): CupBracket {
  return { teams, completedRounds: 0, drawn: true, rounds: [0, 1].map((r) => Array.from({ length: teams.length >> (r + 1) }, (_, i) => ({
    homeId: r === 0 ? teams[i * 2].id : null, awayId: r === 0 ? teams[i * 2 + 1].id : null,
    winnerId: null, home: null, away: null, penalties: null,
  }))) };
}
/** Only created after the league ends; old saves without promotion retain their season's rules. */
export function preparePromotion(s: State, comp: CompState): void {
  if (!comp.promotion || comp.promotion.regional || s.week < 43) return;
  const frozen = { ...s, seed: comp.teamA.scheduleSeed };
  const ownRegion = districtRegion(comp.districtId).region;
  const districtRows = districtsInRegion(ownRegion).map((id, i) => {
    if (id === comp.districtId && comp.teamA.tier === 'pref1') return actualStandings(s, comp);
    return standings(frozen, leaguePool(frozen, [id], 'pref1'), 91000 + i);
  });
  const champions = districtRows.map((rows) => rows[0]).filter((p): p is CupTeam => !!p);
  // Four entrants, with local runners-up filling regions that contain fewer than four districts.
  const regional = champions.sort((a, b) => Number(b.id === 'self') - Number(a.id === 'self') || b.strength - a.strength).slice(0, 4);
  for (const candidate of districtRows.flatMap((rows) => rows.slice(1)).filter((p) => p.id !== 'self').sort((a, b) => b.strength - a.strength)) {
    if (regional.length === 4) break;
    if (!regional.some((p) => p.id === candidate.id)) regional.push(candidate);
  }
  comp.promotion.regional = bracket(regional);
  const regions = [...new Set(DISTRICTS.map((d) => districtRegion(d.id).region))];
  const national = regions.map((region, i) => {
    if (region === ownRegion && comp.teamA.tier === 'regional') return actualStandings(s, comp)[0];
    return standings(frozen, leaguePool(frozen, districtsInRegion(region), 'regional'), 92000 + i)[0];
  }).sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id)).slice(0, 8);
  comp.promotion.national = bracket(national);
  s.feed = ['参入戦の組み合わせが決定。2勝で上のリーグへ昇格します。', ...s.feed].slice(0, 30);
}

export function promotionFixture(s: State, comp: CompState, week: number): CompFixture | null {
  const round = PROMOTION_WEEKS.indexOf(week);
  if (round < 0 || !comp.promotion) return null;
  for (const stage of ['regional', 'national'] as const) {
    const b = comp.promotion[stage];
    const row = b?.rounds[round]?.find((m) => m.homeId === 'self' || m.awayId === 'self');
    if (!row || row.winnerId) continue;
    const opponent = b!.teams.find((p) => p.id === (row.homeId === 'self' ? row.awayId : row.homeId));
    if (!opponent) return null;
    return { label: `${stage === 'regional' ? '地域' : '全国'}参入戦・${round === 0 ? '1回戦' : '昇格決定戦'}`,
      kind: stage === 'regional' ? 'promotion_regional' : 'promotion_national', round,
      opponent: opponent.name, strength: opponent.strength, style: opponent.style, formation: opponent.formation ?? '4-4-2',
      opponentDistrictId: opponent.districtId, opponentTier: opponent.tier };
  }
  return null;
}

export function recordPromotion(comp: CompState, m: ResolvableMatch): void {
  const stage = m.fixture.kind === 'promotion_regional' ? 'regional' : 'national';
  const b = comp.promotion?.[stage];
  const row = b?.rounds[m.fixture.round]?.find((r) => r.homeId === 'self' || r.awayId === 'self');
  if (!row) return;
  const home = row.homeId === 'self';
  Object.assign(row, { home: home ? m.home : m.away, away: home ? m.away : m.home,
    winnerId: m.won ? 'self' : home ? row.awayId : row.homeId,
    penalties: home || !m.penalties ? m.penalties : m.penalties.split(' - ').reverse().join(' - ') });
}

export function advancePromotionWeek(s: State, comp: CompState, week: number): void {
  const round = PROMOTION_WEEKS.indexOf(week);
  if (!comp.promotion || round < 0) return;
  for (const stage of ['regional', 'national'] as const) {
    const b = comp.promotion[stage];
    if (!b || b.completedRounds > round) continue;
    b.rounds[round].forEach((row, i) => {
      if (!row.winnerId) {
        const a = b.teams.find((p) => p.id === row.homeId)!;
        const rival = b.teams.find((p) => p.id === row.awayId)!;
        if (!a || !rival) throw Error('参入戦の勝ち上がりが不正です。');
        Object.assign(row, simulateCupMatch({ ...s, seed: comp.teamA.scheduleSeed }, 'wc', stage === 'national', round, 100 + i, a, rival));
      }
      if (round === 0) b.rounds[1][Math.floor(i / 2)][i % 2 ? 'awayId' : 'homeId'] = row.winnerId;
    });
    b.completedRounds = round + 1;
    if (round === 1) s.feed = [`${stage === 'regional' ? '地域' : '全国'}参入戦：${b.rounds[1].map((r) => b.teams.find((p) => p.id === r.winnerId)!.name).join('・')}が昇格。`, ...s.feed].slice(0, 30);
  }
}
export function wonPromotion(comp: CompState, tier: LeagueTier): boolean {
  const b = comp.promotion?.[tier === 'pref1' ? 'regional' : 'national'];
  return !!b?.rounds[1].some((m) => m.winnerId === 'self');
}

/** B-team playoffs are simulated with the same two rounds, subject to the A-team tier ceiling. */
export function bTeamPromotion(s: State, comp: CompState, rating: number): boolean {
  const team = comp.teamB!;
  const seed = team.scheduleSeed;
  const self: CupTeam = { id: 'self-B', name: `${s.school} B`, districtId: comp.districtId, tier: team.tier, strength: rating, style: 'balanced' };
  const pool = team.clubs.slice().sort((a, b) => b.strength - a.strength);
  for (let round = 0; round < 2; round++) {
    const rival = pool[round];
    const opponent: CupTeam = { id: rival.id, name: rival.name, strength: rival.strength, districtId: rival.districtId ?? comp.districtId, tier: team.tier, style: 'balanced' };
    const result = simulateCupMatch({ ...s, seed, season: comp.seasonGenerated }, 'wc', team.tier === 'regional', round, 900, self, opponent);
    s.feed = [`Bチーム参入戦 ${round + 1}回戦：${self.name} ${result.home} - ${result.away} ${opponent.name}${result.penalties ? `（PK ${result.penalties}）` : ''}`, ...s.feed].slice(0, 30);
    if (result.winnerId !== self.id) return false;
  }
  return true;
}

export function validatePromotion(p: PromotionState): void {
  if (!p || typeof p !== 'object') throw Error('参入戦データが不正です。');
  for (const stage of ['regional', 'national'] as const) {
    const b = p[stage];
    if (b === null) continue;
    const count = stage === 'regional' ? 4 : 8;
    if (!b || b.drawn !== true || !Array.isArray(b.teams) || b.teams.length !== count || !Array.isArray(b.rounds) || b.rounds.length !== 2 || !Number.isInteger(b.completedRounds) || b.completedRounds < 0 || b.completedRounds > 2) throw Error('参入戦の表が不正です。');
    const ids = new Set(b.teams.map((t) => t.id));
    if (ids.size !== count || b.teams.some((t) => !t.id || typeof t.name !== 'string' || t.name.length > 60 || !Number.isFinite(t.strength) || t.strength < 1 || t.strength > 99 || !(t.style in tactics) || (t.formation !== undefined && !FORMATIONS.includes(t.formation)) || !DISTRICTS.some((d) => d.id === t.districtId))) throw Error('参入戦の出場校が不正です。');
    for (let r = 0; r < 2; r++) {
      if (!Array.isArray(b.rounds[r]) || b.rounds[r].length !== count >> (r + 1)) throw Error('参入戦の対戦数が不正です。');
      for (const m of b.rounds[r]) {
        if (!m || [m.homeId, m.awayId, m.winnerId].some((id) => id !== null && !ids.has(id)) ||
          (m.winnerId !== null && m.winnerId !== m.homeId && m.winnerId !== m.awayId) ||
          [m.home, m.away].some((n) => n !== null && (!Number.isInteger(n) || n < 0 || n > 30)) ||
          (m.penalties !== null && (typeof m.penalties !== 'string' || !/^\d+ - \d+$/.test(m.penalties)))) throw Error('参入戦の試合結果が不正です。');
      }
    }
  }
}
