import { strength, trainingFatigueDelta, STYLE_FORMATIONS, type State } from './game.ts';
import { FRIENDLY_WEEKS, DISTRICTS, districtSchoolsOf, type CompState, type CompFixture } from './competition.ts';
import { districtRegion, nearestSchool, type WorldSchool } from './school-world.ts';
import { opponentStrengthMult } from './match-stats.ts';

export const FRIENDLY_CHOICES = ['lower', 'peer', 'higher', 'away'] as const;
export type FriendlyChoice = typeof FRIENDLY_CHOICES[number];
export type FriendlyCandidate = { choice: FriendlyChoice; school: WorldSchool; xp: number; fatigue: number };
export type FriendlyOffer = { week: number; rating: number; candidates: FriendlyCandidate[]; choice: FriendlyChoice | 'rest' | null };
export type FriendlyState = { offers: Record<string, FriendlyOffer> };
export const friendlyLabels: Record<FriendlyChoice, string> = { lower: '格下', peer: '同格', higher: '格上', away: '遠征' };

function createOffer(s: State, comp: CompState, week: number): FriendlyOffer {
  const rating = Math.round(strength(s));
  const region = districtRegion(comp.districtId).region;
  const home = districtSchoolsOf(s, comp, comp.districtId);
  const nearby = DISTRICTS.filter((d) => districtRegion(d.id).region === region).flatMap((d) => districtSchoolsOf(s, comp, d.id));
  const distant = DISTRICTS.filter((d) => districtRegion(d.id).region !== region).flatMap((d) => districtSchoolsOf(s, comp, d.id));
  const used = new Set<string>();
  const candidates = (['peer', 'lower', 'higher', 'away'] as const).map((choice) => {
    const difference = { lower: -8, peer: 0, higher: 8, away: 10 }[choice];
    const pool = choice === 'away' ? distant : choice === 'higher' ? nearby : home;
    const available = pool.filter((school) => !used.has(school.id));
    const closest = Math.min(...available.map((school) => Math.abs(school.strength - rating - difference)));
    const band = available.filter((school) => Math.abs(school.strength - rating - difference) <= Math.max(closest, choice === 'peer' ? 3 : 2));
    const school = nearestSchool(band, rating + difference, [comp.world.seed ?? s.seed, s.season, week, choice])!;
    used.add(school.id);
    return { choice, school: { ...school }, xp: opponentStrengthMult(rating, school.strength), fatigue: choice === 'away' ? 4 : choice === 'higher' ? 2 : 0 };
  });
  candidates.sort((a, b) => FRIENDLY_CHOICES.indexOf(a.choice) - FRIENDLY_CHOICES.indexOf(b.choice));
  return { week, rating, candidates, choice: null };
}

/** Freeze the offer one week ahead; screen reads and changes to the live RNG do not reroll it. */
export function prepareFriendlies(s: State, comp: CompState): void {
  comp.friendlies ??= { offers: {} };
  const week = FRIENDLY_WEEKS.find((w) => w === s.week + 1 || w === s.week);
  if (week === undefined || comp.friendlies.offers[week]) return;
  comp.friendlies.offers[week] = createOffer(s, comp, week);
}

export function currentFriendlyOffer(s: State, comp: CompState): FriendlyOffer | null {
  return Object.values(comp.friendlies?.offers ?? {}).find((offer) => offer.week === s.week + 1 || offer.week === s.week) ?? null;
}

export function chooseFriendly(s: State, comp: CompState, choice: string): void {
  const offer = currentFriendlyOffer(s, comp);
  if (!offer || s.week >= offer.week || s.match?.fixture.kind === 'friendly' || s.pending?.kind === 'friendly') throw Error('練習試合の申し込みは前の週に行ってください。');
  if (choice !== 'rest' && !FRIENDLY_CHOICES.includes(choice as FriendlyChoice)) throw Error('練習試合の候補が不正です。');
  offer.choice = choice as FriendlyOffer['choice'];
}

export function friendlyFixture(s: State, comp: CompState, week: number): CompFixture | null {
  // Future calendar previews do not commit an offer before its application week.
  const offer = comp.friendlies?.offers[week] ?? createOffer(s, comp, week);
  if (offer.choice === 'rest') return null;
  const candidate = offer.candidates.find((c) => c.choice === (offer.choice ?? 'peer'))!;
  const school = candidate.school;
  return { kind: 'friendly', round: 0, label: candidate.choice === 'away' ? '練習試合（遠征）' : '練習試合', opponent: school.name,
    strength: school.strength, style: school.tactic, formation: STYLE_FORMATIONS[school.tactic][0], opponentDistrictId: school.districtId, opponentTier: school.tier,
    friendlyXp: candidate.xp, friendlyFatigue: candidate.fatigue };
}

export function applyFriendlyRest(s: State, comp: CompState): void {
  if (comp.friendlies?.offers[s.week]?.choice !== 'rest') return;
  for (const player of s.players) player.fatigue = Math.max(0, player.fatigue + trainingFatigueDelta('rest', player.fatigue));
  s.feed = ['練習試合を見送り、日曜日は休養に充てました。', ...s.feed].slice(0, 30);
}

export function validateFriendlies(value: FriendlyState): void {
  if (!value || !value.offers || typeof value.offers !== 'object' || Object.keys(value.offers).length > 6) throw Error('練習試合の申し込みデータが不正です。');
  for (const [key, offer] of Object.entries(value.offers)) {
    if (!offer || !FRIENDLY_WEEKS.includes(offer.week) || String(offer.week) !== key || !Number.isFinite(offer.rating) || offer.rating < 1 || offer.rating > 150 ||
        !Array.isArray(offer.candidates) || offer.candidates.length !== 4 || new Set(offer.candidates.map((c) => c.choice)).size !== 4 ||
        (offer.choice !== null && offer.choice !== 'rest' && !FRIENDLY_CHOICES.includes(offer.choice))) throw Error('練習試合の申し込みデータが不正です。');
    for (const c of offer.candidates) {
      if (!FRIENDLY_CHOICES.includes(c.choice) || !c.school || typeof c.school.id !== 'string' || typeof c.school.name !== 'string' || c.school.name.length > 60 ||
          !DISTRICTS.some((d) => d.id === c.school.districtId) || !['pref3', 'pref2', 'pref1', 'regional', 'national'].includes(c.school.tier) ||
          !['balanced', 'counter', 'possession', 'press'].includes(c.school.tactic) || !Number.isFinite(c.school.strength) || c.school.strength < 1 || c.school.strength > 99 ||
          !Number.isFinite(c.xp) || c.xp < 0.7 || c.xp > 1.4 || ![0, 2, 4].includes(c.fatigue)) throw Error('練習試合の候補データが不正です。');
    }
  }
}
