// TOUCHLINE ACADEMY v3 — W2: 大会・リーグ体系
//
// 単体で完結するモジュール。lib/game.ts と lib/squad.ts の「公開API」だけを使い、
// それらのファイル自体は一切変更しない（lib/school-life.ts と同じ流儀）。
// State['v3'] にはまだ `competition` フィールドが型として存在しないため
// （lib/v3.ts は統括側が配線する）、このファイルの内部では `withComp()` という
// 小さな型キャストヘルパーを介して s.v3.competition を読み書きする。
// 統括側が lib/v3.ts の V3State に `competition: CompState` を正式に足せば、
// このキャストは不要になるが、足さなくてもランタイムには一切問題がない
// （実データは常に hydrateCompetition() が作る）。
//
// 同様に、Fixture.kind もまだ 'league'|'ih_qualifier'|... を含んでいないため、
// このファイルが生成する日程は lib/game.ts の `Fixture` 型そのものではなく、
// 構造的に完全互換の `CompFixture` 型として返す（フィールド名・型は同一）。
// resolveCompetitionMatch() が受け取る「試合結果」も、Match 型を直接 import
// せず、必要なフィールドだけを持つ構造的部分型 `ResolvableMatch` として
// 定義してあるので、本物の Match をそのまま渡せる。
//
// 配線手順は本ファイル末尾のコメントを参照。

import { clamp, strength as strengthOf, type State, type Player, type Tactic } from './game.ts';
import { squadOverall } from './squad.ts';

