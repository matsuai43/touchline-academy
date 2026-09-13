// TOUCHLINE ACADEMY v3 — W7: BGM と効果音
//
// 方針（DESIGN_V3.md 0.5 / W7 節）:
// - 音源ファイルは一切持たない。Web Audio API でその場で音を合成する（権利問題が原理的に発生しない）。
// - 初期状態は消音。ユーザーの操作（設定パネルの ON 切り替えなど）を起点にのみ音を鳴らす。
// - AudioContext は1つだけ生成し、画面遷移で多重生成しない。タブ非表示で停止する。
// - AudioContext が存在しない環境（Node のテスト・SSR・古いブラウザ）では、例外を投げず
//   すべての公開関数が安全に無効化される（no-op）こと。これが最重要条件。
//
// ゲーム本体（app/game-ui.tsx 等）からはこのモジュールの公開 API のみを呼び出す想定。
// State や lib/game.ts には一切依存しない（決定性・セーブ互換性に影響しない完全に独立した演出レイヤー）。

export type BgmScene = 'clubhouse' | 'prematch' | 'match' | 'victory' | 'defeat';
export type SfxName = 'click' | 'whistle' | 'kick' | 'goal' | 'cheer';

export type AudioSettings = {
  bgmOn: boolean;
  seOn: boolean;
  bgmVolume: number; // 0..1
  seVolume: number; // 0..1
};

export const BGM_SCENES: { id: BgmScene; label: string; desc: string }[] = [
  { id: 'clubhouse', label: 'クラブハウス', desc: '穏やかな日常' },
  { id: 'prematch', label: '試合前', desc: '高揚するキックオフ前' },
  { id: 'match', label: '試合中', desc: '緊張感のある攻防' },
  { id: 'victory', label: '勝利', desc: '晴れやかな勝利の余韻' },
  { id: 'defeat', label: '敗戦', desc: '静かに受け止める敗戦' },
];

export const SFX_LIST: { id: SfxName; label: string }[] = [
  { id: 'click', label: 'ボタン' },
  { id: 'whistle', label: 'ホイッスル' },
  { id: 'kick', label: 'キック' },
  { id: 'goal', label: 'ゴール' },
  { id: 'cheer', label: '歓声' },
];

const SETTINGS_KEY = 'touchline-academy-audio-v1';

