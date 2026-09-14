import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,act,validateSave,overall,strength,autoLineup,slots,ROSTER_MIN,ROSTER_MAX,type State,type Training} from '../lib/game.ts';
import {formationSlots,positionFitMult,basePos} from '../lib/squad.ts';
import {getCurrentLifeEvent} from '../lib/school-life.ts';
import {readCompetition,DISTRICTS} from '../lib/competition.ts';

function play(s:State){s=act(s,{type:'start'});while(!s.match!.done)s=act(s,{type:'segment'});return act(s,{type:'finish'});}
// 学校生活イベント（W3）が出ている週は、解決するまで 'train' が進められない。
// テストは常に先頭の選択肢を選んで先へ進める。
function resolveLife(s:State){const cur=getCurrentLifeEvent(s);if(!cur)return s;return act(s,{type:'life',choiceId:cur.event.choices[0].id});}
function step(s:State,t:Training='balance'){if(s.event)s=act(s,{type:'event',choice:'team'});s=resolveLife(s);s=act(s,{type:'train',training:t});if(s.pending)s=play(s);return s;}
void test('18 players, three balanced classes, unique starting eleven',()=>{const s=newGame('試験高校',42);assert.equal(s.players.length,18);assert.equal(new Set(s.lineup).size,11);for(const y of [1,2,3])assert.equal(s.players.filter(p=>p.year===y).length,6);assert.deepEqual(validateSave(JSON.parse(JSON.stringify(s))),s);});
// W2配線後は週0に必ずU18リーグの試合が組まれる（LEAGUE_WEEKSが週0を含むため）。
// このため練習直後は試合が「保留」され、週はまだ進まない（週が進むのは試合終了後）。
void test('training grows players; focused training grows faster; original stays immutable',()=>{const s=newGame('',42),id=s.players[0].id;const focused=act(s,{type:'focus',id});const a=act(s,{type:'train',training:'attack'}),b=act(focused,{type:'train',training:'attack'});assert.equal(s.week,0);assert.equal(a.week,0);assert.ok(a.pending,'週0はU18リーグの試合が組まれているため、練習直後は試合が保留される');const gain=a.players[0].stats.shoot-s.players[0].stats.shoot;assert.ok(gain>0);assert.ok(Math.abs((b.players[0].stats.shoot-s.players[0].stats.shoot)/gain-1.5)<.01);});
void test('rest restores fatigue and training cannot skip pending fixtures',()=>{let s=newGame('',12);s.players.forEach(p=>p.fatigue=80);s=act(s,{type:'train',training:'rest'});assert.equal(s.players[0].fatigue,47);if(s.pending)s=play(s);s.week=3;s=act(s,{type:'train',training:'balance'});assert.ok(s.pending);assert.throws(()=>act(s,{type:'train',training:'balance'}));});
void test('match commands, substitution limit and save/resume at halftime',()=>{let s=newGame('',55);s.week=3;s=act(s,{type:'train',training:'rest'});s=act(s,{type:'start'});const original=[...s.lineup];for(let i=0;i<3;i++){const p=s.players.find(p=>!s.match!.used.includes(p.id))!;s=act(s,{type:'swap',index:i+1,id:p.id});}assert.equal(s.match!.subs,3);assert.throws(()=>act(s,{type:'swap',index:5,id:s.players.find(p=>!s.match!.used.includes(p.id))!.id}));for(let i=0;i<3;i++)s=act(s,{type:'segment'});assert.equal(s.match!.minute,45);const loaded=validateSave(JSON.parse(JSON.stringify(s)));assert.deepEqual(act(s,{type:'segment'}),act(loaded,{type:'segment'}));while(!s.match!.done)s=act(s,{type:'segment'});assert.equal(s.records.games,1);assert.throws(()=>act(s,{type:'segment'}));s=act(s,{type:'finish'});assert.deepEqual(s.lineup,original);assert.equal(s.week,4);});
void test('graduation keeps the roster within bounds, advances lower classes and records history',()=>{let s=newGame('',91);const graduates=s.players.filter(p=>p.year===3).map(p=>p.id),younger=s.players.filter(p=>p.year===1).map(p=>p.id);s.week=47;s=step(s,'rest');assert.equal(s.season,2);assert.equal(s.week,0);assert.equal(s.history.length,1);assert.equal(s.history[0].graduates.length,6);assert.ok(graduates.every(id=>!s.players.some(p=>p.id===id)));assert.ok(younger.every(id=>s.players.find(p=>p.id===id)?.year===2));assert.equal(new Set(s.players.map(p=>p.id)).size,s.players.length);assert.ok(s.players.length>=ROSTER_MIN&&s.players.length<=ROSTER_MAX,`roster size ${s.players.length} out of [${ROSTER_MIN},${ROSTER_MAX}]`);const freshmen=s.players.filter(p=>p.year===1);assert.ok(freshmen.length>=6&&freshmen.length<=12,`freshman intake ${freshmen.length} out of 6..12`);for(const y of [1,2,3])assert.ok(s.players.some(p=>p.year===y),`grade ${y} is empty`);validateSave(s);});
void test('formation fit, fatigue, and facilities affect gameplay',()=>{let s=newGame('',41);const base=strength(s);s.players.forEach(p=>p.fatigue=90);assert.ok(strength(s)<base);s=act(s,{type:'formation',formation:'3-4-3'});assert.equal(s.lineup.length,11);s.funds=100;s=act(s,{type:'upgrade'});assert.equal(s.facilities,2);assert.equal(s.funds,60);assert.throws(()=>act({...s,funds:0},{type:'upgrade'}));});
void test('malformed and out of range save files rejected',()=>{for(const bad of [null,{}, {...newGame('',12),week:48},{...newGame('',12),players:[]},{...newGame('',12),lineup:Array(11).fill(1)},{...newGame('',12),formation:'0-0-0'},{...newGame('',12),funds:Infinity},{...newGame('',12),history:[{}]}])assert.throws(()=>validateSave(bad));});
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
void test('match log lines stay in chronological order',()=>{for(let seed=1;seed<=25;seed++){let s=newGame('',seed);s.week=3;s=act(s,{type:'train',training:'rest'});s=act(s,{type:'start'});while(!s.match!.done)s=act(s,{type:'segment'});const minutes=s.match!.logs.map(l=>/^(\d+)′/.exec(l)).filter(Boolean).map(m=>+m![1]);for(let i=1;i<minutes.length;i++)assert.ok(minutes[i-1]>=minutes[i],`seed ${seed} out of order: ${minutes.join(',')}`);}});

