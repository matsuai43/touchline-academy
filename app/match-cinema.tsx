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
function durationFor(h: Highlight) {
  return h.kind === 'goal' ? 5400 : h.kind === 'save' ? 4700 : 4200;
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
    const duration = durationFor(event);
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
                elapsed.current = durationFor(event);
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
function subscribeMotion(notify: () => void) {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', notify);
  return () => mq.removeEventListener('change', notify);
}
function motionSnapshot() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// ---- small deterministic math helpers (no Math.random / Date.now) ----
function hash(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}
function ease(t: number) {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}
function easeOut(t: number) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}
// ---- articulated player figure ----
type Joint = { a: number; b: number };
type PlayerPose = {
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  shirt: string;
  trim: string;
  number: number;
  face: number;
  legL: Joint;
  legR: Joint;
  armL: Joint;
  armR: Joint;
  tilt: number;
  airborne: number;
};
function stride(phase: number): Joint {
  const a = Math.sin(phase) * 0.72;
  const b = Math.max(0.12, 0.35 + 0.55 * Math.sin(phase - 1.15)) * 1.25;
  return { a, b };
}
function swing(phase: number): Joint {
  const a = Math.sin(phase) * 0.55;
  const b = Math.max(0.1, 0.35 + 0.4 * Math.sin(phase + 1.1));
  return { a, b };
}
function jointEnd(
  baseX: number,
  baseY: number,
  len1: number,
  len2: number,
  j: Joint,
  facing: number,
) {
  const kx = baseX + Math.sin(j.a) * len1 * facing,
    ky = baseY + Math.cos(j.a) * len1,
    fx = kx + Math.sin(j.a + j.b) * len2 * facing,
    fy = ky + Math.cos(j.a + j.b) * len2;
  return { kx, ky, fx, fy };
}
function drawPlayer(
  c: CanvasRenderingContext2D,
  p: PlayerPose,
  atlas: HTMLImageElement,
  extra: HTMLImageElement,
) {
  const shrink = Math.max(0.45, 1 - p.airborne / 70);
  c.save();
  c.translate(p.x, p.y);
  c.scale(p.scale, p.scale);
  c.fillStyle = 'rgba(8,20,16,0.38)';
  c.beginPath();
  c.ellipse(0, 13, 26 * shrink, 7.5 * shrink, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.save();
  c.translate(p.x, p.y - p.airborne);
  c.rotate(p.tilt);
  c.scale(p.scale, p.scale);
  c.strokeStyle = '#1c2a3a';
  c.lineWidth = 6.5;
  c.lineCap = 'round';
  const legL = jointEnd(-8, -14, 16, 17, p.legL, p.facing),
    legR = jointEnd(8, -14, 16, 17, p.legR, p.facing);
  c.beginPath();
  c.moveTo(-8, -14);
  c.lineTo(legL.kx, legL.ky);
  c.lineTo(legL.fx, legL.fy);
  c.moveTo(8, -14);
  c.lineTo(legR.kx, legR.ky);
  c.lineTo(legR.fx, legR.fy);
  c.stroke();
  c.fillStyle = '#f4f1e4';
  c.beginPath();
  c.ellipse(legL.fx, legL.fy + 2, 8, 4, 0, 0, Math.PI * 2);
  c.ellipse(legR.fx, legR.fy + 2, 8, 4, 0, 0, Math.PI * 2);
  c.fill();
  const armL = jointEnd(-17, -58, 14, 14, p.armL, p.facing),
    armR = jointEnd(17, -58, 14, 14, p.armR, p.facing);
  c.strokeStyle = '#e7ba97';
  c.lineWidth = 8;
  c.beginPath();
  c.moveTo(-17, -58);
  c.lineTo(armL.kx, armL.ky);
  c.lineTo(armL.fx, armL.fy);
  c.moveTo(17, -58);
  c.lineTo(armR.kx, armR.ky);
  c.lineTo(armR.fx, armR.fy);
  c.stroke();
  c.fillStyle = p.shirt;
  c.beginPath();
  c.moveTo(-19, -65);
  c.lineTo(19, -65);
  c.lineTo(22, -18);
  c.lineTo(-22, -18);
  c.closePath();
  c.fill();
  c.strokeStyle = p.trim;
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.14)';
  c.beginPath();
  c.moveTo(-19, -65);
  c.lineTo(19, -65);
  c.lineTo(10, -50);
  c.lineTo(-10, -50);
  c.closePath();
  c.fill();
  c.fillStyle = p.trim;
  c.font = 'bold 11px Arial';
  c.textAlign = 'center';
  c.fillText(String(p.number), 0, -35);
  c.textAlign = 'start';
  c.save();
  c.beginPath();
  c.arc(0, -86, 25, 0, Math.PI * 2);
  c.clip();
  const ex = p.face >= 12,
    img = ex ? extra : atlas,
    cols = ex ? 3 : 4,
    rows = ex ? 2 : 4,
    idx = ex ? p.face - 12 : p.face;
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
function numberFor(id: number) {
  return ((id * 17) % 33) + 1;
}
function burst(
  c: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  local: number,
  seed: number,
  n: number,
  color: string,
) {
  if (local <= 0 || local >= 1) return;
  for (let i = 0; i < n; i++) {
    const angle = hash(seed + i) * Math.PI * 2,
      speed = 16 + hash(seed + i + 50) * 20,
      dist = speed * local,
      x = ox + Math.cos(angle) * dist,
      y = oy + Math.sin(angle) * dist * 0.45 - local * 20 + local * local * 34;
    c.globalAlpha = Math.max(0, 1 - local);
    c.fillStyle = color;
    c.fillRect(x - 2, y - 1, 4, 2);
  }
  c.globalAlpha = 1;
}
const W = 960,
  H = 480;
function paint(
  c: CanvasRenderingContext2D,
  h: Highlight,
  s: State,
  t: number,
  atlas: HTMLImageElement,
  extra: HTMLImageElement,
) {
  // ---- timeline ----
  const kickoffT = 0.34,
    strikeT = 0.5,
    impactT = h.kind === 'goal' ? 0.8 : h.kind === 'save' ? 0.78 : 0.74;
  const score = h.kind === 'goal',
    saved = h.kind === 'save',
    home = h.side === 0,
    lane = h.lane === 'wide';
  const attacker = s.players.find((p) => p.id === h.playerId) || s.players[0];
  const gk = s.players.find((p) => p.id === s.lineup[0])!;
  const seed = h.minute * 31 + h.playerId + (score ? 11 : saved ? 5 : 1);
  const runT = clamp01(t / kickoffT),
    windT = clamp01((t - kickoffT) / (strikeT - kickoffT)),
    k = clamp01((t - strikeT) / (impactT - strikeT)),
    post = clamp01((t - impactT) / (1 - impactT));
  // ---- attacker run-up position ----
  const startX = lane ? 145 : 230,
    spanX = lane ? 265 : 180,
    startY = lane ? 410 : 370,
    spanY = lane ? 75 : 35;
  const ax = startX + ease(runT) * spanX,
    ay = startY - ease(runT) * spanY;
  // ---- ball trajectory ----
  const shot = { x: ax + 24, y: ay + 6 };
  let target: { x: number; y: number }, arc: number, curve: number;
  if (score) {
    target = { x: 848, y: lane ? 170 : 224 };
    arc = 96;
    curve = lane ? 44 : 20;
  } else if (saved) {
    target = { x: 764, y: 236 };
    arc = 78;
    curve = lane ? 32 : 12;
  } else {
    target = { x: 902, y: 94 };
    arc = 148;
    curve = lane ? 66 : -38;
  }
  function ballAt(kk: number) {
    return {
      x: shot.x + (target.x - shot.x) * kk + Math.sin(kk * Math.PI) * curve,
      y: shot.y + (target.y - shot.y) * kk - Math.sin(kk * Math.PI) * arc,
    };
  }
  let bx: number, by: number;
  if (t < strikeT) {
    bx = ax + 22;
    by = ay + 12;
  } else if (t < impactT) {
    const p = ballAt(k);
    bx = p.x;
    by = p.y;
  } else if (saved) {
    bx = target.x + post * 66;
    by = target.y - post * 36;
  } else if (score) {
    bx = target.x + Math.sin(post * 9) * 4 * (1 - post);
    by = target.y + post * 8;
  } else {
    bx = target.x + post * 26;
    by = target.y - post * 10;
  }
  // ---- goalkeeper dive ----
  const diveWindow = clamp01((t - (strikeT - 0.04)) / (impactT - strikeT + 0.06));
  const diveIntensity = saved ? 1 : score ? 0.55 : 0.18;
  const diveDX = (lane ? 96 : 66) * diveIntensity,
    diveDY = -28 * diveIntensity;
  const gkX = 772 + diveDX * diveWindow,
    gkY = 285 + diveDY * diveWindow,
    gkTilt = -diveWindow * 0.95 * diveIntensity;
  const gkPose: PlayerPose = {
    x: gkX,
    y: gkY,
    scale: 0.92,
    facing: 1,
    shirt: '#e7b543',
    trim: '#4a3402',
    number: 1,
    face: home ? 3 : gk.identity.portrait,
    legL: { a: diveWindow * 1.0 * diveIntensity, b: 0.3 },
    legR: { a: -diveWindow * 0.5 * diveIntensity, b: 0.35 },
    armL: { a: 1.3 * diveWindow * diveIntensity + 0.2, b: 0.15 },
    armR: { a: -0.3, b: 0.4 },
    tilt: gkTilt,
    airborne: 0,
  };
  // ---- attacker pose ----
  const runPhase = t * 24;
  let legL: Joint, legR: Joint, armL: Joint, armR: Joint, airborne = 0, tilt = 0;
  if (lane) {
    const jumpT = clamp01((t - (kickoffT - 0.06)) / (strikeT - kickoffT + 0.14));
    airborne = Math.sin(clamp01(jumpT) * Math.PI) * 34 * (t < strikeT + 0.1 ? 1 : Math.max(0, 1 - (t - strikeT - 0.1) * 4));
    legL = { a: 0.5, b: 0.9 };
    legR = { a: -0.35, b: 0.6 };
    armL = { a: -0.6, b: 0.3 };
    armR = { a: 0.7, b: 0.3 };
    tilt = -0.16 + jumpT * 0.05;
  } else if (t < kickoffT) {
    legL = stride(runPhase + Math.PI);
    legR = stride(runPhase);
    armL = swing(runPhase);
    armR = swing(runPhase + Math.PI);
  } else if (t < strikeT) {
    const bt = ease(windT);
    legR = { a: lerp(-0.85, 1.25, bt), b: lerp(1.05, 0.12, bt) };
    legL = { a: 0.1, b: 0.55 };
    armR = { a: lerp(0.3, -0.5, bt), b: 0.35 };
    armL = { a: lerp(-0.3, 0.6, bt), b: 0.35 };
  } else {
    const ft = clamp01((t - strikeT) / 0.3);
    legR = { a: lerp(1.25, 0.35, ease(ft)), b: lerp(0.12, 0.5, ease(ft)) };
    legL = { a: 0.1, b: 0.5 };
    armR = { a: lerp(-0.5, 0.15, ease(ft)), b: 0.35 };
    armL = { a: lerp(0.6, 0.1, ease(ft)), b: 0.35 };
  }
  const attackerPose: PlayerPose = {
    x: ax,
    y: ay,
    scale: 1.15,
    facing: 1,
    shirt: home ? '#c6f16a' : '#edaf98',
    trim: home ? '#25401b' : '#5c2f1a',
    number: numberFor(h.playerId),
    face: home ? attacker.identity.portrait : 10,
    legL,
    legR,
    armL,
    armR,
    tilt,
    airborne,
  };
  // ---- background/support figures ----
  const support: PlayerPose[] = [
    {
      x: 540 + ease(t) * 16,
      y: 325,
      scale: 0.8,
      facing: 1,
      shirt: home ? '#edaf98' : '#c6f16a',
      trim: home ? '#5c2f1a' : '#25401b',
      number: numberFor(h.playerId + 3),
      face: 2,
      legL: stride(t * 19 + Math.PI),
      legR: stride(t * 19),
      armL: swing(t * 19),
      armR: swing(t * 19 + Math.PI),
      tilt: 0,
      airborne: 0,
    },
    {
      x: 585 + ease(t) * 14,
      y: 300,
      scale: 0.73,
      facing: 1,
      shirt: home ? '#edaf98' : '#c6f16a',
      trim: home ? '#5c2f1a' : '#25401b',
      number: numberFor(h.playerId + 7),
      face: 5,
      legL: stride(t * 20 + 1.4 + Math.PI),
      legR: stride(t * 20 + 1.4),
      armL: swing(t * 20 + 1.4),
      armR: swing(t * 20 + 1.4 + Math.PI),
      tilt: 0,
      airborne: 0,
    },
    {
      x: 320 - ease(t) * 12,
      y: 355,
      scale: 0.8,
      facing: -1,
      shirt: home ? '#c6f16a' : '#edaf98',
      trim: home ? '#25401b' : '#5c2f1a',
      number: numberFor(h.playerId + 11),
      face: 6,
      legL: stride(t * 18 + Math.PI),
      legR: stride(t * 18),
      armL: swing(t * 18),
      armR: swing(t * 18 + Math.PI),
      tilt: 0,
      airborne: 0,
    },
  ];
  // ---- camera: pan toward the ball, punch in on the goal moment ----
  let zoom = 1,
    cx = 480,
    cy = 250;
  if (t < kickoffT) {
    const p = t / kickoffT;
    zoom = lerp(1, 1.05, p);
    cx = lerp(480, ax, p * 0.6);
    cy = lerp(250, ay - 40, p * 0.6);
  } else if (t < strikeT) {
    const p = (t - kickoffT) / (strikeT - kickoffT);
    zoom = lerp(1.05, 1.16, p);
    cx = lerp(lerp(480, ax, 0.6), ax, p);
    cy = lerp(lerp(250, ay - 40, 0.6), ay - 30, p);
  } else if (t < impactT) {
    const p = (t - strikeT) / (impactT - strikeT),
      peak = score ? 1.32 : saved ? 1.22 : 1.08;
    zoom = lerp(1.16, peak, ease(p));
    cx = lerp(ax, bx, p);
    cy = lerp(ay - 30, by, p);
  } else if (score) {
    const punch = clamp01(post / 0.22),
      release = clamp01((post - 0.22) / 0.78);
    zoom = lerp(lerp(1.32, 1.48, ease(punch)), 1.12, ease(release));
    cx = lerp(bx, 430, ease(release));
    cy = lerp(by, 300, ease(release));
  } else if (saved) {
    zoom = lerp(1.22, 1.1, ease(post));
    cx = lerp(bx, 620, ease(post));
    cy = lerp(by, 290, ease(post));
  } else {
    zoom = lerp(1.08, 1, ease(post));
    cx = lerp(bx, 480, ease(post));
    cy = lerp(by, 260, ease(post));
  }
  const vw = W / zoom,
    vh = H / zoom;
  cx = Math.min(W - vw / 2, Math.max(vw / 2, cx));
  cy = Math.min(H - vh / 2, Math.max(vh / 2, cy));
  // ================= draw =================
  c.clearRect(0, 0, W, H);
  c.save();
  c.translate(W / 2, H / 2);
  c.scale(zoom, zoom);
  c.translate(-cx, -cy);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#18343c');
  sky.addColorStop(0.38, '#406354');
  sky.addColorStop(1, '#508550');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  // floodlight glow
  const glowL = c.createRadialGradient(90, 30, 4, 90, 30, 230);
  glowL.addColorStop(0, 'rgba(255,250,214,0.32)');
  glowL.addColorStop(1, 'rgba(255,250,214,0)');
  c.fillStyle = glowL;
  c.fillRect(-50, -60, 380, 300);
  const glowR = c.createRadialGradient(870, 30, 4, 870, 30, 230);
  glowR.addColorStop(0, 'rgba(255,250,214,0.32)');
  glowR.addColorStop(1, 'rgba(255,250,214,0)');
  c.fillStyle = glowR;
  c.fillRect(630, -60, 380, 300);
  c.fillStyle = '#1b2a39';
  c.fillRect(0, 50, W, 125);
  const cheer = score ? clamp01(post * 2.2) : saved ? clamp01(post * 1.1) * 0.4 : 0;
  for (let r = 0; r < 5; r++)
    for (let i = 0; i < 58; i++) {
      const bounce = cheer * (0.5 + 0.5 * Math.sin(i * 1.7 + r + t * 18)) * 6;
      c.fillStyle = ['#7997a0', '#aec181', '#d0baa0', '#4d6d7c'][(i * 7 + r) % 4];
      c.beginPath();
      c.arc(i * 17 + (r % 2) * 8, 65 + r * 19 - bounce, 4, 0, Math.PI * 2);
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
  // goal frame + net with impact ripple
  const gx = 660,
    gy = 130,
    gw = 230,
    gh = 169;
  c.fillStyle = '#152c3355';
  c.fillRect(gx, gy, gw, gh);
  c.strokeStyle = '#dae8e4aa';
  c.lineWidth = 1;
  const ripple =
    score && t > impactT
      ? Math.sin((t - impactT) * 46) * 5.5 * Math.exp(-(t - impactT) * 5.5)
      : 0;
  for (let i = 0; i <= 12; i++) {
    const bulge = ripple * Math.sin((i / 12) * Math.PI);
    c.beginPath();
    c.moveTo(gx + (i * gw) / 12 + bulge, gy);
    c.lineTo(gx + (i * gw) / 12 + bulge * 0.6, gy + gh);
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
  // support cast, then the featured pair, on top
  for (const pose of support) drawPlayer(c, pose, atlas, extra);
  drawPlayer(c, gkPose, atlas, extra);
  drawPlayer(c, attackerPose, atlas, extra);
  // grass burst at the strike foot, dust on a keeper dive
  burst(c, ax + 18, ay + 8, clamp01((t - strikeT) / 0.35), seed, 9, '#8fae4e');
  if (saved || score)
    burst(c, gkX, gkY + 18, clamp01((t - impactT) / 0.3), seed + 7, 7, '#cfead0');
  // ball with motion trail and spin
  for (let trail = 1; trail <= 3; trail++) {
    const tk = k - trail * 0.055;
    if (t >= strikeT && t < impactT && tk > 0) {
      const tp = ballAt(tk);
      c.globalAlpha = 0.22 - trail * 0.06;
      c.fillStyle = '#fffef1';
      c.beginPath();
      c.arc(tp.x, tp.y, 8 - trail, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }
  c.fillStyle = '#0b231a66';
  c.beginPath();
  c.ellipse(bx, Math.max(by + 25, 300), 12, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(bx, by);
  c.rotate(t * 30);
  c.fillStyle = '#fffef1';
  c.beginPath();
  c.arc(0, 0, 9, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1b2630';
  c.fillRect(-3, -3, 6, 6);
  c.restore();
  c.restore();
  // ---- screen-space overlay (unaffected by camera zoom) ----
  if (score) {
    const p = clamp01(post / 0.5),
      barP = p < 0.5 ? p * 2 : (1 - p) * 2,
      barH = 46 * Math.max(0, barP);
    if (barH > 0.5) {
      c.fillStyle = '#0c1a12ee';
      c.fillRect(0, 0, W, barH);
      c.fillRect(0, H - barH, W, barH);
    }
  }
  if (t > impactT) {
    const flashT = clamp01((t - impactT) / 0.18),
      flashAlpha = (1 - flashT) * (score ? 0.55 : saved ? 0.3 : 0.15);
    if (flashAlpha > 0.01) {
      c.fillStyle = `rgba(255,255,255,${flashAlpha})`;
      c.fillRect(0, 0, W, H);
    }
    const p = clamp01(post / 0.3),
      ty = lerp(-40, 95, easeOut(p));
    c.fillStyle = score ? (home ? '#d5ff89' : '#ffe0d4') : saved ? '#dcf3ff' : '#f4e2b8';
    c.font = 'italic 900 61px Arial';
    c.textAlign = 'center';
    c.shadowColor = '#10231b';
    c.shadowBlur = 14;
    c.fillText(
      score ? (home ? 'GOAL!' : 'GOAL AGAINST') : saved ? 'SUPER SAVE!' : 'SO CLOSE!',
      W / 2,
      ty,
    );
    c.shadowBlur = 0;
    c.textAlign = 'start';
    if (score && home) {
      for (let i = 0; i < 22; i++) {
        c.fillStyle = i % 2 ? '#dfff97' : '#e0f3ff';
        const x = (i * 137) % W,
          y = 100 + ((i * 49 + post * 600) % 190);
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
