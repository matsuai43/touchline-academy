import type { State, Player, Position, Stat, Training, Formation } from './game.ts';
import { clamp } from './game.ts';

// ---------------------------------------------------------------------------
// 詳細ポジション
// ---------------------------------------------------------------------------
export const DETAIL_POS = [
  'GK',
  'CB',
  'LSB',
  'RSB',
  'DM',
  'CM',
  'AM',
  'LWG',
  'RWG',
  'CF',
] as const;
export type DetailPos = (typeof DETAIL_POS)[number];

export const detailInfo: Record<DetailPos, { name: string; base: Position }> = {
  GK: { name: 'ゴールキーパー', base: 'GK' },
  CB: { name: 'センターバック', base: 'DF' },
  LSB: { name: '左サイドバック', base: 'DF' },
  RSB: { name: '右サイドバック', base: 'DF' },
  DM: { name: 'ボランチ', base: 'MF' },
  CM: { name: 'セントラルMF', base: 'MF' },
  AM: { name: '攻撃的MF', base: 'MF' },
  LWG: { name: '左ウイング', base: 'FW' },
  RWG: { name: '右ウイング', base: 'FW' },
  CF: { name: 'センターフォワード', base: 'FW' },
};
export function basePos(d: DetailPos): Position {
  return detailInfo[d].base;
}
const detailByBase: Record<Position, DetailPos[]> = {
  GK: ['GK'],
  DF: ['CB', 'CB', 'LSB', 'RSB'],
  MF: ['DM', 'CM', 'CM', 'AM'],
  FW: ['CF', 'LWG', 'RWG'],
};

// ---------------------------------------------------------------------------
// フォーメーションの詳細ポジションスロット
// ---------------------------------------------------------------------------
// 各フォーメーションの11枠が要求する詳細ポジション。並び順は GK → DF → MF → FW で、
// basePos() に通したときに旧来の slots()（GK/DF/MF/FWの粗い並び）と完全に一致する。
export const FORMATION_SLOTS: Record<Formation, DetailPos[]> = {
  '4-3-3': ['GK', 'LSB', 'CB', 'CB', 'RSB', 'DM', 'CM', 'AM', 'LWG', 'CF', 'RWG'],
  '4-4-2': ['GK', 'LSB', 'CB', 'CB', 'RSB', 'DM', 'CM', 'CM', 'AM', 'CF', 'CF'],
  '3-4-3': ['GK', 'LSB', 'CB', 'RSB', 'DM', 'CM', 'CM', 'AM', 'LWG', 'CF', 'RWG'],
};
export function formationSlots(f: Formation): DetailPos[] {
  return FORMATION_SLOTS[f];
}
// 適性ペナルティの段階: 完全一致=1.0、同じ basePos 内=0.92、
// GK とフィールドプレイヤーの相互起用=0.48、それ以外の basePos またぎ=0.8。
export function positionFitMult(playerDetail: DetailPos, slot: DetailPos): number {
  if (playerDetail === slot) return 1;
  const pb = basePos(playerDetail),
    sb = basePos(slot);
  if (pb === sb) return 0.92;
  if (pb === 'GK' || sb === 'GK') return 0.48;
  return 0.8;
}

// ---------------------------------------------------------------------------
// 追加能力（突破・持久・パワー）
// ---------------------------------------------------------------------------
export type ExtraStat = 'dribble' | 'stamina' | 'power';
export const extraStatNames: Record<ExtraStat, string> = {
  dribble: '突破',
  stamina: '持久',
  power: 'パワー',
};

// ---------------------------------------------------------------------------
// アーキタイプ
// ---------------------------------------------------------------------------
export type Archetype =
  | 'dribbler'
  | 'passer'
  | 'striker'
  | 'defender'
  | 'physical'
  | 'technician'
  | 'speedster'
  | 'allrounder'
  | 'keeper';
export const archetypes: Record<
  Archetype,
  { name: string; desc: string; base: Position[] }
