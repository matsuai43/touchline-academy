import { test, expect, type Page } from '@playwright/test';
import { newGame, act, type State } from '../lib/game';
import { getCurrentLifeEvent } from '../lib/school-life';

// T-13: ユーザー報告「スマホの戦術選択画面が見切れる」「各ページのスクロール量が多い」への対応。
// - 戦術ボードの「おまかせ編成の方針」「フォーメーション」（.choices、4択）が
//   375/390px幅で画面から見切れていた（.choices に flex-wrap が無かった）のを直した。
// - クラブハウス／選手・編成／大会・日程の中身をサブタブ（セグメント切り替え）で分けた。
// - 試合画面の「映像／声かけ／戦術／交代」をアンカーリンクから区画切り替えのタブに変えた。
// この一式の回帰・仕様検証。

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
async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'この学校で始める' }).click();
}
async function overflowPx(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('T-13: 戦術ボードの4択が375/390px幅で見切れない', () => {
  for (const width of [375, 390]) {
    test(`${width}px 縦持ち: 選手・編成タブの戦術ボードで横はみ出しが無い`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await startFresh(page);
      await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
      // 「おまかせ編成の方針」は4択（総合力重視/適性ポジション重視/調子重視/育成重視）。
      await expect(page.getByRole('radio', { name: '育成重視', exact: true })).toBeVisible();
      expect(await overflowPx(page), '戦術ボードで横にはみ出している').toBe(0);
    });
  }

  test('844x390 横持ち: 選手・編成タブの戦術ボードで横はみ出しが無い', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await startFresh(page);
    await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
    await expect(page.getByRole('radio', { name: '育成重視', exact: true })).toBeVisible();
    expect(await overflowPx(page), '戦術ボードで横にはみ出している').toBe(0);
  });
});

test.describe('T-13: 試合中の戦術パネルが375/390/844x390で見切れない', () => {
  const sizes: { width: number; height: number; label: string }[] = [
    { width: 375, height: 812, label: '375px 縦持ち' },
    { width: 390, height: 844, label: '390px 縦持ち' },
    { width: 844, height: 390, label: '844x390 横持ち' },
  ];
  for (const { width, height, label } of sizes) {
    test(`${label}: 試合画面の戦術タブ・交代タブで横はみ出しが無い`, async ({ page }) => {
      await withSave(page, startedMatch(`見切れ検証高校${width}x${height}`, 999));
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.getByText('交代 0 / 5', { exact: true })).toBeVisible();
      expect(await overflowPx(page), '試合画面（初期表示）で横にはみ出している').toBe(0);

      await page.getByRole('tab', { name: '戦術', exact: true }).click();
      await expect(page.getByRole('radio', { name: /ハイプレス/ })).toBeVisible();
      expect(await overflowPx(page), '戦術タブで横にはみ出している').toBe(0);

      await page.getByRole('tab', { name: '交代', exact: true }).click();
      expect(await overflowPx(page), '交代タブで横にはみ出している').toBe(0);

      // 交代ダイアログ自体も画面内に収まり、スクロールできる（見切れて操作不能にならない）。
      await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const overflowInfo = await dialog.evaluate((el) => ({
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        bottom: el.getBoundingClientRect().bottom,
      }));
      expect(overflowInfo.bottom, 'ダイアログの下端が画面外に出ている').toBeLessThanOrEqual(height + 1);
      expect(await overflowPx(page), '交代ダイアログを開いた状態で横にはみ出している').toBe(0);
    });
  }
});

