import { test, expect } from '@playwright/test';
import { newGame, act } from '../lib/game';
import { matchRatings } from '../lib/match-rating';
import { isBenchPlayer } from '../lib/squad';

for (const width of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`V4-8: ${width}px ${theme} next match, weekly edit, lineup swap and compact results`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    const s = newGame('新画面確認高校', 42); s.funds = 500;
    await page.addInitScript((save) => { if (!localStorage.getItem('touchline-academy-v1')) localStorage.setItem('touchline-academy-v1', JSON.stringify(save)); }, s);
    await page.goto('/');
    const home = page.getByRole('region', { name: '次の試合と今週の予定' });
    await expect(home.getByRole('heading', { name: '次の試合' })).toBeVisible();
    const head = await home.getByRole('heading', { name: '次の試合' }).boundingBox();
    expect(head!.y + head!.height).toBeLessThan(844);
    await expect(page.locator('.home-overview .week-calendar > *')).toHaveCount(7);
    await expect(page.locator('button.primary:visible')).toHaveCount(1);
    await page.screenshot({ path: `test-results/v4-home-${width}-${theme}.png`, animations: 'disabled' });

    await page.getByRole('button', { name: /火曜の練習：/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /休養・ケア/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('touchline-academy-v1')!).weeklyMenu[1])).toBe('rest');
    await expect(page.locator('.training-card').first()).toContainText('伸びる能力');

    await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
    await expect(page.getByRole('radio', { name: '育成重視', exact: true })).toBeHidden();
    await expect(page.locator('.lineup-pitch .mastery-badge')).toHaveCount(11);
    const bench = s.players.find((p) => isBenchPlayer(s, p.id))!;
    await page.locator('.board-bench-grid > button').first().click();
    await expect(page.locator('.board-selection')).toContainText('入れる位置');
    await page.locator('.lineup-pitch .pitch-player').first().click();
    await expect(page.locator('.board-strength output')).toContainText('→');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('touchline-academy-v1')!).lineup[0])).toBe(bench.id);
    await page.locator('.team-board-panel').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/v4-board-${width}-${theme}.png`, animations: 'disabled' });
    await page.getByText('編成の設定', { exact: true }).click();
    await page.getByRole('radio', { name: '4-4-2', exact: true }).check();
    await expect(page.getByRole('button', { name: /強化する/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'クラブハウス', exact: true }).click();
    await page.getByRole('tab', { name: 'チームの状況', exact: true }).click();
    await page.getByRole('button', { name: /強化する/ }).click();
    await expect(page.getByRole('heading', { name: '練習設備 Lv.2' })).toBeVisible();
    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await expect(page.getByRole('region', { name: '学校からの目標と評価' })).toContainText('校長');
    await expect(page.getByRole('region', { name: '学校からの目標と評価' })).toContainText('OB会');

    s.day = 6; s.pending = { kind: 'friendly', round: 0, strength: 50, opponent: '試合相手高校', style: 'balanced', label: '練習試合' };
    const result = act(act(s, { type: 'start' }), { type: 'autoMatch' });
    await page.evaluate((save) => localStorage.setItem('touchline-academy-v1', JSON.stringify(save)), result);
    await page.reload();
    const scorers = matchRatings(result).filter((r) => r.goals > 0);
    expect(scorers.reduce((sum, r) => sum + r.goals, 0)).toBe(result.match!.home);
    expect(result.match!.home).toBeGreaterThan(0);
    for (const scorer of scorers) await expect(page.locator('.mr-quick-summary')).toContainText(`${scorer.name} ${scorer.goals}得点`);
    await expect(page.locator('.mr-quick-summary')).toContainText('MOM');
    await expect(page.locator('.mr-quick-summary')).toContainText('けがの状態');
    await expect(page.locator('.mr-detail')).not.toHaveAttribute('open', '');
    await expect(page.locator('.mr-rating-row').first()).toBeHidden();
    await page.screenshot({ path: `test-results/v4-result-${width}-${theme}.png`, animations: 'disabled' });
    await page.locator('.mr-detail > summary').click();
    await expect(page.locator('.mr-rating-row').first()).toBeVisible();
    await page.getByRole('button', { name: '部に戻る', exact: true }).click();
    await expect(page.getByRole('heading', { name: '次の試合', exact: true })).toBeVisible();
  });
}
