import { test, expect } from '@playwright/test';
import { newGame } from '../lib/game';
import { readCompetition } from '../lib/competition';

for (const width of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`V4-7: ${width}px ${theme} select an expedition, save and switch to rest`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    const s = newGame('練習試合確認高校', 42); s.week = 1; readCompetition(s);
    await page.addInitScript((save) => {
      if (!localStorage.getItem('touchline-academy-v1')) localStorage.setItem('touchline-academy-v1', JSON.stringify(save));
    }, s);
    await page.goto('/');
    const application = page.locator('.friendly-application');
    await application.locator('summary').click();
    await expect(application.locator('.friendly-option')).toHaveCount(4);
    await expect(application).toContainText('遠征も部費はかかりません');
    await application.getByRole('radio', { name: /^遠征/ }).check();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('touchline-academy-v1')!).v3.competition.friendlies.offers[2].choice)).toBe('away');
    await page.reload();
    await application.locator('summary').click();
    await expect(application.getByRole('radio', { name: /^遠征/ })).toBeChecked();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('touchline-academy-v1')!).funds)).toBe(s.funds);
    await application.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/v4-friendly-${width}-${theme}.png`, animations: 'disabled' });
    await application.getByRole('radio', { name: /今回は見送る/ }).check();
    await expect(application.locator('summary')).toContainText('休養');
  });
}
