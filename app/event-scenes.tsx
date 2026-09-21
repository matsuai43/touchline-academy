'use client';
// TOUCHLINE ACADEMY v3 — W9: 週ごとのイベントを複数枚の静止画（紙芝居）で表現する
//
// このファイルは2つを提供する:
//   1. SceneArt: 12種の場面をフラットなインラインSVGで描く背景ライブラリ
//      （外部画像は一切使わない。lib/event-scenes.ts の SceneId に対応）
//   2. EventStills: 2〜3枚の静止画をめくる汎用の紙芝居コンポーネント。
//      学校生活イベント（app/life-ui.tsx）・クラブイベント（統括側が
//      app/game-ui.tsx に組み込む想定）の両方から使える、DOM専用の
//      プレゼンテーション層。lib/school-life.ts・lib/game.ts のどちらにも
//      依存しない（呼び出し側が文言・選択肢・効果ヒントを解決して渡す）。
//
// スタイルはすべてこのファイル内の <style> ブロックで完結し、クラス名は
// すべて `es-` 接頭辞を付ける。色は原則 CSS 変数（globals.css で定義される
// var(--foreground) 等）を使い、ライト/ダーク両テーマに追従する。
// SVGの背景イラスト自体は「絵」なので両テーマ共通の固定色を使うが、
// 絵の上に文字を載せる場合は var(--card) の帯を敷いて var(--foreground) の
// 文字を置き、4.5:1以上のコントラストを両テーマで確保する。吹き出しは
// 白地に濃色文字の固定色（吹き出し内で4.5:1以上）。

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Portrait } from './development-ui';
import type { SceneId, SceneTime, EventScenePanel } from '@/lib/event-scenes';
import { SCENE_LABELS } from '@/lib/event-scenes';

// ---------------------------------------------------------------------------
// 1. 場面（SVG背景）ライブラリ
// ---------------------------------------------------------------------------

/** 時間帯ごとの空の色（固定色。絵そのものは両テーマ共通でよい）。 */
const SKY: Record<SceneTime, { top: string; bottom: string; sun: string; stars: boolean }> = {
  day: { top: '#7ec8e3', bottom: '#cfeaf5', sun: '#fff3b0', stars: false },
  evening: { top: '#4a5a8f', bottom: '#f2a765', sun: '#ffd27a', stars: false },
  night: { top: '#0f1b3a', bottom: '#233463', sun: '#e8ecff', stars: true },
};

function Stars({ seed }: { seed: number }) {
  const pts = Array.from({ length: 14 }, (_, i) => {
    const x = (i * 137 + seed * 53) % 400;
    const y = ((i * 71 + seed * 19) % 90) + 6;
    const r = (i % 3) + 0.6;
    return { x, y, r };
  });
  return (
    <>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#ffffff" opacity={0.85} />
      ))}
    </>
  );
}

/** 校庭（体育祭）：トラック・ゴールポスト・応援の旗。 */
function SchoolyardScene() {
  return (
    <>
      <rect x={0} y={140} width={400} height={85} fill="#7cb96b" />
      <ellipse cx={200} cy={185} rx={170} ry={34} fill="none" stroke="#f4efe0" strokeWidth={3} />
      <ellipse cx={200} cy={185} rx={128} ry={24} fill="none" stroke="#f4efe0" strokeWidth={2} />
      <rect x={18} y={150} width={4} height={34} fill="#f4efe0" />
      <rect x={18} y={150} width={46} height={4} fill="#f4efe0" />
      <path d="M18 150 L64 150 L18 168 Z" fill="#f18c82" opacity={0.9} />
      {[40, 90, 140, 260, 310, 360].map((x, i) => (
        <path key={i} d={`M${x} 96 L${x + 16} 102 L${x} 108 Z`} fill={i % 2 ? '#f18c82' : '#c6f16a'} />
      ))}
      <line x1={40} y1={96} x2={40} y2={110} stroke="#3d3a2f" strokeWidth={1.5} />
      <line x1={360} y1={96} x2={360} y2={110} stroke="#3d3a2f" strokeWidth={1.5} />
    </>
  );
}