const DEFAULT_SETTINGS: AudioSettings = {
  bgmOn: false,
  seOn: false,
  bgmVolume: 0.55,
  seVolume: 0.6,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ---------------------------------------------------------------------------
// 環境検出（テスト環境・SSR では window / document / localStorage / AudioContext が
// すべて存在しないため、以降のすべての処理はこれらのガードを必ず通す）
// ---------------------------------------------------------------------------

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (!hasWindow()) return null;
  try {
    const w = window as unknown as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

export function isAudioSupported(): boolean {
  try {
    return getAudioContextCtor() !== null;
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 設定の永続化（localStorage）。壊れた値・非対応環境では既定値にフォールバックする。
// ---------------------------------------------------------------------------

function readStoredSettings(): AudioSettings {
  if (!hasLocalStorage()) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      bgmOn: typeof parsed.bgmOn === 'boolean' ? parsed.bgmOn : DEFAULT_SETTINGS.bgmOn,
      seOn: typeof parsed.seOn === 'boolean' ? parsed.seOn : DEFAULT_SETTINGS.seOn,
      bgmVolume:
        typeof parsed.bgmVolume === 'number'
          ? clamp01(parsed.bgmVolume)
          : DEFAULT_SETTINGS.bgmVolume,
      seVolume:
        typeof parsed.seVolume === 'number'
          ? clamp01(parsed.seVolume)
          : DEFAULT_SETTINGS.seVolume,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStoredSettings(next: AudioSettings): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // プライベートモード等でストレージが使えない場合は無視して続行する。
  }
}

let settings: AudioSettings = readStoredSettings();
const listeners = new Set<(s: AudioSettings) => void>();

export function getAudioSettings(): AudioSettings {
  return { ...settings };
}

export function subscribeAudioSettings(fn: (s: AudioSettings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// 音楽理論まわりの小さなヘルパー
// ---------------------------------------------------------------------------

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type ChordQuality = 'maj' | 'min' | 'maj7' | 'min7' | 'dom7';
const CHORD_TONES: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
};

type ChordStep = { root: number; quality: ChordQuality; beats: number };
type NoteStep = { midi: number | null; beats: number };

type SceneDef = {
  tempo: number;
  chords: ChordStep[];
  bass: NoteStep[];
  melody: NoteStep[];
  leadWave: OscillatorType;
  padWave: OscillatorType;
  bassWave: OscillatorType;
  hats: boolean;
  gain: { pad: number; lead: number; bass: number };
};

const LOOP_BEATS = 16; // 4/4 拍子 × 4小節をループの基本単位にする

function padTo(steps: NoteStep[], totalBeats: number): NoteStep[] {
  const sum = steps.reduce((a, s) => a + s.beats, 0);
  const rest = totalBeats - sum;
  return rest > 0.01 ? [...steps, { midi: null, beats: rest }] : steps;
}

function repeatNote(midi: number, beats: number, times: number): NoteStep[] {
  return Array.from({ length: times }, () => ({ midi, beats }));
}

function alternate(a: number, b: number, beats: number, times: number): NoteStep[] {
  return Array.from({ length: times }, (_, i) => ({ midi: i % 2 === 0 ? a : b, beats }));
}

// ---------------------------------------------------------------------------
// 場面ごとの楽曲データ（コード進行とメロディはすべて本プロジェクトのオリジナル）。
// 既存楽曲の旋律・和声を参照・再現していない。
// ---------------------------------------------------------------------------

const SCENES: Record<BgmScene, SceneDef> = {
  // クラブハウス（穏やか）: C系のジャジーなコードでのんびりと。
  clubhouse: {
    tempo: 84,
    chords: [
      { root: 60, quality: 'maj7', beats: 4 }, // Cmaj7
      { root: 57, quality: 'min7', beats: 4 }, // Am7
      { root: 53, quality: 'maj7', beats: 4 }, // Fmaj7
      { root: 55, quality: 'dom7', beats: 4 }, // G7
    ],
    bass: [
      { midi: 36, beats: 4 },
      { midi: 33, beats: 4 },
      { midi: 29, beats: 4 },
      { midi: 31, beats: 4 },
    ],
    melody: padTo(
      [
        { midi: 72, beats: 1.5 },
        { midi: null, beats: 0.5 },
        { midi: 76, beats: 1 },
        { midi: 74, beats: 1 },
        { midi: 72, beats: 2 },
        { midi: null, beats: 1 },
        { midi: 69, beats: 1.5 },
        { midi: null, beats: 0.5 },
        { midi: 71, beats: 1 },
        { midi: 69, beats: 1 },
        { midi: 67, beats: 2 },
      ],
      LOOP_BEATS,
    ),
    leadWave: 'sine',
    padWave: 'sine',
    bassWave: 'triangle',
    hats: false,
    gain: { pad: 0.11, lead: 0.16, bass: 0.2 },
  },

  // 試合前（高揚）: D メジャーのポップな進行、跳ねる8分のベース。
  prematch: {
    tempo: 128,
    chords: [
      { root: 50, quality: 'maj', beats: 4 }, // D
      { root: 57, quality: 'maj', beats: 4 }, // A
      { root: 59, quality: 'min', beats: 4 }, // Bm
      { root: 55, quality: 'maj', beats: 4 }, // G
    ],
    bass: [
      ...alternate(38, 50, 0.5, 8),
      ...alternate(45, 57, 0.5, 8),
      ...alternate(47, 59, 0.5, 8),
      ...alternate(43, 55, 0.5, 8),
    ],
    melody: padTo(
      [
        { midi: 74, beats: 0.5 },
        { midi: 78, beats: 0.5 },
        { midi: 81, beats: 1 },
        { midi: null, beats: 0.5 },
        { midi: 78, beats: 0.5 },
        { midi: 74, beats: 1 },
        { midi: null, beats: 1 },
        { midi: 76, beats: 0.5 },
        { midi: 81, beats: 0.5 },
        { midi: 83, beats: 1 },
        { midi: null, beats: 0.5 },
        { midi: 81, beats: 0.5 },
        { midi: 78, beats: 1 },
        { midi: 74, beats: 2 },
      ],
      LOOP_BEATS,
    ),
    leadWave: 'triangle',
    padWave: 'sawtooth',
    bassWave: 'sawtooth',
    hats: true,
    gain: { pad: 0.08, lead: 0.2, bass: 0.16 },
  },

  // 試合中（緊張）: Am 中心、16分の走るベースで前のめりの緊張感を出す。
  match: {
    tempo: 140,
    chords: [
      { root: 57, quality: 'min', beats: 4 }, // Am
      { root: 53, quality: 'maj', beats: 4 }, // F
      { root: 60, quality: 'maj', beats: 4 }, // C
      { root: 52, quality: 'dom7', beats: 4 }, // E7 (緊張を作る導音)
    ],
    bass: [
      ...repeatNote(45, 0.25, 16),
      ...repeatNote(41, 0.25, 16),
      ...repeatNote(48, 0.25, 16),
      ...repeatNote(40, 0.25, 16),
    ],
    melody: padTo(
      [
        { midi: 69, beats: 0.5 },
        { midi: 72, beats: 0.5 },
        { midi: 73, beats: 0.5 },
        { midi: null, beats: 0.5 },
        { midi: 69, beats: 1 },
        { midi: null, beats: 0.5 },
        { midi: 65, beats: 0.5 },
        { midi: 69, beats: 0.5 },
        { midi: 72, beats: 1 },
        { midi: null, beats: 0.5 },
        { midi: 64, beats: 0.5 },
        { midi: 67, beats: 0.5 },
        { midi: 69, beats: 1 },
        { midi: 72, beats: 0.5 },
        { midi: 73, beats: 0.5 },
        { midi: 69, beats: 1 },
        { midi: null, beats: 0.5 },
        { midi: 65, beats: 0.5 },
        { midi: 69, beats: 1 },
      ],
      LOOP_BEATS,
    ),
    leadWave: 'sawtooth',
    padWave: 'sawtooth',
    bassWave: 'square',
    hats: true,
    gain: { pad: 0.07, lead: 0.14, bass: 0.16 },
  },

  // 勝利: C メジャーのファンファーレ。
  victory: {
    tempo: 132,
    chords: [
      { root: 60, quality: 'maj', beats: 4 }, // C
      { root: 53, quality: 'maj', beats: 4 }, // F
      { root: 55, quality: 'maj', beats: 4 }, // G
      { root: 60, quality: 'maj', beats: 4 }, // C
    ],
    bass: [
      ...repeatNote(36, 1, 4),
      ...repeatNote(29, 1, 4),
      ...repeatNote(31, 1, 4),
      ...repeatNote(36, 1, 4),
    ],
    melody: padTo(
      [
        { midi: 72, beats: 0.5 },
        { midi: 76, beats: 0.5 },
        { midi: 79, beats: 1 },
        { midi: 84, beats: 2 },
        { midi: null, beats: 0.5 },
        { midi: 79, beats: 0.5 },
        { midi: 76, beats: 1 },
        { midi: 79, beats: 0.5 },
        { midi: 83, beats: 0.5 },
        { midi: 86, beats: 2 },
        { midi: 84, beats: 1 },
        { midi: 79, beats: 0.5 },
        { midi: 76, beats: 0.5 },
        { midi: 72, beats: 2 },
      ],
      LOOP_BEATS,
    ),
    leadWave: 'square',
    padWave: 'sawtooth',
    bassWave: 'square',
    hats: true,
    gain: { pad: 0.1, lead: 0.22, bass: 0.2 },
  },

  // 敗戦: Am の静かな下降旋律。長めの余韻。
  defeat: {
    tempo: 72,
    chords: [
      { root: 57, quality: 'min', beats: 4 }, // Am
      { root: 50, quality: 'min', beats: 4 }, // Dm
      { root: 52, quality: 'maj', beats: 4 }, // E
      { root: 57, quality: 'min', beats: 4 }, // Am
    ],
    bass: [
      { midi: 45, beats: 4 },
      { midi: 38, beats: 4 },
      { midi: 40, beats: 4 },
      { midi: 45, beats: 4 },
    ],
    melody: padTo(
      [
        { midi: 69, beats: 2 },
        { midi: null, beats: 0.5 },
        { midi: 67, beats: 1.5 },
        { midi: 65, beats: 2 },
        { midi: null, beats: 1 },
        { midi: 64, beats: 2 },
        { midi: null, beats: 0.5 },
        { midi: 60, beats: 1.5 },
      ],
      LOOP_BEATS,
    ),
    leadWave: 'sine',
    padWave: 'sine',
    bassWave: 'sine',
    hats: false,
    gain: { pad: 0.1, lead: 0.14, bass: 0.18 },
  },
};

// ---------------------------------------------------------------------------
// オーディオグラフ（AudioContext は1つだけ生成する）
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let bgmGain: GainNode | null = null;
let sceneGain: GainNode | null = null;
let seGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let visibilityBound = false;
let unsupported = false; // 一度非対応と判定したら以降は毎回 try しない

function buildNoiseBuffer(c: AudioContext): AudioBuffer | null {
  try {
    const len = Math.max(1, Math.floor(c.sampleRate * 2));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  } catch {
    return null;
  }
}

function bindVisibilityHandling(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  try {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      try {
        if (document.hidden) {
          stopScheduler();
          void ctx.suspend().catch(() => {});
        } else if (settings.bgmOn && currentScene) {
          void ctx.resume().catch(() => {});
          startScheduler();
        }
      } catch {
        // 非表示切替中の失敗は無視する（画面を壊さない）。
      }
    });
  } catch {
    // addEventListener が使えない環境では何もしない。
  }
}

function ensureGraph(): boolean {
  if (ctx) return true;
  if (unsupported) return false;
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    unsupported = true;
    return false;
  }
  try {
    const c = new Ctor();
    const master = c.createGain();
    master.gain.value = 1;
    master.connect(c.destination);

    const bgm = c.createGain();
    bgm.gain.value = settings.bgmOn ? settings.bgmVolume : 0;
    bgm.connect(master);

    const scene = c.createGain();
    scene.gain.value = 0;

    const delay = c.createDelay(1.0);
    delay.delayTime.value = 0.28;
    const feedback = c.createGain();
    feedback.gain.value = 0.22;

    scene.connect(bgm);
    scene.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(bgm);

    const se = c.createGain();
    se.gain.value = settings.seOn ? settings.seVolume : 0;
    se.connect(master);

    ctx = c;
    bgmGain = bgm;
    sceneGain = scene;
    seGain = se;
    noiseBuffer = buildNoiseBuffer(c);
    bindVisibilityHandling();
    return true;
  } catch {
    ctx = null;
    bgmGain = null;
    sceneGain = null;
    seGain = null;
    noiseBuffer = null;
    unsupported = true;
    return false;
  }
}

/** ユーザー操作（クリック等）のハンドラから呼ぶ。AudioContext の生成・再開のみ行う。 */
export function primeAudio(): void {
  try {
    if (!ensureGraph() || !ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    // 何もしない（画面を壊さない）。
  }
}

function applySettingsToGraph(): void {
  if (!ctx || !bgmGain || !seGain) return;
  try {
    const now = ctx.currentTime;
    bgmGain.gain.setTargetAtTime(settings.bgmOn ? settings.bgmVolume : 0, now, 0.05);
    seGain.gain.setTargetAtTime(settings.seOn ? settings.seVolume : 0, now, 0.05);
    if (settings.bgmOn && currentScene) {
      primeAudio();
      startScheduler();
    } else if (!settings.bgmOn) {
      stopScheduler();
    }
  } catch {
    // 何もしない。
  }
}

export function setAudioSettings(patch: Partial<AudioSettings>): AudioSettings {
  const next: AudioSettings = {
    bgmOn: patch.bgmOn ?? settings.bgmOn,
    seOn: patch.seOn ?? settings.seOn,
    bgmVolume: patch.bgmVolume !== undefined ? clamp01(patch.bgmVolume) : settings.bgmVolume,
    seVolume: patch.seVolume !== undefined ? clamp01(patch.seVolume) : settings.seVolume,
  };
  settings = next;
  writeStoredSettings(next);
  try {
    applySettingsToGraph();
  } catch {
    // 何もしない。
  }
  listeners.forEach((fn) => {
    try {
      fn({ ...next });
    } catch {
      // 購読側の例外はここで握りつぶす（他の購読者・呼び出し元に影響させない）。
    }
  });
  return { ...next };
}

// ---------------------------------------------------------------------------
// 音の合成（トーン・ノイズの共通ヘルパー）
// ---------------------------------------------------------------------------

function scheduleTone(
  destination: AudioNode,
  freq: number,
  startTime: number,
  duration: number,
  opts: { wave: OscillatorType; peak: number; attack: number; release: number; detune?: number },
): void {
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = opts.wave;
    osc.frequency.setValueAtTime(Math.max(20, freq), startTime);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, startTime);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    const attackEnd = startTime + Math.max(0.004, opts.attack);
    env.gain.linearRampToValueAtTime(Math.max(0.0001, opts.peak), attackEnd);
    const releaseStart = Math.max(attackEnd, startTime + duration - opts.release);
    env.gain.setValueAtTime(Math.max(0.0001, opts.peak), releaseStart);
    env.gain.linearRampToValueAtTime(0.0001, releaseStart + opts.release);
    osc.connect(env);
    env.connect(destination);
    osc.start(startTime);
    const stopAt = releaseStart + opts.release + 0.02;
    osc.stop(stopAt);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        // 何もしない。
      }
    };
  } catch {
    // 何もしない（1音のスケジュール失敗で全体を壊さない）。
  }
}