// ---------------------------------------------------------------------------
// 決定的な擬似乱数（lib/squad.ts・lib/school-life.ts の h32/hf と同じ考え方。
// s.seed を消費せず、s.seed・s.season・s.week などを種にしたハッシュで
// 決定的に値を作る）
// ---------------------------------------------------------------------------
function h32(...ns: number[]): number {
  let x = 2166136261 >>> 0;
  for (const n of ns) x = Math.imul(x ^ (n >>> 0), 16777619) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
function hf(...ns: number[]): number {
  return h32(...ns) / 4294967296;
}
function strHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
function pickFrom<T>(arr: readonly T[], u: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
}

// ---------------------------------------------------------------------------
// 都道府県（48地区。東京は東西に分割）
// ---------------------------------------------------------------------------
export type DistrictId = string;
export type District = {
  id: DistrictId;
  name: string;
  /** 難易度係数の目安（1.00〜1.35程度）。実在校の列挙ではなく、地区の実勢を反映した相対値。 */
  strength: number;
  /** 参加校数の目安（雰囲気づけ用） */
  schools: number;
  /** 激戦度（星1〜5、UI表示用） */
  stars: 1 | 2 | 3 | 4 | 5;
};

function buildBand(
  names: { id: string; name: string }[],
  strengthRange: [number, number],
  schoolsRange: [number, number],
): District[] {
  const [sMax, sMin] = strengthRange;
  const [pMax, pMin] = schoolsRange;
  return names.map((n, i) => {
    const t = names.length > 1 ? i / (names.length - 1) : 0;
    const strengthVal = Math.round((sMax - (sMax - sMin) * t) * 100) / 100;
    const schoolsVal = Math.round(pMax - (pMax - pMin) * t);
    const stars: 1 | 2 | 3 | 4 | 5 =
      strengthVal >= 1.27 ? 5 : strengthVal >= 1.15 ? 4 : strengthVal >= 1.06 ? 3 : 2;
    return { id: n.id, name: n.name, strength: strengthVal, schools: schoolsVal, stars };
  });
}

// 上位帯（激戦区）: 静岡・千葉・埼玉・神奈川・東京(西/東)・大阪・青森・長崎・鹿児島に
// 加えて広島・兵庫。現在の高校サッカーで参加校数・強豪の層が厚いとされる地区。
const S_NAMES = [
  { id: 'shizuoka', name: '静岡県' },
  { id: 'chiba', name: '千葉県' },
  { id: 'saitama', name: '埼玉県' },
  { id: 'kanagawa', name: '神奈川県' },
  { id: 'tokyo_west', name: '東京西' },
  { id: 'tokyo_east', name: '東京東' },
  { id: 'osaka', name: '大阪府' },
  { id: 'aomori', name: '青森県' },
  { id: 'nagasaki', name: '長崎県' },
  { id: 'kagoshima', name: '鹿児島県' },
  { id: 'hiroshima', name: '広島県' },
  { id: 'hyogo', name: '兵庫県' },
];
// 準上位帯: 強豪校を複数抱えるが、上位帯ほどの層の厚さではない地区。
const A_NAMES = [
  { id: 'aichi', name: '愛知県' },
  { id: 'kyoto', name: '京都府' },
  { id: 'fukuoka', name: '福岡県' },
  { id: 'gunma', name: '群馬県' },
  { id: 'yamanashi', name: '山梨県' },
  { id: 'okayama', name: '岡山県' },
  { id: 'kumamoto', name: '熊本県' },
  { id: 'miyagi', name: '宮城県' },
  { id: 'nagano', name: '長野県' },
  { id: 'ishikawa', name: '石川県' },
  { id: 'niigata', name: '新潟県' },
  { id: 'mie', name: '三重県' },
];
// 中位帯: 平均的な参加校数・強度の地区。
const B_NAMES = [
  { id: 'hokkaido', name: '北海道' },
  { id: 'ibaraki', name: '茨城県' },
  { id: 'tochigi', name: '栃木県' },
  { id: 'gifu', name: '岐阜県' },
  { id: 'shiga', name: '滋賀県' },
  { id: 'nara', name: '奈良県' },
  { id: 'yamaguchi', name: '山口県' },
  { id: 'ehime', name: '愛媛県' },
  { id: 'kagawa', name: '香川県' },
  { id: 'iwate', name: '岩手県' },
  { id: 'akita', name: '秋田県' },
  { id: 'fukushima', name: '福島県' },
];
// 下位帯: 参加校数が少なく層が薄い地区。県予選から全国レベルまでの距離が近い分、
// 早い段階の相手は現状維持水準で手応えが軽い。
const C_NAMES = [
  { id: 'toyama', name: '富山県' },
  { id: 'fukui', name: '福井県' },
  { id: 'wakayama', name: '和歌山県' },
  { id: 'tottori', name: '鳥取県' },
  { id: 'shimane', name: '島根県' },
  { id: 'tokushima', name: '徳島県' },
  { id: 'kochi', name: '高知県' },
  { id: 'saga', name: '佐賀県' },
  { id: 'oita', name: '大分県' },
  { id: 'miyazaki', name: '宮崎県' },
  { id: 'okinawa', name: '沖縄県' },
  { id: 'yamagata', name: '山形県' },
];

export const DISTRICTS: District[] = [
  ...buildBand(S_NAMES, [1.35, 1.24], [220, 160]),
  ...buildBand(A_NAMES, [1.22, 1.12], [160, 110]),
  ...buildBand(B_NAMES, [1.1, 1.02], [105, 65]),
  ...buildBand(C_NAMES, [1.04, 1.0], [60, 35]),
];

export function districtById(id: DistrictId): District {
  const d = DISTRICTS.find((x) => x.id === id);
  if (!d) throw Error('都道府県データが見つかりません。');
  return d;
}

// ---------------------------------------------------------------------------
// 対戦校・ユースチームの架空名生成（実在校名を避けた決定的生成）
// ---------------------------------------------------------------------------
const SCHOOL_STEMS = [
  '桜台', '若葉', '緑丘', '双葉', '光陵', '陽明', '白鷺', '東雲', '西風', '南栄',
  '北斗', '明和', '清風', '翠明', '曙丘', '夕凪', '花園', '緑風', '蒼空', '春日野',
  '秋桜', '冬木', '雪見', '若竹', '松風', '杉並木', '桐生台', '柏木', '朝霧', '群青',
];
const SCHOOL_SUFFIXES = ['高校', '学園', '学院', '実業', '工業', '商業', '総合', '国際'];
const YOUTH_STEMS = [
  '潮', '疾風', '蒼', '陽炎', '紫電', '碧', '蒼穹', '旭', '暁', '群青', '彗星', '疾走', '翔', '煌', '蒼海', '天翔',
];
const YOUTH_SUFFIXES = ['FCユース', 'ジュニアユース', 'SCユース', 'アカデミー'];

function buildSchoolName(seedParts: number[]): string {
  return `${pickFrom(SCHOOL_STEMS, hf(...seedParts, 1))}${pickFrom(SCHOOL_SUFFIXES, hf(...seedParts, 2))}`;
}
function buildYouthName(seedParts: number[]): string {
  return `${pickFrom(YOUTH_STEMS, hf(...seedParts, 1))}${pickFrom(YOUTH_SUFFIXES, hf(...seedParts, 2))}`;
}
/** 単発の架空校名（練習試合の相手など、一覧の重複を気にしなくてよい場面向け）。 */
export function districtSchoolName(districtId: DistrictId, salt: number): string {
  return buildSchoolName([strHash(districtId), salt, 999]);
}
/** 単発の架空ユースチーム名。 */
export function districtYouthName(districtId: DistrictId, salt: number): string {
  return buildYouthName([strHash(districtId), salt, 998]);
}

// ---------------------------------------------------------------------------
// U18リーグの階層
// ---------------------------------------------------------------------------
export type LeagueTier = 'pref2' | 'pref1' | 'regional' | 'national';
export const LEAGUE_TIERS: LeagueTier[] = ['pref2', 'pref1', 'regional', 'national'];
export const tierInfo: Record<LeagueTier, { name: string }> = {
  pref2: { name: '県2部' },
  pref1: { name: '県1部' },
  regional: { name: '地域リーグ' },
  national: { name: '全国リーグ' },
};
/** 難易度帯（県2部40-55/県1部55-68/地域66-80/全国78-93）。地区の強度係数を掛けて使う。 */
const TIER_BAND: Record<LeagueTier, [number, number]> = {
  pref2: [40, 55],
  pref1: [55, 68],
  regional: [66, 80],
  national: [78, 93],
};
export function tierBelow(t: LeagueTier): LeagueTier | null {
  const i = LEAGUE_TIERS.indexOf(t);
  return i > 0 ? LEAGUE_TIERS[i - 1] : null;
}

export type LeagueClub = {
  id: string;
  name: string;
  /** true ならクラブ下部組織のユースチーム（架空）。技術がやや高くフィジカルは同等という味付けは、
   *  fixture の style/strength 決定に軽い補正として反映する。 */
  youth: boolean;
  strength: number;
};
export type LeagueScheduleEntry = { week: number; clubIndex: number; leg: 0 | 1 };
export type TeamLeagueState = {
  tier: LeagueTier;
  /** この季の対戦相手（7クラブ、ホーム&アウェーで計14試合）。 */
  clubs: LeagueClub[];
  /** Aチームのみ使用。週→対戦相手のマッピング。Bチームは結果のみ自動進行のため空配列。 */
  schedule: LeagueScheduleEntry[];
  played: number;
  win: number;
  draw: number;
  lose: number;
  gf: number;
  ga: number;
  points: number;
  lastRank: number | null;
};
function emptyTeamState(tier: LeagueTier): TeamLeagueState {
  return {
    tier,
    clubs: [],
    schedule: [],
    played: 0,
    win: 0,
    draw: 0,
    lose: 0,
    gf: 0,
    ga: 0,
    points: 0,
    lastRank: null,
  };
}

export type CupState = { qualified: boolean; alive: boolean; best: string };
function freshCup(): CupState {
  return { qualified: false, alive: true, best: '予選未突破' };
}

export type CompHistoryEntry = {
  season: number;
  districtId: DistrictId;
  tierA: LeagueTier;
  rankA: number | null;
  pointsA: number;
  tierB: LeagueTier | null;
  ihBest: string;
  wcBest: string;
};

export type CompState = {
  schema: 1;
  districtId: DistrictId;
  /** この season 以降に赴任先を選び直せる（初期選択は season 1 から可能）。 */
  nextChoiceSeason: number;
  /** 現在ロードされているクラブ・日程がどの season 向けに生成されたか。0 = 未生成。 */
  seasonGenerated: number;
  teamA: TeamLeagueState;
  /** 学校評判が一定以上でのみ存在。常に teamA より1つ下の階層。 */
  teamB: TeamLeagueState | null;
  ih: CupState;
  wc: CupState;
  history: CompHistoryEntry[];
};

// ---------------------------------------------------------------------------
// クラブ生成・日程生成
// ---------------------------------------------------------------------------
function makeClubs(
  seedNum: number,
  district: District,
  tier: LeagueTier,
  season: number,
  teamTag: 'A' | 'B',
): LeagueClub[] {
  const [bandMin, bandMax] = TIER_BAND[tier];
  // ユースチームの混在比率: 階層が上がるほど増える（県2部0・県1部1・地域2・全国3、7クラブ中）。
  const youthCount = tier === 'pref2' ? 0 : tier === 'pref1' ? 1 : tier === 'regional' ? 2 : 3;
  const used = new Set<string>();
  const clubs: LeagueClub[] = [];
  for (let i = 0; i < 7; i++) {
    const isYouth = i < youthCount;
    const base = [seedNum, strHash(district.id), strHash(tier), season, strHash(teamTag), i];
    let name = '';
    for (let salt = 0; salt < 40; salt++) {
      name = isYouth ? buildYouthName([...base, salt]) : buildSchoolName([...base, salt]);
      if (!used.has(name)) break;
    }
    used.add(name);
    const jitter = hf(...base, 55);
    // ユースは技術がやや高くフィジカルは同等という味付け: 総合力に軽いプラス補正。
    const youthBonus = isYouth ? 1.03 : 1;
    const raw = (bandMin + (bandMax - bandMin) * jitter) * youthBonus;
    const strengthVal = clamp(Math.round(raw * district.strength), 20, 99);
    clubs.push({ id: `${district.id}-${tier}-${teamTag}-${i}`, name, youth: isYouth, strength: strengthVal });
  }
  return clubs;
}

/** 14週（LEAGUE_WEEKS）へ、7クラブ×ホーム&アウェーの計14試合を決定的に割り当てる。 */
function makeSchedule(seedNum: number, season: number, clubCount: number): LeagueScheduleEntry[] {
  const pairs: { clubIndex: number; leg: 0 | 1 }[] = [];
  for (let i = 0; i < clubCount; i++) {
    pairs.push({ clubIndex: i, leg: 0 });
    pairs.push({ clubIndex: i, leg: 1 });
  }
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(hf(seedNum, season, 4001 + i) * (i + 1));
    const tmp = pairs[i];
    pairs[i] = pairs[j];
    pairs[j] = tmp;
  }
  return LEAGUE_WEEKS.map((week, idx) => ({
    week,
    clubIndex: pairs[idx].clubIndex,
    leg: pairs[idx].leg,
  }));
}

