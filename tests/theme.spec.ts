import { test, expect } from '@playwright/test';
// D1: ライト/ダークテーマの切り替え検証。
// - 既定（未選択）は端末設定（prefers-color-scheme）に追従する。
// - 設定ダイアログで明示的に「ライト／ダーク」を選ぶと localStorage に保存され、
//   <html data-theme> が付き、端末設定より優先される。
// - 保存済みの明示指定がある場合、次回訪問時は描画前（ハイドレーション前）に
//   <html data-theme> が付くこと（ちらつき防止）を、初期HTMLの時点で確認する。

const THEME_KEY = 'touchline-academy-theme';

test('既定は端末設定に追従する（data-theme無し、prefers-color-schemeで表示が変わる）', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
  const darkBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
  );
  expect(darkBg.toLowerCase()).toBe('#0c1316');

  await page.emulateMedia({ colorScheme: 'light' });
  const lightBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
  );
  expect(['#ffffff', '#fff']).toContain(lightBg.toLowerCase());
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
});

test('設定ダイアログでテーマを選ぶと data-theme と localStorage に反映され、再読み込みでも保持される', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
  await page.getByRole('button', { name: '保存・設定' }).click();
  await expect(page.getByRole('heading', { name: 'テーマ' })).toBeVisible();

  await page.getByRole('radio', { name: 'ライト' }).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
    'light',
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');
  const lightBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
  );
  expect(['#ffffff', '#fff']).toContain(lightBg.toLowerCase());

  await page.reload();
  // ちらつき防止スクリプトが描画前に data-theme="light" を付けているはず。
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');

  await page.getByRole('button', { name: '保存・設定' }).click();
  await page.getByRole('radio', { name: 'ダーク' }).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
    'dark',
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('dark');

  await page.getByRole('radio', { name: '端末に合わせる' }).check();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBeNull();
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBeNull();
});

test('保存済みの明示指定は、次回訪問時に描画前（初期HTML）で反映される（ちらつき防止）', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [THEME_KEY, 'dark'],
  );
  await page.emulateMedia({ colorScheme: 'light' }); // 端末はライトのままでも明示指定が勝つ
  const response = await page.goto('/');
  const html = await response!.text();
  // <script> による書き換えではなく、prerender済みの静的HTML自体に
  // 端末設定より優先される仕組み（インラインスクリプト）が含まれていることを確認する。
  expect(html).toContain('touchline-academy-theme');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe('dark');
  const darkBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
  );
  expect(darkBg.toLowerCase()).toBe('#0c1316');
});