function scheduleChord(t: number, step: ChordStep, def: SceneDef, secondsPerBeat: number): void {
  if (!ctx || !sceneGain) return;
  const tones = CHORD_TONES[step.quality];
  const dur = step.beats * secondsPerBeat;
  const peak = def.gain.pad / Math.max(2, tones.length);
  tones.forEach((offset, i) => {
    scheduleTone(sceneGain!, midiToFreq(step.root + offset), t, dur, {
      wave: def.padWave,
      peak,
      attack: Math.min(0.6, dur * 0.25),
      release: Math.min(0.8, dur * 0.3),
      detune: i % 2 === 0 ? -4 : 4,
    });
  });
}

function scheduleHat(t: number): void {
  if (!ctx || !sceneGain || !noiseBuffer) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4500, t);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.05, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp);
    hp.connect(env);
    env.connect(sceneGain);
    src.start(t);
    src.stop(t + 0.06);
    src.onended = () => {
      try {
        src.disconnect();
        hp.disconnect();
        env.disconnect();
      } catch {
        // 何もしない。
      }
    };
  } catch {
    // 何もしない。
  }
}

// ---------------------------------------------------------------------------
// BGM スケジューラ（先読み方式。各パート独立にループする）
// ---------------------------------------------------------------------------

type PlayingScene = {
  scene: BgmScene;
  def: SceneDef;
  secondsPerBeat: number;
  chordIdx: number;
  chordNext: number;
  bassIdx: number;
  bassNext: number;
  melodyIdx: number;
  melodyNext: number;
  hatNext: number;
};

