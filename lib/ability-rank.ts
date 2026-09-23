// ---------------------------------------------------------------------------
// S2: 能力ランク（ギリシャ文字）
// ---------------------------------------------------------------------------
// 能力値（1〜99）を7段階のランクに変換する純粋関数群。αが最上位。
// 英字（A〜G）は「Aチーム/Bチーム」やスカウトの「素質 A」と紛れるため使わない。
//
// 色は各ランクの文字色（fg）と背景色（bg）の組を、ライト・ダーク両テーマで持つ。
// ここに置いた16進値が唯一の正であり、app/globals.css の --rank-*-fg / --rank-*-bg
// はこの値をそのまま書き写したもの（重複管理だが、CSSを読まずにテストできるようにするため）。
// 変更する場合は両方を必ず揃えて更新すること。

export type RankId = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta' | 'eta';

export type RankColorSet = { fg: string; bg: string };
export type RankColors = { light: RankColorSet; dark: RankColorSet };

export type RankInfo = {
  id: RankId;
  letter: string;
  reading: string;
  /** このランクになる能力値の下限（この値以上でこのランク）。 */
  min: number;
  colors: RankColors;
};

const RANK_COLORS: Record<RankId, RankColors> = {
  alpha: {
    light: { fg: '#5b21b6', bg: '#efe6fb' },
    dark: { fg: '#d5b8fb', bg: '#2a1f42' },
  },
  beta: {
    light: { fg: '#1d4ed8', bg: '#e3edfb' },
    dark: { fg: '#a8c6fb', bg: '#1a2740' },
  },
  gamma: {
    light: { fg: '#157347', bg: '#e1f5ea' },
    dark: { fg: '#8fe0b6', bg: '#142a1e' },
  },
  delta: {
    light: { fg: '#8a5a00', bg: '#fdf1d9' },
    dark: { fg: '#f3cf7e', bg: '#2c2210' },
  },
  epsilon: {
    light: { fg: '#9a4b0a', bg: '#fde8d9' },
    dark: { fg: '#f5b784', bg: '#2c1d10' },
  },
  zeta: {
    light: { fg: '#46586a', bg: '#e8eef2' },
    dark: { fg: '#b9c7d4', bg: '#202a32' },
  },
  eta: {
    light: { fg: '#7a3030', bg: '#f4e4e4' },
    dark: { fg: '#e8a9a3', bg: '#2c1a1a' },
  },
};

// 能力値のしきい値: α 80〜 / β 70〜79 / γ 60〜69 / δ 50〜59 / ε 40〜49 / ζ 20〜39 / η 〜19
export const RANKS: readonly RankInfo[] = [
  { id: 'alpha', letter: 'α', reading: 'アルファ', min: 80, colors: RANK_COLORS.alpha },
  { id: 'beta', letter: 'β', reading: 'ベータ', min: 70, colors: RANK_COLORS.beta },
  { id: 'gamma', letter: 'γ', reading: 'ガンマ', min: 60, colors: RANK_COLORS.gamma },
  { id: 'delta', letter: 'δ', reading: 'デルタ', min: 50, colors: RANK_COLORS.delta },
  { id: 'epsilon', letter: 'ε', reading: 'イプシロン', min: 40, colors: RANK_COLORS.epsilon },
  { id: 'zeta', letter: 'ζ', reading: 'ゼータ', min: 20, colors: RANK_COLORS.zeta },
  { id: 'eta', letter: 'η', reading: 'イータ', min: 0, colors: RANK_COLORS.eta },
];

export const RANK_IDS: readonly RankId[] = RANKS.map((r) => r.id);

export const RANK_BY_ID: Record<RankId, RankInfo> = Object.fromEntries(
  RANKS.map((r) => [r.id, r]),
) as Record<RankId, RankInfo>;

/** 能力値（1〜99を想定。範囲外は最も近い側のランクに寄せる）からランク情報を求める。 */
export function rankOf(value: number): RankInfo {
  for (const r of RANKS) if (value >= r.min) return r;
  return RANKS[RANKS.length - 1];
}

export function rankLetterOf(value: number): string {
  return rankOf(value).letter;
}

/** ランク文字＋読み＋能力値をまとめた読み上げ用のラベル（title/aria-label向け）。 */
export function rankAriaLabel(value: number, name?: string): string {
  const r = rankOf(value);
  const prefix = name ? `${name}：` : '';
  return `${prefix}ランク${r.letter}（${r.reading}）、能力値${value}`;
}

// ---------------------------------------------------------------------------
// WCAG コントラスト比（sRGB相対輝度）。CSSを介さずに色の組み合わせを検証できるようにする。
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function linearize(c: number): number {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2.x のコントラスト比（1〜21）。文字は4.5:1以上、境界・非文字要素は3:1以上を目安にする。 */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
