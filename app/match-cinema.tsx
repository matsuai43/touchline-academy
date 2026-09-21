'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { State } from '@/lib/game';
import type { Highlight } from '@/lib/development';
import {
  buildSequence,
  frameAt,
  kickoffFrame,
  durationFor,
  PITCH_W,
  PITCH_H,
  GOAL_Y,
  GOAL_HALF,
  type Frame,
  type MatchSequence,
  type PlayerDot,
} from '@/lib/match-2d';

function listLabel(h: Highlight) {
  return h.kind === 'goal'
    ? h.side === 0
      ? 'ゴール'
      : '失点'
    : h.kind === 'save'
      ? 'セーブ'
      : '枠外';
}
function subscribeMotion(notify: () => void) {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', notify);
  return () => mq.removeEventListener('change', notify);
}
function motionSnapshot() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---- 真上視点のピッチ図（Football Manager 風）。点＝選手、丸＝ボール。 ----
function PitchMarks() {
  const stripes = 8;
  const stripeW = PITCH_W / stripes;
  return (
    <g aria-hidden="true">
      {Array.from({ length: stripes }, (_, i) => (
        <rect
          key={i}
          x={i * stripeW}
          y={0}
          width={stripeW}
          height={PITCH_H}
          className={i % 2 ? 'fm-grass-b' : 'fm-grass-a'}
        />
      ))}
      <rect
        x={0.5}
        y={0.5}
        width={PITCH_W - 1}
        height={PITCH_H - 1}
        className="fm-line-shape"
      />
      <line x1={PITCH_W / 2} y1={0} x2={PITCH_W / 2} y2={PITCH_H} className="fm-line-shape" />
      <circle cx={PITCH_W / 2} cy={GOAL_Y} r={9.15} className="fm-line-shape" />
      <circle cx={PITCH_W / 2} cy={GOAL_Y} r={0.5} className="fm-line-fill" />
      {/* ペナルティエリア＋ゴールエリア（自陣・敵陣） */}
      {[0, 1].map((side) => {
        const x0 = side === 0 ? 0 : PITCH_W;
        const dir = side === 0 ? 1 : -1;
        return (
          <g key={side}>
            <rect
              x={side === 0 ? 0 : PITCH_W - 16.5}
              y={GOAL_Y - 20.15}
              width={16.5}
              height={40.3}
              className="fm-line-shape"
            />
            <rect
              x={side === 0 ? 0 : PITCH_W - 5.5}
              y={GOAL_Y - 9.16}
              width={5.5}
              height={18.32}
              className="fm-line-shape"
            />
            <rect
              x={x0 - (side === 0 ? 1.5 : 0)}
              y={GOAL_Y - GOAL_HALF}
              width={1.5}
              height={GOAL_HALF * 2}
              className="fm-goal-frame"
            />
            <circle cx={x0 + dir * 11} cy={GOAL_Y} r={0.5} className="fm-line-fill" />
          </g>
        );
      })}
    </g>
  );
}

function PlayerMark({ d }: { d: PlayerDot }) {
  const r = d.isGK ? 2.7 : 2.35;
  return (
    <g transform={`translate(${d.x} ${d.y})`}>
      {d.isGK && (
        <circle r={r + 0.7} className="fm-gk-ring" />
      )}
      {d.team === 'self' ? (
        <circle r={r} className="fm-dot-self" />
      ) : (
        <rect
          x={-r * 0.82}
          y={-r * 0.82}
          width={r * 1.64}
          height={r * 1.64}
          transform="rotate(45)"
          className="fm-dot-oppo"
        />
      )}
      <text textAnchor="middle" dominantBaseline="central" dy="0.15" className="fm-dot-num">
        {d.number}
      </text>
      {d.hasBall && <circle r={r + 1.3} className="fm-ball-ring" />}
    </g>
  );
}

function BallMark({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={1.05} className="fm-ball" />;
}

function PitchView({
  frame,
  ariaLabel,
  arrow,
}: {
  frame: Frame;
  ariaLabel: string;
  arrow?: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}) {
  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="fm-pitch"
      // SVGはimgタグに置き換えられないため、WAI-ARIAで推奨される role="img" +
      // aria-label のパターンを使う（既存の development-ui.tsx のポートレートと同じ意図）。
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <PitchMarks />
      {arrow && (
        <g>
          <defs>
            <marker
              id="fm-arrowhead"
              markerWidth="4"
              markerHeight="4"
              refX="3"
              refY="2"
              orient="auto"
            >
              <path d="M0,0 L4,2 L0,4 Z" className="fm-arrow-head" />
            </marker>
          </defs>
          <line
            x1={arrow.from.x}
            y1={arrow.from.y}
            x2={arrow.to.x}
            y2={arrow.to.y}
            className="fm-arrow"
            markerEnd="url(#fm-arrowhead)"
          />
        </g>
      )}
      {frame.players.map((d) => (
        <PlayerMark key={d.id} d={d} />
      ))}
      <BallMark x={frame.ball.x} y={frame.ball.y} />
    </svg>
  );
}