/** ピア（対戦相手7クラブ）の年間予想勝点。自チームの実際の勝点と合わせて順位を決めるための基準線。 */
function peerPoints(seedNum: number, season: number, club: LeagueClub): number {
  const j = hf(seedNum, strHash(club.id), season, 321);
  return clamp(Math.round((club.strength / 99) * 40 + (j - 0.5) * 14), 0, 42);
}

// ---------------------------------------------------------------------------
// Bチーム: 結果のみ自動進行（采配なし）。実際の試合エンジンを使わず、
// 総合力の差から即座に1季分の結果を決定する。
// ---------------------------------------------------------------------------
function bRosterCount(s: State): number {
  return s.players.filter((p) => s.v3.squad.players[p.id]?.team === 'B').length;
}
// Aチームは20人ちょうど（試合登録メンバー、lib/squad.ts）。部員上限50人なので B は最大30人になり、
// 1チームを組める11人をしきい値にできる。
export function bTeamEligible(s: State): boolean {
  return s.reputation >= 55 && bRosterCount(s) >= 11;
}
function bTeamStrength(s: State): number {
  const bs = s.players.filter((p) => s.v3.squad.players[p.id]?.team === 'B');
  if (!bs.length) return 40;
  const avg = bs.reduce((a: number, p: Player) => a + squadOverall(p, s.v3.squad.players[p.id]), 0) / bs.length;
  return clamp(Math.round(avg), 20, 99);
}
function quickGoals(u: number, our: number, opp: number): number {
  const lambda = clamp(1.35 + (our - opp) / 20, 0.2, 3.8);
  return Math.max(0, Math.round(lambda + (u - 0.5) * 2.6));
}
function simulateBTeamSeasonInstant(s: State, team: TeamLeagueState): void {
  const our = bTeamStrength(s);
  for (const club of team.clubs) {
    for (let leg = 0; leg < 2; leg++) {
      const base = [s.seed, strHash(club.id), s.season, leg, 707];
      const gf = quickGoals(hf(...base, 1), our, club.strength);
      const ga = quickGoals(hf(...base, 2), club.strength, our);
      team.played++;
      team.gf += gf;
      team.ga += ga;
      if (gf > ga) {
        team.win++;
        team.points += 3;
      } else if (gf === ga) {
        team.draw++;
        team.points += 1;
      } else team.lose++;
    }
  }
  const peers = team.clubs.map((c) => peerPoints(s.seed, s.season, c));
  const all = [...peers, team.points].sort((a, b) => b - a);
  team.lastRank = all.indexOf(team.points) + 1;
}

