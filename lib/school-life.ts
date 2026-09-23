// TOUCHLINE ACADEMY v3 — W3: 日常イベント（学校生活）
//
// 単体で完結するモジュール。lib/game.ts と lib/squad.ts の「公開API」だけを使い、
// それらのファイル自体は一切変更しない。State['v3'] にはまだ `life` フィールドが
// 型として存在しないため（lib/v3.ts は統括側が配線する）、このファイルの内部では
// `withLife()` という小さな型キャストヘルパーを介して s.v3.life を読み書きする。
// 統括側が lib/v3.ts の V3State に `life: LifeState` を正式に足せば、このキャストは
// 不要になるが、足さなくてもランタイムには一切問題がない（実データは常に
// hydrateLife() が作る）。
//
// 配線手順は本ファイル末尾のコメントを参照。

import { clamp, type State, type Player, type Stat } from './game.ts';
import type { Personality } from './development.ts';
import { grantSkill, type Archetype } from './squad.ts';

// ---------------------------------------------------------------------------
// 決定的な擬似乱数（lib/squad.ts の h32/hf と同じ考え方。s.seed を消費せず、
// s.seed・s.week・s.season などを種にしたハッシュで決定的に値を作る）
// ---------------------------------------------------------------------------
function h32(...ns: number[]): number {
  let x = 2166136261 >>> 0;
  for (const n of ns) x = Math.imul(x ^ (n >>> 0), 16777619) >>> 0;
  // 仕上げの avalanche（murmur3 fmix32 相当）。FNV系の単純な XOR→乗算だけだと、
  // 末尾に渡した小さい値（week など）が出力の上位ビットまで十分に伝播せず、
  // 結果が狭い範囲に偏ることがあるため、最後に必ずこの仕上げをかける。
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
function hf(...ns: number[]): number {
  return h32(...ns) / 4294967296;
}
function strHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------
export type LifeCategory = '学校行事' | '学業' | '人間関係' | '家庭' | '部活' | '身体';
export const LIFE_CATEGORIES: LifeCategory[] = [
  '学校行事',
  '学業',
  '人間関係',
  '家庭',
  '部活',
  '身体',
];

export type LifeTag =
  | 'bold' // 思い切って行動する
  | 'careful' // 慎重・無理をしない
  | 'social' // 仲間と関わる
  | 'solo' // 一人で取り組む
  | 'discipline' // 自制・努力
  | 'rest' // 休養・回復
  | 'romance' // 恋愛
  | 'rivalry' // 競争心・対立
  | 'family' // 家族優先
  | 'leadership' // まとめ役
  | 'health'; // 体調管理

export type LifeEffect = {
  /** チーム全体の士気（s.morale）への基礎変化量 */
  morale?: number;
  /** チーム全体の連携（s.cohesion）への基礎変化量 */
  cohesion?: number;
  /** 対象選手の疲労への基礎変化量（負値で回復） */
  fatigue?: number;
  /** 対象選手の信頼（identity.trust）への基礎変化量 */
  trust?: number;
  /** 対象選手のけが度への変化量（0〜5でクランプ） */
  injury?: number;
  /** 対象選手の能力への小さな成長（基礎値。性格・アーキタイプで補正） */
  growth?: Partial<Record<Stat, number>>;
  /** 習得を試みる特殊能力ID（lib/squad.ts の SKILLS のキー） */
  skillId?: string;
  /** 上記スキルの基礎習得確率（0〜1。性格・アーキタイプ・素質で補正） */
  skillChance?: number;
};

export type LifeChoice = {
  id: string;
  label: string;
  tag: LifeTag;
  effect: LifeEffect;
  resultText: (name: string) => string;
};

export type LifeEvent = {
  id: string;
  category: LifeCategory;
  title: string;
  prompt: (name: string) => string;
  choices: LifeChoice[];
};

export type LifeCurrent = {
  eventId: string;
  playerId: number;
  week: number;
  season: number;
};

export type LifeState = {
  schema: 1;
  current: LifeCurrent | null;
  /** 直近に出たイベントID（連続で同じ話が出ないようにするための履歴） */
  history: string[];
  /** S1: 最後にイベントを発生させた週のスタンプ（season*48+week）。日次判定になった
   *  ことで同じ週に何度も maybeTriggerLifeEvent が呼ばれるため、「同じ週に最大1回」を
   *  保証するのに使う（current は選択すると null に戻ってしまい週内判定に使えないため）。
   *  旧セーブには存在しないので -1（=一度も発生していない）で補う。 */
  lastTriggerStamp: number;
};

export function defaultLifeState(): LifeState {
  return { schema: 1, current: null, history: [], lastTriggerStamp: -1 };
}

/** 統括側が lib/v3.ts で life を足すまでの間、型を安全に橋渡しするための最小キャスト */
type V3WithLife = State['v3'] & { life?: LifeState };
function withLife(s: State): V3WithLife {
  return s.v3 as V3WithLife;
}

// ---------------------------------------------------------------------------
// 性格（v2 Personality）とアーキタイプ（W1）による結果の補正
// 同じ選択肢でも、熱血漢は大胆な選択で伸び、慎重派は手堅い選択で伸びる……という
// ように、タグごとの倍率で結果の大きさ・習得しやすさを変える。
// ---------------------------------------------------------------------------
const personalityBias: Record<Personality, Partial<Record<LifeTag, number>>> = {
  enthusiast: {
    bold: 1.4,
    rivalry: 1.3,
    romance: 1.15,
    discipline: 0.8,
    rest: 0.7,
    careful: 0.85,
  },
  sensitive: {
    careful: 1.35,
    social: 1.2,
    rest: 1.25,
    family: 1.2,
    bold: 0.65,
    rivalry: 0.8,
  },
  analyst: {
    discipline: 1.35,
    careful: 1.15,
    solo: 1.3,
    leadership: 1.1,
    bold: 0.85,
    social: 0.9,
  },
  competitor: {
    rivalry: 1.45,
    bold: 1.15,
    discipline: 1.05,
    rest: 0.8,
    romance: 0.9,
    social: 0.9,
  },
};
const archetypeBias: Record<Archetype, Partial<Record<LifeTag, number>>> = {
  dribbler: { bold: 1.2, solo: 1.15 },
  passer: { social: 1.2, leadership: 1.15 },
  striker: { rivalry: 1.25, social: 0.85 },
  defender: { discipline: 1.2, careful: 1.1 },
  physical: { bold: 1.1, health: 1.15, rest: 0.9 },
  technician: { careful: 1.15, solo: 1.1 },
  speedster: { bold: 1.1, rest: 0.9 },
  allrounder: { leadership: 1.1 },
  keeper: { discipline: 1.15, careful: 1.1 },
};
function biasFor(tag: LifeTag, personality: Personality, archetype: Archetype): number {
  return (personalityBias[personality]?.[tag] ?? 1) * (archetypeBias[archetype]?.[tag] ?? 1);
}

// ---------------------------------------------------------------------------
// イベント一覧（30〜40種）
// ---------------------------------------------------------------------------
export const LIFE_EVENTS: LifeEvent[] = [
  // ===== 学校行事 =====
  {
    id: 'sports_day_relay',
    category: '学校行事',
    title: '体育祭・部活対抗リレー',
    prompt: (n) => `体育祭の部活対抗リレー。${n}にアンカーが回ってきた。`,
    choices: [
      {
        id: 'sports_day_relay_a',
        label: '全力で走り抜く',
        tag: 'bold',
        effect: { morale: 6, fatigue: 8, trust: 3 },
        resultText: (n) => `${n}が全力疾走で逆転！ 部の士気が上がった。`,
      },
      {
        id: 'sports_day_relay_b',
        label: 'ペース配分を考えて走る',
        tag: 'careful',
        effect: { morale: 3, fatigue: 3, trust: 1, growth: { speed: 1 } },
        resultText: (n) => `${n}は無理のないペースで堅実に走り切った。走力が少し伸びた。`,
      },
    ],
  },
  {
    id: 'sports_day_cheer',
    category: '学校行事',
    title: '体育祭の応援合戦',
    prompt: (n) => `クラス対抗の応援合戦。${n}の出番が近い。`,
    choices: [
      {
        id: 'sports_day_cheer_a',
        label: '先頭に立って盛り上げる',
        tag: 'social',
        effect: { morale: 7, cohesion: 4, trust: 2 },
        resultText: (n) => `${n}が声を張って場を盛り上げ、部のムードも明るくなった。`,
      },
      {
        id: 'sports_day_cheer_b',
        label: '裏方で準備を支える',
        tag: 'careful',
        effect: { cohesion: 5, trust: 3 },
        resultText: (n) => `${n}は目立たないところで支え、仲間からの信頼を集めた。`,
      },
    ],
  },
  {
    id: 'culture_fest_booth',
    category: '学校行事',
    title: '文化祭の模擬店準備',
    prompt: (n) => `文化祭の模擬店の内容を話し合っている。${n}に意見を求められた。`,
    choices: [
      {
        id: 'culture_fest_booth_a',
        label: '積極的にアイデアを出す',
        tag: 'bold',
        effect: { cohesion: 5, morale: 3, skillId: 'mood_maker', skillChance: 0.3 },
        resultText: (n) => `${n}の案でクラスが盛り上がった。部の空気も自然と明るくなった。`,
      },
      {
        id: 'culture_fest_booth_b',
        label: '地道に仕込みを手伝う',
        tag: 'careful',
        effect: { cohesion: 4, trust: 2 },
        resultText: (n) => `${n}はコツコツと準備を手伝い、周りからの信頼を得た。`,
      },
    ],
  },
  {
    id: 'culture_fest_day',
    category: '学校行事',
    title: '文化祭当日、思わぬ大盛況',
    prompt: (n) => `文化祭当日、模擬店に長い列ができた。${n}はどう動く？`,
    choices: [
      {
        id: 'culture_fest_day_a',
        label: '接客を楽しむ',
        tag: 'social',
        effect: { morale: 6, cohesion: 3 },
        resultText: (n) => `${n}が笑顔で接客し、部全体が楽しい一日を過ごした。`,
      },
      {
        id: 'culture_fest_day_b',
        label: '裏で在庫管理に徹する',
        tag: 'discipline',
        effect: { cohesion: 4, trust: 2, growth: { mental: 1 } },
        resultText: (n) => `${n}は冷静に段取りを回し切った。精神力が少し育った。`,
      },
    ],
  },
  {
    id: 'school_trip_night',
    category: '学校行事',
    title: '修学旅行の夜',
    prompt: (n) => `修学旅行の夜、部屋で${n}を含む仲間が話し込んでいる。`,
    choices: [
      {
        id: 'school_trip_night_a',
        label: '夜更かしして語り合う',
        tag: 'social',
        effect: { cohesion: 6, fatigue: 5, trust: 3 },
        resultText: (n) => `${n}たちは夜遅くまで将来の話で盛り上がった。絆が深まった。`,
      },
      {
        id: 'school_trip_night_b',
        label: '早めに寝て体調を整える',
        tag: 'careful',
        effect: { fatigue: -6, trust: 1 },
        resultText: (n) => `${n}はしっかり体を休め、翌日に疲れを残さなかった。`,
      },
    ],
  },
  {
    id: 'school_trip_free',
    category: '学校行事',
    title: '修学旅行の自由行動',
    prompt: (n) => `修学旅行の自由行動。${n}たちの班で行き先を決めることになった。`,
    choices: [
      {
        id: 'school_trip_free_a',
        label: '行きたかった場所を提案する',
        tag: 'bold',
        effect: { morale: 4, trust: 3, growth: { mental: 1 } },
        resultText: (n) => `${n}の提案で班は楽しい一日を過ごした。自信がついた。`,
      },
      {
        id: 'school_trip_free_b',
        label: 'みんなの意見に合わせる',
        tag: 'social',
        effect: { cohesion: 4, trust: 2 },
        resultText: (n) => `${n}が場をまとめ、班の空気が和やかになった。`,
      },
    ],
  },
  // ===== 学業 =====
  {
    id: 'midterm_exam',
    category: '学業',
    title: '中間試験の結果発表',
    prompt: (n) => `中間試験の結果が返ってきた。${n}の成績は部内でも話題に。`,
    choices: [
      {
        id: 'midterm_exam_a',
        label: '苦手科目を頑張って乗り切った',
        tag: 'discipline',
        effect: { trust: 4, growth: { mental: 1.5 } },
        resultText: (n) => `${n}はコツコツ勉強を積み重ね、結果を出した。精神力が育った。`,
      },
      {
        id: 'midterm_exam_b',
        label: '部活を優先して勉強は最低限',
        tag: 'bold',
        effect: { morale: 2, trust: -2 },
        resultText: (n) => `${n}はサッカーを優先。成績は伸びず、少し監督に心配された。`,
      },
    ],
  },
  {
    id: 'remedial_class',
    category: '学業',
    title: '赤点で補習が決定',
    prompt: (n) => `${n}が試験で赤点をとり、放課後の補習が決まった。`,
    choices: [
      {
        id: 'remedial_class_a',
        label: '切り替えて補習に集中する',
        tag: 'discipline',
        effect: { trust: 3, growth: { mental: 1 } },
        resultText: (n) => `${n}は前向きに補習に取り組み、監督からの信頼を保った。`,
      },
      {
        id: 'remedial_class_b',
        label: '友人に勉強を教えてもらう',
        tag: 'social',
        effect: { cohesion: 3, trust: 2, growth: { mental: 1 } },
        resultText: (n) => `仲間が${n}に勉強を教え、チームの結びつきが強まった。`,
      },
    ],
  },
  {
    id: 'career_talk',
    category: '学業',
    title: '進路面談',
    prompt: (n) => `進路面談で先生に「将来どうしたい？」と聞かれた${n}。`,
    choices: [
      {
        id: 'career_talk_a',
        label: 'サッカーを続けたいと即答する',
        tag: 'bold',
        effect: { trust: 4, morale: 2 },
        resultText: (n) => `${n}ははっきりと決意を語った。表情が引き締まった。`,
      },
      {
        id: 'career_talk_b',
        label: 'まだ悩んでいると正直に話す',
        tag: 'careful',
        effect: { trust: 2, growth: { mental: 1 } },
        resultText: (n) => `${n}は自分の気持ちに正直に向き合った。少し大人になった。`,
      },
    ],
  },
  {
    id: 'mock_exam_result',
    category: '学業',
    title: '模試の結果に一喜一憂',
    prompt: (n) => `模試の結果が返ってきて、${n}の周りがざわついている。`,
    choices: [
      {
        id: 'mock_exam_result_a',
        label: '手応えを仲間に伝える',
        tag: 'social',
        effect: { cohesion: 3, morale: 2 },
        resultText: (n) => `${n}が明るく結果を報告し、教室の空気が和んだ。`,
      },
      {
        id: 'mock_exam_result_b',
        label: '一人で見直しをする',
        tag: 'solo',
        effect: { trust: 1, growth: { mental: 1.5 } },
        resultText: (n) => `${n}は静かに弱点を見直した。集中力が育った。`,
      },
    ],
  },
  {
    id: 'study_balance',
    category: '学業',
    title: '勉強と部活の両立',
    prompt: (n) => `テスト週間と練習が重なり、${n}は両立に悩んでいる。`,
    choices: [
      {
        id: 'study_balance_a',
        label: '睡眠を削って両立する',
        tag: 'bold',
        effect: { growth: { mental: 1 }, fatigue: 8 },
        resultText: (n) => `${n}は無理をして両立させた。頑張りは実ったが、疲れが残る。`,
      },
      {
        id: 'study_balance_b',
        label: '計画を立てて無理なく両立する',
        tag: 'discipline',
        effect: { growth: { mental: 1 }, fatigue: 2, trust: 2 },
        resultText: (n) => `${n}は計画的に両立をこなした。生活リズムが整った。`,
      },
    ],
  },
  {
    id: 'group_project',
    category: '学業',
    title: 'グループ課題で意見が割れる',
    prompt: (n) => `授業のグループ課題で意見が対立。${n}はどうする？`,
    choices: [
      {
        id: 'group_project_a',
        label: '自分の意見を押し通す',
        tag: 'rivalry',
        effect: { trust: 2, cohesion: -3, skillId: 'egoist', skillChance: 0.12 },
        resultText: (n) => `${n}は自分の考えを押し通した。結果は出たが、少し軋轢も生まれた。`,
      },
      {
        id: 'group_project_b',
        label: '折れて全体を優先する',
        tag: 'social',
        effect: { cohesion: 4, trust: 1 },
        resultText: (n) => `${n}は自分の意見を抑え、班をまとめることを優先した。`,
      },
    ],
  },
  // ===== 人間関係 =====
  {
    id: 'confession_received',
    category: '人間関係',
    title: '告白される',
    prompt: (n) => `他クラスの生徒から、${n}が告白された。`,
    choices: [
      {
        id: 'confession_received_a',
        label: '気持ちに応えて付き合うことにする',
        tag: 'romance',
        effect: { morale: 8, trust: 3 },
        resultText: (n) => `${n}に彼女ができた。毎日が楽しそうで、練習にも自然と力が入る。`,
      },
      {
        id: 'confession_received_b',
        label: '今はサッカーに集中したいと丁寧に断る',
        tag: 'discipline',
        effect: { trust: 2, growth: { mental: 1 } },
        resultText: (n) => `${n}は自分の優先順位を大切にした。気持ちが引き締まった。`,
      },
    ],
  },
  {
    id: 'crush_realized',
    category: '人間関係',
    title: '気になる人がいることに気づく',
    prompt: (n) => `${n}は最近、クラスの誰かが気になって仕方がないらしい。`,
    choices: [
      {
        id: 'crush_realized_a',
        label: '思い切って話しかけてみる',
        tag: 'bold',
        effect: { morale: 4, trust: 2 },
        resultText: (n) => `${n}は勇気を出して声をかけた。少し照れくさそうだが晴れやかな顔。`,
      },
      {
        id: 'crush_realized_b',
        label: 'そっと気持ちを胸にしまう',
        tag: 'careful',
        effect: { trust: 1, growth: { mental: 0.8 } },
        resultText: (n) => `${n}は自分の気持ちと静かに向き合った。少し大人びた表情。`,
      },
    ],
  },
  {
    id: 'date_invite',
    category: '人間関係',
    title: '週末デートに誘われる',
    prompt: (n) => `週末、${n}が友人とのお出かけに誘われた。`,
    choices: [
      {
        id: 'date_invite_a',
        label: '楽しく出かけてリフレッシュする',
        tag: 'romance',
        effect: { morale: 6, fatigue: -4 },
        resultText: (n) => `${n}は良い気分転換になり、笑顔で練習に戻ってきた。`,
      },
      {
        id: 'date_invite_b',
        label: '練習を優先して断る',
        tag: 'discipline',
        effect: { trust: 3, morale: -2 },
        resultText: (n) => `${n}はサッカーを選んだ。監督はその姿勢を評価した。`,
      },
    ],
  },
  {
    id: 'friend_fight',
    category: '人間関係',
    title: '親友との言い合い',
    prompt: (n) => `サッカーの考え方をめぐって、${n}と親友が言い合いになった。`,
    choices: [
      {
        id: 'friend_fight_a',
        label: '本音でぶつかり合う',
        tag: 'bold',
        effect: { trust: 2, cohesion: -4, skillId: 'moody', skillChance: 0.1 },
        resultText: (n) => `${n}は本音をぶつけた。分かり合えた部分もあるが、しこりも残った。`,
      },
      {
        id: 'friend_fight_b',
        label: '距離を置いて頭を冷やす',
        tag: 'careful',
        effect: { cohesion: -2 },
        resultText: (n) => `${n}は少し距離を置くことにした。気まずい空気がしばらく続く。`,
      },
    ],
  },
  {
    id: 'reconciliation',
    category: '人間関係',
    title: 'こじれていた友人と仲直り',
    prompt: (n) => `ぎくしゃくしていた友人関係を、${n}が修復しようとしている。`,
    choices: [
      {
        id: 'reconciliation_a',
        label: '素直に謝る',
        tag: 'social',
        effect: { cohesion: 6, trust: 4, morale: 3 },
        resultText: (n) => `${n}が素直に謝り、二人は元通りに。部の空気も明るくなった。`,
      },
      {
        id: 'reconciliation_b',
        label: 'プレーで気持ちを示す',
        tag: 'bold',
        effect: { cohesion: 4, growth: { shoot: 1.2 } },
        resultText: (n) => `${n}は言葉より練習で応えた。決定力が少し磨かれた。`,
      },
    ],
  },
  {
    id: 'junior_consult',
    category: '人間関係',
    title: '後輩からの相談',
    prompt: (n) => `部活の悩みについて、後輩が${n}に相談を持ちかけてきた。`,
    choices: [
      {
        id: 'junior_consult_a',
        label: 'じっくり話を聞く',
        tag: 'social',
        effect: { trust: 3, cohesion: 3, skillId: 'captaincy', skillChance: 0.22 },
        resultText: (n) => `${n}は後輩の話に真剣に耳を傾けた。頼れる先輩としての顔が育つ。`,
      },
      {
        id: 'junior_consult_b',
        label: '自分の経験を語って励ます',
        tag: 'leadership',
        effect: { trust: 3, cohesion: 2, skillId: 'mood_maker', skillChance: 0.2 },
        resultText: (n) => `${n}の言葉に後輩は前向きになった。部の雰囲気が明るくなった。`,
      },
    ],
  },
  {
    id: 'senior_clash',
    category: '人間関係',
    title: '先輩との衝突',
    prompt: (n) => `プレーの考え方をめぐり、${n}が先輩と意見をぶつけ合った。`,
    choices: [
      {
        id: 'senior_clash_a',
        label: '自分の意見を伝える',
        tag: 'rivalry',
        effect: { trust: 2, cohesion: -3, growth: { mental: 1 } },
        resultText: (n) => `${n}は臆せず意見を伝えた。摩擦はあったが、成長のきっかけになった。`,
      },
      {
        id: 'senior_clash_b',
        label: '一旦は先輩に従う',
        tag: 'careful',
        effect: { cohesion: 2, trust: -1 },
        resultText: (n) => `${n}は今回は従うことにした。少しもやもやが残る。`,
      },
    ],
  },
  {
    id: 'sns_misunderstanding',
    category: '人間関係',
    title: 'SNSでのすれ違い',
    prompt: (n) => `SNSでの何気ない投稿が誤解を生み、${n}が気まずい思いをしている。`,
    choices: [
      {
        id: 'sns_misunderstanding_a',
        label: '直接会って誤解を解く',
        tag: 'social',
        effect: { cohesion: 4, trust: 3 },
        resultText: (n) => `${n}が直接話したことで誤解は解けた。かえって関係が深まった。`,
      },
      {
        id: 'sns_misunderstanding_b',
        label: 'そっとしておく',
        tag: 'careful',
        effect: { cohesion: 1 },
        resultText: (n) => `${n}は時間が解決するのを待つことにした。少しぎこちない空気。`,
      },
    ],
  },
  // ===== 家庭 =====
  {
    id: 'family_support',
    category: '家庭',
    title: '家族が応援に来る',
    prompt: (n) => `今度の試合、${n}の家族が応援に来てくれることになった。`,
    choices: [
      {
        id: 'family_support_a',
        label: '張り切って活躍を誓う',
        tag: 'bold',
        effect: { morale: 5, trust: 3, growth: { mental: 1 } },
        resultText: (n) => `${n}は気合十分。家族への思いが力に変わった。`,
      },
      {
        id: 'family_support_b',
        label: 'プレッシャーを感じつつ受け止める',
        tag: 'careful',
        effect: { trust: 2, fatigue: 2 },
        resultText: (n) => `${n}は少し緊張しながらも、応援を素直に受け止めた。`,
      },
    ],
  },
  {
    id: 'family_conflict',
    category: '家庭',
    title: '家族との衝突',
    prompt: (n) => `勉強と部活のことで、${n}が家族と少しぶつかった。`,
    choices: [
      {
        id: 'family_conflict_a',
        label: '自分の思いをしっかり伝える',
        tag: 'bold',
        effect: { trust: 3, fatigue: 3 },
        resultText: (n) => `${n}は自分の気持ちを言葉にした。簡単ではなかったが、前を向けた。`,
      },
      {
        id: 'family_conflict_b',
        label: '一旦は家族の意見を受け入れる',
        tag: 'careful',
        effect: { fatigue: -2, trust: 1 },
        resultText: (n) => `${n}は今回は家族の意見を尊重した。家の空気は穏やかに戻った。`,
      },
    ],
  },
  {
    id: 'sibling_care',
    category: '家庭',
    title: '弟や妹の面倒を見る',
    prompt: (n) => `家の事情で、${n}が弟や妹の面倒を見ることになった。`,
    choices: [
      {
        id: 'sibling_care_a',
        label: '家族を優先する',
        tag: 'family',
        effect: { trust: 4, fatigue: -3, growth: { mental: 1 } },
        resultText: (n) => `${n}は家族との時間を大切にした。心にゆとりが生まれた。`,
      },
      {
        id: 'sibling_care_b',
        label: '隙間時間で自主トレする',
        tag: 'discipline',
        effect: { growth: { speed: 1 }, fatigue: 4 },
        resultText: (n) => `${n}は忙しい合間を縫って体を動かした。走力が少し伸びた。`,
      },
    ],
  },
  {
    id: 'family_move_talk',
    category: '家庭',
    title: '家庭の事情で揺れる気持ち',
    prompt: (n) => `家庭の事情で環境が変わるかもしれないと聞き、${n}は落ち着かない。`,
    choices: [
      {
        id: 'family_move_talk_a',
        label: '不安な気持ちを素直に話す',
        tag: 'careful',
        effect: { trust: 3, morale: -2 },
        resultText: (n) => `${n}は不安を正直に打ち明けた。周りが支えようとしている。`,
      },
      {
        id: 'family_move_talk_b',
        label: '今の仲間と続けたいと伝える',
        tag: 'bold',
        effect: { trust: 4, cohesion: 3, morale: 3 },
        resultText: (n) => `${n}は今のチームへの思いをはっきり伝えた。仲間の結束が強まった。`,
      },
    ],
  },
  // ===== 部活 =====
  {
    id: 'captain_selection',
    category: '部活',
    title: '新チームの主将決め',
    prompt: (n) => `新チームの主将を決める話し合い。${n}の名前も挙がっている。`,
    choices: [
      {
        id: 'captain_selection_a',
        label: '自分から立候補する',
        tag: 'leadership',
        effect: { trust: 5, cohesion: 3, skillId: 'captaincy', skillChance: 0.35 },
        resultText: (n) => `${n}が自ら手を挙げた。その覚悟がチームに伝わった。`,
      },
      {
        id: 'captain_selection_b',
        label: '推薦されて引き受ける',
        tag: 'social',
        effect: { trust: 3, cohesion: 4, skillId: 'captaincy', skillChance: 0.25 },
        resultText: (n) => `仲間に推されて${n}が引き受けた。信頼の証だ。`,
      },
      {
        id: 'captain_selection_c',
        label: '支える側に回る',
        tag: 'careful',
        effect: { trust: 2, cohesion: 2 },
        resultText: (n) => `${n}は主将を支える役に回った。縁の下からチームを支える。`,
      },
    ],
  },
  {
    id: 'meeting_disagreement',
    category: '部活',
    title: 'ミーティングでの意見対立',
    prompt: (n) => `部のミーティングで意見が割れた。${n}はどう振る舞う？`,
    choices: [
      {
        id: 'meeting_disagreement_a',
        label: 'はっきり意見を主張する',
        tag: 'bold',
        effect: { trust: 2, cohesion: -3 },
        resultText: (n) => `${n}は臆せず意見を言った。緊張感は生まれたが、話は前に進んだ。`,
      },
      {
        id: 'meeting_disagreement_b',
        label: '全体をまとめようとする',
        tag: 'leadership',
        effect: { cohesion: 5, trust: 3, skillId: 'mood_maker', skillChance: 0.2 },
        resultText: (n) => `${n}がうまく話をまとめ、ミーティングは前向きに終わった。`,
      },
    ],
  },
  {
    id: 'snacks',
    category: '部活',
    title: 'マネージャーからの差し入れ',
    prompt: (n) => `練習後、マネージャーから差し入れが届いた。${n}たちは大喜び。`,
    choices: [
      {
        id: 'snacks_a',
        label: 'みんなで分け合う',
        tag: 'social',
        effect: { cohesion: 4, morale: 3 },
        resultText: (n) => `${n}が中心になって分け合い、部の空気が和んだ。`,
      },
      {
        id: 'snacks_b',
        label: 'お礼を丁寧に伝える',
        tag: 'careful',
        effect: { trust: 2, morale: 2 },
        resultText: (n) => `${n}が丁寧にお礼を伝え、マネージャーも嬉しそうだった。`,
      },
    ],
  },
  {
    id: 'gear_prep',
    category: '部活',
    title: '遠征前の用具準備',
    prompt: (n) => `遠征前の用具準備を、${n}が任されることになった。`,
    choices: [
      {
        id: 'gear_prep_a',
        label: '率先して引き受ける',
        tag: 'discipline',
        effect: { trust: 4, cohesion: 2 },
        resultText: (n) => `${n}は手を抜かず準備をやり切った。信頼が積み重なった。`,
      },
      {
        id: 'gear_prep_b',
        label: 'みんなで分担する',
        tag: 'social',
        effect: { cohesion: 4 },
        resultText: (n) => `${n}が声をかけて分担し、準備がスムーズに進んだ。`,
      },
    ],
  },
  {
    id: 'new_member_coach',
    category: '部活',
    title: '新入部員の指導',
    prompt: (n) => `新入部員の指導を${n}が任された。`,
    choices: [
      {
        id: 'new_member_coach_a',
        label: '熱心に基礎から教える',
        tag: 'leadership',
        effect: { trust: 4, growth: { pass: 1 }, skillId: 'captaincy', skillChance: 0.15 },
        resultText: (n) => `${n}は丁寧に基礎を教えた。教えることで自分の理解も深まった。`,
      },
      {
        id: 'new_member_coach_b',
        label: '見本を見せて背中で語る',
        tag: 'bold',
        effect: { trust: 2, growth: { shoot: 1 } },
        resultText: (n) => `${n}はプレーで手本を示した。決定力に磨きがかかった。`,
      },
    ],
  },
  {
    id: 'send_off',
    category: '部活',
    title: '引退する先輩の壮行会',
    prompt: (n) => `引退する先輩を送る会が開かれた。${n}は何をする？`,
    choices: [
      {
        id: 'send_off_a',
        label: '感謝の言葉を伝える',
        tag: 'social',
        effect: { cohesion: 6, morale: 4, trust: 2 },
        resultText: (n) => `${n}の言葉に先輩は涙ぐんだ。部全体が温かい空気に包まれた。`,
      },
      {
        id: 'send_off_b',
        label: 'プレーで感謝を示す',
        tag: 'bold',
        effect: { cohesion: 4, growth: { mental: 1.5 } },
        resultText: (n) => `${n}は次の練習で全力を尽くし、背中で感謝を伝えた。`,
      },
    ],
  },
  // ===== 身体 =====
  {
    id: 'growth_spurt',
    category: '身体',
    title: '急激な成長期',
    prompt: (n) => `${n}の身体つきが、この数ヶ月でぐっと変わってきた。`,
    choices: [
      {
        id: 'growth_spurt_a',
        label: '無理せず体を慣らす',
        tag: 'careful',
        effect: { fatigue: -4, trust: 2, growth: { mental: 0.8 } },
        resultText: (n) => `${n}は焦らず体の変化と付き合った。無理のない成長を選んだ。`,
      },
      {
        id: 'growth_spurt_b',
        label: '積極的に走り込む',
        tag: 'bold',
        effect: { growth: { speed: 1.5 }, fatigue: 6, skillId: 'stamina_monster', skillChance: 0.18 },
        resultText: (n) => `${n}は伸びる体を信じて走り込んだ。走力が大きく育った。`,
      },
    ],
  },
  {
    id: 'minor_cold',
    category: '身体',
    title: '風邪気味',
    prompt: (n) => `${n}が少し体調を崩している。今日の練習、どうする？`,
    choices: [
      {
        id: 'minor_cold_a',
        label: '無理せず休む',
        tag: 'rest',
        effect: { fatigue: -10, trust: 1 },
        resultText: (n) => `${n}はしっかり体を休めた。翌日には元気を取り戻した。`,
      },
      {
        id: 'minor_cold_b',
        label: '気合で乗り切ろうとする',
        tag: 'bold',
        effect: { fatigue: 4, injury: 1, trust: 2 },
        resultText: (n) => `${n}は無理を押して練習に出た。その気持ちは伝わったが、体調は長引いた。`,
      },
    ],
  },
  {
    id: 'mild_sprain',
    category: '身体',
    title: '練習中に足首をひねる',
    prompt: (n) => `練習中、${n}が軽く足首をひねってしまった。`,
    choices: [
      {
        id: 'mild_sprain_a',
        label: 'すぐアイシングして安静にする',
        tag: 'careful',
        effect: { injury: 1, fatigue: -4, trust: 2 },
        resultText: (n) => `${n}は迷わず処置を受けた。おかげで大事には至らなかった。`,
      },
      {
        id: 'mild_sprain_b',
        label: '痛みをこらえてプレーを続ける',
        tag: 'bold',
        effect: { injury: 2, trust: 1, skillId: 'glass_body', skillChance: 0.15 },
        resultText: (n) => `${n}は痛みをこらえて続けた。その無理が、体の癖として残るかもしれない。`,
      },
    ],
  },
  {
    id: 'sleep_deprivation',
    category: '身体',
    title: '寝不足が続く',
    prompt: (n) => `${n}の寝不足が、ここ数日続いているようだ。`,
    choices: [
      {
        id: 'sleep_deprivation_a',
        label: '早寝を心がける',
        tag: 'discipline',
        effect: { fatigue: -6, trust: 1 },
        resultText: (n) => `${n}は生活を見直した。すっきりした表情で練習に来るようになった。`,
      },
      {
        id: 'sleep_deprivation_b',
        label: '気にせずこれまで通り過ごす',
        tag: 'bold',
        effect: { fatigue: 5 },
        resultText: (n) => `${n}はあまり気にしていない様子。疲れが少しずつ溜まっている。`,
      },
    ],
  },
  {
    id: 'appetite',
    category: '身体',
    title: '食欲旺盛な日々',
    prompt: (n) => `成長期の${n}は、最近とてもよく食べる。`,
    choices: [
      {
        id: 'appetite_a',
        label: '栄養バランスを意識する',
        tag: 'discipline',
        effect: { growth: { mental: 1 }, fatigue: -3, skillId: 'unshakable', skillChance: 0.15 },
        resultText: (n) => `${n}は食事にも気を配るようになった。体づくりが着実に進んでいる。`,
      },
      {
        id: 'appetite_b',
        label: '好きなものをたくさん食べる',
        tag: 'bold',
        effect: { morale: 3, fatigue: -1 },
        resultText: (n) => `${n}は好きなものを食べて満足そう。気持ちも軽くなった。`,
      },
    ],
  },
  {
    id: 'resilience_moment',
    category: '身体',
    title: '苦しい時期を乗り越える',
    prompt: (n) => `伸び悩みの時期が続いていた${n}に、少し変化が見え始めている。`,
    choices: [
      {
        id: 'resilience_moment_a',
        label: '自分を信じて続ける',
        tag: 'discipline',
        effect: { trust: 4, growth: { mental: 1.5 }, skillId: 'resilience', skillChance: 0.3 },
        resultText: (n) => `${n}は苦しい時期を自分の力で乗り越えた。一回り強くなった顔つき。`,
      },
      {
        id: 'resilience_moment_b',
        label: '仲間に支えてもらう',
        tag: 'social',
        effect: { cohesion: 4, trust: 3, skillId: 'clutch', skillChance: 0.2 },
        resultText: (n) => `仲間の支えで${n}は前を向けた。信頼の輪が力になった。`,
      },
    ],
  },
];
export const LIFE_EVENTS_BY_ID: Record<string, LifeEvent> = Object.fromEntries(
  LIFE_EVENTS.map((e) => [e.id, e]),
);

// ---------------------------------------------------------------------------
// hydrate / validate
// ---------------------------------------------------------------------------
export function hydrateLife(s: State): void {
  const v = withLife(s);
  if (!v.life || v.life.schema !== 1) v.life = defaultLifeState();
  if (!Array.isArray(v.life.history)) v.life.history = [];
  if (typeof v.life.lastTriggerStamp !== 'number' || !Number.isFinite(v.life.lastTriggerStamp))
    v.life.lastTriggerStamp = -1;
  if (v.life.current && !s.players.some((p) => p.id === v.life!.current!.playerId))
    v.life.current = null;
}
function getLife(s: State): LifeState {
  hydrateLife(s);
  return withLife(s).life!;
}
export function readLifeState(s: State): LifeState {
  return getLife(s);
}
export function validateLife(s: State): void {
  const life = withLife(s).life;
  const num = (n: unknown, min: number, max: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!life || life.schema !== 1) throw Error('学校生活データが不正です。');
  if (
    !Array.isArray(life.history) ||
    life.history.length > 8 ||
    life.history.some((id) => typeof id !== 'string' || !LIFE_EVENTS_BY_ID[id])
  )
    throw Error('学校生活の履歴データが不正です。');
  if (!num(life.lastTriggerStamp, -1, 5000000))
    throw Error('学校生活データが不正です。');
  if (life.current !== null) {
    const c = life.current;
    if (
      !c ||
      typeof c.eventId !== 'string' ||
      !LIFE_EVENTS_BY_ID[c.eventId] ||
      !Number.isInteger(c.playerId) ||
      !num(c.week, 0, 47) ||
      !num(c.season, 1, 100000)
    )
      throw Error('学校生活イベントデータが不正です。');
  }
}

// ---------------------------------------------------------------------------
// 参照ヘルパー（UI・テスト向け）
// ---------------------------------------------------------------------------
export function getCurrentLifeEvent(
  s: State,
): { event: LifeEvent; player: Player } | null {
  const life = getLife(s);
  if (!life.current) return null;
  const event = LIFE_EVENTS_BY_ID[life.current.eventId];
  const player = s.players.find((p) => p.id === life.current!.playerId);
  if (!event || !player) return null;
  return { event, player };
}

// ---------------------------------------------------------------------------
// 発生判定（週の進行フックから呼ばれる）
// ---------------------------------------------------------------------------
/** S1: 1日あたりの基礎発生確率。日次判定（月〜金の5日が対象、土日は対象外）で、
 *  「同じ週に最大1回」まで発生しうる。1-(1-p)^5 が週あたりの発生率になるので、
 *  1シーズン(48週)で12〜18回（週あたり0.25〜0.375）に収まるよう、
 *  p≈0.075（週あたり約33%）を狙う。実測は tests/game.test.ts / school-life.test.ts の
 *  10シーズン平均で検証している。 */
export const LIFE_EVENT_CHANCE = 0.075;

export function maybeTriggerLifeEvent(s: State): boolean {
  const life = getLife(s);
  const stamp = s.season * 48 + s.week;
  if (life.current) return false; // 未解決のイベントがある間は出さない
  if (life.lastTriggerStamp === stamp) return false; // 同じ週に最大1回
  if (s.match || s.pending) return false; // 試合中・試合待ちには出さない
  if (s.day > 4) return false; // 試合前日（土=5）・試合日（日=6）には出さない
  if (!s.players.length) return false;
  const roll = hf(s.seed, s.season, s.week, s.day, 91001);
  if (roll >= LIFE_EVENT_CHANCE) return false;
  const pool = LIFE_EVENTS.filter((e) => !life.history.includes(e.id));
  const candidates = pool.length ? pool : LIFE_EVENTS;
  const ei = Math.min(
    candidates.length - 1,
    Math.floor(hf(s.seed, s.season, s.week, s.day, 91002) * candidates.length),
  );
  const event = candidates[ei];
  const pi = Math.min(
    s.players.length - 1,
    Math.floor(hf(s.seed, s.season, s.week, s.day, 91003) * s.players.length),
  );
  const player = s.players[pi];
  life.current = { eventId: event.id, playerId: player.id, week: s.week, season: s.season };
  life.history = [event.id, ...life.history].slice(0, 8);
  life.lastTriggerStamp = stamp;
  return true;
}

// ---------------------------------------------------------------------------
// 選択の適用
// ---------------------------------------------------------------------------
function applyChoice(s: State, event: LifeEvent, choice: LifeChoice, player: Player): void {
  const personality = player.identity.personality;
  const archetype: Archetype = s.v3.squad.players[player.id]?.archetype ?? 'allrounder';
  const mult = biasFor(choice.tag, personality, archetype);
  const eff = choice.effect;
  if (eff.morale) s.morale = clamp(s.morale + eff.morale * mult);
  if (eff.cohesion) s.cohesion = clamp(s.cohesion + eff.cohesion * mult);
  if (eff.fatigue) player.fatigue = clamp(player.fatigue + eff.fatigue * mult);
  if (eff.trust) player.identity.trust = clamp(player.identity.trust + eff.trust * mult);
  if (eff.injury) player.injury = clamp(player.injury + eff.injury, 0, 5);
  if (eff.growth) {
    for (const key of Object.keys(eff.growth) as Stat[]) {
      const amount = eff.growth[key];
      if (!amount) continue;
      player.stats[key] = clamp(player.stats[key] + amount * mult, 20, 99);
    }
  }
  if (eff.skillId && eff.skillChance) {
    const chance = Math.min(
      0.95,
      Math.max(0.02, eff.skillChance * mult * (0.7 + (player.talent - 1) * 0.3)),
    );
    const roll = hf(
      s.seed,
      player.id,
      s.week,
      s.season,
      strHash(event.id),
      strHash(choice.id),
    );
    if (roll < chance) grantSkill(s, player.id, eff.skillId);
  }
  const text = choice.resultText(player.name);
  player.identity.memories = [text, ...player.identity.memories].slice(0, 8);
  s.feed = [`${event.title}：${text}`, ...s.feed].slice(0, 30);
}

// ---------------------------------------------------------------------------
// アクション（lib/game.ts の Action に 'life' を足して act() から呼んでもらう想定）
// ---------------------------------------------------------------------------
export type LifeAction = { type: 'life'; choiceId: string };

export function handleLife(s: State, a: { type: string; choiceId?: string }): boolean {
  if (a.type !== 'life') return false;
  const life = getLife(s);
  if (!life.current) throw Error('学校生活のイベントはありません。');
  const event = LIFE_EVENTS_BY_ID[life.current.eventId];
  if (!event) {
    life.current = null;
    throw Error('イベントデータが見つかりません。');
  }
  const choice = event.choices.find((c) => c.id === a.choiceId);
  if (!choice) throw Error('選択肢を選び直してください。');
  const player = s.players.find((p) => p.id === life.current!.playerId);
  if (player) applyChoice(s, event, choice, player);
  life.current = null;
  return true;
}

// ---------------------------------------------------------------------------
// 統括側への配線メモ（このファイルは編集しない前提で読むこと）
// ---------------------------------------------------------------------------
// 1. lib/v3.ts の V3State に `life: LifeState` を足し、hydrateV3/validateV3 から
//    hydrateLife(s) / validateLife(s) を（hydrateSquad/validateSquad と同様に）呼ぶ。
//    LifeState の初期値は defaultLifeState() を使う。
// 2. lib/game.ts の Action 合併型に `| LifeAction`（本ファイルの export type）を足し、
//    act() の中で `if (handleLife(s, a)) return s;`
//    を handleSquad(...) の呼び出しのすぐ後に追加する。
// 3. 週の進行フック: act() の 'train' ハンドラ内、
//      } else {
//        finishWeek(s);
//        if (s.week > 0 && s.week % 7 === 0) s.event = pick(s, [...]);
//      }
//    のブロック（= その週に試合が組まれなかった分岐）に、
//      if (!s.event) maybeTriggerLifeEvent(s);
//    を追加する（finishWeek() の前でも後でもよいが、s.week は finishWeek 後の値を
//    使うこと。maybeTriggerLifeEvent は内部で s.match/s.pending をチェックして
//    試合週には何もしないため、この位置で問題ない）。
// 4. 'train' アクションの先頭にある
//      if (s.pending || s.match || s.event) throw Error('試合または部内イベントを先に終えてください。');
//    に `|| s.v3.life.current` を足し、学校生活イベントに回答するまで次の練習に
//    進めないようにする（「連打で士気を稼げない」「1週1イベント」を確実に守るため）。
// 5. UI: app/life-ui.tsx の <LifeEventPanel state={s} onChoose={(choiceId) =>
//    run({ type: 'life', choiceId })} /> を、既存の event-panel（s.event）と同じ
//    あたりに差し込む。
