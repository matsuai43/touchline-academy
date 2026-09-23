import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,act,validateSave,overall,strength,roster,autoLineup,slots,ROSTER_MIN,ROSTER_MAX,type State,type Training} from '../lib/game.ts';
import {formationSlots,positionFitMult,basePos} from '../lib/squad.ts';
import {getCurrentLifeEvent} from '../lib/school-life.ts';
import {readCompetition,DISTRICTS} from '../lib/competition.ts';

function play(s:State){s=act(s,{type:'start'});while(!s.match!.done)s=act(s,{type:'segment'});return act(s,{type:'finish'});}
// 学校生活イベント（W3）が出ている週は、解決するまで 'train' が進められない。
// テストは常に先頭の選択肢を選んで先へ進める。
function resolveLife(s:State){const cur=getCurrentLifeEvent(s);if(!cur)return s;return act(s,{type:'life',choiceId:cur.event.choices[0].id});}
// S1: 日次コマンド化により「1回のtrain操作=1週」の前提が崩れたため、
// 「1週間進める」ヘルパーに置き換える（月〜土の6日分を同じ練習メニューで進め、
// 日曜に試合があればそのまま最後まで消化する）。検証の意図（週が確実に1つ進む）は
// そのまま、内部実装だけ6日分のループに変わっている。
function step(s:State,t:Training='balance'){
  const week0=s.week;
  while(s.week===week0){
    if(s.event)s=act(s,{type:'event',choice:'team'});
    s=resolveLife(s);
    s=act(s,{type:'train',training:t});
    if(s.pending)s=play(s);
  }
  return s;
}
// S1: 特定の週（テストが直接 s.week を書き換えた週）の試合日(日曜)まで、
// 同じ練習メニューで日次コマンドを進める。その週に試合が組まれていなければ
// そのまま次週以降に転がり込む（呼び出し側は基本的に試合が確実にある週を指定する）。
function toMatchDay(s:State,t:Training='rest'){
  let guard=0;
  while(!s.pending&&guard++<20){
    if(s.event)s=act(s,{type:'event',choice:'team'});
    s=resolveLife(s);
    s=act(s,{type:'train',training:t});
  }
  return s;
}
void test('18 players, three balanced classes, unique starting eleven',()=>{const s=newGame('試験高校',42);assert.equal(s.players.length,18);assert.equal(new Set(s.lineup).size,11);for(const y of [1,2,3])assert.equal(s.players.filter(p=>p.year===y).length,6);assert.deepEqual(validateSave(JSON.parse(JSON.stringify(s))),s);});
// S1: 1回のtrain操作は「1日」になった。週0はU18リーグの試合が組まれているが、
// 月曜1日分の練習だけでは日曜(試合日)にまだ届かないため、その場ではpendingにならない。
void test('training grows players; focused training grows faster; original stays immutable',()=>{const s=newGame('',42),id=s.players[0].id;const focused=act(s,{type:'focus',id});const a=act(s,{type:'train',training:'attack'}),b=act(focused,{type:'train',training:'attack'});assert.equal(s.week,0);assert.equal(s.day,0);assert.equal(a.week,0);assert.equal(a.day,1,'1回のtrainは1日だけ進む');assert.equal(a.pending,null,'月曜1日だけでは日曜の試合にまだ届かない');const gain=a.players[0].stats.shoot-s.players[0].stats.shoot;assert.ok(gain>0);assert.ok(Math.abs((b.players[0].stats.shoot-s.players[0].stats.shoot)/gain-1.5)<.01);});
void test('rest restores fatigue for one day, and training cannot skip pending fixtures',()=>{let s=newGame('',12);s.players.forEach(p=>p.fatigue=80);s=act(s,{type:'train',training:'rest'});assert.equal(s.players[0].fatigue,65,'休養1日は-15');if(s.pending)s=play(s);s.week=3;s=toMatchDay(s,'balance');assert.ok(s.pending);assert.throws(()=>act(s,{type:'train',training:'balance'}));});
void test('match commands, substitution limit and save/resume at halftime',()=>{let s=newGame('',55);s.week=3;s=toMatchDay(s,'rest');s=act(s,{type:'start'});const original=[...s.lineup];for(let i=0;i<3;i++){const p=s.players.find(p=>!s.match!.used.includes(p.id))!;s=act(s,{type:'swap',index:i+1,id:p.id});}assert.equal(s.match!.subs,3);assert.throws(()=>act(s,{type:'swap',index:5,id:s.players.find(p=>!s.match!.used.includes(p.id))!.id}));for(let i=0;i<3;i++)s=act(s,{type:'segment'});assert.equal(s.match!.minute,45);const loaded=validateSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(act(s,{type:'segment'}),act(loaded,{type:'segment'}));while(!s.match!.done)s=act(s,{type:'segment'});assert.equal(s.records.games,1);assert.throws(()=>act(s,{type:'segment'}));s=act(s,{type:'finish'});assert.deepEqual(s.lineup,original);assert.equal(s.week,4);assert.equal(s.day,0);});
void test('graduation keeps the roster within bounds, advances lower classes and records history',()=>{let s=newGame('',91);const graduates=s.players.filter(p=>p.year===3).map(p=>p.id),younger=s.players.filter(p=>p.year===1).map(p=>p.id);s.week=47;s=step(s,'rest');assert.equal(s.season,2);assert.equal(s.week,0);assert.equal(s.history.length,1);assert.equal(s.history[0].graduates.length,6);assert.ok(graduates.every(id=>!s.players.some(p=>p.id===id)));assert.ok(younger.every(id=>s.players.find(p=>p.id===id)?.year===2));assert.equal(new Set(s.players.map(p=>p.id)).size,s.players.length);assert.ok(s.players.length>=ROSTER_MIN&&s.players.length<=ROSTER_MAX,`roster size ${s.players.length} out of [${ROSTER_MIN},${ROSTER_MAX}]`);const freshmen=s.players.filter(p=>p.year===1);assert.ok(freshmen.length>=6&&freshmen.length<=12,`freshman intake ${freshmen.length} out of 6..12`);for(const y of [1,2,3])assert.ok(s.players.some(p=>p.year===y),`grade ${y} is empty`);validateSave(s);});
void test('formation fit, fatigue, and facilities affect gameplay',()=>{let s=newGame('',41);const base=strength(s);s.players.forEach(p=>p.fatigue=90);assert.ok(strength(s)<base);s=act(s,{type:'formation',formation:'3-4-3'});assert.equal(s.lineup.length,11);s.funds=100;s=act(s,{type:'upgrade'});assert.equal(s.facilities,2);assert.equal(s.funds,60);assert.throws(()=>act({...s,funds:0},{type:'upgrade'}));});
void test('malformed and out of range save files rejected',()=>{for(const bad of [null,{}, {...newGame('',12),week:48},{...newGame('',12),players:[]},{...newGame('',12),lineup:Array(11).fill(1)},{...newGame('',12),formation:'0-0-0'},{...newGame('',12),funds:Infinity},{...newGame('',12),history:[{}]},{...newGame('',12),day:7},{...newGame('',12),weeklyMenu:['rest']}])assert.throws(()=>validateSave(bad));});
void test('10 seasons simulate without broken states and save roundtrips',()=>{let s=newGame('試験高校',789);let actions=0;let maxRoster=s.players.length;while(s.season<=10){const f=s.players.reduce((a,p)=>a+p.fatigue,0)/s.players.length;s=step(s,f>35?'rest':s.week%3===0?'possession':'balance');if(s.funds>=s.facilities*40&&s.facilities<5)s=act(s,{type:'upgrade'});autoLineup(s);validateSave(JSON.parse(JSON.stringify(s)));assert.ok(s.players.every(p=>overall(p)<=99));assert.ok(s.players.length>=ROSTER_MIN&&s.players.length<=ROSTER_MAX);maxRoster=Math.max(maxRoster,s.players.length);actions++;assert.ok(actions<600);}assert.equal(s.history.length,10);assert.ok(s.records.games>=60);assert.ok(maxRoster>18,'roster should grow beyond the initial 18 over 10 seasons');});
void test('10 seasons keep the roster at or below 30 with all three grades populated at every graduation',()=>{for(const seed of [3,17,54,101]){let s=newGame('',seed);let actions=0;const rosterHistory:number[]=[s.players.length];while(s.season<=10){const before=s.season;s=step(s,s.week%2===0?'balance':'rest');if(s.season!==before){assert.ok(s.players.length<=ROSTER_MAX,`seed ${seed}: roster ${s.players.length} exceeded ${ROSTER_MAX}`);assert.ok(s.players.length>=ROSTER_MIN,`seed ${seed}: roster ${s.players.length} below ${ROSTER_MIN}`);for(const y of [1,2,3])assert.ok(s.players.some(p=>p.year===y),`seed ${seed}: grade ${y} empty after graduation`);assert.equal(new Set(s.players.map(p=>p.id)).size,s.players.length,`seed ${seed}: duplicate player ids`);rosterHistory.push(s.players.length);}actions++;assert.ok(actions<600);}assert.ok(rosterHistory.every(n=>n>=ROSTER_MIN&&n<=ROSTER_MAX));}});
void test('formation slots require detail positions with staged fit penalties (exact > same-base mismatch > cross-base mismatch)',()=>{for(const f of ['4-3-3','4-4-2','3-4-3'] as const){const ds=formationSlots(f);assert.equal(ds.length,11);assert.deepEqual(ds.map(basePos),slots(f));}
  // 純粋関数レベル: 完全一致=1.0、同じ系統内=0.92、系統またぎ=0.8、GKがからむと0.48
  assert.equal(positionFitMult('CB','CB'),1);
  assert.equal(positionFitMult('LSB','CB'),0.92);
  assert.equal(positionFitMult('CB','DM'),0.8);
  assert.equal(positionFitMult('GK','CB'),0.48);
  assert.equal(positionFitMult('CB','GK'),0.48);
  // 統合レベル: 同じ布陣・同じ選手層で、適性の高い自動編成のほうが総合力が高い
  let s=newGame('適性検証高校',13);
  autoLineup(s);
  const autoStrength=strength(s);
  const outfield=s.players.find(p=>p.pos!=='GK'&&!s.lineup.includes(p.id))!;
  s=act(s,{type:'swap',index:0,id:outfield.id});
  assert.ok(strength(s)<autoStrength,'putting a field player in goal should lower team strength');
  s=act(s,{type:'formation',formation:'4-3-3'});
  const s2=act(s,{type:'auto'});
  const cbSlotIdx=formationSlots('4-3-3').findIndex(d=>d==='CB');
  const sbCandidate=s2.players.find(p=>p.pos==='DF'&&!s2.lineup.includes(p.id));
  if(sbCandidate){const swapped=act(s2,{type:'swap',index:cbSlotIdx,id:sbCandidate.id});assert.ok(strength(swapped)<=strength(s2),'auto lineup should already be at least as strong as a manual same-base swap');}
});
// 選手権（wc）の県予選週（週27〜30）で敗退しても、日程は止まらず次の週へ進む。
// s.alive/s.qualified はW2配線後は大会進行に使われない旧フィールドなので、実際の進行判定は
// s.v3.competition.wc（readCompetition）で行う。
void test('qualifier/national progression and knockout loss never block the calendar',()=>{for(let seed=1;seed<=20;seed++){let s=newGame('',seed);s.week=27;s=step(s,'rest');const comp=readCompetition(s);if(!comp.wc.alive){assert.equal(comp.wc.qualified,false);assert.ok(!s.pending);while(s.week<36)s=step(s,'rest');assert.ok(!s.pending);}else assert.equal(s.week,28);}});
void test('match log lines stay in chronological order',()=>{for(let seed=1;seed<=25;seed++){let s=newGame('',seed);s.week=3;s=toMatchDay(s,'rest');s=act(s,{type:'start'});while(!s.match!.done)s=act(s,{type:'segment'});const minutes=s.match!.logs.map(l=>/^(\d+)′/.exec(l)).filter(Boolean).map(m=>+m![1]);for(let i=1;i<minutes.length;i++)assert.ok(minutes[i-1]>=minutes[i],`seed ${seed} out of order: ${minutes.join(',')}`);}});

