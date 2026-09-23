import {
  identityFor,
  newDevelopment,
  hydrateDevelopment,
  validateDevelopment,
  syncHalf,
  growthFactor,
  developmentWeek,
  applyIntake,
  handleDevelopment,
  matchDetails,
  commandFactors,
  createMoment,
  type Identity,
  type Development,
  type MatchDetails,
  type DevelopmentAction,
} from './development.ts';
import { hydrateV3, validateV3, type V3State } from './v3.ts';
import {
  skillMatchFactors,
  playerFatigueMult,
  grantMatchAchievements,
  trainSquadSkills,
  handleSquad,
  formationSlots,
  positionFitMult,
  basePos,
  isBenchPlayer,
  type SquadAction,
  type DetailPos,
} from './squad.ts';
import { handleLife, maybeTriggerLifeEvent, type LifeAction } from './school-life.ts';
import {
  handleCompetition,
  competitionFixture,
  resolveCompetitionMatch,
  readCompetition,
  type CompetitionAction,
} from './competition.ts';
export type Position = 'GK' | 'DF' | 'MF' | 'FW';
export type Stat = 'shoot' | 'pass' | 'defend' | 'speed' | 'mental' | 'keep';
export type Training =
  | 'balance'
  | 'attack'
  | 'possession'
  | 'defense'
  | 'physical'
  | 'rest';
export type Tactic = 'balanced' | 'possession' | 'counter' | 'press';
export type Formation = '4-3-3' | '4-4-2' | '3-4-3';
export type Player = {
  identity: Identity;
  id: number;
  name: string;
  year: number;
  pos: Position;
  stats: Record<Stat, number>;
  fatigue: number;
  injury: number;
  talent: number;
  trait: string;
  goals: number;
  appearances: number;
};
export type Fixture = {
  label: string;
  kind:
    | 'friendly'
    | 'summer'
    | 'qualifier'
    | 'national'
    | 'league'
    | 'ih_qualifier'
    | 'ih_national'
    | 'wc_qualifier'
    | 'wc_national';
  round: number;
  strength: number;
  opponent: string;
  style: Tactic;
};
// 試合後サマリの成長差分（W4）が使う「試合開始時点の能力スナップショット」。
// 旧セーブ（このフィールドが導入される前に開始した試合）には存在しないため必ず省略可能とし、
// UI側は `m.snapshot ?? []` で安全に空として扱う。ここに書くのはキックオフ時点の複製のみで、
// 試合シミュレーションの挙動には一切影響しない（表示専用データ）。
export type MatchSnapshotEntry = {
  id: number;
  stats: Record<Stat, number>;
  extra: { dribble: number; stamina: number; power: number } | null;
  trust: number;
  skills: string[];
  negatives: string[];
  goals: number;
  appearances: number;
};
export type Match = {
  details: MatchDetails;
  fixture: Fixture;
  minute: number;
  home: number;
  away: number;
  shots: [number, number];
  xg: [number, number];
  logs: string[];
  tactic: Tactic;
  mentality: 'safe' | 'normal' | 'attack';
  subs: number;
  used: number[];
  original: number[];
  done: boolean;
  won: boolean;
  penalties: string | null;
  possession: number;
  lastSide: number;
  snapshot?: MatchSnapshotEntry[];
};
export type State = {
  development: Development;
  v3: V3State;
  version: 1;
  seed: number;
  school: string;
  season: number;
  week: number;
  // S1: 1週=7日（月〜日）。0=月…5=土は日次コマンド、6=日は試合（試合の無い週は自動でオフ）。
  // 旧セーブ（このフィールドが導入される前）は validateSave() が 0 を補う。
  day: number;
  // 月〜土6枠の既定練習メニュー。「試合日まで進める」はこのテンプレートで自動進行する。
  // State に持つ（セーブに含まれる）。旧セーブは validateSave() が既定値を補う。
  weeklyMenu: Training[];
  // S1回帰修正: その週（月〜土）に実施した練習メニューの記録。週の練習日が終わる
  // 時点（土曜実施後、日曜の試合／オフの前）で最多メニューを集計し trainSquadSkills /
  // developmentWeek を週1回呼んだ後、空配列にリセットする。旧セーブは空配列で補う。
  weekTrainings: Training[];
  players: Player[];
  lineup: number[];
  formation: Formation;
  reputation: number;
  cohesion: number;
  morale: number;
  facilities: number;
  funds: number;
  focus: number | null;
  pending: Fixture | null;
  match: Match | null;
  event: string | null;
  qualified: boolean;
  alive: boolean;
  summerAlive: boolean;
  history: {
    season: number;
    result: string;
    wins: number;
    goals: number;
    graduates: string[];
  }[];
  records: { wins: number; games: number; goals: number; trophies: number };
  seasonWins: number;
  seasonGoals: number;
  best: string;
  feed: string[];
  nextId: number;
};
export const stats: Record<Stat, string> = {
  shoot: '決定力',
  pass: 'パス',
  defend: '守備',
  speed: '走力',
  mental: '精神力',
  keep: 'GK技術',
};
export const training: Record<
  Training,
  { name: string; desc: string; fatigue: number; stats: Stat[] }