// ---------------------------------------------------------------------------
// 季の切り替え: 前季の順位確定→昇格・降格、cupのリセット、今季クラブ・日程の生成
// ---------------------------------------------------------------------------
function pickDefaultDistrict(s: State): DistrictId {
  const idx = Math.floor(hf(s.seed, 990001) * DISTRICTS.length);
  return DISTRICTS[Math.min(idx, DISTRICTS.length - 1)].id;
}

function finalizeTeamA(s: State, comp: CompState, prevSeason: number): void {
  const team = comp.teamA;
  const peers = team.clubs.map((c) => peerPoints(s.seed, prevSeason, c));
  const all = [...peers, team.points].sort((a, b) => b - a);
  const rank = all.indexOf(team.points) + 1;
  const tierIdx = LEAGUE_TIERS.indexOf(team.tier);
  let newTier = team.tier;
  if (rank <= 2 && tierIdx < LEAGUE_TIERS.length - 1) newTier = LEAGUE_TIERS[tierIdx + 1];
  else if (rank >= 7 && tierIdx > 0) newTier = LEAGUE_TIERS[tierIdx - 1];
  const promoted = LEAGUE_TIERS.indexOf(newTier) > tierIdx;
  const relegated = LEAGUE_TIERS.indexOf(newTier) < tierIdx;
  if (rank === 1 && team.tier === 'national') {
    s.reputation = clamp(s.reputation + 8);
    s.funds += 40;
    s.feed = [`${tierInfo[team.tier].name}優勝！全国区の名声を得ました。`, ...s.feed].slice(0, 30);
  } else if (promoted) {
    s.feed = [
      `U18リーグ${tierInfo[team.tier].name}で${rank}位。${tierInfo[newTier].name}へ昇格しました。`,
      ...s.feed,
    ].slice(0, 30);
  } else if (relegated) {
    s.feed = [
      `U18リーグ${tierInfo[team.tier].name}で${rank}位。${tierInfo[newTier].name}へ降格しました。`,
      ...s.feed,
    ].slice(0, 30);
  }
  comp.history = [
    {
      season: prevSeason,
      districtId: comp.districtId,
      tierA: team.tier,
      rankA: rank,
      pointsA: team.points,
      tierB: comp.teamB?.tier ?? null,
      ihBest: comp.ih.best,
      wcBest: comp.wc.best,
    },
    ...comp.history,
  ].slice(0, 20);
  team.tier = newTier;
  team.lastRank = rank;
}