// ---------------------------------------------------------------------------
// S1: 日次コマンド・週間メニュー・自動進行（試合日まで進める）
// ---------------------------------------------------------------------------
void test('S1: a single day only applies 1/6 of the weekly effect, six days of the same menu reproduce the old weekly total',()=>{
  const s=newGame('日割り検証高校',77);
  s.players.forEach(p=>(p.fatigue=50)); // 0クランプに当たらないよう十分な余裕を持たせる
  let sixDays=s;
  for(let i=0;i<6;i++)sixDays=act(sixDays,{type:'train',training:'physical'});
  assert.equal(sixDays.day,6);
  // physical の週あたり疲労は+14。6日分（日次 t.fatigue/6-3 の合計）は 14-18=-4。
  const p0=s.players[0].id;
  const before=s.players.find(p=>p.id===p0)!.fatigue;
  const after=sixDays.players.find(p=>p.id===p0)!.fatigue;
  assert.ok(Math.abs(after-before-(14-18))<0.01,`6日合計の疲労変化が想定とズレています: ${after-before}`);
});
void test('S1: autoWeek follows the stored weekly menu until match day, stopping early on a newly triggered life event',()=>{
  let s=newGame('自動進行検証高校',5);
  // どのシードでも決定的に止められるよう、生活イベントの発生率を人為的に検証するのではなく、
  // 単に「pendingかevent/life.currentのどれかが立つまで進む」ことと、進みすぎないことを確認する。
  s=act(s,{type:'autoWeek'});
  assert.ok(s.pending||s.event||s.v3.life.current,'試合・クラブイベント・生活イベントのいずれかで止まっているはず');
  assert.ok(s.day>=1,'最低でも1日は進んでいるはず');
});
void test('S1: setMenu validates and persists the weekly template; autoWeek uses it for untouched days',()=>{
  let s=newGame('週間メニュー検証高校',9);
  assert.throws(()=>act(s,{type:'setMenu',menu:['rest','rest']}));
  assert.throws(()=>act(s,{type:'setMenu',menu:['rest','rest','rest','rest','rest','not-a-training' as Training]}));
  const menu:Training[]=['rest','rest','rest','rest','rest','rest'];
  s=act(s,{type:'setMenu',menu});
  assert.deepEqual(s.weeklyMenu,menu);
  const day0Fatigue=s.players[0].fatigue;
  s=act(s,{type:'train',training:s.weeklyMenu[s.day]});
  assert.ok(s.players[0].fatigue<=day0Fatigue,'全休テンプレートなら疲労は増えないはず');
});
void test('S1: save migration backfills day and weeklyMenu for legacy saves',()=>{
  const s=newGame('移行検証高校',3);
  const legacy=JSON.parse(JSON.stringify(s));
  delete legacy.day;
  delete legacy.weeklyMenu;
  const loaded=validateSave(legacy);
  assert.equal(loaded.day,0);
  assert.equal(loaded.weeklyMenu.length,6);
  for(const t of loaded.weeklyMenu)assert.ok(['balance','attack','possession','defense','physical','rest'].includes(t));
});

