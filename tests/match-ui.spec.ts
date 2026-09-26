import { test, expect, type Page } from '@playwright/test';
import { newGame, act, type State } from '../lib/game';
import { getCurrentLifeEvent } from '../lib/school-life';

// T1: 試合UIの刷新（まとめて交代・適性表示）と試合後の結果画面の検証。
// UI操作を高速化するため、lib/game.ts の act() を直接呼んで「試合開始直後」
// 「試合終了直後」の State を作り、localStorage にあらかじめ書き込んでからページを開く
// （development.spec.ts と同じ手法）。S1で日次コマンド化されたため、週3(必ずU18リーグの
// 試合がある週)の試合日まで日次で進める必要があるが、途中で学校生活イベントが出ても
// 先頭の選択肢で即解決するだけなので、結果として得られる「試合開始直後」の状態には影響しない。
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

test('substitution dialog: reserve one pair, cancel resets, and confirming the batch applies it and updates the cap', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('交代検証高校', 4242));
  await page.goto('/');
  await expect(page.getByText('交代 0 / 5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  const overlay = page.locator('[data-slot="dialog-overlay"]');
  await expect(overlay).toHaveCount(1);

  const columns = page.locator('.sub-column');
  const pitchPick = columns.nth(0).locator('.sub-pick').first();
  const benchPick = columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first();

  // 「予約に追加」は、下げる選手・入れる選手の両方を選ぶまでは表示されない。
  await expect(page.getByRole('button', { name: '予約に追加' })).toHaveCount(0);
  await pitchPick.click();
  await expect(pitchPick).toHaveClass(/selected/);
  await benchPick.click();
  await expect(benchPick).toHaveClass(/selected/);
  const addBtn = page.getByRole('button', { name: '予約に追加' });
  await expect(addBtn).toBeEnabled();

  // 「選び直す」で確定前ならいつでも取り消せる。
  await page.getByRole('button', { name: '選び直す' }).click();
  await expect(page.getByRole('button', { name: '予約に追加' })).toHaveCount(0);
  await expect(pitchPick).not.toHaveClass(/selected/);

  // 選び直して今度は予約に追加する。まだ交代は成立しない（予約段階）。
  await pitchPick.click();
  await benchPick.click();
  const incomingName = await benchPick.locator('.sub-pick-name').innerText();
  await page.getByRole('button', { name: '予約に追加' }).click();
  await expect(overlay).toHaveCount(1);
  await expect(page.locator('.sub-reserved-row')).toHaveCount(1);
  await expect(page.getByText('交代 0 / 5', { exact: true })).toBeVisible();

  // まとめて確定すると、はじめて既存の swap が発行され、交代数が増える。
  await page.getByRole('button', { name: '1人の交代を確定' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByText('交代 1 / 5')).toBeVisible();
  // 交代した選手が、今度はピッチ側の一覧に現れる。
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  await expect(columns.nth(0).getByText(incomingName, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('batch substitution: reserving several pairs and confirming once increases the sub count by that many', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('まとめて交代検証高校', 91011));
  await page.goto('/');

  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  const overlay = page.locator('[data-slot="dialog-overlay"]');
  const columns = page.locator('.sub-column');

  // 1組目: ピッチ1人目 → ベンチの空いている先頭。
  await columns.nth(0).locator('.sub-pick').first().click();
  await columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first().click();
  await page.getByRole('button', { name: '予約に追加' }).click();
  await expect(page.locator('.sub-reserved-row')).toHaveCount(1);

  // 2組目: ピッチ2人目 → ベンチの（1組目を除いた）空いている先頭。
  await columns.nth(0).locator('.sub-pick').nth(1).click();
  await columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first().click();
  await page.getByRole('button', { name: '予約に追加' }).click();
  await expect(page.locator('.sub-reserved-row')).toHaveCount(2);
  await expect(page.getByText('交代 0 / 5（予約 2）')).toBeVisible();

  await page.getByRole('button', { name: '2人の交代を確定' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByText('交代 2 / 5')).toBeVisible();
  expect(errors).toEqual([]);
});

test('batch substitution: a reservation can be withdrawn individually before confirming', async ({
  page,
}) => {
  await withSave(page, startedMatch('予約取消検証高校', 20260923));
  await page.goto('/');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  const columns = page.locator('.sub-column');
  await columns.nth(0).locator('.sub-pick').first().click();
  await columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first().click();
  await page.getByRole('button', { name: '予約に追加' }).click();
  await expect(page.locator('.sub-reserved-row')).toHaveCount(1);

  await page.locator('.sub-reserved-remove').first().click();
  await expect(page.locator('.sub-reserved-row')).toHaveCount(0);
  // 予約が0件のときは、確定ボタンを押しても何も起きない旨の案内が出る。
  await expect(page.getByText('交代する組を選んで「予約に追加」してから確定してください。')).toBeVisible();
});

test('substitution cap: a sixth reservation is blocked with a reason once the 5-sub cap (including pending reservations) is reached', async ({
  page,
}) => {
  await withSave(page, startedMatch('交代上限検証高校', 777));
  await page.goto('/');
  const overlay = page.locator('[data-slot="dialog-overlay"]');
  const columns = page.locator('.sub-column');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  // 5組を予約する（ピッチの先頭5人 → 毎回、空いているベンチの先頭）。
  for (let n = 0; n < 5; n++) {
    await columns.nth(0).locator('.sub-pick').nth(n).click();
    await columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first().click();
    await page.getByRole('button', { name: '予約に追加' }).click();
  }
  await expect(page.locator('.sub-reserved-row')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '5人の交代を確定' })).toBeVisible();

  // 6組目を選ぼうとしても、予約枠を使い切った理由が表示され、予約は増えない。
  // 枠を使い切ると選手ボタンは aria-disabled になる（DADS: 押せるまま理由を示す）。Playwright は
  // aria-disabled を無効扱いして待ち続けるため force で押し、理由が出ることを確かめる。
  await columns.nth(0).locator('.sub-pick').nth(5).click({ force: true });
  await columns.nth(1).locator('.sub-pick').first().click({ force: true });
  await expect(page.getByText('交代枠（5人）を使い切りました（予約中5人を含む）。')).toBeVisible();
  await page.getByRole('button', { name: '予約に追加' }).click({ force: true });
  await expect(page.locator('.sub-reserved-row')).toHaveCount(5);

  // まとめて確定すると5件とも成立し、以降は新たな交代を選べない旨が出る。
  await page.getByRole('button', { name: '5人の交代を確定' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByText('交代 5 / 5').first()).toBeVisible();
  const openBtn = page.getByRole('button', { name: '交代する選手を選ぶ' });
  await expect(openBtn).toHaveAttribute('aria-disabled', 'true');
  expect(await openBtn.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
  await openBtn.click({ force: true });
  await expect(overlay).toHaveCount(1);
  await expect(page.getByText('交代枠を使い切りました。')).toBeVisible();
});

test('substitution dialog: picking an outgoing player shows bench proficiency ranks sorted from the best fit down', async ({
  page,
}) => {
  await withSave(page, startedMatch('適性表示検証高校', 3131));
  await page.goto('/');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  const columns = page.locator('.sub-column');

  // 下げる選手を選ぶ前は、ピッチ側にも自分の適性ランクが大きく表示されている。
  await expect(columns.nth(0).locator('.sub-pick').first().locator('.rank-badge.rank-lg')).toBeVisible();

  await columns.nth(0).locator('.sub-pick').first().click();
  const benchRanks = columns.nth(1).locator('.sub-pick .rank-badge.rank-lg');
  const count = await benchRanks.count();
  expect(count).toBeGreaterThan(0);
  const titles = await benchRanks.evaluateAll((els) =>
    els.map((el) => el.getAttribute('title') ?? ''),
  );
  const values = titles.map((t) => Number(/能力値(\d+)/.exec(t)?.[1] ?? '-1'));
  expect(values.every((v) => v >= 0)).toBe(true);
  const sorted = [...values].sort((a, b) => b - a);
  expect(values).toEqual(sorted);
});

test('substitution: outgoing banner, reservation row and post-confirm pitch view all show the position involved', async ({
  page,
}) => {
  // 回帰テスト: 交代時に下げる選手のポジションが分からなくなる不具合の修正。
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('ポジション表示検証高校', 424242));
  await page.goto('/');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  const columns = page.locator('.sub-column');
  const pitchPick = columns.nth(0).locator('.sub-pick').first();

  // ピッチ上の選手の各行に、習熟度ランクとは別枠でポジション名の見出しが出る。
  await expect(pitchPick.locator('.position.detail-badge')).toBeVisible();

  const outName = await pitchPick.locator('.sub-pick-name').innerText();
  await pitchPick.click();
  // 下げる選手を選ぶと、ダイアログ上部にポジション付きで明示される。
  const banner = page.locator('.sub-outgoing-banner');
  await expect(banner).toContainText(outName);
  await expect(banner).toContainText('を下げる');
  await expect(banner).toContainText('（');

  // ベンチ側にも、どの枠に入るのかが習熟度と一緒に文字で示される。
  const benchPick = columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first();
  await expect(benchPick.locator('.sub-pick-meta')).toContainText('に入った場合の習熟度');
  await benchPick.click();
  await page.getByRole('button', { name: '予約に追加' }).click();

  // 予約リストの行:「枠のポジション名：下げる選手 → 入れる選手（習熟度 X）」の形。
  const reservedRow = page.locator('.sub-reserved-row').first();
  await expect(reservedRow).toContainText('：');
  await expect(reservedRow).toContainText('→');
  await expect(reservedRow).toContainText('習熟度');

  await page.getByRole('button', { name: '1人の交代を確定' }).click();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);

  // 交代確定後、試合画面のピッチ図に入った選手のポジション略号と交代出場の印が残る。
  await expect(page.locator('.pitch-slot').first()).toBeVisible();
  await expect(page.locator('.pitch-sub-mark')).toHaveCount(1);

  // 交代ダイアログを開き直しても、その選手の行にポジション名の見出しが残る。
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  await expect(columns.nth(0).getByText('交代出場')).toBeVisible();
  expect(errors).toEqual([]);
});

test('match result screen: shows ratings for every player who appeared, MOTM matches the top rating, timeline and growth, then returns to the clubhouse', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, finishedMatch('結果画面検証高校', 99001));
  await page.goto('/');
  await expect(page.getByText('MATCH RESULT', { exact: true })).toBeVisible();
  // スタッツ比較（シュート・得点期待値・保持率）は結果画面の見出しに表示される。
  const matchStats = page.locator('.match-stats');
  await expect(matchStats.getByText('シュート', { exact: false })).toBeVisible();
  await expect(matchStats.getByText('得点期待値', { exact: false })).toBeVisible();
  await expect(matchStats.getByText('ボール保持', { exact: false })).toBeVisible();

  // 評価点: 出場した選手の行が複数あり、それぞれ10点満点の数値が付く。
  const ratingRows = page.locator('.mr-rating-row');
  const rowCount = await ratingRows.count();
  expect(rowCount).toBeGreaterThanOrEqual(11);
  const ratingValues = await page.locator('.mr-rating-value').evaluateAll((els) =>
    els.map((el) => Number(el.textContent)),
  );
  for (const v of ratingValues) {
    expect(v).toBeGreaterThanOrEqual(3);
    expect(v).toBeLessThanOrEqual(10);
  }
  // 評価点は高い順に並び、1位が MOTM と一致する。
  const sorted = [...ratingValues].sort((a, b) => b - a);
  expect(ratingValues).toEqual(sorted);
  await expect(page.locator('.mr-rating-top')).toHaveCount(1);
  const topName = await page.locator('.mr-rating-top .mr-rating-name').innerText();
  await expect(page.locator('.motm-card')).toBeVisible();
  const motmName = await page.locator('.motm-card b').first().innerText();
  expect(topName.replace(/\s+/g, ' ').trim().startsWith(motmName)).toBe(true);
  await expect(page.locator('.motm-card p').first()).not.toBeEmpty();

  // M2: 評価点の行にも「この試合で伸びた能力」が添えられ、評価点順のままなので
  // 活躍した（評価点の高い）選手ほど伸びていることが一目で分かる。
  await expect(page.locator('.mr-rating-growth').first()).toBeVisible();

  // タイムライン。
  await expect(page.getByRole('heading', { name: 'タイムライン' })).toBeVisible();
  // 成長差分：全員が出場したので、少なくとも精神力+0.5などの変化が1人以上に出る。
  await expect(page.getByRole('heading', { name: '選手の成長' })).toBeVisible();
  await expect(page.locator('.growth-row').first()).toBeVisible();
  await expect(
    page.getByText('この試合の成長記録はありません', { exact: false }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '部に戻る' }).click();
  await expect(page.getByText('MATCH RESULT', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '今日の練習', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('match cinema: only one .cinema section renders while the match is live', async ({
  page,
}) => {
  // 回帰テスト: MatchCinema の key（m.minute）が、試合終了後は結果画面に置き換わって
  // 描画されなくなったため、生きている間だけ .cinema が常にちょうど1つであることを確認する。
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('試合図重複検証高校', 2024));
  await page.goto('/');
  await expect(page.locator('.cinema')).toHaveCount(1);

  const advance = page.getByRole('button', { name: /次の15分を進める|後半の15分を進める/ });
  await advance.click();
  await expect(page.locator('.cinema')).toHaveCount(1);
  // 古いキックオフ前の空表示が残っていないこと（シュートの無い15分に出る正しい空表示は許容）。
  await expect(page.locator('.cinema')).not.toContainText('キックオフの笛を待つ');

  await advance.click();
  await expect(page.locator('.cinema')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('mobile 390px: substitution dialog and match result fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withSave(page, startedMatch('モバイル交代検証高校', 555));
  await page.goto('/');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();
  await expect(page.locator('.sub-column').first()).toBeVisible();
  // 押しやすさ: 選手選択ボタンは44px以上の高さを確保する。
  const box = await page.locator('.sub-pick').first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');

  await withSave(page, finishedMatch('モバイル結果検証高校', 556));
  await page.goto('/');
  await expect(page.getByText('MATCH RESULT', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/match-result-mobile.png', fullPage: true });
});

test('T-10: mobile shootout lets the manager choose a kicker, saves each kick and shows the result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let s = newGame('PK画面検証高校', 5);
  s.day = 6;
  s.pending = { label: '県予選', kind: 'summer', round: 0, strength: 50, opponent: '架空高校', style: 'balanced' };
  s = act(s, { type: 'start' });
  while (!s.match!.pk) s = act(s, { type: 'segment' });
  const firstKicker = s.players.find((p) => p.id === s.lineup[9])!;
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)), s);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PK戦', exact: true })).toBeVisible();
  await page.getByRole('button', { name: firstKicker.name, exact: true }).click();
  await expect(page.getByText(`1番手：${firstKicker.name}`)).toBeVisible();
  await page.getByRole('button', { name: 'PK戦を始める' }).click();
  await expect(page.locator('.pk-kicks li')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.pk-kicks li')).toHaveCount(1);
  for (let i = 0; i < 30 && !(await page.getByText('MATCH RESULT', { exact: true }).count()); i++) {
    await page.getByRole('button', { name: '次のキックへ' }).click();
  }
  await expect(page.getByRole('heading', { name: 'PK戦の記録' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('T-10: extra time remains playable with tactics until 120 minutes', async ({ page }) => {
  // シード4: 90分で同点→延長後半で決着（PKにならない）。T-5で得点率が変わり乱数の進み方が変わったため
  // シード3から差し替え（検索条件は「6区間で未決着、8区間で決着かつPKなし」）。
  let s = newGame('延長画面検証高校', 4);
  s.day = 6;
  s.pending = { label: '県予選', kind: 'summer', round: 0, strength: 50, opponent: '架空高校', style: 'balanced' };
  s = act(s, { type: 'start' });
  for (let i = 0; i < 6; i++) s = act(s, { type: 'segment' });
  expect(s.match!.done).toBe(false);
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)), s);
  await page.reload();
  await expect(page.getByText('EXTRA TIME', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '延長前半を進める' }).click();
  await expect(page.getByRole('button', { name: '延長後半を進める' })).toBeVisible();
  await page.getByRole('button', { name: '延長後半を進める' }).click();
  await expect(page.getByText('MATCH RESULT', { exact: true })).toBeVisible();
  await expect(page.getByText('延長戦：120分まで実施')).toBeVisible();
});

// ---------------------------------------------------------------------------
// M2: 交代画面の「習熟度」ラベルと凡例。
// ---------------------------------------------------------------------------
test('substitution dialog: shows a "習熟度" label next to the rank badges and a legend explaining it is not ability', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, startedMatch('習熟度ラベル検証高校', 777));
  await page.goto('/');
  await page.getByRole('button', { name: '交代する選手を選ぶ' }).click();

  // 画面上部の凡例: ランクの意味（能力の高さではないこと）とピッチ/ベンチでの意味の違い。
  const legend = page.locator('.sub-rank-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('能力の高さではありません');
  await expect(legend).toContainText('今いる枠への慣れ');
  await expect(legend).toContainText('入った場合の慣れ');

  // バッジの横（上）に「習熟度」の文字ラベルが付き、能力ランクと見分けられる。
  await expect(page.locator('.sub-pick-rank-label').first()).toHaveText('習熟度');
  const labelCount = await page.locator('.sub-pick-rank-label').count();
  expect(labelCount).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// M2: 試合結果画面のスタッツ表。
// ---------------------------------------------------------------------------
test('match result screen: stats table switches columns per category and totals match the team record', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withSave(page, finishedMatch('スタッツ表検証高校', 31415));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '選手ごとのスタッツ' })).toBeVisible();

  // 部門別の最多の見出し。
  await expect(page.getByRole('heading', { name: '部門別の最多' })).toBeVisible();

  // 既定は「攻撃」区分: 得点列がある。
  await expect(page.getByRole('columnheader', { name: /得点/ })).toBeVisible();
  const scoreText = await page.locator('.mr-scoreline strong').innerText();
  const ownScore = Number(scoreText.split('-')[0].trim());
  const goalCells = page.locator('.mr-stats table tbody tr td:nth-child(4)');
  const goalTexts = await goalCells.allTextContents();
  const goalSum = goalTexts.reduce((a, t) => a + Number(t), 0);
  // 選手の得点列の合計はスコア（自チーム視点）と一致する（DESIGN_V3_4.md 2.1）。
  expect(goalSum).toBe(ownScore);

  // 区分を「パス」に切り替えると列が変わる（得点列は消え、パス成功率などが出る）。
  await page.getByRole('radio', { name: 'パス', exact: true }).check();
  await expect(page.getByRole('columnheader', { name: /得点/ })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'パス成功率', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /キーパス/ })).toBeVisible();

  // 「守備」「GK」「フィジカル」でも列が切り替わる。
  await page.getByRole('radio', { name: '守備', exact: true }).check();
  await expect(page.getByRole('columnheader', { name: /デュエル/ })).toBeVisible();
  await page.getByRole('radio', { name: 'GK', exact: true }).check();
  await expect(page.getByRole('columnheader', { name: /セーブ/ })).toBeVisible();
  await page.getByRole('radio', { name: 'フィジカル', exact: true }).check();
  await expect(page.getByRole('columnheader', { name: /走行距離/ })).toBeVisible();

  // チームスタッツ比較にパス数・パス成功率・デュエル勝率が追加されている。
  const matchStats = page.locator('.mr-head .match-stats');
  await expect(matchStats.getByText('パス数', { exact: false })).toBeVisible();
  await expect(matchStats.getByText('パス成功率', { exact: false })).toBeVisible();
  await expect(matchStats.getByText('デュエル勝率', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('match result screen: shows an explanatory message instead of the stats table when a legacy save has no player stats', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // v3.4より前に始まった試合途中のセーブを模す（m.playerStats／opponentTotalsが無い）。
  const s = finishedMatch('旧セーブ互換検証高校', 2024);
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.match.playerStats;
  delete legacy.match.opponentTotals;
  await withSave(page, legacy);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '選手ごとのスタッツ' })).toBeVisible();
  await expect(page.getByText('この試合は選手別の記録がありません。')).toBeVisible();
  await expect(page.locator('.mr-stats table')).toHaveCount(0);
  // 評価点自体は旧式の簡易計算にフォールバックして表示され続ける。
  await expect(page.locator('.mr-rating-row').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile 375px: match result stats table scrolls within itself without widening the page', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await withSave(page, finishedMatch('375px結果検証高校', 88));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '選手ごとのスタッツ' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  // 表自体は横スクロールできるコンテナに入っている（DADS: 表内スクロール）。
  const tableContainer = page.locator('.mr-stats [data-slot="table-container"]');
  await expect(tableContainer).toHaveCount(1);
  expect(errors).toEqual([]);
});
