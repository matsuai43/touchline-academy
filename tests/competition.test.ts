import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, validateSave, type State, type Training } from '../lib/game.ts';
import { getCurrentLifeEvent } from '../lib/school-life.ts';
import {
  DISTRICTS,
  districtById,
  hydrateCompetition,
  validateCompetition,
  readCompetition,
  competitionFixture,
  advanceCupWeek,
  drawPendingCup,
  IH_QUALIFIER_DRAW_WEEK,
  IH_NATIONAL_DRAW_WEEK,
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
  computeLeagueTable,
  leagueRemaining,
  leagueNextFixture,
  promotionZoneActive,
  relegationZoneActive,
  type CompState,
  type LeagueTier,
} from '../lib/competition.ts';

void test('T-2: rival cup results advance the bracket and stronger schools survive more often', () => {
  let entrantTotal = 0;
  let semifinalTotal = 0;
  let upperSeedChampions = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const s = newGame('大会検証高校', seed * 37);
    const cup = readCompetition(s).ih;
    // T-12: 組み合わせは抽選まで確定しない。この検証は抽選後の対戦表の性質を
    // 見るためのものなので、先に決定的に抽選だけ済ませておく（週送りは不要）。
    s.week = IH_QUALIFIER_DRAW_WEEK;
    drawPendingCup(s);
    const bracket = cup.qualifier!;
    // The player's first-round loss is recorded by the real match engine in play.
    // Here it is supplied directly to isolate the rival-vs-rival tournament curve.
    // T-12: 抽選で自校がどの枠に入るかは季ごとに変わるため、自校の実際の対戦を探す。
    const selfIdx = bracket.rounds[0].findIndex((m) => m.homeId === 'self' || m.awayId === 'self');
    const selfMatch = bracket.rounds[0][selfIdx];
    selfMatch.home = 0;
    selfMatch.away = 1;
    selfMatch.winnerId = selfMatch.homeId === 'self' ? selfMatch.awayId : selfMatch.homeId;
    cup.alive = false;
    for (const week of IH_QUALIFIER_WEEKS) advanceCupWeek(s, week);
    assert.equal(bracket.completedRounds, 4);
    const strength = (id: string | null) => bracket.teams.find((team) => team.id === id)!.strength;
    const entrants = bracket.teams.filter((team) => team.id !== 'self').map((team) => team.strength);
    entrantTotal += entrants.reduce((sum, value) => sum + value, 0) / entrants.length;
    const semifinalists = bracket.rounds[2].flatMap((match) => [match.homeId, match.awayId]);
    semifinalTotal += semifinalists.reduce((sum, id) => sum + strength(id), 0) / semifinalists.length;
    const championStrength = strength(bracket.rounds[3][0].winnerId);
    const topQuartile = [...entrants].sort((a, b) => b - a)[3];
    if (championStrength >= topQuartile) upperSeedChampions++;
    const national = cup.national!;
    // T-12: 全国大会の組み合わせも抽選まで確定しない。同様に先に抽選だけ済ませる
    // （自校は県予選で敗退させているため、この抽選には出場しない＝黙って済む）。
    s.week = IH_NATIONAL_DRAW_WEEK;
    drawPendingCup(s);
    for (const week of IH_NATIONAL_WEEKS) advanceCupWeek(s, week);
    assert.equal(national.completedRounds, 6, 'national tournament continues even after the school loses');
  }
  assert.ok(semifinalTotal / 50 > entrantTotal / 50 + 2);
  assert.ok(upperSeedChampions >= 20, `strong seeds won only ${upperSeedChampions}/50 cups`);
});