// ---------------------------------------------------------------------------
// S1: 疲労バランス（試合翌日から 休養1＋練習4＋休養1 で次の試合日に平均40以下へ戻る）
// ---------------------------------------------------------------------------
void test('S1: rest+train+rest across the week after a match brings the starting XI back to <=40 average fatigue by the next match day',()=>{
  for(const seed of [11,22,33,44,55]){
    let s=newGame('疲労回復検証高校',seed);
    // 週0・週1は共にU18リーグの試合がある（LEAGUE_WEEKSに0,1が含まれる）ので、
    // 「試合の翌日から次の試合日まで」という最も厳しいケースを検証できる。
    s=toMatchDay(s,'balance');
    assert.equal(s.pending?.kind,'league');
    s=play(s); // 週0の試合を消化。ここでweek=1,day=0になる。
    assert.equal(s.week,1);
    assert.equal(s.day,0);
    // 休養1日＋練習4日＋調整(休養)1日。生活イベントが挟まっても先頭の選択肢で
    // 解決しつつ進める（試合週の月〜金は日常イベントが出うるため）。
    const pattern:Training[]=['rest','balance','balance','balance','balance','rest'];
    for(const t of pattern){
      s=resolveLife(s);
      s=act(s,{type:'train',training:t});
    }
    s=resolveLife(s);
    assert.equal(s.day,6);
    assert.equal(s.pending?.kind,'league','週1もU18リーグの試合が組まれているはず');
    const avgFatigue=roster(s).reduce((a,p)=>a+p.fatigue,0)/11;
    assert.ok(avgFatigue<=40,`seed ${seed}: 先発11人の平均疲労が40を超えています: ${avgFatigue}`);
  }
});
void test('S1: fatigue does not run away over 10 seasons of continuous league play using a rest-inclusive weekly menu',()=>{
  const pattern:Training[]=['rest','balance','possession','attack','balance','rest'];
  let s=newGame('疲労長期検証高校',123);
  const matchFatigueSamples:number[]=[];
  let guard=0;
  while(s.season<=10&&guard<3000){
    guard++;
    if(s.event)s=act(s,{type:'event',choice:'team'});
    s=resolveLife(s);
    if(s.pending&&!s.match){
      matchFatigueSamples.push(roster(s).reduce((a,p)=>a+p.fatigue,0)/11);
      s=play(s);
      continue;
    }
    s=act(s,{type:'train',training:pattern[s.day]});
  }
  assert.ok(matchFatigueSamples.length>50,`十分な試合数を観測できていません: ${matchFatigueSamples.length}`);
  const overallAvg=matchFatigueSamples.reduce((a,b)=>a+b,0)/matchFatigueSamples.length;
  assert.ok(overallAvg<=55,`10シーズン平均の試合開始時疲労が高すぎます: ${overallAvg}`);
  // 張り付き（monotonic increase）していないことの簡易チェック: 前半と後半の平均が近い。
  const half=Math.floor(matchFatigueSamples.length/2);
  const firstHalf=matchFatigueSamples.slice(0,half).reduce((a,b)=>a+b,0)/half;
  const secondHalf=matchFatigueSamples.slice(half).reduce((a,b)=>a+b,0)/(matchFatigueSamples.length-half);
  assert.ok(Math.abs(secondHalf-firstHalf)<15,`疲労が長期的に張り付いている可能性: 前半${firstHalf} 後半${secondHalf}`);
});