> = {
  balance: {
    name: '総合練習',
    desc: '全能力を少しずつ伸ばす',
    fatigue: 7,
    stats: ['shoot', 'pass', 'defend', 'speed', 'mental', 'keep'],
  },
  attack: {
    name: 'シュート練習',
    desc: '決定力と精神力を磨く',
    fatigue: 10,
    stats: ['shoot', 'mental'],
  },
  possession: {
    name: 'パス＆連携',
    desc: 'パスとチームの連携を強化',
    fatigue: 8,
    stats: ['pass', 'mental'],
  },
  defense: {
    name: '守備トレーニング',
    desc: '守備とGK技術を強化',
    fatigue: 9,
    stats: ['defend', 'keep'],
  },
  physical: {
    name: 'フィジカル',
    desc: '走力を大きく伸ばす',
    fatigue: 14,
    stats: ['speed'],
  },
  rest: {
    name: '休養・ケア',
    desc: '疲労を回復。けがの回復も促す',
    fatigue: -33,
    stats: [],
  },
};
export const tactics: Record<Tactic, { name: string; desc: string }> = {
  balanced: { name: 'バランス', desc: '消耗を抑え、攻守の均衡を保つ' },
  possession: {
    name: 'ポゼッション',
    desc: 'パスで主導権。速攻に強く、プレスに弱い',
  },
  counter: { name: 'カウンター', desc: '走力で速攻。プレスに強く、保持に弱い' },
  press: { name: 'ハイプレス', desc: '前で奪う。保持に強いが疲労が増える' },
};
const surnames = [
  '朝倉',
  '瀬戸',
  '橘',
  '風間',
  '白石',
  '成瀬',
  '相馬',
  '久世',
  '真田',
  '水瀬',
  '蒼井',
  '桐野',
  '一ノ瀬',
  '宮坂',
  '榊',
  '日向',
  '高瀬',
  '七瀬',
  '春野',
  '藤崎',
  '神谷',
  '小暮',
  '城戸',
  '海野',
];
const given = [
  '湊',
  '蓮',
  '悠真',
  '颯',
  '律',
  '陽斗',
  '蒼',
  '直哉',
  '晴人',
  '大和',
  '凪',
  '陸',
  '奏太',
  '翔',
  '悠',
  '透',
  '岳',
  '航',
  '新',
  '瑛太',
  '怜',
  '駿',
  '伊織',
  '海',
];
export const clamp = (n: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, n));
// S1: 曜日名（day: 0=月…6=日）。試合は必ず日曜（day 6）。
export const DOW_NAMES = ['月', '火', '水', '木', '金', '土', '日'] as const;
// 週間メニューの既定値（月〜土）。休養を週2日確保しつつ、パス・シュートで基礎を作る構成。
export const DEFAULT_WEEKLY_MENU: Training[] = [
  'rest',
  'balance',
  'possession',
  'attack',
  'balance',
  'rest',
];
// S3: 部員数の上限・下限。試合登録20人（先発11＋ベンチ9）をAチームがそのまま満たせる
// よう最小20人、評判・施設が伸びた部の現実的な上限として最大50人。
export const ROSTER_MIN = 20;
export const ROSTER_MAX = 50;
// S3: 1試合あたりの交代上限。旧仕様(3人)の途中セーブも読み込める（validateSaveが吸収）。
export const MATCH_MAX_SUBS = 5;
// 新入生の学年内ポジション構成（初期3学年20人と概ね同じ比率: GK2:DF6:MF6:FW4）。
// 卒業で空いた枠を超えて部員を増やすときの「純増分」はここから重み付きで選ぶ。
const INTAKE_POS_POOL: Position[] = [
  'GK',
  'DF',
  'DF',
  'MF',
  'MF',
  'FW',
  'DF',
  'DF',
  'MF',
  'MF',
  'FW',
  'FW',
  'GK',
  'DF',
  'DF',
  'MF',
  'MF',
  'FW',
];
function rand(s: State) {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
function pick<T>(s: State, a: T[]): T {
  return a[Math.floor(rand(s) * a.length)];
}
function log(s: State, t: string) {
  s.feed = [t, ...s.feed].slice(0, 30);
}
export function overall(p: Player) {
  const weights: Record<Position, Stat[]> = {
    GK: ['keep', 'mental', 'defend'],
    DF: ['defend', 'speed', 'mental'],
    MF: ['pass', 'mental', 'speed'],
    FW: ['shoot', 'speed', 'mental'],
  };
  return Math.round(weights[p.pos].reduce((a, k) => a + p.stats[k], 0) / 3);
}
// 旧来の粗い4分類。フォーメーションのスロットは formationSlots() が返す DetailPos が
// 正であり、slots() はそこから basePos() で丸めた互換ビュー（並び順は完全に一致する）。
export function slots(f: Formation): Position[] {
  return formationSlots(f).map(basePos);
}
export function roster(s: State) {
  return s.lineup.map((id) => s.players.find((p) => p.id === id)!);
}
export function strength(s: State) {
  const dslots = formationSlots(s.formation);
  return Math.round(
    roster(s).reduce((a, p, i) => a + effective(s, p, dslots[i]), 0) / 11,
  );
}
// スロットが要求する詳細ポジションへの適性で総合力を減衰させる。
// 完全一致=1.0、同じ basePos 内の別ポジション=0.92 程度、basePos をまたぐ場合は
// 現行どおり重いペナルティ（GK とフィールドプレイヤーの相互起用が最も重い）。
function effective(s: State, p: Player, slot: DetailPos) {
  const ps = s.v3?.squad?.players[p.id];
  const fit = ps
    ? positionFitMult(ps.detail, slot)
    : p.pos === basePos(slot)
      ? 1
      : p.pos === 'GK' || basePos(slot) === 'GK'
        ? 0.48
        : 0.8;
  return (
    overall(p) * fit * (1 - p.fatigue * 0.004) * (p.injury ? 0.5 : 1)
  );
}
function makePlayer(s: State, year: number, pos: Position): Player {
  const id = s.nextId++,
    base = 32 + year * 5 + Math.min(18, s.reputation * 0.2);
  const p: Player = {
    identity: identityFor(id),
    id,
    name: `${surnames[id % surnames.length]} ${given[(id * 7 + Math.floor(rand(s) * 24)) % 24]}`,
    year,
    pos,
    stats: {} as Record<Stat, number>,
    fatigue: Math.floor(rand(s) * 12),
    injury: 0,
    talent: 1 + rand(s) * 0.55,
    trait: pick(s, ['努力家', '冷静', '闘志', 'ムードメーカー']),
    goals: 0,
    appearances: 0,
  };
  for (const k of Object.keys(stats) as Stat[])
    p.stats[k] = Math.round(base + rand(s) * 20);
  p.stats[
    pos === 'GK'
      ? 'keep'
      : pos === 'DF'
        ? 'defend'
        : pos === 'MF'
          ? 'pass'
          : 'shoot'
  ] += 9;
  return p;
}
// S3: 先発（＝試合登録20人の一部）はAチームの選手からのみ選ぶ。Aチームは常に
// 20人以上（ROSTER_MIN=20）いるので11人を選べないことはない。
export function autoLineup(s: State) {
  const left = s.players.filter((p) => s.v3?.squad?.players[p.id]?.team === 'A');
  s.lineup = formationSlots(s.formation).map((slot) => {
    left.sort((a, b) => effective(s, b, slot) - effective(s, a, slot));
    return left.shift()!.id;
  });
}
export function newGame(
  school = '風見ヶ丘高校',
  seed = Date.now() >>> 0,
): State {
  const s: State = {
    development: null!,
    v3: null!,
    version: 1,
    seed,
    school: school.trim().slice(0, 20) || '風見ヶ丘高校',
    season: 1,
    week: 0,
    day: 0,
    weeklyMenu: [...DEFAULT_WEEKLY_MENU],
    weekTrainings: [],
    players: [],
    lineup: [],
    formation: '4-3-3',
    reputation: 15,
    cohesion: 45,
    morale: 70,
    facilities: 1,
    funds: 25,
    focus: null,
    pending: null,
    match: null,
    event: null,
    qualified: false,
    alive: true,
    summerAlive: true,
    history: [],
    records: { wins: 0, games: 0, goals: 0, trophies: 0 },
    seasonWins: 0,
    seasonGoals: 0,
    best: '大会未出場',
    feed: ['新しい春。20人の部員と、全国への一歩を踏み出そう。'],
    nextId: 1,
  };
  // S3: 新規ゲームは部員20人（各学年6〜7人、試合登録20人＝先発11＋ベンチ9をそのまま満たす）。
  const positions: Position[][] = [
    ['GK', 'DF', 'DF', 'DF', 'MF', 'MF', 'FW'],
    ['DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW'],
    ['GK', 'DF', 'DF', 'MF', 'FW', 'FW'],
  ];
  for (let y = 1; y <= 3; y++)
    for (const pos of positions[y - 1]) s.players.push(makePlayer(s, y, pos));
  hydrateV3(s);
  autoLineup(s);
  s.development = newDevelopment(s);
  return s;
}
export function dateLabel(s: State) {
  return `${((Math.floor(s.week / 4) + 3) % 12) + 1}月 第${(s.week % 4) + 1}週 ${DOW_NAMES[s.day]}曜`;
}
// S3: 新入生の人数。評判が低いと卒業人数の補充程度（部員20人前後を維持）、評判が
// 高いと年12〜20人まで純増する。施設は高評判側の伸びを少し後押しする程度。
// 上限50・下限20（ROSTER_MIN/MAX）でクランプする。
function intakeSize(s: State, remaining: number, gradCount: number): number {
  const rep = clamp(s.reputation, 0, 100) / 100;
  const low = gradCount; // 評判0想定: 卒業人数の補充のみ
  const high = 12 + Math.round(rep * 8) + (s.facilities - 1); // 評判1想定: 12〜20+施設分
  const base = low + (high - low) * rep;
  // 下限側は ROSTER_MIN の「片側だけ跳ね返す」floor（後段）にゆらぎが吸収されて
  // 部員が漸増し続けないよう、ゆらぎは小さめ（±1）にする。
  const n = clamp(Math.round(base + rand(s) * 2 - 1), 0, 20);
  const floor = Math.max(0, ROSTER_MIN - remaining);
  const ceil = Math.max(0, ROSTER_MAX - remaining);
  return Math.min(Math.max(n, floor), ceil);
}
function finishWeek(s: State) {
  s.week++;
  if (s.week === 48) {
    const grads = s.players.filter((p) => p.year === 3);
    s.history.unshift({
      season: s.season,
      result: s.best,
      wins: s.seasonWins,
      goals: s.seasonGoals,
      graduates: grads.map((p) => p.name),
    });
    s.history = s.history.slice(0, 20);
    s.players = s.players.filter((p) => p.year < 3);
    s.players.forEach((p) => {
      p.year++;
      p.fatigue = 0;
      p.injury = 0;
    });
    // 卒業した枠は同じポジションで補充し、評判・施設で伸びた分は幅広いポジションで純増させる。
    const n = intakeSize(s, s.players.length, grads.length);
    const gradPos = grads.map((p) => p.pos);
    const fresh: Player[] = [];
    for (let i = 0; i < n; i++)
      fresh.push(
        makePlayer(s, 1, i < gradPos.length ? gradPos[i] : pick(s, INTAKE_POS_POOL)),
      );
    s.players.push(...fresh);
    s.week = 0;
    s.season++;
    s.alive = true;
    s.summerAlive = true;
    s.qualified = false;
    s.seasonWins = 0;
    s.seasonGoals = 0;
    s.best = '大会未出場';
    s.focus = null;
    s.cohesion = Math.max(35, s.cohesion - 18);
    s.funds += 25;
    s.morale = 75;
    applyIntake(s, fresh);
    hydrateV3(s);
    autoLineup(s);
    log(
      s,
      `${grads.length}人が卒業。新入生${fresh.length}人が入部しました。部員は${s.players.length}人です。${s.season}年目の春です。`,
    );
  }
  syncHalf(s);
}
// S1: 週の1日ぶんの疲労回復確率。旧仕様の「fatigue>65なら週13%でけが」を、
// 1-(1-0.13)^(1/6) ≒ 2.27%/日に決定的に換算する（6日続けても週あたりの
// 発生率がほぼ変わらないようにするため）。
const DAILY_INJURY_CHANCE = 1 - Math.pow(0.87, 1 / 6);
// S1: 1日分の練習・休養を適用する（成長は旧・週あたり効果の1/6、疲労は
// 練習日=旧・週あたり疲労の1/6を加算しつつ自然回復-3、休養日は-15固定）。
// けがの回復も旧・週あたり回復量を7日で割った量にする。
// スキル習得(trainSquadSkills)と半年方針の進捗(developmentWeek)は週単位の
// 仕組み（streak・8回で達成など）のままなので、週の練習日（月〜土）が終わる
// 時点で週1回だけ呼ぶ（finishDay 参照）。日次×6回呼ぶと同じ週内で無関係に
// 何度も抽選が走ってしまうのを避けるため、実施したメニューは s.weekTrainings に
// 記録しておき、週末にまとめて集計する。
function advanceTrainingDay(s: State, tr: Training): { injured: boolean } {
  const t = training[tr];
  const isRest = tr === 'rest';
  let growth = 0;
  let injured = false;
  for (const p of s.players) {
    p.injury = Math.max(0, p.injury - (isRest ? 2 : 1) / 7);
    if (!p.injury && !isRest) {
      for (const k of t.stats) {
        const gain =
          ((t.stats.length === 6 ? 0.45 : t.stats.length === 1 ? 1.65 : 1.05) *
            p.talent *
            (1 + (s.facilities - 1) * 0.14) *
            (1 - p.fatigue / 150) *
            (p.id === s.focus ? 1.5 : 1) *
            (p.stats[k] > 85 ? 0.35 : 1) *
            growthFactor(s, p, k)) /
          6;
        p.stats[k] = clamp(p.stats[k] + gain, 20, 99);
        growth += gain;
      }
      if (p.fatigue > 65 && rand(s) < DAILY_INJURY_CHANCE) {
        p.injury = 2;
        injured = true;
        log(s, `${p.name}が筋肉に張り。数日の調整が必要です。`);
      }
    }
    p.fatigue = clamp(p.fatigue + (isRest ? -15 : t.fatigue / 6 - 3));
  }
  s.cohesion = clamp(
    s.cohesion + (tr === 'possession' ? 4 : isRest ? -1 : 1) / 6,
  );
  s.morale = clamp(s.morale + (isRest ? 5 : -1) / 6);
  if (s.day === 0) s.funds += 2;
  s.weekTrainings.push(tr);
  log(
    s,
    `${dateLabel(s)}：${t.name}。${isRest ? '選手の疲労が回復しました。' : `チーム全体で能力が計${Math.round(growth)}成長。`}`,
  );
  return { injured };
}
// 回帰修正: その週（月〜土）に実施したメニューのうち、休養を除いて最も多く
// 実施したものを返す（同数なら後に実施した方）。全日休養なら 'rest'。
function weeklyPrimaryMenu(s: State): Training {
  const counts = new Map<Training, number>();
  const lastIndex = new Map<Training, number>();
  s.weekTrainings.forEach((t, i) => {
    if (t === 'rest') return;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    lastIndex.set(t, i);
  });
  let best: Training | null = null;
  let bestCount = -1;
  let bestLast = -1;
  for (const [t, c] of counts) {
    const li = lastIndex.get(t)!;
    if (c > bestCount || (c === bestCount && li > bestLast)) {
      best = t;
      bestCount = c;
      bestLast = li;
    }
  }
  return best ?? 'rest';
}
// S1: 1日ぶんの処理の後に呼ぶ。day を進め、日曜(6)に達したら試合の有無を判定する。
// 試合が組まれていればその日で止まり（s.pending）、無ければ即座に週を終えて
// 翌週の月曜(day 0)へ進む（従来どおりクラブイベントは7週ごとに判定）。
// 回帰修正: day が6（日曜）に達した時点＝週の練習日(月〜土)が終わった時点で、
// trainSquadSkills / developmentWeek を週1回だけ呼ぶ（試合の有無に関わらず、
// 日曜の試合／オフより前）。
function finishDay(s: State) {
  s.day++;
  if (s.day === 6) {
    const menu = weeklyPrimaryMenu(s);
    trainSquadSkills(s, menu);
    developmentWeek(s, menu);
    s.weekTrainings = [];
    const f = competitionFixture(s, s.week);
    if (f) {
      s.pending = f;
    } else {
      finishWeek(s);
      s.day = 0;
      if (s.week > 0 && s.week % 7 === 0)
        s.event = pick(s, [
          '部員たちの自主練習',
          '主将からの提案',
          '雨の日のミーティング',
        ]);
    }
  }
}
export type Action =
  | DevelopmentAction
  | SquadAction
  | LifeAction
  | CompetitionAction
  | { type: 'train'; training: Training }
  | { type: 'autoWeek' }
  | { type: 'setMenu'; menu: Training[] }
  | { type: 'event'; choice: 'team' | 'individual' }
  | { type: 'formation'; formation: Formation }
  | { type: 'swap'; index: number; id: number }
  | { type: 'auto' }
  | { type: 'focus'; id: number | null }
  | { type: 'upgrade' }
  | { type: 'start' }
  | { type: 'tactic'; tactic: Tactic }
  | { type: 'mentality'; mentality: Match['mentality'] }
  | { type: 'segment' }
  | { type: 'finish' };
export function act(old: State, a: Action): State {
  const s = hydrateDevelopment(structuredClone(old));
  hydrateV3(s);
  if (handleDevelopment(s, a as DevelopmentAction)) return s;
  if (handleSquad(s, a as SquadAction)) return s;
  if (handleLife(s, a)) return s;
  if (handleCompetition(s, a)) return s;
  if (a.type === 'train') {
    if (s.pending || s.match || s.event || s.v3.life.current)
      throw Error('試合または部内イベントを先に終えてください。');
    if (!(a.training in training)) throw Error('練習メニューが不正です。');
    advanceTrainingDay(s, a.training);
    maybeTriggerLifeEvent(s);
    finishDay(s);
    return s;
  }
  if (a.type === 'autoWeek') {
    if (s.pending || s.match || s.event || s.v3.life.current)
      throw Error('試合または部内イベントを先に終えてください。');
    let guard = 0;
    // 「試合日まで進める」: 週間メニューで自動進行し、試合が見つかるか、
    // 日常イベント・クラブイベント・けがが起きたその日で止まる。最悪でも
    // ガード上限（十分な週数分）で必ず終了する。
    while (!s.pending && !s.event && !s.v3.life.current && guard < 60) {
      guard++;
      const t = s.weeklyMenu[s.day] ?? 'balance';
      const { injured } = advanceTrainingDay(s, t in training ? t : 'balance');
      maybeTriggerLifeEvent(s);
      finishDay(s);
      if (injured) break;
    }
    return s;
  }
  if (a.type === 'setMenu') {
    if (
      !Array.isArray(a.menu) ||
      a.menu.length !== 6 ||
      a.menu.some((t) => !(t in training))
    )
      throw Error('週間メニューが不正です。');
    s.weeklyMenu = [...a.menu];
    return s;
  }
  if (a.type === 'event') {
    if (!s.event) throw Error('イベントはありません。');
    if (a.choice === 'team') {
      s.cohesion = clamp(s.cohesion + 7);
      s.morale = clamp(s.morale + 8);
      log(s, '仲間との対話で連携と士気が上がりました。');
    } else {
      const p = s.players.find((p) => p.id === s.focus) || pick(s, s.players);
      for (const k of Object.keys(stats) as Stat[])
        p.stats[k] = clamp(p.stats[k] + 2, 20, 99);
      log(s, `${p.name}の自主練習を指導。全能力が2上がりました。`);
    }
    s.event = null;
    return s;
  }
  if (a.type === 'segment') {
    if (!s.match || s.match.done) throw Error('進行できる試合がありません。');
    simulateSegment(s);
    return s;
  }
  if (a.type === 'finish') {
    if (!s.match?.done) throw Error('試合が終了していません。');
    s.lineup = s.match.original;
    s.match = null;
    s.pending = null;
    finishWeek(s);
    s.day = 0; // 試合(日曜)を終えたので翌週の月曜へ
    return s;
  }
  if (a.type === 'tactic' || a.type === 'mentality') {
    if (!s.match || s.match.done) throw Error('試合中のみ変更できます。');
    if (a.type === 'tactic') {
      if (!(a.tactic in tactics)) throw Error('戦術が不正です。');
      s.match.tactic = a.tactic;
    } else if (['safe', 'normal', 'attack'].includes(a.mentality))
      s.match.mentality = a.mentality;
    return s;
  }
  if (a.type === 'start') {
    if (!s.pending || s.match) throw Error('予定された試合がありません。');
    s.match = {
      details: matchDetails(),
      fixture: s.pending,
      minute: 0,
      home: 0,
      away: 0,
      shots: [0, 0],
      xg: [0, 0],
      logs: ['キックオフ。15分ごとに戦術と交代を指示できます。'],
      tactic: 'balanced',
      mentality: 'normal',
      subs: 0,
      used: [...s.lineup],
      original: [...s.lineup],
      done: false,
      won: false,
      penalties: null,
      possession: 50,
      lastSide: 0,
      snapshot: s.players.map((p) => {
        const ps = s.v3.squad.players[p.id];
        return {
          id: p.id,
          stats: { ...p.stats },
          extra: ps ? { dribble: ps.dribble, stamina: ps.stamina, power: ps.power } : null,
          trust: p.identity.trust,
          skills: ps ? [...ps.skills] : [],
          negatives: ps ? [...ps.negatives] : [],
          goals: p.goals,
          appearances: p.appearances,
        };
      }),
    };
    return s;
  }
  if (a.type === 'swap') {
    const incoming = s.players.find((p) => p.id === a.id);
    if (!incoming || a.index < 0 || a.index > 10)
      throw Error('選手を選び直してください。');
    const idx = s.lineup.indexOf(a.id);
    if (s.match) {
      // S3: 交代は最大5人。ベンチ入り（Aチームの先発以外9人）の選手しか投入できない
      // （Bチームの選手や、ベンチ外のAチームの選手は交代投入できない）。
      const isBench = isBenchPlayer(s, a.id);
      if (
        s.match.done ||
        s.match.subs >= MATCH_MAX_SUBS ||
        s.match.used.includes(a.id) ||
        incoming.injury ||
        !isBench
      )
        throw Error(`交代はベンチの健康な選手と${MATCH_MAX_SUBS}人までです。`);
      if (s.match.details.commands.player === s.lineup[a.index]) {
        s.match.details.commands.player = null;
        s.match.details.commands.role = 'free';
      }
      s.match.subs++;
      s.match.used.push(a.id);
      s.match.logs.unshift(
        `${s.match.minute}′ 交代：${s.players.find((p) => p.id === s.lineup[a.index])?.name} → ${incoming.name}`,
      );
    } else {
      // S3: 試合前の先発編成はAチーム（試合登録20人）の選手からのみ選べる。
      if (s.v3.squad.players[a.id]?.team !== 'A')
        throw Error('先発にはAチームの選手のみ指定できます。');
      if (idx >= 0) s.lineup[idx] = s.lineup[a.index];
    }
    s.lineup[a.index] = a.id;
    return s;
  }
  if (s.match) throw Error('試合を終えてから変更してください。');
  if (a.type === 'auto') autoLineup(s);
  if (a.type === 'formation') {
    if (!['4-3-3', '4-4-2', '3-4-3'].includes(a.formation))
      throw Error('布陣が不正です。');
    s.formation = a.formation;
    autoLineup(s);
  }
  if (a.type === 'focus') {
    if (a.id !== null && !s.players.some((p) => p.id === a.id))
      throw Error('選手が見つかりません。');
    s.focus = a.id;
  }
  if (a.type === 'upgrade') {
    const cost = s.facilities * 40;
    if (s.funds < cost || s.facilities >= 5)
      throw Error('部費が足りないか、設備が最高レベルです。');
    s.funds -= cost;
    s.facilities++;
    log(s, `練習設備がLv.${s.facilities}に。練習の成長効率が上がります。`);
  }
  return s;
}
function simulateSegment(s: State) {
  const m = s.match!,
    team = roster(s),
    rating = strength(s),
    style = m.fixture.style;
  const advantage =
    (m.tactic === 'possession' && style === 'counter') ||
    (m.tactic === 'counter' && style === 'press') ||
    (m.tactic === 'press' && style === 'possession')
      ? 1.17
      : m.tactic !== 'balanced' && m.tactic !== style
        ? 0.87
        : 1;
  const stat = (k: Stat) =>
    team.reduce((a, p) => a + p.stats[k] * (1 - p.fatigue * 0.003), 0) / 11;
  const tacticQuality =
    m.tactic === 'possession'
      ? stat('pass')
      : m.tactic === 'counter'
        ? stat('speed')
        : m.tactic === 'press'
          ? (stat('defend') + stat('speed')) / 2
          : rating;
  const command = commandFactors(s);
  const skillFx = skillMatchFactors(s);
  const ratio = clamp(
    (rating * 0.65 +
      tacticQuality * 0.35 +
      s.cohesion * 0.09 +
      (s.morale - 50) * 0.1) /
      m.fixture.strength +
      skillFx.ratioBonus +
      (m.home < m.away ? skillFx.comebackBonus : 0),
    0.4,
    1.9,
  );
  const push =
    m.mentality === 'attack' ? 1.32 : m.mentality === 'safe' ? 0.75 : 1;
  m.details.highlights = [];
  const homeRate =
      0.29 *
      ratio *
      advantage *
      push *
      (m.tactic === 'press' ? 1.15 : 1) *
      command.attack *
      skillFx.attack,
    awayRate =
      (0.28 / ratio / advantage) *
      (m.mentality === 'attack' ? 1.3 : m.mentality === 'safe' ? 0.73 : 1) *
      command.defense *
      skillFx.defense;
  let goal = false;
  const events: [number, string][] = [];
  for (let i = 0; i < 3; i++) {
    const minute = m.minute + Math.round(1 + rand(s) * 14);
    for (let side = 0; side < 2; side++) {
      const rate = side === 0 ? homeRate : awayRate;
      if (rand(s) < rate * 1.9) {
        m.shots[side]++;
        const chance = clamp(
          (0.15 + rand(s) * 0.22 + (side === 0 ? (stat('shoot') - 55) / 500 : 0)) *
            (side === 0 ? skillFx.finish : skillFx.oppFinish),
          0.1,
          0.5,
        );
        m.xg[side] += chance;
        if (rand(s) < chance) {
          if (side === 0) {
            m.home++;
            const scorers = team.filter(
                (p) => p.pos === 'FW' || p.pos === 'MF',
              ),
              scorer = pick(s, scorers.length ? scorers : team);
            scorer.goals++;
            m.details.highlights.push({
              id: `${minute}-${side}-${i}`,
              minute,
              kind: 'goal',
              side: 0,
              playerId: scorer.id,
              name: scorer.name,
              lane: m.details.commands.lane,
            });
            events.push([
              minute,
              `${minute}′ GOAL！ ${scorer.name}がネットを揺らす！`,
            ]);
          } else {
            m.away++;
            m.details.highlights.push({
              id: `${minute}-${side}-${i}`,
              minute,
              kind: 'goal',
              side: 1,
              playerId: team[0].id,
              name: m.fixture.opponent,
              lane: m.details.commands.lane,
            });
            events.push([
              minute,
              `${minute}′ 失点。${m.fixture.opponent}がゴール。`,
            ]);
          }
          m.lastSide = side;
          goal = true;
        } else {
          const keeper = team[0];
          m.details.highlights.push({
            id: `${minute}-${side}-${i}`,
            minute,
            kind: 'save',
            side: side as 0 | 1,
            playerId: keeper.id,
            name: side === 1 ? keeper.name : m.fixture.opponent + ' GK',
            lane: m.details.commands.lane,
          });
        }
      }
    }
  }
  m.details.highlights.sort((a, b) => a.minute - b.minute);
  events.sort((x, y) => x[0] - y[0]);
  for (const e of events) m.logs.unshift(e[1]);
  m.minute += 15;
  m.possession = Math.round(
    clamp(
      50 +
        (ratio - 1) * 15 +
        (m.tactic === 'possession' ? 10 : m.tactic === 'counter' ? -10 : 0),
      25,
      75,
    ),
  );
  if (!goal)
    m.logs.unshift(
      `${m.minute}′ ${pick(s, ['中盤で激しいボールの奪い合い。', 'サイドから好機をうかがう。', '最後のパスがわずかに合わない。', '集中した守備でシュートを防いだ。'])}`,
    );
  for (const p of team)
    p.fatigue = clamp(
      p.fatigue +
        (m.tactic === 'press' ? 8 : 5) *
          playerFatigueMult(s, p.id) +
        (m.mentality === 'attack' ? 1 : 0) +
        command.fatigue +
        (m.details.commands.player === p.id &&
        m.details.commands.role === 'attack'
          ? 2
          : 0),
    );
  createMoment(s);
  if (m.minute === 45)
    m.logs.unshift('HALF TIME：疲労を確認して、交代と後半の戦術を決めよう。');
  if (m.minute >= 90) {
    m.done = true;
    m.won = m.home > m.away;
    if (m.home === m.away && !['friendly', 'league'].includes(m.fixture.kind)) {
      m.won =
        rand(s) <
        clamp(
          0.5 +
            (stat('mental') - m.fixture.strength) / 180 +
            (skillFx.pkMult - 1) +
            (1 - skillFx.pkStopMult),
          0.25,
          0.75,
        );
      m.penalties = m.won ? '5 - 4' : '4 - 5';
      m.logs.unshift(
        `PK戦 ${m.penalties}。${m.won ? '勝利！' : '惜しくも敗退。'}`,
      );
    }
    s.records.games++;
    s.records.goals += m.home;
    s.seasonGoals += m.home;
    for (const id of m.used) {
      const p = s.players.find((p) => p.id === id)!;
      p.appearances++;
      p.stats.mental = clamp(p.stats.mental + 0.5, 20, 99);
    }
    if (m.won) {
      s.records.wins++;
      s.seasonWins++;
      s.reputation = clamp(
        s.reputation + (m.fixture.kind === 'friendly' ? 1 : 3),
      );
      s.morale = clamp(s.morale + 7);
      s.funds += m.fixture.kind === 'friendly' ? 5 : 12;
    } else s.morale = clamp(s.morale - 4);
    resolveCompetitionMatch(s, m);
    if (
      m.fixture.kind === 'ih_qualifier' ||
      m.fixture.kind === 'ih_national' ||
      m.fixture.kind === 'wc_qualifier' ||
      m.fixture.kind === 'wc_national'
    ) {
      const comp = readCompetition(s);
      s.best = m.fixture.kind.startsWith('ih') ? comp.ih.best : comp.wc.best;
    }
    log(
      s,
      `${m.fixture.label}：${s.school} ${m.home} - ${m.away} ${m.fixture.opponent}${m.penalties ? '（PK ' + m.penalties + '）' : ''}`,
    );
    grantMatchAchievements(s);
  }
}
export function validateSave(x: unknown): State {
  if (!x || typeof x !== 'object') throw Error('セーブ形式が違います。');
  const s = x as State;
  // S1: 旧セーブ（day / weeklyMenu 導入前）を決定的に補う。フィールドが「無い」場合のみ
  // 補完し、値が存在するのに不正な場合は下の厳密なチェックで拒否させる（壊れたセーブを
  // 黙って直してしまわないため）。日は「月曜から」だが、試合が保留中(pending)のセーブは
  // 日曜(6)扱いにする（pendingは day===6 の時にしか立たないため）。
  if (s.day === undefined) s.day = s.pending ? 6 : 0;
  if (s.weeklyMenu === undefined) s.weeklyMenu = [...DEFAULT_WEEKLY_MENU];
  // 回帰修正: 週内の実施記録が無いセーブ（導入前、または pending 中で既に
  // リセット済み）は空配列で補う。
  if (s.weekTrainings === undefined) s.weekTrainings = [];
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (
    s.version !== 1 ||
    typeof s.school !== 'string' ||
    s.school.length > 20 ||
    !num(s.seed, 0, 4294967295) ||
    !num(s.season, 1, 100000) ||
    !Number.isInteger(s.season) ||
    !num(s.week, 0, 47) ||
    !Number.isInteger(s.week) ||
    !num(s.day, 0, 6) ||
    !Number.isInteger(s.day) ||
    !Array.isArray(s.weeklyMenu) ||
    s.weeklyMenu.length !== 6 ||
    s.weeklyMenu.some((t) => !(t in training)) ||
    !Array.isArray(s.weekTrainings) ||
    s.weekTrainings.length > 6 ||
    s.weekTrainings.some((t) => !(t in training)) ||
    !Array.isArray(s.players) ||
    s.players.length < ROSTER_MIN ||
    s.players.length > ROSTER_MAX ||
    !['4-3-3', '4-4-2', '3-4-3'].includes(s.formation)
  )
    throw Error('このセーブは対応していないか、壊れています。');
  for (const p of s.players) {
    if (
      !p ||
      !Number.isInteger(p.id) ||
      typeof p.name !== 'string' ||
      p.name.length > 40 ||
      !['GK', 'DF', 'MF', 'FW'].includes(p.pos) ||
      ![1, 2, 3].includes(p.year) ||
      !num(p.fatigue, 0, 100) ||
      !num(p.injury, 0, 5) ||
      !num(p.talent, 1, 2) ||
      typeof p.trait !== 'string' ||
      !num(p.goals, 0, 1000000) ||
      !num(p.appearances, 0, 1000000) ||
      !p.stats ||
      !Object.keys(stats).every((k) => num(p.stats[k as Stat], 20, 99))
    )
      throw Error('選手データを読み込めません。');
  }
  const ids = s.players.map((p) => p.id);
  if (
    new Set(ids).size !== s.players.length ||
    !Array.isArray(s.lineup) ||
    s.lineup.length !== 11 ||
    new Set(s.lineup).size !== 11 ||
    s.lineup.some((id) => !ids.includes(id)) ||
    !num(s.nextId, Math.max(...ids) + 1, 10000000) ||
    !num(s.reputation, 0, 100) ||
    !num(s.cohesion, 0, 100) ||
    !num(s.morale, 0, 100) ||
    !num(s.facilities, 1, 5) ||
    !num(s.funds, 0, 10000000) ||
    !num(s.seasonWins, 0, 1000) ||
    !num(s.seasonGoals, 0, 10000) ||
    typeof s.best !== 'string' ||
    !Array.isArray(s.feed) ||
    s.feed.length > 30 ||
    s.feed.some((t) => typeof t !== 'string' || t.length > 500) ||
    !Array.isArray(s.history) ||
    s.history.length > 20 ||
    !s.records ||
    !['wins', 'games', 'goals', 'trophies'].every((k) =>
      num(s.records[k as keyof State['records']], 0, 10000000),
    ) ||
    !['qualified', 'alive', 'summerAlive'].every(
      (k) => typeof s[k as keyof State] === 'boolean',
    ) ||
    (s.focus !== null && !ids.includes(s.focus)) ||
    (s.event !== null && typeof s.event !== 'string')
  )
    throw Error('部活動データを読み込めません。');
  for (const h of s.history)
    if (
      !h ||
      !num(h.season, 1, 100000) ||
      typeof h.result !== 'string' ||
      !num(h.wins, 0, 1000) ||
      !num(h.goals, 0, 10000) ||
      !Array.isArray(h.graduates) ||
      h.graduates.some((n) => typeof n !== 'string' || n.length > 40)
    )
      throw Error('年度記録が不正です。');
  const fixture = (f: Fixture) =>
    f &&
    [
      'friendly',
      'summer',
      'qualifier',
      'national',
      'league',
      'ih_qualifier',
      'ih_national',
      'wc_qualifier',
      'wc_national',
    ].includes(f.kind) &&
    num(f.round, 0, 4) &&
    num(f.strength, 1, 200) &&
    typeof f.label === 'string' &&
    f.label.length < 100 &&
    typeof f.opponent === 'string' &&
    f.opponent.length < 100 &&
    Object.keys(tactics).includes(f.style);
  if (s.pending && !fixture(s.pending)) throw Error('日程データが不正です。');
  // S1: 試合が保留中(pending)なのは day が日曜(6)に達した時だけ。試合中でない限りは
  // 月〜土(0〜5)のはず。
  if (s.pending && s.day !== 6) throw Error('曜日データが不正です。');
  if (!s.pending && !s.match && s.day === 6) throw Error('曜日データが不正です。');
  if (s.match) {
    const m = s.match;
    if (
      !s.pending ||
      !fixture(m.fixture) ||
      !num(m.minute, 0, 90) ||
      m.minute % 15 !== 0 ||
      !num(m.home, 0, 100) ||
      !num(m.away, 0, 100) ||
      !num(m.subs, 0, MATCH_MAX_SUBS) ||
      !Array.isArray(m.logs) ||
      m.logs.length > 100 ||
      m.logs.some((t) => typeof t !== 'string' || t.length > 500) ||
      !Array.isArray(m.original) ||
      m.original.length !== 11 ||
      new Set(m.original).size !== 11 ||
      m.original.some((id) => !ids.includes(id)) ||
      !Array.isArray(m.used) ||
      m.used.length > 11 + MATCH_MAX_SUBS ||
      m.used.some((id) => !ids.includes(id)) ||
      ![m.shots, m.xg].every(
        (a) =>
          Array.isArray(a) && a.length === 2 && a.every((n) => num(n, 0, 1000)),
      ) ||
      !Object.keys(tactics).includes(m.tactic) ||
      !['safe', 'normal', 'attack'].includes(m.mentality) ||
      typeof m.done !== 'boolean' ||
      m.done !== (m.minute === 90) ||
      typeof m.won !== 'boolean' ||
      !num(m.possession, 0, 100) ||
      ![0, 1].includes(m.lastSide) ||
      (m.penalties !== null && typeof m.penalties !== 'string')
    )
      throw Error('試合データが不正です。');
    // snapshot は試合後サマリの成長差分表示にのみ使う表示専用データで、これが導入される前に
    // 開始した試合のセーブには存在しない。存在しない場合は許容し、UI側で空として扱う。
    if (s.match.snapshot !== undefined) {
      const validExtra = (e: unknown) =>
        e === null ||
        (!!e &&
          typeof e === 'object' &&
          (['dribble', 'stamina', 'power'] as const).every((k) =>
            num((e as Record<string, unknown>)[k], 0, 100),
          ));
      if (
        !Array.isArray(s.match.snapshot) ||
        s.match.snapshot.length > ROSTER_MAX ||
        !s.match.snapshot.every(
          (e) =>
            e &&
            Number.isInteger(e.id) &&
            ids.includes(e.id) &&
            e.stats &&
            Object.keys(stats).every((k) => num(e.stats[k as Stat], 0, 100)) &&
            validExtra(e.extra) &&
            num(e.trust, 0, 100) &&
            Array.isArray(e.skills) &&
            e.skills.length <= 10 &&
            e.skills.every((id) => typeof id === 'string' && id.length <= 40) &&
            Array.isArray(e.negatives) &&
            e.negatives.length <= 10 &&
            e.negatives.every((id) => typeof id === 'string' && id.length <= 40) &&
            num(e.goals, 0, 1000000) &&
            num(e.appearances, 0, 1000000),
        )
      )
        throw Error('試合開始時スナップショットが不正です。');
    }
  }
  const hydrated = hydrateDevelopment(structuredClone(s));
  hydrateV3(hydrated);
  return validateV3(validateDevelopment(hydrated));
}
