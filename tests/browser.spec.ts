import {test,expect,type Page} from '@playwright/test';
// W3日常イベント: 「試合の無い週」に確率で学校生活イベントが発生し、選択肢を選ぶまで
// 次の練習に進めない仕様（lib/game.ts の 'train' ガード）。ブラウザ操作テストでは
// newGame() がUI起動時に時刻ベースのシードを使うため発生タイミングは実行ごとに変わる。
// 練習ボタンを押す前に毎回このヘルパーでイベントが出ていれば解決してから進む。
// 学校生活イベントは「情景(次へ)→場面(選択肢を選ぶ)→結果(閉じる／次の週へ)」の
// 3枚の紙芝居で、実際に確定する(onChoose相当が呼ばれる)のは3枚目の「閉じる」を
// 押した時だけ。1回のクリックでは終わらないため、パネルが消えるまで連続でクリックする。
async function resolveLifeEventIfPresent(page: Page) {
 const panel = page.getByRole('region', { name: '学校生活イベント' });
 for (let i = 0; i < 5 && (await panel.count()); i++) {
  await panel.locator('button').first().click();
 }
}
// クラブイベント（7週ごと）も同じ紙芝居形式（クラブイベント用のフォールバックは
// 1クリックで確定するが、念のため同じドレインで扱う）。
async function resolveClubEventIfPresent(page: Page) {
 const panel = page.getByRole('region', { name: 'クラブイベント' });
 for (let i = 0; i < 5 && (await panel.count()); i++) {
  await panel.locator('button').first().click();
 }
 const fallback = page.locator('.event-panel');
 if (await fallback.count()) await fallback.locator('button').first().click();
}
// W2大会・リーグ配線後は週0からU18リーグの試合が組まれているため、以前のように
// 「数週トレーニングしてから初めて試合が来る」保証は無くなった（対戦相手によっては
// 数週先まで試合が来ないこともある）。試合が保留になるまで安全に練習を繰り返すヘルパー。
async function trainUntilMatchIsPending(page: Page) {
 for (let i = 0; i < 20; i++) {
  await resolveLifeEventIfPresent(page);
  await resolveClubEventIfPresent(page);
  if (await page.getByRole('button', { name: '試合へ進む' }).count()) return;
  // S1: 日次コマンド化により、月〜土の週間メニューで日曜(試合日)まで自動進行する
  // 「試合日まで進める」ボタンを使う（生活イベント・クラブイベント・けがで途中で
  // 止まることがあるので、その都度 resolveLifeEventIfPresent 経由で解決しつつ繰り返す）。
  await page.getByRole('button', { name: '試合日まで進める' }).click();
 }
}
test('desktop: train, lineup, match, save resume, export and dialogs',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'この学校で始める'}).click();await expect(page.getByRole('heading',{name:'今日の練習',exact:true})).toBeVisible();await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 await trainUntilMatchIsPending(page);await expect(page.getByRole('button',{name:'試合へ進む'})).toBeVisible();await page.getByRole('button',{name:'試合へ進む'}).click();for(let i=0;i<3;i++)await page.getByRole('button',{name:'次の15分を進める'}).click();await expect(page.getByText('HALF TIME',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('HALF TIME',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/match.png',fullPage:true});await page.getByRole('button',{name:'後半の15分を進める'}).click();for(let i=0;i<2;i++)await page.getByRole('button',{name:'次の15分を進める'}).click();await expect(page.getByText('MATCH RESULT',{exact:true})).toBeVisible();await page.getByRole('button',{name:'部に戻る'}).click();
 await page.getByRole('tab',{name:'選手・編成'}).click();await page.getByRole('button',{name:'おすすめ編成'}).click();await expect(page.getByRole('heading',{name:/部員一覧/})).toBeVisible();await page.getByRole('button',{name:'保存・設定'}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'セーブを書き出す'}).click();expect((await download).suggestedFilename()).toContain('touchline-season');await page.keyboard.press('Escape');await page.getByRole('button',{name:'遊び方',exact:true}).click();await expect(page.getByRole('heading',{name:'監督の手引き'})).toBeVisible();expect(errors).toEqual([]);
});
test('mobile: main journey fits viewport',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'この学校で始める'}).click();await page.getByRole('radio',{name:/休養・ケア/}).check();await page.getByRole('button',{name:/で1日進める/}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/mobile.png',fullPage:true});});
test('player dialog and substitution dialog always release the page; substitutions cap at 5',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const overlay=page.locator('[data-slot="dialog-overlay"]');
 await page.goto('/');await page.getByRole('button',{name:'この学校で始める'}).click();
 await page.locator('.pitch-player').first().click();await expect(page.getByText('PLAYER PROFILE',{exact:false})).toBeVisible();await page.keyboard.press('Escape');await expect(overlay).toHaveCount(0);
 await trainUntilMatchIsPending(page);
 await page.getByRole('button',{name:'試合へ進む'}).click();
 // 交代フロー: 「交代する選手を選ぶ」→ 下げる選手（ピッチ）→ 入れる選手（ベンチ）→ 予約に追加 → まとめて確定。
 // S3: 交代は最大5人（旧仕様の3人から拡大）。上限検証の意図はここでも維持する。
 for(let n=0;n<5;n++){
  await page.getByRole('button',{name:'交代する選手を選ぶ'}).click();
  await expect(overlay).toHaveCount(1);
  const columns=page.locator('.sub-column');
  await columns.nth(0).locator('.sub-pick').first().click();
  await columns.nth(1).locator('.sub-pick:not([aria-disabled="true"])').first().click();
  // T1: 組は一度「予約に追加」してから、まとめて確定する。
  await page.getByRole('button',{name:'予約に追加'}).click();
  await page.getByRole('button',{name:'1人の交代を確定'}).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByText(`交代 ${n+1} / 5`).first()).toBeVisible();
 }
 // D2a: disabledではなくaria-disabledで見た目だけ落ち着かせる（実DOMのdisabledは使わない）。
 const openBtn = page.getByRole('button',{name:'交代する選手を選ぶ'});
 await expect(openBtn).toHaveAttribute('aria-disabled','true');
 expect(await openBtn.evaluate((el)=>(el as HTMLButtonElement).disabled)).toBe(false);
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'次の15分を進める'}).click();
 await expect(page.getByText('HALF TIME',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});