/** 教室：黒板・窓・机の列。 */
function ClassroomScene({ examMode = false }: { examMode?: boolean }) {
  const desks = Array.from({ length: 6 }, (_, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const scale = row === 0 ? 1 : 0.72;
    const x = 60 + col * 100 * scale + row * 30;
    const y = 150 + row * 34;
    return { x, y, scale };
  });
  return (
    <>
      <rect x={0} y={40} width={400} height={110} fill="#e7ddc6" />
      <rect x={30} y={54} width={110} height={60} rx={4} fill="#33463b" />
      <rect x={38} y={62} width={94} height={5} fill="#f4efe0" opacity={0.7} />
      <rect x={38} y={74} width={64} height={5} fill="#f4efe0" opacity={0.5} />
      {[190, 250, 310, 370].map((x, i) => (
        <rect key={i} x={x} y={50} width={44} height={54} rx={3} fill="#bfe3ef" stroke="#8fa5ad" strokeWidth={2} />
      ))}
      <rect x={0} y={150} width={400} height={75} fill="#cbb896" />
      {desks.map((d, i) => (
        <g key={i}>
          <rect x={d.x} y={d.y} width={54 * d.scale} height={22 * d.scale} rx={2} fill="#a9764f" />
          {examMode && (
            <rect
              x={d.x + 8 * d.scale}
              y={d.y - 3}
              width={38 * d.scale}
              height={14 * d.scale}
              rx={1}
              fill="#f7f4ea"
              stroke="#c9c2ac"
            />
          )}
        </g>
      ))}
      {examMode && (
        <g>
          <circle cx={355} cy={70} r={16} fill="#f4efe0" stroke="#33463b" strokeWidth={2} />
          <line x1={355} y1={70} x2={355} y2={60} stroke="#33463b" strokeWidth={2} />
          <line x1={355} y1={70} x2={362} y2={70} stroke="#33463b" strokeWidth={2} />
        </g>
      )}
    </>
  );
}

/** 廊下・屋上：フェンス越しの空、遠くの街並み。 */
function CorridorRooftopScene() {
  const fence = Array.from({ length: 12 }, (_, i) => i);
  return (
    <>
      <rect x={0} y={150} width={400} height={75} fill="#c9c2b3" />
      {[30, 90, 150, 250, 310, 370].map((x, i) => (
        <rect key={i} x={x} y={150 - (i % 3) * 8} width={22} height={(i % 3) * 8 + 26} fill="#8b93a1" opacity={0.55} />
      ))}
      <rect x={0} y={140} width={400} height={5} fill="#9aa3a6" />
      {fence.map((i) => (
        <line key={i} x1={i * 36} y1={140} x2={i * 36 + 30} y2={96} stroke="#c7ccc2" strokeWidth={2} opacity={0.8} />
      ))}
      {fence.map((i) => (
        <line key={'b' + i} x1={i * 36 + 30} y1={140} x2={i * 36} y2={96} stroke="#c7ccc2" strokeWidth={2} opacity={0.8} />
      ))}
      <line x1={0} y1={96} x2={400} y2={96} stroke="#c7ccc2" strokeWidth={3} />
    </>
  );
}

/** 文化祭の模擬店：紅白の屋根・提灯・人だかり。 */
function FestivalStallScene() {
  return (
    <>
      <rect x={0} y={150} width={400} height={75} fill="#d8c9a3" />
      <path d="M40 150 L40 100 L360 100 L360 150 Z" fill="#f4efe0" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={40 + i * 40} y={92} width={40} height={12} fill={i % 2 ? '#e2564f' : '#f4efe0'} stroke="#c9c2ac" />
      ))}
      <rect x={30} y={148} width={340} height={8} fill="#7a5b3a" />
      {[70, 150, 230, 310].map((x, i) => (
        <circle key={i} cx={x} cy={82} r={9} fill="#f4c95d" stroke="#c98a2c" strokeWidth={1.5} />
      ))}
      {[60, 100, 260, 300, 340].map((x, i) => (
        <circle key={i} cx={x} cy={200} r={7} fill="#c98a5a" opacity={0.8} />
      ))}
    </>
  );
}

/** 修学旅行の宿：畳・座卓・障子。 */
function RyokanRoomScene() {
  return (
    <>
      <rect x={0} y={150} width={400} height={75} fill="#cdbf85" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={i * 50} y1={150} x2={i * 50} y2={225} stroke="#a99b5e" strokeWidth={1.5} />
      ))}
      <rect x={0} y={40} width={260} height={112} fill="#efe6c9" />
      {Array.from({ length: 5 }, (_, i) => (
        <line key={i} x1={i * 52} y1={40} x2={i * 52} y2={152} stroke="#c9bb8c" strokeWidth={1.5} />
      ))}
      <line x1={0} y1={96} x2={260} y2={96} stroke="#c9bb8c" strokeWidth={1.5} />
      <rect x={140} y={172} width={110} height={12} rx={2} fill="#5b3d26" />
      <rect x={150} y={160} width={90} height={12} rx={2} fill="#6c4a2e" />
    </>
  );
}