function advanceCompetitionSeason(s: State, comp: CompState): void {
  const prevSeason = comp.seasonGenerated;
  if (prevSeason > 0 && comp.teamA.clubs.length) finalizeTeamA(s, comp, prevSeason);
  comp.ih = freshCup();
  comp.wc = freshCup();
  const district = districtById(comp.districtId);
  comp.teamA.clubs = makeClubs(s.seed, district, comp.teamA.tier, s.season, 'A');
  comp.teamA.schedule = makeSchedule(s.seed, s.season, comp.teamA.clubs.length);
  comp.teamA.played = comp.teamA.win = comp.teamA.draw = comp.teamA.lose = 0;
  comp.teamA.gf = comp.teamA.ga = comp.teamA.points = 0;
  if (comp.teamA.tier !== 'pref2' && bTeamEligible(s)) {
    const bTier = tierBelow(comp.teamA.tier)!;
    const teamB = emptyTeamState(bTier);
    teamB.clubs = makeClubs(s.seed, district, bTier, s.season, 'B');
    simulateBTeamSeasonInstant(s, teamB);
    comp.teamB = teamB;
  } else {
    comp.teamB = null;
  }
  comp.seasonGenerated = s.season;
}

// ---------------------------------------------------------------------------
// hydrate / validate
// ---------------------------------------------------------------------------
/** 統括側が lib/v3.ts で competition を足すまでの間、型を安全に橋渡しするための最小キャスト */
type V3WithComp = State['v3'] & { competition?: CompState };
function withComp(s: State): V3WithComp {
  return s.v3 as V3WithComp;
}

const LEGACY_KINDS = ['friendly', 'summer', 'qualifier', 'national'] as const;
type LegacyKind = (typeof LEGACY_KINDS)[number];
/** 旧セーブの Fixture.kind（'friendly'|'summer'|'qualifier'|'national'）を新種別へ決定的にマッピングする。
 *  'summer'（旧・夏季招待大会）はインターハイ予選・全国のどちらかへ、'qualifier'/'national'（旧・冬の
 *  県大会/全国大会）は選手権予選・全国へ対応づける。'friendly' はそのまま。 */
export function mapLegacyFixtureKind(kind: LegacyKind, round: number): CompFixtureKind {
  if (kind === 'friendly') return 'friendly';
  if (kind === 'summer') return round >= 2 ? 'ih_national' : 'ih_qualifier';
  if (kind === 'qualifier') return 'wc_qualifier';
  return 'wc_national';
}
function migrateLegacyFixture(s: State): void {
  const isLegacy = (k: string): k is LegacyKind => (LEGACY_KINDS as readonly string[]).includes(k);
  if (s.pending && isLegacy(s.pending.kind) && !['friendly'].includes(s.pending.kind)) {
    const mapped = mapLegacyFixtureKind(s.pending.kind, s.pending.round);
    (s.pending as unknown as { kind: string }).kind = mapped;
  }
  if (s.match && isLegacy(s.match.fixture.kind) && !['friendly'].includes(s.match.fixture.kind)) {
    const mapped = mapLegacyFixtureKind(s.match.fixture.kind, s.match.fixture.round);
    (s.match.fixture as unknown as { kind: string }).kind = mapped;
  }
}

