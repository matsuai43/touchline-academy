import { test, expect } from '@playwright/test';
import { newGame } from '../lib/game';
import { drawPendingCup, advanceCupWeek, readCompetition } from '../lib/competition';

for (const width of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`V4-6: ${width}px ${theme} pending representatives and 48-team draw`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    const s = newGame('全国代表確認高校', 42);
    s.week = 6; drawPendingCup(s);
    s.week = 8; advanceCupWeek(s, 8);
    await page.addInitScript((save) => {
      if (!localStorage.getItem('touchline-academy-v1')) localStorage.setItem('touchline-academy-v1', JSON.stringify(save));
    }, s);
    await page.goto('/');
    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await page.getByRole('tab', { name: 'トーナメント', exact: true }).click();
    await page.getByText('インターハイのトーナメント表').click();
    const representatives = page.getByRole('region', { name: 'インターハイの全国代表' });
    const count = readCompetition(s).ih.representatives!.districts.filter((entry) => entry.winner).length;
    await expect(representatives).toContainText(`代表決定 ${count}/48`);
    await representatives.getByText('各地区の代表を見る', { exact: true }).click();
    await expect(representatives.getByText(/初出場/).first()).toBeVisible();
    await expect(representatives.getByText(/予選中/).first()).toBeVisible();
    await representatives.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/v4-cup-representatives-${width}-${theme}.png`, animations: 'disabled' });

    for (const week of [9, 10, 11]) { s.week = week; advanceCupWeek(s, week); }
    s.week = 12; drawPendingCup(s);
    await page.evaluate((save) => localStorage.setItem('touchline-academy-v1', JSON.stringify(save)), s);
    await page.reload();
    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await page.getByRole('tab', { name: 'トーナメント', exact: true }).click();
    await page.getByText('インターハイのトーナメント表').click();
    await expect(representatives).toContainText('代表決定 48/48');
    const bracket = page.getByRole('region', { name: '全国大会トーナメント表（横にスクロールできます）' });
    await expect(bracket.getByText('不戦勝', { exact: true })).toHaveCount(16);
    await expect(bracket.getByRole('heading', { name: '3回戦', exact: true })).toBeVisible();
    await bracket.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/v4-cup-bracket-${width}-${theme}.png`, animations: 'disabled' });
  });
}