let currentScene: BgmScene | null = null;
let playing: PlayingScene | null = null;
let schedulerId: ReturnType<typeof setTimeout> | null = null;

const SCHEDULE_AHEAD = 0.15;
const TICK_MS = 40;

function advanceChord(p: PlayingScene): void {
  const step = p.def.chords[p.chordIdx];
  scheduleChord(p.chordNext, step, p.def, p.secondsPerBeat);
  p.chordNext += Math.max(0.05, step.beats) * p.secondsPerBeat;
  p.chordIdx = (p.chordIdx + 1) % p.def.chords.length;
}

function advanceBass(p: PlayingScene): void {
  const step = p.def.bass[p.bassIdx];
  const dur = Math.max(0.05, step.beats) * p.secondsPerBeat;
  if (step.midi !== null && sceneGain) {
    scheduleTone(sceneGain, midiToFreq(step.midi), p.bassNext, dur, {
      wave: p.def.bassWave,
      peak: p.def.gain.bass,
      attack: 0.008,
      release: Math.min(0.18, dur * 0.5),
    });
  }
  p.bassNext += dur;
  p.bassIdx = (p.bassIdx + 1) % p.def.bass.length;
}

function advanceMelody(p: PlayingScene): void {
  const step = p.def.melody[p.melodyIdx];
  const dur = Math.max(0.05, step.beats) * p.secondsPerBeat;
  if (step.midi !== null && sceneGain) {
    scheduleTone(sceneGain, midiToFreq(step.midi), p.melodyNext, dur, {
      wave: p.def.leadWave,
      peak: p.def.gain.lead,
      attack: 0.012,
      release: Math.min(0.3, dur * 0.4),
    });
  }
  p.melodyNext += dur;
  p.melodyIdx = (p.melodyIdx + 1) % p.def.melody.length;
}