void test('T-2: the next opponent is the school that won the adjacent bracket match', () => {
  let found = false;
  for (let seed = 1; seed <= 10 && !found; seed++) {
    let s = newGame('勝ち上がり検証高校', seed);
    for (const player of s.players) for (const key of Object.keys(player.stats) as (keyof typeof player.stats)[]) player.stats[key] = 95;
    while (s.week < IH_QUALIFIER_WEEKS[1]) s = step(s, 'rest');
    const cup = readCompetition(s).ih;
    if (!cup.alive) continue;
    const bracket = cup.qualifier!;
    // T-12: 抽選で自校がどの枠に入るかは季ごとに変わるため、自校の対戦の「隣」
    // （準々決勝で当たる、同じ組の別の1回戦）を実際の位置から求める。
    const selfIdx = bracket.rounds[0].findIndex((m) => m.homeId === 'self' || m.awayId === 'self');
    const otherMatch = bracket.rounds[0][selfIdx ^ 1];
    const winner = bracket.teams.find((team) => team.id === otherMatch.winnerId)!;
    const fixture = competitionFixture(s, IH_QUALIFIER_WEEKS[1])!;
    assert.equal(fixture.opponent, winner.name);
    assert.equal(fixture.strength, winner.strength);
    found = true;
  }
  assert.ok(found, 'at least one boosted team should win the first qualifier match');
});

void test('T-2: old saves without a bracket keep their current season fixture and get a bracket next spring', () => {
  let s = newGame('旧セーブ大会検証高校', 52);
  while (s.week < IH_QUALIFIER_WEEKS[0]) s = step(s, 'rest');
  while (!s.pending) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    s = resolveLife(s);
    if (!s.pending) s = act(s, { type: 'train', training: 'rest' });
  }
  const fixture = s.pending;
  const raw = JSON.parse(JSON.stringify(s));
  delete raw.v3.competition.ih.representatives;
  delete raw.v3.competition.wc.representatives;
  delete raw.v3.competition.ih.qualifier;
  delete raw.v3.competition.ih.national;
  delete raw.v3.competition.wc.qualifier;
  delete raw.v3.competition.wc.national;
  s = validateSave(raw);
  assert.deepEqual(s.pending, fixture, 'an already scheduled match stays intact');
  s = act(s, { type: 'start' });
  while (!s.match!.done) s = act(s, { type: 'segment' });
  s = act(s, { type: 'finish' });
  while (s.season === 1) s = step(s, 'rest');
  assert.ok(readCompetition(s).ih.qualifier);
  assert.equal(readCompetition(s).wc.national, undefined);
  assert.equal(readCompetition(s).wc.representatives!.districts.length, 48);
});

