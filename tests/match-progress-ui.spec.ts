import { test, expect } from '@playwright/test';
import { newGame, act } from '../lib/game';

for (const width of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`V4-3: ${width}px ${theme} controls, player action and result`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    const state = newGame('試合確認高校', 42);
    state.day = 6;
    state.pending = { kind: 'friendly', round: 0, strength: 50, label: '練習試合', opponent: '架空学園', style: 'balanced' };
    const s = act(state, { type: 'start' });
    await page.addInitScript((save) => { if (!localStorage.getItem('touchline-academy-v1')) localStorage.setItem('touchline-academy-v1', JSON.stringify(save)); }, s);
    await page.goto('/');
    await expect(page.locator('.match-comparison')).toHaveCount(3);
    await expect(page.locator('.pitch-condition')).toHaveCount(11);
    await page.getByRole('button', { name: '次の山場まで', exact: true }).click();
    await page.locator('.pitch-player').first().click();
    await expect(page.getByRole('dialog').getByRole('button', { name: '交代', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '交代', exact: true }).click();
    await expect(page.locator('.sub-step-in')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    await page.locator('.match-timeline').scrollIntoViewIfNeeded();
    const controls = await page.locator('.match-progress-controls').boundingBox();
    expect(controls!.y).toBeGreaterThanOrEqual(0);
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(844);
    const scoreboard = await page.locator('.scoreboard').boundingBox();
    expect(scoreboard!.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/v4-match-${width}-${theme}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'ここからおまかせ' }).click();
    await expect(page.getByText('MATCH RESULT', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('MATCH RESULT', { exact: true })).toBeVisible();
  });

  test(`V4-2: ${width}px ${theme} compact named ability rows`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.getByRole('button', { name: 'この学校で始める' }).click();
    await page.getByRole('button', { name: '個人方針を開く' }).click();
    const row = page.locator('.policy-row').first();
    await row.scrollIntoViewIfNeeded();
    expect((await row.boundingBox())!.height).toBeLessThan(100);
    await expect(row.locator('.policy-row-ability')).toHaveCount(2);
    expect(await row.locator('.policy-row-ability').first().innerText()).toMatch(/決定力|パス|守備|走力|精神力|GK|突破|持久|パワー/);
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/v4-policy-${width}-${theme}.png`, animations: 'disabled' });
  });
}
