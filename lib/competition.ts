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

import { addFunds, clamp, overall, strength as strengthOf, type State, type Player, type Tactic } from './game.ts';
import { squadOverall } from './squad.ts';
import { strengthRatio } from './match-balance.ts';

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
/** 自校が実際に行った1試合の記録（他校同士の試合は結果を保存せず、必要な時に
 *  決定的に再計算する。自校の試合は本物の試合エンジンの結果なので記録しておく必要がある）。 */
export type LeagueMatchLogEntry = {
  week: number;
  opponentId: string;
  opponentName: string;
  gf: number;
  ga: number;
};
export type TeamLeagueState = {
  tier: LeagueTier;
  /** この季の対戦相手（7クラブ、ホーム&アウェーで計14試合）。 */
  clubs: LeagueClub[];
  /** 週→対戦相手のマッピング。AチームはSTUB — 実際は週ごとに1試合ずつ本物の試合エンジンで消化する。
   *  Bチームも同じ8校総当たりの日程を使うが、采配なしの自動進行のため季開始時に全14節をまとめて
   *  即時消化する（週送りの都合で待たせない、という従来の仕様は変えない）。 */
  schedule: LeagueScheduleEntry[];
  /** この季の総当たり組み合わせ（8校の並び順・週割り当て）を決定した瞬間の乱数状態を凍結して
   *  保存したもの。s.seed は rand() が呼ばれるたびに進む「今この瞬間の乱数状態」なので、季の途中で
   *  毎回 s.seed を直接使って他校同士の試合を再現しようとすると、季の開始時点から時間が経つほど
   *  値がずれて自校の日程（schedule）と食い違ってしまう。そのため、季の開始時に一度だけ固定した
   *  値をここに保存し、以後の再現計算はすべてこの値を使う。AチームはこのフィールドにComp生成時の
   *  s.seed をそのまま使い、Bチームは（AとBの対戦相手・日程が独立になるよう）別の乱数系列
   *  （h32(s.seed, B_SCHEDULE_SALT)）を使う。 */
  scheduleSeed: number;
  /** 自校が実際にプレイした試合の週・相手・スコアのログ（順位表・ライバル戦績表示に使う）。
   *  Aチームは週ごとに本物の試合エンジンの結果を随時追記し、Bチームは季開始時に自動進行した
   *  14試合をまとめて記録する。季をまたぐと空にリセットされる。 */
  results: LeagueMatchLogEntry[];
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
    scheduleSeed: 0,
    results: [],
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

export type CupTeam = { id: string; name: string; strength: number; style: Tactic; districtId: DistrictId };
export type CupMatch = {
  homeId: string | null;
  awayId: string | null;
  winnerId: string | null;
  home: number | null;
  away: number | null;
  penalties: string | null;
};
export type CupBracket = { teams: CupTeam[]; rounds: CupMatch[][]; completedRounds: number };
export type CupState = {
  qualified: boolean;
  alive: boolean;
  best: string;
  /** Old saves can finish the current season with the original cup schedule. */
  qualifier?: CupBracket;
  national?: CupBracket;
};
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
    // 3.2: カップ戦の全国大会と同様、リーグも全国階層には自県係数を掛けず、
    // それ以外の階層では効きを半分に弱める。
    const districtMult = tier === 'national' ? 1 : 1 + (district.strength - 1) * 0.5;
    const strengthVal = clamp(Math.round(raw * districtMult), 20, 99);
    clubs.push({ id: `${district.id}-${tier}-${teamTag}-${i}`, name, youth: isYouth, strength: strengthVal });
  }
  return clubs;
}

// ---------------------------------------------------------------------------
// 8校総当たり（自校＋7クラブ）の決定的スケジューリング。
// 「他校同士の試合も毎節実際に消化する」ための土台: 自校を含む8チームを
// チームインデックス 0（自校）〜7（clubs[0..6]）として、標準的な円卓法
// （circle method）で7ラウンド×4試合の1回戦総当たりを作り、後半7週は
// 同じ組み合わせのホーム/アウェーを入れ替えて2回戦とする（計14ラウンド）。
// どのラウンドをどの週（LEAGUE_WEEKS）に割り当てるか、チームの並び順は
// s.seed・season だけで決まる決定的な乱数で毎季シャッフルする。
// ---------------------------------------------------------------------------
const TEAM_COUNT = 8; // 自校1 + クラブ7

