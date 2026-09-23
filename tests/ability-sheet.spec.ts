import { test, expect, type Page } from '@playwright/test';

// 回帰テスト（このセッションでの修正分）:
// 1. 部員一覧の「能力シートを見る」を押すと、表の行の中に展開するのではなく、
//    既存の選手詳細ダイアログが開き、ダイアログ内の能力シート・ポジション適性が
//    横スクロールなしで収まること。
// 2. ポジション適性の「主ポジション」チップの文字色/背景色のコントラストが
//    4.5:1以上であること（.primary という汎用ボタンクラスと衝突して白文字に
//    なっていたバグの再発防止）。

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
}

test.use({ viewport: { width: 1280, height: 900 } });

test('部員一覧の「能力シートを見る」は表内展開ではなく選手詳細ダイアログを開き、横スクロールなしで収まる', async ({
  page,
}) => {
  await startFresh(page);
  await page.getByRole('tab', { name: '選手・編成', exact: true }).click();

  // 表の中に展開行が残っていないこと（bug 2 の直し方: ダイアログに一本化）。
  await expect(page.locator('.ability-sheet-row')).toHaveCount(0);

  const toggle = page.locator('button.ability-toggle').first();
  await expect(toggle).toHaveText('能力シートを見る');
  await toggle.click();

  const dialog = page.getByRole('dialog').filter({ has: page.locator('.ability-sheet') });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ability-sheet')).toBeVisible();
  await expect(dialog.locator('.position-aptitude')).toBeVisible();

  // ダイアログ・能力シートとも scrollWidth <= clientWidth（横スクロールが要らない）。
  const dialogEl = dialog.first();
  const overflow = await dialogEl.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, 'ダイアログが横スクロールしている').toBeLessThanOrEqual(1);
  const sheetOverflow = await dialog
    .locator('.ability-sheet')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sheetOverflow, '能力シートが横スクロールしている').toBeLessThanOrEqual(1);
  const gridOverflow = await dialog
    .locator('.position-aptitude')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(gridOverflow, 'ポジション適性グリッドが横スクロールしている').toBeLessThanOrEqual(1);
});

test('ポジション適性の「主ポジション」チップは文字色と背景色のコントラストが4.5:1以上', async ({
  page,
}) => {
  await startFresh(page);
  await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
  await page.locator('button.ability-toggle').first().click();

  const chip = page.locator('.position-aptitude-cell.primary').first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('主ポジション');

  const { color, background } = await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor };
  });

  const ratio = await page.evaluate(
    ([colorStr, bgStr]) => {
      const parse = (s: string) => {
        const m = s.match(/[\d.]+/g)!.map(Number);
        return { r: m[0], g: m[1], b: m[2] };
      };
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const f = (c: number) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const l1 = lum(parse(colorStr));
      const l2 = lum(parse(bgStr));
      const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (lighter + 0.05) / (darker + 0.05);
    },
    [color, background] as const,
  );

  expect(ratio, `文字色 ${color} / 背景色 ${background} のコントラスト比`).toBeGreaterThanOrEqual(
    4.5,
  );
});
