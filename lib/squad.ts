import type { State, Player, Position, Stat, Training, Formation } from './game.ts';
import { clamp } from './game.ts';

// ---------------------------------------------------------------------------
// S4: 詳細ポジション（10 → 15）
// ---------------------------------------------------------------------------
export const DETAIL_POS = [
  'GK',
  'CB',
  'LSB',
  'RSB',
  'LWB',
  'RWB',
  'DM',
  'CM',
  'LSH',
  'RSH',
  'AM',
  'LWG',
  'RWG',
  'SS',
  'CF',
] as const;
export type DetailPos = (typeof DETAIL_POS)[number];

export const detailInfo: Record<DetailPos, { name: string; base: Position }> = {
  GK: { name: 'ゴールキーパー', base: 'GK' },
  CB: { name: 'センターバック', base: 'DF' },
  LSB: { name: '左サイドバック', base: 'DF' },
  RSB: { name: '右サイドバック', base: 'DF' },
  LWB: { name: '左ウイングバック', base: 'DF' },
  RWB: { name: '右ウイングバック', base: 'DF' },
  DM: { name: 'ボランチ', base: 'MF' },
  CM: { name: 'センターハーフ', base: 'MF' },
  LSH: { name: '左サイドハーフ', base: 'MF' },
  RSH: { name: '右サイドハーフ', base: 'MF' },
  AM: { name: 'トップ下', base: 'MF' },
  LWG: { name: '左ウイング', base: 'FW' },
  RWG: { name: '右ウイング', base: 'FW' },
  SS: { name: 'セカンドトップ', base: 'FW' },
  CF: { name: 'センターフォワード', base: 'FW' },
};
export function basePos(d: DetailPos): Position {
  return detailInfo[d].base;
}
// 新規部員（旧セーブから引き継がれた選手は元の詳細ポジションを維持する）へ最初の
// 詳細ポジションをランダムに割り当てるときの重み付きプール。
const detailByBase: Record<Position, DetailPos[]> = {
  GK: ['GK'],
  DF: ['CB', 'CB', 'LSB', 'RSB', 'LWB', 'RWB'],
  MF: ['DM', 'CM', 'CM', 'AM', 'LSH', 'RSH'],
  FW: ['CF', 'CF', 'LWG', 'RWG', 'SS'],
};