export function hydrateCompetition(s: State): void {
  migrateLegacyFixture(s);
  const v = withComp(s);
  if (!v.competition || v.competition.schema !== 1) {
    v.competition = {
      schema: 1,
      districtId: pickDefaultDistrict(s),
      nextChoiceSeason: s.season,
      seasonGenerated: 0,
      teamA: emptyTeamState('pref2'),
      teamB: null,
      ih: freshCup(),
      wc: freshCup(),
      history: [],
    };
  }
  const comp = v.competition;
  if (comp.seasonGenerated !== s.season) advanceCompetitionSeason(s, comp);
}
export function validateCompetition(s: State): void {
  const comp = withComp(s).competition;
  const num = (n: unknown, min: number, max: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!comp || comp.schema !== 1) throw Error('大会データが不正です。');
  if (!DISTRICTS.some((d) => d.id === comp.districtId)) throw Error('都道府県データが不正です。');
  if (!num(comp.nextChoiceSeason, 1, 100000)) throw Error('赴任先データが不正です。');
  if (!num(comp.seasonGenerated, 0, 100000)) throw Error('大会データが不正です。');
  const checkTeam = (team: TeamLeagueState, label: string) => {
    if (!LEAGUE_TIERS.includes(team.tier)) throw Error(`${label}の階層が不正です。`);
    if (!Array.isArray(team.clubs) || team.clubs.length !== 7)
      throw Error(`${label}の対戦相手データが不正です。`);
    for (const c of team.clubs)
      if (!c || typeof c.name !== 'string' || c.name.length > 60 || !num(c.strength, 1, 120))
        throw Error(`${label}の対戦相手データが不正です。`);
    if (!Array.isArray(team.schedule) || (team.schedule.length !== 0 && team.schedule.length !== 14))
      throw Error(`${label}の日程データが不正です。`);
    if (team.win + team.draw + team.lose !== team.played) throw Error(`${label}の成績データが不正です。`);
    if (!num(team.played, 0, 14) || !num(team.points, 0, 42))
      throw Error(`${label}の成績データが不正です。`);
  };
  checkTeam(comp.teamA, 'Aチーム');
  if (comp.teamB) {
    checkTeam(comp.teamB, 'Bチーム');
    if (LEAGUE_TIERS.indexOf(comp.teamB.tier) >= LEAGUE_TIERS.indexOf(comp.teamA.tier))
      throw Error('AチームとBチームの階層が不正です。');
  }
  const checkCup = (cup: CupState, label: string) => {
    if (
      !cup ||
      typeof cup.qualified !== 'boolean' ||
      typeof cup.alive !== 'boolean' ||
      typeof cup.best !== 'string' ||
      cup.best.length > 60
    )
      throw Error(`${label}のデータが不正です。`);
  };
  checkCup(comp.ih, 'インターハイ');
  checkCup(comp.wc, '選手権');
  if (!Array.isArray(comp.history) || comp.history.length > 20) throw Error('大会の履歴データが不正です。');
}
export function readCompetition(s: State): CompState {
  hydrateCompetition(s);
  return withComp(s).competition!;
}

// ---------------------------------------------------------------------------
// 年間カレンダー（48週）
// ---------------------------------------------------------------------------
// U18リーグ: 7クラブ×ホーム&アウェー=14試合。IH/WC の予選・全国と衝突しない14週に固定配置。
export const LEAGUE_WEEKS = [0, 1, 3, 4, 5, 6, 7, 12, 14, 15, 21, 22, 23, 25];
// 練習試合: 空き週に6週配置。
export const FRIENDLY_WEEKS = [2, 13, 24, 32, 42, 46];
// インターハイ（夏）: 6月に県予選4ラウンド、8月に全国5ラウンド。
export const IH_QUALIFIER_WEEKS = [8, 9, 10, 11];
export const IH_NATIONAL_WEEKS = [16, 17, 18, 19, 20];
// 選手権（冬）: 11月に県予選4ラウンド、1月に全国5ラウンド。
export const WC_QUALIFIER_WEEKS = [27, 28, 29, 30];
export const WC_NATIONAL_WEEKS = [36, 37, 38, 39, 40];

export type CompFixtureKind =
  | 'friendly'
  | 'league'
  | 'ih_qualifier'
  | 'ih_national'
  | 'wc_qualifier'
  | 'wc_national';
/** lib/game.ts の Fixture と完全に同じ形（kind の型だけが広い）。統括側が Fixture.kind を
 *  拡張すれば、このままキャストなしで s.pending に代入できる。 */
export type CompFixture = {
  label: string;
  kind: CompFixtureKind;
  round: number;
  strength: number;
  opponent: string;
  style: Tactic;
};

const TACTIC_LIST: Tactic[] = ['balanced', 'possession', 'counter', 'press'];
function pickTactic(u: number): Tactic {
  return TACTIC_LIST[Math.min(3, Math.floor(u * 4))];
}

const QUALIFIER_LABEL_PREFIX = ['1回戦', '準々決勝', '準決勝', '決勝'];
const NATIONAL_LABEL_PREFIX = ['1回戦', '2回戦', '準々決勝', '準決勝', '決勝'];
// 県予選 45〜65 → 決勝は 65〜75 に近づく。
const QUALIFIER_BAND: [number, number][] = [
  [45, 55],
  [48, 58],
  [55, 65],
  [65, 75],
];
// 全国1〜2回戦 70〜80、準々決勝以降 80〜92、決勝 88〜95。
const NATIONAL_BAND: [number, number][] = [
  [70, 78],
  [73, 80],
  [80, 88],
  [84, 90],
  [88, 95],
];

