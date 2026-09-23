'use client';
// T1: 試合終了後の「試合結果」画面。
// 試合画面（app/match-ui.tsx の MatchView）の下に続けるのではなく、m.done のときは
// MatchView がこのコンポーネントだけを描く（試合ビューの置き換え）。スコアボード・タイム
// ライン・MOTM・成長差分（旧 MatchSummary から移設）に加えて、選手ごとの評価点
// （lib/match-rating.ts、10点満点・決定的）と、この試合で得た部費の表示枠を持つ。
import { Portrait } from './development-ui';
import { PositionBadge } from './ability-sheet';
import {
  extraStatNames,
  SKILLS,
  type ExtraStat,
} from '@/lib/squad';
import { stats, type State, type Action, type Player, type Stat } from '@/lib/game';
import { matchRatings, topRated, type PlayerRating } from '@/lib/match-rating';
import { Award, ArrowRight, Wallet } from 'lucide-react';

// ---------------------------------------------------------------------------
// 選手ごとの成長差分（旧 MatchSummary から移設。ロジックは変更していない）。
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

// ---------------------------------------------------------------------------
// MOTM の選出理由。評価点1位の選手（lib/match-rating.ts の topRated）と必ず一致させる。
// ---------------------------------------------------------------------------
function motmReason(row: PlayerRating, cleanSheet: boolean): string {
  if (row.goals >= 3) return 'ハットトリックの大活躍で試合を決定づけた。';
  if (row.goals === 2) return '2得点の活躍でチームを勝利に導いた。';
  if (row.goals === 1) return '値千金の1点でチームに貢献した。';
  if (cleanSheet)
    return row.pos === 'GK'
      ? 'ゴールを守り抜き、無失点に貢献した。'
      : '最後まで体を張り、無失点を守り抜いた。';
  return '要所を締める安定したプレーでチームを支えた。';
}
function buildTimeline(s: State): string[] {
  const m = s.match!;
  return [...m.logs].reverse().filter((l) => /GOAL|失点|交代|PK戦|HALF TIME/.test(l));
}