// ---------------------------------------------------------------------------
// フォーメーションの詳細ポジションスロット
// ---------------------------------------------------------------------------
// 各フォーメーションの11枠が要求する詳細ポジション。並び順は GK → DF → MF → FW で、
// basePos() に通したときに旧来の slots()（GK/DF/MF/FWの粗い並び）と完全に一致する。
export const FORMATION_SLOTS: Record<Formation, DetailPos[]> = {
  '4-3-3': ['GK', 'LSB', 'CB', 'CB', 'RSB', 'DM', 'CM', 'AM', 'LWG', 'CF', 'RWG'],
  '4-4-2': ['GK', 'LSB', 'CB', 'CB', 'RSB', 'LSH', 'DM', 'CM', 'RSH', 'SS', 'CF'],
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LWB', 'DM', 'CM', 'RWB', 'LWG', 'CF', 'RWG'],
  '4-2-3-1': ['GK', 'LSB', 'CB', 'CB', 'RSB', 'DM', 'DM', 'LSH', 'AM', 'RSH', 'CF'],
};
export function formationSlots(f: Formation): DetailPos[] {
  return FORMATION_SLOTS[f];
}
// S4: 起用時の能力倍率は習熟度(0〜100)から連続的に決める（目安: 100→1.00,
// 70→0.95, 50→0.90, 0→0.75）。GKとフィールドプレイヤーの相互起用は習熟度に
// 関わらず最大×0.5に頭打ちする。ps が無い（フォールバック）場合は、旧来の
// 「完全一致=100 / 同じ系統=40 / それ以外=10」相当の習熟度とみなして同じ曲線を適用する。
const PROF_CURVE: readonly [number, number][] = [
  [0, 0.75],
  [50, 0.9],
  [70, 0.95],
  [100, 1],
];
function profCurve(v: number): number {
  const val = clamp(v, 0, 100);
  for (let i = 0; i < PROF_CURVE.length - 1; i++) {
    const [x0, y0] = PROF_CURVE[i];
    const [x1, y1] = PROF_CURVE[i + 1];
    if (val <= x1) return y0 + (y1 - y0) * ((val - x0) / (x1 - x0));
  }
  return PROF_CURVE[PROF_CURVE.length - 1][1];
}
export function positionFitMult(
  ps: { detail: DetailPos; prof?: Partial<Record<DetailPos, number>> } | DetailPos,
  slot: DetailPos,
): number {
  // 後方互換: 純粋関数レベルのテスト・簡易呼び出しのために、第1引数に
  // DetailPos（プレイヤーオブジェクトの代わり）を直接渡すことも許す。
  const detail: DetailPos = typeof ps === 'string' ? ps : ps.detail;
  const profMap = typeof ps === 'string' ? undefined : ps.prof;
  const fallback = detail === slot ? 100 : basePos(detail) === basePos(slot) ? 40 : 10;
  const prof = profMap?.[slot] ?? fallback;
  const mult = profCurve(prof);
  const crossGK = (basePos(slot) === 'GK') !== (basePos(detail) === 'GK');
  return crossGK ? Math.min(mult, 0.5) : mult;
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
// S4: プレースタイル（主ポジションに応じた役割。アーキタイプ=能力の偏りとは別軸）
// ---------------------------------------------------------------------------
export type PlayStyleId =
  | 'gk_shot_stopper'
  | 'gk_sweeper'
  | 'cb_stopper'
  | 'cb_cover'
  | 'cb_buildup'
  | 'sb_defensive'
  | 'sb_attacking'
  | 'wb_shuttle'
  | 'dm_anchor'
  | 'dm_box2box'
  | 'dm_regista'
  | 'sh_playmaker'
  | 'sh_defensive'
  | 'am_conductor'
  | 'am_shadow'
  | 'wg_dribbler'
  | 'wg_cutin'
  | 'ss_shadow'
  | 'ss_creator'
  | 'cf_post'
  | 'cf_poacher'
  | 'cf_runner';
export type PlayStyle = {
  id: PlayStyleId;
  name: string;
  desc: string;
  /** このスタイルを選べる詳細ポジション。 */
  positions: DetailPos[];
  /** 試合計算への小さな実数効果（SkillEffectと同じ形を再利用）。 */
  effect: SkillEffect;
  /** 成長時、対応する能力の伸びをわずかに後押しする倍率。 */
  growth: Partial<Record<Stat, number>>;
};
const styleList: PlayStyle[] = [
  {
    id: 'gk_shot_stopper',
    name: 'ショットストッパー型',
    desc: '反応でシュートを止める、瞬発力重視のGK。',
    positions: ['GK'],
    effect: { oppFinishMult: 0.985 },
    growth: { keep: 1.12, speed: 1.08 },
  },
  {
    id: 'gk_sweeper',
    name: 'スイーパー型',
    desc: '背後のスペースを管理し、足元でビルドアップに関わる。',
    positions: ['GK'],
    effect: { defenseMult: 0.99, attackMult: 1.01 },
    growth: { defend: 1.1, pass: 1.1 },
  },
  {
    id: 'cb_stopper',
    name: 'ストッパー型',
    desc: '1対1で潰し切る、対人の強さが武器。',
    positions: ['CB'],
    effect: { defenseMult: 0.985 },
    growth: { defend: 1.12, speed: 1.06 },
  },
  {
    id: 'cb_cover',
    name: 'カバーリング型',
    desc: '広い視野で味方の穴を埋め、決定機の芽を摘む。',
    positions: ['CB'],
    effect: { oppFinishMult: 0.99 },
    growth: { defend: 1.08, mental: 1.1 },
  },
  {
    id: 'cb_buildup',
    name: 'ビルドアップ型',
    desc: '後方から正確なパスで攻撃を組み立てる。',
    positions: ['CB'],
    effect: { attackMult: 1.012 },
    growth: { pass: 1.14, mental: 1.06 },
  },
  {
    id: 'sb_defensive',
    name: '守備的サイドバック',
    desc: 'まず自陣を固める、堅実な守備者。',
    positions: ['LSB', 'RSB', 'LWB', 'RWB'],
    effect: { defenseMult: 0.99 },
    growth: { defend: 1.12, mental: 1.05 },
  },
  {
    id: 'sb_attacking',
    name: '攻撃的サイドバック',
    desc: '積極的にオーバーラップし、攻撃に厚みを加える。',
    positions: ['LSB', 'RSB', 'LWB', 'RWB'],
    effect: { attackMult: 1.012 },
    growth: { speed: 1.1, pass: 1.08 },
  },
  {
    id: 'wb_shuttle',
    name: '上下動型ウイングバック',
    desc: 'サイドを往復し続け、攻守両面を走力で支える。',
    positions: ['LWB', 'RWB'],
    effect: { attackMult: 1.008, defenseMult: 0.995, fatigueMult: 1.08 },
    growth: { speed: 1.12, mental: 1.06 },
  },
  {
    id: 'dm_anchor',
    name: 'アンカー',
    desc: '最後尾で構え、攻撃の芽を摘み続ける。',
    positions: ['DM', 'CM'],
    effect: { defenseMult: 0.985 },
    growth: { defend: 1.12, mental: 1.08 },
  },
  {
    id: 'dm_box2box',
    name: 'ボックス・トゥ・ボックス',
    desc: '両ゴール前を走力で往復し、攻守に顔を出す。',
    positions: ['DM', 'CM'],
    effect: { attackMult: 1.008, defenseMult: 0.995, fatigueMult: 1.08 },
    growth: { speed: 1.1, defend: 1.06 },
  },
  {
    id: 'dm_regista',
    name: '配球型（レジスタ）',
    desc: '低い位置から正確な展開で攻撃を組み立てる司令塔。',
    positions: ['DM', 'CM'],
    effect: { attackMult: 1.015, ratioBonus: 0.006 },
    growth: { pass: 1.14, mental: 1.08 },
  },
  {
    id: 'sh_playmaker',
    name: 'チャンスメーカー',
    desc: 'サイドから質の高いクロス・パスで好機を演出する。',
    positions: ['LSH', 'RSH'],
    effect: { attackMult: 1.015 },
    growth: { pass: 1.12, speed: 1.06 },
  },
  {
    id: 'sh_defensive',
    name: '守備的サイドハーフ',
    desc: 'サイドの守備を最優先し、無理なく帰陣する。',
    positions: ['LSH', 'RSH'],
    effect: { defenseMult: 0.99 },
    growth: { defend: 1.12, speed: 1.06 },
  },
  {
    id: 'am_conductor',
    name: '司令塔',
    desc: '試合のテンポを操り、チーム全体を統率する。',
    positions: ['AM'],
    effect: { ratioBonus: 0.01, attackMult: 1.01 },
    growth: { pass: 1.14, mental: 1.1 },
  },
  {
    id: 'am_shadow',
    name: 'シャドーストライカー',
    desc: '前線の裏に潜り、得点に直結する仕事をこなす。',
    positions: ['AM'],
    effect: { finishMult: 1.03 },
    growth: { shoot: 1.14, mental: 1.06 },
  },
  {
    id: 'wg_dribbler',
    name: '突破型ウイング',
    desc: 'スピードとドリブルで局面を切り裂く。',
    positions: ['LWG', 'RWG'],
    effect: { attackMult: 1.02 },
    growth: { speed: 1.16, mental: 1.06 },
  },
  {
    id: 'wg_cutin',
    name: 'カットイン型',
    desc: '中央に切れ込み、逆足でゴールを狙う。',
    positions: ['LWG', 'RWG'],
    effect: { finishMult: 1.025 },
    growth: { shoot: 1.14, speed: 1.06 },
  },
  {
    id: 'ss_shadow',
    name: 'シャドーストライカー',
    desc: 'CFの近くで裏へ抜け出し、得点機に絡む。',
    positions: ['SS'],
    effect: { finishMult: 1.03 },
    growth: { shoot: 1.12, speed: 1.08 },
  },
  {
    id: 'ss_creator',
    name: 'チャンスメーカー',
    desc: '前線から降りて受け、決定機を演出する。',
    positions: ['SS'],
    effect: { attackMult: 1.018 },
    growth: { pass: 1.12, mental: 1.08 },
  },
  {
    id: 'cf_post',
    name: 'ポストプレイヤー',
    desc: '体を張ってボールを収め、攻撃の起点になる。',
    positions: ['CF'],
    effect: { finishMult: 1.015, attackMult: 1.008 },
    growth: { defend: 1.1, pass: 1.1 },
  },
  {
    id: 'cf_poacher',
    name: 'ポーチャー（点取り屋）',
    desc: 'ゴール前の一瞬の隙を逃さない、決定力の塊。',
    positions: ['CF'],
    effect: { finishMult: 1.045 },
    growth: { shoot: 1.16, mental: 1.06 },
  },
  {
    id: 'cf_runner',
    name: '裏抜け型',
    desc: '走力でラインの裏を狙い、スペースを突く。',
    positions: ['CF'],
    effect: { finishMult: 1.02, attackMult: 1.01 },
    growth: { speed: 1.14, shoot: 1.06 },
  },
];
export const PLAY_STYLES: Record<PlayStyleId, PlayStyle> = Object.fromEntries(
  styleList.map((st) => [st.id, st]),
) as Record<PlayStyleId, PlayStyle>;
export const PLAY_STYLE_LIST = styleList;
export function stylesFor(detail: DetailPos): PlayStyle[] {
  return styleList.filter((st) => st.positions.includes(detail));
}

// ---------------------------------------------------------------------------
// S4: ポジション習熟度（0〜100、15ポジション分）
// ---------------------------------------------------------------------------
export type Proficiency = Record<DetailPos, number>;
// 系統が近いポジション（試合出場時、主に起用されたスロットからわずかに波及する）。
const NEARBY_POS: Partial<Record<DetailPos, DetailPos[]>> = {
  CB: ['LSB', 'RSB'],
  LSB: ['CB', 'LWB'],
  RSB: ['CB', 'RWB'],
  LWB: ['LSB', 'LSH'],
  RWB: ['RSB', 'RSH'],
  DM: ['CM'],
  CM: ['DM', 'AM'],
  LSH: ['LWB', 'LWG', 'AM'],
  RSH: ['RWB', 'RWG', 'AM'],
  AM: ['CM', 'SS'],
  LWG: ['LSH', 'SS'],
  RWG: ['RSH', 'SS'],
  SS: ['AM', 'CF'],
  CF: ['SS'],
};
// 習熟度60到達で「サブポジション習得」とみなす。
export const MASTERY_THRESHOLD = 60;
export function initialProficiency(detail: DetailPos): Proficiency {
  const base = basePos(detail);
  const rec = {} as Proficiency;
  for (const d of DETAIL_POS) rec[d] = d === detail ? 100 : basePos(d) === base ? 40 : 10;
  return rec;
}
// ---------------------------------------------------------------------------
// T2: 新規に部員となる選手（新規ゲームの初期20人・卒業後の新入生）へ「現実的な
// サブポジション」の習熟度を初期から付ける。主ポジションごとに、隣接する
// ポジションへ習熟度60（MASTERY_THRESHOLD）前後の適性を持たせることで、
// 「4つのフォーメーションすべてで各枠に習熟度60以上の候補が2人以上」という
// 受け入れ条件を満たす。旧セーブ移行（legacy migration）は initialProficiency()
// の単純な100/40/10のまま変えない（既存テストが固定値を検証しているため）。
// ---------------------------------------------------------------------------
const SUB_POSITION_BACKUP: Partial<Record<DetailPos, { pos: DetailPos; value: number }[]>> = {
  CB: [
    { pos: 'LSB', value: 60 },
    { pos: 'RSB', value: 60 },
  ],
  LSB: [
    { pos: 'LWB', value: 65 },
    { pos: 'CB', value: 50 },
  ],
  RSB: [
    { pos: 'RWB', value: 65 },
    { pos: 'CB', value: 50 },
  ],
  LWB: [
    { pos: 'LSB', value: 60 },
    { pos: 'LSH', value: 50 },
  ],
  RWB: [
    { pos: 'RSB', value: 60 },
    { pos: 'RSH', value: 50 },
  ],
  DM: [
    { pos: 'CM', value: 65 },
    { pos: 'CB', value: 45 },
  ],
  CM: [
    { pos: 'DM', value: 55 },
    { pos: 'AM', value: 45 },
  ],
  LSH: [
    { pos: 'LWG', value: 60 },
    { pos: 'LWB', value: 60 },
  ],
  RSH: [
    { pos: 'RWG', value: 60 },
    { pos: 'RWB', value: 60 },
  ],
  AM: [
    { pos: 'SS', value: 50 },
    { pos: 'CM', value: 45 },
  ],
  LWG: [
    { pos: 'LSH', value: 60 },
    { pos: 'SS', value: 45 },
  ],
  RWG: [
    { pos: 'RSH', value: 60 },
    { pos: 'SS', value: 45 },
  ],
  SS: [
    { pos: 'AM', value: 60 },
    { pos: 'CF', value: 50 },
  ],
  CF: [
    { pos: 'SS', value: 60 },
    { pos: 'CM', value: 35 },
  ],
};
export function realisticInitialProficiency(detail: DetailPos): Proficiency {
  const rec = initialProficiency(detail);
  for (const { pos, value } of SUB_POSITION_BACKUP[detail] ?? [])
    rec[pos] = Math.max(rec[pos], value);
  return rec;
}
// ---------------------------------------------------------------------------
// T2: 新規ゲーム20人分の詳細ポジション・学年の割り当て（決定的な固定プラン）。
// GK2/CB3/LSB1/RSB1/DM2/CM2/LSH1/RSH1/AM1/LWG1/RWG1/SS1/CF2＋CB1（計20）。
// newGame() が作る20人の Player と同じ順序で zip して使う（applyInitialDetailPlan）。
// ---------------------------------------------------------------------------
export const INITIAL_ROSTER_PLAN: { year: number; detail: DetailPos }[] = [
  { year: 1, detail: 'GK' },
  { year: 3, detail: 'GK' },
  { year: 1, detail: 'CB' },
  { year: 2, detail: 'CB' },
  { year: 3, detail: 'CB' },
  { year: 2, detail: 'CB' },
  { year: 1, detail: 'LSB' },
  { year: 2, detail: 'RSB' },
  { year: 1, detail: 'DM' },
  { year: 3, detail: 'DM' },
  { year: 2, detail: 'CM' },
  { year: 3, detail: 'CM' },
  { year: 1, detail: 'LSH' },
  { year: 2, detail: 'RSH' },
  { year: 3, detail: 'AM' },
  { year: 1, detail: 'LWG' },
  { year: 2, detail: 'RWG' },
  { year: 3, detail: 'SS' },
  { year: 1, detail: 'CF' },
  { year: 2, detail: 'CF' },
];
/** newGame() が作った20人（INITIAL_ROSTER_PLANと同じ順序）へ、プラン通りの詳細
 * ポジション・現実的なサブポジション習熟度・整合するプレースタイルを確定させる。
 * hydrateV3(s) 実行後（各選手のPlayerSquadエントリが揃った後）にだけ呼ぶこと。 */
export function applyInitialDetailPlan(s: State): void {
  const sq = s.v3.squad;
  s.players.forEach((p, i) => {
    const plan = INITIAL_ROSTER_PLAN[i];
    const ps = sq.players[p.id];
    if (!plan || !ps) return;
    ps.detail = plan.detail;
    ps.prof = realisticInitialProficiency(plan.detail);
    ps.style = assignStyle(p, plan.detail);
  });
}
/** 卒業後の新入生（intake）など、選んだ詳細ポジションはそのまま(assignDetailPos)に、
 * 習熟度だけ「現実的なサブポジション」を持つ状態へ差し替える。hydrateV3(s) 実行後
 * （対象プレイヤーのPlayerSquadエントリが揃った後）にだけ呼ぶこと。旧セーブ移行の
 * 挙動（100/40/10固定）には影響しない。 */
export function applyRealisticSubProficiency(s: State, ids: number[]): void {
  const sq = s.v3.squad;
  for (const id of ids) {
    const ps = sq.players[id];
    if (!ps) continue;
    ps.prof = realisticInitialProficiency(ps.detail);
  }
}
/** 習熟度を加算し、60到達で習得メッセージをフィードへ出す。系統が近いポジションにも少し波及する。 */
export function gainProficiency(
  s: State,
  playerId: number,
  pos: DetailPos,
  amount: number,
  spillover = true,
): void {
  const sq = s.v3?.squad;
  if (!sq || amount <= 0) return;
  const ps = sq.players[playerId];
  const p = s.players.find((x) => x.id === playerId);
  if (!ps || !p) return;
  if (!ps.prof) ps.prof = initialProficiency(ps.detail);
  const before = ps.prof[pos] ?? 0;
  const after = clamp(before + amount, 0, 100);
  ps.prof[pos] = after;
  if (before < MASTERY_THRESHOLD && after >= MASTERY_THRESHOLD) {
    s.feed = [
      `${p.name}が${detailInfo[pos].name}（${pos}）のサブポジションを習得しました！`,
      ...s.feed,
    ].slice(0, 30);
  }
  if (spillover) {
    const near = NEARBY_POS[pos] ?? [];
    const spilloverAmt = clamp(amount * 0.25, 0, 1);
    for (const n of near) gainProficiency(s, playerId, n, spilloverAmt, false);
  }
}

// ---------------------------------------------------------------------------
// A/Bチーム・選手ごとの編成データ
// ---------------------------------------------------------------------------
export type PlayerSquad = {
  detail: DetailPos;
  archetype: Archetype;
  style: PlayStyleId;
  prof: Proficiency;
  dribble: number;
  stamina: number;
  power: number;
  skills: string[];
  negatives: string[];
  team: 'A' | 'B';
  teamManual: boolean;
  streakMenu: Training | null;
  streakCount: number;
  // T2: 調子（0〜100、50=普通）。旧セーブは全員 MOOD_DEFAULT(50) で補う。
  // optionalにせず必須で持たせる（交代ダイアログなど他機能が常に参照できるようにするため）。
  mood: number;
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

// T2: 「手薄なポジション（候補が少ない枠）を優先して割り当てる」。既に部に
// 所属している選手の詳細ポジション分布を数え、同じ系統の選択肢の中で最も人数が
// 少ないものを優先する（同数なら決定的なハッシュで選ぶ）。新規ゲームの初期20人は
// applyInitialDetailPlan() が別途プラン通りに上書きするので、この関数が実際に
// 効くのは卒業後の新入生（finishWeek の intake）が中心になる。
function countDetailAssignments(s: State): Partial<Record<DetailPos, number>> {
  const counts: Partial<Record<DetailPos, number>> = {};
  const sq = s.v3?.squad;
  if (!sq) return counts;
  for (const key of Object.keys(sq.players)) {
    const d = sq.players[+key].detail;
    counts[d] = (counts[d] ?? 0) + 1;
  }
  return counts;
}
export function assignDetailPos(s: State, p: Player): DetailPos {
  const options = [...new Set(detailByBase[p.pos])];
  const counts = countDetailAssignments(s);
  const minCount = Math.min(...options.map((o) => counts[o] ?? 0));
  const scarce = options.filter((o) => (counts[o] ?? 0) === minCount);
  const idx = Math.floor(hf(s.seed, p.id, 7) * scarce.length);
  return scarce[Math.min(idx, scarce.length - 1)];
}
export function assignArchetype(s: State, p: Player): Archetype {
  const options = archByBase[p.pos];
  const idx = Math.floor(hf(s.seed, p.id, 555) * options.length);
  return options[Math.min(idx, options.length - 1)];
}
// S4: プレースタイルは選手の id のみを種に決定的に割り当てる（s.seed を混ぜない）。
// 旧セーブ移行でも同じ関数で決定的に補える。
export function assignStyle(p: Player, detail: DetailPos): PlayStyleId {
  const options = stylesFor(detail).map((st) => st.id);
  const idx = Math.floor(hf(p.id, 8080) * options.length);
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
  LWB: { defend: 1, speed: 2, stamina: 2, dribble: 1 },
  RWB: { defend: 1, speed: 2, stamina: 2, dribble: 1 },
  DM: { defend: 2, pass: 1, mental: 1, stamina: 1 },
  CM: { pass: 2, mental: 1, stamina: 1, dribble: 1 },
  LSH: { pass: 1, dribble: 2, speed: 1, mental: 1 },
  RSH: { pass: 1, dribble: 2, speed: 1, mental: 1 },
  AM: { pass: 1, dribble: 2, shoot: 1, mental: 1 },
  LWG: { dribble: 2, speed: 2, shoot: 1 },
  RWG: { dribble: 2, speed: 2, shoot: 1 },
  SS: { shoot: 2, dribble: 1, mental: 1, pass: 1 },
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
// T2: 調子（5段階）。毎日決定的に変動し、試合の実効能力に小さな倍率で反映する。
// 表示は文字＋Lucideの矢印アイコン（app/ability-sheet.tsx 側）で、色だけに頼らない。
// ---------------------------------------------------------------------------
export type MoodLevel = 'excellent' | 'good' | 'normal' | 'poor' | 'bad';
export const MOOD_LEVELS: MoodLevel[] = ['bad', 'poor', 'normal', 'good', 'excellent'];
export const MOOD_LABEL: Record<MoodLevel, string> = {
  excellent: '絶好調',
  good: '好調',
  normal: '普通',
  poor: '不調',
  bad: '絶不調',
};
export const MOOD_MULT: Record<MoodLevel, number> = {
  excellent: 1.06,
  good: 1.03,
  normal: 1.0,
  poor: 0.97,
  bad: 0.94,
};
// 旧セーブ・新規選手の初期値。5段階のちょうど中央（普通）。
export const MOOD_DEFAULT = 50;
export function moodLevel(value: number): MoodLevel {
  if (value >= 80) return 'excellent';
  if (value >= 60) return 'good';
  if (value >= 40) return 'normal';
  if (value >= 20) return 'poor';
  return 'bad';
}
export function moodMultiplier(value: number): number {
  return MOOD_MULT[moodLevel(value)];
}
/** 1日ぶんの調子の変動。普通(50)へ戻ろうとする力＋休養で上向き・高疲労で下向き・
 * 士気が高いと上向き・小さな揺らぎ、を決定的に適用する。s.seedは消費しない
 * （ハッシュのみを種にするため、ゲーム進行の決定性・再現性には影響しない）。 */
export function advanceSquadMood(s: State, isRest: boolean): void {
  const sq = s.v3?.squad;
  if (!sq) return;
  for (const p of s.players) {
    const ps = sq.players[p.id];
    if (!ps) continue;
    const revert = (MOOD_DEFAULT - ps.mood) * 0.12;
    const restBonus = isRest ? 3 : 0;
    const fatiguePenalty = p.fatigue > 65 ? -2.5 : p.fatigue > 45 ? -1 : 0;
    const moraleBonus = s.morale > 70 ? 1 : s.morale < 40 ? -1 : 0;
    const wobble = (hf(s.seed, p.id, s.week, s.day, 9001) - 0.5) * 6;
    ps.mood = clamp(ps.mood + revert + restBonus + fatiguePenalty + moraleBonus + wobble, 0, 100);
  }
}

// ---------------------------------------------------------------------------
// hydrate / validate
// ---------------------------------------------------------------------------
export function hydrateSquad(s: State): void {
  const sq = s.v3.squad;
  for (const p of s.players) {
    if (!sq.players[p.id]) {
      const extra = deriveExtra(s, p);
      const detail = assignDetailPos(s, p);
      sq.players[p.id] = {
        detail,
        archetype: assignArchetype(s, p),
        style: assignStyle(p, detail),
        // 旧セーブ移行（既存プレイヤーがv3データを初めて持つ場合を含む）は決定的な
        // 100/40/10のまま（既存テストが固定値を検証している）。新規ゲームの初期20人・
        // 卒業後の新入生への「現実的なサブポジション」付与は、この関数の外側
        // （applyInitialDetailPlan / applyRealisticSubProficiency）で別途行う。
        prof: initialProficiency(detail),
        dribble: extra.dribble,
        stamina: extra.stamina,
        power: extra.power,
        skills: [],
        negatives: [],
        team: 'B',
        teamManual: false,
        streakMenu: null,
        streakCount: 0,
        mood: MOOD_DEFAULT,
      };
    } else {
      // S4: 旧セーブ（15ポジション・習熟度・プレースタイル導入前）を決定的に補う。
      // ps.detail は旧10ポジションのいずれかで、そのまま新15ポジションの部分集合として
      // 有効な値なので detail 自体は移行不要。習熟度は「現ポジション100・同系統40・
      // 他10」で、プレースタイルは id を種に決定的に初期化する。
      const ps = sq.players[p.id];
      if (!ps.prof) ps.prof = initialProficiency(ps.detail);
      if (
        !ps.style ||
        !Object.hasOwn(PLAY_STYLES, ps.style) ||
        !PLAY_STYLES[ps.style].positions.includes(ps.detail)
      )
        ps.style = assignStyle(p, ps.detail);
      // T2: 旧セーブ（調子導入前）は全員「普通」で補う。
      if (typeof ps.mood !== 'number' || !Number.isFinite(ps.mood)) ps.mood = MOOD_DEFAULT;
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
    if (!Object.hasOwn(PLAY_STYLES, ps.style) || !PLAY_STYLES[ps.style].positions.includes(ps.detail))
      throw Error('プレースタイルが不正です。');
    if (
      !ps.prof ||
      !DETAIL_POS.every((d) => num(ps.prof[d], 0, 100))
    )
      throw Error('ポジション習熟度データが不正です。');
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
    if (!num(ps.mood, 0, 100)) throw Error('調子データが不正です。');
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
  if (m.pk) {
    const scorers = new Set(m.pk.kicks.filter((kick) => kick.side === 0 && kick.scored)
      .map((kick) => kick.kickerId).filter((id): id is number => id !== null));
    for (const id of scorers) {
      if (hf(s.seed, id, s.week, 6010) < 0.35) grantSkill(s, id, 'pk_killer');
    }
    if (m.pk.kicks.some((kick) => kick.side === 1 && kick.saved)) {
      const keeperId = s.lineup[0];
      if (hf(s.seed, keeperId, s.week, 6011) < 0.4) grantSkill(s, keeperId, 'pk_stopper');
    }
  }
}

// ---------------------------------------------------------------------------
// 習得経路4（v3.4）: 評価点7.5以上での特殊能力習得（試合で最も記録した分野に対応、
// MOMは確率アップ）。既存の3経路（練習継続・試合の経験）とは独立に抽選する。
// ---------------------------------------------------------------------------
export function grantPerformanceSkill(
  s: State,
  playerId: number,
  rating: number,
  isMOM: boolean,
  topCategory: SkillCategory,
): boolean {
  if (rating < 7.5) return false;
  const sq = s.v3?.squad;
  if (!sq) return false;
  const ps = sq.players[playerId];
  if (!ps || ps.skills.length >= 5) return false;
  const isGK = basePos(ps.detail) === 'GK';
  const inCategory = (cat: SkillCategory) =>
    catalogByCategory(cat).filter(
      (id) =>
        !ps.skills.includes(id) &&
        !ps.negatives.includes(id) &&
        (SKILLS[id].category !== 'GK' || isGK),
    );
  const pool = inCategory(topCategory).length ? inCategory(topCategory) : inCategory('精神');
  if (!pool.length) return false;
  const chance = clamp(0.08 + (rating - 7.5) * 0.12 + (isMOM ? 0.15 : 0), 0, 0.6);
  const roll = hf(s.seed, playerId, s.week, s.season, 8642);
  if (roll >= chance) return false;
  const idx = Math.floor(hf(s.seed, playerId, s.week, 9753) * pool.length);
  return grantSkill(s, playerId, pool[Math.min(idx, pool.length - 1)]);
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
    // S4: プレースタイルも特殊能力と同じ SkillEffect 形状で、小さな実数効果を試合計算に持つ。
    const se = PLAY_STYLES[ps.style]?.effect;
    if (se) {
      if (se.attackMult) fx.attack *= se.attackMult;
      if (se.defenseMult) fx.defense *= se.defenseMult;
      if (se.finishMult) fx.finish *= se.finishMult;
      if (se.ratioBonus) fx.ratioBonus += se.ratioBonus;
      if (se.comebackBonus) fx.comebackBonus += se.comebackBonus;
      if (se.pkMult && !isGK) fx.pkMult *= se.pkMult;
      if (se.pkStopMult && isGK) fx.pkStopMult *= se.pkStopMult;
      if (se.oppFinishMult && isGK) fx.oppFinish *= se.oppFinishMult;
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
  const se = PLAY_STYLES[ps.style]?.effect;
  if (se?.fatigueMult) m *= se.fatigueMult;
  return m;
}

// ---------------------------------------------------------------------------
// A/Bチーム手動操作
// ---------------------------------------------------------------------------
export type SquadAction =
  | { type: 'squadTeam'; id: number; team: 'A' | 'B' }
  | { type: 'squadAuto' }
  | { type: 'squadStyle'; id: number; style: PlayStyleId }
  | { type: 'squadPrimaryPos'; id: number; detail: DetailPos };
export function handleSquad(s: State, a: SquadAction): boolean {
  if (
    a.type !== 'squadTeam' &&
    a.type !== 'squadAuto' &&
    a.type !== 'squadStyle' &&
    a.type !== 'squadPrimaryPos'
  )
    return false;
  const sq = s.v3.squad;
  if (a.type === 'squadAuto') {
    for (const key of Object.keys(sq.players)) sq.players[+key].teamManual = false;
    assignTeams(s);
    return true;
  }
  if (a.type === 'squadStyle') {
    const ps = sq.players[a.id];
    if (!ps) throw Error('選手が見つかりません。');
    const st = PLAY_STYLES[a.style];
    if (!st || !st.positions.includes(ps.detail))
      throw Error('現在のポジションでは選べないプレースタイルです。');
    ps.style = a.style;
    return true;
  }
  if (a.type === 'squadPrimaryPos') {
    const ps = sq.players[a.id];
    const p = s.players.find((x) => x.id === a.id);
    if (!ps || !p) throw Error('選手が見つかりません。');
    if (!(DETAIL_POS as readonly string[]).includes(a.detail))
      throw Error('ポジションが不正です。');
    if (a.detail === ps.detail) return true;
    if (basePos(a.detail) !== p.pos) throw Error('系統(GK/DF/MF/FW)が異なるポジションには変更できません。');
    if ((ps.prof[a.detail] ?? 0) < MASTERY_THRESHOLD)
      throw Error(`習熟度が${MASTERY_THRESHOLD}に達したポジションのみ、主ポジションに変更できます。`);
    ps.detail = a.detail;
    if (!stylesFor(a.detail).some((st) => st.id === ps.style)) ps.style = assignStyle(p, a.detail);
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

// ユーザー要望（2026-09-26）: 育成重視の編成は習熟度D（50）未満を起用しないが、新入生の顔ぶれ次第で
// その年だけ特定の枠にD以上の候補がAチームにいないことがある（6シーズンの点検で約0.8%）。
// 戦術ボードで知らせるため、現在のフォーメーションで「D以上の候補がAチームにいない枠」を返す。
// 同じ詳細ポジションが複数ある布陣（CB×2など）は、必要な人数に対して候補が足りない場合に返す。
export function thinSlots(s: State, formation: Formation, minProf = 50): DetailPos[] {
  const teamA = s.players.filter((p) => s.v3.squad.players[p.id]?.team === 'A' && !p.injury);
  const need = new Map<DetailPos, number>();
  for (const slot of formationSlots(formation)) need.set(slot, (need.get(slot) ?? 0) + 1);
  const thin: DetailPos[] = [];
  for (const [slot, n] of need) {
    const have = teamA.filter((p) => (s.v3.squad.players[p.id]?.prof[slot] ?? 0) >= minProf).length;
    if (have < n) thin.push(slot);
  }
  return thin;
}
