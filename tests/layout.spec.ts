import { test, expect, type Page } from '@playwright/test';
import { newGame } from '../lib/game';

// W6: 横画面・アプリ的UI の検証。
// スマホ横持ち（例 844x390）では「左に固定ナビ、右にスクロールする本文」の2カラムへ
// 切り替わり、ページ全体が縦に延々スクロールすることはない。縦持ち（390x844）は
// 従来どおりの上部タブバー・1カラムのまま壊れていないことも合わせて確認する。
// 仕様: DESIGN_V3.md 「W6 — 横画面・アプリ的UI」。

async function seedGame(page: Page, school: string, seed: number) {
  const s = newGame(school, seed);
  await page.addInitScript(
    (value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
}

test.describe('W6 横画面・アプリ的UI', () => {
  test('landscape 844x390: left nav + right content, all major tabs fit without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seedGame(page, '横画面検証高校', 4001);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: '今日の練習', exact: true }),
    ).toBeVisible();

    const nav = page.locator('.nav-wrap');
    const main = page.locator('#main');
    const navBox = await nav.boundingBox();
    const mainBox = await main.boundingBox();
    expect(navBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    // 左に細い固定ナビ（幅100px未満）、その右に本文が続く2カラム。
    expect(navBox!.width).toBeLessThan(100);
    expect(mainBox!.x).toBeGreaterThanOrEqual(navBox!.x + navBox!.width - 1);
    // ナビはヘッダー直下から画面下端まで、縦をほぼ占める（横持ち特有の縦積みナビ）。
    expect(navBox!.height).toBeGreaterThan(300);
    // main-nav（タブ一覧）はナビの中で縦積みになっている。
    const navDirection = await page.evaluate(
      () => getComputedStyle(document.querySelector('.main-nav')!).flexDirection,
    );
    expect(navDirection).toBe('column');

    for (const tabName of ['クラブハウス', '選手・編成', '大会・日程', '部の記録']) {
      await page.getByRole('tab', { name: tabName, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: 'test-results/landscape-team.png' });
  });

  test('landscape collapses page-level vertical scroll versus portrait, for the same tall squad list', async ({
    page,
  }) => {
    await seedGame(page, 'スクロール比較高校', 4002);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
    await page.getByRole('tab', { name: '部員一覧', exact: true }).click();
    await expect(page.getByRole('heading', { name: /部員一覧/ })).toBeVisible();
    const portrait = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      inner: window.innerHeight,
    }));
    await page.screenshot({ path: 'test-results/portrait-team-full.png', fullPage: true });

    // 同じページ・同じセーブのまま横持ちへ回す（SPAなのでリロード不要、CSSだけが切り替わる）。
    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await page.evaluate(() => ({
      doc: document.documentElement.scrollHeight,
      inner: window.innerHeight,
      main: document.getElementById('main')?.scrollHeight ?? 0,
    }));
    await page.screenshot({ path: 'test-results/landscape-team-full.png' });

    // eslint はこのファイルの対象外（tests/）。数値は最終報告に転記する。
    console.log(
      `[W6] portrait: page scrollHeight=${portrait.doc}px (viewport height ${portrait.inner}px) / ` +
        `landscape: page scrollHeight=${landscape.doc}px (viewport height ${landscape.inner}px, ` +
        `main-content 内部 scrollHeight=${landscape.main}px)`,
    );

    // 横持ちでは main-content だけが独立スクロールし、ページ自体はビューポートに収まる
    // （＝アドレスバーの下までスクロールし続けることがない）。
    expect(landscape.doc).toBeLessThanOrEqual(landscape.inner + 8);
    // 縦持ちは従来どおりページ全体が長く、横持ちとの差は歴然としている。
    expect(portrait.doc).toBeGreaterThan(landscape.doc * 3);
  });

  test('portrait 390x844 keeps the classic top tab bar (no regression from the landscape layout)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(page, '縦持ち回帰確認高校', 4003);
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'クラブハウス', exact: true })).toBeVisible();
    const direction = await page.evaluate(
      () => getComputedStyle(document.querySelector('.nav-wrap')!).flexDirection,
    );
    expect(direction).toBe('row');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    for (const tabName of ['選手・編成', '大会・日程']) {
      await page.getByRole('tab', { name: tabName, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: 'test-results/portrait-regression.png', fullPage: true });
  });

  test('landscape remembers each tab scroll position when switching tabs', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seedGame(page, 'スクロール記憶高校', 4004);
    await page.goto('/');
    await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
    const main = page.locator('#main');
    // scrollTop の代入は 'scroll' イベントを非同期に発火させる（実際の指スクロールでは
    // 連続して発火し onScroll が確実に捕まえるが、テストでは1回の代入だけなのでイベントの
    // 到着を明示的に待つ）。onScroll ハンドラがこれを scrollMemory に記録する。
    await main.evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          el.addEventListener('scroll', () => resolve(), { once: true });
          el.scrollTop = 200;
        }),
    );
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(80);

    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeLessThan(10);
    await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
    const restored = await main.evaluate((el) => el.scrollTop);
    expect(restored).toBeGreaterThan(80);
  });

  test('PWA manifest is linked from the page and describes an installable standalone app', async ({
    page,
  }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');
    const manifest = (await page.evaluate(
      async (url) => (await fetch(url as string)).json(),
      href,
    )) as {
      display?: string;
      name?: string;
      icons?: unknown[];
    };
    expect(manifest.display).toBe('standalone');
    expect(String(manifest.name)).toContain('TOUCHLINE');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportMeta).toContain('viewport-fit=cover');
  });
});
