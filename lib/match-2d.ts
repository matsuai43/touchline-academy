// W8: Football Manager 風の「点で動く」2D試合図。
// この関数群は純粋（DOM非依存・Math.random/Date.now不使用）で、Highlight と
// State（s.formation / s.lineup）だけから、同じ入力なら必ず同じ軌跡を返す。
import type { State, Formation } from './game.ts';
import type { Highlight } from './development.ts';

// ---------------------------------------------------------------------------
// ピッチ座標系（メートル相当、0..PITCH_W x 0..PITCH_H）。自チームは常に x=0 側の
// ゴールを守り x=PITCH_W 側を攻める向きで描画する（カメラは常に固定）。
// ---------------------------------------------------------------------------
export const PITCH_W = 105;
export const PITCH_H = 68;
export const GOAL_Y = PITCH_H / 2;
export const GOAL_HALF = 3.66; // 7.32m ゴール幅の半分
const MARGIN = 2.2; // 選手の点がピッチ端に張り付かないための余白

export type Team = 'self' | 'oppo';
export type Outcome = 'goal' | 'save' | 'miss';
export type Vec = { x: number; y: number };

export type PlayerDot = {
  id: string; // "self-3" / "oppo-9"
  team: Team;
  idx: number; // 0 = GK, 1.. = フィールドプレイヤー（formationSlots()の並び順）
  x: number;
  y: number;
  number: number;
  isGK: boolean;
  hasBall: boolean;
};

export type Frame = {
  t: number;
  players: PlayerDot[]; // 常に22（自11＋相手11）
  ball: Vec;
};

export type MatchSequence = {
  highlightId: string;
  commentary: string;
  ariaLabel: string;
  outcome: Outcome;
  attackingTeam: Team;
  passCount: number;
  shotFrom: Vec;
  shotTo: Vec;
  selfBase: Vec[];
  oppoBase: Vec[];
  selfNumbers: number[];
  oppoNumbers: number[];
  chain: number[]; // 攻撃側チーム内でのパス経路（長さ = passCount + 1）
  forwardDir: 1 | -1;
  seed: number;
};