> = {
  dribbler: {
    name: 'ドリブラー',
    desc: '一人で局面を打開する突破力が武器。',
    base: ['MF', 'FW'],
  },
  passer: {
    name: 'パサー(司令塔)',
    desc: '展開力でチームを操る攻撃の起点。',
    base: ['MF'],
  },
  striker: {
    name: 'ストライカー(エゴイスト)',
    desc: 'とにかくゴールに直結する仕事に貪欲。',
    base: ['FW'],
  },
  defender: {
    name: '守備職人',
    desc: '体を張って局面を潰す、守備の専門家。',
    base: ['DF', 'MF'],
  },
  physical: {
    name: 'フィジカル型',
    desc: '当たり負けしない強さで局面を支配する。',
    base: ['DF', 'FW'],
  },
  technician: {
    name: '技巧派',
    desc: '繊細な技術で試合を組み立てる。',
    base: ['MF', 'FW'],
  },
  speedster: {
    name: 'スピードスター',
    desc: '圧倒的な走力でピッチを切り裂く。',
    base: ['DF', 'MF', 'FW'],
  },
  allrounder: {
    name: '万能型',
    desc: '欠点のない、どこでも計算できる選手。',
    base: ['GK', 'DF', 'MF', 'FW'],
  },
  keeper: {
    name: '守護神',
    desc: 'ゴールを背負う、GK専用の異能。',
    base: ['GK'],
  },
};
const archByBase: Record<Position, Archetype[]> = {
  GK: ['keeper', 'allrounder'],
  DF: ['defender', 'physical', 'speedster', 'allrounder'],
  MF: ['passer', 'dribbler', 'technician', 'speedster', 'allrounder', 'defender'],
  FW: ['striker', 'dribbler', 'technician', 'speedster', 'physical', 'allrounder'],
};