function schedulerTick(): void {
  if (!ctx || !playing) {
    schedulerId = null;
    return;
  }
  try {
    const ahead = ctx.currentTime + SCHEDULE_AHEAD;
    let guard = 0;
    while (playing.chordNext < ahead && guard++ < 64) advanceChord(playing);
    guard = 0;
    while (playing.bassNext < ahead && guard++ < 256) advanceBass(playing);
    guard = 0;
    while (playing.melodyNext < ahead && guard++ < 256) advanceMelody(playing);
    if (playing.def.hats) {
      guard = 0;
      while (playing.hatNext < ahead && guard++ < 512) {
        scheduleHat(playing.hatNext);
        playing.hatNext += playing.secondsPerBeat * 0.5;
      }
    }
    schedulerId = setTimeout(schedulerTick, TICK_MS);
  } catch {
    schedulerId = null;
  }
}

function startScheduler(): void {
  if (!ctx || !currentScene) return;
  if (playing && playing.scene === currentScene && schedulerId !== null) return;
  try {
    const def = SCENES[currentScene];
    const now = ctx.currentTime + 0.06;
    const secondsPerBeat = 60 / def.tempo;
    playing = {
      scene: currentScene,
      def,
      secondsPerBeat,
      chordIdx: 0,
      chordNext: now,
      bassIdx: 0,
      bassNext: now,
      melodyIdx: 0,
      melodyNext: now,
      hatNext: now,
    };
    if (sceneGain) sceneGain.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    if (schedulerId !== null) clearTimeout(schedulerId);
    schedulerTick();
  } catch {
    // 何もしない。
  }
}

