export type Position = 'GK'|'DF'|'MF'|'FW';
export type Stat = 'shoot'|'pass'|'defend'|'speed'|'mental'|'keep';
export type Training = 'balance'|'attack'|'possession'|'defense'|'physical'|'rest';
export type Tactic = 'balanced'|'possession'|'counter'|'press';
export type Formation = '4-3-3'|'4-4-2'|'3-4-3';
export type Player = { id:number;name:string;year:number;pos:Position;stats:Record<Stat,number>;fatigue:number;injury:number;talent:number;trait:string;goals:number;appearances:number };
export type Fixture = { label:string;kind:'friendly'|'summer'|'qualifier'|'national';round:number;strength:number;opponent:string;style:Tactic };
export type Match = { fixture:Fixture;minute:number;home:number;away:number;shots:[number,number];xg:[number,number];logs:string[];tactic:Tactic;mentality:'safe'|'normal'|'attack';subs:number;used:number[];original:number[];done:boolean;won:boolean;penalties:string|null;possession:number;lastSide:number };
export type State = { version:1;seed:number;school:string;season:number;week:number;players:Player[];lineup:number[];formation:Formation;reputation:number;cohesion:number;morale:number;facilities:number;funds:number;focus:number|null;pending:Fixture|null;match:Match|null;event:string|null;qualified:boolean;alive:boolean;summerAlive:boolean;history:{season:number;result:string;wins:number;goals:number;graduates:string[]}[];records:{wins:number;games:number;goals:number;trophies:number};seasonWins:number;seasonGoals:number;best:string;feed:string[];nextId:number };
export const stats:Record<Stat,string>={shoot:'決定力',pass:'パス',defend:'守備',speed:'走力',mental:'精神力',keep:'GK技術'};
export const training:Record<Training,{name:string;desc:string;fatigue:number;stats:Stat[]}>={
 balance:{name:'総合練習',desc:'全能力を少しずつ伸ばす',fatigue:7,stats:['shoot','pass','defend','speed','mental','keep']},
 attack:{name:'シュート練習',desc:'決定力と精神力を磨く',fatigue:10,stats:['shoot','mental']},
 possession:{name:'パス＆連携',desc:'パスとチームの連携を強化',fatigue:8,stats:['pass','mental']},
 defense:{name:'守備トレーニング',desc:'守備とGK技術を強化',fatigue:9,stats:['defend','keep']},
 physical:{name:'フィジカル',desc:'走力を大きく伸ばす',fatigue:14,stats:['speed']},
 rest:{name:'休養・ケア',desc:'疲労を回復。けがの回復も促す',fatigue:-33,stats:[]}
};
export const tactics:Record<Tactic,{name:string;desc:string}>={balanced:{name:'バランス',desc:'消耗を抑え、攻守の均衡を保つ'},possession:{name:'ポゼッション',desc:'パスで主導権。速攻に強く、プレスに弱い'},counter:{name:'カウンター',desc:'走力で速攻。プレスに強く、保持に弱い'},press:{name:'ハイプレス',desc:'前で奪う。保持に強いが疲労が増える'}};
const surnames=['朝倉','瀬戸','橘','風間','白石','成瀬','相馬','久世','真田','水瀬','蒼井','桐野','一ノ瀬','宮坂','榊','日向','高瀬','七瀬','春野','藤崎','神谷','小暮','城戸','海野'];
const given=['湊','蓮','悠真','颯','律','陽斗','蒼','直哉','晴人','大和','凪','陸','奏太','翔','悠','透','岳','航','新','瑛太','怜','駿','伊織','海'];
const rivals=['白嶺工科','星ヶ丘学園','海凪学院','翠峰学園','燈野総合','暁星工業','青葉野学院','望洋学園','月ヶ瀬学院','東雲学舎'];
export const clamp=(n:number,min=0,max=100)=>Math.min(max,Math.max(min,n));
function rand(s:State){s.seed=(Math.imul(s.seed,1664525)+1013904223)>>>0;return s.seed/4294967296;}
function pick<T>(s:State,a:T[]):T{return a[Math.floor(rand(s)*a.length)];}
function log(s:State,t:string){s.feed=[t,...s.feed].slice(0,30);}
export function overall(p:Player){const weights:Record<Position,Stat[]>={GK:['keep','mental','defend'],DF:['defend','speed','mental'],MF:['pass','mental','speed'],FW:['shoot','speed','mental']};return Math.round(weights[p.pos].reduce((a,k)=>a+p.stats[k],0)/3);}
export function slots(f:Formation):Position[]{return ['GK',...Array(+f[0]).fill('DF'),...Array(+f[2]).fill('MF'),...Array(+f[4]).fill('FW')];}
export function roster(s:State){return s.lineup.map(id=>s.players.find(p=>p.id===id)!);}
export function strength(s:State){return Math.round(roster(s).reduce((a,p,i)=>a+effective(p,slots(s.formation)[i]),0)/11);}
function effective(p:Player,slot:Position){return overall(p)*(p.pos===slot?1:p.pos==='GK'||slot==='GK'?.48:.8)*(1-p.fatigue*.004)*(p.injury?.5:1);}
function makePlayer(s:State,year:number,pos:Position):Player{
 const id=s.nextId++,base=32+year*5+Math.min(18,s.reputation*.2);const p:Player={id,name:`${surnames[id%surnames.length]} ${given[(id*7+Math.floor(rand(s)*24))%24]}`,year,pos,stats:{} as Record<Stat,number>,fatigue:Math.floor(rand(s)*12),injury:0,talent:1+rand(s)*.55,trait:pick(s,['努力家','冷静','闘志','ムードメーカー']),goals:0,appearances:0};
 for(const k of Object.keys(stats) as Stat[])p.stats[k]=Math.round(base+rand(s)*20);
 p.stats[pos==='GK'?'keep':pos==='DF'?'defend':pos==='MF'?'pass':'shoot']+=9;return p;
}
export function autoLineup(s:State){const left=[...s.players];s.lineup=slots(s.formation).map(slot=>{left.sort((a,b)=>effective(b,slot)-effective(a,slot));return left.shift()!.id;});}
export function newGame(school='風見ヶ丘高校',seed=Date.now()>>>0):State{
 const s:State={version:1,seed,school:school.trim().slice(0,20)||'風見ヶ丘高校',season:1,week:0,players:[],lineup:[],formation:'4-3-3',reputation:15,cohesion:45,morale:70,facilities:1,funds:25,focus:null,pending:null,match:null,event:null,qualified:false,alive:true,summerAlive:true,history:[],records:{wins:0,games:0,goals:0,trophies:0},seasonWins:0,seasonGoals:0,best:'大会未出場',feed:['新しい春。18人の部員と、全国への一歩を踏み出そう。'],nextId:1};
 const positions:Position[][]=[['GK','DF','DF','MF','MF','FW'],['DF','DF','MF','MF','FW','FW'],['GK','DF','DF','MF','MF','FW']];
 for(let y=1;y<=3;y++)for(const pos of positions[y-1])s.players.push(makePlayer(s,y,pos));autoLineup(s);return s;
}
export function dateLabel(s:State){return `${(Math.floor(s.week/4)+3)%12+1}月 第${s.week%4+1}週`;}
export function calendar(week:number,s:State):{kind:Fixture['kind'];round:number;label:string}|null{
 if(week>=11&&week<=13&&s.summerAlive)return {kind:'summer',round:week-11,label:['夏季招待大会・1回戦','夏季招待大会・準決勝','夏季招待大会・決勝'][week-11]};
 if(week>=27&&week<=30&&s.alive)return {kind:'qualifier',round:week-27,label:['県大会・1回戦','県大会・準々決勝','県大会・準決勝','県大会・決勝'][week-27]};
 if(week>=36&&week<=40&&s.qualified&&s.alive)return {kind:'national',round:week-36,label:['全国大会・1回戦','全国大会・2回戦','全国大会・準々決勝','全国大会・準決勝','全国大会・決勝'][week-36]};
 if([3,7,19,23,34,43].includes(week))return{kind:'friendly',round:0,label:'練習試合'};return null;
}
function finishWeek(s:State){s.week++;if(s.week===48){const grads=s.players.filter(p=>p.year===3);s.history.unshift({season:s.season,result:s.best,wins:s.seasonWins,goals:s.seasonGoals,graduates:grads.map(p=>p.name)});s.history=s.history.slice(0,20);s.players=s.players.filter(p=>p.year<3);s.players.forEach(p=>{p.year++;p.fatigue=0;p.injury=0;});for(const p of grads)s.players.push(makePlayer(s,1,p.pos));s.week=0;s.season++;s.alive=true;s.summerAlive=true;s.qualified=false;s.seasonWins=0;s.seasonGoals=0;s.best='大会未出場';s.focus=null;s.cohesion=Math.max(35,s.cohesion-18);s.funds+=25;s.morale=75;autoLineup(s);log(s,`${grads.length}人が卒業。新入生${grads.length}人が入部しました。${s.season}年目の春です。`);}}
export type Action={type:'train';training:Training}|{type:'event';choice:'team'|'individual'}|{type:'formation';formation:Formation}|{type:'swap';index:number;id:number}|{type:'auto'}|{type:'focus';id:number|null}|{type:'upgrade'}|{type:'start'}|{type:'tactic';tactic:Tactic}|{type:'mentality';mentality:Match['mentality']}|{type:'segment'}|{type:'finish'};
export function act(old:State,a:Action):State{
 const s=structuredClone(old);
 if(a.type==='train'){
 if(s.pending||s.match||s.event)throw Error('試合または部内イベントを先に終えてください。');
 if(!(a.training in training))throw Error('練習メニューが不正です。');const t=training[a.training];let growth=0;
 for(const p of s.players){p.injury=Math.max(0,p.injury-(a.training==='rest'?2:1));if(!p.injury&&a.training!=='rest'){for(const k of t.stats){const gain=(t.stats.length===6?.45:t.stats.length===1?1.65:1.05)*p.talent*(1+(s.facilities-1)*.14)*(1-p.fatigue/150)*(p.id===s.focus?1.5:1)*(p.stats[k]>85?.35:1);p.stats[k]=clamp(p.stats[k]+gain,20,99);growth+=gain;}if(p.fatigue>65&&rand(s)<.13){p.injury=2;log(s,`${p.name}が筋肉に張り。2週の調整が必要です。`);}}
 p.fatigue=clamp(p.fatigue+t.fatigue);}
 s.cohesion=clamp(s.cohesion+(a.training==='possession'?4:a.training==='rest'?-1:1));s.morale=clamp(s.morale+(a.training==='rest'?5:-1));s.funds+=2;
 log(s,`${dateLabel(s)}：${t.name}。${a.training==='rest'?'選手の疲労が回復しました。':`チーム全体で能力が計${Math.round(growth)}成長。`}`);
 const f=calendar(s.week,s);if(f){s.pending={...f,strength:Math.round((f.kind==='national'?65:f.kind==='qualifier'?47:f.kind==='summer'?45:strength(s)-4)+f.round*4+rand(s)*8),opponent:pick(s,rivals),style:pick(s,['possession','counter','press'] as Tactic[])};}else{finishWeek(s);if(s.week>0&&s.week%7===0)s.event=pick(s,['部員たちの自主練習','主将からの提案','雨の日のミーティング']);}return s;
 }
 if(a.type==='event'){if(!s.event)throw Error('イベントはありません。');if(a.choice==='team'){s.cohesion=clamp(s.cohesion+7);s.morale=clamp(s.morale+8);log(s,'仲間との対話で連携と士気が上がりました。');}else{const p=s.players.find(p=>p.id===s.focus)||pick(s,s.players);for(const k of Object.keys(stats) as Stat[])p.stats[k]=clamp(p.stats[k]+2,20,99);log(s,`${p.name}の自主練習を指導。全能力が2上がりました。`);}s.event=null;return s;}
 if(a.type==='segment'){if(!s.match||s.match.done)throw Error('進行できる試合がありません。');simulateSegment(s);return s;}
 if(a.type==='finish'){if(!s.match?.done)throw Error('試合が終了していません。');s.lineup=s.match.original;s.match=null;s.pending=null;finishWeek(s);return s;}
 if(a.type==='tactic'||a.type==='mentality'){if(!s.match||s.match.done)throw Error('試合中のみ変更できます。');if(a.type==='tactic'){if(!(a.tactic in tactics))throw Error('戦術が不正です。');s.match.tactic=a.tactic;}else if(['safe','normal','attack'].includes(a.mentality))s.match.mentality=a.mentality;return s;}
 if(a.type==='start'){if(!s.pending||s.match)throw Error('予定された試合がありません。');s.match={fixture:s.pending,minute:0,home:0,away:0,shots:[0,0],xg:[0,0],logs:['キックオフ。15分ごとに戦術と交代を指示できます。'],tactic:'balanced',mentality:'normal',subs:0,used:[...s.lineup],original:[...s.lineup],done:false,won:false,penalties:null,possession:50,lastSide:0};return s;}
 if(a.type==='swap'){
 const incoming=s.players.find(p=>p.id===a.id);if(!incoming||a.index<0||a.index>10)throw Error('選手を選び直してください。');const idx=s.lineup.indexOf(a.id);
 if(s.match){if(s.match.done||s.match.subs>=3||s.match.used.includes(a.id)||incoming.injury)throw Error('交代は未出場の健康な選手と3人までです。');s.match.subs++;s.match.used.push(a.id);s.match.logs.unshift(`${s.match.minute}′ 交代：${s.players.find(p=>p.id===s.lineup[a.index])?.name} → ${incoming.name}`);}else if(idx>=0)s.lineup[idx]=s.lineup[a.index];s.lineup[a.index]=a.id;return s;
 }
 if(s.match)throw Error('試合を終えてから変更してください。');
 if(a.type==='auto')autoLineup(s);
 if(a.type==='formation'){if(!['4-3-3','4-4-2','3-4-3'].includes(a.formation))throw Error('布陣が不正です。');s.formation=a.formation;autoLineup(s);}
 if(a.type==='focus'){if(a.id!==null&&!s.players.some(p=>p.id===a.id))throw Error('選手が見つかりません。');s.focus=a.id;}
 if(a.type==='upgrade'){const cost=s.facilities*40;if(s.funds<cost||s.facilities>=5)throw Error('部費が足りないか、設備が最高レベルです。');s.funds-=cost;s.facilities++;log(s,`練習設備がLv.${s.facilities}に。練習の成長効率が上がります。`);}
 return s;
}
function simulateSegment(s:State){const m=s.match!,team=roster(s),rating=strength(s),style=m.fixture.style;const advantage=m.tactic==='possession'&&style==='counter'||m.tactic==='counter'&&style==='press'||m.tactic==='press'&&style==='possession'?1.17:m.tactic!=='balanced'&&m.tactic!==style?.87:1;
 const stat=(k:Stat)=>team.reduce((a,p)=>a+p.stats[k]*(1-p.fatigue*.003),0)/11;
 const tacticQuality=m.tactic==='possession'?stat('pass'):m.tactic==='counter'?stat('speed'):m.tactic==='press'?(stat('defend')+stat('speed'))/2:rating;
 const ratio=clamp((rating*.65+tacticQuality*.35+s.cohesion*.09+(s.morale-50)*.1)/m.fixture.strength,.4,1.9);
 const push=m.mentality==='attack'?1.32:m.mentality==='safe'?.75:1;
 const homeRate=.29*ratio*advantage*push*(m.tactic==='press'?1.15:1),awayRate=.28/ratio/advantage*(m.mentality==='attack'?1.3:m.mentality==='safe'?.73:1);
 let goal=false;for(let i=0;i<3;i++){const minute=m.minute+Math.round(1+rand(s)*14);for(let side=0;side<2;side++){const rate=side===0?homeRate:awayRate;if(rand(s)<rate*1.9){m.shots[side]++;const chance=clamp(.15+rand(s)*.22+(side===0?(stat('shoot')-55)/500:0),.1,.5);m.xg[side]+=chance;if(rand(s)<chance){if(side===0){m.home++;const scorers=team.filter(p=>p.pos==='FW'||p.pos==='MF'),scorer=pick(s,scorers.length?scorers:team);scorer.goals++;m.logs.unshift(`${minute}′ GOAL！ ${scorer.name}がネットを揺らす！`);}else{m.away++;m.logs.unshift(`${minute}′ 失点。${m.fixture.opponent}がゴール。`);}m.lastSide=side;goal=true;}}}}
 m.minute+=15;m.possession=Math.round(clamp(50+(ratio-1)*15+(m.tactic==='possession'?10:m.tactic==='counter'?-10:0),25,75));
 if(!goal)m.logs.unshift(`${m.minute}′ ${pick(s,['中盤で激しいボールの奪い合い。','サイドから好機をうかがう。','最後のパスがわずかに合わない。','集中した守備でシュートを防いだ。'])}`);
 for(const p of team)p.fatigue=clamp(p.fatigue+(m.tactic==='press'?8:5)+(m.mentality==='attack'?1:0));
 if(m.minute===45)m.logs.unshift('HALF TIME：疲労を確認して、交代と後半の戦術を決めよう。');
 if(m.minute>=90){m.done=true;m.won=m.home>m.away;if(m.home===m.away&&m.fixture.kind!=='friendly'){m.won=rand(s)<clamp(.5+(stat('mental')-m.fixture.strength)/180,.25,.75);m.penalties=m.won?'5 - 4':'4 - 5';m.logs.unshift(`PK戦 ${m.penalties}。${m.won?'勝利！':'惜しくも敗退。'}`);}
 s.records.games++;s.records.goals+=m.home;s.seasonGoals+=m.home;for(const id of m.used){const p=s.players.find(p=>p.id===id)!;p.appearances++;p.stats.mental=clamp(p.stats.mental+.5,20,99);}
 if(m.won){s.records.wins++;s.seasonWins++;s.reputation=clamp(s.reputation+(m.fixture.kind==='friendly'?1:3));s.morale=clamp(s.morale+7);s.funds+=m.fixture.kind==='friendly'?5:12;}else s.morale=clamp(s.morale-4);
 if(m.fixture.kind==='summer'){if(!m.won)s.summerAlive=false;else if(m.fixture.round===2){s.funds+=25;s.reputation=clamp(s.reputation+5);log(s,'夏季招待大会を制覇！部費が25増えました。');}}
 if(m.fixture.kind==='qualifier'){if(!m.won){s.alive=false;s.best=m.fixture.label+'敗退';}else if(m.fixture.round===3){s.qualified=true;s.best='全国大会出場';s.funds+=35;log(s,'県大会優勝！冬の全国大会への切符を獲得しました。');}}
 if(m.fixture.kind==='national'){if(!m.won){s.alive=false;s.best=m.fixture.label+'敗退';}else{s.best=m.fixture.round===4?'全国優勝':m.fixture.label+'突破';if(m.fixture.round===4){s.records.trophies++;s.reputation=clamp(s.reputation+12);s.funds+=75;log(s,'全国の頂点へ！この世代の挑戦が、学校の歴史になりました。');}}}
 log(s,`${m.fixture.label}：${s.school} ${m.home} - ${m.away} ${m.fixture.opponent}${m.penalties?'（PK '+m.penalties+'）':''}`);
 }
}
export function validateSave(x:unknown):State{
 if(!x||typeof x!=='object')throw Error('セーブ形式が違います。');const s=x as State;
 const num=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 if(s.version!==1||typeof s.school!=='string'||s.school.length>20||!num(s.seed,0,4294967295)||!num(s.season,1,100000)||!Number.isInteger(s.season)||!num(s.week,0,47)||!Number.isInteger(s.week)||!Array.isArray(s.players)||s.players.length!==18||!['4-3-3','4-4-2','3-4-3'].includes(s.formation))throw Error('このセーブは対応していないか、壊れています。');
 for(const p of s.players){if(!p||!Number.isInteger(p.id)||typeof p.name!=='string'||p.name.length>40||!['GK','DF','MF','FW'].includes(p.pos)||![1,2,3].includes(p.year)||!num(p.fatigue,0,100)||!num(p.injury,0,5)||!num(p.talent,1,2)||typeof p.trait!=='string'||!num(p.goals,0,1000000)||!num(p.appearances,0,1000000)||!p.stats||!Object.keys(stats).every(k=>num(p.stats[k as Stat],20,99)))throw Error('選手データを読み込めません。');}
 const ids=s.players.map(p=>p.id);if(new Set(ids).size!==18||!Array.isArray(s.lineup)||s.lineup.length!==11||new Set(s.lineup).size!==11||s.lineup.some(id=>!ids.includes(id))||!num(s.nextId,Math.max(...ids)+1,10000000)||!num(s.reputation,0,100)||!num(s.cohesion,0,100)||!num(s.morale,0,100)||!num(s.facilities,1,5)||!num(s.funds,0,10000000)||!num(s.seasonWins,0,1000)||!num(s.seasonGoals,0,10000)||typeof s.best!=='string'||!Array.isArray(s.feed)||s.feed.length>30||s.feed.some(t=>typeof t!=='string'||t.length>500)||!Array.isArray(s.history)||s.history.length>20||!s.records||!['wins','games','goals','trophies'].every(k=>num(s.records[k as keyof State['records']],0,10000000))||!['qualified','alive','summerAlive'].every(k=>typeof s[k as keyof State]==='boolean')||(s.focus!==null&&!ids.includes(s.focus))||(s.event!==null&&typeof s.event!=='string'))throw Error('部活動データを読み込めません。');
 for(const h of s.history)if(!h||!num(h.season,1,100000)||typeof h.result!=='string'||!num(h.wins,0,1000)||!num(h.goals,0,10000)||!Array.isArray(h.graduates)||h.graduates.some(n=>typeof n!=='string'||n.length>40))throw Error('年度記録が不正です。');
 const fixture=(f:Fixture)=>f&&['friendly','summer','qualifier','national'].includes(f.kind)&&num(f.round,0,4)&&num(f.strength,1,200)&&typeof f.label==='string'&&f.label.length<100&&typeof f.opponent==='string'&&f.opponent.length<100&&Object.keys(tactics).includes(f.style);
 if(s.pending&&!fixture(s.pending))throw Error('日程データが不正です。');
 if(s.match){const m=s.match;if(!s.pending||!fixture(m.fixture)||!num(m.minute,0,90)||m.minute%15!==0||!num(m.home,0,100)||!num(m.away,0,100)||!num(m.subs,0,3)||!Array.isArray(m.logs)||m.logs.length>100||m.logs.some(t=>typeof t!=='string'||t.length>500)||!Array.isArray(m.original)||m.original.length!==11||new Set(m.original).size!==11||m.original.some(id=>!ids.includes(id))||!Array.isArray(m.used)||m.used.length>14||m.used.some(id=>!ids.includes(id))||![m.shots,m.xg].every(a=>Array.isArray(a)&&a.length===2&&a.every(n=>num(n,0,1000)))||!Object.keys(tactics).includes(m.tactic)||!['safe','normal','attack'].includes(m.mentality)||typeof m.done!=='boolean'||m.done!==(m.minute===90)||typeof m.won!=='boolean'||!num(m.possession,0,100)||![0,1].includes(m.lastSide)||(m.penalties!==null&&typeof m.penalties!=='string'))throw Error('試合データが不正です。');}
 return structuredClone(s);
}