// ---------------------------------------------------------------------------
// 特殊能力（スキル）
// ---------------------------------------------------------------------------
export type SkillCategory = '攻撃' | '守備' | 'GK' | '精神' | '身体' | 'マイナス';
export type SkillEffect = {
  attackMult?: number;
  defenseMult?: number;
  finishMult?: number;
  oppFinishMult?: number;
  fatigueMult?: number;
  ratioBonus?: number;
  comebackBonus?: number;
  pkMult?: number;
  pkStopMult?: number;
};
export type Skill = {
  id: string;
  name: string;
  desc: string;
  category: SkillCategory;
  negative?: boolean;
  acquire: string;
  effect: SkillEffect;
};
const skillList: Skill[] = [
  // 攻撃
  {
    id: 'dribble_break',
    name: 'ドリブル突破',
    desc: '相手を置き去りにする仕掛けで攻撃の起点になる。',
    category: '攻撃',
    acquire: 'シュート練習の継続、または試合の経験で習得。',
    effect: { attackMult: 1.035 },
  },
  {
    id: 'killer_pass',
    name: '必殺スルーパス',
    desc: '守備の間を通す一本で決定機を演出する。',
    category: '攻撃',
    acquire: 'パス＆連携の継続で習得。',
    effect: { attackMult: 1.03, finishMult: 1.015 },
  },
  {
    id: 'long_shot',
    name: 'ミドルシュート',
    desc: '距離を問わず枠を捉える精度を持つ。',
    category: '攻撃',
    acquire: 'シュート練習の継続で習得。',
    effect: { finishMult: 1.05 },
  },
  {
    id: 'header',
    name: 'ヘディング職人',
    desc: '空中戦から得点に直結させる。',
    category: '攻撃',
    acquire: '総合練習の継続、または試合の経験で習得。',
    effect: { finishMult: 1.03 },
  },
  {
    id: 'poacher',
    name: 'ゴール前の嗅覚',
    desc: 'ゴール前で一番良い場所に必ずいる。',
    category: '攻撃',
    acquire: 'ハットトリックなど試合の経験で習得。',
    effect: { finishMult: 1.06 },
  },
  {
    id: 'left_foot',
    name: '左足の名手',
    desc: '利き足でなくても精度を落とさない。',
    category: '攻撃',
    acquire: 'シュート練習の継続で習得。',
    effect: { finishMult: 1.03 },
  },
  {
    id: 'pk_killer',
    name: 'PKキラー',
    desc: 'PK戦で確実に決め切る精神力。',
    category: '攻撃',
    acquire: '試合の経験（PK戦の勝利）で習得。',
    effect: { pkMult: 1.35 },
  },
  // 守備
  {
    id: 'iron_wall',
    name: '鉄壁',
    desc: '個の力で相手の攻撃を封じる。',
    category: '守備',
    acquire: '守備トレーニングの継続で習得。',
    effect: { defenseMult: 0.965 },
  },
  {
    id: 'intercept',
    name: 'インターセプト',
    desc: 'パスコースを読み切り、芽を摘む。',
    category: '守備',
    acquire: '守備トレーニングの継続で習得。',
    effect: { defenseMult: 0.975 },
  },
  {
    id: 'aerial_king',
    name: '空中戦の鬼',
    desc: '競り合いで負けることがほとんどない。',
    category: '守備',
    acquire: '守備トレーニングの継続、または試合の経験で習得。',
    effect: { defenseMult: 0.97 },
  },
  {
    id: 'covering',
    name: 'カバーリング',
    desc: '味方の穴を的確に埋める判断力。',
    category: '守備',
    acquire: '守備トレーニングの継続で習得。',
    effect: { defenseMult: 0.98 },
  },
  // GK
  {
    id: 'saving',
    name: 'セービング',
    desc: '至近距離でも反応するゴールキーピング。',
    category: 'GK',
    acquire: '守備トレーニングの継続（GK）で習得。',
    effect: { oppFinishMult: 0.93 },
  },
  {
    id: 'high_claim',
    name: 'ハイボール処理',
    desc: '空中のボールを確実に処理する。',
    category: 'GK',
    acquire: '守備トレーニングの継続（GK）で習得。',
    effect: { oppFinishMult: 0.95 },
  },
  {
    id: 'pk_stopper',
    name: 'PKストッパー',
    desc: 'PK戦でコースを読み切る。',
    category: 'GK',
    acquire: '試合の経験（無失点・PK戦）で習得。',
    effect: { pkStopMult: 0.7 },
  },
  // 精神
  {
    id: 'captaincy',
    name: 'キャプテンシー',
    desc: 'チームを一つにまとめる求心力。',
    category: '精神',
    acquire: 'パス＆連携の継続、または試合の経験で習得。',
    effect: { ratioBonus: 0.015 },
  },
  {
    id: 'clutch',
    name: '勝負強さ',
    desc: '大事な場面ほど力を発揮する。',
    category: '精神',
    acquire: '試合の経験（逆転勝ち）で習得。',
    effect: { ratioBonus: 0.01, comebackBonus: 0.03 },
  },
  {
    id: 'mood_maker',
    name: 'ムードメーカー',
    desc: 'チームの空気を明るく保つ。',
    category: '精神',
    acquire: 'パス＆連携の継続で習得。',
    effect: { ratioBonus: 0.008 },
  },
  {
    id: 'resilience',
    name: '逆境に強い',
    desc: '劣勢でも崩れずプレーできる。',
    category: '精神',
    acquire: '試合の経験（逆転勝ち）で習得。',
    effect: { comebackBonus: 0.05 },
  },
  // 身体
  {
    id: 'stamina_monster',
    name: 'スタミナお化け',
    desc: '90分間、走力が落ちない。',
    category: '身体',
    acquire: 'フィジカルの継続で習得。',
    effect: { fatigueMult: 0.82 },
  },
  {
    id: 'speed_demon',
    name: '韋駄天',
    desc: '一気に加速してラインの裏を突く。',
    category: '身体',
    acquire: 'フィジカルの継続で習得。',
    effect: { attackMult: 1.02, fatigueMult: 0.95 },
  },
  {
    id: 'unshakable',
    name: '当たり負けしない',
    desc: '接触プレーで体勢を崩さない。',
    category: '身体',
    acquire: 'フィジカルの継続で習得。',
    effect: { defenseMult: 0.985 },
  },
  // マイナス
  {
    id: 'egoist',
    name: 'エゴイスト',
    desc: '自分の得点を優先し、連携を乱すことがある。',
    category: 'マイナス',
    negative: true,
    acquire: '日常の出来事で身につくことがある。',
    effect: { attackMult: 0.965 },
  },
  {
    id: 'glass_body',
    name: 'ガラスの身体',
    desc: '疲労が抜けにくく、けがをしやすい。',
    category: 'マイナス',
    negative: true,
    acquire: '日常の出来事で身につくことがある。',
    effect: { fatigueMult: 1.18 },
  },
  {
    id: 'moody',
    name: '気分屋',
    desc: '調子の波が大きく、安定しない。',
    category: 'マイナス',
    negative: true,
    acquire: '日常の出来事で身につくことがある。',
    effect: { ratioBonus: -0.02 },
  },
];
export const SKILLS: Record<string, Skill> = Object.fromEntries(
  skillList.map((s) => [s.id, s]),
);
export const SKILL_LIST = skillList;
function catalogByCategory(cat: SkillCategory): string[] {
  return skillList.filter((s) => s.category === cat).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// A/Bチーム・選手ごとの編成データ
// ---------------------------------------------------------------------------
export type PlayerSquad = {
  detail: DetailPos;
  archetype: Archetype;
  dribble: number;
  stamina: number;
  power: number;
  skills: string[];
  negatives: string[];
  team: 'A' | 'B';
  teamManual: boolean;
  streakMenu: Training | null;
  streakCount: number;
};
export type SquadState = {
  schema: 1;
  players: Record<number, PlayerSquad>;
};

// ---------------------------------------------------------------------------
// 決定的な擬似乱数（既存の rand(s) とは独立。s.seed を消費しない）
// ---------------------------------------------------------------------------
function h32(...ns: number[]): number {
  let x = 2166136261 >>> 0;
  for (const n of ns) x = Math.imul(x ^ (n >>> 0), 16777619) >>> 0;
  return x >>> 0;
}
function hf(...ns: number[]): number {
  return h32(...ns) / 4294967296;
}

export function assignDetailPos(s: State, p: Player): DetailPos {
  const options = detailByBase[p.pos];
  const idx = Math.floor(hf(s.seed, p.id, 7) * options.length);
  return options[Math.min(idx, options.length - 1)];
}
export function assignArchetype(s: State, p: Player): Archetype {
  const options = archByBase[p.pos];
  const idx = Math.floor(hf(s.seed, p.id, 555) * options.length);
  return options[Math.min(idx, options.length - 1)];
}
function deriveExtra(
  s: State,
  p: Player,
): { dribble: number; stamina: number; power: number } {
  const j = (bit: number) => (hf(s.seed, p.id, bit) - 0.5) * 10;
  const dribble = clamp(
    Math.round(p.stats.speed * 0.35 + p.stats.pass * 0.25 + (p.talent - 1) * 26 + j(101)),
    20,
    99,
  );
  const stamina = clamp(
    Math.round(p.stats.speed * 0.25 + p.stats.mental * 0.35 + (2 - p.talent) * 14 + j(202)),
    20,
    99,
  );
  const power = clamp(
    Math.round(p.stats.defend * 0.35 + p.stats.mental * 0.25 + j(303) + 12),
    20,
    99,
  );
  return { dribble, stamina, power };
}

// ---------------------------------------------------------------------------
// 総合能力（表示用。9能力＋詳細ポジションの重みを反映）
// ---------------------------------------------------------------------------
type WeightKey = Stat | ExtraStat;
const detailWeights: Record<DetailPos, Partial<Record<WeightKey, number>>> = {
  GK: { keep: 3, mental: 1, power: 1 },
  CB: { defend: 2, power: 2, mental: 1 },
  LSB: { defend: 2, speed: 1, stamina: 1, dribble: 1 },
  RSB: { defend: 2, speed: 1, stamina: 1, dribble: 1 },
  DM: { defend: 2, pass: 1, mental: 1, stamina: 1 },
  CM: { pass: 2, mental: 1, stamina: 1, dribble: 1 },
  AM: { pass: 1, dribble: 2, shoot: 1, mental: 1 },
  LWG: { dribble: 2, speed: 2, shoot: 1 },
  RWG: { dribble: 2, speed: 2, shoot: 1 },
  CF: { shoot: 2, power: 1, dribble: 1, mental: 1 },
};
export function squadOverall(p: Player, ps: PlayerSquad): number {
  const w = detailWeights[ps.detail];
  const extra: Record<ExtraStat, number> = {
    dribble: ps.dribble,
    stamina: ps.stamina,
    power: ps.power,
  };
  let sum = 0,
    total = 0;
  for (const k of Object.keys(w) as WeightKey[]) {
    const weight = w[k]!;
    const isExtra = k === 'dribble' || k === 'stamina' || k === 'power';
    const val = isExtra ? extra[k as ExtraStat] : p.stats[k as Stat];
    sum += val * weight;
    total += weight;
  }
  return Math.round(sum / total);
}

// ---------------------------------------------------------------------------
// A/Bチーム自動振り分け
// ---------------------------------------------------------------------------
export function assignTeams(s: State): void {
  const sq = s.v3.squad;
  const auto = s.players
    .filter((p) => !sq.players[p.id]?.teamManual)
    .sort((a, b) => squadOverall(b, sq.players[b.id]) - squadOverall(a, sq.players[a.id]));
  const manualACount = s.players.filter(
    (p) => sq.players[p.id]?.teamManual && sq.players[p.id]?.team === 'A',
  ).length;
  const autoCap = Math.max(0, 20 - manualACount);
  auto.forEach((p, i) => {
    sq.players[p.id].team = i < autoCap ? 'A' : 'B';
  });
}

// ---------------------------------------------------------------------------
// S3: ベンチ入り判定（試合登録20人＝先発11(s.lineup)＋ベンチ9）
// ---------------------------------------------------------------------------
// Aチームは常にちょうど20人（assignTeams）で、そのうち先発の11人を除いた残り
// 9人がそのままベンチになる。「自動選出」はautoLineup()の枠適性に基づく先発
// 選考（能力とポジションのバランスを見て最適な11人を選ぶ）の裏返しとして実現
// され、「手動入れ替え」は先発の編成自体を選手詳細から変更すること（既存の
// 'swap'アクション）で行う。そのため独立した永続状態は持たず、常にこの純粋
// 関数で導出する（先発とベンチがずれる不整合が起きない）。Bチームの選手や、
// 現在Aチームでない選手は常にfalse。
export function isBenchPlayer(s: State, id: number): boolean {
  return s.v3.squad.players[id]?.team === 'A' && !s.lineup.includes(id);
}

// ---------------------------------------------------------------------------
// hydrate / validate
// ---------------------------------------------------------------------------
export function hydrateSquad(s: State): void {
  const sq = s.v3.squad;
  for (const p of s.players) {
    if (!sq.players[p.id]) {
      const extra = deriveExtra(s, p);
      sq.players[p.id] = {
        detail: assignDetailPos(s, p),
        archetype: assignArchetype(s, p),
        dribble: extra.dribble,
        stamina: extra.stamina,
        power: extra.power,
        skills: [],
        negatives: [],
        team: 'B',
        teamManual: false,
        streakMenu: null,
        streakCount: 0,
      };
    }
  }
  for (const key of Object.keys(sq.players)) {
    const id = +key;
    if (!s.players.some((p) => p.id === id)) delete sq.players[id];
  }
  assignTeams(s);
}
export function validateSquad(s: State): void {
  const v = s.v3;
  if (!v || v.schema !== 3 || !v.squad || v.squad.schema !== 1)
    throw Error('編成データが不正です。');
  const sq = v.squad;
  const num = (n: unknown, min: number, max: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (Object.keys(sq.players).length !== s.players.length)
    throw Error('編成データの人数が不正です。');
  let teamACount = 0;
  for (const p of s.players) {
    const ps = sq.players[p.id];
    if (!ps) throw Error('選手の編成データがありません。');
    if (!(DETAIL_POS as readonly string[]).includes(ps.detail) || basePos(ps.detail) !== p.pos)
      throw Error('詳細ポジションが不正です。');
    if (!Object.hasOwn(archetypes, ps.archetype)) throw Error('アーキタイプが不正です。');
    if (![ps.dribble, ps.stamina, ps.power].every((n) => num(n, 20, 99)))
      throw Error('拡張能力値が不正です。');
    if (
      !Array.isArray(ps.skills) ||
      ps.skills.length > 5 ||
      !ps.skills.every((id) => Object.hasOwn(SKILLS, id) && !SKILLS[id].negative)
    )
      throw Error('特殊能力データが不正です。');
    if (
      !Array.isArray(ps.negatives) ||
      ps.negatives.length > 2 ||
      !ps.negatives.every((id) => Object.hasOwn(SKILLS, id) && SKILLS[id].negative)
    )
      throw Error('マイナス特能データが不正です。');
    if (new Set([...ps.skills, ...ps.negatives]).size !== ps.skills.length + ps.negatives.length)
      throw Error('特殊能力が重複しています。');
    if (ps.team !== 'A' && ps.team !== 'B') throw Error('所属チームが不正です。');
    if (typeof ps.teamManual !== 'boolean') throw Error('所属チームデータが不正です。');
    if (ps.streakMenu !== null && typeof ps.streakMenu !== 'string')
      throw Error('練習継続データが不正です。');
    if (!num(ps.streakCount, 0, 999)) throw Error('練習継続データが不正です。');
    if (ps.team === 'A') teamACount++;
  }
  if (teamACount > 20) throw Error('Aチームの人数が上限を超えています。');
}

// ---------------------------------------------------------------------------
// grantSkill（他モジュール公開API）
// ---------------------------------------------------------------------------
export function grantSkill(s: State, playerId: number, skillId: string): boolean {
  const sq = s.v3?.squad;
  const sk = SKILLS[skillId];
  const p = s.players.find((x) => x.id === playerId);
  if (!sq || !sk || !p) return false;
  const ps = sq.players[playerId];
  if (!ps) return false;
  const negative = !!sk.negative;
  const list = negative ? ps.negatives : ps.skills;
  if (list.includes(skillId)) return false;
  if (negative) {
    if (ps.negatives.length >= 2) return false;
    ps.negatives.push(skillId);
  } else {
    if (ps.skills.length >= 5) return false;
    ps.skills.push(skillId);
  }
  const text = negative
    ? `${p.name}に特性「${sk.name}」が表れました。`
    : `${p.name}が特殊能力「${sk.name}」を習得しました！`;
  s.feed = [text, ...s.feed].slice(0, 30);
  return true;
}

// ---------------------------------------------------------------------------
// 習得経路1: 練習の継続
// ---------------------------------------------------------------------------
function categoryForMenu(t: Training): SkillCategory[] {
  if (t === 'attack') return ['攻撃'];
  if (t === 'possession') return ['精神'];
  if (t === 'defense') return ['守備', 'GK'];
  if (t === 'physical') return ['身体'];
  return [];
}
export function trainSquadSkills(s: State, t: Training): void {
  const sq = s.v3?.squad;
  if (!sq) return;
  const cats = categoryForMenu(t);
  for (const p of s.players) {
    const ps = sq.players[p.id];
    if (!ps || p.injury) continue;
    if (ps.streakMenu === t) ps.streakCount = Math.min(200, ps.streakCount + 1);
    else {
      ps.streakMenu = t;
      ps.streakCount = 1;
    }
    if (!cats.length || ps.streakCount < 3 || ps.skills.length >= 5) continue;
    const isGK = basePos(ps.detail) === 'GK';
    const pool = cats
      .flatMap((c) => catalogByCategory(c))
      .filter((id) => {
        if (ps.skills.includes(id) || ps.negatives.includes(id)) return false;
        if (SKILLS[id].category === 'GK' && !isGK) return false;
        return true;
      });
    if (!pool.length) continue;
    const chance = clamp(
      0.05 + (p.talent - 1) * 0.12 + (p.identity.trust - 50) / 900,
      0.01,
      0.35,
    );
    const roll = hf(s.seed, p.id, s.week, s.season, 911);
    if (roll < chance) {
      const idx = Math.floor(hf(s.seed, p.id, s.week, 733) * pool.length);
      grantSkill(s, p.id, pool[Math.min(idx, pool.length - 1)]);
    }
  }
}

// ---------------------------------------------------------------------------
// 習得経路3: 試合での経験（ハットトリック・無失点・逆転勝ち）
// ---------------------------------------------------------------------------
export function grantMatchAchievements(s: State): void {
  const m = s.match;
  if (!m || !m.done) return;
  const sq = s.v3?.squad;
  if (!sq) return;
  const cast = m.used.length ? m.used : m.original;
  const tryGrant = (playerId: number, cats: SkillCategory[]) => {
    const ps = sq.players[playerId];
    if (!ps || ps.skills.length >= 5) return;
    const isGK = basePos(ps.detail) === 'GK';
    const pool = cats
      .flatMap((c) => catalogByCategory(c))
      .filter((id) => {
        if (ps.skills.includes(id)) return false;
        if (SKILLS[id].category === 'GK' && !isGK) return false;
        return true;
      });
    if (!pool.length) return;
    const roll = hf(s.seed, playerId, m.minute, s.week, 4242);
    if (roll > 0.55) return;
    const idx = Math.floor(hf(s.seed, playerId, m.minute, 5151) * pool.length);
    grantSkill(s, playerId, pool[Math.min(idx, pool.length - 1)]);
  };
  const goalsBy: Record<number, number> = {};
  for (const h of m.details.highlights)
    if (h.kind === 'goal' && h.side === 0) goalsBy[h.playerId] = (goalsBy[h.playerId] || 0) + 1;
  for (const [pid, g] of Object.entries(goalsBy))
    if (g >= 3) tryGrant(+pid, ['攻撃']);
  if (m.away === 0 && m.won && m.fixture.kind !== 'friendly') {
    for (const id of cast) {
      const ps = sq.players[id];
      if (!ps) continue;
      const b = basePos(ps.detail);
      if (b === 'GK') tryGrant(id, ['GK']);
      else if (b === 'DF') tryGrant(id, ['守備']);
    }
  }
  const firstGoalSide = m.details.highlights.find((h) => h.kind === 'goal')?.side;
  if (m.won && firstGoalSide === 1) for (const id of cast) tryGrant(id, ['精神']);
}

// ---------------------------------------------------------------------------
// 試合シミュレーションへの実効フック
// ---------------------------------------------------------------------------
export type SkillMatchFactors = {
  attack: number;
  defense: number;
  finish: number;
  oppFinish: number;
  ratioBonus: number;
  comebackBonus: number;
  pkMult: number;
  pkStopMult: number;
};
export function skillMatchFactors(s: State): SkillMatchFactors {
  const fx: SkillMatchFactors = {
    attack: 1,
    defense: 1,
    finish: 1,
    oppFinish: 1,
    ratioBonus: 0,
    comebackBonus: 0,
    pkMult: 1,
    pkStopMult: 1,
  };
  const sq = s.v3?.squad;
  if (!sq) return fx;
  for (const id of s.lineup) {
    const ps = sq.players[id];
    if (!ps) continue;
    const isGK = basePos(ps.detail) === 'GK';
    for (const sid of [...ps.skills, ...ps.negatives]) {
      const e = SKILLS[sid]?.effect;
      if (!e) continue;
      if (e.attackMult) fx.attack *= e.attackMult;
      if (e.defenseMult) fx.defense *= e.defenseMult;
      if (e.finishMult) fx.finish *= e.finishMult;
      if (e.ratioBonus) fx.ratioBonus += e.ratioBonus;
      if (e.comebackBonus) fx.comebackBonus += e.comebackBonus;
      if (e.pkMult && !isGK) fx.pkMult *= e.pkMult;
      if (e.pkStopMult && isGK) fx.pkStopMult *= e.pkStopMult;
      if (e.oppFinishMult && isGK) fx.oppFinish *= e.oppFinishMult;
    }
  }
  return fx;
}
export function playerFatigueMult(s: State, playerId: number): number {
  const ps = s.v3?.squad.players[playerId];
  if (!ps) return 1;
  let m = 1;
  for (const sid of [...ps.skills, ...ps.negatives]) {
    const e = SKILLS[sid]?.effect;
    if (e?.fatigueMult) m *= e.fatigueMult;
  }
  return m;
}

// ---------------------------------------------------------------------------
// A/Bチーム手動操作
// ---------------------------------------------------------------------------
export type SquadAction =
  | { type: 'squadTeam'; id: number; team: 'A' | 'B' }
  | { type: 'squadAuto' };
export function handleSquad(s: State, a: SquadAction): boolean {
  if (a.type !== 'squadTeam' && a.type !== 'squadAuto') return false;
  const sq = s.v3.squad;
  if (a.type === 'squadAuto') {
    for (const key of Object.keys(sq.players)) sq.players[+key].teamManual = false;
    assignTeams(s);
    return true;
  }
  const ps = sq.players[a.id];
  if (!ps) throw Error('選手が見つかりません。');
  if (a.team === 'A') {
    const currentA = Object.entries(sq.players).filter(
      ([id, x]) => +id !== a.id && x.team === 'A',
    ).length;
    if (currentA >= 20) throw Error('Aチームは20人までです。');
  }
  ps.team = a.team;
  ps.teamManual = true;
  return true;
}
