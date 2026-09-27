import { test, expect } from '@playwright/test';
import { newGame } from '../lib/game';
import { readCompetition, advanceCupWeek } from '../lib/competition';
import { preparePromotion } from '../lib/promotion';

for (const width of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`V4-5: ${width}px ${theme} promotion rules and resolved brackets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    const s = newGame('参入戦確認高校', 42);
    s.week = 43;
    preparePromotion(s, readCompetition(s));
    advanceCupWeek(s, 44); advanceCupWeek(s, 45);
    s.week = 46;
    await page.addInitScript((save) => localStorage.setItem('touchline-academy-v1', JSON.stringify(save)), s);
    await page.goto('/');
    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await page.getByRole('tab', { name: 'リーグ順位', exact: true }).click();
    await page.getByText('昇格の条件と参入戦', { exact: true }).click();
    await expect(page.locator('.league-ladder [aria-current]')).toContainText('県2部');
    await expect(page.locator('.promotion-bracket strong')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('.promotion-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/v4-promotion-${width}-${theme}.png`, animations: 'disabled' });
  });
}