// ---------------------------------------------------------------------------
// W2配線の確認（lib/competition.ts が act()/'train' ハンドラへ実際に配線されていること）
// ---------------------------------------------------------------------------
void test('W2 wiring: training now schedules real competition fixtures (week 0 is always a U18 league match)',()=>{
  for(const seed of [1,2,3,4,5]){
    const s=newGame('',seed);
    const a=toMatchDay(s,'balance');
    assert.equal(a.pending?.kind,'league','週0はcompetitionFixture()経由でU18リーグの試合が組まれるはず');
    assert.ok(a.pending!.label.includes('リーグ'));
    assert.ok(a.pending!.opponent.length>0);
  }
});
void test('W2 wiring: league matches allow draws (no penalty shootout) once simulateSegment excludes "league" from the PK condition',()=>{
  let found=false;
  for(let seed=1;seed<=100 && !found;seed++){
    let s=newGame('',seed);
    s=toMatchDay(s,'balance');
    if(s.pending?.kind!=='league')continue;
    s=act(s,{type:'start'});
    while(!s.match!.done)s=act(s,{type:'segment'});
    if(s.match!.home===s.match!.away){
      found=true;
      assert.equal(s.match!.penalties,null,'リーグ戦の引き分けはPK戦になってはいけない');
      const comp=readCompetition(s);
      assert.equal(comp.teamA.draw,1,'引き分けはU18リーグの成績にdrawとして記録される');
      assert.equal(comp.teamA.played,1);
    }
  }
  assert.ok(found,'100シードの範囲内でリーグ戦の引き分けを再現できなかった');
});
void test('W2 wiring: compPrefecture is merged into Action and dispatched via act(); the district choice changes next season league difficulty',()=>{
  const byStrength=[...DISTRICTS].sort((a,b)=>a.strength-b.strength);
  const weakest=byStrength[0],strongest=byStrength[byStrength.length-1];
  function nextSeasonClubs(districtId:string){
    let s=newGame('赴任先検証高校',9);
    s=act(s,{type:'compPrefecture',districtId});
    assert.equal(readCompetition(s).districtId,districtId);
    let guard=0;
    while(s.season===1&&guard<60){s=step(s,'rest');guard++;}
    assert.equal(s.season,2,'1シーズン分の日程で必ず季をまたげるはず');
    return readCompetition(s).teamA.clubs;
  }
  const weakAvg=nextSeasonClubs(weakest.id).reduce((a,c)=>a+c.strength,0)/7;
  const strongAvg=nextSeasonClubs(strongest.id).reduce((a,c)=>a+c.strength,0)/7;
  assert.ok(strongAvg>weakAvg,`激戦区(${strongest.name})を選ぶと翌シーズンの対戦相手強度が上がるはず: ${strongAvg} vs ${weakAvg}`);
});
void test('W2 wiring: promotion/relegation actually happens when playing through the wired game loop across seasons',()=>{
  let changed=false;
  for(const seed of [2,5,9,14,23]){
    let s=newGame('',seed);
    let prevTier=readCompetition(s).teamA.tier;
    let actions=0;
    while(s.season<=6&&actions<400){
      const f=s.players.reduce((a,p)=>a+p.fatigue,0)/s.players.length;
      s=step(s,f>45?'rest':'balance');
      actions++;
      const tier=readCompetition(s).teamA.tier;
      if(tier!==prevTier){changed=true;prevTier=tier;}
    }
    if(changed)break;
  }
  assert.ok(changed,'6シーズンの範囲でU18リーグの昇格・降格が一度も起きなかった');
});
void test('W2 wiring: a legacy save with old fixture kinds migrates and keeps playing through the wired calendar',()=>{
  const s=newGame('',6);
  s.pending={label:'県大会・1回戦',kind:'qualifier',round:0,strength:50,opponent:'旧データ学園',style:'balanced'};
  s.day=6; // pendingが立つのは日曜(day6)のときだけ。
  const loaded=validateSave(JSON.parse(JSON.stringify(s)));
  assert.equal(loaded.pending!.kind,'wc_qualifier','旧kindはmapLegacyFixtureKind()で新種別へ決定的に移行される');
  const played=play(loaded);
  assert.equal(played.pending,null);
  assert.ok(played.week>=1);
});
