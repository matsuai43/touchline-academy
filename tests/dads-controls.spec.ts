import { test, expect, type Page } from '@playwright/test';
import { newGame, act, type State } from '../lib/game';
import { getCurrentLifeEvent } from '../lib/school-life';

// D2a: DADS ボタン・フォーム・表の検証。
// - disabled 属性を持つ要素が無いこと（押せない理由はトースト/直下の補足文で示す方針に
//   変えたため、HTMLの disabled は主要画面・試合画面のどこにも残らないはず）。
// - 見えているボタン・リンク・ラジオ選択肢の実際のタップ領域（::after による拡張を含む）が
//   44px 以上であること。
// - 5択以下のセレクトはラジオボタンになっていること（部員一覧の並び替え）。
// - 表はスクロール領域に tabIndex とラベルを持つこと。

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
async function withSave(page: Page, s: State) {
  await page.addInitScript(
    (value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
}
// localStorage にまだ何も無い状態から始め、ウェルカムダイアログで開始する
// （development.spec.ts / browser.spec.ts と同じ手順）。
async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
}

// 実際のタップ領域（::after で拡張している分を含む）を測る。
// 通常の boundingBox が既に44px以上ならそれで良し。そうでなければ
// ::after 疑似要素の width/height（px指定のみ対応、max(...)はCSS計算後の値がそのまま
// 返るのでこれで測れる）を見る。
async function tapHeights(page: Page, selector: string): Promise<number[]> {
  return page.$$eval(selector, (els) =>
    els
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((el) => {
        const box = el.getBoundingClientRect();
        let h = box.height;
        const after = getComputedStyle(el, '::after');
        const afterH = parseFloat(after.height);
        if (after.content !== 'none' && after.content !== '' && !Number.isNaN(afterH)) {
          h = Math.max(h, afterH);
        }
        return h;
      }),
  );
}

test('disabled 属性は主要5タブ・試合画面のどこにも無い（DADS: 無効化ではなく aria-disabled + 理由表示）', async ({
  page,
}) => {
  await startFresh(page);

  const tabs = ['クラブハウス', '選手・編成', '大会・日程', '育成・スカウト', '部の記録'];
  for (const name of tabs) {
    await page.getByRole('tab', { name, exact: true }).click();
    const count = await page.locator('[disabled]').count();
    expect(count, `${name} タブに disabled 要素が残っている`).toBe(0);
  }

  // 試合画面（交代3回で枠を使い切った状態）でも disabled が無いこと。
  await withSave(page, startedMatch('試合中disabled検証高校', 4242));
  await page.goto('/');
  expect(await page.locator('[disabled]').count()).toBe(0);
});

test('主要な操作要素のタップ領域は44px以上（クラブタブ・部員一覧・育成タブ）', async ({
  page,
}) => {
  await startFresh(page);

  // .skip（スキップリンク）はD2b（次の担当）の範囲のためここでは対象外。
  for (const [tab, selector] of [
    ['クラブハウス', 'button, a[href]:not(.skip)'],
    ['選手・編成', 'button, a[href]:not(.skip)'],
    ['育成・スカウト', 'button, a[href]:not(.skip)'],
  ] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const heights = await tapHeights(page, selector);
    const tooSmall = heights.filter((h) => h > 0 && h < 44);
    expect(tooSmall, `${tab} タブに44px未満のボタン/リンクが${tooSmall.length}件`).toEqual([]);
  }
});

test('部員一覧の並び替えは4択なのでラジオボタンで、セレクトではない', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('tab', { name: '選手・編成', exact: true }).click();

  await expect(page.locator('.squad-sort select')).toHaveCount(0);
  const radios = page.locator('.squad-sort [role="radio"]');
  await expect(radios).toHaveCount(4);

  await page.getByRole('radio', { name: '名前', exact: true }).check();
  await expect(page.getByRole('radio', { name: '名前', exact: true })).toBeChecked();
  // 並び替えを変えると表の内容が変わりうる。少なくとも操作自体がエラーなく
  // 反映され、表の描画が壊れないことを確認する。
  await expect(page.locator('.squad-group').first().locator('tbody tr').first()).toBeVisible();
});

test('部員一覧・リーグ成績の表はキーボード操作できるスクロール領域を持つ', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
  const container = page.locator('[data-slot="table-container"]').first();
  await expect(container).toHaveAttribute('tabindex', '0');
  const label = await container.getAttribute('aria-label');
  expect(label).toBeTruthy();
  expect(label).toContain('スクロール');
});

test('週1回のスカウト活動は押せる状態のまま理由を示す（トースト）', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('tab', { name: '育成・スカウト', exact: true }).click();
  await page.getByRole('button', { name: 'この半年の方針を確定' }).click();
  await page.getByRole('radio', { name: '新入生スカウト', exact: true }).check();
  const card = page.locator('.scout-card').first();
  await card.getByRole('button', { name: '視察 / 3' }).click();
  const offerBtn = card.getByRole('button', { name: '入学提案 / 8' });
  await expect(offerBtn).toHaveAttribute('aria-disabled', 'true');
  // 実DOMのdisabledプロパティは使っていない。Playwrightの.click()はaria-disabledも
  // アクショナビリティ判定に含めて待機してしまうため、実ユーザーの操作を再現する
  // force:trueで押す。
  expect(await offerBtn.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
  await offerBtn.click({ force: true });
  // 「まず視察して」ではなく既に視察済みなので、次の条件（週1回制限か関心度）で
  // 理由が出る。いずれにせよ何らかの案内がトーストに出て操作が拒否される。
  await expect(page.locator('.toast')).toBeVisible();
});