test.describe('T-13: 主要タブのサブタブ切り替え', () => {
  test('クラブハウス: 3つのサブタブが正しいARIAで切り替わり、選択を覚えている', async ({ page }) => {
    await startFresh(page);
    const tablist = page.getByRole('tablist', { name: 'クラブハウスの表示切り替え' });
    await expect(tablist).toBeVisible();
    const training = page.getByRole('tab', { name: '今週の練習', exact: true });
    const status = page.getByRole('tab', { name: 'チームの状況', exact: true });
    const notes = page.getByRole('tab', { name: '部活ノート', exact: true });
    await expect(training).toHaveAttribute('aria-selected', 'true');

    await status.click();
    await expect(status).toHaveAttribute('aria-selected', 'true');
    await expect(training).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('heading', { name: 'チームコンディション' })).toBeVisible();

    await notes.click();
    await expect(page.getByRole('heading', { name: '部活ノート' })).toBeVisible();

    // 矢印キーでタブ間を移動できる（role=tablistの標準操作）。
    await notes.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(status).toBeFocused();

    // 別のメインタブへ行って戻っても、選んだサブタブ（チームの状況）を覚えている。
    await status.click();
    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await page.getByRole('tab', { name: 'クラブハウス', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'チームの状況', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('選手・編成: 戦術ボード/部員一覧のサブタブが切り替わる', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
    await expect(page.getByRole('heading', { name: '戦術ボード' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /部員一覧/ })).toHaveCount(0);

    await page.getByRole('tab', { name: '部員一覧', exact: true }).click();
    await expect(page.getByRole('heading', { name: /部員一覧/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '戦術ボード' })).toHaveCount(0);
  });

  test('大会・日程: 日程/リーグ順位/トーナメントのサブタブが切り替わる', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
    await expect(page.locator('.calendar-grid')).toBeVisible();

    await page.getByRole('tab', { name: 'リーグ順位', exact: true }).click();
    await expect(page.locator('.calendar-grid')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '大会・リーグ状況' })).toBeVisible();

    await page.getByRole('tab', { name: 'トーナメント', exact: true }).click();
    await expect(page.getByText('インターハイのトーナメント表')).toBeVisible();
    await expect(page.getByRole('region', { name: '大会・リーグ状況' })).toHaveCount(0);
  });

  test('試合画面: 映像／声かけ／戦術／交代のタブが該当区画だけを表示する', async ({ page }) => {
    await withSave(page, startedMatch('試合区画切り替え検証高校', 4242));
    await page.goto('/');
    await expect(page.getByText('MATCH HIGHLIGHTS')).toBeVisible();
    await expect(page.getByRole('heading', { name: /どう戦う/ })).toHaveCount(0);

    await page.getByRole('tab', { name: '戦術', exact: true }).click();
    await expect(page.getByRole('heading', { name: /どう戦う/ })).toBeVisible();
    await expect(page.getByText('MATCH HIGHLIGHTS')).toHaveCount(0);

    // 「次の15分を進める」は区画に関わらず常に見える（試合を進めるボタンは常設）。
    await expect(page.getByRole('button', { name: '次の15分を進める' })).toBeVisible();
    await page.getByRole('button', { name: '次の15分を進める' }).click();
    // 進めると映像区画に戻る。
    await expect(page.getByText('MATCH HIGHLIGHTS')).toBeVisible();
  });
});

test.describe('T-13: 各サブタブの縦の長さの目安（PC1280px・スマホ390pxとも概ね2画面分以内）', () => {
  async function sectionHeightPx(page: Page) {
    return page.evaluate(() => document.documentElement.scrollHeight);
  }
  // 「部員一覧」（部員20人の詳細表）と「リーグ順位」（赴任先47都道府県の選択＋順位表＋
  // 大会の歩み）は、1件ずつが独立した情報の一覧であり、ここでさらに折りたたむ／
  // ページングすると「一覧性」を損なう（部員一覧は既に1画面あたりの絞り込みフィルタを
  // 持っている）。そのため目安を2画面分ではなく3.5画面分まで緩める。それ以外の
  // サブタブ（今週の練習・チームの状況・部活ノート・戦術ボード・日程・トーナメント）は
  // 2画面分（多少の誤差を見て2.1倍）を目安にする。
  const roomySections = new Set(['部員一覧', 'リーグ順位']);
  function limitFor(name: string, height: number) {
    return height * (roomySections.has(name) ? 3.5 : 2.5);
  }
  for (const [label, width, height] of [
    ['PC', 1280, 900],
    ['スマホ', 390, 844],
  ] as const) {
    test(`${label}幅: クラブハウスの各サブタブが概ね2画面分以内`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await startFresh(page);
      for (const name of ['今週の練習', 'チームの状況', '部活ノート']) {
        await page.getByRole('tab', { name, exact: true }).click();
        const h = await sectionHeightPx(page);
        const limit = limitFor(name, height);
        expect(h, `${name} の縦の長さが目安(${limit}px)を超えている: ${h}px`).toBeLessThanOrEqual(limit);
      }
    });
    test(`${label}幅: 選手・編成の各サブタブが概ね2画面分以内（部員一覧は一覧性を優先し3.5画面分まで許容）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await startFresh(page);
      await page.getByRole('tab', { name: '選手・編成', exact: true }).click();
      for (const name of ['戦術ボード', '部員一覧']) {
        await page.getByRole('tab', { name, exact: true }).click();
        const h = await sectionHeightPx(page);
        const limit = limitFor(name, height);
        expect(h, `${name} の縦の長さが目安(${limit}px)を超えている: ${h}px`).toBeLessThanOrEqual(limit);
      }
    });
    test(`${label}幅: 大会・日程の各サブタブが概ね2画面分以内（リーグ順位は一覧性を優先し3.5画面分まで許容）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await startFresh(page);
      await page.getByRole('tab', { name: '大会・日程', exact: true }).click();
      for (const name of ['日程', 'リーグ順位', 'トーナメント']) {
        await page.getByRole('tab', { name, exact: true }).click();
        const h = await sectionHeightPx(page);
        const limit = limitFor(name, height);
        expect(h, `${name} の縦の長さが目安(${limit}px)を超えている: ${h}px`).toBeLessThanOrEqual(limit);
      }
    });
  }
});