function cupFixture(
  s: State,
  comp: CompState,
  district: District,
  kind: 'ih_qualifier' | 'ih_national' | 'wc_qualifier' | 'wc_national',
  round: number,
): CompFixture {
  const isQualifier = kind === 'ih_qualifier' || kind === 'wc_qualifier';
  const bands = isQualifier ? QUALIFIER_BAND : NATIONAL_BAND;
  const labels = isQualifier ? QUALIFIER_LABEL_PREFIX : NATIONAL_LABEL_PREFIX;
  const band = bands[Math.min(round, bands.length - 1)];
  const label = labels[Math.min(round, labels.length - 1)];
  const cupName = kind.startsWith('ih') ? 'インターハイ' : '選手権';
  const stagePrefix = isQualifier ? '県予選・' : '全国・';
  const jitter = hf(s.seed, s.season, strHash(kind), round, 8181);
  const base = band[0] + (band[1] - band[0]) * jitter;
  const strengthVal = clamp(Math.round(base * district.strength), 20, 99);
  return {
    label: `${cupName}${stagePrefix}${label}`,
    kind,
    round,
    strength: strengthVal,
    opponent: districtSchoolName(comp.districtId, strHash(kind) + round * 97 + s.season),
    style: pickTactic(hf(s.seed, s.season, strHash(kind), round, 8182)),
  };
}

/** 現在の週(0〜47)に対する対戦カード。lib/game.ts の calendar() と、'train' ハンドラ内で
 *  対戦相手/強さ/戦術を組み立てていたロジックの両方を1つにまとめたもの。試合が無い週は null。 */
