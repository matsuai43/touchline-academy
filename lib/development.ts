import type { State, Player, Position, Stat, Training } from './game.ts';
export type Personality = 'enthusiast' | 'sensitive' | 'analyst' | 'competitor';
export type Origin = 'local' | 'academy' | 'legacy' | 'overseas' | 'exchange';
export type Identity = {
  portrait: number;
  personality: Personality;
  origin: Origin;
  trust: number;
  courage: number;
  workRate: number;
  memories: string[];
};
export const personalities = {
  enthusiast: { name: '熱血', line: 'もう一回、やらせてください！' },
  sensitive: { name: '慎重派', line: 'できたことを、一つずつ増やしたい。' },
  analyst: { name: '研究家', line: '次は相手の動きを読んでみます。' },
  competitor: { name: '負けず嫌い', line: 'このままじゃ終われません。' },
};
export const origins: Record<
  Origin,
  { name: string; min: number; story: string }
> = {
  local: {
    name: '部活の原石',
    min: 0,
    story: '地域の部活動で磨かれた、まだ知られていない才能。',
  },
  academy: {
    name: '育成組織出身',
    min: 25,
    story: '架空のプロクラブ育成組織で基礎を学び、新しい舞台を探す。',
  },
  legacy: {
    name: 'プロ選手の子',
    min: 45,
    story: '架空のプロ選手を親に持つ。期待を背負い、自分の名前で勝ちたい。',
  },
  overseas: {
    name: '海外経験者',
    min: 35,
    story: '海外でのプレーで、自分から仕掛ける姿勢を身につけた。',
  },
  exchange: {
    name: '留学生',
    min: 55,
    story: '異なるサッカー文化から来た仲間。新しい環境で挑戦したい。',
  },
};
export type PlanKey = 'technique' | 'attack' | 'defense' | 'athletic';
export const plans: Record<
  PlanKey,
  { name: string; desc: string; stats: Stat[]; menus: Training[]; goal: number }
> = {
  technique: {
    name: 'つないで崩す',
    desc: 'パスと精神力の成長＋25%。連携を大切にする半年。',
    stats: ['pass', 'mental'],
    menus: ['possession'],
    goal: 8,
  },
  attack: {
    name: 'ゴールに挑む',
    desc: '決定力と走力の成長＋25%。仕掛ける選手を育てる。',
    stats: ['shoot', 'speed'],
    menus: ['attack'],
    goal: 8,
  },
  defense: {
    name: '粘り強く守る',
    desc: '守備とGK技術の成長＋25%。失点を減らす土台づくり。',
    stats: ['defend', 'keep'],
    menus: ['defense'],
    goal: 8,
  },
  athletic: {
    name: '最後まで走る',
    desc: '走力と精神力の成長＋25%。走れるチームをつくる。',
    stats: ['speed', 'mental'],
    menus: ['physical'],
    goal: 8,
  },
};
export const managers = [
  {
    name: '小春 ひなた',
    portrait: 12,
    line: '今日できたこと、ちゃんとノートに残しておきますね！',
  },
  {
    name: '相沢 理央',
    portrait: 13,
    line: '数字だけじゃ見えない頑張りも、見ています。',
  },
  {
    name: '三枝 こよみ',
    portrait: 14,
    line: '顔を上げて！ 次の一本、一緒に取りにいこう！',
  },
  {
    name: '葉山 晴',
    portrait: 15,
    line: 'みんなの挑戦を、裏側から全力で支えます。',
  },
];
export type Support = 'care' | 'cheer' | 'analysis' | 'scout';
export const supports: Record<Support, { name: string; desc: string }> = {
  care: {
    name: 'コンディションケア',
    desc: '毎週の練習後、全員の疲労を追加で4回復',
  },
  cheer: { name: 'チームを応援', desc: '毎週の練習後、士気＋3' },
  analysis: { name: '練習ノート', desc: '毎週の練習後、連携＋2' },
  scout: { name: '候補生リサーチ', desc: '候補への訪問で関心が追加で10上昇' },
};
export type Candidate = {
  id: number;
  name: string;
  pos: Position;
  origin: Origin;
  portrait: number;
  personality: Personality;
  ability: number;
  potential: number;
  required: number;
  interest: number;
  scouted: boolean;
  promised: boolean;
};
export type Development = {
  schema: 2;
  epoch: number;
  plan: PlanKey | null;
  progress: number;
  rewarded: boolean;
  archive: string[];
  manager: number | null;
  support: Support;
  lastSupport: number;
  lastVisit: number;
  candidates: Candidate[];
  intake: string[];
  message: string;
};
export type Commands = {
  lane: 'mixed' | 'wide' | 'middle';
  tempo: 'patient' | 'normal' | 'quick';
  line: 'deep' | 'normal' | 'high';
  player: number | null;
  role: 'free' | 'attack' | 'cover';
};
export type Highlight = {
  id: string;
  minute: number;
  kind: 'goal' | 'save' | 'miss';
  side: 0 | 1;
  playerId: number;
  name: string;
  lane: Commands['lane'];
};
export type Moment = {
  id: string;
  playerId: number;
  kind: 'challenge' | 'tracking' | 'effort' | 'tired';
  text: string;
  answered: boolean;
  response: string;
};
export type MatchDetails = {
  commands: Commands;
  highlights: Highlight[];
  moment: Moment | null;
};
export type DevelopmentAction =
  | { type: 'plan'; plan: PlanKey }
  | { type: 'manager'; manager: number }
  | { type: 'support'; support: Support }
  | { type: 'scout'; id: number; mode: 'observe' | 'visit' | 'offer' }
  | { type: 'command'; field: keyof Commands; value: string | number | null }
  | { type: 'voice'; voice: 'praise' | 'correct' | 'encourage' | 'watch' };
