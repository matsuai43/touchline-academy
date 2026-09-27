// TOUCHLINE ACADEMY v3.3 — T3-2: 選手ごとの月次トレーニング方針。
//
// 各選手に「個人方針」を持たせ、練習日（休養以外）の成長を
// 「チームのメニュー60% ＋ 個人方針40%」に配分する（チーム分は lib/game.ts の
// advanceTrainingDay 側、個人方針分はこのファイルの applyIndividualGrowth が担う）。
// 月の初め（4週ごと）に見直しを促す（app/training-policy-ui.tsx）。旧セーブは
// 全員「おまかせ」で補う（hydrateTrainingPolicy）。
import type { State, Player, Stat, Position } from './game.ts';
import { clamp } from './game.ts';
import { growthFactor } from './development.ts';
import { applyStatGrowth } from './growth.ts';
import {
  PLAY_STYLES,
  gainProficiency,
  basePos,
  DETAIL_POS,
  type DetailPos,
  type ExtraStat,
  type PlayerSquad,
} from './squad.ts';

// ---------------------------------------------------------------------------
// 個人方針の種類
// ---------------------------------------------------------------------------
export type PolicyKey =
  | 'auto'
  | 'shoot'
  | 'pass'
  | 'defend'
  | 'speed'
  | 'mental'
  | 'dribble'
  | 'physical'
  | 'keep'
  | 'position';
export const POLICY_KEYS: PolicyKey[] = [
  'auto',
  'shoot',
  'pass',
  'defend',
  'speed',
  'mental',
  'dribble',
  'physical',
  'keep',
  'position',
];
// 個人方針が直接対応する core Stat（'auto'/'dribble'/'physical'/'position' を除く）。
const STAT_POLICY_KEYS: PolicyKey[] = ['shoot', 'pass', 'defend', 'speed', 'mental', 'keep'];
export const policyInfo: Record<PolicyKey, { name: string; desc: string }> = {
  auto: { name: 'おまかせ', desc: 'アーキタイプ・プレースタイルに合う能力を伸ばします。' },
  shoot: { name: '決定力', desc: '決定力を重点的に伸ばします。' },
  pass: { name: 'パス', desc: 'パスを重点的に伸ばします。' },
  defend: { name: '守備', desc: '守備を重点的に伸ばします。' },
  // V4-2 (DESIGN_V4 6.2): 方針名は選手画面の能力名にそろえる（旧名: スピード/ドリブル/フィジカル）。
  speed: { name: '走力', desc: '走力を重点的に伸ばします。' },
  mental: { name: '精神力', desc: '精神力を重点的に伸ばします。' },
  dribble: { name: '突破', desc: '突破を重点的に伸ばします。' },
  physical: { name: '持久・パワー', desc: '持久・パワーを重点的に伸ばします。' },
  keep: { name: 'GK技術', desc: 'GK技術を重点的に伸ばします（GK専用）。' },
  position: { name: 'ポジション習得', desc: '指定したポジションの習熟度を毎日少し高めます。' },
};

// ---------------------------------------------------------------------------
// 月（4週ごと）の判定
// ---------------------------------------------------------------------------
export function monthBlock(week: number): number {
  return Math.floor(week / 4);
}

