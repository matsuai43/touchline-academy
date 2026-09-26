// TOUCHLINE ACADEMY v4 — V4-4: 学校の世界（DESIGN_V4 2.3章）
//
// 各都道府県に24校程度を決定的に用意するモジュール。lib/game.ts の Tactic 型だけを
// （型情報として）借りる以外は完全に独立しており、lib/competition.ts の DISTRICTS・
// districtById には一切依存しない（循環importを避けるため、県の強度係数は呼び出し側
// ＝lib/competition.tsが渡す）。V4-5（リーグ階層・参入戦）・V4-6（県予選・全国代表）・
// V4-7（練習試合の相手選択）はこのファイルの型・関数の上に積む想定。
//
// 決定性: すべての生成は s.seed・県ID・季（season）だけから決まるハッシュ関数で行う。
// s.seed を消費する rand(s) は一切使わない（＝この世界を何度作り直しても、また試合の
// 乱数消費順にも影響しない）。

import type { Tactic } from './game.ts';
import { regionalSchoolName, regionalYouthName, type DistrictId } from './school-names.ts';

export type { DistrictId };

// ---------------------------------------------------------------------------
// 決定的な擬似乱数（lib/competition.ts などと同じ流儀）
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
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// 階層（LeagueTier + 県リーグ外の pref3。pref3 は内部用: 24校のうち下位帯で、
// リーグ表には出てこない「県リーグ外」の学校を表す。lib/competition.ts の
// LeagueTier ('pref2'|'pref1'|'regional'|'national') はこの型の部分集合として
// 常に代入互換）。
// ---------------------------------------------------------------------------
export type SchoolTier = 'pref3' | 'pref2' | 'pref1' | 'regional' | 'national';
export const SCHOOL_TIERS: SchoolTier[] = ['pref3', 'pref2', 'pref1', 'regional', 'national'];
export function isLeagueTier(t: SchoolTier): t is 'pref2' | 'pref1' | 'regional' | 'national' {
  return t !== 'pref3';
}

/** 難易度帯。県2部/県1部/地域/全国は lib/competition.ts の TIER_BAND と揃えてある。 */
export const TIER_BAND: Record<SchoolTier, [number, number]> = {
  pref3: [25, 42],
  pref2: [40, 55],
  pref1: [55, 68],
  regional: [66, 80],
  national: [78, 93],
};

const TACTIC_LIST: Tactic[] = ['balanced', 'possession', 'counter', 'press'];

// ---------------------------------------------------------------------------
// 学校
// ---------------------------------------------------------------------------
export type WorldSchool = {
  /** 県内で安定したID（`${districtId}-${idx}`）。季をまたいでも同じ学校なら変わらない。 */
  id: string;
  name: string;
  districtId: DistrictId;
  tier: SchoolTier;
  strength: number;
  /** 伝統・強豪度（1〜5）。 */
  tradition: 1 | 2 | 3 | 4 | 5;
  tactic: Tactic;
  isYouth: boolean;
};

export const SCHOOL_COUNT = 24;

// 階層ごとの学校数（24校中）。県の強度係数が低い県は WEAK、高い県は STRONG に近づく
// （線形補間）。合計は常に24になるよう pref3 で帳尻を合わせる。
const WEAK_ALLOC: Record<SchoolTier, number> = { national: 0, regional: 1, pref1: 4, pref2: 8, pref3: 11 };
const STRONG_ALLOC: Record<SchoolTier, number> = { national: 2, regional: 4, pref1: 7, pref2: 7, pref3: 4 };
const ALLOC_ORDER: SchoolTier[] = ['national', 'regional', 'pref1', 'pref2', 'pref3'];

function tierAllocation(districtStrength: number): Record<SchoolTier, number> {
  const t = clamp((districtStrength - 1) / 0.35, 0, 1);
  const counts: Record<SchoolTier, number> = { pref3: 0, pref2: 0, pref1: 0, regional: 0, national: 0 };
  for (const tier of ALLOC_ORDER) {
    counts[tier] = Math.round(WEAK_ALLOC[tier] + (STRONG_ALLOC[tier] - WEAK_ALLOC[tier]) * t);
  }
  let sum = ALLOC_ORDER.reduce((a, k) => a + counts[k], 0);
  // 丸め誤差はまず pref3、それでも合わなければ pref2 で帳尻を合わせる（両方とも常に
  // 十分な数があるので24校を割り切れる。国内の他の帯を歪めない）。
  if (sum !== SCHOOL_COUNT) {
    counts.pref3 = Math.max(0, counts.pref3 + (SCHOOL_COUNT - sum));
    sum = ALLOC_ORDER.reduce((a, k) => a + counts[k], 0);
  }
  if (sum !== SCHOOL_COUNT) counts.pref2 += SCHOOL_COUNT - sum;
  return counts;
}