/** 家のリビング：ソファ・窓・ラグ。 */
function LivingRoomScene() {
  return (
    <>
      <rect x={0} y={150} width={400} height={75} fill="#b98f63" />
      <ellipse cx={200} cy={196} rx={120} ry={18} fill="#d9b98a" opacity={0.6} />
      <rect x={0} y={40} width={400} height={110} fill="#efe4d2" />
      <rect x={40} y={58} width={70} height={64} rx={4} fill="#8fa5ad" stroke="#5f747b" strokeWidth={2} />
      <rect x={230} y={150} width={140} height={44} rx={10} fill="#c96f5c" />
      <rect x={230} y={140} width={140} height={18} rx={9} fill="#e08f7c" />
      <rect x={225} y={150} width={16} height={40} rx={6} fill="#a85847" />
      <rect x={359} y={150} width={16} height={40} rx={6} fill="#a85847" />
    </>
  );
}

/** 部室：ロッカー・ベンチ・トロフィー棚。 */
function ClubroomScene() {
  return (
    <>
      <rect x={0} y={150} width={400} height={75} fill="#8a7660" />
      <rect x={0} y={40} width={400} height={110} fill="#dad0bd" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={20 + i * 30} y={54} width={24} height={70} rx={2} fill={i % 2 ? '#6f8a5e' : '#5a7a4d'} stroke="#3d5233" strokeWidth={1.5} />
      ))}
      <rect x={250} y={60} width={120} height={22} rx={2} fill="#c9b98a" />
      <circle cx={270} cy={71} r={7} fill="#f4c95d" />
      <circle cx={296} cy={71} r={7} fill="#e2564f" />
      <circle cx={322} cy={71} r={7} fill="#8fa5ad" />
      <rect x={250} y={140} width={130} height={20} rx={6} fill="#7a6a52" />
    </>
  );
}

/** グラウンド（練習）：ピッチ・ゴール・コーン。 */
function PitchScene({ rainy = false }: { rainy?: boolean }) {
  return (
    <>
      <rect x={0} y={140} width={400} height={85} fill={rainy ? '#4e6b52' : '#5fa557'} />
      <line x1={0} y1={182} x2={400} y2={182} stroke="#eaf6e2" strokeWidth={2} opacity={0.8} />
      <circle cx={200} cy={182} r={26} fill="none" stroke="#eaf6e2" strokeWidth={2} opacity={0.8} />
      <rect x={10} y={158} width={30} height={48} fill="none" stroke="#eaf6e2" strokeWidth={2} opacity={0.8} />
      {Array.from({ length: 5 }, (_, i) => (
        <line key={'n' + i} x1={10} y1={158 + i * 12} x2={40} y2={158 + i * 12} stroke="#eaf6e2" strokeWidth={1} opacity={0.4} />
      ))}
      {[100, 300].map((x, i) => (
        <path key={i} d={`M${x} 210 L${x + 8} 195 L${x + 16} 210 Z`} fill="#f4c95d" />
      ))}
      {rainy && (
        <>
          {Array.from({ length: 24 }, (_, i) => {
            const x = (i * 47) % 400;
            const y = (i * 29) % 130;
            return <line key={i} x1={x} y1={y} x2={x - 8} y2={y + 18} stroke="#dfeaf5" strokeWidth={1.2} opacity={0.55} />;
          })}
          <ellipse cx={130} cy={200} rx={22} ry={5} fill="#cfe4ee" opacity={0.5} />
          <ellipse cx={260} cy={210} rx={28} ry={6} fill="#cfe4ee" opacity={0.5} />
        </>
      )}
    </>
  );
}

/** 保健室：ベッド・カーテン・救急箱。 */
function InfirmaryScene() {
  return (
    <>
      <rect x={0} y={150} width={400} height={75} fill="#dfe7e0" />
      <rect x={0} y={40} width={400} height={110} fill="#f2f6f0" />
      {Array.from({ length: 10 }, (_, i) => (
        <line key={i} x1={i * 40} y1={40} x2={i * 40} y2={150} stroke="#cddccf" strokeWidth={1.2} />
      ))}
      <rect x={230} y={140} width={140} height={54} rx={4} fill="#f4efe0" stroke="#c9c2ac" strokeWidth={2} />
      <rect x={230} y={132} width={140} height={12} rx={3} fill="#e6dfca" />
      <rect x={30} y={70} width={50} height={62} rx={4} fill="#f4efe0" stroke="#c9c2ac" strokeWidth={2} />
      <rect x={48} y={92} width={14} height={4} fill="#e2564f" />
      <rect x={53} y={87} width={4} height={14} fill="#e2564f" />
    </>
  );
}

