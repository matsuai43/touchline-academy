// TOUCHLINE ACADEMY v4 — V4-4: 学校の世界（lib/school-world.ts）・地域色のある校名
// （lib/school-names.ts）のテスト。DESIGN_V4 2.3・2.4章で要求されている性質
// （決定性・重複無し・実在強豪校との不一致・県の強さと階層構成の相関・季をまたぐ
// 対戦相手の同一性・旧セーブ互換・s.seedを消費しないこと）を確認する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../lib/game.ts';
import {
  buildDistrictWorld,
  schoolsByTier,
  pickStableSubset,
  districtsInSide,
  SCHOOL_COUNT,
  SCHOOL_TIERS,
  type WorldSchool,
  type SchoolTier,
} from '../lib/school-world.ts';
import { isBlockedSchoolName, isBlockedYouthName } from '../lib/school-names.ts';
import { hydrateCompetition, readCompetition, type CompState } from '../lib/competition.ts';

// school-world.ts は lib/competition.ts の DISTRICTS に依存しないので、48地区IDは
// districtsInSide(EAST)+districtsInSide(WEST) から取る（DISTRICT_REGIONS が48地区すべてを
// 割り当てていることは lib/school-world.ts 側で検算済み）。
const ALL_DISTRICT_IDS = [...districtsInSide('EAST'), ...districtsInSide('WEST')];

const MID_STRENGTH = 1.15; // 名前・重複系のテストでは強さは本質でないので固定値を使う。

void test('buildDistrictWorld is deterministic: same seed/district/strength/season gives the same world', () => {
  for (const seed of [1, 42, 999]) {
    const a = buildDistrictWorld(seed, 'shizuoka', MID_STRENGTH, 3);
    const b = buildDistrictWorld(seed, 'shizuoka', MID_STRENGTH, 3);
    assert.deepEqual(a, b, `seed ${seed}: 同じ入力で異なる世界が生成されました`);
  }
});

void test('every one of the 48 districts produces exactly 24 schools with unique names', () => {
  assert.equal(ALL_DISTRICT_IDS.length, 48, '前提: 48地区ぶんのIDが揃っているはず');
  for (const districtId of ALL_DISTRICT_IDS) {
    const world = buildDistrictWorld(7, districtId, MID_STRENGTH, 1);
    assert.equal(world.length, SCHOOL_COUNT, `${districtId}: 学校数が${SCHOOL_COUNT}ではありません`);
    const names = new Set(world.map((s) => s.name));
    assert.equal(names.size, world.length, `${districtId}: 校名が重複しています`);
  }
});

void test('no generated name (across all 48 districts, several seeds, all tiers, and youth) matches the real-school blocklist or the prefecture-name pattern', () => {
  const seeds = [1, 2, 3, 42, 100, 12345];
  let checked = 0;
  for (const seed of seeds) {
    for (const districtId of ALL_DISTRICT_IDS) {
      for (const season of [1, 5]) {
        const world = buildDistrictWorld(seed, districtId, MID_STRENGTH, season);
        for (const school of world) {
          checked++;
          if (school.isYouth) {
            assert.equal(
              isBlockedYouthName(school.name),
              false,
              `seed ${seed} / ${districtId} / season ${season}: ユース名「${school.name}」が実在Jクラブ下部組織の禁止パターンに一致します`,
            );
          } else {
            assert.equal(
              isBlockedSchoolName(school.name),
              false,
              `seed ${seed} / ${districtId} / season ${season}: 校名「${school.name}」が実在強豪校の除外リスト、または「都道府県名+高校」パターンに一致します`,
            );
          }
        }
      }
    }
  }
  assert.ok(checked > 1000, '前提: 十分な件数を検証したはず');
});

void test('a stronger district has, on average, higher school strength and more high-tier schools than a weaker one', () => {
  const WEAK = 1.0; // DISTRICTS の C帯（最弱）に相当。
  const STRONG = 1.35; // DISTRICTS の S帯（最強）に相当。
  const highTier = (t: SchoolTier) => t === 'national' || t === 'regional';
  for (const districtId of ['shizuoka', 'aomori', 'okinawa']) {
    for (const season of [1, 4]) {
      const weakWorld = buildDistrictWorld(55, districtId, WEAK, season);
      const strongWorld = buildDistrictWorld(55, districtId, STRONG, season);
      const avg = (world: WorldSchool[]) => world.reduce((a, s) => a + s.strength, 0) / world.length;
      assert.ok(
        avg(strongWorld) > avg(weakWorld),
        `${districtId} season ${season}: 強い県の平均strength(${avg(strongWorld)})が弱い県(${avg(weakWorld)})以下です`,
      );
      const highCount = (world: WorldSchool[]) => world.filter((s) => highTier(s.tier)).length;
      assert.ok(
        highCount(strongWorld) >= highCount(weakWorld),
        `${districtId} season ${season}: 強い県の上位階層(地域/全国)校数(${highCount(strongWorld)})が弱い県(${highCount(weakWorld)})未満です`,
      );
    }
  }
});

