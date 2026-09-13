'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { State } from '@/lib/game';
import type { Highlight } from '@/lib/development';
function title(h: Highlight) {
  return h.kind === 'goal'
    ? h.side === 0
      ? `${h.name}、ゴール！`
      : `${h.name}に得点を許す`
    : h.kind === 'save'
      ? `${h.name}、シュートを止めた！`
      : '惜しくもゴールを外れる';
}
export default function MatchCinema({ s }: { s: State }) {
  const items = s.match!.details.highlights,
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(true),
    [replay, setReplay] = useState(0),
    [reduced] = [useSyncExternalStore(subscribeMotion, motionSnapshot, () => false)];
  const canvas = useRef<HTMLCanvasElement>(null),
    elapsed = useRef(0),
    event = items[index];
  useEffect(() => {
    elapsed.current = 0;
  }, [index, replay]);
  useEffect(() => {
    if (!event || !canvas.current) return;
    const el = canvas.current,
      ctx = el.getContext('2d');
    if (!ctx) return;
    const portrait = new Image();
    portrait.src = '/character-atlas.png';
    const extra = new Image();
    extra.src = '/character-extra.png';
    const duration = 4600;
    let raf = 0,
      last = 0,
      finished = false;
    const draw = (now: number) => {
      if (last && playing && !reduced)
        elapsed.current += Math.min(50, now - last);
      last = now;
      const t = reduced ? 1 : Math.min(1, elapsed.current / duration);
      paint(ctx, event, s, t, portrait, extra);
      if (t >= 1 && playing && !reduced && !finished) {
        finished = true;
        if (index < items.length - 1) {
          setIndex((i) => i + 1);
          elapsed.current = 0;
        } else setPlaying(false);
        return;
      }
      if (playing && !reduced) raf = requestAnimationFrame(draw);
    };
    portrait.onload = () => {
      if (!playing || reduced) draw(performance.now());
    };
    extra.onload = () => {
      if (!playing || reduced) draw(performance.now());
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      portrait.onload = null;
      extra.onload = null;
    };
  }, [event, index, items.length, playing, replay, reduced, s]);
  return (
    <section className="cinema panel" id="match-movie">
      <div className="section-head">
        <div>
          <span className="eyebrow">MATCH HIGHLIGHTS</span>
          <h2>ピッチの瞬間</h2>
        </div>
        <span className="pill">
          {event ? `${index + 1} / ${items.length}` : 'KICK OFF'}
        </span>
      </div>
      {event ? (
        <>
          <div className="cinema-screen">
            <canvas
              ref={canvas}
              width={960}
              height={480}
              role="img"
              aria-label={`${event.minute}分 ${title(event)}`}
            />
            <div
              className={`cinema-caption ${event.kind === 'goal' && event.side === 0 ? 'celebrate' : ''}`}
            >
              <span>{event.minute}′</span>
              <strong>{title(event)}</strong>
            </div>
          </div>
          <div className="cinema-controls">
            <button
              className="secondary"
              onClick={() => setPlaying((v) => !v)}
              disabled={reduced}
            >
              {playing ? '一時停止' : '再生'}
            </button>
            <button
              className="secondary"
              onClick={() => {
                elapsed.current = 0;
                setReplay((v) => v + 1);
                setPlaying(true);
              }}
            >
              リプレイ
            </button>
            <button
              className="secondary"
              disabled={index >= items.length - 1}
              onClick={() => {
                elapsed.current = 0;
                setIndex((i) => i + 1);
                setPlaying(true);
              }}
            >
              次の場面
            </button>
            <button
              className="text-link"
              onClick={() => {
                elapsed.current = durationEnd();
                setPlaying(false);
              }}
            >
              演出をスキップ
            </button>
          </div>
          <div className="highlight-list">
            {items.map((h, i) => (
              <button
                key={h.id}
                aria-pressed={index === i}
                onClick={() => {
                  elapsed.current = 0;
                  setIndex(i);
                  setReplay((v) => v + 1);
                  setPlaying(true);
                }}
              >
                {h.minute}′{' '}
                {h.kind === 'goal'
                  ? h.side === 0
                    ? 'ゴール'
                    : '失点'
                  : 'セーブ'}
              </button>
            ))}
          </div>
          <p className="muted">
            {reduced
              ? '端末の「動きを減らす」設定に合わせて静止画を表示しています。'
              : '実際の得点・セーブをもとにした2Dアニメーション。'}{' '}
            リプレイでスコアや成長は重複しません。
          </p>
        </>
      ) : (
        <div className="cinema-empty">
          <strong>
            {s.match!.minute
              ? '中盤での攻防が続く。'
              : 'キックオフの笛を待つ。'}
          </strong>
          <p>15分を進めると、シュート・ゴール・GKの好守がここに映ります。</p>
        </div>
      )}
    </section>
  );
}
function subscribeMotion(notify:()=>void){const mq=matchMedia('(prefers-reduced-motion: reduce)');mq.addEventListener('change',notify);return()=>mq.removeEventListener('change',notify);}
function motionSnapshot(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
function durationEnd() {
  return 4600;
}
function paint(
  c: CanvasRenderingContext2D,
  h: Highlight,
  s: State,
  t: number,
  atlas: HTMLImageElement,
  extra: HTMLImageElement,
) {
  const W = 960,
    H = 480;
  c.clearRect(0, 0, W, H);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#18343c');
  sky.addColorStop(0.38, '#406354');
  sky.addColorStop(1, '#508550');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#1b2a39';
  c.fillRect(0, 50, W, 125);
  for (let r = 0; r < 5; r++)
    for (let i = 0; i < 60; i++) {
      c.fillStyle = ['#7997a0', '#aec181', '#d0baa0', '#4d6d7c'][
        (i * 7 + r) % 4
      ];
      c.beginPath();
      c.arc(i * 17 + (r % 2) * 8, 65 + r * 19, 4, 0, Math.PI * 2);
      c.fill();
    }
  c.fillStyle = '#263e40';
  c.fillRect(0, 157, W, 25);
  c.fillStyle = '#daebd2';
  c.font = 'bold 20px Arial';
  c.fillText('TOUCHLINE ACADEMY', 30, 177);
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? '#416f43' : '#477949';
    c.beginPath();
    c.moveTo(i * 160 - 150, 480);
    c.lineTo(i * 100 + 100, 183);
    c.lineTo(i * 100 + 200, 183);
    c.lineTo(i * 160 + 10, 480);
    c.fill();
  }
  c.strokeStyle = '#d7edc49c';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(5, 454);
  c.lineTo(880, 454);
  c.lineTo(852, 191);
  c.moveTo(480, 450);
  c.lineTo(501, 243);
  c.lineTo(900, 243);
  c.stroke();
  const gx = 660,
    gy = 130,
    gw = 230,
    gh = 169;
  c.fillStyle = '#152c3355';
  c.fillRect(gx, gy, gw, gh);
  c.strokeStyle = '#dae8e4aa';
  c.lineWidth = 1;
  for (let i = 0; i <= 12; i++) {
    c.beginPath();
    c.moveTo(gx + (i * gw) / 12, gy);
    c.lineTo(gx + (i * gw) / 12, gy + gh);
    c.stroke();
  }
  for (let j = 0; j <= 8; j++) {
    c.beginPath();
    c.moveTo(gx, gy + (j * gh) / 8);
    c.lineTo(gx + gw, gy + (j * gh) / 8);
    c.stroke();
  }
  c.strokeStyle = '#f4f6e9';
  c.lineWidth = 7;
  c.strokeRect(gx, gy, gw, gh);
  const kick = 0.4,
    hit = 0.78,
    k = Math.max(0, Math.min(1, (t - kick) / (hit - kick))),
    run = Math.min(1, t / kick),
    score = h.kind === 'goal',
    home = h.side === 0;
  const attacker = s.players.find((p) => p.id === h.playerId) || s.players[0];
  const gk = s.players.find((p) => p.id === s.lineup[0])!;
  const ax =
      (h.lane === 'wide' ? 145 : 230) + run * (h.lane === 'wide' ? 265 : 180),
    ay = (h.lane === 'wide' ? 410 : 370) - run * (h.lane === 'wide' ? 75 : 35);
  const dx = score ? 90 : 60,
    dy = score ? -8 : -35;
  const dive = Math.max(0, Math.min(1, (t - 0.51) / 0.26));
  function person(
    x: number,
    y: number,
    scale: number,
    face: number,
    color: string,
    phase: number,
    angle = 0,
  ) {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.scale(scale, scale);
    c.fillStyle = '#13232566';
    c.beginPath();
    c.ellipse(0, 12, 28, 8, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#182438';
    c.lineWidth = 12;
    c.lineCap = 'round';
    const leg = Math.sin(phase) * 15;
    c.beginPath();
    c.moveTo(-9, -14);
    c.lineTo(-13 + leg, 18);
    c.moveTo(9, -14);
    c.lineTo(13 - leg, 18);
    c.stroke();
    c.fillStyle = '#ede9d5';
    c.fillRect(-17 + leg, 13, 15, 7);
    c.fillRect(9 - leg, 13, 15, 7);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(-19, -65);
    c.lineTo(19, -65);
    c.lineTo(22, -18);
    c.lineTo(-22, -18);
    c.closePath();
    c.fill();
    c.strokeStyle = '#e7ba97';
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(-18, -58);
    c.lineTo(-34, -29 - leg);
    c.moveTo(18, -58);
    c.lineTo(34, -34 + leg);
    c.stroke();
    c.save();
    c.beginPath();
    c.arc(0, -86, 25, 0, Math.PI * 2);
    c.clip();
    const ex = face >= 12,
      img = ex ? extra : atlas,
      cols = ex ? 3 : 4,
      rows = ex ? 2 : 4,
      idx = ex ? face - 12 : face;
    if (img.complete && img.naturalWidth) {
      const sw = img.naturalWidth / cols,
        sh = img.naturalHeight / rows;
      c.drawImage(
        img,
        (idx % cols) * sw,
        Math.floor(idx / cols) * sh,
        sw,
        sh,
        -34,
        -117,
        68,
        75,
      );
    } else {
      c.fillStyle = '#edc4a0';
      c.fillRect(-25, -111, 50, 50);
    }
    c.restore();
    c.restore();
  }
  person(540, 325, 0.8, 2, home ? '#edaf98' : '#c6f16a', t * 19);
  person(585, 300, 0.73, 5, home ? '#edaf98' : '#c6f16a', t * 20);
  person(320, 355, 0.8, 6, home ? '#c6f16a' : '#edaf98', t * 18);
  person(
    772 + dx * dive,
    285 + dy * dive,
    0.92,
    home ? 3 : gk.identity.portrait,
    '#e7b543',
    0,
    -dive * 0.9,
  );
  person(
    ax,
    ay,
    1.15,
    home ? attacker.identity.portrait : 10,
    home ? '#c6f16a' : '#edaf98',
    t < kick ? t * 29 : score && t > 0.82 ? 8 : 0,
  );
  const bx = t < kick ? ax + 30 : 440 + k * (score ? 400 : 386),
    by =
      t < kick
        ? ay + 13
        : 348 + (score ? -125 : -112) * k - Math.sin(k * Math.PI) * 67;
  c.fillStyle = '#0b231a66';
  c.beginPath();
  c.ellipse(bx, Math.max(by + 25, 300), 12, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(bx, by);
  c.rotate(k * 12);
  c.fillStyle = '#fffef1';
  c.beginPath();
  c.arc(0, 0, 9, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1b2630';
  c.fillRect(-3, -3, 6, 6);
  c.restore();
  if (t > hit) {
    c.fillStyle = score ? (home ? '#d5ff89' : '#ffe0d4') : '#dcf3ff';
    c.font = 'italic 900 61px Arial';
    c.textAlign = 'center';
    c.shadowColor = '#10231b';
    c.shadowBlur = 15;
    c.fillText(
      score ? (home ? 'GOAL!' : 'GOAL AGAINST') : 'SUPER SAVE!',
      W / 2,
      95,
    );
    c.shadowBlur = 0;
    c.textAlign = 'start';
    if (score && home) {
      for (let i = 0; i < 22; i++) {
        c.fillStyle = i % 2 ? '#dfff97' : '#e0f3ff';
        const x = (i * 137) % W,
          y = 100 + ((i * 49 + (t - hit) * 600) % 190);
        c.fillRect(x, y, 6, 11);
      }
    }
  }
  c.fillStyle = '#091a23bb';
  c.fillRect(18, 18, 130, 31);
  c.fillStyle = '#e6f6d8';
  c.font = 'bold 16px Arial';
  c.fillText(`${h.minute}'   REPLAY`, 30, 39);
}
