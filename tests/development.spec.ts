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
  // D2a: 週1回制限のスカウト活動は disabled にせず、押せる状態のまま
  // aria-disabled="true" で見た目だけ落ち着かせる。押すと lib 側の検証が働き、
  // 理由がトーストに出て状態は変わらない（連打で追加の活動はできない）。
  const visitBtn = card.getByRole('button', { name: '面談 / 5' });
  await expect(visitBtn).toHaveAttribute('aria-disabled', 'true');
  // 実DOMのdisabledプロパティはfalseのまま（disabled属性を使っていない証拠）。
  // Playwrightの toBeEnabled()/.click() は aria-disabled="true" も disabled 扱いして
  // 素通りしてくれない（アクショナビリティ判定に含まれるため）ので、実際のクリック
  // イベントで検証する（force はPlaywright側の待機を止めるだけで、実ブラウザの
  // クリックそのものは常に通る＝実ユーザーの操作を再現する）。
  expect(await visitBtn.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
  await visitBtn.click({ force: true });
  await expect(
    page.getByText('スカウト活動は週に1回', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('今週の活動は完了')).toBeVisible();
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
  // W8: 試合ハイライトは Canvas の映像風ハイライトから、真上視点で点が動く
  // Football Manager 風の SVG 戦術図に置き換わった（app/match-cinema.tsx）。
  await expect(page.locator('.cinema svg.fm-pitch')).toBeVisible();
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
