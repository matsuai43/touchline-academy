import { test, expect, type Page } from '@playwright/test';
import { newGame, act, type State } from '../lib/game';
import { getCurrentLifeEvent } from '../lib/school-life';

// D2b: DADS 対応の仕上げと最終検証。
// - スキップリンク（本文へ移動）とフォーカス表示。
// - 本文中のリンク（ヘルプの「クレジット」など）は色だけに頼らず下線。
// - スカウト候補カードの「入学提案」は塗り(Primary)ではなく枠線(Secondary)。
// - 横はみ出しゼロ：375px/1280px × ライト/ダーク × 主要5タブ + 試合画面 + 試合後サマリ。
// - コントラスト監査（文字4.5:1・境界線3:1）：同じ画面の組み合わせで違反0件を目指す。

const TABS = ['クラブハウス', '選手・編成', '大会・日程', '育成・スカウト', '部の記録'] as const;
const WIDTHS = [375, 1280] as const;
const THEMES = ['light', 'dark'] as const;

// S1: 日次コマンド化により「1回のtrain操作=1週」の前提が崩れたため、週3(必ずU18リーグの
// 試合がある週)の試合日(日曜)まで、休養で日次コマンドを進めてから試合を開始する。
function startedMatch(school: string, seed: number): State {
  let s = newGame(school, seed);
  s.week = 3;
  let guard = 0;
  while (!s.pending && guard++ < 20) {
    const cur = getCurrentLifeEvent(s);
    if (cur) s = act(s, { type: 'life', choiceId: cur.event.choices[0].id });
    if (s.event) s = act(s, { type: 'event', choice: 'team' });
    while (s.cupDraw) s = act(s, { type: 'cupDrawAck' });
    if (!s.pending) s = act(s, { type: 'train', training: 'rest' });
  }
  s = act(s, { type: 'start' });
  return s;
}
function finishedMatch(school: string, seed: number): State {
  let s = startedMatch(school, seed);
  for (let i = 0; i < 6; i++) s = act(s, { type: 'segment' });
  return s;
}
async function withSave(page: Page, s: State) {
  await page.addInitScript(
    (value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
}
async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
}

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

// contrast-audit.js（C:/Users/matsu/.claude/skills/dads-ui-review/scripts/contrast-audit.js）と
// 同じ算出方法（color-mix()の0〜1表記対応、祖先の半透明背景を合成してからのコントラスト計算）を、
// このプロジェクトの実際のセレクタ（.primary/.secondary/.scout-card 等）向けに書き換えて埋め込む。
// スキル側のファイルパスは開発機ローカルのグローバルディレクトリのため、リポジトリ単体で
// 何度でも再実行できるよう、ロジックをこのテストファイル内に自己完結させている。
type ContrastResult = { theme: string; fails: string[]; rows: string[] };

async function auditContrast(page: Page): Promise<ContrastResult> {
  return page.evaluate(() => {
    const TEXT_CHECKS: [string, string][] = [
      ['p', '本文'],
      ['.muted', '補助テキスト'],
      ['.help-copy a', 'ヘルプ本文中のリンク'],
      ['a:not(.skip):not(.brand)', 'リンク'],
      ['button.primary', '塗りボタンのラベル'],
      ['button.secondary', '枠線ボタンのラベル'],
      ['button[aria-disabled="true"], a[aria-disabled="true"]', '押せない見た目のボタン'],
      ['th', '表の見出し'],
      ['td', '表のセル'],
      ['[role="tab"]', 'タブのラベル'],
    ];
    const BORDER_CHECKS: [string, string][] = [
      ['.scout-card', 'カード外周'],
      ['.manager-card', 'カード外周（マネージャー）'],
      ['input, select, textarea', '入力欄の外周'],
      ['.secondary', '枠線ボタン'],
      ['.es-nav-btn', '紙芝居ナビボタンの外周'],
      ['[data-slot="table-container"]', '表コンテナの外周'],
    ];

    function parse(c: string): number[] {
      const m = String(c).match(/[\d.]+/g);
      if (!m) return [0, 0, 0, 0];
      const n = m.map(Number);
      if (c.startsWith('color(srgb')) return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1];
      return n;
    }
    function lum(c: string) {
      const a = parse(c)
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    function over(fg: string, bg: string) {
      const f = parse(fg),
        b = parse(bg),
        a = f.length > 3 ? f[3] : 1;
      return 'rgb(' + [0, 1, 2].map((i) => f[i] * a + b[i] * (1 - a)).join(',') + ')';
    }
    function effectiveBg(el: Element | null) {
      const layers: string[] = [];
      let p: Element | null = el;
      while (p && p.nodeType === 1) {
        const b = getComputedStyle(p).backgroundColor;
        if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') layers.push(b);
        p = p.parentElement;
      }
      let bg = 'rgb(255,255,255)';
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      return bg;
    }
    function ratio(fg: string, bg: string) {
      const f = lum(over(fg, bg)),
        b = lum(bg);
      return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
    }
    function hasBorder(el: Element) {
      const s = getComputedStyle(el);
      const bc = parse(s.borderTopColor);
      return parseFloat(s.borderTopWidth) > 0 && !(bc.length > 3 && bc[3] === 0);
    }

    const rows: string[] = [];
    const fails: string[] = [];
    for (const [sel, label] of TEXT_CHECKS) {
      const el = document.querySelector(sel);
      if (!el || (el as HTMLElement).offsetParent === null) continue;
      const s = getComputedStyle(el);
      const r = ratio(s.color, effectiveBg(el));
      rows.push(`文字 ${label} ${r.toFixed(2)}:1 ${parseFloat(s.fontSize)}px`);
      if (r < 4.5) fails.push(`${label} ${r.toFixed(2)}`);
    }
    for (const [sel, label] of BORDER_CHECKS) {
      const list = Array.from(document.querySelectorAll(sel)).filter(
        (el) => (el as HTMLElement).offsetParent !== null,
      );
      const el = list.find(hasBorder);
      if (!el) continue;
      const s = getComputedStyle(el);
      const r = ratio(s.borderTopColor, effectiveBg(el.parentElement));
      rows.push(`境界線 ${label} ${r.toFixed(2)}:1`);
      if (r < 3) fails.push(`境界線 ${label} ${r.toFixed(2)}`);
    }
    const theme =
      document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark(OS)' : 'light(OS)');
    return { theme, fails, rows };
  });
}

test.describe('D2b 最終検証: 横はみ出し（375px/1280px × ライト/ダーク）', () => {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      test(`${width}px / ${theme}: 主要5タブ・試合画面・試合後サマリでスクロール幅の超過が無い`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });

        await startFresh(page);
        for (const tab of TABS) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          const over = await overflowPx(page);
          expect(over, `${width}px/${theme}: ${tab} タブで横に${over}pxはみ出し`).toBe(0);
        }

        await withSave(page, startedMatch(`はみ出し試合${width}${theme}`, 5001));
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/');
        await expect(page.getByText('交代 0 / 5').first()).toBeVisible();
        const overMatch = await overflowPx(page);
        expect(overMatch, `${width}px/${theme}: 試合画面で横に${overMatch}pxはみ出し`).toBe(0);

        await withSave(page, finishedMatch(`はみ出しサマリ${width}${theme}`, 5002));
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/');
        await expect(page.getByRole('region', { name: '試合結果' })).toBeVisible();
        const overSummary = await overflowPx(page);
        expect(overSummary, `${width}px/${theme}: 試合後サマリで横に${overSummary}pxはみ出し`).toBe(
          0,
        );
      });
    }
  }
});