function shuffledSeq(seedNum: number, season: number, salt: number, n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(hf(seedNum, season, salt + i) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** 円卓法: order（8チームの並び順）から、7ラウンド×4試合の1回戦総当たりを作る。
 *  round の偶奇でペアの並びを反転させ、特定の1チームが1回戦で必ずホーム/アウェーに
 *  偏らないようにする。返り値の各ペアは [先頭側, 後続側] の順で、leg=0の時に
 *  そのままの順、leg=1の時は入れ替えて第2戦とする（home/away自体は既存コードに
 *  ならい試合の強さ計算には使わない演出用の情報）。 */
function buildRoundRobin(order: number[]): [number, number][][] {
  const n = order.length;
  const arr = order.slice();
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    const last = arr.pop()!;
    arr.splice(1, 0, last);
  }
  return rounds;
}

function teamOrder(seedNum: number, season: number): number[] {
  return shuffledSeq(seedNum, season, 5001, TEAM_COUNT);
}
type RoundSlot = { roundIdx: number; leg: 0 | 1 };
/** 1回戦7ラウンド×2（leg 0/1）＝14枠を、LEAGUE_WEEKS の14週に決定的にシャッフルして割り当てる。 */
function roundSlotSeq(seedNum: number, season: number): RoundSlot[] {
  const base: RoundSlot[] = [];
  for (let i = 0; i < 7; i++) {
    base.push({ roundIdx: i, leg: 0 });
    base.push({ roundIdx: i, leg: 1 });
  }
  const order = shuffledSeq(seedNum, season, 5101, base.length);
  return order.map((idx) => base[idx]);
}
/** 指定週の8チーム4試合の組み合わせ（チームインデックス 0=自校 / 1〜7=clubs[0..6]）。
 *  リーグ週でなければ null。 */
function weekPairings(seedNum: number, season: number, week: number): [number, number][] | null {
  const idx = LEAGUE_WEEKS.indexOf(week);
  if (idx < 0) return null;
  const rounds = buildRoundRobin(teamOrder(seedNum, season));
  const slot = roundSlotSeq(seedNum, season)[idx];
  const base = rounds[slot.roundIdx];
  return slot.leg === 0 ? base : base.map(([a, b]) => [b, a] as [number, number]);
}

/** 14週（LEAGUE_WEEKS）へ、自校の対戦相手（クラブ番号・第何戦か）を決定的に割り当てる。
 *  weekPairings() から自校（チームインデックス0）を含むペアだけを取り出したもの。 */
function makeSchedule(seedNum: number, season: number): LeagueScheduleEntry[] {
  return LEAGUE_WEEKS.map((week) => {
    const pairs = weekPairings(seedNum, season, week)!;
    const pair = pairs.find(([a, b]) => a === 0 || b === 0)!;
    const opponentIdx = pair[0] === 0 ? pair[1] : pair[0];
    const leg: 0 | 1 = pair[0] === 0 ? 0 : 1;
    return { week, clubIndex: opponentIdx - 1, leg };
  });
}

/** 他校同士（自校を含まないペア）の得点を、強さの差から決定的に作る。lib/squad.ts の
 *  Bチーム即時シミュレーションと同じ quickGoals() を再利用する。 */
function clubVsClubGoals(
  seedNum: number,
  season: number,
  week: number,
  clubA: LeagueClub,
  clubB: LeagueClub,
): { gA: number; gB: number } {
  const base = [seedNum, season, week, strHash(clubA.id), strHash(clubB.id), 9001];
  const gA = quickGoals(hf(...base, 1), clubA.strength, clubB.strength);
  const gB = quickGoals(hf(...base, 2), clubB.strength, clubA.strength);
  return { gA, gB };
}

// ---------------------------------------------------------------------------
// 順位表（自校＋7クラブ、8校）。他校同士の試合は weekPairings() と
// clubVsClubGoals() から毎回決定的に再計算し、State には保存しない。
// 自校の試合だけは本物の試合エンジンの結果なので team.results に記録されたものを使う
// （旧セーブでログが無い週は「無ければ0から」で0試合として扱う＝仕様どおり）。
// ---------------------------------------------------------------------------
export type LeagueStandingRow = {
  teamId: string; // 自校は 'self'、他校は LeagueClub.id
  name: string;
  isSelf: boolean;
  youth: boolean;
  played: number;
  win: number;
  draw: number;
  lose: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
};
export type LeagueRivalResult = {
  week: number;
  /** LEAGUE_WEEKS内の0始まりの節番号（表示は+1して「第n節」）。 */
  roundIndex: number;
  opponentId: string;
  opponentName: string;
  gf: number;
  ga: number;
  outcome: 'win' | 'draw' | 'lose';
};
export type LeagueTable = {
  /** 勝ち点→得失点差→総得点→学校ID の順で並んだ順位表。rows[i] の順位は i+1。 */
  rows: LeagueStandingRow[];
  /** teamId → その校の全結果（自校戦を含む）。ライバル校クリックでの戦績表示に使う。 */
  resultsByTeam: Record<string, LeagueRivalResult[]>;
};
function outcomeOf(gf: number, ga: number): 'win' | 'draw' | 'lose' {
  return gf > ga ? 'win' : gf === ga ? 'draw' : 'lose';
}
/** 指定チーム（既定でAチーム）の現時点（team.played 節消化時点）での順位表を決定的に計算する。
 *  season は既定で s.season（進行中シーズンの表示用）。季の切り替え直後（s.season はもう進んでいるが
 *  comp.teamA/teamB はまだ前季のデータのまま）に前季の最終順位を出す場合は、呼び出し側が
 *  finalizeTeamA/finalizeTeamB から prevSeason を明示的に渡す。Bチームが今季参戦していない
 *  （comp.teamB が null）場合は空の表を返す（呼び出し側は表示前に comp.teamB の有無を見ること）。 */
export function computeLeagueTable(
  s: State,
  comp: CompState,
  season: number = s.season,
  which: 'A' | 'B' = 'A',
): LeagueTable {
  const team = which === 'B' ? comp.teamB : comp.teamA;
  if (!team) return { rows: [], resultsByTeam: {} };
  const clubs = team.clubs;
  type Acc = { played: number; win: number; draw: number; lose: number; gf: number; ga: number; points: number };
  const acc: Record<string, Acc> = {};
  const results: Record<string, LeagueRivalResult[]> = { self: [] };
  for (const c of clubs) {
    acc[c.id] = { played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0, points: 0 };
    results[c.id] = [];
  }
  function apply(id: string, gf: number, ga: number) {
    const a = acc[id];
    if (!a) return;
    a.played++;
    a.gf += gf;
    a.ga += ga;
    const o = outcomeOf(gf, ga);
    if (o === 'win') {
      a.win++;
      a.points += 3;
    } else if (o === 'draw') {
      a.draw++;
      a.points += 1;
    } else a.lose++;
  }
  // 自校が実際にプレイした試合（記録があるものだけ。旧セーブは記録が無ければ0試合）。
  for (const r of team.results) {
    const roundIndex = LEAGUE_WEEKS.indexOf(r.week);
    results.self.push({
      week: r.week,
      roundIndex,
      opponentId: r.opponentId,
      opponentName: r.opponentName,
      gf: r.gf,
      ga: r.ga,
      outcome: outcomeOf(r.gf, r.ga),
    });
    if (acc[r.opponentId]) {
      apply(r.opponentId, r.ga, r.gf);
      results[r.opponentId].push({
        week: r.week,
        roundIndex,
        opponentId: 'self',
        opponentName: s.school,
        gf: r.ga,
        ga: r.gf,
        outcome: outcomeOf(r.ga, r.gf),
      });
    }
  }
  // 他校同士の試合: 自校が実際に消化した節数（team.played）ぶんだけ決定的に再現する。
  // s.seed は rand() の呼び出しで刻々と進むため、ここでは使わず、季の開始時に凍結した
  // team.scheduleSeed（＝comp.teamA.schedule を作った時の s.seed）を使う。こうしないと
  // 季の途中で呼び出すたびに組み合わせがずれ、自校の日程（schedule）と食い違ってしまう。
  const rrSeed = team.scheduleSeed;
  const rounds = buildRoundRobin(teamOrder(rrSeed, season));
  const slots = roundSlotSeq(rrSeed, season);
  const elapsed = Math.min(team.played, LEAGUE_WEEKS.length);
  for (let i = 0; i < elapsed; i++) {
    const week = LEAGUE_WEEKS[i];
    const slot = slots[i];
    const basePairs = rounds[slot.roundIdx];
    const pairs = slot.leg === 0 ? basePairs : basePairs.map(([a, b]) => [b, a] as [number, number]);
    for (const [a, b] of pairs) {
      if (a === 0 || b === 0) continue; // 自校の試合は上で処理済み
      const clubA = clubs[a - 1];
      const clubB = clubs[b - 1];
      if (!clubA || !clubB) continue;
      const { gA, gB } = clubVsClubGoals(rrSeed, season, week, clubA, clubB);
      apply(clubA.id, gA, gB);
      apply(clubB.id, gB, gA);
      results[clubA.id].push({
        week,
        roundIndex: i,
        opponentId: clubB.id,
        opponentName: clubB.name,
        gf: gA,
        ga: gB,
        outcome: outcomeOf(gA, gB),
      });
      results[clubB.id].push({
        week,
        roundIndex: i,
        opponentId: clubA.id,
        opponentName: clubA.name,
        gf: gB,
        ga: gA,
        outcome: outcomeOf(gB, gA),
      });
    }
  }
  const rows: LeagueStandingRow[] = [
    {
      teamId: 'self',
      name: s.school,
      isSelf: true,
      youth: false,
      played: team.played,
      win: team.win,
      draw: team.draw,
      lose: team.lose,
      gf: team.gf,
      ga: team.ga,
      gd: team.gf - team.ga,
      points: team.points,
    },
    ...clubs.map((c) => ({
      teamId: c.id,
      name: c.name,
      isSelf: false,
      youth: c.youth,
      ...acc[c.id],
      gd: acc[c.id].gf - acc[c.id].ga,
    })),
  ];
  rows.sort(
    (x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.teamId.localeCompare(y.teamId),
  );
  return { rows, resultsByTeam: results };
}
/** 昇格圏（上位2位）を表示すべきか: 最上位階層（全国リーグ）では昇格が無いので false。 */
export function promotionZoneActive(tier: LeagueTier): boolean {
  return LEAGUE_TIERS.indexOf(tier) < LEAGUE_TIERS.length - 1;
}
/** 降格圏（下位2位）を表示すべきか: 最下位階層（県2部）では降格が無いので false。 */
export function relegationZoneActive(tier: LeagueTier): boolean {
  return LEAGUE_TIERS.indexOf(tier) > 0;
}
/** 指定チーム（既定でAチーム）の残り試合数（0〜14）。チームが存在しなければ0。 */
export function leagueRemaining(comp: CompState, which: 'A' | 'B' = 'A'): number {
  const team = which === 'B' ? comp.teamB : comp.teamA;
  if (!team) return 0;
  return Math.max(0, LEAGUE_WEEKS.length - team.played);
}
/** 次節の対戦相手（無ければ season 消化済み、またはチーム不在で null）。Bチームは季開始時に
 *  全節を即時消化するため、参戦している季であっても常に null になる（従来どおりの自動進行）。 */
export function leagueNextFixture(
  comp: CompState,
  which: 'A' | 'B' = 'A',
): { opponent: string; leg: 0 | 1; week: number } | null {
  const team = which === 'B' ? comp.teamB : comp.teamA;
  if (!team) return null;
  const entry = team.schedule[team.played];
  if (!entry) return null;
  const club = team.clubs[entry.clubIndex];
  if (!club) return null;
  return { opponent: club.name, leg: entry.leg, week: entry.week };
}

// ---------------------------------------------------------------------------
// Bチーム: 自校の試合は結果のみ自動進行（采配なし）。実際の試合エンジンは使わず、
// 総合力の差から決定的に得点を決める。他校同士の試合はAチームと同じ8校総当たり
// （computeLeagueTable が team.scheduleSeed から毎回再現）に揃え、Bの昇降格もその
// 順位表で決める。AとBの対戦相手・日程は互いに独立な乱数系列（別のscheduleSeed）
// を使うので、Bを参戦させてもAの日程・順位表の再現性には一切影響しない。
// ---------------------------------------------------------------------------
/** Bチームの日程を組む総当たりの乱数系列をAチームと独立させるための固定ソルト。 */
const B_SCHEDULE_SALT = 31337;
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
  const lambda = clamp(1.35 + (our - opp) / 17, 0.2, 3.8);
  return Math.max(0, Math.round(lambda + (u - 0.5) * 2.6));
}
/** Bチームの季開始時の自動進行。Aと同じ8校総当たりの日程（team.schedule、あらかじめ
 *  team.scheduleSeed から作られたもの）に沿って自校の14試合を即座に決定的に消化し、
 *  Aチームの resolveCompetitionMatch と同じ形で team.results に記録する（他校同士の試合は
 *  保存せず、computeLeagueTable が team.scheduleSeed から毎回再現する）。順位・昇格降格は
 *  ここでは決めない（季末に finalizeTeamB が computeLeagueTable の結果を見て決める）。 */
function simulateBTeamSeasonInstant(s: State, team: TeamLeagueState): void {
  const our = bTeamStrength(s);
  for (const entry of team.schedule) {
    const club = team.clubs[entry.clubIndex];
    if (!club) continue;
    const base = [s.seed, strHash(club.id), s.season, entry.leg, entry.week, 707];
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
    team.results = [...team.results, { week: entry.week, opponentId: club.id, opponentName: club.name, gf, ga }];
  }
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
  // 昇格・降格はこの順位表（他校同士の試合も実消化した最終順位）で決める。
  const { rows } = computeLeagueTable(s, comp, prevSeason);
  const rank = rows.findIndex((r) => r.isSelf) + 1;
  const tierIdx = LEAGUE_TIERS.indexOf(team.tier);
  let newTier = team.tier;
  if (rank <= 2 && tierIdx < LEAGUE_TIERS.length - 1) newTier = LEAGUE_TIERS[tierIdx + 1];
  else if (rank >= 7 && tierIdx > 0) newTier = LEAGUE_TIERS[tierIdx - 1];
  const promoted = LEAGUE_TIERS.indexOf(newTier) > tierIdx;
  const relegated = LEAGUE_TIERS.indexOf(newTier) < tierIdx;
  if (rank === 1 && team.tier === 'national') {
    s.reputation = clamp(s.reputation + 4);
    addFunds(s, 20, '全国リーグ優勝');
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

/** Bチームの昇格・降格を、Bチーム自身の最終順位表と、Aチームが今季どうなったか（newTierA、
 *  finalizeTeamA が既に決めた後の新階層）の両方から決める。
 *
 *  「Bは常にAより下の階層（同格・上位には並ばない）」という既存の制約は維持しつつ、Bチーム
 *  自身の順位も反映させたいので、次のように2段階で決める:
 *    1. Bチーム自身の順位表（computeLeagueTable）から、Aと全く同じ昇降格ルール
 *       （1〜2位なら1つ昇格、7〜8位なら1つ降格）でBの「自然な」次階層を求める。
 *    2. その自然な次階層が Aの新階層以上（同格または上回る）になってしまう場合だけ、
 *       Aのちょうど1つ下の階層まで強制的に落とす。それ以外（Aより下に収まっている限り）は
 *       Bの順位どおりの結果をそのまま使う。
 *  そのため「常にAのちょうど1つ下」ではなく「常にAより下（Aの昇格幅が大きければ2階層以上
 *  離れることもある）」になる。validateCompetition もこの「Aより下」という不等式だけを検査する
 *  （既存のまま変更していない）。Bが今季存在しなかった場合（新規参戦前など）は比較対象の順位が
 *  無いため、機械的に tierBelow(newTierA) を返す。 */
function finalizeTeamB(
  s: State,
  comp: CompState,
  prevSeason: number,
  newTierA: LeagueTier,
): LeagueTier | null {
  const team = comp.teamB;
  const ceilTier = tierBelow(newTierA);
  if (!team || !team.clubs.length) return ceilTier;
  const { rows } = computeLeagueTable(s, comp, prevSeason, 'B');
  const rank = rows.findIndex((r) => r.isSelf) + 1;
  const tierIdx = LEAGUE_TIERS.indexOf(team.tier);
  let naturalTier = team.tier;
  if (rank <= 2 && tierIdx < LEAGUE_TIERS.length - 1) naturalTier = LEAGUE_TIERS[tierIdx + 1];
  else if (rank >= 7 && tierIdx > 0) naturalTier = LEAGUE_TIERS[tierIdx - 1];
  const ceilIdx = ceilTier ? LEAGUE_TIERS.indexOf(ceilTier) : -1;
  const naturalIdx = LEAGUE_TIERS.indexOf(naturalTier);
  const finalTier = ceilTier === null ? null : naturalIdx > ceilIdx ? ceilTier : naturalTier;
  if (finalTier && finalTier !== team.tier) {
    const promoted = LEAGUE_TIERS.indexOf(finalTier) > tierIdx;
    s.feed = [
      promoted
        ? `Bチーム、U18${tierInfo[team.tier].name}リーグで${rank}位。${tierInfo[finalTier].name}へ昇格しました。`
        : `Bチーム、U18${tierInfo[team.tier].name}リーグで${rank}位。${tierInfo[finalTier].name}へ降格しました。`,
      ...s.feed,
    ].slice(0, 30);
  }
  return finalTier;
}

function advanceCompetitionSeason(s: State, comp: CompState): void {
  const prevSeason = comp.seasonGenerated;
  let plannedBTier: LeagueTier | null = null;
  if (prevSeason > 0 && comp.teamA.clubs.length) {
    finalizeTeamA(s, comp, prevSeason);
    // Bの昇降格はAの新階層が決まった後で判定する（finalizeTeamA が comp.teamA.tier を
    // 既に更新済みなので、ここで参照する comp.teamA.tier は新階層）。
    plannedBTier = finalizeTeamB(s, comp, prevSeason, comp.teamA.tier);
  }
  comp.ih = freshCup();
  comp.wc = freshCup();
  const district = districtById(comp.districtId);
  comp.ih.qualifier = createCupBracket(s, district, 'ih', false);
  comp.ih.national = createCupBracket(s, district, 'ih', true);
  comp.wc.qualifier = createCupBracket(s, district, 'wc', false);
  comp.wc.national = createCupBracket(s, district, 'wc', true);
  comp.teamA.clubs = makeClubs(s.seed, district, comp.teamA.tier, s.season, 'A');
  // この季の総当たり組み合わせを決める乱数状態をここで凍結する（s.seed はこの後も
  // rand() 呼び出しのたびに進み続けるため、後で他校同士の試合を再現する時は必ず
  // この値を使う。s.seed を直接使い回さない）。
  comp.teamA.scheduleSeed = s.seed;
  comp.teamA.schedule = makeSchedule(comp.teamA.scheduleSeed, s.season);
  comp.teamA.results = [];
  comp.teamA.played = comp.teamA.win = comp.teamA.draw = comp.teamA.lose = 0;
  comp.teamA.gf = comp.teamA.ga = comp.teamA.points = 0;
  if (comp.teamA.tier !== 'pref2' && bTeamEligible(s)) {
    const bTier = plannedBTier ?? tierBelow(comp.teamA.tier)!;
    const teamB = emptyTeamState(bTier);
    teamB.clubs = makeClubs(s.seed, district, bTier, s.season, 'B');
    // AとBの対戦相手・日程は互いに独立な乱数系列にする（Aの scheduleSeed をそのまま使うと
    // 同じ並び順・週割り当てが再現されてしまうため、固定ソルトで混ぜて別系列にする。
    // s.seed 自体は消費しないので、Aチームの再現性には一切影響しない）。
    teamB.scheduleSeed = h32(s.seed, B_SCHEDULE_SALT);
    teamB.schedule = makeSchedule(teamB.scheduleSeed, s.season);
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
  // T4.1: 旧セーブ（results フィールド導入前）の補完。「自校の結果は記録があればそれを
  // 使い、無ければ0から」の方針どおり、無ければ空配列を補うだけでよい（他校同士の試合は
  // weekPairings()/clubVsClubGoals() から常に決定的に再現できるため、保存する必要が無い）。
  if (!Array.isArray(comp.teamA.results)) comp.teamA.results = [];
  if (comp.teamB && !Array.isArray(comp.teamB.results)) comp.teamB.results = [];
  // scheduleSeed 未導入の旧セーブ（季の途中）の補完。本来の生成時点の値は分からないため、
  // 現在の s.seed で代用して以後固定する（ここから先は決定的に安定する）。
  if (typeof comp.teamA.scheduleSeed !== 'number') comp.teamA.scheduleSeed = s.seed;
  if (comp.teamB && typeof comp.teamB.scheduleSeed !== 'number') comp.teamB.scheduleSeed = s.seed;
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
    if (!num(team.scheduleSeed, 0, 4294967295)) throw Error(`${label}の日程データが不正です。`);
    if (team.win + team.draw + team.lose !== team.played) throw Error(`${label}の成績データが不正です。`);
    if (!num(team.played, 0, 14) || !num(team.points, 0, 42))
      throw Error(`${label}の成績データが不正です。`);
    if (!Array.isArray(team.results) || team.results.length > 14)
      throw Error(`${label}の試合結果ログが不正です。`);
    for (const r of team.results)
      if (
        !r ||
        !num(r.week, 0, 47) ||
        typeof r.opponentId !== 'string' ||
        typeof r.opponentName !== 'string' ||
        !num(r.gf, 0, 30) ||
        !num(r.ga, 0, 30)
      )
        throw Error(`${label}の試合結果ログが不正です。`);
  };
  checkTeam(comp.teamA, 'Aチーム');
  if (comp.teamB) {
    checkTeam(comp.teamB, 'Bチーム');
    // Bは常にAより下の階層（同格・上位不可）。finalizeTeamB の昇降格ロジックにより通常は
    // ちょうど1つ下だが、Aの昇格幅が大きい季は2階層以上離れることもあるため、ここでは
    // 「Aより下」という不等式だけを検査する。
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
    for (const [stage, bracket, count] of [['県予選', cup.qualifier, 16], ['全国', cup.national, 32]] as const) {
      if (bracket === undefined) continue; // pre-T-2 saves continue the current season unchanged
      if (!Array.isArray(bracket.teams) || bracket.teams.length !== count ||
          !Array.isArray(bracket.rounds) || bracket.rounds.length !== Math.log2(count) ||
          !num(bracket.completedRounds, 0, bracket.rounds.length))
        throw Error(`${label}${stage}のトーナメント表が不正です。`);
      const ids = new Set<string>();
      for (const team of bracket.teams) {
        if (!team || typeof team.id !== 'string' || !team.id || ids.has(team.id) ||
            typeof team.name !== 'string' || team.name.length > 60 ||
            !num(team.strength, 1, 99) || !TACTIC_LIST.includes(team.style) ||
            !DISTRICTS.some((d) => d.id === team.districtId))
          throw Error(`${label}${stage}の出場校データが不正です。`);
        ids.add(team.id);
      }
      for (let r = 0; r < bracket.rounds.length; r++) {
        const matches = bracket.rounds[r];
        if (!Array.isArray(matches) || matches.length !== (count >> (r + 1)))
          throw Error(`${label}${stage}の対戦表が不正です。`);
        for (const match of matches) {
          if (!match ||
              (match.homeId !== null && !ids.has(match.homeId)) ||
              (match.awayId !== null && !ids.has(match.awayId)) ||
              (match.winnerId !== null && match.winnerId !== match.homeId && match.winnerId !== match.awayId) ||
              (match.home !== null && !num(match.home, 0, 30)) ||
              (match.away !== null && !num(match.away, 0, 30)) ||
              (match.penalties !== null && typeof match.penalties !== 'string'))
            throw Error(`${label}${stage}の試合結果が不正です。`);
        }
      }
    }
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

function emptyCupMatch(homeId: string | null = null, awayId: string | null = null): CupMatch {
  return { homeId, awayId, winnerId: null, home: null, away: null, penalties: null };
}

function createCupBracket(s: State, district: District, cupKey: 'ih' | 'wc', national: boolean): CupBracket {
  const count = national ? 32 : 16;
  const salt = strHash(cupKey) + (national ? 3100 : 1100);
  const districts = national
    ? [district, ...DISTRICTS.filter((d) => d.id !== district.id)
      .sort((a, b) => hf(s.seed, s.season, salt, strHash(a.id)) - hf(s.seed, s.season, salt, strHash(b.id)))
      .slice(0, count - 1)]
    : Array.from({ length: count }, () => district);
  const teams: CupTeam[] = districts.map((d, i) => {
    const base = [s.seed, s.season, salt, i];
    const raw = national
      ? 68 + hf(...base, 1) * 19 + (d.strength - 1) * 12
      : (45 + hf(...base, 1) * 20) * (1 + (district.strength - 1) * 0.5);
    return {
      id: `${cupKey}-${national ? 'n' : 'q'}-${i}`,
      name: districtSchoolName(d.id, salt + s.season * 101 + i),
      strength: clamp(Math.round(raw), 20, 99),
      style: pickTactic(hf(...base, 2)),
      districtId: d.id,
    };
  });
  // Slot 0 is the local district representative; the qualifier contains the player's school.
  teams[0] = national
    ? { ...teams[0], id: `${cupKey}-representative`, name: '代表未定' }
    : { ...teams[0], id: 'self', name: s.school, strength: Math.round([...s.players].sort((a, b) => overall(b) - overall(a)).slice(0, 11).reduce((sum, p) => sum + overall(p), 0) / 11) };
  const rounds: CupMatch[][] = [];
  for (let r = 0; r < (national ? 5 : 4); r++) {
    const matches = count >> (r + 1);
    rounds.push(Array.from({ length: matches }, (_, i) =>
      r === 0 ? emptyCupMatch(teams[i * 2].id, teams[i * 2 + 1].id) : emptyCupMatch(),
    ));
  }
  return { teams, rounds, completedRounds: 0 };
}

function cupTeam(bracket: CupBracket, id: string | null): CupTeam | undefined {
  return bracket.teams.find((team) => team.id === id);
}

function prepareNationalRepresentative(s: State, cup: CupState, cupKey: 'ih' | 'wc'): void {
  const national = cup.national;
  const qualifier = cup.qualifier;
  if (!national || !qualifier || national.completedRounds > 0) return;
  const placeholder = national.teams[0];
  if (placeholder.id !== `${cupKey}-representative`) return;
  const winnerId = qualifier.rounds.at(-1)?.[0]?.winnerId;
  if (!winnerId) return;
  const winner = cupTeam(qualifier, winnerId);
  if (!winner) return;
  national.teams[0] = winnerId === 'self'
    ? { ...placeholder, id: 'self', name: s.school, strength: strengthOf(s) }
    : { ...placeholder, name: winner.name, strength: winner.strength, style: winner.style };
  national.rounds[0][0].homeId = national.teams[0].id;
}

export function simulateCupMatch(s: State, cupKey: 'ih' | 'wc', national: boolean, round: number, index: number, a: CupTeam, b: CupTeam): { home: number; away: number; winnerId: string; penalties: string | null } {
  const tag = strHash(cupKey) + (national ? 5000 : 3000);
  // The same exponential curve drives played matches. The cap is slightly higher
  // because this quick simulation has no player tactics or skill bonuses.
  const ratio = clamp(strengthRatio(a.strength - b.strength), 0.4, 1.75);
  let home = 0;
  let away = 0;
  for (let segment = 0; segment < 6; segment++) {
    for (let chance = 0; chance < 3; chance++) {
      const key = [s.seed, s.season, tag, round, index, segment, chance];
      if (hf(...key, 1) < 0.29 * ratio * 1.9 * 0.25) home++;
      if (hf(...key, 2) < (0.28 / ratio) * 1.9 * 0.25) away++;
    }
  }
  let penalties: string | null = null;
  let winnerId = home > away ? a.id : b.id;
  if (home === away) {
    const aWon = hf(s.seed, s.season, tag, round, index, 999) < clamp(0.5 + (a.strength - b.strength) / 100, 0.2, 0.8);
    winnerId = aWon ? a.id : b.id;
    penalties = aWon ? '5 - 4' : '4 - 5';
  }
  return { home, away, winnerId, penalties };
}

function completeCupRound(s: State, bracket: CupBracket, cupKey: 'ih' | 'wc', national: boolean, round: number): void {
  if (bracket.completedRounds > round) return;
  const matches = bracket.rounds[round];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match.homeId || !match.awayId) throw Error('大会の勝ち上がりが不正です。');
    if (!match.winnerId) {
      const a = cupTeam(bracket, match.homeId)!;
      const b = cupTeam(bracket, match.awayId)!;
      const result = simulateCupMatch(s, cupKey, national, round, i, a, b);
      Object.assign(match, result);
    }
    if (round + 1 < bracket.rounds.length) {
      const next = bracket.rounds[round + 1][Math.floor(i / 2)];
      if (i % 2 === 0) next.homeId = match.winnerId;
      else next.awayId = match.winnerId;
    }
  }
  bracket.completedRounds = round + 1;
}

/** Resolve rival cup games after each calendar week, even if the player's school is eliminated. */
export function advanceCupWeek(s: State, week: number): void {
  const comp = readCompetition(s);
  for (const [cupKey, cup] of [['ih', comp.ih], ['wc', comp.wc]] as const) {
    const qRound = (cupKey === 'ih' ? IH_QUALIFIER_WEEKS : WC_QUALIFIER_WEEKS).indexOf(week);
    if (qRound >= 0 && cup.qualifier) {
      completeCupRound(s, cup.qualifier, cupKey, false, qRound);
      if (qRound === 3) prepareNationalRepresentative(s, cup, cupKey);
    }
    const nRound = (cupKey === 'ih' ? IH_NATIONAL_WEEKS : WC_NATIONAL_WEEKS).indexOf(week);
    if (nRound >= 0 && cup.national) {
      prepareNationalRepresentative(s, cup, cupKey);
      completeCupRound(s, cup.national, cupKey, true, nRound);
    }
  }
}

function bracketFixture(s: State, bracket: CupBracket, kind: CompFixtureKind, round: number): CompFixture | null {
  const match = bracket.rounds[round]?.find((m) => m.homeId === 'self' || m.awayId === 'self');
  if (!match) return null;
  const opponentId = match.homeId === 'self' ? match.awayId : match.homeId;
  const opponent = cupTeam(bracket, opponentId);
  const isQualifier = kind.endsWith('qualifier');
  const labels = isQualifier ? QUALIFIER_LABEL_PREFIX : NATIONAL_LABEL_PREFIX;
  return {
    label: `${kind.startsWith('ih') ? 'インターハイ' : '選手権'}${isQualifier ? '県予選・' : '全国・'}${labels[round]}`,
    kind,
    round,
    strength: opponent?.strength ?? 75,
    opponent: opponent?.name ?? '勝者未定',
    style: opponent?.style ?? 'balanced',
  };
}

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
  // 3.2: 全国大会の相手には自県の強度係数を掛けない（全国はどの県から来ても実力が近い）。
  // 県予選は係数を掛けるが、そのままでは効きすぎるので半分に弱める。
  const districtMult = isQualifier ? 1 + (district.strength - 1) * 0.5 : 1;
  const strengthVal = clamp(Math.round(base * districtMult), 20, 99);
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
    const round = week - IH_QUALIFIER_WEEKS[0];
    return comp.ih.qualifier
      ? bracketFixture(s, comp.ih.qualifier, 'ih_qualifier', round) ?? { ...cupFixture(s, comp, district, 'ih_qualifier', round), opponent: '勝者未定' }
      : cupFixture(s, comp, district, 'ih_qualifier', round);
  }
  if (IH_NATIONAL_WEEKS.includes(week)) {
    if (!comp.ih.qualified || !comp.ih.alive) return null;
    const round = week - IH_NATIONAL_WEEKS[0];
    return comp.ih.national
      ? bracketFixture(s, comp.ih.national, 'ih_national', round) ?? { ...cupFixture(s, comp, district, 'ih_national', round), opponent: '勝者未定' }
      : cupFixture(s, comp, district, 'ih_national', round);
  }
  if (WC_QUALIFIER_WEEKS.includes(week)) {
    if (!comp.wc.alive) return null;
    const round = week - WC_QUALIFIER_WEEKS[0];
    return comp.wc.qualifier
      ? bracketFixture(s, comp.wc.qualifier, 'wc_qualifier', round) ?? { ...cupFixture(s, comp, district, 'wc_qualifier', round), opponent: '勝者未定' }
      : cupFixture(s, comp, district, 'wc_qualifier', round);
  }
  if (WC_NATIONAL_WEEKS.includes(week)) {
    if (!comp.wc.qualified || !comp.wc.alive) return null;
    const round = week - WC_NATIONAL_WEEKS[0];
    return comp.wc.national
      ? bracketFixture(s, comp.wc.national, 'wc_national', round) ?? { ...cupFixture(s, comp, district, 'wc_national', round), opponent: '勝者未定' }
      : cupFixture(s, comp, district, 'wc_national', round);
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
function recordSelfCupMatch(bracket: CupBracket | undefined, m: ResolvableMatch): void {
  const match = bracket?.rounds[m.fixture.round]?.find((row) => row.homeId === 'self' || row.awayId === 'self');
  if (!match) return;
  const selfHome = match.homeId === 'self';
  match.home = selfHome ? m.home : m.away;
  match.away = selfHome ? m.away : m.home;
  match.winnerId = m.won ? 'self' : selfHome ? match.awayId : match.homeId;
  match.penalties = selfHome || !m.penalties
    ? m.penalties
    : m.penalties.split(' - ').reverse().join(' - ');
}
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
    // T4.1: 順位表・ライバル校の戦績表示のため、自校の試合ログを残す（他校同士の試合は
    // 保存せず、必要な時に決定的に再現する）。相手は fixture.opponent（= club.name）で
    // 対応するクラブを引き、クラブが見つからない場合でも名前だけは残す。
    const club = team.clubs.find((c) => c.name === f.opponent);
    team.results = [
      ...team.results,
      { week: s.week, opponentId: club?.id ?? f.opponent, opponentName: f.opponent, gf: m.home, ga: m.away },
    ].slice(-14);
    return;
  }
  if (f.kind === 'ih_qualifier' || f.kind === 'wc_qualifier') {
    const cup = f.kind === 'ih_qualifier' ? comp.ih : comp.wc;
    recordSelfCupMatch(cup.qualifier, m);
    if (!m.won) {
      cup.alive = false;
      cup.best = `${f.label}敗退`;
    } else if (f.round === 3) {
      cup.qualified = true;
      cup.best = '全国大会出場';
      addFunds(s, 15, '大会の勝ち上がり（全国大会出場）');
    }
    return;
  }
  if (f.kind === 'ih_national' || f.kind === 'wc_national') {
    const cup = f.kind === 'ih_national' ? comp.ih : comp.wc;
    recordSelfCupMatch(cup.national, m);
    if (!m.won) {
      cup.alive = false;
      cup.best = `${f.label}敗退`;
    } else {
      cup.best = f.round === 4 ? '全国優勝' : `${f.label}突破`;
      if (f.round === 4) {
        s.records.trophies++;
        s.reputation = clamp(s.reputation + 6);
        addFunds(s, 30, '大会の勝ち上がり（全国優勝）');
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
