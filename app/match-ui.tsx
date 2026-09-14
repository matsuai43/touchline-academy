'use client';
// W4: 試合UIの刷新と試合後サマリ。
// app/game-ui.tsx から試合画面（旧 MatchView）をここへ切り出し、次を追加する。
//  - 交代を「下げる選手→入れる選手→確認」の明示的な2ステップに作り直す（SubstitutionDialog）。
//  - 試合終了後、部に戻る前に試合後サマリ（MOTM・タイムライン・成長差分）を挟む（MatchSummary）。
// Pitch / Choices / Meter / Metric は試合以外のタブ（クラブ・編成）からも使われる小さな部品なので、
// ここにまとめて置き、app/game-ui.tsx からインポートして使う。
import { useState } from 'react';
import { Portrait } from './development-ui';
import { MatchCommands, VoicePanel } from './development-ui';
import MatchCinema from './match-cinema';
import { playSfx } from '@/lib/audio';
import {
  detailInfo,
  formationSlots,
  extraStatNames,
  SKILLS,
  type ExtraStat,
} from '@/lib/squad';
import {
  overall,
  roster,
  slots,
  clamp,
  tactics,
  stats,
  type State,
  type Action,
  type Player,
  type Stat,
  type Tactic,
} from '@/lib/game';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  ArrowRight,
  ArrowRightLeft,
  Award,
  Flag,
  Shield,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// 小さな共有部品（クラブ・編成タブからも利用）