// ---------------------------------------------------------------------------
// 決定的な擬似乱数（lib/squad.ts の h32/hf と同じ手法。s.seed は使わない＝
// これは演出専用の見た目の揺らぎで、試合結果そのものには一切影響しない）
// ---------------------------------------------------------------------------
function h32(...ns: number[]): number {
  let x = 2166136261 >>> 0;
  for (const n of ns) x = Math.imul(x ^ (n >>> 0), 16777619) >>> 0;
  return x >>> 0;
}
function hf(seed: number, ...salt: number[]): number {
  return h32(seed, ...salt) / 4294967296;
}
function seedFor(h: Highlight): number {
  let x = 2166136261 >>> 0;
  for (let i = 0; i < h.id.length; i++)
    x = Math.imul(x ^ h.id.charCodeAt(i), 16777619) >>> 0;
  x = Math.imul(x ^ ((h.minute >>> 0) + 1), 16777619) >>> 0;
  x = Math.imul(x ^ ((h.playerId >>> 0) + 1), 16777619) >>> 0;
  x = Math.imul(x ^ (h.side + 1), 16777619) >>> 0;
  return x >>> 0;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clampRange(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function easeInOut(t: number) {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}
function easeOut(t: number) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

// ---------------------------------------------------------------------------
// フォーメーションの基本配置（0..1 の割合。x=0 が自陣ゴール、x=1 が敵陣ゴール）。
// 並び順は lib/squad.ts の FORMATION_SLOTS（= s.lineup の並び）と完全に一致させる:
// GK → DF → MF → FW。
// ---------------------------------------------------------------------------
// S4: 各フォーメーションの並び順は lib/squad.ts の FORMATION_SLOTS と完全に一致させる。
const LAYOUT_FRACTIONS: Record<Formation, Vec[]> = {
  '4-3-3': [
    { x: 0.07, y: 0.5 }, // GK
    { x: 0.24, y: 0.16 }, // LSB
    { x: 0.19, y: 0.38 }, // CB
    { x: 0.19, y: 0.62 }, // CB
    { x: 0.24, y: 0.84 }, // RSB
    { x: 0.4, y: 0.5 }, // DM
    { x: 0.55, y: 0.3 }, // CM
    { x: 0.62, y: 0.68 }, // AM
    { x: 0.78, y: 0.14 }, // LWG
    { x: 0.86, y: 0.5 }, // CF
    { x: 0.78, y: 0.86 }, // RWG
  ],
  // GK / LSB CB CB RSB / LSH DM CM RSH / SS CF
  '4-4-2': [
    { x: 0.07, y: 0.5 }, // GK
    { x: 0.24, y: 0.16 }, // LSB
    { x: 0.19, y: 0.38 }, // CB
    { x: 0.19, y: 0.62 }, // CB
    { x: 0.24, y: 0.84 }, // RSB
    { x: 0.55, y: 0.18 }, // LSH
    { x: 0.42, y: 0.5 }, // DM
    { x: 0.55, y: 0.5 }, // CM
    { x: 0.55, y: 0.82 }, // RSH
    { x: 0.78, y: 0.4 }, // SS
    { x: 0.88, y: 0.6 }, // CF
  ],
  // GK / CB CB CB / LWB DM CM RWB / LWG CF RWG
  '3-4-3': [
    { x: 0.07, y: 0.5 }, // GK
    { x: 0.18, y: 0.3 }, // CB
    { x: 0.16, y: 0.5 }, // CB
    { x: 0.18, y: 0.7 }, // CB
    { x: 0.4, y: 0.12 }, // LWB
    { x: 0.42, y: 0.42 }, // DM
    { x: 0.5, y: 0.58 }, // CM
    { x: 0.4, y: 0.88 }, // RWB
    { x: 0.8, y: 0.16 }, // LWG
    { x: 0.88, y: 0.5 }, // CF
    { x: 0.8, y: 0.84 }, // RWG
  ],
  // GK / LSB CB CB RSB / DM DM / LSH AM RSH / CF
  '4-2-3-1': [
    { x: 0.07, y: 0.5 }, // GK
    { x: 0.24, y: 0.16 }, // LSB
    { x: 0.19, y: 0.38 }, // CB
    { x: 0.19, y: 0.62 }, // CB
    { x: 0.24, y: 0.84 }, // RSB
    { x: 0.4, y: 0.38 }, // DM
    { x: 0.4, y: 0.62 }, // DM
    { x: 0.62, y: 0.16 }, // LSH
    { x: 0.68, y: 0.5 }, // AM
    { x: 0.62, y: 0.84 }, // RSH
    { x: 0.88, y: 0.5 }, // CF
  ],
};

function toPitch(v: Vec, mirror: boolean): Vec {
  return {
    x: (mirror ? 1 - v.x : v.x) * PITCH_W,
    y: v.y * PITCH_H,
  };
}
function selfLayout(formation: Formation): Vec[] {
  return LAYOUT_FRACTIONS[formation].map((v) => toPitch(v, false));
}
// 相手は常に標準的な4-4-2の配置を左右反転させて使う（実データを持たないため）。
function oppoLayout(): Vec[] {
  return LAYOUT_FRACTIONS['4-4-2'].map((v) => toPitch(v, true));
}
function selfNumberFor(id: number): number {
  return ((id * 17) % 33) + 1;
}
function oppoNumberList(): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
}

// ---------------------------------------------------------------------------
// タイムライン: 0..BUILDUP_END = パス回し／BUILDUP_END..SHOT_END = シュート
// ／SHOT_END..1 = 結果の余韻。
// ---------------------------------------------------------------------------
const BUILDUP_END = 0.6;
const SHOT_END = 0.85;
const PUSH_ATTACK = 12;
const PUSH_DEFEND = 5;

function mobility(idx: number): number {
  return idx === 0 ? 0.12 : idx <= 4 ? 0.55 : idx <= 7 ? 0.85 : 1.05;
}
function pushProgress(t: number): number {
  return easeInOut(clamp01(Math.min(t, BUILDUP_END) / BUILDUP_END));
}
// 攻撃側チームはボール方向へ押し上げ、守備側チームはわずかに押し下げられる。
// どちらも同じ forwardDir（この場面の攻撃方向）に押されるのがポイント:
// 守備側は「自陣ゴールに向けて後退する」ことになる。
function pushedPos(
  base: Vec,
  idx: number,
  dotTeam: Team,
  attackingTeam: Team,
  forwardDir: 1 | -1,
  t: number,
): Vec {
  const p = pushProgress(t);
  const magnitude =
    (dotTeam === attackingTeam ? PUSH_ATTACK : PUSH_DEFEND) *
    mobility(idx) *
    p *
    forwardDir;
  return {
    x: clampRange(base.x + magnitude, MARGIN, PITCH_W - MARGIN),
    y: clampRange(base.y, MARGIN, PITCH_H - MARGIN),
  };
}

function buildChain(seed: number, passCount: number): number[] {
  const chain: number[] = [];
  let cur = 3 + Math.floor(hf(seed, 1) * 3); // 3..5（自陣寄りの選手から始まる）
  chain.push(cur);
  for (let i = 0; i < passCount; i++) {
    const step = 1 + Math.floor(hf(seed, 10 + i) * 2); // 1..2ずつ前進
    cur = Math.min(10, cur + step);
    chain.push(cur);
  }
  return chain;
}

function laneText(lane: Highlight['lane']): string {
  return lane === 'wide'
    ? 'サイドを崩して'
    : lane === 'middle'
      ? '中央を割って'
      : 'パスをつないで';
}
function shotWord(lane: Highlight['lane']): string {
  return lane === 'wide' ? 'クロスからのシュート' : lane === 'middle' ? 'ミドルシュート' : 'シュート';
}
function outcomeText(h: Highlight): string {
  if (h.kind === 'goal')
    return h.side === 0 ? `${h.name}、ゴール！` : `${h.name}に得点を許す…`;
  if (h.kind === 'save') return `${h.name}、シュートを止めた！`;
  return '惜しくもゴールを外れる';
}
export function commentaryFor(h: Highlight): string {
  return `${h.minute}′ ${laneText(h.lane)}${shotWord(h.lane)}！ ${outcomeText(h)}`;
}
export function sceneAriaLabel(h: Highlight): string {
  const half = h.minute <= 45 ? '前半' : '後半';
  const desc =
    h.kind === 'goal'
      ? h.side === 0
        ? '自チームのゴール場面'
        : '相手のゴール場面'
      : h.kind === 'save'
        ? h.side === 0
          ? '相手GKのセーブ場面'
          : '自チームGKのセーブ場面'
        : '枠を外れたシュート場面';
  return `${half}${h.minute}分、${desc}`;
}

// ---------------------------------------------------------------------------
// ハイライト1件分のシーケンスを構築する（決定的）。
// ---------------------------------------------------------------------------
export function buildSequence(h: Highlight, s: State): MatchSequence {
  const seed = seedFor(h);
  const attackingTeam: Team = h.side === 0 ? 'self' : 'oppo';
  const forwardDir: 1 | -1 = h.side === 0 ? 1 : -1;
  const selfBase = selfLayout(s.formation);
  const oppoBase = oppoLayout();
  const selfNumbers = s.lineup.map((id) => selfNumberFor(id));
  const oppoNumbers = oppoNumberList();

  const passCount = 3 + Math.floor(hf(seed, 0) * 4); // 3..6本
  const chain = buildChain(seed, passCount);

  const laneSign =
    h.lane === 'wide' ? 1 : h.lane === 'middle' ? -1 : hf(seed, 99) < 0.5 ? 1 : -1;
  const outcome: Outcome =
    h.kind === 'goal' ? 'goal' : h.kind === 'save' ? 'save' : 'miss';

  let shotTo: Vec;
  if (outcome === 'goal') {
    const offset = laneSign * (0.6 + hf(seed, 3) * (GOAL_HALF - 1.1));
    shotTo = { x: forwardDir === 1 ? PITCH_W : 0, y: GOAL_Y + offset };
  } else if (outcome === 'save') {
    const offset = laneSign * (0.4 + hf(seed, 3) * (GOAL_HALF - 0.9));
    shotTo = {
      x: forwardDir === 1 ? PITCH_W - 3.2 : 3.2,
      y: GOAL_Y + offset,
    };
  } else {
    const offset = laneSign * (GOAL_HALF + 1.3 + hf(seed, 5) * 2.6);
    shotTo = {
      x: forwardDir === 1 ? PITCH_W + 0.8 : -0.8,
      y: clampRange(GOAL_Y + offset, 1, PITCH_H - 1),
    };
  }

  const attackBase = attackingTeam === 'self' ? selfBase : oppoBase;
  const shooterIdx = chain[chain.length - 1];
  const shotFrom = pushedPos(
    attackBase[shooterIdx],
    shooterIdx,
    attackingTeam,
    attackingTeam,
    forwardDir,
    BUILDUP_END,
  );

  return {
    highlightId: h.id,
    commentary: commentaryFor(h),
    ariaLabel: sceneAriaLabel(h),
    outcome,
    attackingTeam,
    passCount,
    shotFrom,
    shotTo,
    selfBase,
    oppoBase,
    selfNumbers,
    oppoNumbers,
    chain,
    forwardDir,
    seed,
  };
}

// ---------------------------------------------------------------------------
// 任意の進行度 t（0..1）における22人+ボールの位置を返す純粋関数。
// ---------------------------------------------------------------------------
export function frameAt(seq: MatchSequence, t: number): Frame {
  const tt = clamp01(t);
  const segCount = Math.max(1, seq.chain.length - 1);
  const segLen = BUILDUP_END / segCount;

  const holderTeam: Team = seq.attackingTeam;
  let holderIdx: number;
  if (tt < BUILDUP_END) {
    const segIdx = Math.min(segCount - 1, Math.floor(tt / segLen));
    const localP = clamp01((tt - segIdx * segLen) / segLen);
    holderIdx = localP < 0.5 ? seq.chain[segIdx] : seq.chain[segIdx + 1];
  } else {
    holderIdx = seq.chain[seq.chain.length - 1];
  }

  const players: PlayerDot[] = [];
  for (let i = 0; i < 11; i++) {
    const pos = pushedPos(seq.selfBase[i], i, 'self', seq.attackingTeam, seq.forwardDir, tt);
    players.push({
      id: `self-${i}`,
      team: 'self',
      idx: i,
      x: pos.x,
      y: pos.y,
      number: seq.selfNumbers[i],
      isGK: i === 0,
      hasBall: holderTeam === 'self' && holderIdx === i,
    });
  }
  for (let i = 0; i < 11; i++) {
    const pos = pushedPos(seq.oppoBase[i], i, 'oppo', seq.attackingTeam, seq.forwardDir, tt);
    players.push({
      id: `oppo-${i}`,
      team: 'oppo',
      idx: i,
      x: pos.x,
      y: pos.y,
      number: seq.oppoNumbers[i],
      isGK: i === 0,
      hasBall: holderTeam === 'oppo' && holderIdx === i,
    });
  }

  // 守備側GKはシュート局面で反応する。セーブなら最終的にボールとぴったり同じ位置へ。
  const defendingTeam: Team = seq.attackingTeam === 'self' ? 'oppo' : 'self';
  if (tt >= BUILDUP_END) {
    const p = easeOut(clamp01((tt - BUILDUP_END) / (SHOT_END - BUILDUP_END)));
    const reachFactor = seq.outcome === 'save' ? 1 : seq.outcome === 'goal' ? 0.5 : 0.18;
    const gk = players.find((d) => d.team === defendingTeam && d.idx === 0)!;
    const restBase = defendingTeam === 'self' ? seq.selfBase[0] : seq.oppoBase[0];
    const restPos = pushedPos(restBase, 0, defendingTeam, seq.attackingTeam, seq.forwardDir, BUILDUP_END);
    gk.x = lerp(restPos.x, seq.shotTo.x, p * reachFactor);
    gk.y = lerp(restPos.y, seq.shotTo.y, p * reachFactor);
  }

  // ゴール後、得点者がわずかに前へ抜ける（お祝いの余韻。結果には影響しない）。
  if (seq.outcome === 'goal' && tt > SHOT_END) {
    const p = easeOut(clamp01((tt - SHOT_END) / (1 - SHOT_END)));
    const scorer = players.find(
      (d) => d.team === seq.attackingTeam && d.idx === seq.chain[seq.chain.length - 1],
    );
    if (scorer) scorer.x = clampRange(scorer.x + seq.forwardDir * p * 2.4, MARGIN, PITCH_W - MARGIN);
  }

  // ボール位置
  let ball: Vec;
  if (tt < BUILDUP_END) {
    const segIdx = Math.min(segCount - 1, Math.floor(tt / segLen));
    const localP = easeInOut(clamp01((tt - segIdx * segLen) / segLen));
    const fromIdx = seq.chain[segIdx],
      toIdx = seq.chain[segIdx + 1];
    const fromBase = seq.attackingTeam === 'self' ? seq.selfBase[fromIdx] : seq.oppoBase[fromIdx];
    const toBase = seq.attackingTeam === 'self' ? seq.selfBase[toIdx] : seq.oppoBase[toIdx];
    const fromPos = pushedPos(fromBase, fromIdx, seq.attackingTeam, seq.attackingTeam, seq.forwardDir, tt);
    const toPos = pushedPos(toBase, toIdx, seq.attackingTeam, seq.attackingTeam, seq.forwardDir, tt);
    ball = { x: lerp(fromPos.x, toPos.x, localP), y: lerp(fromPos.y, toPos.y, localP) };
  } else if (tt < SHOT_END) {
    const p = easeOut(clamp01((tt - BUILDUP_END) / (SHOT_END - BUILDUP_END)));
    const curve = (hf(seq.seed, 6) - 0.5) * 6;
    const midX = lerp(seq.shotFrom.x, seq.shotTo.x, 0.5);
    const midY = lerp(seq.shotFrom.y, seq.shotTo.y, 0.5) + curve;
    const omp = 1 - p;
    ball = {
      x: omp * omp * seq.shotFrom.x + 2 * omp * p * midX + p * p * seq.shotTo.x,
      y: omp * omp * seq.shotFrom.y + 2 * omp * p * midY + p * p * seq.shotTo.y,
    };
  } else {
    ball = { x: seq.shotTo.x, y: seq.shotTo.y };
  }

  return { t: tt, players, ball };
}

// キックオフ／ハイライトが無い場面用の静止フォーメーション。
export function kickoffFrame(s: State): Frame {
  const selfBase = selfLayout(s.formation);
  const oppoBase = oppoLayout();
  const selfNumbers = s.lineup.map((id) => selfNumberFor(id));
  const oppoNumbers = oppoNumberList();
  const players: PlayerDot[] = [];
  for (let i = 0; i < 11; i++)
    players.push({
      id: `self-${i}`,
      team: 'self',
      idx: i,
      x: selfBase[i].x,
      y: selfBase[i].y,
      number: selfNumbers[i],
      isGK: i === 0,
      hasBall: false,
    });
  for (let i = 0; i < 11; i++)
    players.push({
      id: `oppo-${i}`,
      team: 'oppo',
      idx: i,
      x: oppoBase[i].x,
      y: oppoBase[i].y,
      number: oppoNumbers[i],
      isGK: i === 0,
      hasBall: false,
    });
  return { t: 0, players, ball: { x: PITCH_W / 2, y: PITCH_H / 2 } };
}

export function durationFor(h: Highlight): number {
  return h.kind === 'goal' ? 5200 : h.kind === 'save' ? 4400 : 3800;
}
