import { test, expect, type Page } from '@playwright/test';
import { newGame, act, type State } from '../lib/game';

// W4: 試合UIの刷新（交代の2ステップ化）と試合後サマリの検証。
// UI操作を高速化するため、練習週やランダムなライフイベントに依存せず、
// lib/game.ts の act() を直接呼んで「試合開始直後」「試合終了直後」の State を作り、
// localStorage にあらかじめ書き込んでからページを開く（development.spec.ts と同じ手法）。

function startedMatch(school: string, seed: number): State {
  let s = newGame(school, seed);
  s.week = 3;
  s = act(s, { type: 'train', training: 'rest' });
  s = act(s, { type: 'start' });
  return s;
}
function finishedMatch(school: string, seed: number): State {
  let s = startedMatch(school, seed);
  for (let i = 0; i < 6; i++) s = act(s, { type: 'segment' });
  return s;
}
async function withSave(page: Page, s: State) {
  await page.addInitScript(
    (value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
}

test('substitution dialog: pick outgoing then incoming, cancel resets, confirm applies and updates the cap', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('交代検証高校', 4242));
  await page.goto('/');
  await expect(page.getByText('交代 0 / 3')).toBeVisible();

  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  const overlay = page.locator('[data-slot="dialog-overlay"]');
  await expect(overlay).toHaveCount(1);

  const columns = page.locator('.sub-column');
  const pitchPick = columns.nth(0).locator('.sub-pick').first();
  const benchPick = columns.nth(1).locator('.sub-pick:not([disabled])').first();

  // 確定ボタンは、下げる選手・入れる選手の両方を選ぶまでは表示/有効化されない。
  await expect(page.getByRole('button', { name: 'この交代を確定' })).toHaveCount(0);
  await pitchPick.click();
  await expect(pitchPick).toHaveClass(/selected/);
  await benchPick.click();
  await expect(benchPick).toHaveClass(/selected/);
  const confirmBtn = page.getByRole('button', { name: 'この交代を確定' });
  await expect(confirmBtn).toBeEnabled();

  // 「選び直す」で確定前ならいつでも取り消せる。
  await page.getByRole('button', { name: '選び直す' }).click();
  await expect(page.getByRole('button', { name: 'この交代を確定' })).toHaveCount(0);
  await expect(pitchPick).not.toHaveClass(/selected/);

  // 選び直して今度は確定する。
  await pitchPick.click();
  await benchPick.click();
  const incomingName = await benchPick.locator('.sub-pick-name').innerText();
  await page.getByRole('button', { name: 'この交代を確定' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByText('交代 1 / 3')).toBeVisible();
  // 交代した選手が、今度はピッチ側の一覧に現れる。
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  await expect(columns.nth(0).getByText(incomingName, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('substitution cap: bench entries disable once used, and the trigger disables at 3 subs', async ({
  page,
}) => {
  await withSave(page, startedMatch('交代上限検証高校', 777));
  await page.goto('/');
  const overlay = page.locator('[data-slot="dialog-overlay"]');
  for (let n = 0; n < 3; n++) {
    await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
    const columns = page.locator('.sub-column');
    await columns.nth(0).locator('.sub-pick').first().click();
    await columns.nth(1).locator('.sub-pick:not([disabled])').first().click();
    await page.getByRole('button', { name: 'この交代を確定' }).click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByText(`交代 ${n + 1} / 3`)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '交代する選手を選ぶ' })).toBeDisabled();
});

test('post-match summary: shows MOTM, timeline, stat comparison and per-player growth, then returns to the clubhouse', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, finishedMatch('サマリ検証高校', 99001));
  await page.goto('/');
  await expect(page.getByText('MATCH SUMMARY', { exact: true })).toBeVisible();
  // スタッツ比較（シュート・得点期待値・保持率）はスコアボードに常時表示。
  const matchStats = page.locator('.match-stats');
  await expect(matchStats.getByText('シュート', { exact: false })).toBeVisible();
  await expect(matchStats.getByText('得点期待値', { exact: false })).toBeVisible();
  await expect(matchStats.getByText('ボール保持', { exact: false })).toBeVisible();
  // MOTM: 1人が選ばれ、選出理由が一文添えられる。
  await expect(page.locator('.motm-card')).toBeVisible();
  await expect(page.locator('.motm-card b').first()).not.toBeEmpty();
  await expect(page.locator('.motm-card p').first()).not.toBeEmpty();
  // タイムライン。
  await expect(page.getByRole('heading', { name: 'タイムライン' })).toBeVisible();
  // 成長差分：全員が出場したので、少なくとも精神力+0.5などの変化が1人以上に出る。
  await expect(page.getByRole('heading', { name: '選手の成長' })).toBeVisible();
  await expect(page.locator('.growth-row').first()).toBeVisible();
  await expect(
    page.getByText('この試合の成長記録はありません', { exact: false }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '部に戻る' }).click();
  await expect(page.getByText('MATCH SUMMARY', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '今週の練習', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('match cinema: only one .cinema section renders after advancing the match', async ({
  page,
}) => {
  // 回帰テスト: MatchCinema の key（m.minute）と SubstitutionDialog の key（subToken）が
  // どちらも 0 始まりで、同じ Fragment の兄弟同士として衝突していたため、React の
  // reconciliation が古い MatchCinema の DOM を取り除けずに残していた
  // （.cinema が2つ表示される不具合）。名前空間付きのキーで衝突を無くし、
  // 15分を2回進めても .cinema が常にちょうど1つであることを確認する。
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('試合図重複検証高校', 2024));
  await page.goto('/');
  await expect(page.locator('.cinema')).toHaveCount(1);

  const advance = page.getByRole('button', { name: /次の15分を進める|後半の15分を進める/ });
  await advance.click();
  await expect(page.locator('.cinema')).toHaveCount(1);
  await expect(page.locator('.cinema .fm-empty')).toHaveCount(0);

  await advance.click();
  await expect(page.locator('.cinema')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('mobile 390px: substitution dialog and match summary fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withSave(page, startedMatch('モバイル交代検証高校', 555));
  await page.goto('/');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  await expect(page.locator('.sub-column').first()).toBeVisible();
  // 押しやすさ: 選手選択ボタンは44px以上の高さを確保する。
  const box = await page.locator('.sub-pick').first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');

  await withSave(page, finishedMatch('モバイルサマリ検証高校', 556));
  await page.goto('/');
  await expect(page.getByText('MATCH SUMMARY', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/match-summary-mobile.png', fullPage: true });
});