// ---------------------------------------------------------------------------
// V4-2 (DESIGN_V4 6.1): ポジション×学年の一括設定。
// ---------------------------------------------------------------------------
export const POSITION_GROUPS: Position[] = ['GK', 'DF', 'MF', 'FW'];
export const GRADE_YEARS: number[] = [1, 2, 3];
export function groupKey(pos: Position, year: number): string {
  return `${pos}-${year}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export type PlayerPolicy = {
  key: PolicyKey;
  // 'position' のときだけ使う、鍛えるポジション。
  target: DetailPos | null;
  // V4-2 (6.1): trueなら「個別」に変更済みの選手（一括設定を上書きしても変わらない）。
  // falseなら一括設定（TrainingPolicyState.groups）に従う。
  individual: boolean;
  // 「今月の伸び」表示用。個人方針で実際に伸ばした量を能力/拡張能力/ポジション名で
  // 累積する（キーは Stat・ExtraStat・DetailPos のいずれか）。月が変わると0にリセットする。
  monthlyGrowth: Record<string, number>;
  // V4-2 (6.2): 直前の月の monthlyGrowth のスナップショット（「先月伸びた能力」表示用）。
  // 月が変わるタイミング（hydrateTrainingPolicy）でその時点の monthlyGrowth をここへ写し、
  // 育成の見通し(ETA)は出さない前提で「先月」だけを見せる。
  previousMonthGrowth: Record<string, number>;
  monthlyBlock: number;
};
export type TrainingPolicyState = {
  schema: 1;
  players: Record<number, PlayerPolicy>;
  // V4-2 (6.1): ポジション×学年ごとの一括設定。キーは groupKey(pos, year)。
  // 個別未設定の選手（individual===false）はここを既定値として従う。
  groups: Record<string, PolicyKey>;
  // 直近で「今月の個人方針」画面を確認したブロック（monthBlock）。-1は未確認。
  reviewedBlock: number;
};

function freshPolicy(block: number): PlayerPolicy {
  return {
    key: 'auto',
    target: null,
    individual: false,
    monthlyGrowth: {},
    previousMonthGrowth: {},
    monthlyBlock: block,
  };
}

function freshGroups(): Record<string, PolicyKey> {
  const groups: Record<string, PolicyKey> = {};
  for (const pos of POSITION_GROUPS) for (const year of GRADE_YEARS) groups[groupKey(pos, year)] = 'auto';
  return groups;
}

export function hydrateTrainingPolicy(s: State): void {
  const v3 = s.v3 as unknown as { trainingPolicy?: TrainingPolicyState };
  if (!v3.trainingPolicy || v3.trainingPolicy.schema !== 1) {
    v3.trainingPolicy = { schema: 1, players: {}, groups: freshGroups(), reviewedBlock: -1 };
  }
  const tp = v3.trainingPolicy;
  if (!tp.groups) tp.groups = freshGroups();
  for (const pos of POSITION_GROUPS) {
    for (const year of GRADE_YEARS) {
      const k = groupKey(pos, year);
      const v = tp.groups[k];
      // 旧セーブ・不正値は決定的に「おまかせ」で補う。GK技術はGKグループ以外には使えない。
      if (!v || !POLICY_KEYS.includes(v) || (v === 'keep' && pos !== 'GK')) tp.groups[k] = 'auto';
    }
  }
  const block = monthBlock(s.week);
  for (const p of s.players) {
    if (!tp.players[p.id]) tp.players[p.id] = freshPolicy(block);
    const pol = tp.players[p.id];
    if (typeof pol.individual !== 'boolean') pol.individual = false;
    if (!pol.previousMonthGrowth) pol.previousMonthGrowth = {};
    if (pol.monthlyBlock !== block) {
      // 月が変わる瞬間: リセットする前の今月分を「先月の伸び」として保存する。
      pol.previousMonthGrowth = pol.monthlyGrowth ?? {};
      pol.monthlyBlock = block;
      pol.monthlyGrowth = {};
    }
    if (!pol.monthlyGrowth) pol.monthlyGrowth = {};
  }
  for (const key of Object.keys(tp.players)) {
    const id = +key;
    if (!s.players.some((p) => p.id === id)) delete tp.players[id];
  }
  (s.v3 as unknown as { trainingPolicy: TrainingPolicyState }).trainingPolicy = tp;
}

export function validateTrainingPolicy(s: State): void {
  const tp = (s.v3 as unknown as { trainingPolicy?: TrainingPolicyState }).trainingPolicy;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!tp || tp.schema !== 1) throw Error('個人方針データが不正です。');
  if (!Number.isInteger(tp.reviewedBlock) || tp.reviewedBlock < -1 || tp.reviewedBlock > 100000)
    throw Error('個人方針の確認データが不正です。');
  if (Object.keys(tp.players).length !== s.players.length)
    throw Error('個人方針データの人数が不正です。');
  if (!tp.groups || typeof tp.groups !== 'object' || Object.keys(tp.groups).length !== POSITION_GROUPS.length * GRADE_YEARS.length)
    throw Error('育成方針の一括設定データが不正です。');
  for (const pos of POSITION_GROUPS) {
    for (const year of GRADE_YEARS) {
      const v = tp.groups[groupKey(pos, year)];
      if (!v || !POLICY_KEYS.includes(v)) throw Error('育成方針の一括設定データが不正です。');
      if (v === 'keep' && pos !== 'GK') throw Error('育成方針の一括設定データが不正です。');
    }
  }
  const sq = s.v3.squad;
  for (const p of s.players) {
    const pol = tp.players[p.id];
    if (!pol || !POLICY_KEYS.includes(pol.key)) throw Error('個人方針が不正です。');
    if (pol.key === 'position') {
      if (!pol.target || !(DETAIL_POS as readonly string[]).includes(pol.target))
        throw Error('個人方針のポジション指定が不正です。');
    } else if (pol.target !== null) {
      throw Error('個人方針のポジション指定が不正です。');
    }
    if (pol.key === 'keep') {
      const ps = sq?.players[p.id];
      if (ps && basePos(ps.detail) !== 'GK')
        throw Error('GK技術の個人方針はGK以外の選手には設定できません。');
    }
    if (typeof pol.individual !== 'boolean') throw Error('個人方針の個別設定フラグが不正です。');
    if (!num(pol.monthlyBlock, -1, 200000)) throw Error('個人方針の月次データが不正です。');
    if (
      !pol.monthlyGrowth ||
      typeof pol.monthlyGrowth !== 'object' ||
      Object.values(pol.monthlyGrowth).some((v) => !num(v, -1000, 1000))
    )
      throw Error('個人方針の今月の伸びデータが不正です。');
    if (
      !pol.previousMonthGrowth ||
      typeof pol.previousMonthGrowth !== 'object' ||
      Object.values(pol.previousMonthGrowth).some((v) => !num(v, -1000, 1000))
    )
      throw Error('個人方針の先月の伸びデータが不正です。');
  }
}

// ---------------------------------------------------------------------------
// V4-2: 有効な個人方針の解決（個別設定 ?? 一括設定 ?? おまかせ）。
// applyIndividualGrowth（成長の適用）と表示側（UI）が必ずこの1関数を通して同じ
// 値を読むことで、決定性と表示の一致を保証する。
// ---------------------------------------------------------------------------
export function resolveEffectivePolicy(s: State, p: Player): { key: PolicyKey; target: DetailPos | null } {
  const tp = s.v3?.trainingPolicy;
  const pol = tp?.players[p.id];
  if (pol?.individual) return { key: pol.key, target: pol.target };
  const groupPolicy = tp?.groups[groupKey(p.pos, p.year)] ?? 'auto';
  if (groupPolicy === 'position') {
    const sq = s.v3?.squad?.players[p.id];
    const posOptions = DETAIL_POS.filter((d) => basePos(d) === p.pos);
    const target = posOptions.find((d) => d !== sq?.detail) ?? posOptions[0] ?? null;
    return { key: 'position', target };
  }
  return { key: groupPolicy, target: null };
}

/** UI表示用: pol（今月の伸び等）はそのままに、key/targetだけを有効な値へ差し替えたビュー。 */
export function resolvePolicyView(s: State, p: Player): PlayerPolicy {
  const tp = s.v3.trainingPolicy;
  const pol = tp.players[p.id];
  const eff = resolveEffectivePolicy(s, p);
  return { ...pol, key: eff.key, target: eff.target };
}

// ---------------------------------------------------------------------------
// 月初の見直しフラグ
// ---------------------------------------------------------------------------
export function needsMonthlyReview(s: State): boolean {
  const tp = s.v3?.trainingPolicy;
  if (!tp) return false;
  return tp.reviewedBlock !== monthBlock(s.week);
}

// ---------------------------------------------------------------------------
// アクション
// ---------------------------------------------------------------------------
export type TrainingPolicyAction =
  | { type: 'trainingPolicySet'; id: number; policy: PolicyKey; target?: DetailPos | null }
  | { type: 'trainingPolicyBulkAuto' }
  | { type: 'trainingPolicyGroupSet'; pos: Position; year: number; policy: PolicyKey }
  | { type: 'trainingPolicyClearIndividual'; id: number }
  | { type: 'trainingPolicyReviewed' };

export function handleTrainingPolicy(s: State, a: TrainingPolicyAction): boolean {
  if (
    a.type !== 'trainingPolicySet' &&
    a.type !== 'trainingPolicyBulkAuto' &&
    a.type !== 'trainingPolicyGroupSet' &&
    a.type !== 'trainingPolicyClearIndividual' &&
    a.type !== 'trainingPolicyReviewed'
  )
    return false;
  const tp = s.v3.trainingPolicy;
  if (a.type === 'trainingPolicyReviewed') {
    tp.reviewedBlock = monthBlock(s.week);
    return true;
  }
  if (a.type === 'trainingPolicyBulkAuto') {
    for (const key of Object.keys(tp.players)) {
      const pol = tp.players[+key];
      pol.key = 'auto';
      pol.target = null;
      pol.individual = false;
    }
    return true;
  }
  if (a.type === 'trainingPolicyGroupSet') {
    if (!POSITION_GROUPS.includes(a.pos) || !GRADE_YEARS.includes(a.year))
      throw Error('育成方針の一括設定が不正です。');
    if (!POLICY_KEYS.includes(a.policy)) throw Error('個人方針が不正です。');
    if (a.policy === 'keep' && a.pos !== 'GK')
      throw Error('GK技術の一括設定はGKグループのみ選べます。');
    tp.groups[groupKey(a.pos, a.year)] = a.policy;
    return true;
  }
  if (a.type === 'trainingPolicyClearIndividual') {
    const pol = tp.players[a.id];
    if (!pol) throw Error('選手が見つかりません。');
    pol.individual = false;
    return true;
  }
  // trainingPolicySet: 選手個別の明示的な変更。以後この選手は一括設定を上書きしても変わらない。
  const p = s.players.find((x) => x.id === a.id);
  const pol = tp.players[a.id];
  if (!p || !pol) throw Error('選手が見つかりません。');
  if (!POLICY_KEYS.includes(a.policy)) throw Error('個人方針が不正です。');
  const ps = s.v3.squad.players[a.id];
  if (a.policy === 'keep' && (!ps || basePos(ps.detail) !== 'GK'))
    throw Error('GK技術の個人方針はGKのみ選べます。');
  if (a.policy === 'position') {
    const target = a.target ?? null;
    if (!target || !(DETAIL_POS as readonly string[]).includes(target))
      throw Error('鍛えるポジションを選んでください。');
    pol.key = 'position';
    pol.target = target;
  } else {
    pol.key = a.policy;
    pol.target = null;
  }
  pol.individual = true;
  return true;
}

// ---------------------------------------------------------------------------
// 成長配分（40%ぶん）
// ---------------------------------------------------------------------------
// 個人方針の成長ペース。チームメニューの「2種類の能力を伸ばすメニュー」相当の
// ペース（lib/game.ts の advanceTrainingDay と同じ 1.05）を、メニュー種別に
// 関わらず一定で使う（個人方針の伸び方が日によって不自然に上下しないようにする）。
const INDIV_LEAD = 1.05;
const INDIV_WEIGHT = 0.4;
// ポジション習熟度・拡張能力（突破/持久/パワー）は、既存の「ポジション練習」
// メニュー（lib/game.ts: gainProficiency(..., 4 * talent)）と同じペースを40%の
// 重みで使う（/6の週換算は core Stat 用の式だけのものなので、ここでは使わない）。
const FLAT_DAILY = 4;

function favoredStatsFor(s: State, p: Player): Stat[] {
  const ps = s.v3?.squad?.players[p.id];
  if (!ps) return [];
  const growth = PLAY_STYLES[ps.style]?.growth ?? {};
  return (Object.keys(growth) as Stat[]).filter((k) => (growth[k] ?? 1) > 1);
}

function addMonthly(pol: PlayerPolicy, key: string, amount: number) {
  pol.monthlyGrowth[key] = (pol.monthlyGrowth[key] ?? 0) + amount;
}

function gainExtra(ps: PlayerSquad, key: ExtraStat, amount: number): number {
  const before = ps[key];
  ps[key] = clamp(before + amount, 20, 99);
  return ps[key] - before;
}

/** その日ぶんの個人方針による成長（チームメニューの40%相当の予算）を適用し、
 *  適用した成長量の合計（部活ノートの集計表示にのみ使う）を返す。
 *  base は lib/game.ts の advanceTrainingDay が計算する talent/facilities/fatigue/
 *  重点育成の共通係数で、チームメニュー分と同じものを渡す（重点育成1.5倍が両方に効く）。 */
export function applyIndividualGrowth(s: State, p: Player, base: number): number {
  const tp = s.v3?.trainingPolicy;
  const ps = s.v3?.squad?.players[p.id];
  if (!tp || !ps) return 0;
  const pol = tp.players[p.id];
  if (!pol) return 0;
  // V4-2 (6.1): 成長へ反映する方針は「個別設定 ?? 一括設定 ?? おまかせ」で解決した有効な
  // 値であり、pol.key/pol.target（個別未設定なら意味を持たない生の保存値）ではない。
  // monthlyGrowthの累積先は選手ごとのpolのまま（表示用に個々の選手に紐づける）。
  const eff = resolveEffectivePolicy(s, p);
  const statGain = (k: Stat) =>
    (INDIV_LEAD * INDIV_WEIGHT * base * (p.stats[k] > 85 ? 0.35 : 1) * growthFactor(s, p, k)) / 6;
  // ポジション習熟度・拡張能力ぶんは、既存の「ポジション練習」(4*talent/日)と同じ
  // ペースの40%（facilities/fatigue/重点育成の補正は既存メニューと同様に掛けない）。
  const flatGain = () => FLAT_DAILY * p.talent * INDIV_WEIGHT;
  let total = 0;
  if (eff.key === 'position') {
    if (!eff.target) return 0;
    const amount = flatGain();
    gainProficiency(s, p.id, eff.target, amount);
    addMonthly(pol, eff.target, amount);
    return amount;
  }
  if (eff.key === 'auto') {
    for (const k of favoredStatsFor(s, p)) {
      const gain = statGain(k);
      const applied = applyStatGrowth(s, p, k, gain);
      addMonthly(pol, k, applied);
      total += applied;
    }
    return total;
  }
  if (eff.key === 'dribble') {
    const amount = flatGain();
    const applied = gainExtra(ps, 'dribble', amount);
    addMonthly(pol, 'dribble', applied);
    return applied;
  }
  if (eff.key === 'physical') {
    const amount = flatGain() / 2;
    const stamina = gainExtra(ps, 'stamina', amount);
    const power = gainExtra(ps, 'power', amount);
    addMonthly(pol, 'stamina', stamina);
    addMonthly(pol, 'power', power);
    return stamina + power;
  }
  if (eff.key === 'keep' && basePos(ps.detail) !== 'GK') return 0;
  if (STAT_POLICY_KEYS.includes(eff.key)) {
    const k = eff.key as Stat;
    const gain = statGain(k);
    const applied = applyStatGrowth(s, p, k, gain);
    addMonthly(pol, k, applied);
    return applied;
  }
  return 0;
}