function youthChance(tier: SchoolTier): number {
  if (tier === 'national') return 0.25;
  if (tier === 'regional') return 0.15;
  if (tier === 'pref1') return 0.05;
  return 0;
}
function traditionBase(tier: SchoolTier): number {
  return tier === 'national' ? 5 : tier === 'regional' ? 4 : tier === 'pref1' ? 3 : tier === 'pref2' ? 2 : 1;
}

/** 指定県の学校の世界（24校）を決定的に作る。identity（id・名前・階層・伝統・戦術・
 *  ユースか否か）は season に依存しない（＝どの季に呼んでも同じ学校が同じIDで返る）。
 *  strength だけ season ごとに小さく揺れる（±最大3程度、TIER_BAND の外に大きくは出ない）。
 *  districtStrength は lib/competition.ts の District.strength（1.00〜1.35程度）を渡す。 */
export function buildDistrictWorld(
  seed: number,
  districtId: DistrictId,
  districtStrength: number,
  season: number,
): WorldSchool[] {
  const dh = strHash(districtId);
  const counts = tierAllocation(districtStrength);
  const idxs = Array.from({ length: SCHOOL_COUNT }, (_, i) => i);
  const scored = idxs
    .map((idx) => ({ idx, score: hf(seed, dh, idx, 301) }))
    .sort((a, b) => b.score - a.score);
  const tierOf: SchoolTier[] = new Array(SCHOOL_COUNT);
  let cursor = 0;
  for (const tier of ALLOC_ORDER) {
    for (let i = 0; i < counts[tier]; i++) {
      const entry = scored[cursor++];
      if (entry) tierOf[entry.idx] = tier;
    }
  }
  // 丸め誤差などで漏れがあれば pref3 で埋める（理論上起きないが安全網）。
  for (let i = 0; i < SCHOOL_COUNT; i++) if (!tierOf[i]) tierOf[i] = 'pref3';

  const used = new Set<string>();
  const schools: WorldSchool[] = [];
  for (let idx = 0; idx < SCHOOL_COUNT; idx++) {
    const tier = tierOf[idx];
    const isYouth = hf(seed, dh, idx, 900) < youthChance(tier);
    const name = isYouth
      ? regionalYouthName(districtId, [seed, dh, idx], used)
      : regionalSchoolName(districtId, [seed, dh, idx], used);
    used.add(name);
    const tradition = clamp(Math.round(traditionBase(tier) + (hf(seed, dh, idx, 777) - 0.5) * 2), 1, 5) as
      | 1
      | 2
      | 3
      | 4
      | 5;
    const tactic = TACTIC_LIST[Math.min(3, Math.floor(hf(seed, dh, idx, 851) * 4))];
    const [bandMin, bandMax] = TIER_BAND[tier];
    const basePos = hf(seed, dh, idx, 401);
    // season ごとの小さな揺れ（累積せず、季番号だけから決まる＝いつ計算しても同じ値になる）。
    const wiggle = (hf(seed, dh, idx, season, 502) - 0.5) * 6;
    const strength = clamp(Math.round(bandMin + (bandMax - bandMin) * basePos + wiggle), 20, 99);
    schools.push({ id: `${districtId}-${idx}`, name, districtId, tier, strength, tradition, tactic, isYouth });
  }
  return schools;
}

export function schoolsByTier(schools: WorldSchool[], tier: SchoolTier): WorldSchool[] {
  return schools.filter((s) => s.tier === tier);
}

/** pool から count 校を決定的に選ぶ。keyParts が同じ（＝季を含めない）限り、pool の
 *  中身（学校の集合）が変わらなければ何度呼んでも同じ学校が選ばれる。これにより、
 *  同じ階層・同じ県に留まり続ける限り「同じ学校」がリーグ相手であり続ける
 *  （季をキーに含めていないのが肝）。 */
export function pickStableSubset(pool: WorldSchool[], count: number, keyParts: (number | string)[]): WorldSchool[] {
  const numericKey = keyParts.map((k) => (typeof k === 'number' ? k : strHash(k)));
  const scored = pool.map((s) => ({ s, score: hf(...numericKey, strHash(s.id)) }));
  scored.sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id));
  return scored.slice(0, count).map((e) => e.s);
}

/** targetStrength に近い学校を pool から1校選ぶ（カップ戦・練習試合の相手に、実際に
 *  使う strength 値とは別に「名前・所属・戦術」だけを世界から借りるための関数）。
 *  近い順に最大5校の候補から keyParts で決定的に1つ選ぶ（毎回同じ1位に偏らないように）。 */
