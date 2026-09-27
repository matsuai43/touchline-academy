# HANDOFF V4-2 — 今月の育成方針（DESIGN_V4 6章）

作成: 2026-09-27（このセッションの終了直前、利用上限のため簡潔に記載）

## やったこと（実装は完了）

- `lib/training-policy.ts`
  - `PlayerPolicy` に `individual: boolean`・`previousMonthGrowth: Record<string,number>` を追加。
  - `TrainingPolicyState` に `groups: Record<string, PolicyKey>`（キーは `groupKey(pos, year)` = `"DF-1"` 等、GK/DF/MF/FW × 1〜3年の12マス）を追加。
  - `hydrateTrainingPolicy`: 旧セーブ（groups/individual/previousMonthGrowth が無い）を決定的に補完。月が変わる瞬間に `monthlyGrowth` を `previousMonthGrowth` へスナップショットしてからリセット。
  - `validateTrainingPolicy`: 上記フィールドを検証（GK技術はGKグループ以外・GK以外の選手には設定不可など）。
  - `resolveEffectivePolicy(s, p)` / `resolvePolicyView(s, p)`: 「個別設定 ?? 一括設定 ?? おまかせ」を1箇所で解決。`applyIndividualGrowth`（成長適用）と表示側（UI）が必ずこれを通す。
  - アクション追加: `trainingPolicyGroupSet`（一括設定）・`trainingPolicyClearIndividual`（個別解除）。既存の `trainingPolicySet` は個別上書き時に `individual=true` を立てる。既存 `trainingPolicyBulkAuto` は互換のため維持（挙動不変、個別フラグもfalseに戻すよう変更）。
  - 方針名を能力名にそろえた: `speed`→「走力」、`dribble`→「突破」、`physical`→「持久・パワー」（他は元々一致）。
- `app/training-policy-ui.tsx`: 全面書き換え。1画面に以下4区画を実装。
  1. 6.1 ポジション×学年の一括設定グリッド（GroupPolicySelect / PolicyGroupGrid）。
  2. 6.2 方針と能力の対応の説明表（能力名は `lib/game.ts:stats` / `lib/squad.ts:extraStatNames` を直接参照）。
  3. U3 選手ごとの方針（1人1行、ポジション札・名前学年・主な能力2つ・方針セレクト・先月の伸び・個別札・個別解除ボタン、ポジション/学年フィルタ）。「先月の伸び」は `previousMonthGrowth` を使用（ETA/見通し表示は実装していない、指示どおり）。
  4. 6.3 重点育成選手（既存の `focus` アクションを再利用する1つのセレクト）。
  - 行の名前を押すと `onSelectPlayer` 経由で既存の選手詳細ダイアログ（`app/game-ui.tsx` の `selected`/`setSelected`）を開く。
- `app/game-ui.tsx`: ダイアログタイトルを「今月の育成方針」に変更。`TrainingPolicyPanel` に `onSelectPlayer={setSelected}` を渡す。`AbilitySheet` へ渡す `policy` を `resolvePolicyView(s, player)`（解決済みビュー）に変更。
- `app/squad-ui.tsx`: `PolicyBadge` へ渡す policy を同様に `resolvePolicyView(s, p)` に変更（一覧の方針表示が一括設定を正しく反映するように）。
- `app/ability-sheet.tsx`: `growthKeyLabel` を export（U3の「先月の伸び」表示で再利用するため）。
- `app/globals.css`: 末尾に `/* ===== V4-2 今月の育成方針 (DESIGN_V4 6章) ===== */ ... /* ===== /V4-2 ===== */` ブロックを追加（グリッド・説明表・フィルタチップ・行カード・重点育成の全スタイル）。タップ領域44px・文字12px以上・400/700のみ・CSS変数のみで色指定、を満たすように書いた。

## テスト

- `tests/training-policy.test.ts`: 既存10件 + 新規9件（V4-2: グループ解決・個別上書き維持・解除・keep制約・旧セーブ互換・previousMonthGrowthスナップショット・ラベル一致・決定性）で **19/19 pass**（単体で確認済み）。
- `tests/training-policy-ui.spec.ts`: 全面書き換え（旧UIのspecはもう存在しない）。5件、**5/5 pass**（`npx playwright test tests/training-policy-ui.spec.ts` で確認済み）。
- `npx playwright test`（全体）: リビルド後に **73/73 pass** を確認済み（このコミットのコードで、dist/client を `npm run build` で再生成してから実行する必要がある — 4173番ポートの静的サーバは dist/client を配信するだけで再ビルドはしないため、コード変更後は必ず `npm run build` してから `npx playwright test` すること。ビルドは今回何度か実施済みで直近のdistは最新コード反映済み）。
- `npm run typecheck`: 0 errors（確認済み）。
- `npm run lint`: 29件（ベースラインと同数。`app/training-policy-ui.tsx` に新規エラーなし。当初 `role="group"` で2件増えたが削除して解消）。
- `npm test`（全19スイート一括）: **246/246 pass を確認済み**（セッション終了直前にバックグラウンドで実行完了。exit code 0）。これで全検証項目が緑。

## スクリーンショット

`C:\Users\matsu\AppData\Local\Temp\claude\C--Users-matsu-OneDrive-01-codex--\5fae99e7-6bc7-49f6-819a-eecfb3a9145d\scratchpad\v4-shots\` に保存済み（390px、light/dark、top/grid/table）:
- v4-2-policy-light-top.png / v4-2-policy-light-grid.png / v4-2-policy-light-table.png
- v4-2-policy-dark-top.png / v4-2-policy-dark-grid.png / v4-2-policy-dark-table.png
- 横はみ出し実測: light/dark とも `dialogOverflow: 0, bodyOverflow: 0`（scriptで実測済み）。

## 残作業・既知の懸念

すべての検証（npm test 246/246・typecheck 0件・lint 29件=ベースライン通り・playwright 73/73・横はみ出し実測0）が緑であることを確認済み。実装上の残作業はありません。

1. `npm run build` は Windows で毎回 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ...` を出すが `exit=0` で `dist/client/index.html` は正しく再生成される（既知の環境問題、仕様通り）。
2. 共有ファイル（担当外ではないが影響範囲として明記）: `app/game-ui.tsx`（ダイアログタイトル・onSelectPlayer配線・resolvePolicyView化）、`app/squad-ui.tsx`（PolicyBadgeをresolvePolicyView化）、`app/ability-sheet.tsx`（growthKeyLabelをexport）。挙動を変えたのは表示のみで、既存の成長ロジック・セーブ形式（既存フィールド）には影響なし。
3. G4（育成の見通し／あと約n週表示）は指示どおり未実装（ユーザーが不要と判断済み）。
4. 未コミット。コミットは指示があってから。
