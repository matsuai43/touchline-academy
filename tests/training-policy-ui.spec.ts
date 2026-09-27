import { test, expect, type Page } from '@playwright/test';

// V4-2 (DESIGN_V4 6章): 「今月の育成方針」画面の回帰テスト。
// 一括設定（6.1）・方針と能力の対応（6.2）・選手ごとの方針（U3、絞り込み・個別上書き・
// 個別解除）・重点育成選手（6.3）が同じ画面にあり、幅375〜390pxで横スクロールが
// 出ないこと、名前を押すと既存の選手詳細（別ダイアログ）が開くことを確認する。

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
}

test.use({ viewport: { width: 390, height: 844 } });

async function openPolicyDialog(page: Page) {
  await page.getByRole('button', { name: '個人方針を開く' }).click();
  const policyDialog = page.getByRole('dialog').filter({ hasText: '今月の育成方針' });
  await expect(policyDialog).toBeVisible();
  return policyDialog;
}

test('training policy screen: shows the 4 sections (bulk setting / explanation / per-player table / focus player)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startFresh(page);
  const policyDialog = await openPolicyDialog(page);

  const titles = policyDialog.locator('.policy-section-title');
  await expect(titles).toHaveText([
    'ポジション×学年の一括設定',
    '方針と能力の対応',
    '選手ごとの方針',
    '重点育成選手',
  ]);
  // 6.2: 方針名は選手画面の能力名にそろえてある（旧名のスピード/ドリブル/フィジカルは出ない）。
  await expect(policyDialog.locator('.policy-explain-table')).toContainText('走力');
  await expect(policyDialog.locator('.policy-explain-table')).toContainText('突破');
  await expect(policyDialog.locator('.policy-explain-table')).toContainText('持久・パワー');

  expect(errors).toEqual([]);
});

test('training policy screen: bulk group setting applies to non-individual players in that group only', async ({
  page,
}) => {
  await startFresh(page);
  const policyDialog = await openPolicyDialog(page);

  // FW・3年の一括設定を「決定力」にする。
  const fwRow = policyDialog.locator('.policy-group-row').filter({ has: page.locator('.policy-group-row-label', { hasText: 'FW' }) });
  const fwYear3Select = fwRow.locator('.policy-group-cell').nth(2).locator('select');
  await fwYear3Select.selectOption({ label: '決定力' });

  // 絞り込みをFW・3年にして、行の方針セレクトが「決定力」になっていることを確認する。
  await policyDialog.getByRole('button', { name: '全ポジション' }).click({ trial: true }).catch(() => {});
  await policyDialog.locator('.policy-filter-chip', { hasText: 'FW' }).first().click();
  await policyDialog.locator('.policy-filter-chip', { hasText: '3年' }).click();
  const rows = policyDialog.locator('.policy-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const select = rows.nth(i).locator('.policy-row-select select').first();
    await expect(select).toHaveValue(/./);
    await expect(select.locator('option:checked')).toHaveText('決定力');
  }
});

test('training policy screen: an individual override survives a group change, and can be cleared back to the group setting', async ({
  page,
}) => {
  await startFresh(page);
  const policyDialog = await openPolicyDialog(page);

  const firstRow = policyDialog.locator('.policy-row').first();
  const firstSelect = firstRow.locator('.policy-row-select select').first();
  await firstSelect.selectOption({ label: '精神力' });
  await expect(firstRow.locator('.policy-row-individual-tag')).toBeVisible();

  // ポジションの一括設定を変えても、個別設定した選手は変わらない。
  const rowPos = await firstRow.locator('.policy-row-pos').innerText();
  const groupRow = policyDialog
    .locator('.policy-group-row')
    .filter({ has: page.locator('.policy-group-row-label', { hasText: rowPos }) });
  await groupRow.locator('.policy-group-cell').first().locator('select').selectOption({ label: '守備' });
  await expect(firstSelect.locator('option:checked')).toHaveText('精神力');

  // 「個別の設定を解除」を押すと、個別札が消え、一括設定に従う表示へ戻る。
  await firstRow.getByRole('button', { name: '個別の設定を解除' }).click();
  await expect(firstRow.locator('.policy-row-individual-tag')).toHaveCount(0);
});

test('training policy screen: tapping a player name opens the existing player detail dialog without closing the policy dialog', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startFresh(page);
  const policyDialog = await openPolicyDialog(page);

  const firstRow = policyDialog.locator('.policy-row').first();
  const playerName = (await firstRow.locator('.policy-row-name small').locator('..').innerText()).split('\n')[0];
  await firstRow.locator('.policy-row-name').click();

  const detailDialog = page.getByRole('dialog').filter({ hasText: 'PLAYER PROFILE' });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog).toContainText(playerName);
  // 選手詳細（別ダイアログ）が最前面になっている間、方針ダイアログは
  // アクセシビリティツリー上は一時的に隠れる（aria-hidden）が、DOM/Reactの状態としては
  // 維持されたまま（マウント解除されない）。選手詳細を閉じると元の方針ダイアログへ戻る。
  await expect(page.locator('.training-policy-panel')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(detailDialog).toHaveCount(0);
  await expect(policyDialog).toBeVisible();

  expect(errors).toEqual([]);
});

test('training policy screen: fits 390px width without horizontal page scroll', async ({ page }) => {
  await startFresh(page);
  const policyDialog = await openPolicyDialog(page);

  const overflow = await policyDialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, '「今月の育成方針」ダイアログが横スクロールしている').toBeLessThanOrEqual(1);
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(bodyOverflow, 'ページ全体が横スクロールしている').toBeLessThanOrEqual(1);
});