/** 夕方の通学路：電柱・街灯・家並みのシルエット。 */
function DuskStreetScene() {
  return (
    <>
      <rect x={0} y={165} width={400} height={60} fill="#4a4c58" />
      <rect x={0} y={160} width={400} height={6} fill="#e7e2cf" />
      {[10, 90, 170, 250, 330].map((x, i) => (
        <path key={i} d={`M${x} 160 L${x + 45} 160 L${x + 30} 118 L${x + 15} 118 Z`} fill={i % 2 ? '#6b5a72' : '#5a5468'} />
      ))}
      <rect x={130} y={70} width={6} height={90} fill="#3d3a2f" />
      <line x1={100} y1={80} x2={160} y2={80} stroke="#3d3a2f" strokeWidth={4} />
      <rect x={300} y={90} width={5} height={70} fill="#3d3a2f" />
      <circle cx={302} cy={86} r={8} fill="#ffe9a8" opacity={0.9} />
    </>
  );
}

function SceneArt({ scene, time }: { scene: SceneId; time: SceneTime }) {
  const gid = useId().replace(/[:]/g, '');
  const sky = SKY[time];
  return (
    <svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`es-sky-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.top} />
          <stop offset="100%" stopColor={sky.bottom} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={400} height={225} fill={`url(#es-sky-${gid})`} />
      {sky.stars && <Stars seed={scene.length} />}
      <circle cx={time === 'night' ? 60 : 340} cy={time === 'evening' ? 60 : 40} r={time === 'evening' ? 26 : 20} fill={sky.sun} opacity={0.9} />
      {scene === 'schoolyard' && <SchoolyardScene />}
      {scene === 'classroom' && <ClassroomScene />}
      {scene === 'exam_room' && <ClassroomScene examMode />}
      {scene === 'corridor_rooftop' && <CorridorRooftopScene />}
      {scene === 'festival_stall' && <FestivalStallScene />}
      {scene === 'ryokan_room' && <RyokanRoomScene />}
      {scene === 'living_room' && <LivingRoomScene />}
      {scene === 'clubroom' && <ClubroomScene />}
      {scene === 'pitch_training' && <PitchScene />}
      {scene === 'pitch_rain' && <PitchScene rainy />}
      {scene === 'infirmary' && <InfirmaryScene />}
      {scene === 'dusk_street' && <DuskStreetScene />}
    </svg>
  );
}

export { SceneArt };

// ---------------------------------------------------------------------------
// 2. 汎用の紙芝居コンポーネント
// ---------------------------------------------------------------------------

export type EventStillsChoice = {
  id: string;
  label: string;
  hints?: { label: string; positive: boolean }[];
};

export type EventStillsResult = {
  /** 結果のナレーション文（choice.resultText(name) 等、呼び出し側で解決済みのもの） */
  text: string;
  effects?: { label: string; positive: boolean }[];
};

function HintChips({ hints }: { hints?: { label: string; positive: boolean }[] }) {
  if (!hints || !hints.length) return null;
  return (
    <span className="es-hints">
      {hints.map((h, i) => (
        <span key={i} className={'es-hint ' + (h.positive ? 'es-hint-pos' : 'es-hint-neg')}>
          {h.label}
        </span>
      ))}
    </span>
  );
}

export function EventStills({
  scenePanels,
  playerName,
  portraitIndex,
  kicker,
  heading,
  metaLine,
  momentNarration,
  choices,
  resolveResult,
  onCommit,
  closeLabel = '閉じる／次の週へ',
  className,
}: {
  /** lib/event-scenes.ts の EVENT_SCENES_BY_ID[id].panels（2〜3枚）。 */
  scenePanels: EventScenePanel[];
  playerName: string;
  portraitIndex: number;
  /** 上部に出す小さなカテゴリ表示（例：「学校行事」「CLUB EVENT」） */
  kicker?: ReactNode;
  /** イベントの見出し（例：event.title） */
  heading: string;
  /** 見出し下の補助テキスト（例：「七瀬（熱血漢）」） */
  metaLine?: string;
  /** 2枚目「場面」の吹き出し本文（event.prompt(name) 等、解決済みの文字列） */
  momentNarration: string;
  choices: EventStillsChoice[];
  /** 選ばれた選択肢IDから3枚目「結果」の内容を作る（choice.resultText(name) 等） */
  resolveResult: (choiceId: string) => EventStillsResult;
  /** 3枚目で「閉じる／次の週へ」が押されたときに、実際の選択を確定させる */
  onCommit: (choiceId: string) => void;
  closeLabel?: string;
  className?: string;
}) {
  const total = scenePanels.length;
  const [pageIndex, setPageIndex] = useState(0);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const panel = scenePanels[Math.min(pageIndex, total - 1)];
  const isEstablishing = panel.role === 'establishing';
  const isMoment = panel.role === 'moment';
  const isResult = panel.role === 'result';
  const result = isResult && chosenId ? resolveResult(chosenId) : null;

  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1));
  }
  function goNext() {
    setPageIndex((i) => Math.min(total - 1, i + 1));
  }
  function pickChoice(id: string) {
    setChosenId(id);
    goNext();
  }
  function commit() {
    if (chosenId) onCommit(chosenId);
  }
  function forward() {
    if (isEstablishing) goNext();
    else if (isResult) commit();
    // isMoment: 選択肢を選ぶまでは進めない
  }

  // ←→ キーでのページめくりは、ネイティブの keydown リスナーとして
  // ルート要素（フォーカス可能なボタン群の祖先）に付ける。JSXの
  // onKeyDown を非対話要素の div に直接付けると
  // oxlint(jsx-a11y/no-noninteractive-element-interactions) に抵触するため、
  // ここでは DOM API 経由でバインドし、対象要素自体には role を付けない
  // （ページ内の見出し・figure・ボタンで意味は十分に伝わる）。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        forward();
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  });

  const ariaLabel = panel.ariaLabel(playerName);
  const establishingNarration =
    scenePanels[0].role === 'establishing' && scenePanels[0].narration
      ? scenePanels[0].narration(playerName)
      : '';

  return (
    <div className={'es-root ' + (className ?? '')} ref={rootRef}>
      <style>{ES_CSS}</style>
      {kicker || heading ? (
        <div className="es-head">
          {kicker && <span className="es-kicker">{kicker}</span>}
          <h3 className="es-heading">{heading}</h3>
          {metaLine && <p className="es-meta">{metaLine}</p>}
        </div>
      ) : null}

      {/* role="img" は div に付けると oxlint(jsx-a11y/prefer-tag-over-role) に
          抵触するため、<figure>＋視覚的に隠した <figcaption> で同等の
          「絵の内容を説明するテキストをスクリーンリーダーへ渡す」を実現する。 */}
      <figure className="es-art">
        <div key={pageIndex} className={'es-art-inner es-fade es-shot-' + panel.role}>
          <SceneArt scene={panel.scene} time={panel.time} />
          <div className="es-portrait">
            <Portrait index={portraitIndex} name={playerName} size="large" />
          </div>
          {isMoment && (
            <div className="es-bubble">
              <p>{momentNarration}</p>
            </div>
          )}
        </div>
        {isEstablishing && (
          <div className="es-caption" key={'cap-' + pageIndex}>
            <p>{establishingNarration}</p>
          </div>
        )}
        {isResult && result && (
          <div className="es-caption" key={'cap-' + pageIndex}>
            <p>{result.text}</p>
          </div>
        )}
        <figcaption className="es-visually-hidden">{ariaLabel}</figcaption>
      </figure>

      <div className="es-body" aria-live="polite">
        {isEstablishing && (
          <div className="es-actions">
            <button type="button" className="es-btn es-btn-primary" onClick={goNext}>
              次へ
            </button>
          </div>
        )}
        {isMoment && (
          <div className="es-choices">
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className="es-btn es-choice"
                onClick={() => pickChoice(c.id)}
              >
                <span className="es-choice-label">{c.label}</span>
                <HintChips hints={c.hints} />
              </button>
            ))}
          </div>
        )}
        {isResult && result && (
          <div className="es-actions es-actions-result">
            <HintChips hints={result.effects} />
            <button type="button" className="es-btn es-btn-primary" onClick={commit}>
              {closeLabel}
            </button>
          </div>
        )}
      </div>

      <div className="es-nav">
        <button
          type="button"
          className="es-btn es-nav-btn"
          aria-disabled={pageIndex === 0}
          onClick={goPrev}
        >
          ← 前へ
        </button>
        <span className="es-dots" aria-hidden="true">
          {scenePanels.map((_, i) => (
            <span key={i} className={'es-dot ' + (i === pageIndex ? 'es-dot-active' : '')} />
          ))}
        </span>
        <span className="es-count">
          {pageIndex + 1}/{total}
        </span>
      </div>
    </div>
  );
}