function stopScheduler(): void {
  if (schedulerId !== null) {
    clearTimeout(schedulerId);
    schedulerId = null;
  }
}

/**
 * BGM の場面を切り替える。`null` を渡すと BGM を止める。
 * 設定が OFF のときは currentScene だけ覚えておき、音は鳴らさない
 * （後で ON にしたときに続きから自然に始まる）。
 */
export function playScene(scene: BgmScene | null): void {
  try {
    if (scene === currentScene) {
      if (scene && settings.bgmOn && ensureGraph()) {
        primeAudio();
        startScheduler();
      }
      return;
    }
    currentScene = scene;
    if (!scene) {
      stopScheduler();
      playing = null;
      if (ctx && sceneGain) sceneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      return;
    }
    if (!settings.bgmOn) return;
    if (!ensureGraph()) return;
    primeAudio();
    startScheduler();
  } catch {
    // 何もしない（呼び出し元の画面を壊さない）。
  }
}

/** BGM を止める（場面の記憶もリセットする）。 */
export function stopAll(): void {
  try {
    currentScene = null;
    stopScheduler();
    playing = null;
    if (ctx && sceneGain) sceneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  } catch {
    // 何もしない。
  }
}

// ---------------------------------------------------------------------------
// 効果音（SE）
// ---------------------------------------------------------------------------