// ---------------------------------------------------------------------------
// W2配線の確認（lib/competition.ts が act()/'train' ハンドラへ実際に配線されていること）
// ---------------------------------------------------------------------------
void test('W2 wiring: training now schedules real competition fixtures (week 0 is always a U18 league match)',()=>{
  for(const seed of [1,2,3,4,5]){
    const s=newGame('',seed);
    const a=act(s,{type:'train',training:'balance'});
    assert.equal(a.pending?.kind,'league','週0はcompetitionFixture()経由でU18リーグの試合が組まれるはず');
    assert.ok(a.pending!.label.includes('リーグ'));
    assert.ok(a.pending!.opponent.length>0);
  }
});
void test('W2 wiring: league matches allow draws (no penalty shootout) once simulateSegment excludes "league" from the PK condition',()=>{
  let found=false;
  for(let seed=1;seed<=100 && !found;seed++){
    let s=newGame('',seed);
    s=act(s,{type:'train',training:'balance'});
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
  const loaded=validateSave(JSON.parse(JSON.stringify(s)));
  assert.equal(loaded.pending!.kind,'wc_qualifier','旧kindはmapLegacyFixtureKind()で新種別へ決定的に移行される');
  const played=play(loaded);
  assert.equal(played.pending,null);
  assert.ok(played.week>=1);
});
