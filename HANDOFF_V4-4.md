# V4-4 学校の世界・地域色の校名・所属の表示 — 作業引き継ぎ

作業中に利用上限で中断。以下、現状と残作業。

## 完了したこと

1. **`lib/school-names.ts`（新規、完成）**: 48地区ぶんの地域語彙（`DISTRICT_WORDS`、各12語、旧国名・山・川・海など）、
   語尾（`SCHOOL_SUFFIXES`）、方角語、実在強豪校の除外リスト（`BLOCKED_SCHOOL_NAMES`、`isBlockedSchoolName`）、
   実在Jクラブ下部組織の断片チェック（`isBlockedYouthName`）、都道府県名パターン禁止（`matchesPrefecturePattern`）、
   校名・ユース名生成関数（`regionalSchoolName`/`regionalYouthName`、重複・除外回避の再試行つき）。
   State非依存の純粋モジュール。**未テスト（下記参照）だが実装は完結している。**

2. **`lib/school-world.ts`（新規、完成）**: 学校の世界のコアロジック。`lib/competition.ts`・`lib/game.ts`への実行時依存は
   一切なし（`Tactic`型のみ型import）。
   - `SchoolTier`型（`'pref3'|'pref2'|'pref1'|'regional'|'national'`。pref3は県リーグ外の内部帯）
   - `WorldSchool`型（id・name・districtId・tier・strength・tradition・tactic・isYouth）
   - `buildDistrictWorld(seed, districtId, districtStrength, season)`: 24校を決定的に生成。identity（id/name/tier/tactic/tradition/isYouth）はseason非依存、strengthだけseason依存で±3程度揺れる。
   - `schoolsByTier`, `pickStableSubset`（season非依存キーで選ぶ→階層が変わらない限り毎季同じ学校になる）, `nearestSchool`（カップ戦・練習試合の「名前だけ借りる」用）
   - `DISTRICT_REGIONS`/`districtRegion`/`districtsInRegion`/`districtsInSide`（9地域+EAST/WEST、48地区すべて割当済み、合計48で検算済み）
   - `tierLabel(tier, region?)`: 「県2部」「県1部」「地域・関東」「全国EAST」「県リーグ外」

3. **`lib/competition.ts`（編集済み）**:
   - school-world.ts/school-names.tsをimportし、主要APIを再export（`tierLabel`, `districtRegion`, `districtsInRegion`,
     `districtsInSide`, `isLeagueTier`, `SCHOOL_TIERS`, `SCHOOL_COUNT`, `WorldSchool`, `SchoolTier`, `DistrictRegionInfo`, `RegionSide`）
   - 旧`SCHOOL_STEMS`/`buildSchoolName`/`districtSchoolName`等は全削除
   - `CompState`に`world: SchoolWorldState`を追加（`{schema, homeDistrictId, homeSeason, homeSchools}`）。
     自県の24校のみ保存し、他県はその場で`buildDistrictWorld`から再生成（保存しない）
   - `hydrateWorld(s, comp)`を新設、`hydrateCompetition()`冒頭（`advanceCompetitionSeason`より前）で呼ぶ。
     districtId/season不一致で再生成（フルの決定的再計算、旧セーブにも対応）。`validateCompetition`にも
     `comp.world`の検証を追加。
   - `getDistrictSchools(s, districtId)` / `schoolById(s, id)`: 外部向け公開API
   - `districtSchoolsOf(s, comp, districtId)`: 内部用（`readCompetition`を呼ばない版。hydrate中の再帰呼び出しを避けるため）
   - `tierPool`/`tierPoolWithFallback`: 階層ごとの候補校プール（県2部/県1部＝自県、地域＝同地域、全国＝同EAST/WEST）。
     不足時は隣接階層で補充するフォールバックあり
   - `makeClubs(s, comp, tier, teamTag)`: シグネチャ変更（旧:`seedNum, district, tier, season, teamTag`）。
     世界からpickStableSubsetで7校選ぶ。season非依存キーのため、**階層・県が変わらない限り毎季同じ7校**になる
     （＝「同じ学校との再戦」要件を満たす）。呼び出し箇所2箇所（`advanceCompetitionSeason`内）を更新済み。
   - `LeagueClub`に`schoolId?/districtId?/tier?`を追加、`CupTeam`に`tier?`を追加
   - `createCupBracket`のシグネチャに`comp: CompState`を追加（4呼び出し箇所を更新済み）。名前・所属をworldの
     `nearestSchool`から借りる（strength計算式は変更なし）
   - `cupFixture`・`competitionFixture`のfriendly分岐・league分岐: 名前・所属をworldから。`CompFixture`型に
     `opponentDistrictId?`/`opponentTier?`を追加（既存Fixture型との構造的互換性は保持、`tsc --noEmit`で確認済み）

