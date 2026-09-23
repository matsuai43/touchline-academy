import { test, expect, type Page } from '@playwright/test';

// 回帰テスト: 個人方針を決める画面（TrainingPolicyPanel）の各行から、方針画面を
// 閉じずに選手の能力シート（AbilitySheet）を参照できること。以前、能力シートを
// 表の中に展開して横に切れた不具合があったため、横スクロールなしで収まることも
// 確認する。能力シートは別ダイアログとして開くため、Esc で能力シートだけが閉じて
// 方針ダイアログは開いたままであること、閉じたらトグルボタンにフォーカスが戻る
// ことも確認する。

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
}

test.use({ viewport: { width: 1280, height: 900 } });

test('training policy panel: opening a player\'s ability sheet keeps the policy dialog open and fits without horizontal scroll', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startFresh(page);

  // 新規開始直後は月次見直しが必要な状態なので、バナーから個人方針ダイアログを開ける。
  await page.getByRole('button', { name: '個人方針を開く' }).click();
  const policyDialog = page.getByRole('dialog').filter({ hasText: '今月の個人方針' });
  await expect(policyDialog).toBeVisible();

  const firstRow = policyDialog.locator('.training-policy-row').first();
  const playerName = await firstRow.locator('.training-policy-name').innerText();
  const toggle = firstRow.getByRole('button', { name: '能力を見る' });
  await expect(toggle).toBeVisible();
  await toggle.click();

  // 能力シートは別ダイアログとして開き、方針ダイアログは閉じない。
  await expect(policyDialog).toBeVisible();
  const abilityDialog = page.getByRole('dialog').filter({ hasText: 'の能力' });
  await expect(abilityDialog).toBeVisible();
  await expect(abilityDialog).toContainText(playerName.split('\n')[0]);
  const sheet = abilityDialog.locator('.ability-sheet');
  await expect(sheet).toBeVisible();
  await expect(abilityDialog.locator('.position-aptitude')).toBeVisible();
  // 能力シートを見ながら方針を変更できる。
  await expect(abilityDialog.locator('.training-policy-select select')).toBeVisible();

  // ダイアログ・能力シートとも横スクロールが要らない（scrollWidth <= clientWidth）。
  const dialogOverflow = await abilityDialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(dialogOverflow, '能力シートのダイアログが横スクロールしている').toBeLessThanOrEqual(1);
  const sheetOverflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sheetOverflow, '能力シートが横スクロールしている').toBeLessThanOrEqual(1);

  // Esc で能力シートのダイアログだけが閉じ、方針ダイアログは開いたまま。トグルに
  // フォーカスが戻る。
  await page.keyboard.press('Escape');
  await expect(abilityDialog).toHaveCount(0);
  await expect(policyDialog).toBeVisible();
  await expect(toggle).toBeFocused();

  expect(errors).toEqual([]);
});