// ---------------------------------------------------------------------------
// テスト用ヘルパー（本体は触らず、公開APIだけで週を進める。squad.test.ts と同じ流儀）
// ---------------------------------------------------------------------------
function resolveLife(s: State): State {
  const cur = getCurrentLifeEvent(s);
  if (!cur) return s;
  return act(s, { type: 'life', choiceId: cur.event.choices[0].id });
}
// S1: 日次コマンド化により「1回のtrain操作=1週」の前提が崩れたため、
// 「1週間進める」ヘルパーに置き換える（月〜土の6日を同じ練習メニューで進める）。
function step(s: State, t: Training = 'balance'): State {
  const week0 = s.week;
  while (s.week === week0) {
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    s = resolveLife(s);
    if (!s.pending) s = act(s, { type: 'train', training: t });
    if (s.pending) {
      s = act(s, { type: 'start' });
      while (!s.match!.done) s = act(s, { type: 'segment' });
      s = act(s, { type: 'finish' });
    }
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

// 重要: lib/game.ts の 'finish' ハンドラは既に resolveCompetitionMatch(s, m) を呼ぶよう
// 配線済み（本ファイル自体の末尾コメントが指示していた配線）。そのため step() が実際に
// act('start'/'segment'/'finish') で試合を消化すると、そのたびに comp.teamA/ih/wc は
// 本物の試合結果で自動的に更新される。以前はこの配線が無かったため、テスト側で
// competitionFixture() の結果を仮に決着させて手動で resolveCompetitionMatch() を呼ぶ
// 「裏シミュレーション」が必要だったが、今それをすると同じ週が二重に解決されてしまう
// （team.played が週ごとに2つずつ増える等）。そのため実際の解決は必ず step() 経由の
// 本物の試合エンジンに任せる（resolveCompetitionMatch を手動で呼ばない）。
/** 本物の act()（週送り・卒業・新入生・評判の変化・試合の消化）だけで時計を進める。
 *  'finish' ハンドラが resolveCompetitionMatch を呼ぶので、これだけで comp.teamA/ih/wc が
 *  実際の試合結果で正しく更新される。1season = 48週。 */
function playSeasons(s: State, seasons: number): State {
  for (let n = 0; n < seasons; n++) {
    for (let i = 0; i < 48; i++) s = step(s);
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
void test('legacy saves: difficulty rises from prefecture qualifier toward the national final', () => {
  const s = newGame('難易度検証高校', 21);
  hydrateCompetition(s);
  setDistrictNow(s, 'yamagata'); // 下位帯（係数ほぼ1.00）で基準を見る
  const comp = readCompetition(s);
  delete comp.ih.representatives;
  delete comp.ih.qualifier;
  const qualR0 = competitionFixture(s, IH_QUALIFIER_WEEKS[0])!;
  assert.equal(qualR0.kind, 'ih_qualifier');
  assert.ok(qualR0.strength >= 40 && qualR0.strength <= 65, `県予選の強さが目安から外れています: ${qualR0.strength}`);
  comp.ih.qualified = true; // 全国フィクスチャを取得するため直接フラグを立てる
  const natFinal = competitionFixture(s, IH_NATIONAL_WEEKS[4])!;
  assert.equal(natFinal.kind, 'ih_national');
  assert.ok(natFinal.strength > qualR0.strength, '全国決勝は県予選より手強いはず');
  assert.ok(natFinal.strength >= 85, `全国決勝の強さが低すぎます: ${natFinal.strength}`);
});

void test('legacy saves: a contested district scales cup difficulty up compared to a thin district', () => {
  const weak = newGame('薄い地区高校', 21);
  setDistrictNow(weak, 'yamagata');
  const strong = newGame('激戦地区高校', 21);
  setDistrictNow(strong, 'shizuoka');
  delete readCompetition(weak).wc.representatives;
  delete readCompetition(strong).wc.representatives;
  delete readCompetition(weak).ih.qualifier;
  delete readCompetition(strong).ih.qualifier;
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
        // competitionFixture() は純粋な読み取りなので、ログを取るだけなら解決前に呼んでも
        // 安全（step() が act() 経由で本物の試合エンジンにより実際に解決する）。
        const f = competitionFixture(s, s.week);
        if (f) log.push(`${s.season}-${s.week}-${f.kind}-${f.round}-${f.opponent}-${f.strength}-${f.style}`);
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
  // 初期20人は全員がAチーム（試合登録20人）に入るため、まず部員数を増やす（自然な入部・卒業サイクルを
  // 数シーズン回し、既存の入部システムだけで B が11人以上になるまで育てる）。
  // T-5: lowering the scoring rate to raise the draw rate reshuffled the RNG sequence,
  // so seed 900 no longer grows the roster past 11 within 8 seasons; seed 1 does.
  let s = newGame('AB階層検証高校', 1);
  for (let n = 0; n < 8; n++) for (let i = 0; i < 48; i++) s = step(s);
  s.reputation = 80; // Bチーム参戦条件を満たす
  const bRoster = () => s.players.filter((p) => s.v3.squad.players[p.id]?.team === 'B').length;
  assert.ok(bRoster() >= 11, `Bチームに十分な部員がいません（${bRoster()}人、部員合計${s.players.length}人）`);
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
  let guard = 0;
  while (!s2.pending && guard++ < 20) {
    if (s2.event) s2 = act(s2, { type: 'event', choice: 'team' });
    s2 = resolveLife(s2);
    s2 = act(s2, { type: 'train', training: 'rest' });
  }
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

// ---------------------------------------------------------------------------
// T4.1: 他校同士の試合も毎節実際に消化する順位表
// ---------------------------------------------------------------------------
/** 自校のリーグ14試合が終わるまで進める（season をまたがない範囲で止める）。本物の
 *  act() だけで進める（'finish' ハンドラが resolveCompetitionMatch を呼ぶので、それだけで
 *  comp.teamA が実際の試合結果で正しく更新される）。 */
function playUntilLeagueComplete(s: State): State {
  for (let i = 0; i < 48; i++) {
    s = step(s);
    if (readCompetition(s).teamA.played >= LEAGUE_WEEKS.length) break;
  }
  return s;
}

void test('every league week fields all 8 schools in exactly 4 matches (no byes, no double-booking)', () => {
  let s = newGame('全校消化検証高校', 55);
  hydrateCompetition(s);
  s = playUntilLeagueComplete(s);
  const comp = readCompetition(s);
  assert.equal(comp.teamA.played, LEAGUE_WEEKS.length, '自校は14節すべて消化しているはず');
  const { resultsByTeam } = computeLeagueTable(s, comp);
  const teamIds = ['self', ...comp.teamA.clubs.map((c) => c.id)];
  assert.equal(teamIds.length, 8, '自校＋7クラブで8校のはず');
  for (const week of LEAGUE_WEEKS) {
    let appearances = 0;
    for (const id of teamIds) appearances += resultsByTeam[id].filter((r) => r.week === week).length;
    assert.equal(appearances, 8, `週${week}: 8校それぞれちょうど1試合ずつのはず（実際は${appearances}件）`);
  }
  // 総試合数: 8校総当たり（ホーム&アウェー）= 8*7 = 56 試合、resultsByTeam は各試合を両校ぶん記録するので合計112件。
  const totalEntries = teamIds.reduce((a, id) => a + resultsByTeam[id].length, 0);
  assert.equal(totalEntries, 56 * 2, '延べ試合出場数が8校総当たり56試合の2倍と一致しません');
});

void test('after 14 weeks every school (self and all 7 clubs) has played exactly 14 games', () => {
  let s = newGame('14試合検証高校', 77);
  hydrateCompetition(s);
  s = playUntilLeagueComplete(s);
  const comp = readCompetition(s);
  const { rows } = computeLeagueTable(s, comp);
  assert.equal(rows.length, 8);
  for (const row of rows) assert.equal(row.played, 14, `${row.name} の試合数が14ではありません（${row.played}）`);
});

void test('points and win/draw/lose stay consistent (3/1/0) for every school in the table', () => {
  let s = newGame('勝ち点整合検証高校', 91);
  hydrateCompetition(s);
  s = playUntilLeagueComplete(s);
  const comp = readCompetition(s);
  const { rows } = computeLeagueTable(s, comp);
  for (const row of rows) {
    assert.equal(row.win + row.draw + row.lose, row.played, `${row.name}: 勝分負の合計が試合数と不一致`);
    assert.equal(row.win * 3 + row.draw * 1, row.points, `${row.name}: 勝ち点が3勝1分の計算と不一致`);
    assert.equal(row.gd, row.gf - row.ga, `${row.name}: 得失点差の計算が不一致`);
  }
});

void test('standings are sorted by points, then goal difference, then goals for, then team id', () => {
  let s = newGame('並び順検証高校', 123);
  hydrateCompetition(s);
  s = playUntilLeagueComplete(s);
  const comp = readCompetition(s);
  const { rows } = computeLeagueTable(s, comp);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i],
      b = rows[i + 1];
    // lib/competition.ts の並べ替え規則（勝ち点→得失点差→総得点→学校ID）をそのまま再現し、
    // a が b より前（同順含む）であることを確認する。
    const cmp = b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.teamId.localeCompare(b.teamId);
    assert.ok(cmp <= 0, `順位${i + 1}(${a.name})と${i + 2}(${b.name})の並びがタイブレーク規則に反しています`);
  }
});

void test('leagueRemaining and leagueNextFixture track the schedule as weeks pass', () => {
  let s = newGame('残り試合数検証高校', 5);
  hydrateCompetition(s);
  let comp = readCompetition(s);
  assert.equal(leagueRemaining(comp), LEAGUE_WEEKS.length);
  const first = leagueNextFixture(comp);
  assert.ok(first);
  assert.ok(comp.teamA.clubs.some((c) => c.name === first!.opponent));
  s = playUntilLeagueComplete(s);
  comp = readCompetition(s);
  assert.equal(leagueRemaining(comp), 0);
  assert.equal(leagueNextFixture(comp), null, '14節すべて消化した後は次節が無いはず');
});

void test('promotion/relegation zone helpers respect the top and bottom tiers', () => {
  assert.equal(promotionZoneActive('national'), false, '全国リーグより上は無いので昇格圏は無いはず');
  assert.equal(promotionZoneActive('pref1'), true);
  assert.equal(relegationZoneActive('pref2'), false, '県2部より下は無いので降格圏は無いはず');
  assert.equal(relegationZoneActive('regional'), true);
});

void test('promotion/relegation at season end matches the rank computed from the final standings table', () => {
  let s = newGame('昇降格整合検証高校', 314);
  hydrateCompetition(s);
  s = playUntilLeagueComplete(s);
  const comp = readCompetition(s);
  const { rows } = computeLeagueTable(s, comp);
  const expectedRank = rows.findIndex((r) => r.isSelf) + 1;
  const tierBefore = comp.teamA.tier;
  // 残りの週（リーグ以外）を消化してシーズンを終わらせる。
  for (let i = 0; i < 48; i++) s = step(s);
  const history = readCompetition(s).history[0];
  assert.ok(history, 'シーズン終了時の履歴が記録されていません');
  assert.equal(history.rankA, expectedRank, '昇降格判定の順位が最終順位表と一致しません');
  if (expectedRank <= 2 && LEAGUE_TIERS.indexOf(tierBefore) < LEAGUE_TIERS.length - 1) {
    assert.ok(
      LEAGUE_TIERS.indexOf(readCompetition(s).teamA.tier) > LEAGUE_TIERS.indexOf(tierBefore) ||
        LEAGUE_TIERS.indexOf(tierBefore) === LEAGUE_TIERS.length - 1,
      '上位2位なら昇格しているはず',
    );
  }
  if (expectedRank >= 7 && LEAGUE_TIERS.indexOf(tierBefore) > 0) {
    assert.ok(
      LEAGUE_TIERS.indexOf(readCompetition(s).teamA.tier) < LEAGUE_TIERS.indexOf(tierBefore) ||
        LEAGUE_TIERS.indexOf(tierBefore) === 0,
      '下位2位なら降格しているはず',
    );
  }
});

void test('same seed reproduces an identical league standings table (determinism)', () => {
  function run() {
    let s = newGame('順位表決定性検証高校', 6060);
    hydrateCompetition(s);
    s = playUntilLeagueComplete(s);
    const comp = readCompetition(s);
    return JSON.parse(JSON.stringify(computeLeagueTable(s, comp)));
  }
  assert.deepEqual(run(), run(), '同じシードで順位表が一致しません');
});

void test('legacy saves without a results log fall back to zero self-history but still reconstruct rival-vs-rival matches', () => {
  let s = newGame('旧セーブ順位表検証高校', 202);
  hydrateCompetition(s);
  s = playUntilLeagueComplete(s);
  const comp = readCompetition(s);
  assert.ok(comp.teamA.results.length > 0, '前提: 通常プレイではログが残っているはず');
  // 旧セーブ相当: results フィールドが無い状態を再現する。
  delete (comp.teamA as unknown as { results?: unknown }).results;
  hydrateCompetition(s); // 補完されるはず
  assert.deepEqual(readCompetition(s).teamA.results, [], '旧セーブは results が空配列に補完されるはず');
  validateCompetition(s);
  const { rows } = computeLeagueTable(s, comp);
  const self = rows.find((r) => r.isSelf)!;
  // 自校の対戦ログは失われても、team.played などの集計値は温存されているので「自校の結果は記録が
  // あればそれを使い、無ければ0から」の対象は自校の内訳（resultsByTeam）だけで、順位表の自校の
  // played/points 自体は既存の集計値をそのまま使う。
  assert.equal(self.played, comp.teamA.played);
  assert.equal(self.points, comp.teamA.points);
  // 他校同士の試合は常に決定的に再現できるので、クラブ側の played は 0 にならないはず。
  const anyClub = rows.find((r) => !r.isSelf)!;
  assert.ok(anyClub.played > 0, '他校同士の試合はログが無くても再現されるはず');
});

// ---------------------------------------------------------------------------
// T4.3: Bチームも同じ総当たりの実順位表にそろえる
// ---------------------------------------------------------------------------
/** Bチームが参戦できるだけの部員数（B所属11人以上）に育て、評判もしきい値以上にし、
 *  Aチームを最下層以外にセットしたうえで即座に今季のクラブ・日程（Bを含む）を作り直す。
 *  自然な入部・卒業サイクルを数シーズン回して部員を増やすのは、既存の
 *  「team B, when it exists, is always exactly one tier below team A...」テストと同じ流儀。 */
function growBRoster(name: string, seed: number): State {
  let s = newGame(name, seed);
  for (let n = 0; n < 8; n++) for (let i = 0; i < 48; i++) s = step(s);
  s.reputation = 80;
  hydrateCompetition(s);
  const comp = readCompetition(s);
  comp.teamA.tier = 'regional';
  comp.seasonGenerated = 0;
  hydrateCompetition(s);
  return s;
}

void test('every league week fields all 8 schools of team B in exactly 4 matches (no byes, no double-booking)', () => {
  // T-5: the new lower scoring rate reshuffles the RNG sequence a season consumes;
  // seed 61 no longer grows the B roster past 11 within 8 seasons, so use seed 65.
  const s = growBRoster('B全校消化検証高校', 65);
  const comp = readCompetition(s);
  assert.ok(comp.teamB, '前提: Bチームが参戦しているはず');
  assert.equal(comp.teamB!.played, LEAGUE_WEEKS.length, 'Bは自動進行で全14節が即座に消化されているはず');
  const { resultsByTeam } = computeLeagueTable(s, comp, s.season, 'B');
  const teamIds = ['self', ...comp.teamB!.clubs.map((c) => c.id)];
  assert.equal(teamIds.length, 8, '自校＋7クラブで8校のはず');
  for (const week of LEAGUE_WEEKS) {
    let appearances = 0;
    for (const id of teamIds) appearances += resultsByTeam[id].filter((r) => r.week === week).length;
    assert.equal(appearances, 8, `Bの週${week}: 8校それぞれちょうど1試合ずつのはず（実際は${appearances}件）`);
  }
  const totalEntries = teamIds.reduce((a, id) => a + resultsByTeam[id].length, 0);
  assert.equal(totalEntries, 56 * 2, 'Bの延べ試合出場数が8校総当たり56試合の2倍と一致しません');
});

void test('after team B\'s season, every school (self and all 7 clubs) has played exactly 14 games with consistent points', () => {
  const s = growBRoster('B14試合検証高校', 62);
  const comp = readCompetition(s);
  const { rows } = computeLeagueTable(s, comp, s.season, 'B');
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.played, 14, `${row.name} のB戦績試合数が14ではありません（${row.played}）`);
    assert.equal(row.win + row.draw + row.lose, row.played, `${row.name}: B戦績の勝分負の合計が試合数と不一致`);
    assert.equal(row.win * 3 + row.draw * 1, row.points, `${row.name}: B戦績の勝ち点が3勝1分の計算と不一致`);
    assert.equal(row.gd, row.gf - row.ga, `${row.name}: B戦績の得失点差の計算が不一致`);
  }
});

void test('team B\'s league table is deterministic and independent of team A\'s schedule seed', () => {
  function run() {
    const s = growBRoster('B決定性検証高校', 63);
    const comp = readCompetition(s);
    return {
      tableB: JSON.parse(JSON.stringify(computeLeagueTable(s, comp, s.season, 'B'))),
      scheduleSeedA: comp.teamA.scheduleSeed,
      scheduleSeedB: comp.teamB!.scheduleSeed,
    };
  }
  const a = run();
  const b = run();
  assert.deepEqual(a.tableB, b.tableB, '同じシードでBの順位表が一致しません');
  assert.notEqual(
    a.scheduleSeedA,
    a.scheduleSeedB,
    'AとBの日程の乱数系列は独立している（scheduleSeedが一致しない）はず',
  );
});

void test('team A\'s league table computation never reads team B\'s data (removing team B leaves A\'s table unchanged)', () => {
  let s = growBRoster('A非依存検証高校', 4400);
  const comp = readCompetition(s);
  assert.ok(comp.teamB, '前提: Bチームが存在する状態で比較する');
  const withB = JSON.parse(JSON.stringify(computeLeagueTable(s, comp, s.season, 'A')));
  const savedTeamB = comp.teamB;
  comp.teamB = null; // Aの計算がteamBを参照しているなら、ここで結果が変わってしまうはず
  const withoutB = JSON.parse(JSON.stringify(computeLeagueTable(s, comp, s.season, 'A')));
  comp.teamB = savedTeamB;
  assert.deepEqual(withoutB, withB, 'Aの順位表計算はteamBのデータを一切参照していないはず');

  // 季をまたぐ生成も同様: Bのクラブ生成・自動進行は s.seed を消費しない決定的なハッシュのみ
  // なので、実際に1シーズンプレイしてもAのscheduleSeed（＝季の切り替え時点のs.seed）は
  // Bの有無に影響されず、単に季ごとに新しい値へ更新されるだけである。
  const scheduleSeedABefore = comp.teamA.scheduleSeed;
  const seedBefore = s.seed;
  for (let i = 0; i < 48; i++) s = step(s);
  assert.notEqual(s.seed, seedBefore, '前提: 1シーズンプレイするとs.seedは進んでいるはず');
  const afterComp = readCompetition(s);
  assert.notEqual(
    afterComp.teamA.scheduleSeed,
    scheduleSeedABefore,
    '季をまたいでAのscheduleSeedは新しい値に更新されているはず',
  );
});

void test('team B never shares or exceeds team A\'s tier, and a guaranteed win is blocked from tying team A while a guaranteed loss always relegates', () => {
  for (const seed of [71, 802]) {
    const s = growBRoster('B昇降格検証高校', seed);
    const comp = readCompetition(s);
    assert.ok(comp.teamB);
    assert.equal(comp.teamB!.tier, 'pref1', 'tierBelow(regional) = pref1 から始まるはず');

    // ケース1: Bを圧勝させる（そのシーズンの最高勝ち点=42）。Aは中位相当の成績を明示的に
    // 与えておく（growBRoster直後は played=0 で全校が0-0-0の見かけ上のタイになり、順位が
    // teamIdの文字列比較というテストの意図しない要因で決まってしまうため）。
    comp.teamA.played = 14;
    comp.teamA.win = 4;
    comp.teamA.draw = 4;
    comp.teamA.lose = 6;
    comp.teamA.points = 16;
    comp.teamA.gf = 16;
    comp.teamA.ga = 18;
    comp.teamB!.played = 14;
    comp.teamB!.win = 14;
    comp.teamB!.draw = 0;
    comp.teamB!.lose = 0;
    comp.teamB!.points = 42;
    comp.teamB!.gf = 90;
    comp.teamB!.ga = 0;
    const { rows: rowsA } = computeLeagueTable(s, comp, s.season, 'A');
    const rankA = rowsA.findIndex((r) => r.isSelf) + 1;
    const tierAIdxBefore = LEAGUE_TIERS.indexOf(comp.teamA.tier);

    s.season += 1;
    hydrateCompetition(s);
    const after = readCompetition(s);
    assert.ok(after.teamB, 'Bは参戦を続けているはず');
    const tierAIdxAfter = LEAGUE_TIERS.indexOf(after.teamA.tier);
    const tierBIdxAfter = LEAGUE_TIERS.indexOf(after.teamB!.tier);
    // 制約: 常にBはAより下（同格・上位は不可）。
    assert.ok(tierBIdxAfter < tierAIdxAfter, `seed ${seed}: Bチーム(${after.teamB!.tier})がAチーム(${after.teamA.tier})と同格以上です`);
    if (tierAIdxAfter === tierAIdxBefore) {
      // Aが動かなかった場合: Bが1位でも、Aと同格になる昇格はブロックされ、1つ下のまま留まるはず。
      assert.equal(rankA >= 3 && rankA <= 6, true, `テストの前提（Aが中位で現状維持）が崩れています: rankA=${rankA}`);
      assert.equal(tierBIdxAfter, tierAIdxAfter - 1, 'Aが現状維持ならBはちょうど1つ下に留まるはず');
    }
    validateCompetition(s);

    // ケース2: 続けてBを大敗させる（勝ち点0）。降格はAの階層と衝突しない方向なので、
    // 常に1つ降格するはず。
    const comp2 = readCompetition(s);
    if (comp2.teamB) {
      const tierBIdxBefore2 = LEAGUE_TIERS.indexOf(comp2.teamB.tier);
      comp2.teamB.played = 14;
      comp2.teamB.win = 0;
      comp2.teamB.draw = 0;
      comp2.teamB.lose = 14;
      comp2.teamB.points = 0;
      comp2.teamB.gf = 0;
      comp2.teamB.ga = 90;
      s.season += 1;
      hydrateCompetition(s);
      const after2 = readCompetition(s);
      if (after2.teamB && tierBIdxBefore2 > 0) {
        assert.equal(
          LEAGUE_TIERS.indexOf(after2.teamB.tier),
          tierBIdxBefore2 - 1,
          'Bが最下位なら降格するはず（Aとの衝突が起きない方向なので必ず1つ下がる）',
        );
      }
      validateCompetition(s);
    }
  }
});

void test('legacy team B saves without a results log fall back to zero self-history but still reconstruct rival-vs-rival matches', () => {
  const s = growBRoster('旧セーブB順位表検証高校', 909);
  const comp = readCompetition(s);
  assert.ok(comp.teamB && comp.teamB.results.length > 0, '前提: 通常はBの結果ログが残っているはず');
  delete (comp.teamB as unknown as { results?: unknown }).results;
  hydrateCompetition(s);
  assert.deepEqual(readCompetition(s).teamB!.results, [], '旧セーブは results が空配列に補完されるはず');
  validateCompetition(s);
  const { rows } = computeLeagueTable(s, comp, s.season, 'B');
  const self = rows.find((r) => r.isSelf)!;
  assert.equal(self.played, comp.teamB!.played);
  assert.equal(self.points, comp.teamB!.points);
  const anyClub = rows.find((r) => !r.isSelf)!;
  assert.ok(anyClub.played > 0, 'Bの他校同士の試合もログが無くても再現されるはず');
});