export default EventStills;

// 使用実績のない export だが、SCENE_LABELS を再エクスポートしておくと、
// aria-label のフォールバックや将来のツールチップ表示で場面名（日本語）を
// 参照したい呼び出し側から import しやすい。
export { SCENE_LABELS };

// ---------------------------------------------------------------------------
// スタイル（すべて es- 接頭辞。色は CSS 変数を使い、ライト/ダーク双方に追従）
// ---------------------------------------------------------------------------
const ES_CSS = `
.es-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  outline: none;
}
.es-root button:focus-visible {
  outline: 4px solid var(--foreground);
  outline-offset: 2px;
  box-shadow: 0 0 0 2px #ffd43d;
}
.es-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.es-kicker {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 700;
  background: var(--primary);
  color: var(--primary-foreground);
}
.es-heading {
  margin: 2px 0 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--foreground);
}
.es-meta {
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted-foreground);
}
.es-art {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: min(240px, 40vh);
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--card);
  margin: 0;
}
.es-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.es-art-inner {
  position: absolute;
  inset: 0;
}
.es-art-inner svg {
  width: 100%;
  height: 100%;
  display: block;
  transition: transform 0.35s ease;
}
.es-shot-establishing svg {
  transform: scale(1);
}
.es-shot-moment svg {
  transform: scale(1.32) translateY(4%);
}
.es-shot-result svg {
  transform: scale(1.1);
}
@media (prefers-reduced-motion: reduce) {
  .es-art-inner svg {
    transition: none;
  }
}
.es-portrait {
  position: absolute;
  left: 5%;
  bottom: 8%;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
}
.es-portrait .portrait-large {
  width: clamp(52px, 22vw, 108px);
  height: clamp(52px, 22vw, 108px);
  border-radius: 20%;
}
.es-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 12px calc(8px + var(--safe-b, 0px));
  /* 絵の上に文字を載せるため、透過なしの var(--card) 帯を敷いて
     var(--foreground) の文字とのコントラストを両テーマで確実に確保する。 */
  background: var(--card);
  border-top: 1px solid var(--border);
}
.es-caption p {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--foreground);
}
.es-bubble {
  position: absolute;
  right: 4%;
  top: 6%;
  max-width: 62%;
  background: #ffffff;
  color: #1a1a1a;
  border-radius: 14px;
  padding: 8px 12px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
}
.es-bubble::after {
  content: '';
  position: absolute;
  left: 18px;
  bottom: -8px;
  border-width: 8px 8px 0 0;
  border-style: solid;
  border-color: #ffffff transparent transparent transparent;
}
.es-bubble p {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  color: #1a1a1a;
}
.es-body {
  min-height: 44px;
}
.es-actions {
  display: flex;
  justify-content: flex-end;
}
.es-actions-result {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.es-choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.es-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  cursor: pointer;
}
.es-btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.es-choice {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 14px;
  text-align: left;
}
.es-choice-label {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
}
.es-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.es-hint {
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 400;
  border: 1px solid var(--border);
  color: var(--foreground);
  background: var(--muted);
}
.es-hint-pos {
  color: var(--primary-foreground);
  background: var(--primary);
  border-color: var(--primary);
}
.es-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.es-nav-btn {
  min-width: 44px;
  padding: 8px 12px;
  font-size: 12px;
}
.es-nav-btn[aria-disabled='true'] {
  opacity: 0.42;
  pointer-events: none;
}
.es-dots {
  display: inline-flex;
  gap: 6px;
}
.es-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
}
.es-dot-active {
  background: var(--primary);
}
.es-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted-foreground);
  min-width: 32px;
  text-align: right;
}
.es-fade {
  animation: es-fade-in 0.16s ease both;
}
@media (prefers-reduced-motion: reduce) {
  .es-fade {
    animation: none;
  }
}
@keyframes es-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@media (max-height: 430px) {
  .es-art {
    max-height: 96px;
  }
  .es-heading {
    font-size: 15px;
  }
  .es-caption p,
  .es-bubble p {
    font-size: 12.5px;
  }
}
`;