// ---------------------------------------------------------------------------
export function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
    </div>
  );
}
export function Meter({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className={`meter ${warn ? 'warning' : ''}`}>
      <div>
        <span>{label}</span>
        <b>{Math.round(value)}</b>
      </div>
      <Progress aria-label={label} value={value} />
    </div>
  );
}
export function Choices({
  value,
  onChange,
  items,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      className="choices"
      value={value}
      onValueChange={(v) => onChange(String(v))}
      aria-label={label}
      disabled={disabled}
    >
      {items.map((i) => (
        <label key={i.value} className={value === i.value ? 'selected' : ''}>
          <RadioGroupItem value={i.value} />
          <span>{i.label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

export function Pitch({
  s,
  onPick,
  live = false,
}: {
  s: State;
  onPick?: (p: Player) => void;
  live?: boolean;
}) {
  const detailSlots = formationSlots(s.formation);
  const positions = slots(s.formation);
  const team = roster(s);
  return (
    <div
      className={`pitch ${live ? 'live' : ''}`}
      aria-label={live ? '試合の戦術図' : 'スターティングイレブンの配置'}
    >
      <svg
        className="pitch-lines"
        viewBox="0 0 440 390"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M22 18H418V372H22ZM22 195H418M130 18V80H310V18M172 18V43H268V18M130 372V310H310V372M172 372V347H268V372" />
        <ellipse cx="220" cy="195" rx="45" ry="40" />
        <circle cx="220" cy="195" r="2" />
      </svg>
      {team.map((p, i) => {
        const pos = positions[i],
          members = positions.filter((x) => x === pos).length,
          order = positions.slice(0, i).filter((x) => x === pos).length,
          x = ((order + 1) / (members + 1)) * 100,
          y = pos === 'GK' ? 86 : pos === 'DF' ? 65 : pos === 'MF' ? 42 : 19;
        const slotDetail = detailSlots[i],
          slotName = detailInfo[slotDetail].name;
        return (
          <button
            className={`pitch-player ${p.pos !== pos ? 'mismatch' : ''} ${p.injury ? 'injured' : ''}`}
            key={p.id}
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onPick?.(p)}
            title={`起用先：${slotName}（${slotDetail}）`}
            aria-label={`${p.name} ${slotName} 総合${overall(p)} 疲労${Math.round(p.fatigue)}`}
          >
            <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
            <span className="number">{i + 1}</span>
            <span className="pitch-name">{p.name.split(' ')[0]}</span>
            <span className="energy">
              <i style={{ width: `${100 - p.fatigue}%` }} />
            </span>
          </button>
        );
      })}
      {live && (
        <span
          className="match-ball"
          key={s.match?.minute}
          style={{
            left: `${28 + (s.seed % 45)}%`,
            top: `${27 + (s.seed % 41)}%`,
          }}
          aria-hidden="true"
        >
          ●
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 選手の「今日の出来」表示専用の決定的なゆらぎ。
// s.seed を消費せず（rand(s)は呼ばない）、表示にのみ使う。ゲーム進行・試合結果には一切影響しない。
// ---------------------------------------------------------------------------
function conditionHash(seed: number, id: number, salt: number) {
  let x = (seed ^ Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function conditionScore(s: State, p: Player): number {
  const minute = s.match?.minute ?? 0;
  const h = conditionHash(s.seed, p.id, minute);
  return clamp(Math.round(62 - p.fatigue * 0.55 + (h - 0.5) * 34), 0, 100);
}
function conditionLabel(score: number): string {
  if (score >= 75) return '絶好調';
  if (score >= 58) return '好調';
  if (score >= 40) return '普通';
  if (score >= 25) return 'やや不調';
  return '不振';
}

// ---------------------------------------------------------------------------
// 交代パネル：下げる選手 → 入れる選手 → 確認、の明示的な2ステップ。
// 途中まで選んでも確定前なら「選び直す」でいつでも取り消せる。
// 現行の「ベンチをタップ」「ピッチの選手をタップ」もこのダイアログを開く入口として残す。
// ---------------------------------------------------------------------------
function SubstitutionDialog({
  s,
  run,
  open,
  onOpenChange,
  initialOutgoing,
  initialIncoming,
}: {
  s: State;
  run: (a: Action) => State | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialOutgoing: number | null;
  initialIncoming: number | null;
}) {
  const m = s.match!;
  // 初期選択は useState の初期値としてだけ受け取る。呼び出し側（MatchView）が
  // openSub() のたびに key を変えてこのコンポーネントを丸ごと再マウントするので、
  // 「開くたびに初期選択を反映する」という要件を effect なしで満たせる。
  const [outgoing, setOutgoing] = useState<number | null>(initialOutgoing);
  const [incoming, setIncoming] = useState<number | null>(initialIncoming);
  const capReached = m.subs >= 3;
  const outPlayer = outgoing != null ? s.players.find((p) => p.id === outgoing) : null;
  const inPlayer = incoming != null ? s.players.find((p) => p.id === incoming) : null;
  const canConfirm = !m.done && !capReached && outgoing != null && incoming != null;
  const confirm = () => {
    if (!canConfirm || outgoing == null || incoming == null) return;
    const idx = s.lineup.indexOf(outgoing);
    if (idx < 0) return;
    if (run({ type: 'swap', index: idx, id: incoming })) {
      playSfx('click');
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="game-dialog sub-dialog">
        <DialogTitle>交代する選手を選ぶ</DialogTitle>
        <DialogDescription>
          下げる選手を選ぶと対象がハイライトされます。続けてベンチから投入する選手を選び、確認して確定してください。
        </DialogDescription>
        <div className="subs-counter-row">
          <span className="subs-counter">交代 {m.subs} / 3</span>
          {capReached && <span className="muted">交代枠を使い切りました。</span>}
        </div>
        <div className="sub-columns">
          <div className="sub-column">
            <h3>ピッチ上の選手</h3>
            <div className="sub-list">
              {roster(s).map((p, i) => {
                const cond = conditionScore(s, p);
                const recommend = cond < 40 || p.fatigue > 72;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`sub-pick ${outgoing === p.id ? 'selected' : ''}`}
                    disabled={m.done || capReached}
                    aria-pressed={outgoing === p.id}
                    onClick={() => {
                      setOutgoing(p.id);
                      if (incoming != null && m.used.includes(incoming)) setIncoming(null);
                    }}
                  >
                    <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
                    <span className="sub-pick-body">
                      <b className="sub-pick-name">{p.name}</b>
                      <span className="sub-pick-meta">
                        {detailInfo[formationSlots(s.formation)[i]].name} ・ 疲労{' '}
                        {Math.round(p.fatigue)} ・ {conditionLabel(cond)}
                      </span>
                    </span>
                    {recommend && <span className="sub-recommend">交代推奨</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sub-column">
            <h3>ベンチ</h3>
            <div className="sub-list">
              {s.players
                .filter((p) => !s.lineup.includes(p.id))
                .map((p) => {
                  const disabled =
                    m.done || m.used.includes(p.id) || capReached || !!p.injury || outgoing == null;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`sub-pick ${incoming === p.id ? 'selected' : ''}`}
                      disabled={disabled}
                      aria-pressed={incoming === p.id}
                      onClick={() => setIncoming(p.id)}
                    >
                      <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
                      <span className="sub-pick-body">
                        <b className="sub-pick-name">{p.name}</b>
                        <span className="sub-pick-meta">
                          {p.pos}{' '}
                          {m.used.includes(p.id)
                            ? '・交代済'
                            : p.injury
                              ? '・調整中'
                              : `・疲労 ${Math.round(p.fatigue)}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
            </div>
            {outgoing == null && (
              <p className="muted sub-hint">
                先に「ピッチ上の選手」から下げる選手を選んでください。
              </p>
            )}
          </div>
        </div>
        {(outPlayer || inPlayer) && (
          <div className="sub-confirm">
            <p>
              <b>{outPlayer?.name ?? '（未選択）'}</b> を下げて{' '}
              <b>{inPlayer?.name ?? '（未選択）'}</b> を投入します。
            </p>
            <div className="sub-confirm-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setOutgoing(null);
                  setIncoming(null);
                }}
              >
                選び直す
              </button>
              <button
                type="button"
                className="primary"
                disabled={!canConfirm}
                onClick={confirm}
              >
                この交代を確定
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 試合後サマリ：MOTM・タイムライン・選手ごとの成長差分。
// ---------------------------------------------------------------------------
type GrowthRow = {
  id: number;
  name: string;
  statDiffs: { label: string; diff: number }[];
  extraDiffs: { label: string; diff: number }[];
  trustDiff: number;
  newSkills: string[];
  newNegatives: string[];
};
function computeGrowth(s: State): GrowthRow[] {
  const m = s.match!;
  const snaps = m.snapshot ?? [];
  const rows: GrowthRow[] = [];
  for (const snap of snaps) {
    const p = s.players.find((pp) => pp.id === snap.id);
    if (!p) continue;
    const statDiffs = (Object.keys(stats) as Stat[])
      .map((k) => ({ label: stats[k], diff: p.stats[k] - snap.stats[k] }))
      .filter((d) => Math.abs(d.diff) >= 0.5);
    const ps = s.v3.squad.players[p.id];
    const extraDiffs: { label: string; diff: number }[] = [];
    if (ps && snap.extra) {
      for (const k of ['dribble', 'stamina', 'power'] as ExtraStat[]) {
        const diff = ps[k] - snap.extra[k];
        if (Math.abs(diff) >= 0.5) extraDiffs.push({ label: extraStatNames[k], diff });
      }
    }
    const trustDiff = p.identity.trust - snap.trust;
    const newSkills = ps ? ps.skills.filter((id) => !snap.skills.includes(id)) : [];
    const newNegatives = ps ? ps.negatives.filter((id) => !snap.negatives.includes(id)) : [];
    if (
      statDiffs.length ||
      extraDiffs.length ||
      Math.abs(trustDiff) >= 1 ||
      newSkills.length ||
      newNegatives.length
    )
      rows.push({ id: p.id, name: p.name, statDiffs, extraDiffs, trustDiff, newSkills, newNegatives });
  }
  return rows;
}
type GrowthRowLike = ReturnType<typeof computeGrowth>[number];
function isNotableGrowth(row: GrowthRowLike): boolean {
  return (
    row.newSkills.length > 0 ||
    row.newNegatives.length > 0 ||
    row.extraDiffs.length > 0 ||
    Math.abs(row.trustDiff) >= 1 ||
    row.statDiffs.length >= 2 ||
    row.statDiffs.some((d) => Math.abs(d.diff) >= 1)
  );
}
function growthSignature(row: GrowthRowLike): string {
  return row.statDiffs.map((d) => `${d.label}${fmtDiff(d.diff)}`).join(' / ');
}
function groupMinorGrowth(rows: GrowthRowLike[]) {
  const map = new Map<string, { names: string[]; chips: GrowthRowLike['statDiffs'] }>();
  for (const row of rows) {
    if (isNotableGrowth(row)) continue;
    const sig = growthSignature(row);
    const hit = map.get(sig);
    if (hit) hit.names.push(row.name);
    else map.set(sig, { names: [row.name], chips: row.statDiffs });
  }
  return [...map.values()];
}
function fmtDiff(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}`;
}
type MotmResult = { player: Player; reason: string };
function computeMotm(s: State): MotmResult | null {
  const m = s.match!;
  const snapMap = new Map((m.snapshot ?? []).map((e) => [e.id, e]));
  const cast = m.used.length ? m.used : m.original;
  const cleanSheet = m.away === 0;
  let best: { player: Player; score: number; goals: number } | null = null;
  for (const id of cast) {
    const p = s.players.find((pp) => pp.id === id);
    if (!p) continue;
    const snap = snapMap.get(id);
    const matchGoals = snap ? Math.max(0, p.goals - snap.goals) : 0;
    const isDefensive = p.pos === 'GK' || p.pos === 'DF';
    const ps = s.v3.squad.players[id];
    let score = matchGoals * 34 + overall(p) * 0.5 + (ps ? ps.skills.length : 0) * 1.5;
    if (cleanSheet && isDefensive) score += 22;
    if (m.original.includes(id)) score += 4;
    if (!best || score > best.score) best = { player: p, score, goals: matchGoals };
  }
  if (!best) return null;
  const { player, goals } = best;
  const isDefensive = player.pos === 'GK' || player.pos === 'DF';
  let reason: string;
  if (goals >= 3) reason = 'ハットトリックの大活躍で試合を決定づけた。';
  else if (goals === 2) reason = '2得点の活躍でチームを勝利に導いた。';
  else if (goals === 1) reason = '値千金の1点でチームに貢献した。';
  else if (isDefensive && cleanSheet)
    reason =
      player.pos === 'GK'
        ? 'ゴールを守り抜き、無失点に貢献した。'
        : '最後まで体を張り、無失点を守り抜いた。';
  else reason = '要所を締める安定したプレーでチームを支えた。';
  return { player, reason };
}
function buildTimeline(s: State): string[] {
  const m = s.match!;
  return [...m.logs].reverse().filter((l) => /GOAL|失点|交代|PK戦|HALF TIME/.test(l));
}
function MatchSummary({
  s,
  run,
  onPlayer,
}: {
  s: State;
  run: (a: Action) => State | null;
  onPlayer: (p: Player) => void;
}) {
  const m = s.match!;
  const motm = computeMotm(s);
  const growth = computeGrowth(s);
  const notableGrowth = growth.filter(isNotableGrowth);
  const minorGrowth = groupMinorGrowth(growth);
  const timeline = buildTimeline(s);
  const resultLabel = m.won
    ? '勝利'
    : m.home === m.away && !m.penalties
      ? '引き分け'
      : '敗北';
  return (
    <section className="panel match-summary" aria-label="試合結果サマリ">
      <div className="summary-head">
        <span className="eyebrow">MATCH SUMMARY</span>
        <h2>
          {m.fixture.label} ・ {resultLabel}
        </h2>
        <p className="muted">
          対戦相手：{m.fixture.opponent}
          {m.penalties ? ` ・ PK戦 ${m.penalties}` : ''}
        </p>
      </div>
      {motm && (
        <button
          type="button"
          className="motm-card"
          onClick={() => onPlayer(motm.player)}
        >
          <span className="eyebrow">
            <Award size={16} /> MAN OF THE MATCH
          </span>
          <div className="motm-body">
            <Portrait index={motm.player.identity.portrait} name={motm.player.name} size="large" />
            <div>
              <b>{motm.player.name}</b>
              <p>{motm.reason}</p>
            </div>
          </div>
        </button>
      )}
      <div className="summary-timeline">
        <h3>タイムライン</h3>
        {timeline.length ? (
          timeline.map((l, i) => <p key={i}>{l}</p>)
        ) : (
          <p className="muted">目立った出来事はありませんでした。</p>
        )}
      </div>
      <div className="summary-growth">
        <h3>選手の成長</h3>
        {growth.length ? (
          notableGrowth.map((row) => (
            <div key={row.id} className="growth-row">
              <b>{row.name}</b>
              <span className="growth-chips">
                {row.statDiffs.map((d) => (
                  <span
                    key={d.label}
                    className={`growth-chip ${d.diff > 0 ? 'up' : 'down'}`}
                  >
                    {d.label} {fmtDiff(d.diff)}
                  </span>
                ))}
                {row.extraDiffs.map((d) => (
                  <span
                    key={d.label}
                    className={`growth-chip ${d.diff > 0 ? 'up' : 'down'}`}
                  >
                    {d.label} {fmtDiff(d.diff)}
                  </span>
                ))}
                {Math.abs(row.trustDiff) >= 1 && (
                  <span
                    className={`growth-chip ${row.trustDiff > 0 ? 'up' : 'down'}`}
                  >
                    信頼 {fmtDiff(row.trustDiff)}
                  </span>
                )}
                {row.newSkills.map((id) => (
                  <span key={id} className="growth-chip skill-new">
                    習得：{SKILLS[id]?.name ?? id}
                  </span>
                ))}
                {row.newNegatives.map((id) => (
                  <span key={id} className="growth-chip skill-new negative">
                    {SKILLS[id]?.name ?? id}
                  </span>
                ))}
              </span>
            </div>
          ))
        ) : (
          <></>
        )}
        {minorGrowth.map((g) => (
          <div key={g.names.join(',')} className="growth-row growth-row-group">
            <b>出場した{g.names.length}人</b>
            <span className="growth-chips">
              {g.chips.map((d) => (
                <span
                  key={d.label}
                  className={`growth-chip ${d.diff > 0 ? 'up' : 'down'}`}
                >
                  {d.label} {fmtDiff(d.diff)}
                </span>
              ))}
            </span>
            <small className="muted growth-group-names">{g.names.join('・')}</small>
          </div>
        ))}
        {!growth.length && (
          <p className="muted">
            {m.snapshot
              ? 'この試合で大きく変化した選手はいませんでした。'
              : 'この試合の成長記録はありません（この試合開始時点では未対応のセーブでした）。'}
          </p>
        )}
      </div>
      <button
        type="button"
        className="primary summary-close"
        onClick={() => run({ type: 'finish' })}
      >
        部に戻る <ArrowRight size={18} />
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 試合画面本体
// ---------------------------------------------------------------------------
export function MatchView({
  s,
  run,
  onPlayer,
}: {
  s: State;
  run: (a: Action) => State | null;
  onPlayer: (p: Player) => void;
}) {
  const m = s.match!;
  const [subOpen, setSubOpen] = useState(false);
  const [subInitial, setSubInitial] = useState<{
    outgoing: number | null;
    incoming: number | null;
  }>({ outgoing: null, incoming: null });
  // 開くたびに変わる番号。SubstitutionDialog の key に使い、開くたびに新しい選択状態で
  // 再マウントさせる（前回の選択が残らないようにするため）。
  const [subToken, setSubToken] = useState(0);
  const openSub = (partial: { outgoing?: number; incoming?: number }) => {
    setSubInitial({ outgoing: partial.outgoing ?? null, incoming: partial.incoming ?? null });
    setSubToken((t) => t + 1);
    setSubOpen(true);
  };
  return (
    <section className="match-view">
      <div className="scoreboard">
        <div className="match-caption">
          <span className="pill">
            {m.done
              ? 'FULL TIME'
              : m.minute === 45
                ? 'HALF TIME'
                : 'MATCH LIVE'}
          </span>
          <span>{m.fixture.label}</span>
        </div>
        <div className="score-row">
          <div>
            <span className="club-emblem">
              <Flag size={30} />
            </span>
            <h2>{s.school}</h2>
            <small>HOME</small>
          </div>
          <div className="score">
            <strong>
              {m.home}
              <span>:</span>
              {m.away}
            </strong>
            <b>
              {m.done
                ? m.won
                  ? 'WIN'
                  : m.home === m.away && !m.penalties
                    ? 'DRAW'
                    : 'LOSE'
                : `${m.minute}′`}
            </b>
            {m.penalties && <small>PK {m.penalties}</small>}
          </div>
          <div>
            <span className="club-emblem away">
              <Shield size={30} />
            </span>
            <h2>{m.fixture.opponent}</h2>
            <small>{tactics[m.fixture.style].name}</small>
          </div>
        </div>
        <div className="match-stats">
          <span>
            シュート{' '}
            <b>
              {m.shots[0]} — {m.shots[1]}
            </b>
          </span>
          <span>
            得点期待値{' '}
            <b>
              {m.xg[0].toFixed(1)} — {m.xg[1].toFixed(1)}
            </b>
          </span>
          <span>
            ボール保持{' '}
            <b>
              {m.possession}% — {100 - m.possession}%
            </b>
          </span>
        </div>
      </div>
      {m.done ? (
        <>
          <MatchCinema key={m.minute} s={s} />
          <MatchSummary s={s} run={run} onPlayer={onPlayer} />
        </>
      ) : (
        <>
          <div className="match-actionbar">
            <nav aria-label="試合中の移動">
              <a href="#match-movie">映像</a>
              <a href="#match-voice">声かけ</a>
              <a href="#match-tactics">戦術</a>
              <a href="#match-bench">交代</a>
            </nav>{' '}
            <button
              className="primary match-advance"
              onClick={() => {
                playSfx('click');
                const next = run({ type: 'segment' });
                if (next)
                  requestAnimationFrame(() =>
                    document.getElementById('match-movie')?.scrollIntoView({ block: 'start' }),
                  );
              }}
            >
              {m.minute === 45 ? '後半の15分を進める' : '次の15分を進める'}{' '}
              <ArrowRight size={19} />
            </button>
          </div>
          <MatchCinema key={m.minute} s={s} />
          <VoicePanel s={s} run={run} />
          <div className="match-grid">
            <section className="panel">
              <div className="section-head">
                <h2>タッチラインからの指示</h2>
                <span className="formation-label">{s.formation}</span>
              </div>
              <Pitch s={s} live onPick={(p) => openSub({ outgoing: p.id })} />
              <div className="live-log" aria-live="polite">
                {m.logs.slice(0, 5).map((l, i) => (
                  <p
                    className={l.includes('GOAL') ? 'goal-log' : ''}
                    key={`${m.minute}-${i}`}
                  >
                    {l}
                  </p>
                ))}
              </div>
            </section>
            <section className="panel command-panel" id="match-tactics">
              <span className="eyebrow">MANAGER&apos;S DECISION</span>
              <h2>{m.minute === 45 ? '後半のプランを。' : '次の15分を、どう戦う？'}</h2>
              <p className="muted">
                相手：{tactics[m.fixture.style].name} / 総合力 {m.fixture.strength}
              </p>
              <RadioGroup
                className="tactic-grid"
                aria-label="試合の戦術"
                value={m.tactic}
                onValueChange={(v) => run({ type: 'tactic', tactic: v as Tactic })}
                disabled={m.done}
              >
                {(Object.keys(tactics) as Tactic[]).map((key) => (
                  <label
                    key={key}
                    className={`tactic-card ${m.tactic === key ? 'selected' : ''}`}
                  >
                    <RadioGroupItem value={key} />
                    <div>
                      <b>{tactics[key].name}</b>
                      <small>{tactics[key].desc}</small>
                    </div>
                  </label>
                ))}
              </RadioGroup>
              <h3>攻守の意識</h3>
              <Choices
                label="攻守の意識"
                value={m.mentality}
                disabled={m.done}
                onChange={(v) =>
                  run({
                    type: 'mentality',
                    mentality: v as 'safe' | 'normal' | 'attack',
                  })
                }
                items={[
                  { value: 'safe', label: '守備重視' },
                  { value: 'normal', label: '標準' },
                  { value: 'attack', label: '攻撃重視' },
                ]}
              />
              <MatchCommands s={s} run={run} />
              <div className="bench-head" id="match-bench">
                <h3>交代</h3>
                <span className="subs-counter">交代 {m.subs} / 3</span>
              </div>
              <button
                type="button"
                className="primary sub-open-btn"
                disabled={m.done || m.subs >= 3}
                onClick={() => openSub({})}
              >
                <ArrowRightLeft size={17} /> 交代する選手を選ぶ
              </button>
              <div className="bench">
                {s.players
                  .filter((p) => !s.lineup.includes(p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      disabled={m.done || m.used.includes(p.id) || m.subs >= 3 || !!p.injury}
                      onClick={() => openSub({ incoming: p.id })}
                    >
                      <Portrait
                        index={p.identity.portrait}
                        name={p.name}
                        size="tiny"
                      />
                      <span className={`position pos-${p.pos}`}>{p.pos}</span>
                      <b>{p.name}</b>
                      <small>
                        {m.used.includes(p.id)
                          ? '交代済'
                          : p.injury
                            ? '調整中'
                            : `疲労 ${Math.round(p.fatigue)}`}
                      </small>
                    </button>
                  ))}
              </div>
              <small className="muted">
                采配は次の15分に反映。途中でも自動保存されます。
              </small>
            </section>
          </div>
          <SubstitutionDialog
            key={subToken}
            s={s}
            run={run}
            open={subOpen}
            onOpenChange={setSubOpen}
            initialOutgoing={subInitial.outgoing}
            initialIncoming={subInitial.incoming}
          />
        </>
      )}
    </section>
  );
}