export default function MatchCinema({ s }: { s: State }) {
  const items = s.match!.details.highlights,
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(true),
    [speed, setSpeed] = useState<1 | 2>(1),
    [progress, setProgress] = useState(0),
    [docVisible, setDocVisible] = useState(true),
    [inView, setInView] = useState(true),
    reduced = useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
  const event: Highlight | undefined = items[index];
  const screenRef = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  const visible = docVisible && inView;

  const sequence: MatchSequence | null = useMemo(
    () => (event ? buildSequence(event, s) : null),
    [event, s],
  );

  // 場面の切り替え（再生中の自動送りを含む）は必ずここで elapsed/progress を
  // 0 に戻してから行う。effect の中で無条件に setState する代わりに、切り替えの
  // 起点となるイベントハンドラ側で直接リセットする（React Compiler の
  // 「エフェクト内の同期的な setState」警告を避けるため）。
  function restart(nextIndex: number) {
    elapsed.current = 0;
    setProgress(0);
    setIndex(nextIndex);
  }

  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState === 'visible');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const el = screenRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!event || !sequence || reduced || !playing || !visible) return;
    let raf = 0,
      last = 0;
    const duration = durationFor(event) / speed;
    const tick = (now: number) => {
      if (last) elapsed.current += now - last;
      last = now;
      const t = Math.min(1, elapsed.current / duration);
      if (t >= 1) {
        if (index < items.length - 1) restart(index + 1);
        else {
          setProgress(1);
          setPlaying(false);
        }
        return;
      }
      setProgress(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [event, sequence, playing, reduced, visible, speed, index, items.length]);

  const frame: Frame = sequence
    ? frameAt(sequence, reduced ? 1 : progress)
    : kickoffFrame(s);
  const atLastScene = index >= items.length - 1;

  return (
    <section className="cinema panel fm-cinema" id="match-movie">
      <style>{`
        .fm-cinema { --fm-self:#22d3ee; --fm-self-line:#063142; --fm-oppo:#ffb020; --fm-oppo-line:#3a2200;
          --fm-ball:#fbf7e8; --fm-ball-line:#16241c; --fm-grass-a:#1f6b3a; --fm-grass-b:#256f3e;
          --fm-pitch-line:#eef5e4; --fm-num:#08161c; }
        .fm-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .fm-eyebrow { display:block; font-size:12px; font-weight:700; letter-spacing:0.08em; color:var(--muted-foreground); }
        .fm-title { margin:2px 0 0; font-size:20px; font-weight:700; color:var(--foreground); }
        .fm-pill { font-size:12px; font-weight:700; color:var(--foreground); background:var(--card);
          border:1px solid var(--border); border-radius:999px; padding:6px 12px; }
        .fm-screen { margin-top:10px; border:1px solid var(--border); border-radius:12px; overflow:hidden;
          background:var(--card); }
        .fm-pitch { display:block; width:100%; height:auto; min-height:220px; aspect-ratio:${PITCH_W} / ${PITCH_H}; }
        .fm-grass-a { fill:var(--fm-grass-a); }
        .fm-grass-b { fill:var(--fm-grass-b); }
        .fm-line-shape { fill:none; stroke:var(--fm-pitch-line); stroke-width:0.35; }
        .fm-line-fill { fill:var(--fm-pitch-line); }
        .fm-goal-frame { fill:var(--fm-pitch-line); }
        .fm-dot-self { fill:var(--fm-self); stroke:var(--fm-self-line); stroke-width:0.4; }
        .fm-dot-oppo { fill:var(--fm-oppo); stroke:var(--fm-oppo-line); stroke-width:0.4; }
        .fm-gk-ring { fill:none; stroke:var(--fm-pitch-line); stroke-width:0.4; stroke-dasharray:1.1 0.9; }
        .fm-ball-ring { fill:none; stroke:var(--fm-ball); stroke-width:0.3; opacity:0.85; }
        .fm-dot-num { font-size:2.6px; font-weight:700; fill:var(--fm-num); }
        .fm-ball { fill:var(--fm-ball); stroke:var(--fm-ball-line); stroke-width:0.3; }
        .fm-arrow { stroke:var(--fm-ball); stroke-width:0.55; stroke-dasharray:1.6 1; }
        .fm-arrow-head { fill:var(--fm-ball); }
        .fm-caption { margin-top:10px; display:flex; align-items:baseline; gap:10px; font-weight:700;
          color:var(--foreground); background:var(--card); border:1px solid var(--border); border-radius:8px;
          padding:8px 12px; font-size:14px; }
        .fm-caption > span { font-size:12px; font-weight:700; color:var(--muted-foreground); }
        .fm-controls { margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; }
        .fm-btn { min-height:44px; min-width:44px; padding:8px 16px; border-radius:8px; border:1px solid var(--border);
          background:var(--card); color:var(--foreground); font-size:14px; font-weight:700; cursor:pointer; }
        .fm-btn--ghost { background:transparent; }
        .fm-btn--muted { color:var(--muted-foreground); }
        .fm-btn:focus-visible, .fm-list button:focus-visible {
          outline:4px solid var(--foreground); outline-offset:2px; box-shadow:0 0 0 2px #ffd43d; }
        .fm-list { margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; }
        .fm-list button { min-height:44px; padding:6px 14px; border-radius:999px; border:1px solid var(--border);
          background:var(--card); color:var(--foreground); font-size:12px; font-weight:400; cursor:pointer; }
        .fm-list button[aria-pressed="true"] { font-weight:700; border-color:var(--primary); color:var(--primary); }
        .fm-note { margin-top:10px; font-size:12px; font-weight:400; color:var(--muted-foreground); }
        .fm-empty { margin-top:10px; padding:16px; border:1px dashed var(--border); border-radius:12px;
          color:var(--muted-foreground); }
        .fm-empty strong { display:block; margin-bottom:4px; color:var(--foreground); font-weight:700; }
        .fm-cinema .visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        @media (prefers-reduced-motion: no-preference) {
          .fm-list button, .fm-btn { transition: border-color 120ms ease, color 120ms ease; }
        }
      `}</style>
      <div className="fm-head">
        <div>
          <span className="fm-eyebrow">MATCH HIGHLIGHTS</span>
          <h2 className="fm-title">ピッチの瞬間</h2>
        </div>
        <span className="fm-pill">{event ? `${index + 1} / ${items.length}` : 'KICK OFF'}</span>
      </div>
      {event && sequence ? (
        <>
          <div className="fm-screen" ref={screenRef}>
            <PitchView
              frame={frame}
              ariaLabel={sequence.ariaLabel}
              arrow={reduced ? { from: sequence.shotFrom, to: sequence.shotTo } : null}
            />
          </div>
          <p className="fm-caption">
            <span>{event.minute}′</span>
            <strong>{sequence.commentary}</strong>
          </p>
          <div aria-live="polite" className="visually-hidden">
            {sequence.commentary}
          </div>
          <div className="fm-controls">
            {!reduced && (
              <button className="fm-btn" onClick={() => setPlaying((v) => !v)}>
                {playing ? '一時停止' : '再生'}
              </button>
            )}
            <button
              className="fm-btn"
              onClick={() => {
                restart(index);
                setPlaying(true);
              }}
            >
              リプレイ
            </button>
            <button
              className={`fm-btn${atLastScene ? ' fm-btn--muted' : ''}`}
              aria-disabled={atLastScene}
              title={atLastScene ? 'これが最後の場面です。' : undefined}
              onClick={() => {
                if (atLastScene) return;
                restart(index + 1);
                setPlaying(true);
              }}
            >
              次の場面
            </button>
            <button
              className="fm-btn fm-btn--ghost"
              onClick={() => {
                elapsed.current = durationFor(event) / speed;
                setProgress(1);
                setPlaying(false);
              }}
            >
              演出をスキップ
            </button>
            {!reduced && (
              <button
                className="fm-btn fm-btn--ghost"
                onClick={() => setSpeed((v) => (v === 1 ? 2 : 1))}
              >
                {speed === 1 ? '1倍速' : '2倍速'}
              </button>
            )}
          </div>
          <div className="fm-list">
            {items.map((h, i) => (
              <button
                key={h.id}
                aria-pressed={index === i}
                onClick={() => {
                  restart(i);
                  setPlaying(true);
                }}
              >
                {h.minute}′ {listLabel(h)}
              </button>
            ))}
          </div>
          <p className="fm-note">
            {reduced
              ? '端末の「動きを減らす」設定に合わせて、矢印つきの静止図を表示しています。'
              : '実際の得点・セーブをもとにした、点で動く戦術図です。'}{' '}
            リプレイでスコアや成長は重複しません。
          </p>
        </>
      ) : (
        <div className="fm-empty">
          <strong>
            {s.match!.minute ? '中盤での攻防が続く。' : 'キックオフの笛を待つ。'}
          </strong>
          <p>15分を進めると、シュート・ゴール・GKの好守がここに図で映ります。</p>
        </div>
      )}
    </section>
  );
}
