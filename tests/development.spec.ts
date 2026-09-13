import { test, expect } from '@playwright/test';
import { newGame, act } from '../lib/game';

test('v2 future: policy locks, manager motivates, scouting is limited, mobile cards fit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
  await page.getByRole('tab', { name: '育成・スカウト', exact: true }).click();
  await page.getByRole('button', { name: 'この半年の方針を確定' }).click();
  await expect(page.getByText('進捗 0 / 8週')).toBeVisible();
  await page.getByRole('radio', { name: 'マネージャー', exact: true }).check();
  await page.getByRole('button', { name: /小春 ひなた/ }).click();
  await page
    .getByRole('radio', { name: 'コンディションケア', exact: true })
    .check();
  await page.screenshot({
    path: 'test-results/v2-manager-mobile.png',
    fullPage: true,
  });
  await page
    .getByRole('radio', { name: '新入生スカウト', exact: true })
    .check();
  const card = page.locator('.scout-card').first();
  await card.getByRole('button', { name: '視察 / 3' }).click();
  await expect(page.getByText('今週の活動は完了')).toBeVisible();
  await expect(card.getByRole('button', { name: '面談 / 5' })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: 'test-results/v2-scout-mobile.png',
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('tab', { name: '育成・スカウト', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'つないで崩す', exact: true }).first(),
  ).toBeVisible();
});

test('v2 match: command, contextual coaching, real highlight canvas and replay do not duplicate score', async ({
  page,
}) => {
  let s = newGame('映像試験高校', 2026);
  s.week = 3;
  s = act(s, { type: 'train', training: 'rest' });
  s = act(s, { type: 'start' });
  await page.addInitScript(
    (value) =>
      localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('radio', { name: '速く', exact: true }).check();
  await page.getByRole('radio', { name: 'サイド', exact: true }).check();
  await page.getByRole('button', { name: '次の15分を進める' }).click();
  await page.getByRole('button', { name: '挑戦をほめる' }).click();
  await expect(page.locator('.voice-response')).toContainText('育った');
  await expect(page.getByRole('button', { name: '挑戦をほめる' })).toHaveCount(
    0,
  );
  await expect(page.locator('.cinema canvas')).toBeVisible();
  const before = await page.locator('.score>strong').innerText();
  await page.getByRole('button', { name: 'リプレイ', exact: true }).click();
  await page
    .getByRole('button', { name: '演出をスキップ', exact: true })
    .click();
  expect(await page.locator('.score>strong').innerText()).toBe(before);
  await page.screenshot({
    path: 'test-results/v2-match-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: 'test-results/v2-match-mobile.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('v2 reduced motion and legacy saves retain career and assign unique portraits', async ({
  page,
}) => {
  const s = JSON.parse(JSON.stringify(newGame('継承テスト高校', 123)));
  s.season = 4;
  s.week = 5;
  delete s.development;
  for (const p of s.players) delete p.identity;
  await page.addInitScript(
    (value) =>
      localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /継承テスト高校/ }),
  ).toBeVisible();
  await page.getByRole('tab', { name: '選手・編成' }).click();
  await expect(page.locator('.player-link .portrait')).toHaveCount(18);
  await page.locator('.player-link').first().click();
  await expect(page.getByText('この選手との思い出 (0)')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
});
