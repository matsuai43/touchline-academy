'use client';
// W4/T1: 試合UIの刷新、まとめて交代、試合後の結果画面。
// app/game-ui.tsx から試合画面（旧 MatchView）をここへ切り出し、次を追加する。
//  - 交代を「下げる選手→入れる選手」の組を予約し、まとめて確定する複数交代フロー
//    （SubstitutionDialog）。下げる選手を選ぶと、ベンチにそのポジションでの習熟度
//    ランク（A〜G）を適性順に表示する。
//  - 試合終了後は試合画面の下に続けず、別画面（app/match-result.tsx の MatchResult）に
//    切り替える。評価点の算出は lib/match-rating.ts（純粋関数）。
// Pitch / Choices / Meter / Metric は試合以外のタブ（クラブ・編成）からも使われる小さな部品なので、
// ここにまとめて置き、app/game-ui.tsx からインポートして使う。
import { useState } from 'react';
import { Portrait } from './development-ui';
import { MatchCommands, VoicePanel } from './development-ui';
import MatchCinema from './match-cinema';
import { MatchResult } from './match-result';
import { RankBadge, PositionBadge, MoodBadge, MasteryBadge } from './ability-sheet';
import { FatigueMeter } from './fatigue-meter';
import { playSfx } from '@/lib/audio';
import { rankOf } from '@/lib/ability-rank';
import { matchRatings } from '@/lib/match-rating';
import {
  detailInfo,
  formationSlots,
  isBenchPlayer,
  basePos,
  type DetailPos,
} from '@/lib/squad';
import {
  overall,
  roster,
  slots,
  clamp,
  tactics,
  MATCH_MAX_SUBS,
  GROWTH_MIN_PROF,
  fixtureFormation,
  type State,
  type Action,
  type Player,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowRight, ArrowRightLeft, Flag, Shield, X } from 'lucide-react';

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
  previewPlayer = null,
  selectedId,
}: {
  s: State;
  onPick?: (p: Player) => void;
  live?: boolean;
  previewPlayer?: Player | null;
  selectedId?: number;
}) {
  const detailSlots = formationSlots(s.formation);
  const positions = slots(s.formation);
  const team = roster(s);
  // T1修正: 試合中はスタメン(m.original)に無い=交代で入った選手を「交代出場」として
  // 見た目と読み上げの両方に残す。ライブでない（先発編成中）ときは常にfalse。
  const original = live ? s.match?.original : undefined;
  const ratings = live ? new Map(matchRatings(s).map((r) => [r.id, r.rating])) : null;
  return (
    <div
      className={`pitch ${live ? 'live' : 'lineup-pitch'}`}
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
        // T1修正: 交代で入った選手（＝キックオフ時点のスタメンに含まれない）かどうか。
        const subbedIn = !!original && !original.includes(p.id);
        return (
          <button
            className={`pitch-player ${p.pos !== pos ? 'mismatch' : ''} ${p.injury ? 'injured' : ''} ${subbedIn ? 'subbed-in' : ''}`}
            key={p.id}
            aria-pressed={!live ? selectedId === p.id : undefined}
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onPick?.(p)}
            title={`起用先：${slotName}（${slotDetail}）${subbedIn ? '・交代出場' : ''}`}
            aria-label={`${p.name} ${slotName} 総合${overall(p)} 疲労${Math.round(p.fatigue)}${subbedIn ? ' 交代出場' : ''}`}
          >
            <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
            <span className="number">{i + 1}</span>
            {/* 交代時にポジションが分からなくなる不具合の修正: 今いる枠のポジション名を
                常に見える形で出す（略号。日本語フル名はtitle/aria-labelに残す）。 */}
            <span className="pitch-slot" aria-hidden="true">
              {slotDetail}
            </span>
            <span className="pitch-name">
              {p.name.split(' ')[0]}
              {subbedIn && (
                <span className="pitch-sub-mark" aria-hidden="true" title="交代出場">
                  IN
                </span>
              )}
            </span>
            <span className="pitch-condition"><FatigueMeter value={p.fatigue} size="sm" />{live ? <span>評価 {ratings?.get(p.id)?.toFixed(1) ?? '—'}</span> : <><MasteryBadge value={profFor(s, (previewPlayer ?? p).id, slotDetail)} /><MoodBadge value={s.v3.squad.players[p.id]?.mood ?? 50} size="sm" /></>}</span>
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
// 「交代推奨」の判定にのみ使う、決定的な今日の出来の揺らぎ（表示はしない）。
function conditionScore(s: State, p: Player): number {
  const minute = s.match?.minute ?? 0;
  const h = conditionHash(s.seed, p.id, minute);
  return clamp(Math.round(62 - p.fatigue * 0.55 + (h - 0.5) * 34), 0, 100);
}

// ---------------------------------------------------------------------------
// T1: 指定ポジションでの習熟度（0〜100）。lib/squad.ts の positionFitMult と
// 同じフォールバック（現ポジション=100・同系統=40・それ以外=10）を使う、表示専用のヘルパー。
// ---------------------------------------------------------------------------
function profFor(s: State, id: number, slot: DetailPos): number {
  const ps = s.v3.squad.players[id];
  if (ps?.prof) {
    const v = ps.prof[slot];
    if (typeof v === 'number') return v;
    return ps.detail === slot ? 100 : basePos(ps.detail) === basePos(slot) ? 40 : 10;
  }
  const p = s.players.find((pp) => pp.id === id);
  if (!p) return 10;
  return p.pos === basePos(slot) ? 40 : 10;
}
// T2（別エージェント）が lib/squad.ts に追加した「調子」（0〜100、mood）。旧セーブ移行前
// など値が無いときは undefined のままにし、MoodBadge を出さない。
function moodOf(s: State, id: number): number | undefined {
  const ps = s.v3.squad.players[id];
  return typeof ps?.mood === 'number' && Number.isFinite(ps.mood) ? ps.mood : undefined;
}

// ---------------------------------------------------------------------------
// 交代パネル：まとめて交代（S6）。
// 「下げる選手→入れる選手」を選ぶと1組が予約リストに入り、続けて次の組を選べる。
// 予約は個別に取り消せる。最後に「◯人の交代を確定」で、予約した組を順番に既存の
// 'swap' アクションとして発行する（1件でも失敗したら、そこで止めて残りは予約に残す）。
// ---------------------------------------------------------------------------
// T-14: 試合中の「映像／声かけ／戦術／交代」は、以前はアンカーリンクで同じページ内を
// スクロールする作りだったため、4区画すべてが常に描画され縦に長くなっていた。ここでは
// 選択した区画だけを表示するタブに変える（交代の実際の選択はこれまでどおりダイアログ）。
type MatchSection = 'movie' | 'voice' | 'tactics' | 'bench';

// V4-1(4章): 下げる選手のポジション表示は GK→DF→MF→FW の順に並べる基準。
const POS_ORDER: Record<'GK' | 'DF' | 'MF' | 'FW', number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

type PendingReservation = { outgoing: number; incoming: number; index: number };
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
  const [reservations, setReservations] = useState<PendingReservation[]>([]);
  const dslots = formationSlots(s.formation);
  // 残り枠は「既に成立した交代」と「予約中の交代」の両方を差し引く。
  const remainingSlots = MATCH_MAX_SUBS - m.subs;
  const capReached = reservations.length >= remainingSlots;
  const reservedOutIds = new Set(reservations.map((r) => r.outgoing));
  const reservedInIds = new Set(reservations.map((r) => r.incoming));
  const outPlayer = outgoing != null ? s.players.find((p) => p.id === outgoing) : null;
  const inPlayer = incoming != null ? s.players.find((p) => p.id === incoming) : null;
  // 下げる選手が決まっているときだけ、その選手が守るスロットでの習熟度でベンチを並べ替える。
  const outIndex = outgoing != null ? s.lineup.indexOf(outgoing) : -1;
  const outSlot: DetailPos | null = outIndex >= 0 ? dslots[outIndex] : null;
  const outAlreadyReserved = outgoing != null && reservedOutIds.has(outgoing);
  const inAlreadyReserved = incoming != null && reservedInIds.has(incoming);
  const canReserve =
    !capReached && outgoing != null && incoming != null && !outAlreadyReserved && !inAlreadyReserved;
  const blockReason = capReached
    ? `交代枠（${MATCH_MAX_SUBS}人）を使い切りました（予約中${reservations.length}人を含む）。`
    : outgoing == null
      ? '下げる選手も選んでください。'
      : incoming == null
        ? '入れる選手も選んでください。'
        : outAlreadyReserved
          ? `${outPlayer?.name ?? 'この選手'}は既に交代を予約済みです。`
          : inAlreadyReserved
            ? `${inPlayer?.name ?? 'この選手'}は既に別の交代で予約済みです。`
            : null;
  const addReservation = () => {
    if (!canReserve || outgoing == null || incoming == null) return;
    const idx = s.lineup.indexOf(outgoing);
    if (idx < 0) return;
    setReservations((rs) => [...rs, { outgoing, incoming, index: idx }]);
    setOutgoing(null);
    setIncoming(null);
    playSfx('click');
  };
  const removeReservation = (i: number) => {
    setReservations((rs) => rs.filter((_, idx) => idx !== i));
  };
  const confirmAll = () => {
    let rest = reservations;
    while (rest.length) {
      const next = rest[0];
      const result = run({ type: 'swap', index: next.index, id: next.incoming });
      if (!result) break;
      rest = rest.slice(1);
    }
    setReservations(rest);
    if (!rest.length) {
      playSfx('click');
      onOpenChange(false);
    }
  };
  // V4-1(4章): 交代パネルを「下げる選手を選ぶ→入れる選手を選ぶ」の2段階・1列の流れに
  // 変える（旧2列レイアウトは幅375pxで詰まって読みにくかった）。評価点は matchRatings()
  // （出場した選手のみ）から拾い、出ていない選手には表示しない。
  const ratings = matchRatings(s);
  const ratingOf = (id: number) => ratings.find((r) => r.id === id)?.rating ?? null;
  const outRows = roster(s)
    .map((p, i) => {
      const slot = dslots[i];
      const cond = conditionScore(s, p);
      return {
        p,
        i,
        slot,
        recommend: cond < 40 || p.fatigue > 72,
      };
    })
    .sort((a, b) => {
      const reservedDiff = Number(reservedOutIds.has(b.p.id)) - Number(reservedOutIds.has(a.p.id));
      if (reservedDiff) return -reservedDiff; // 予約済みは下げない（先頭にまとめない）
      const recDiff = Number(b.recommend) - Number(a.recommend);
      if (recDiff) return recDiff; // 交代推奨を先頭に
      return POS_ORDER[basePos(a.slot)] - POS_ORDER[basePos(b.slot)] || a.i - b.i;
    });
  const benchRows = s.players
    .filter((p) => isBenchPlayer(s, p.id))
    .map((p) => ({ p, prof: outSlot ? profFor(s, p.id, outSlot) : 0 }))
    .sort((a, b) => b.prof - a.prof);
  const benchFit = benchRows.filter((r) => r.prof >= GROWTH_MIN_PROF);
  const benchUnfit = benchRows.filter((r) => r.prof < GROWTH_MIN_PROF);
  const renderBenchRow = ({ p, prof }: { p: Player; prof: number }) => {
    const reserved = reservedInIds.has(p.id);
    const locked = m.used.includes(p.id) || capReached || !!p.injury || reserved;
    const mood = moodOf(s, p.id);
    return (
      <button
        key={p.id}
        type="button"
        className={`sub-pick sub-in-row ${incoming === p.id ? 'selected' : ''}`}
        aria-disabled={locked}
        aria-pressed={incoming === p.id}
        onClick={() => setIncoming(p.id)}
      >
        <span className="sub-pick-rank">
          <span className="sub-pick-rank-label">習熟度</span>
          <RankBadge value={prof} label={outSlot ? detailInfo[outSlot].name : undefined} size="lg" />
        </span>
        <span className="sub-pick-body">
          <b className="sub-pick-name">{p.name}</b>
          <span className="sub-pick-meta">
            {outSlot ? `${detailInfo[outSlot].name}に入った場合の習熟度 ${rankOf(prof).letter}` : p.pos}
            {reserved
              ? '・予約済み'
              : m.used.includes(p.id)
                ? '・交代済'
                : p.injury
                  ? '・調整中'
                  : ''}
          </span>
          {!reserved && !m.used.includes(p.id) && !p.injury && (
            <span className="sub-pick-status">
              <FatigueMeter value={p.fatigue} size="sm" />
              {mood != null && <MoodBadge value={mood} size="sm" />}
              <span className="sub-overall-chip">総合 {overall(p)}</span>
            </span>
          )}
        </span>
      </button>
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="game-dialog sub-dialog">
        <DialogTitle>交代する選手を選ぶ</DialogTitle>
        <DialogDescription>
          まず下げる選手を選び、続けて入れる選手を選びます。組ができたら「予約に追加」、
          続けて次の組も選べます。最後に「まとめて確定」でまとめて交代します。
        </DialogDescription>
        {/* M2: 習熟度ランク（A〜G）が能力ランクと同じ見た目のため区別できないというユーザー
            要望への対応。バッジには常に「習熟度」の文字ラベルを添え、画面上部にランクの
            意味（能力の高さではないこと）とピッチ側・ベンチ側で意味が違うことを明記する。 */}
        <p className="sub-rank-legend">
          <b>A〜G＝そのポジションへの慣れ（習熟度）</b>
          です。A=80以上・B=70以上・C=60以上・D=50以上・E=40以上・F=20以上・G=19以下。<b>能力の高さではありません。</b>
          <br />
          ピッチ上の選手は「今いる枠への慣れ」、ベンチの選手は「下げる選手の枠に入った場合の慣れ」を表示します。
        </p>
        <div className="subs-counter-row">
          <span className="subs-counter">
            交代 {m.subs} / {MATCH_MAX_SUBS}
            {reservations.length > 0 ? `（予約 ${reservations.length}）` : ''}
          </span>
          {capReached && <span className="muted">交代枠を使い切りました。</span>}
        </div>
        {/* V4-1(4章-3): 予約した交代は「下げる ⇄ 入れる」のカードで一覧し、まとめて確定する。 */}
        {reservations.length > 0 && (
          <ul className="sub-reserved-list" aria-label="予約中の交代">
            {reservations.map((r, i) => {
              const out = s.players.find((p) => p.id === r.outgoing);
              const inn = s.players.find((p) => p.id === r.incoming);
              const slot = dslots[r.index];
              const prof = profFor(s, r.incoming, slot);
              return (
                <li key={`${r.outgoing}-${r.incoming}`} className="sub-reserved-row">
                  <span className="sub-reserved-body">
                    <span className="sub-reserved-slot">{detailInfo[slot].name}</span>
                    <span className="sub-reserved-swap">
                      下げる：<b>{out?.name ?? '?'}</b>
                      <ArrowRightLeft size={13} aria-hidden="true" className="sub-reserved-arrow" />
                      入れる：<b>{inn?.name ?? '?'}</b>（習熟度 {rankOf(prof).letter}）
                    </span>
                  </span>
                  <button
                    type="button"
                    className="icon-button sub-reserved-remove"
                    aria-label={`${out?.name ?? ''}と${inn?.name ?? ''}の交代予約を取り消す`}
                    onClick={() => removeReservation(i)}
                  >
                    <X size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {outgoing == null ? (
          <div className="sub-step sub-step-out">
            <h3 className="sub-step-title">1. 下げる選手を選ぶ</h3>
            <div className="sub-list">
              {outRows.map(({ p, slot, recommend }) => {
                const reserved = reservedOutIds.has(p.id);
                const mood = moodOf(s, p.id);
                const rating = ratingOf(p.id);
                // 交代時にポジションが分からなくなる不具合の修正:
                // 今いる枠のポジション名を、習熟度ランクとは別に見出しとして出す。
                const subbedIn = !m.original.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`sub-pick sub-out-row ${outgoing === p.id ? 'selected' : ''}`}
                    aria-disabled={capReached || reserved}
                    aria-pressed={outgoing === p.id}
                    onClick={() => {
                      setOutgoing(p.id);
                      if (incoming != null && (m.used.includes(incoming) || reservedInIds.has(incoming)))
                        setIncoming(null);
                    }}
                  >
                    <span className="sub-pos-col">
                      <PositionBadge detail={slot} />
                    </span>
                    <span className="sub-pick-body">
                      <span className="sub-pick-toprow">
                        <b className="sub-pick-name">{p.name}</b>
                        {subbedIn && <span className="sub-in-tag">交代出場</span>}
                        {reserved && <span className="sub-recommend">予約済み</span>}
                        {!reserved && recommend && <span className="sub-recommend">交代推奨</span>}
                      </span>
                      <span className="sub-pick-status">
                        <FatigueMeter value={p.fatigue} size="sm" />
                        {mood != null && <MoodBadge value={mood} size="sm" />}
                        {rating != null && (
                          <span className="sub-rating-chip">評価 {rating.toFixed(1)}</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="sub-step sub-step-in">
            {/* 交代時に下げる選手のポジションが分からなくなる不具合の修正: 下げる選手を
                選んだ時点で、ダイアログ上部にそのポジションつきで明示する。 */}
            {outPlayer && (
              <p className="sub-outgoing-banner">
                <b>{outPlayer.name}</b>
                {outSlot ? `（${detailInfo[outSlot].name}）` : ''}を下げる
                <button
                  type="button"
                  className="link-button sub-change-out"
                  onClick={() => {
                    setOutgoing(null);
                    setIncoming(null);
                  }}
                >
                  下げる選手を変える
                </button>
              </p>
            )}
            <h3 className="sub-step-title">2. 入れる選手を選ぶ（習熟度が高い順）</h3>
            <div className="sub-list">
              {benchFit.map(renderBenchRow)}
              {benchUnfit.length > 0 && (
                <>
                  <p className="sub-unfit-label">不慣れ（習熟度D未満）</p>
                  {benchUnfit.map(renderBenchRow)}
                </>
              )}
              {benchRows.length === 0 && (
                <p className="muted sub-hint">ベンチに入れられる選手がいません。</p>
              )}
            </div>
          </div>
        )}
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
                className="secondary"
                aria-disabled={!canReserve}
                onClick={addReservation}
              >
                予約に追加
              </button>
            </div>
            {blockReason && (
              // role="status" 相当を意味的なタグで表す（lintのprefer-tag-over-role対応）。
              <output className="muted sub-hint">{blockReason}</output>
            )}
          </div>
        )}
        <div className="sub-confirm-all">
          <button
            type="button"
            className="primary"
            aria-disabled={reservations.length === 0}
            onClick={confirmAll}
          >
            {reservations.length}人の交代を確定
          </button>
          {reservations.length === 0 && (
            <output className="muted sub-hint">
              交代する組を選んで「予約に追加」してから確定してください。
            </output>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 試合画面本体
// ---------------------------------------------------------------------------
function PenaltyShootoutView({ s, run }: { s: State; run: (a: Action) => State | null }) {
  const m = s.match!;
  const pk = m.pk!;
  const chosen = pk.order;
  const own = pk.kicks.filter((kick) => kick.side === 0);
  const rival = pk.kicks.filter((kick) => kick.side === 1);
  const ownGoals = own.filter((kick) => kick.scored).length;
  const rivalGoals = rival.filter((kick) => kick.scored).length;
  return (
    <section className="match-view pk-view" aria-label="PK戦">
      <div className="scoreboard">
        <div className="match-caption"><span className="pill">PK戦</span><span>{m.fixture.label}</span></div>
        <div className="score-row">
          <div><h2>{s.school}</h2><small>HOME</small></div>
          <div className="score"><strong>{m.home}<span>:</span>{m.away}</strong><b>120′</b></div>
          <div><h2>{m.fixture.opponent}</h2><small>AWAY</small></div>
        </div>
        <p className="pk-live-score" aria-live="polite">PK {ownGoals} — {rivalGoals}</p>
      </div>
      <section className="panel pk-panel">
        <h2>PK戦</h2>
        <p className="muted">1本ずつ進みます。キッカーの順番を11人まで指定できます。</p>
        {pk.kicks.length === 0 ? (
          <>
            <h3>キッカーの順番</h3>
            <ol className="pk-order">
              {Array.from({ length: 11 }, (_, i) => (
                <li key={i}>{i + 1}番手：{s.players.find((p) => p.id === chosen[i])?.name ?? 'おまかせ'}</li>
              ))}
            </ol>
            <div className="pk-choices" aria-label="キッカーを選ぶ">
              {roster(s).map((p) => {
                const number = chosen.indexOf(p.id);
                return (
                  <button key={p.id} type="button" className="secondary"
                    aria-pressed={number >= 0} aria-disabled={number < 0 && chosen.length >= 11}
                    onClick={() => {
                      if (number >= 0) run({ type: 'pkOrder', ids: chosen.filter((id) => id !== p.id) });
                      else if (chosen.length < 11) run({ type: 'pkOrder', ids: [...chosen, p.id] });
                    }}>
                    {number >= 0 ? `${number + 1}番手 ` : ''}{p.name}
                  </button>
                );
              })}
            </div>
            <p className="muted">選ばなかった枠は能力に応じて自動で決まり、12本目からは同じ順番を繰り返します。</p>
          </>
        ) : (
          <ol className="pk-kicks" aria-label="PKの結果" aria-live="polite">
            {pk.kicks.map((kick, i) => (
              <li key={i}>
                <span>{kick.side === 0 ? s.players.find((p) => p.id === kick.kickerId)?.name : `${m.fixture.opponent} ${Math.floor(i / 2) + 1}番手`}</span>
                <b>{kick.scored ? '○ 成功' : kick.saved ? '× セーブ' : '× 枠外'}</b>
              </li>
            ))}
          </ol>
        )}
        <button type="button" className="primary pk-advance" onClick={() => run({ type: 'segment' })}>
          {pk.kicks.length ? '次のキックへ' : 'PK戦を始める'} <ArrowRight size={19} />
        </button>
        <button type="button" className="secondary" onClick={() => run({ type: 'autoMatch' })}>ここからおまかせ</button>
      </section>
    </section>
  );
}
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
  const [matchSection, setMatchSection] = useState<MatchSection>('movie');
  const [subOpen, setSubOpen] = useState(false);
  const [picked, setPicked] = useState<Player | null>(null);
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
  // T1: 試合終了後は、試合画面（スコアボード・映像・交代パネル）の下に続けるのではなく、
  // 全画面の「試合結果」画面（MatchResult）に切り替える（試合ビューの置き換え）。
  if (m.done) {
    return (
      <section className="match-view">
        <MatchResult s={s} run={run} onPlayer={onPlayer} />
      </section>
    );
  }
  if (m.pk) return <PenaltyShootoutView s={s} run={run} />;
  return (
    <section className="match-view">
      <div className="scoreboard">
        <div className="match-caption">
          <span className="pill">{m.minute === 45 ? 'HALF TIME' : m.minute >= 90 ? 'EXTRA TIME' : 'MATCH LIVE'}</span>
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
            <b>{m.minute}′</b>
          </div>
          <div>
            <span className="club-emblem away">
              <Shield size={30} />
            </span>
            <h2>{m.fixture.opponent}</h2>
            <small>{tactics[m.fixture.style].name} ・ {fixtureFormation(m.fixture)}</small>
          </div>
        </div>
        <div className="match-comparisons">
          {([
            ['シュート', m.shots[0], m.shots[1]],
            ['得点期待値', +m.xg[0].toFixed(1), +m.xg[1].toFixed(1)],
            ['ボール保持', m.possession, 100 - m.possession],
          ] as const).map(([label, home, away]) => <div className="match-comparison" key={label}>
            <span>{home}{label === 'ボール保持' ? '%' : ''}</span><span>{label}</span><span>{away}{label === 'ボール保持' ? '%' : ''}</span>
            <span className="comparison-bar" aria-hidden="true"><i style={{ width: `${home + away ? home / (home + away) * 100 : 50}%` }} /></span>
          </div>)}
        </div>
      </div>
          <Tabs
            value={matchSection}
            onValueChange={(v) => setMatchSection(v as MatchSection)}
            className="match-section-tabswrap"
          >
            <div className="match-actionbar" id="match-live-top">
              <TabsList
                className="match-section-tabs"
                variant="line"
                aria-label="試合中の区画"
              >
                <TabsTrigger value="movie">映像</TabsTrigger>
                <TabsTrigger value="voice">声かけ</TabsTrigger>
                <TabsTrigger value="tactics">戦術</TabsTrigger>
                <TabsTrigger value="bench">交代</TabsTrigger>
              </TabsList>
              <div className="match-progress-controls">
              <button
                className="primary match-advance"
                onClick={() => {
                  playSfx('click');
                  const next = run({ type: 'segment' });
                  if (next) {
                    // T-14: 進めた直後は必ず映像の区画に戻し、新しい実況が見える位置まで
                    // スクロールする（以前は常設だった #match-movie への自動スクロールと
                    // 同じ意図）。
                    setMatchSection('movie');
                    requestAnimationFrame(() =>
                      document
                        .getElementById('match-live-top')
                        ?.scrollIntoView({ block: 'start' }),
                    );
                  }
                }}
              >
                {m.minute === 45 ? '後半の15分を進める' : m.minute === 90 ? '延長前半を進める' : m.minute === 105 ? '延長後半を進める' : '次の15分を進める'}{' '}
                <ArrowRight size={19} />
              </button>
              <button className="secondary" onClick={() => { run({ type: 'nextHighlight' }); setMatchSection('movie'); }}>次の山場まで</button>
              <button className="secondary" onClick={() => run({ type: 'autoMatch' })}>ここからおまかせ</button>
              </div>
            </div>
            <TabsContent value="movie">
              <MatchCinema key={`cinema-${m.minute}`} s={s} />
            </TabsContent>
            <section className="panel pitch-panel">
              <div className="section-head">
                <h2>タッチラインからの指示</h2>
                <span className="formation-label">{s.formation}</span>
              </div>
              <Pitch s={s} live onPick={setPicked} />
              <h3>試合の出来事</h3>
              <ol className="live-log match-timeline" aria-live="polite">
                {[...m.logs].reverse().filter((l) => !l.startsWith('キックオフ') && /GOAL|失点|交代|けが|負傷|HALF|同点|終了/.test(l)).map((l, i) => (
                  <li
                    className={l.includes('GOAL') ? 'goal-log' : ''}
                    key={`${m.minute}-${i}`}
                  >
                    <span aria-hidden="true">{l.includes('交代') ? '⇄' : /GOAL|失点/.test(l) ? '⚽' : '•'}</span> {l.startsWith('HALF') ? '45′ ' : ''}{l}
                  </li>
                ))}
              </ol>
            </section>
            {/* T-14: 交代の起点（件数表示・「交代する選手を選ぶ」）は、既存のPlaywright
                テストや実プレイの導線が「試合画面を開いたらすぐ操作できる」ことを前提に
                しているため、区画切り替えの対象からは外し、常に見える帯として残す。
                区画切り替えで隠すのは「ベンチ一覧（個別に押して選ぶ簡易版）」のみ。
                交代の実際の選択はこれまでどおりダイアログで行う。 */}
            <section className="panel bench-quickbar">
              <div className="bench-head">
                <h3>交代</h3>
                <span className="subs-counter">
                  交代 {m.subs} / {MATCH_MAX_SUBS}
                </span>
              </div>
              <button
                type="button"
                className="secondary sub-open-btn"
                aria-disabled={m.subs >= MATCH_MAX_SUBS}
                onClick={() => openSub({})}
              >
                <ArrowRightLeft size={17} /> 交代する選手を選ぶ
              </button>
            </section>
            <TabsContent value="voice">
              <VoicePanel s={s} run={run} />
            </TabsContent>
            <TabsContent value="tactics">
              <section className="panel command-panel">
                <span className="eyebrow">MANAGER&apos;S DECISION</span>
                <h2>{m.minute === 45 ? '後半のプランを。' : '次の15分を、どう戦う？'}</h2>
                <p className="muted">
                  相手：{tactics[m.fixture.style].name}（{fixtureFormation(m.fixture)}） / 総合力 {m.fixture.strength}
                </p>
                {/* この一帯は m.done の間はそもそも描画されない（上の早期returnで
                    MatchResult に置き換わる）ため、disabled={m.done} のような
                    常にfalseの死んだ条件は、DADSの方針どおりそもそも付けない。 */}
                <RadioGroup
                  className="tactic-grid"
                  aria-label="試合の戦術"
                  value={m.tactic}
                  onValueChange={(v) => run({ type: 'tactic', tactic: v as Tactic })}
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
                <small className="muted">
                  采配は次の15分に反映。途中でも自動保存されます。
                </small>
              </section>
            </TabsContent>
            <TabsContent value="bench">
              <section className="panel command-panel">
                <p className="muted instruction">
                  ベンチの選手を押すと、その選手を投入する交代ダイアログを開きます。
                </p>
                {/* S3: 交代できるのはベンチ入り(Aチームの先発以外9人)の選手のみ。
                    Bチームや、Aチームでもベンチ外の選手は一覧にすら出さない。 */}
                <div className="bench">
                  {s.players
                    .filter((p) => isBenchPlayer(s, p.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-disabled={
                          m.used.includes(p.id) || m.subs >= MATCH_MAX_SUBS || !!p.injury
                        }
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
            </TabsContent>
          </Tabs>
          <Dialog open={!!picked} onOpenChange={(open) => { if (!open) setPicked(null); }}>
            <DialogContent>
              <DialogTitle>{picked?.name}</DialogTitle>
              <DialogDescription>選手への指示を選んでください。</DialogDescription>
              <button className="secondary" onClick={() => { if (picked) openSub({ outgoing: picked.id }); setPicked(null); }}>交代</button>
              <button className="secondary" aria-disabled={m.details.moment?.playerId !== picked?.id || m.details.moment?.answered}
                onClick={() => { if (m.details.moment?.playerId === picked?.id && !m.details.moment?.answered) { setMatchSection('voice'); setPicked(null); } }}>声かけ</button>
              {m.details.moment?.playerId !== picked?.id || m.details.moment?.answered ? <p className="muted">声かけは、プレーの場面が届いた選手に行えます。</p> : null}
            </DialogContent>
          </Dialog>
          <SubstitutionDialog
            key={`sub-${subToken}`}
            s={s}
            run={run}
            open={subOpen}
            onOpenChange={setSubOpen}
            initialOutgoing={subInitial.outgoing}
            initialIncoming={subInitial.incoming}
          />
    </section>
  );
}