## 確認できたこと

- `npm run typecheck` は **エラーなしでパス**（自分のファイル分。他エージェントのファイルも含め全体で通った）。
- `npm test` を実行開始したが、完了前にセッションが時間切れになった。**テスト結果は未確認**。次の担当者は
  まず `npm test` を実行し、特に以下を優先確認してほしい:
  - `tests/competition.test.ts`（DISTRICTS・階層・リーグ関連）
  - `tests/balance.test.ts`（`additional: stronger clubs finish a league season higher...` が
    `comp.teamA.clubs`のstrength分布に依存しているため要注意。pref2は必ず7校以上world側で確保できるよう
    `WEAK_ALLOC.pref2=8, STRONG_ALLOC.pref2=7`に設計済みだが未検証）
  - `tests/cup-draw.test.ts`（`createCupBracket`のシグネチャ変更の影響）
  - `tests/extra-time.test.ts`（`simulateCupRegulation`/`simulateCupMatch`は未変更のはずだが確認要）

## 未着手（残作業）

1. **`tests/school-world.test.ts`（新規、未作成）**: 以下を検証するテストを書く必要あり:
   - 決定性（同じseed→同じ世界）
   - 各地区が約24校のユニーク名を生成すること
   - 生成された校名（48地区×複数seed×全階層・ユース含む）が`isBlockedSchoolName`/`isBlockedYouthName`・
     「都道府県名+高校」パターンに一切該当しないこと
   - 強い地区ほど平均strength・上位階層の校数が多いこと
   - リーグ相手（`comp.teamA.clubs`）が世界由来で、階層が変わらなければ季をまたいでも同じ学校であること
   - 世界を持たない旧セーブが読み込み時に世界を得ること（`hydrateCompetition`後に`comp.world.homeSchools.length===24`等）
   - `package.json`の`"test"`スクリプトに`tests/school-world.test.ts`を追記すること（現状のtestスクリプトの
     コマンド文字列に`tests/competition.test.ts`の後あたりに追加するのが自然）

2. **`app/competition-ui.tsx`（未着手）**: 以下を追加する必要あり:
   - 所属の札（chip）: `DrawPendingList`・`CupBracketView`の各チームの横に`tierLabel(team.tier, team.districtId ? districtRegion(team.districtId) : undefined)`を使ったバッジ表示（`CupTeam.tier`は今回追加済みなので利用可能）。全国大会の代表チームは「◯◯代表」ラベル（`districtById(team.districtId).name + '代表'`）+ tier chip
   - リーグセクション（`LeagueStandingsSection`）: 次節の相手表示や行に、クロス地区（regional/national）opponentの出身県バッジ（任意、`club.districtId`が自県と異なる場合のみ）
   - 説明文の追加: 「登場する学校はすべて架空です。」+「県2部→県1部→地域リーグ→全国リーグの4階層があります。地域リーグ＝現実のプリンスリーグに相当、全国リーグ＝プレミアリーグに相当します。」を`CompetitionStatusSection`内に表示
   - コントラスト4.5:1（両テーマ）、色だけに頼らない（文字併記）、タップ44px以上などUI基準を守ること

3. **`app/globals.css`の末尾**: `/* ===== V4-4 学校の世界・所属の札 (DESIGN_V4 2-3章) ===== */` 〜
   `/* ===== /V4-4 ===== */` の間にチップ用CSS（`.school-tier-chip`等）を追加。CRLF維持。**未着手**。

4. **Playwright specの文言チェック**: `tests/*.spec.ts`を`grep`し、旧校名生成（SCHOOL_STEMS由来の「桜台高校」等）や
   旧文言に依存する箇所がないか確認・更新。**未着手（未確認）**。

## 既知のリスク・要確認事項

- `makeClubs`の`tierPoolWithFallback`の最小保証数を「pref2/pref1は自県だけで必ず7以上」という設計にしたが、
  `tierAllocation`のWEAK_ALLOC/STRONG_ALLOC（`lib/school-world.ts`内）の実際の値を要目視確認
  （pref1: weak=7/strong=7、pref2: weak=8/strong=7 になっているはず）。
- `advanceCompetitionSeason`内の`makeClubs`呼び出し2箇所とも`comp`を渡す形に変更済みだが、
  `comp.world`が`hydrateWorld`によって**advanceCompetitionSeason呼び出し前に必ずセットされている**という前提に
  依存している（`hydrateCompetition`内の呼び出し順を変更しないこと）。