export function MatchResult({
  s,
  run,
  onPlayer,
  fundsEarned,
}: {
  s: State;
  run: (a: Action) => State | null;
  onPlayer: (p: Player) => void;
  /** T4で配線予定。値が渡されない（undefined）間は表示枠ごと出さない。 */
  fundsEarned?: { amount: number; reason: string }[];
}) {
  const m = s.match!;
  const ratings = matchRatings(s);
  const top = topRated(ratings);
  const cleanSheet = m.away === 0;
  const motmPlayer = top ? s.players.find((p) => p.id === top.id) : null;
  const growth = computeGrowth(s);
  const notableGrowth = growth.filter(isNotableGrowth);
  const minorGrowth = groupMinorGrowth(growth);
  const timeline = buildTimeline(s);
  const resultKind: 'win' | 'draw' | 'lose' = m.won
    ? 'win'
    : m.home === m.away && !m.penalties
      ? 'draw'
      : 'lose';
  const resultLabel = resultKind === 'win' ? '勝利' : resultKind === 'draw' ? '引き分け' : '敗北';
  return (
    <section className="mr-screen" aria-label="試合結果">
      <div className="mr-head">
        <span className="eyebrow">MATCH RESULT</span>
        <h1>{m.fixture.label}</h1>
        <p className="muted">対戦相手：{m.fixture.opponent}</p>
        <div className="mr-scoreline">
          <b>{s.school}</b>
          <strong>
            {m.home} - {m.away}
          </strong>
          <b>{m.fixture.opponent}</b>
        </div>
        <p className={`mr-outcome mr-outcome-${resultKind}`}>
          {resultLabel}
          {m.penalties ? `（PK ${m.penalties}）` : ''}
        </p>
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
      {motmPlayer && top && (
        <button type="button" className="motm-card" onClick={() => onPlayer(motmPlayer)}>
          <span className="eyebrow">
            <Award size={16} /> MAN OF THE MATCH
          </span>
          <div className="motm-body">
            <Portrait index={motmPlayer.identity.portrait} name={motmPlayer.name} size="large" />
            <div>
              <b>{motmPlayer.name}</b>
              <p>{motmReason(top, cleanSheet && (top.pos === 'GK' || top.pos === 'DF'))}</p>
            </div>
          </div>
        </button>
      )}
      <section className="panel mr-ratings" aria-label="選手ごとの評価点">
        <h2>選手の評価点</h2>
        <p className="muted">10点満点・6.0が平均。出場した選手（途中出場を含む）を評価点順に並べています。</p>
        <ol className="mr-rating-list">
          {ratings.map((r) => (
            <li key={r.id} className={`mr-rating-row ${top?.id === r.id ? 'mr-rating-top' : ''}`}>
              <button type="button" onClick={() => {
                const p = s.players.find((pp) => pp.id === r.id);
                if (p) onPlayer(p);
              }}>
                <Portrait
                  index={s.players.find((p) => p.id === r.id)?.identity.portrait ?? 0}
                  name={r.name}
                  size="tiny"
                />
                <span className="mr-rating-body">
                  <b className="mr-rating-name">
                    {r.name}
                    {top?.id === r.id && <Award size={14} aria-hidden="true" />}
                  </b>
                  <span className="mr-rating-meta">
                    <PositionBadge detail={r.detail} />
                    {r.started ? '先発' : '途中出場'} ・ {r.minutes}分
                    {r.goals > 0 ? ` ・ 得点 ${r.goals}` : ''}
                  </span>
                </span>
                <span className="mr-rating-value" aria-label={`評価点 ${r.rating.toFixed(1)}`}>
                  {r.rating.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {!ratings.length && <p className="muted">出場記録がないため評価点を表示できません。</p>}
      </section>
      {fundsEarned && fundsEarned.length > 0 && (
        <section className="panel mr-funds" aria-label="この試合で得た部費">
          <h2>
            <Wallet size={17} /> この試合で得た部費
          </h2>
          <ul>
            {fundsEarned.map((f, i) => (
              <li key={i}>
                <b>+{f.amount}</b>
                <span>{f.reason}</span>
              </li>
            ))}
          </ul>
        </section>
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
                  <span key={d.label} className={`growth-chip ${d.diff > 0 ? 'up' : 'down'}`}>
                    {d.label} {fmtDiff(d.diff)}
                  </span>
                ))}
                {row.extraDiffs.map((d) => (
                  <span key={d.label} className={`growth-chip ${d.diff > 0 ? 'up' : 'down'}`}>
                    {d.label} {fmtDiff(d.diff)}
                  </span>
                ))}
                {Math.abs(row.trustDiff) >= 1 && (
                  <span className={`growth-chip ${row.trustDiff > 0 ? 'up' : 'down'}`}>
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
                <span key={d.label} className={`growth-chip ${d.diff > 0 ? 'up' : 'down'}`}>
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
      <button type="button" className="primary mr-close" onClick={() => run({ type: 'finish' })}>
        部に戻る <ArrowRight size={18} />
      </button>
      <style>{`
        .mr-screen { display: flex; flex-direction: column; gap: 18px; padding-bottom: 8px; }
        .mr-head { background: var(--card); border: 1px solid var(--border); border-radius: 16px;
          padding: 20px 22px; display: flex; flex-direction: column; gap: 6px; }
        .mr-head h1 { font-size: 22px; margin: 0; }
        .mr-scoreline { display: flex; align-items: center; justify-content: center; gap: 16px;
          font-size: 20px; margin: 10px 0 2px; flex-wrap: wrap; text-align: center; }
        .mr-scoreline strong { font-size: 30px; letter-spacing: 0.04em; }
        .mr-outcome { text-align: center; font-weight: 700; font-size: 15px; margin: 0 0 4px; }
        .mr-outcome-win { color: var(--success); }
        .mr-outcome-lose { color: var(--danger); }
        .mr-rating-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex;
          flex-direction: column; gap: 8px; }
        .mr-rating-row button { width: 100%; display: flex; align-items: center; gap: 12px;
          padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border);
          background: var(--card); text-align: left; min-height: 44px; cursor: pointer; }
        .mr-rating-row.mr-rating-top button { border-color: var(--rank-alpha-fg, #5b21b6);
          background: var(--rank-alpha-bg, #efe6fb); }
        .mr-rating-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .mr-rating-name { display: flex; align-items: center; gap: 6px; }
        .mr-rating-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
          font-size: 12px; color: var(--muted-foreground); }
        .mr-rating-value { font-size: 22px; font-weight: 700; min-width: 2.4em; text-align: right; }
        .mr-funds ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex;
          flex-direction: column; gap: 6px; }
        .mr-funds li { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .mr-funds b { color: var(--success); }
        .mr-close { width: 100%; justify-content: center; display: flex; align-items: center;
          gap: 8px; min-height: 48px; }
      `}</style>
    </section>
  );
}