export function nearestSchool(
  pool: WorldSchool[],
  targetStrength: number,
  keyParts: (number | string)[],
  excludeIds?: ReadonlySet<string>,
): WorldSchool | null {
  const candidates = pool.filter((s) => !excludeIds?.has(s.id));
  if (!candidates.length) return null;
  const sorted = candidates
    .map((s) => ({ s, dist: Math.abs(s.strength - targetStrength) }))
    .sort((a, b) => a.dist - b.dist || a.s.id.localeCompare(b.s.id));
  const window = sorted.slice(0, Math.min(5, sorted.length));
  const numericKey = keyParts.map((k) => (typeof k === 'number' ? k : strHash(k)));
  const u = hf(...numericKey, 6767);
  return window[Math.min(window.length - 1, Math.floor(u * window.length))].s;
}

// ---------------------------------------------------------------------------
// 9地域・EAST/WEST（DESIGN_V4 2.2章。参入戦・地域リーグはV4-5でこの上に積む）
// ---------------------------------------------------------------------------
export type RegionSide = 'EAST' | 'WEST';
export type DistrictRegionInfo = { region: string; side: RegionSide };

const REGION_MAP: Record<string, [string, RegionSide]> = {
  hokkaido: ['北海道', 'EAST'],
  aomori: ['東北', 'EAST'], iwate: ['東北', 'EAST'], akita: ['東北', 'EAST'],
  miyagi: ['東北', 'EAST'], yamagata: ['東北', 'EAST'], fukushima: ['東北', 'EAST'],
  ibaraki: ['関東', 'EAST'], tochigi: ['関東', 'EAST'], gunma: ['関東', 'EAST'],
  saitama: ['関東', 'EAST'], chiba: ['関東', 'EAST'], tokyo_east: ['関東', 'EAST'],
  tokyo_west: ['関東', 'EAST'], kanagawa: ['関東', 'EAST'], yamanashi: ['関東', 'EAST'],
  niigata: ['北信越', 'EAST'], nagano: ['北信越', 'EAST'], toyama: ['北信越', 'EAST'],
  ishikawa: ['北信越', 'EAST'], fukui: ['北信越', 'EAST'],
  aichi: ['東海', 'EAST'], gifu: ['東海', 'EAST'], shizuoka: ['東海', 'EAST'], mie: ['東海', 'EAST'],
  shiga: ['関西', 'WEST'], kyoto: ['関西', 'WEST'], osaka: ['関西', 'WEST'],
  hyogo: ['関西', 'WEST'], nara: ['関西', 'WEST'], wakayama: ['関西', 'WEST'],
  tottori: ['中国', 'WEST'], shimane: ['中国', 'WEST'], okayama: ['中国', 'WEST'],
  hiroshima: ['中国', 'WEST'], yamaguchi: ['中国', 'WEST'],
  tokushima: ['四国', 'WEST'], kagawa: ['四国', 'WEST'], ehime: ['四国', 'WEST'], kochi: ['四国', 'WEST'],
  fukuoka: ['九州', 'WEST'], saga: ['九州', 'WEST'], nagasaki: ['九州', 'WEST'], kumamoto: ['九州', 'WEST'],
  oita: ['九州', 'WEST'], miyazaki: ['九州', 'WEST'], kagoshima: ['九州', 'WEST'], okinawa: ['九州', 'WEST'],
};
export const DISTRICT_REGIONS: Record<DistrictId, DistrictRegionInfo> = Object.fromEntries(
  Object.entries(REGION_MAP).map(([id, [region, side]]) => [id, { region, side }]),
);
export function districtRegion(districtId: DistrictId): DistrictRegionInfo {
  return DISTRICT_REGIONS[districtId] ?? { region: '関東', side: 'EAST' };
}
export function districtsInRegion(regionName: string): DistrictId[] {
  return Object.entries(DISTRICT_REGIONS)
    .filter(([, info]) => info.region === regionName)
    .map(([id]) => id);
}
export function districtsInSide(side: RegionSide): DistrictId[] {
  return Object.entries(DISTRICT_REGIONS)
    .filter(([, info]) => info.side === side)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// 所属の表示ラベル（DESIGN_V4 3.2章。「県1部」「地域・関東」「全国EAST」）
// ---------------------------------------------------------------------------
export function tierLabel(tier: SchoolTier, region?: DistrictRegionInfo): string {
  if (tier === 'pref2') return '県2部';
  if (tier === 'pref1') return '県1部';
  if (tier === 'regional') return region ? `地域・${region.region}` : '地域リーグ';
  if (tier === 'national') return region ? `全国${region.side}` : '全国リーグ';
  return '県リーグ外';
}