export function competitionFixture(s: State, week: number): CompFixture | null {
  const comp = readCompetition(s);
  const district = districtById(comp.districtId);
  if (IH_QUALIFIER_WEEKS.includes(week)) {
    if (!comp.ih.alive) return null;
    return cupFixture(s, comp, district, 'ih_qualifier', week - IH_QUALIFIER_WEEKS[0]);
  }
  if (IH_NATIONAL_WEEKS.includes(week)) {
    if (!comp.ih.qualified || !comp.ih.alive) return null;
    return cupFixture(s, comp, district, 'ih_national', week - IH_NATIONAL_WEEKS[0]);
  }
  if (WC_QUALIFIER_WEEKS.includes(week)) {
    if (!comp.wc.alive) return null;
    return cupFixture(s, comp, district, 'wc_qualifier', week - WC_QUALIFIER_WEEKS[0]);
  }
  if (WC_NATIONAL_WEEKS.includes(week)) {
    if (!comp.wc.qualified || !comp.wc.alive) return null;
    return cupFixture(s, comp, district, 'wc_national', week - WC_NATIONAL_WEEKS[0]);
  }
  if (LEAGUE_WEEKS.includes(week)) {
    const entry = comp.teamA.schedule.find((e) => e.week === week);
    if (!entry) return null;
    const club = comp.teamA.clubs[entry.clubIndex];
    if (!club) return null;
    const jitter = hf(s.seed, s.season, week, 6161);
    return {
      label: `U18${tierInfo[comp.teamA.tier].name}リーグ`,
      kind: 'league',
      round: entry.leg,
      strength: clamp(Math.round(club.strength + (jitter - 0.5) * 6), 20, 99),
      opponent: club.name,
      style: pickTactic(hf(s.seed, s.season, week, 6162)),
    };
  }
  if (FRIENDLY_WEEKS.includes(week)) {
    const jitter = hf(s.seed, s.season, week, 7171);
    return {
      label: '練習試合',
      kind: 'friendly',
      round: 0,
      strength: clamp(Math.round(strengthOf(s) - 4 + jitter * 8), 20, 99),
      opponent: districtSchoolName(comp.districtId, s.season * 100 + week),
      style: pickTactic(hf(s.seed, s.season, week, 7172)),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 試合結果の反映（Aチームの実試合終了後に呼ばれる）
// ---------------------------------------------------------------------------
/** 本物の Match と構造的に互換な最小型。lib/game.ts の Fixture.kind 拡張前でも
 *  型エラーなく呼び出せるよう、kind は string として受け取る。 */
export type ResolvableMatch = {
  fixture: { kind: string; round: number; label: string; opponent: string };
  home: number;
  away: number;
  won: boolean;
  penalties: string | null;
};
export function resolveCompetitionMatch(s: State, m: ResolvableMatch): void {
  const comp = withComp(s).competition;
  if (!comp) return;
  const f = m.fixture;
  if (f.kind === 'league') {
    const team = comp.teamA;
    team.played++;
    team.gf += m.home;
    team.ga += m.away;
    const draw = m.home === m.away && !m.penalties;
    if (draw) {
      team.draw++;
      team.points += 1;
    } else if (m.won) {
      team.win++;
      team.points += 3;
    } else team.lose++;
    return;
  }
  if (f.kind === 'ih_qualifier' || f.kind === 'wc_qualifier') {
    const cup = f.kind === 'ih_qualifier' ? comp.ih : comp.wc;
    if (!m.won) {
      cup.alive = false;
      cup.best = `${f.label}敗退`;
    } else if (f.round === 3) {
      cup.qualified = true;
      cup.best = '全国大会出場';
      s.funds += 35;
    }
    return;
  }
  if (f.kind === 'ih_national' || f.kind === 'wc_national') {
    const cup = f.kind === 'ih_national' ? comp.ih : comp.wc;
    if (!m.won) {
      cup.alive = false;
      cup.best = `${f.label}敗退`;
    } else {
      cup.best = f.round === 4 ? '全国優勝' : `${f.label}突破`;
      if (f.round === 4) {
        s.records.trophies++;
        s.reputation = clamp(s.reputation + 12);
        s.funds += 75;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 赴任先（都道府県）の選択
// ---------------------------------------------------------------------------
export function choosablePrefectures(): District[] {
  return DISTRICTS;
}
export function canChoosePrefecture(s: State): boolean {
  const comp = readCompetition(s);
  return s.season >= comp.nextChoiceSeason;
}
export type CompetitionAction = { type: 'compPrefecture'; districtId: string };
export function handleCompetition(s: State, a: { type: string; districtId?: string }): boolean {
  if (a.type !== 'compPrefecture') return false;
  if (!canChoosePrefecture(s)) throw Error('赴任先はまだ選べません。');
  const districtId = a.districtId;
  if (!districtId || !DISTRICTS.some((d) => d.id === districtId))
    throw Error('都道府県が見つかりません。');
  const comp = withComp(s).competition!;
  comp.districtId = districtId;
  comp.nextChoiceSeason = s.season + 3;
  s.feed = [
    `${districtById(districtId).name}への赴任を選択しました。来シーズンから反映されます。`,
    ...s.feed,
  ].slice(0, 30);
  return true;
}

// ---------------------------------------------------------------------------
// 統括側への配線メモ（このファイルは編集しない前提で読むこと）
// ---------------------------------------------------------------------------
// 1. lib/v3.ts の V3State に `competition: CompState` を足し、hydrateV3/validateV3 から
//    hydrateCompetition(s) / validateCompetition(s) を（hydrateSquad/hydrateLife と同様に）
//    呼ぶ。初期値は「未設定」で構わない（hydrateCompetition が必ず決定的に補完する）。
//
// 2. lib/game.ts の Fixture['kind'] を拡張する（既存の4種は残したまま追加する。旧セーブに
//    残る s.pending/s.match.fixture.kind の値は hydrateCompetition() が起動時に自動で
//    新種別へ書き換えるため、削除ではなく「追加」でよい）:
//      'friendly' | 'summer' | 'qualifier' | 'national'
//      | 'league' | 'ih_qualifier' | 'ih_national' | 'wc_qualifier' | 'wc_national'
//    validateSave() 内の fixture() バリデータの kind ホワイトリストにも同じ5種を追加する。
//
// 3. 引き分けを許可する: simulateSegment() の
//      if (m.home === m.away && m.fixture.kind !== 'friendly') { ...PK戦... }
//    を
//      if (m.home === m.away && !['friendly', 'league'].includes(m.fixture.kind)) { ...PK戦... }
//    に変える（'league' はリーグ戦なので引き分けを許可する。カップ戦は従来どおりPK戦で決着）。
//    これをしないと resolveCompetitionMatch() の引き分け判定（m.home===m.away && !m.penalties）
//    が実質発生しなくなる（PK戦で必ず勝敗が付くため）。
//
// 4. lib/game.ts の Action 合併型に `| CompetitionAction`（本ファイルの export type）を足し、
//    act() の中で `if (handleCompetition(s, a)) return s;`
//    を handleSquad(...) / handleLife(...) の呼び出しのすぐ後に追加する。
//
// 5. 'train' ハンドラ内、`const f = calendar(s.week, s); if (f) { s.pending = { ...f, strength: ...,
//    opponent: pick(s, rivals), style: ... }; } else { finishWeek(s); ... }` のブロックを、
//      const f = competitionFixture(s, s.week);
//      if (f) {
//        s.pending = f; // CompFixture は Fixture と同じ形なので、kind拡張後はそのまま代入できる
//      } else {
//        finishWeek(s);
//        ...
//      }
//    に置き換える（calendar() 自体は削除してもしなくてもよいが、以後呼ばれなくなる）。
//    competitionFixture() は内部で readCompetition(s) を呼ぶため、s.v3.competition の
//    hydrate は自動で行われる（明示的な事前呼び出しは不要）。
//
// 6. 試合終了処理（旧: m.fixture.kind==='summer'/'qualifier'/'national' の分岐）を、
//      resolveCompetitionMatch(s, m);
//    の1行に置き換える（grantMatchAchievements(s) の呼び出しの前後どちらでもよい）。
//    季をまたぐ昇格・降格・Bチームの自動進行・カップのリセットは hydrateCompetition() が
//    finishWeek() 内の `hydrateV3(s)`（season++ の直後、既存コード）で自動的に行うため、
//    finishWeek() 自体への追加コードは不要。
//
// 7. UI: app/competition-ui.tsx の <CompetitionPanel state={s} onChoosePrefecture={(id) =>
//    run({ type: 'compPrefecture', districtId: id })} /> を、部活メニューの一角（大会・リーグ
//    タブなど）に配置する。run() は既存の (a: Action) => void 相当のディスパッチ関数。
