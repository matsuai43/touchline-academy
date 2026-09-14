import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, strength, type State, type Training } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import {
  DISTRICTS,
  districtById,
  hydrateCompetition,
  validateCompetition,
  readCompetition,
  competitionFixture,
  resolveCompetitionMatch,
  mapLegacyFixtureKind,
  choosablePrefectures,
  canChoosePrefecture,
  handleCompetition,
  bTeamEligible,
  LEAGUE_TIERS,
  LEAGUE_WEEKS,
  FRIENDLY_WEEKS,
  IH_QUALIFIER_WEEKS,
  IH_NATIONAL_WEEKS,
  WC_QUALIFIER_WEEKS,
  WC_NATIONAL_WEEKS,
  type CompFixture,
  type CompState,
  type LeagueTier,
} from '../lib/competition.ts';

// ---------------------------------------------------------------------------
// テスト用ヘルパー（本体は触らず、公開APIだけで週を進める。squad.test.ts と同じ流儀）
// ---------------------------------------------------------------------------
function resolveLife(s: State): State {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
function step(s: State, t: Training = 'balance'): State {
  if (s.event) s = act(s, { type: 'event', choice: 'team' });
  s = resolveLife(s);
  s = act(s, { type: 'train', training: t });
  if (s.pending) {
    s = act(s, { type: 'start' });
    while (!s.match!.done) s = act(s, { type: 'segment' });
    s = act(s, { type: 'finish' });
  }
  return s;
}

/** 現在のシーズン向けに、指定した都道府県のクラブ・日程を即座に作り直す（本来は3年ごとの
 *  選択が「来シーズンから反映」だが、難易度テストのために即時反映させるテスト専用の裏口）。 */
function setDistrictNow(s: State, districtId: string): void {
  const comp = readCompetition(s);
  comp.districtId = districtId;
  comp.seasonGenerated = 0;
  hydrateCompetition(s);
}

// s.seed（読み取りのみ、消費しない）と s.season/s.week を種にした、テスト専用の決定的な
// 疑似乱数・試合結果シミュレータ。lib/game.ts の本物の試合エンジンは使わず（配線前のため
// 呼べない）、strength(s) と相手の strength の差から決定的にスコアを作る。
function localHash(...ns: number[]): number {
  let x = 2166136261 >>> 0;
  for (const n of ns) x = Math.imul(x ^ (n >>> 0), 16777619) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function simulateFixtureResult(
  s: State,
  f: CompFixture,
): { home: number; away: number; won: boolean; penalties: string | null } {
  const our = strength(s);
  const diff = our - f.strength;
  const u1 = localHash(s.seed, s.season, s.week, 1),
    u2 = localHash(s.seed, s.season, s.week, 2);
  const home = Math.max(0, Math.round(1.3 + diff / 22 + (u1 - 0.5) * 1.8));
  const away = Math.max(0, Math.round(1.3 - diff / 24 + (u2 - 0.5) * 1.8));
  let won = home > away,
    penalties: string | null = null;
  if (home === away && f.kind !== 'friendly' && f.kind !== 'league') {
    won = localHash(s.seed, s.season, s.week, 3) < 0.5 + diff / 200;
    penalties = won ? '5-4' : '4-5';
  }
  return { home, away, won, penalties };
}
/** 現在の週の対戦カードを取得し、結果をシミュレートして反映する。無ければ何もしない。 */
function playCompetitionWeek(s: State): void {
  const f = competitionFixture(s, s.week);
  if (!f) return;
  const r = simulateFixtureResult(s, f);
  resolveCompetitionMatch(s, { fixture: f, ...r });
}
/** 本物の act()（週送り・卒業・新入生・評判の変化など）で時計を進めつつ、その裏で
 *  competition.ts 側の日程も独立にシミュレートする。1season = 48週。 */
function playSeasons(s: State, seasons: number): State {
  for (let n = 0; n < seasons; n++) {
    for (let i = 0; i < 48; i++) {
      playCompetitionWeek(s);
      s = step(s);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// 都道府県データ
// ---------------------------------------------------------------------------
void test('48 districts cover every prefecture, with Tokyo split into west/east', () => {
  assert.equal(DISTRICTS.length, 48);
  const ids = DISTRICTS.map((d) => d.id);
  assert.equal(new Set(ids).size, 48, '地区IDが重複しています');
  assert.ok(ids.includes('tokyo_west'));
  assert.ok(ids.includes('tokyo_east'));
  for (const d of DISTRICTS) {
    assert.ok(d.strength >= 1.0 && d.strength <= 1.35, `${d.id} の強度係数が範囲外: ${d.strength}`);
    assert.ok(d.stars >= 1 && d.stars <= 5);
    assert.ok(d.schools > 0);
    assert.ok(d.name.length > 0 && d.name.length < 20);
  }
  // 現在の高校サッカーの実勢を踏まえ、上位帯に含まれるべき地区
  const upperBand = new Set(DISTRICTS.filter((d) => d.strength >= 1.24).map((d) => d.id));
  for (const id of [
    'shizuoka', 'chiba', 'saitama', 'kanagawa', 'tokyo_west', 'tokyo_east',
    'osaka', 'aomori', 'nagasaki', 'kagoshima',
  ])
    assert.ok(upperBand.has(id), `${id} は上位帯に含まれるべきです`);
  // これは難易度パラメータであり実在校の列挙ではない: District に school 固有名は無い
  assert.ok(DISTRICTS.every((d) => !('schoolNames' in d)));
});

void test('choosablePrefectures exposes all districts for UI display', () => {
  const list = choosablePrefectures();
  assert.equal(list.length, 48);
  assert.deepEqual(
    list.map((d) => d.id).sort(),
    DISTRICTS.map((d) => d.id).sort(),
  );
});

// ---------------------------------------------------------------------------
// 赴任先の選択（初期・3年ごと）
// ---------------------------------------------------------------------------
void test('prefecture can be chosen initially and again only every 3 seasons', () => {
  const s = newGame('検証高校', 5);
  hydrateCompetition(s);
  assert.ok(canChoosePrefecture(s), '初期選択は season 1 から可能なはず');
  const before = readCompetition(s).districtId;
  const target = DISTRICTS.find((d) => d.id !== before)!;
  assert.ok(handleCompetition(s, { type: 'compPrefecture', districtId: target.id }));
  assert.equal(readCompetition(s).districtId, target.id);
  assert.equal(readCompetition(s).nextChoiceSeason, s.season + 3);
  assert.ok(!canChoosePrefecture(s), '選択直後は次の周期まで選び直せないはず');
  assert.throws(() => handleCompetition(s, { type: 'compPrefecture', districtId: before }));
  s.season += 3;
  assert.ok(canChoosePrefecture(s), '3年後には選び直せるはず');
  assert.throws(() => handleCompetition(s, { type: 'compPrefecture', districtId: 'nonexistent' }));
});

// ---------------------------------------------------------------------------
// 年間カレンダー: 週の重複が無いこと
// ---------------------------------------------------------------------------
void test('the weekly calendar never double-books a week across all competitions', () => {
  const all = [
    ...LEAGUE_WEEKS,
    ...FRIENDLY_WEEKS,
    ...IH_QUALIFIER_WEEKS,
    ...IH_NATIONAL_WEEKS,
    ...WC_QUALIFIER_WEEKS,
    ...WC_NATIONAL_WEEKS,
  ];
  assert.equal(new Set(all).size, all.length, '同じ週に複数の大会が割り当てられています');
  for (const w of all) assert.ok(w >= 0 && w <= 47, `週番号が範囲外: ${w}`);
  assert.equal(LEAGUE_WEEKS.length, 14, 'リーグはホーム&アウェーで14試合のはず');
});

void test('competitionFixture never returns two fixtures for the same week in a live season', () => {
  const s = newGame('日程検証高校', 71);
  hydrateCompetition(s);
  const seenWeeks = new Set<number>();
  for (let w = 0; w < 48; w++) {
    const f = competitionFixture(s, w);
    if (f) {
      assert.ok(!seenWeeks.has(w), `週 ${w} に複数の試合が重複しました`);
      seenWeeks.add(w);
    }
  }
});

// ---------------------------------------------------------------------------
// 難易度カーブ
// ---------------------------------------------------------------------------
void test('difficulty rises from prefecture qualifier toward the national final', () => {
  const s = newGame('難易度検証高校', 21);
  hydrateCompetition(s);
  setDistrictNow(s, 'yamagata'); // 下位帯（係数ほぼ1.00）で基準を見る
  const comp = readCompetition(s);
  const qualR0 = competitionFixture(s, IH_QUALIFIER_WEEKS[0])!;
  assert.equal(qualR0.kind, 'ih_qualifier');
  assert.ok(qualR0.strength >= 40 && qualR0.strength <= 65, `県予選の強さが目安から外れています: ${qualR0.strength}`);
  comp.ih.qualified = true; // 全国フィクスチャを取得するため直接フラグを立てる
  const natFinal = competitionFixture(s, IH_NATIONAL_WEEKS[IH_NATIONAL_WEEKS.length - 1])!;
  assert.equal(natFinal.kind, 'ih_national');
  assert.ok(natFinal.strength > qualR0.strength, '全国決勝は県予選より手強いはず');
  assert.ok(natFinal.strength >= 85, `全国決勝の強さが低すぎます: ${natFinal.strength}`);
});

void test('a contested district scales cup difficulty up compared to a thin district', () => {
  const weak = newGame('薄い地区高校', 21);
  setDistrictNow(weak, 'yamagata');
  const strong = newGame('激戦地区高校', 21);
  setDistrictNow(strong, 'shizuoka');
  readCompetition(weak).wc.qualified = true;
  readCompetition(strong).wc.qualified = true;
  for (const round of [0, 2, 4]) {
    const week = WC_NATIONAL_WEEKS[round];
    const w = competitionFixture(weak, week)!;
    const st = competitionFixture(strong, week)!;
    assert.ok(st.strength >= w.strength, `round${round}: 激戦区(${st.strength})が薄い地区(${w.strength})より弱くなっています`);
  }
  // 県予選も同様（激戦区は県予選から厳しい）
  const wq = competitionFixture(weak, IH_QUALIFIER_WEEKS[0])!;
  const sq = competitionFixture(strong, IH_QUALIFIER_WEEKS[0])!;
  assert.ok(sq.strength >= wq.strength);
});

void test('league difficulty band rises with tier', () => {
  const s = newGame('リーグ難易度検証高校', 33);
  hydrateCompetition(s);
  setDistrictNow(s, 'yamagata'); // 係数ほぼ1.00の地区で基準を見る
  const comp = readCompetition(s);
  const avgByTier: Record<LeagueTier, number> = { pref2: 0, pref1: 0, regional: 0, national: 0 };
  for (const tier of LEAGUE_TIERS) {
    comp.teamA.tier = tier;
    comp.seasonGenerated = 0;
    hydrateCompetition(s);
    const clubs = readCompetition(s).teamA.clubs;
    avgByTier[tier] = clubs.reduce((a, c) => a + c.strength, 0) / clubs.length;
  }
  assert.ok(avgByTier.pref1 > avgByTier.pref2, `pref1(${avgByTier.pref1}) <= pref2(${avgByTier.pref2})`);
  assert.ok(avgByTier.regional > avgByTier.pref1, `regional(${avgByTier.regional}) <= pref1(${avgByTier.pref1})`);
  assert.ok(avgByTier.national > avgByTier.regional, `national(${avgByTier.national}) <= regional(${avgByTier.regional})`);
});

// ---------------------------------------------------------------------------
// 旧セーブの Fixture.kind マッピング
// ---------------------------------------------------------------------------
void test('legacy fixture kinds map deterministically to the new kind set', () => {
  assert.equal(mapLegacyFixtureKind('friendly', 0), 'friendly');
  assert.equal(mapLegacyFixtureKind('summer', 0), 'ih_qualifier');
  assert.equal(mapLegacyFixtureKind('summer', 1), 'ih_qualifier');
  assert.equal(mapLegacyFixtureKind('summer', 2), 'ih_national');
  assert.equal(mapLegacyFixtureKind('qualifier', 3), 'wc_qualifier');
  assert.equal(mapLegacyFixtureKind('national', 4), 'wc_national');
});

// ---------------------------------------------------------------------------
// 決定性
// ---------------------------------------------------------------------------
void test('same seed produces the same schedule, opponents and results', () => {
  function run() {
    let s = newGame('決定性検証高校', 4242);
    hydrateCompetition(s);
    const log: string[] = [];
    for (let n = 0; n < 3; n++) {
      for (let i = 0; i < 48; i++) {
        const f = competitionFixture(s, s.week);
        if (f) {
          log.push(`${s.season}-${s.week}-${f.kind}-${f.round}-${f.opponent}-${f.strength}-${f.style}`);
          const r = simulateFixtureResult(s, f);
          resolveCompetitionMatch(s, { fixture: f, ...r });
        }
        s = step(s);
      }
    }
    return { log, comp: JSON.parse(JSON.stringify(readCompetition(s))) as CompState };
  }
  const a = run();
  const b = run();
  assert.ok(a.log.length > 0, 'テストが何も対戦を生成していません');
  assert.deepEqual(a.log, b.log, '同じシードで日程・対戦相手・難易度が一致しません');
  assert.deepEqual(a.comp, b.comp, '同じシードで大会の最終状態が一致しません');
});

// ---------------------------------------------------------------------------
// A/Bチームの階層
// ---------------------------------------------------------------------------
void test('team B, when it exists, is always exactly one tier below team A and never shares a tier', () => {
  // 初期18人はAチーム上限20人に収まるため、まず部員数を増やす（自然な入部・卒業サイクルを
  // 数シーズン回すことで、既存の入部システムだけを使って30人近くまで育てる）。
  let s = newGame('AB階層検証高校', 900);
  for (let n = 0; n < 8; n++) for (let i = 0; i < 48; i++) s = step(s);
  s.reputation = 80; // Bチーム参戦条件を満たす
  const bRoster = () => s.players.filter((p) => s.v3.squad.players[p.id]?.team === 'B').length;
  assert.ok(bRoster() >= 8, `Bチームに十分な部員がいません（${bRoster()}人、部員合計${s.players.length}人）`);
  hydrateCompetition(s);
  const comp = readCompetition(s);
  for (const tierA of LEAGUE_TIERS) {
    comp.teamA.tier = tierA;
    comp.seasonGenerated = 0;
    hydrateCompetition(s);
    const after = readCompetition(s);
    if (tierA === 'pref2') {
      assert.equal(after.teamB, null, '最下層に居るときBチームは参戦しないはず');
    } else {
      assert.ok(after.teamB, `tierA=${tierA} のときBチームが存在するはず（部員数が十分なら）`);
      const ia = LEAGUE_TIERS.indexOf(after.teamA.tier),
        ib = LEAGUE_TIERS.indexOf(after.teamB!.tier);
      assert.equal(ib, ia - 1, 'BチームはAチームのちょうど1つ下の階層のはず');
    }
  }
});

void test('bTeamEligible requires both reputation and a bench deep enough to field a B squad', () => {
  const s = newGame('B適格検証高校', 3);
  s.reputation = 10;
  assert.equal(bTeamEligible(s), false);
  s.reputation = 80;
  // 初期18人はAチーム上限20人に収まるため、Bチームはまだ組めない
  assert.equal(bTeamEligible(s), false);
});

// ---------------------------------------------------------------------------
// 10シーズン通しのシミュレーション
// ---------------------------------------------------------------------------
void test('10 seasons of league promotion/relegation never break invariants', () => {
  for (const seed of [1, 17, 58, 200]) {
    let s = newGame('10季検証高校', seed);
    hydrateCompetition(s);
    s = playSeasons(s, 10);
    validateCompetition(s);
    const comp = readCompetition(s);
    assert.ok(LEAGUE_TIERS.includes(comp.teamA.tier), `seed ${seed}: tierA が範囲外`);
    if (comp.teamB) {
      const ia = LEAGUE_TIERS.indexOf(comp.teamA.tier),
        ib = LEAGUE_TIERS.indexOf(comp.teamB.tier);
      assert.ok(ib < ia, `seed ${seed}: Bチーム(${comp.teamB.tier})がAチーム(${comp.teamA.tier})と同格以上です`);
    }
    assert.ok(comp.teamA.clubs.length === 7);
    assert.ok(comp.teamA.schedule.length === 14);
    assert.equal(new Set(comp.teamA.schedule.map((e) => e.week)).size, 14, `seed ${seed}: 日程週が重複`);
    for (const e of comp.teamA.schedule) assert.ok(LEAGUE_WEEKS.includes(e.week));
    assert.ok(comp.history.length <= 20);
    for (const h of comp.history) {
      assert.ok(LEAGUE_TIERS.includes(h.tierA));
      assert.ok(h.rankA === null || (h.rankA >= 1 && h.rankA <= 8));
    }
  }
});

void test('validateCompetition accepts a freshly hydrated and a legacy-migrated state', () => {
  const s = newGame('検証高校', 8);
  hydrateCompetition(s);
  validateCompetition(s);
  // 旧セーブ相当: pending に旧kindを仕込んで再hydrateすると新種別へ移行する
  s.pending = {
    label: '県大会・1回戦',
    kind: 'qualifier',
    round: 0,
    strength: 50,
    opponent: '旧橋学園',
    style: 'balanced',
  };
  hydrateCompetition(s);
  assert.equal((s.pending as unknown as { kind: string }).kind, 'wc_qualifier');

  // match.fixture も同様に移行される（本物の Match を act() 経由で作り、fixture だけ差し替える）
  let s2 = newGame('検証高校2', 9);
  s2.week = 3;
  s2 = act(s2, { type: 'train', training: 'rest' });
  assert.ok(s2.pending);
  s2 = act(s2, { type: 'start' });
  assert.ok(s2.match);
  s2.match!.fixture.kind = 'summer';
  s2.match!.fixture.round = 2;
  hydrateCompetition(s2);
  assert.equal((s2.match!.fixture as unknown as { kind: string }).kind, 'ih_national');
});

void test('districtById throws for unknown ids and resolves known ones', () => {
  assert.throws(() => districtById('atlantis'));
  for (const d of DISTRICTS) assert.equal(districtById(d.id).id, d.id);
});