const cap = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const ps = Object.keys(personalities) as Personality[];
const epoch = (s: State) => (s.season - 1) * 2 + Math.floor(s.week / 24);
const stamp = (s: State) => s.season * 48 + s.week;
export function identityFor(id: number): Identity {
  return {
    portrait: (id - 1) % 18,
    personality: ps[(id - 1) % 4],
    origin: 'local',
    trust: 50,
    courage: 45 + (id % 6) * 5,
    workRate: 45 + (id % 5) * 6,
    memories: [],
  };
}
export function matchDetails(): MatchDetails {
  return {
    commands: {
      lane: 'mixed',
      tempo: 'normal',
      line: 'normal',
      player: null,
      role: 'free',
    },
    highlights: [],
    moment: null,
  };
}
const names = [
  '碧野 悠斗',
  '篠森 蒼真',
  '小峰 律',
  '遠野 朔',
  '菱川 晴',
  '風見 航',
  '黒瀬 奏',
  '柊木 岳',
  '雨宮 透',
  '真柴 陸',
  '篠崎 大雅',
  '蒼坂 遼',
  'ルカ 森',
  '河原 レオン',
  'アミル 星野',
  'ノア 宮川',
  'アレックス・リオ',
  'カイ・ローレン',
  'レオ・サント',
  'サミル・ハディ',
];
export function candidatePool(s: State): Candidate[] {
  const kinds = Object.keys(origins) as Origin[];
  return Array.from({ length: 20 }, (_, i) => {
    const origin = kinds[Math.floor(i / 4)],
      pos = (['GK', 'DF', 'MF', 'FW'] as Position[])[i % 4],
      z =
        (Math.imul(s.season, 2654435761) + Math.imul(i + 1, 2246822519)) >>> 0;
    return {
      id: s.season * 100 + i,
      name: names[(i + (s.season - 1) * 3) % 20],
      pos,
      origin,
      portrait: origin === 'exchange' ? 8 + (i % 4) : i % 12,
      personality: ps[(z >>> 5) % 4],
      ability: cap(39 + Math.floor(origins[origin].min / 4) + (z % 12), 30, 80),
      potential:
        origin === 'local' ? 1.45 + (z % 40) / 100 : 1.35 + (z % 60) / 100,
      required: origins[origin].min,
      interest: 20 + (z % 16),
      scouted: false,
      promised: false,
    };
  });
}
export function newDevelopment(s: State): Development {
  return {
    schema: 2,
    epoch: epoch(s),
    plan: null,
    progress: 0,
    rewarded: false,
    archive: [],
    manager: null,
    support: 'cheer',
    lastSupport: -1,
    lastVisit: -1,
    candidates: candidatePool(s),
    intake: [],
    message: '半年の育成方針を決めて、仲間と目標を共有しよう。',
  };
}
export function hydrateDevelopment(s: State) {
  for (const p of s.players) if (!p.identity) p.identity = identityFor(p.id);
  if (!s.development) s.development = newDevelopment(s);
  if (s.match && !s.match.details) s.match.details = matchDetails();
  return s;
}
function note(s: State, text: string) {
  s.development.message = text;
  s.feed.unshift(text);
  s.feed = s.feed.slice(0, 30);
}
function memory(p: Player, text: string) {
  p.identity.memories.unshift(text);
  p.identity.memories = p.identity.memories.slice(0, 8);
}
export function syncHalf(s: State) {
  const d = s.development;
  if (d.epoch === epoch(s)) return;
  if (d.plan) {
    d.archive.unshift(
      `${Math.floor(d.epoch / 2) + 1}年目${d.epoch % 2 ? '後期' : '前期'}：${plans[d.plan].name} ${d.progress}/8回${d.rewarded ? '・達成' : '・次につなぐ'}`,
    );
    d.archive = d.archive.slice(0, 8);
  }
  d.epoch = epoch(s);
  d.plan = null;
  d.progress = 0;
  d.rewarded = false;
  note(s, '新しい半年。育成方針を見直すタイミングです。');
}
export function growthFactor(s: State, p: Player, k: Stat) {
  const d = s.development;
  return (
    (d.plan && plans[d.plan].stats.includes(k) ? 1.25 : 1) *
    (1 + (p.identity.trust - 50) / 500)
  );
}
export function developmentWeek(s: State, t: Training) {
  const d = s.development;
  if (d.plan && plans[d.plan].menus.includes(t)) {
    d.progress++;
    if (d.progress >= 8 && !d.rewarded) {
      d.rewarded = true;
      s.funds += 20;
      s.reputation = cap(s.reputation + 3);
      note(s, `半年目標「${plans[d.plan].name}」達成！ 部費＋20、評判＋3。`);
    }
  }
  if (d.manager !== null && d.lastSupport !== stamp(s)) {
    d.lastSupport = stamp(s);
    if (d.support === 'care')
      s.players.forEach((p) => (p.fatigue = cap(p.fatigue - 4)));
    if (d.support === 'cheer') s.morale = cap(s.morale + 3);
    if (d.support === 'analysis') s.cohesion = cap(s.cohesion + 2);
  }
}
export function applyIntake(s: State, fresh: Player[]) {
  const d = s.development,
    joined: string[] = [];
  for (const c of d.candidates.filter((c) => c.promised)) {
    const p = fresh.find((p) => p.pos === c.pos && !joined.includes(p.name));
    if (!p) continue;
    p.name = c.name;
    p.talent = c.potential;
    p.identity = {
      ...identityFor(p.id),
      portrait: c.portrait,
      personality: c.personality,
      origin: c.origin,
      trust: 65,
    };
    for (const key of Object.keys(p.stats) as Stat[])
      p.stats[key] = cap(c.ability + ((p.id + key.length) % 9) - 4, 20, 99);
    p.stats[
      p.pos === 'GK'
        ? 'keep'
        : p.pos === 'DF'
          ? 'defend'
          : p.pos === 'MF'
            ? 'pass'
            : 'shoot'
    ] = cap(c.ability + 9, 20, 99);
    p.identity.memories = [`${s.season}年目の春、監督の誘いで入部。`];
    joined.push(p.name);
  }
  d.intake = joined;
  d.candidates = candidatePool(s);
  d.lastVisit = -1;
  if (joined.length) note(s, `スカウトした${joined.join('、')}が入部！`);
}
export function handleDevelopment(s: State, a: DevelopmentAction): boolean {
  const d = s.development;
  if (a.type === 'voice') {
    const m = s.match,
      ev = m?.details.moment;
    if (!ev || ev.answered) throw Error('この場面への声かけは済んでいます。');
    if (!['praise', 'correct', 'encourage', 'watch'].includes(a.voice))
      throw Error('声かけを選び直してください。');
    const p = s.players.find((p) => p.id === ev.playerId)!;
    ev.answered = true;
    let result = '選手の判断を見守った。';
    if (a.voice !== 'watch') {
      const appropriate =
        (a.voice === 'praise' &&
          (ev.kind === 'challenge' || ev.kind === 'effort')) ||
        (a.voice === 'correct' && ev.kind === 'tracking') ||
        (a.voice === 'encourage' && ev.kind === 'tired');
      if (appropriate) {
        const stat: Stat =
          ev.kind === 'tracking'
            ? 'defend'
            : ev.kind === 'challenge'
              ? 'shoot'
              : 'mental';
        p.stats[stat] = cap(p.stats[stat] + 1.2, 20, 99);
        p.identity.trust = cap(p.identity.trust + 3);
        if (ev.kind === 'tracking')
          p.identity.workRate = cap(p.identity.workRate + 4);
        else p.identity.courage = cap(p.identity.courage + 3);
        result =
          a.voice === 'correct'
            ? '「戻る責任を果たそう」と厳しく伝えた。守備と献身性が成長。'
            : a.voice === 'praise'
              ? '挑戦を認めた。自信と技術が育った。'
              : '疲労を理解して励ました。信頼と精神力が育った。';
      } else if (a.voice === 'correct') {
        p.identity.trust = cap(
          p.identity.trust - (p.identity.personality === 'sensitive' ? 6 : 3),
        );
        result =
          '今は厳しい指摘が届かなかった。信頼が低下。疲労や挑戦の意図も見よう。';
      } else {
        p.identity.trust = cap(p.identity.trust + 1);
        result =
          '気持ちは届いた。信頼＋1。行動に合う言葉なら、能力の成長にもつながる。';
      }
      memory(
        p,
        `${m!.minute}分、監督から${a.voice === 'praise' ? '挑戦をほめられた' : a.voice === 'correct' ? '改善点を指摘された' : '励まされた'}。${result}`,
      );
    }
    ev.response = result;
    m!.logs.unshift(`監督 → ${p.name}：${result}`);
    m!.logs = m!.logs.slice(0, 90);
    note(s, `${p.name}：${result}`);
    return true;
  }
  if (a.type === 'command') {
    const m = s.match;
    if (!m || m.done) throw Error('試合中に指示してください。');
    const c = m.details.commands;
    const options: Record<string, unknown[]> = {
      lane: ['mixed', 'wide', 'middle'],
      tempo: ['patient', 'normal', 'quick'],
      line: ['deep', 'normal', 'high'],
      role: ['free', 'attack', 'cover'],
      player: [null, ...s.lineup],
    };
    if (!options[a.field]?.includes(a.value))
      throw Error('指示の値が不正です。');
    Object.assign(c, { [a.field]: a.value });
    return true;
  }
  if (!['plan', 'manager', 'support', 'scout'].includes(a.type)) return false;
  if (s.match) throw Error('試合終了後に変更できます。');
  if (a.type === 'plan') {
    syncHalf(s);
    if (d.plan)
      throw Error('この半年の方針は確定済みです。次の半年に変更できます。');
    if (!Object.hasOwn(plans, a.plan)) throw Error('方針が不正です。');
    d.plan = a.plan;
    note(s, `半年の育成方針を「${plans[a.plan].name}」に決定。`);
    return true;
  }
  if (a.type === 'manager') {
    if (!Number.isInteger(a.manager) || !managers[a.manager])
      throw Error('マネージャーを選んでください。');
    d.manager = a.manager;
    note(s, `${managers[a.manager].name}：${managers[a.manager].line}`);
    return true;
  }
  if (a.type === 'support') {
    if (!Object.hasOwn(supports, a.support))
      throw Error('活動を選び直してください。');
    d.support = a.support;
    return true;
  }
  if (a.type === 'scout') {
    const c = d.candidates.find((c) => c.id === a.id);
    if (!c || s.reputation < c.required)
      throw Error('学校の評判が条件に届いていません。');
    if (c.promised) throw Error('すでに入学の内諾を得ています。');
    if (d.lastVisit === stamp(s))
      throw Error('スカウト活動は週に1回。練習を進めてください。');
    const cost =
      a.mode === 'observe'
        ? 3
        : a.mode === 'visit'
          ? 5
          : a.mode === 'offer'
            ? 8
            : NaN;
    if (!Number.isFinite(cost) || s.funds < cost)
      throw Error('部費が足りません。');
    if (a.mode !== 'observe' && !c.scouted)
      throw Error('まず視察して選手を知りましょう。');
    if (a.mode === 'offer') {
      if (c.interest < 70) throw Error('関心70以上で入学を提案できます。');
      const vacancies = s.players.filter(
          (p) => p.year === 3 && p.pos === c.pos,
        ).length,
        offers = d.candidates.filter(
          (x) => x.promised && x.pos === c.pos,
        ).length;
      if (offers >= vacancies)
        throw Error('このポジションの卒業枠は内諾で埋まっています。');
      c.promised = true;
      note(s, `${c.name}から入学の内諾。来春の${c.pos}枠へ。`);
    } else if (a.mode === 'observe') {
      if (c.scouted) throw Error('視察済みです。');
      c.scouted = true;
      note(s, `${c.name}を視察。現在の力と成長の素質が分かりました。`);
    } else {
      c.interest = cap(
        c.interest +
          20 +
          (d.manager !== null && d.support === 'scout' ? 10 : 0),
      );
      note(s, `${c.name}と面談。学校への関心が${c.interest}になりました。`);
    }
    s.funds -= cost;
    d.lastVisit = stamp(s);
    return true;
  }
  return false;
}
export function commandFactors(s: State) {
  const m = s.match!,
    c = m.details.commands,
    team = s.players.filter((p) => s.lineup.includes(p.id)),
    avg = (k: Stat) => team.reduce((a, p) => a + p.stats[k], 0) / team.length;
  let attack = 1,
    defense = 1,
    fatigue = 0;
  if (c.lane === 'wide') attack = cap(0.86 + avg('speed') / 400, 0.95, 1.12);
  if (c.lane === 'middle') attack = cap(0.84 + avg('pass') / 350, 0.95, 1.14);
  if (c.tempo === 'quick') {
    attack *= 1.16;
    defense *= 1.12;
    fatigue += 2;
  }
  if (c.tempo === 'patient') {
    attack *= 0.9;
    defense *= 0.88;
    fatigue -= 1;
  }
  if (c.line === 'high') {
    attack *= 1.08;
    defense *= m.fixture.style === 'counter' ? 1.25 : 1.08;
    fatigue++;
  }
  if (c.line === 'deep') {
    attack *= 0.88;
    defense *= 0.88;
  }
  const p = team.find((p) => p.id === c.player);
  if (p && c.role === 'attack') {
    attack *= 1.08;
    defense *= 1.05;
  }
  if (p && c.role === 'cover') {
    attack *= 0.96;
    defense *= 0.9;
  }
  const work = team.reduce((a, p) => a + p.identity.workRate, 0) / 11;
  defense *= 1 - (work - 55) / 500;
  return { attack, defense, fatigue };
}
export function createMoment(s: State) {
  const m = s.match!,
    team = s.lineup.map((id) => s.players.find((p) => p.id === id)!);
  const p = team[(s.seed + m.minute) % team.length];
  const kind: Moment['kind'] =
    p.fatigue > 72
      ? 'tired'
      : (m.minute / 15) % 3 === 1
        ? 'challenge'
        : (m.minute / 15) % 3 === 2
          ? 'tracking'
          : 'effort';
  const text =
    kind === 'tired'
      ? `${p.name}の足が止まっている。息が上がり、疲労が見える。`
      : kind === 'tracking'
        ? `${p.name}がボールを失った後、守備への切り替えをためらった。`
        : kind === 'challenge'
          ? `${p.name}が難しい局面で前を向いて仕掛けた。結果以上に、勇気のある挑戦。`
          : `${p.name}が味方の背後を懸命にカバーした。`;
  m.details.moment = {
    id: `${s.season}-${s.week}-${m.minute}`,
    playerId: p.id,
    kind,
    text,
    answered: false,
    response: '',
  };
}
export function validateDevelopment(s: State) {
  const d = s.development;
  const number = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const strings = (v: unknown, max: number) =>
    Array.isArray(v) &&
    v.length <= max &&
    v.every((t) => typeof t === 'string' && t.length <= 1000);
  for (const p of s.players) {
    const i = p.identity;
    if (
      !i ||
      !Number.isInteger(i.portrait) ||
      !number(i.portrait, 0, 17) ||
      !Object.hasOwn(personalities, i.personality) ||
      !Object.hasOwn(origins, i.origin) ||
      ![i.trust, i.courage, i.workRate].every((v) => number(v, 0, 100)) ||
      !strings(i.memories, 8)
    )
      throw Error('選手の個性データが不正です。');
  }
  if (
    !d ||
    d.schema !== 2 ||
    !number(d.epoch, 0, 200000) ||
    (d.plan !== null && !Object.hasOwn(plans, d.plan)) ||
    !number(d.progress, 0, 48) ||
    typeof d.rewarded !== 'boolean' ||
    !strings(d.archive, 8) ||
    !strings(d.intake, 6) ||
    (d.manager !== null &&
      (!Number.isInteger(d.manager) || !managers[d.manager])) ||
    !Object.hasOwn(supports, d.support) ||
    !number(d.lastSupport, -1, 5000000) ||
    !number(d.lastVisit, -1, 5000000) ||
    typeof d.message !== 'string' ||
    d.message.length > 1000 ||
    !Array.isArray(d.candidates) ||
    d.candidates.length !== 20
  )
    throw Error('育成データが不正です。');
  for (const c of d.candidates) {
    if (
      !Number.isInteger(c.id) ||
      typeof c.name !== 'string' ||
      c.name.length > 40 ||
      !['GK', 'DF', 'MF', 'FW'].includes(c.pos) ||
      !Object.hasOwn(origins, c.origin) ||
      !Object.hasOwn(personalities, c.personality) ||
      !Number.isInteger(c.portrait) ||
      !number(c.portrait, 0, 17) ||
      !number(c.ability, 20, 99) ||
      !number(c.potential, 1, 2) ||
      !number(c.required, 0, 100) ||
      !number(c.interest, 0, 100) ||
      typeof c.scouted !== 'boolean' ||
      typeof c.promised !== 'boolean'
    )
      throw Error('候補生データが不正です。');
  }
  if (
    new Set(d.candidates.map((c) => c.id)).size !== 20 ||
    d.candidates.filter((c) => c.promised).length > 6
  )
    throw Error('内諾データが不正です。');
  if (s.match) {
    const m = s.match,
      md = m.details;
    if (!md || !Array.isArray(md.highlights) || md.highlights.length > 10)
      throw Error('試合演出データが不正です。');
    const c = md.commands;
    if (
      !c ||
      !['mixed', 'wide', 'middle'].includes(c.lane) ||
      !['patient', 'normal', 'quick'].includes(c.tempo) ||
      !['deep', 'normal', 'high'].includes(c.line) ||
      !['free', 'attack', 'cover'].includes(c.role) ||
      (c.player !== null && !s.players.some((p) => p.id === c.player))
    )
      throw Error('試合指示が不正です。');
    for (const h of md.highlights)
      if (
        !h ||
        typeof h.id !== 'string' ||
        !number(h.minute, 0, 90) ||
        !['goal', 'save', 'miss'].includes(h.kind) ||
        ![0, 1].includes(h.side) ||
        !s.players.some((p) => p.id === h.playerId) ||
        typeof h.name !== 'string' ||
        h.name.length > 100 ||
        !['mixed', 'wide', 'middle'].includes(h.lane)
      )
        throw Error('映像データが不正です。');
    const e = md.moment;
    if (
      e &&
      (!s.players.some((p) => p.id === e.playerId) ||
        !['challenge', 'tracking', 'effort', 'tired'].includes(e.kind) ||
        typeof e.id !== 'string' ||
        typeof e.text !== 'string' ||
        typeof e.response !== 'string' ||
        typeof e.answered !== 'boolean')
    )
      throw Error('声かけデータが不正です。');
  }
  return s;
}