test.describe('D2b 最終検証: コントラスト再監査（文字4.5:1・境界線3:1）', () => {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      test(`${width}px / ${theme}: 主要5タブ・試合画面・試合後サマリで違反0件`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        const allFails: string[] = [];

        await startFresh(page);
        for (const tab of TABS) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          const result = await auditContrast(page);
          for (const f of result.fails) allFails.push(`[${tab}] ${f}`);
        }

        await withSave(page, startedMatch(`監査試合${width}${theme}`, 6001));
        await page.goto('/');
        await expect(page.getByText('交代 0 / 5').first()).toBeVisible();
        const matchResult = await auditContrast(page);
        for (const f of matchResult.fails) allFails.push(`[試合画面] ${f}`);

        await withSave(page, finishedMatch(`監査サマリ${width}${theme}`, 6002));
        await page.goto('/');
        await expect(page.getByRole('region', { name: '試合結果' })).toBeVisible();
        const summaryResult = await auditContrast(page);
        for (const f of summaryResult.fails) allFails.push(`[試合後サマリ] ${f}`);

        expect(allFails, `${width}px/${theme}: コントラスト違反 ${allFails.length}件`).toEqual([]);
      });
    }
  }
});

test('スキップリンク: 先頭にあり、フォーカスで見え、押すと本文(#main)へ移動する', async ({ page }) => {
  await startFresh(page);
  // ウェルカムダイアログが閉じてフォーカストラップが解除されるのを待ってから操作する。
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  // Tabキー最初の1回で最初の要素（スキップリンク）にフォーカスが移る。
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  // フォーカス時は画面内（top: -100px の隠し位置から top: 10px 付近へ）に見える。
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(await skip.getAttribute('href')).toBe('#main');

  await page.keyboard.press('Enter');
  const mainFocused = await page.evaluate(
    () => document.activeElement?.id === 'main' || location.hash === '#main',
  );
  expect(mainFocused).toBe(true);
});

test('本文中のリンク（ヘルプの「クレジット」）は色だけでなく下線で示される', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('button', { name: '遊び方', exact: true }).click();
  const link = page.getByRole('link', { name: 'クレジット' });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  const deco = await link.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      line: s.textDecorationLine,
      thickness: parseFloat(s.textDecorationThickness),
      offset: parseFloat(s.textUnderlineOffset),
    };
  });
  expect(deco.line).toContain('underline');
  expect(deco.thickness).toBeCloseTo(1, 0);
  expect(deco.offset).toBeCloseTo(3, 0);

  await link.hover();
  const hoverThickness = await link.evaluate((el) =>
    parseFloat(getComputedStyle(el).textDecorationThickness),
  );
  expect(hoverThickness).toBeGreaterThan(deco.thickness);
});

test('スカウト候補カードの「入学提案」は塗り(Primary)ではなく枠線(Secondary)', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('tab', { name: '育成・スカウト', exact: true }).click();
  await page.getByRole('button', { name: 'この半年の方針を確定' }).click();
  await page.getByRole('radio', { name: '新入生スカウト', exact: true }).check();

  const offerButtons = page.locator('.scout-card').getByRole('button', { name: /入学提案/ });
  const count = await offerButtons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(offerButtons.nth(i)).not.toHaveClass(/(^|\s)primary(\s|$)/);
  }
  // 画面全体でも塗り(Primary)ボタンは増えていないこと（原則1画面1つ、ここは0でよい）。
  const primaryCount = await page.locator('button.primary').count();
  expect(primaryCount).toBeLessThanOrEqual(1);
});