function scheduleClick(t: number): void {
  if (!seGain) return;
  scheduleTone(seGain, 880, t, 0.07, { wave: 'triangle', peak: 0.3, attack: 0.002, release: 0.06 });
}

function scheduleWhistle(t: number): void {
  if (!ctx || !seGain) return;
  try {
    const dur = 0.42;
    const carrier = ctx.createOscillator();
    carrier.type = 'square';
    carrier.frequency.setValueAtTime(2900, t);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(28, t);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(60, t);
    lfo.connect(lfoGain);
    lfoGain.connect(carrier.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.02);
    env.gain.setValueAtTime(0.5, t + dur - 0.08);
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    carrier.connect(env);
    env.connect(seGain);
    carrier.start(t);
    lfo.start(t);
    carrier.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
    carrier.onended = () => {
      try {
        carrier.disconnect();
        lfo.disconnect();
        lfoGain.disconnect();
        env.disconnect();
      } catch {
        // 何もしない。
      }
    };
  } catch {
    // 何もしない。
  }
}

function scheduleKick(t: number): void {
  if (!ctx || !seGain) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(env);
    env.connect(seGain);
    osc.start(t);
    osc.stop(t + 0.2);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        // 何もしない。
      }
    };
    if (noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t);
      bp.Q.value = 0.7;
      const nEnv = ctx.createGain();
      nEnv.gain.setValueAtTime(0.001, t);
      nEnv.gain.linearRampToValueAtTime(0.35, t + 0.004);
      nEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(bp);
      bp.connect(nEnv);
      nEnv.connect(seGain);
      src.start(t);
      src.stop(t + 0.06);
      src.onended = () => {
        try {
          src.disconnect();
          bp.disconnect();
          nEnv.disconnect();
        } catch {
          // 何もしない。
        }
      };
    }
  } catch {
    // 何もしない。
  }
}

function scheduleCheer(t: number, duration = 1.8, peak = 0.4): void {
  if (!ctx || !seGain || !noiseBuffer) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.linearRampToValueAtTime(2200, t + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(500, t + duration);
    filter.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + duration * 0.3);
    env.gain.setValueAtTime(peak, t + duration * 0.6);
    env.gain.linearRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(env);
    env.connect(seGain);
    src.start(t);
    src.stop(t + duration + 0.05);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        env.disconnect();
      } catch {
        // 何もしない。
      }
    };
  } catch {
    // 何もしない。
  }
}

function scheduleGoal(t: number): void {
  if (!ctx || !seGain) return;
  const notes = [72, 76, 79, 84];
  notes.forEach((midi, i) => {
    scheduleTone(seGain!, midiToFreq(midi), t + i * 0.09, 0.32, {
      wave: 'square',
      peak: 0.28,
      attack: 0.005,
      release: 0.22,
    });
  });
  scheduleCheer(t + 0.05, 1.4, 0.35);
}

/** 効果音を1回再生する。設定が OFF・非対応環境では何もしない。 */
export function playSfx(name: SfxName): void {
  try {
    if (!settings.seOn) return;
    if (!ensureGraph() || !ctx || !seGain) return;
    primeAudio();
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'click':
        scheduleClick(t);
        break;
      case 'whistle':
        scheduleWhistle(t);
        break;
      case 'kick':
        scheduleKick(t);
        break;
      case 'goal':
        scheduleGoal(t);
        break;
      case 'cheer':
        scheduleCheer(t);
        break;
    }
  } catch {
    // 何もしない（画面を壊さない）。
  }
}