void test('SCHOOL_TIERS ordering / band coverage: pickStableSubset excludes season, so a stable subset of a tier stays identical across seasons when the pool identity is unchanged', () => {
  // makeClubs()（lib/competition.ts）が同じ理屈で「季をまたいでも同じ7校」を保証している
  // 内部メカニズムそのものを、school-world.ts のレベルで直接確認する。
  for (const tier of SCHOOL_TIERS) {
    const worldSeason1 = buildDistrictWorld(321, 'nagano', 1.2, 1);
    const worldSeason9 = buildDistrictWorld(321, 'nagano', 1.2, 9);
    const poolA = schoolsByTier(worldSeason1, tier);
    const poolB = schoolsByTier(worldSeason9, tier);
    // 学校の「顔ぶれ」（id集合）はseasonに関わらず同じはず（strengthだけが違う）。
    assert.deepEqual(
      poolA.map((s) => s.id).sort(),
      poolB.map((s) => s.id).sort(),
      `tier ${tier}: 季によって階層の顔ぶれ自体が変わっています`,
    );
    if (poolA.length === 0) continue;
    const count = Math.min(7, poolA.length);
    const pickedA = pickStableSubset(poolA, count, [321, 'nagano', tier, 'A']);
    const pickedB = pickStableSubset(poolB, count, [321, 'nagano', tier, 'A']);
    assert.deepEqual(
      pickedA.map((s) => s.id).sort(),
      pickedB.map((s) => s.id).sort(),
      `tier ${tier}: pickStableSubsetの選出が季をまたいで変わっています`,
    );
  }
});

// ---------------------------------------------------------------------------
// ここからは lib/competition.ts 経由の統合テスト（実際の comp.teamA.clubs・
// hydrateCompetition()・s.seed が対象）。
// ---------------------------------------------------------------------------

/** 中位の成績（昇格＝上位2位・降格＝下位2位のどちらの閾値もまたがない）を明示的に
 *  与えてから季を進める。0-0-0の見かけ上のタイによる意図しない昇降格を避けるための
 *  ヘルパー（tests/competition.test.ts の growBRoster 系テストと同じ流儀）。 */
function forceMidTableAndAdvance(comp: CompState, s: { season: number }): void {
  comp.teamA.played = 14;
  comp.teamA.win = 6;
  comp.teamA.draw = 2;
  comp.teamA.lose = 6;
  comp.teamA.points = 20;
  comp.teamA.gf = 20;
  comp.teamA.ga = 20;
  s.season += 1;
}

void test('league opponents (comp.teamA.clubs) come from the school world and stay the same schools across seasons when tier and district are unchanged', () => {
  let found = false;
  for (let seed = 1; seed <= 80 && !found; seed++) {
    const s = newGame('据置検証高校', seed);
    hydrateCompetition(s);
    const comp = readCompetition(s);
    const tierBefore = comp.teamA.tier;
    const districtBefore = comp.districtId;
    const idsBefore = comp.teamA.clubs.map((c) => c.id).sort();
    assert.ok(idsBefore.length > 0, '前提: 初年度からクラブが生成されているはず');
    for (const c of comp.teamA.clubs) {
      assert.ok(c.schoolId, '対戦相手には学校の世界のIDが付与されているはず');
      assert.equal(c.districtId, districtBefore, '対戦相手の所属県が記録されているはず');
    }

    forceMidTableAndAdvance(comp, s);
    hydrateCompetition(s);
    const comp2 = readCompetition(s);
    if (comp2.teamA.tier !== tierBefore || comp2.districtId !== districtBefore) continue; // このseedでは昇降格/転籍が起きた

    found = true;
    const idsAfter = comp2.teamA.clubs.map((c) => c.id).sort();
    assert.deepEqual(
      idsAfter,
      idsBefore,
      `seed ${seed}: 階層・所属県が変わっていないのに対戦相手の顔ぶれが変わっています`,
    );
  }
  assert.ok(found, 'テストの前提: 中位成績で昇降格を回避できるseedが見つかりませんでした');
});

void test('an old save without a `world` field hydrates one on load (24 home schools, matching the current district)', () => {
  const s = newGame('旧世界検証高校', 12);
  hydrateCompetition(s);
  const comp = readCompetition(s);
  // T-12/T4系の他テストと同じ流儀: フィールドを直接削除して「導入前のセーブ」を模す。
  delete (comp as Partial<CompState>).world;
  hydrateCompetition(s);
  const reloaded = readCompetition(s);
  assert.equal(reloaded.world.homeSchools.length, 24, '旧セーブは自県24校の世界を得るはず');
  assert.equal(reloaded.world.homeDistrictId, reloaded.districtId);
  assert.equal(reloaded.world.homeSeason, s.season);
});

void test('world generation never consumes rand(s): s.seed is unchanged before and after hydrating the competition/world', () => {
  for (const seed of [1, 55, 999999]) {
    const s = newGame('乱数非消費検証高校', seed);
    const seedBefore = s.seed;
    hydrateCompetition(s); // 初回hydrate: comp・世界・カップ表・クラブをすべて生成する
    assert.equal(s.seed, seedBefore, `seed ${seed}: 初回hydrateCompetition()でs.seedが変化しました`);
    // 他県の世界を明示的に何度も引いても消費しない（districtSchoolsOf/tierPool経由）ことも確認する。
    readCompetition(s);
    readCompetition(s);
    assert.equal(s.seed, seedBefore, `seed ${seed}: 複数回のreadCompetition()呼び出しでs.seedが変化しました`);
  }
});
