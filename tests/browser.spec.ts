import {test,expect} from '@playwright/test';
test('desktop: train, lineup, match, save resume, export and dialogs',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'この学校で始める'}).click();await expect(page.getByRole('heading',{name:'今週の練習',exact:true})).toBeVisible();await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'この練習で1週間進める'}).click();await expect(page.getByRole('button',{name:'試合へ進む'})).toBeVisible();await page.getByRole('button',{name:'試合へ進む'}).click();for(let i=0;i<3;i++)await page.getByRole('button',{name:'次の15分を進める'}).click();await expect(page.getByText('HALF TIME',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('HALF TIME',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/match.png',fullPage:true});await page.getByRole('button',{name:'後半の15分を進める'}).click();for(let i=0;i<2;i++)await page.getByRole('button',{name:'次の15分を進める'}).click();await page.getByRole('button',{name:'結果を確定して部に戻る'}).click();
 await page.getByRole('tab',{name:'選手・編成'}).click();await page.getByRole('button',{name:'おすすめ編成'}).click();await expect(page.getByRole('heading',{name:/部員一覧/})).toBeVisible();await page.getByRole('button',{name:'保存・設定'}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'セーブを書き出す'}).click();expect((await download).suggestedFilename()).toContain('touchline-season');await page.keyboard.press('Escape');await page.getByRole('button',{name:'遊び方',exact:true}).click();await expect(page.getByRole('heading',{name:'監督の手引き'})).toBeVisible();expect(errors).toEqual([]);
});
test('mobile: main journey fits viewport',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'この学校で始める'}).click();await page.getByRole('radio',{name:/休養・ケア/}).check();await page.getByRole('button',{name:'この練習で1週間進める'}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/mobile.png',fullPage:true});});
test('player dialog always releases the page: profile close and in-match substitution',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const overlay=page.locator('[data-slot="dialog-overlay"]');
 await page.goto('/');await page.getByRole('button',{name:'この学校で始める'}).click();
 await page.locator('.pitch-player').first().click();await expect(page.getByText('PLAYER PROFILE',{exact:false})).toBeVisible();await page.keyboard.press('Escape');await expect(overlay).toHaveCount(0);
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'この練習で1週間進める'}).click();
 await page.getByRole('button',{name:'試合へ進む'}).click();
 await page.locator('.bench > button:not([disabled])').first().click();await expect(overlay).toHaveCount(1);
 await page.locator('.assignment:not([disabled])').last().click();await expect(overlay).toHaveCount(0);
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'次の15分を進める'}).click();
 await expect(page.getByText('HALF TIME',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});