- `districtSchoolsOf`（内部, `readCompetition`を呼ばない版）と`getDistrictSchools`（公開, `readCompetition`を呼ぶ版）を
  混同しないこと。`hydrateCompetition`/`advanceCompetitionSeason`の中では必ず前者を使う（後者を使うと
  hydrate中の再帰呼び出しでバグる可能性がある）。

## 【最重要・追記】npm test の結果（実行できた）

`npm test` 全体は完走した（228 tests, pass 222, fail 6）。失敗内訳:
- `tests\development.test.ts`: 1件（"manager care applies once per week..." — おそらく他エージェント
  （lib/game.ts担当）の変更由来。自分のファイルとは無関係の可能性が高い）
- `tests\extra-time.test.ts`: 2件（PK戦関連。同上、lib/game.ts由来の可能性）
- `tests\match-stats.test.ts`: 1件（"match results are stable for fixed seeds" —
  `seed 1001 home: 7 !== 1`。**要注意**: 自分は試合エンジンのRNG消費順序を変えていないはずだが、
  `makeClubs`のシグネチャ変更・世界生成が何らかの形でs.seedの消費に影響していないか要確認。
  ただし school-world.ts/school-names.ts は hf() ハッシュのみで rand(s) を一切使わない設計なので、
  理論上は影響しないはず → 他エージェント（lib/game.ts）由来の可能性の方が高い。
- `tests\competition.test.ts`・`tests\balance.test.ts`・`tests\game.test.ts`: それぞれ **'test failed'**
  というだけで詳細不明（ファイル全体が1つのtestとして失敗扱い）。**単体でこの3ファイルを
  `node --experimental-strip-types --test tests/competition.test.ts` 等で実行すると
  40秒のtimeoutで打ち切られた（ハング/非常に遅い可能性がある）**。
  一方で `readCompetition(newGame(...))` を単発で叩く簡易スモークテストは一瞬で成功
  （`comp.world.homeSchools.length === 24` を確認済み）ため、**単純な無限ループではなく、
  特定のテストケース（多シーズン進行・多seedループなど）で極端に遅い処理が疑われる**。
  疑わしい箇所:
  - `tierPool`/`tierPoolWithFallback`が地域(`districtsInRegion`)・EAST/WEST(`districtsInSide`)全県分の
    `buildDistrictWorld`（24校生成）を**呼び出しのたびに**再計算している。region/nationalの度に
    毎回9地域分・最大24件×24校のフル生成が走るため、`computeLeagueTable`のように高頻度で
    呼ばれる経路（他校同士の試合を毎回再現するループ）でregional/national階層のチームが
    絡むと**O(呼び出し回数 × 対象県数 × 24校)の計算量爆発**になっている可能性が高い。
    → 対策案: `tierPool`の結果を`comp`単位や引数でメモ化する、または`makeClubs`を呼ぶ箇所
    （季の変わり目、1回だけ）以外ではregional/national poolを毎回作り直さない設計に直す。
    `computeLeagueTable`は`makeClubs`を呼ばないので直接の原因ではないはずだが、
    balance.test.ts/competition.test.ts内の「複数seed×複数季を回す」ループが
    `advanceCompetitionSeason`→`makeClubs`→`tierPool`を何十回〜何百回も叩くと遅くなる。
  - 次の担当者はまず `tierPool`/`tierPoolWithFallback` の呼び出し頻度とコストを見直すこと
    （最優先の修正対象）。

## 次にやること（優先順・上の追記を踏まえて更新）

0. **最優先**: `tierPool`のパフォーマンス問題を調査・修正する（region/sideの全県`buildDistrictWorld`を
   毎回再計算しない。例えば1季につき1回だけ計算してキャッシュする、または`pickStableSubset`に
   渡す前にプールサイズを絞る等）。修正後に`tests/competition.test.ts`・`tests/balance.test.ts`・
   `tests/game.test.ts`を単体で実行し、時間内に完走することを確認する。


1. `npm test` を実行し、失敗があれば原因を特定・修正（最優先）。
2. `tests/school-world.test.ts` を新規作成し、`package.json`の`test`スクリプトに登録。
3. `app/competition-ui.tsx`にチップ・説明文を追加。
4. `app/globals.css`末尾にCSSブロックを追加。
5. `npm run lint`を実行しベースラインを超えていないか確認。
6. Playwrightスペックの文言影響を`grep`で確認。
