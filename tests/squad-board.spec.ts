import { test, expect, type Page } from '@playwright/test';
import { newGame, type State } from '../lib/game';

// ユーザー要望（2026-09-26）: 戦術ボードに「現在のフォーメーションで習熟度D以上の
// 候補がAチームにいない枠」を知らせる表示を追加した（lib/squad.ts の thinSlots）。
// ここではUI側の検証（表示が出る／出ない・切り替えで消える）だけを行う。
// thinSlots 自体の判定ロジックは tests/lineup-policy.test.ts で検証済み。
async function withSave(page: Page, s: State) {
  await page.addInitScript(
    (value) => localStorage.setItem('touchline-academy-v1', JSON.stringify(value)),
    s,
  );
}

test('戦術ボード: 4-3-3で右ウイングにD以上の候補がいないと注意表示が出て、枠のない4-4-2に切り替えると消える', async ({
  page,
}) => {
  const s = newGame('手薄枠検証高校', 1);
  s.formation = '4-3-3';
  for (const p of s.players) {
    const ps = s.v3.squad.players[p.id];
    if (ps && (ps.prof.RWG ?? 0) >= 50) ps.prof.RWG = 30;
  }
  await withSave(page, s);
  await page.goto('/');
  await page.getByRole('tab', { name: '選手・編成', exact: true }).click();

  const warning = page.locator('.thin-slots-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('右ウイング');
  await expect(warning).toContainText('習熟度D以上の選手がいません');
  // 色だけに頼らないことの最低限の確認: アイコン（svg）も一緒に出ている。
  await expect(warning.locator('svg')).toBeVisible();
  // <output> 要素（既定で role="status" 相当）で読み上げられること。
  await expect(page.getByRole('status').filter({ hasText: '右ウイング' })).toBeVisible();

  // 4-4-2 には右ウイングの枠が無いため、切り替えると注意表示が消える。
  await page.getByRole('radio', { name: '4-4-2', exact: true }).check();
  await expect(warning).toHaveCount(0);

  // 4-3-3 に戻すと再び表示される（フォーメーション変更直後に更新される）。
  await page.getByRole('radio', { name: '4-3-3', exact: true }).check();
  await expect(page.locator('.thin-slots-warning')).toBeVisible();
});

test('戦術ボード: 全ポジションにD以上の候補がいれば注意表示は出ない', async ({ page }) => {
  const s = newGame('手薄枠なし検証高校', 2);
  s.formation = '4-3-3';
  await withSave(page, s);
  await page.goto('/');
  await page.getByRole('tab', { name: '選手・編成', exact: true }).click();

  await expect(page.locator('.thin-slots-warning')).toHaveCount(0);
});
