'use client';
// T1: 試合終了後の「試合結果」画面。
// 試合画面（app/match-ui.tsx の MatchView）の下に続けるのではなく、m.done のときは
// MatchView がこのコンポーネントだけを描く（試合ビューの置き換え）。スコアボード・タイム
// ライン・MOTM・成長差分（旧 MatchSummary から移設）に加えて、選手ごとの評価点
// （lib/match-rating.ts、10点満点・決定的）と、この試合で得た部費の表示枠を持つ。
import { useState, type ReactNode } from 'react';
import { Portrait } from './development-ui';
import { PositionBadge } from './ability-sheet';
import {
  extraStatNames,
  detailInfo,
  SKILLS,
  type ExtraStat,
} from '@/lib/squad';
import { stats, type State, type Action, type Player, type Stat } from '@/lib/game';
import { matchRatings, topRated, type PlayerRating } from '@/lib/match-rating';
import { ownTeamTotals, zeroPlayerStats, type PlayerMatchStats } from '@/lib/match-stats';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Award, ArrowRight, ArrowDown, ArrowUp, Wallet, Trophy } from 'lucide-react';

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
// M2: 評価点の行に「この試合で伸びた能力」を添える。能力・特殊能力・信頼・習熟度の変化は
// いずれもキックオフ時点のスナップショット（m.snapshot）との実際の差分で出す。
// ---------------------------------------------------------------------------
function actualProfGrowth(s: State, id: number): { name: string; amount: number }[] {
  // すでに100の主ポジションは伸びないので表示されない。snapshot.prof が無い旧セーブの
  // 試合では何も出さない（推定値は出さない）。
  const before = s.match?.snapshot?.find((e) => e.id === id)?.prof;
  const now = s.v3.squad.players[id]?.prof;
  if (!before || !now) return [];
  return (Object.keys(now) as (keyof typeof now)[])
    .map((k) => ({ k, diff: (now[k] ?? 0) - (before[k] ?? 0) }))
    .filter((d) => d.diff >= 0.5)
    .sort((a, b) => b.diff - a.diff)
    .map((d) => ({ name: detailInfo[d.k].name, amount: Math.round(d.diff) }))
    .filter((d) => d.amount >= 1);
}
type GrowthChip = { key: string; label: string; cls: 'up' | 'down' | 'skill-new' };
function growthChipsFor(s: State, row: PlayerRating, g: GrowthRowLike | undefined): GrowthChip[] {
  const chips: GrowthChip[] = [];
  if (g) {
    for (const d of g.statDiffs)
      chips.push({ key: `s-${d.label}`, label: `${d.label} ${fmtDiff(d.diff)}`, cls: d.diff > 0 ? 'up' : 'down' });
    for (const d of g.extraDiffs)
      chips.push({ key: `e-${d.label}`, label: `${d.label} ${fmtDiff(d.diff)}`, cls: d.diff > 0 ? 'up' : 'down' });
    if (Math.abs(g.trustDiff) >= 1)
      chips.push({ key: 'trust', label: `信頼 ${fmtDiff(g.trustDiff)}`, cls: g.trustDiff > 0 ? 'up' : 'down' });
    for (const id of g.newSkills)
      chips.push({ key: `skill-${id}`, label: `習得：${SKILLS[id]?.name ?? id}`, cls: 'skill-new' });
  }
  for (const prof of actualProfGrowth(s, row.id))
    chips.push({ key: `prof-${prof.name}`, label: `習熟度 ${prof.name} +${prof.amount}`, cls: 'up' });
  return chips;
}

// ---------------------------------------------------------------------------
// M2: 選手ごとのスタッツ表（DESIGN_V3_4.md 4章）。区分（攻撃／パス／守備／GK／
// フィジカル）を切り替えると列が変わる。旧セーブの試合途中（m.playerStats が無い）
// では呼び出し側がそもそもこのテーブルを描かない。
// ---------------------------------------------------------------------------
type StatCategory = 'attack' | 'pass' | 'defense' | 'gk' | 'physical';
const CATEGORY_ORDER: StatCategory[] = ['attack', 'pass', 'defense', 'gk', 'physical'];
const CATEGORY_LABEL: Record<StatCategory, string> = {
  attack: '攻撃',
  pass: 'パス',
  defense: '守備',
  gk: 'GK',
  physical: 'フィジカル',
};
type StatColumn = {
  key: string;
  label: string;
  value: (row: PlayerRating, st: PlayerMatchStats, cleanSheet: boolean) => number;
  render: (row: PlayerRating, st: PlayerMatchStats, cleanSheet: boolean) => ReactNode;
};
function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '−';
}
const FIXED_COLUMNS: StatColumn[] = [
  { key: 'minutes', label: '出場時間', value: (r) => r.minutes, render: (r) => `${r.minutes}分` },
  { key: 'rating', label: '評価点', value: (r) => r.rating, render: (r) => r.rating.toFixed(1) },
];
const CATEGORY_COLUMNS: Record<StatCategory, StatColumn[]> = {
  attack: [
    { key: 'goals', label: '得点', value: (r, st) => st.goals, render: (r, st) => st.goals },
    { key: 'assists', label: 'アシスト', value: (r, st) => st.assists, render: (r, st) => st.assists },
    {
      key: 'shots',
      label: 'シュート（枠内）',
      value: (r, st) => st.shots,
      render: (r, st) => `${st.shots}（${st.shotsOnTarget}）`,
    },
    {
      key: 'dribbles',
      label: 'ドリブル（成功/試行）',
      value: (r, st) => st.dribblesCompleted,
      render: (r, st) => `${st.dribblesCompleted}/${st.dribblesAttempted}`,
    },
    {
      key: 'crosses',
      label: 'クロス（成功/試行）',
      value: (r, st) => st.crossCompleted,
      render: (r, st) => `${st.crossCompleted}/${st.crossAttempted}`,
    },
  ],
  pass: [
    {
      key: 'passes',
      label: 'パス（成功/試行）',
      value: (r, st) => st.passesCompleted,
      render: (r, st) => `${st.passesCompleted}/${st.passesAttempted}`,
    },
    {
      key: 'passRate',
      label: 'パス成功率',
      value: (r, st) => (st.passesAttempted > 0 ? st.passesCompleted / st.passesAttempted : 0),
      render: (r, st) => pct(st.passesCompleted, st.passesAttempted),
    },
    {
      key: 'finalThird',
      label: '敵陣パス成功率',
      value: (r, st) => (st.finalThirdPassAttempted > 0 ? st.finalThirdPassCompleted / st.finalThirdPassAttempted : 0),
      render: (r, st) => pct(st.finalThirdPassCompleted, st.finalThirdPassAttempted),
    },
    {
      key: 'longPass',
      label: 'ロングパス成功率',
      value: (r, st) => (st.longPassAttempted > 0 ? st.longPassCompleted / st.longPassAttempted : 0),
      render: (r, st) => pct(st.longPassCompleted, st.longPassAttempted),
    },
    { key: 'keyPasses', label: 'キーパス', value: (r, st) => st.keyPasses, render: (r, st) => st.keyPasses },
  ],
  defense: [
    {
      key: 'duels',
      label: 'デュエル（勝利/試行）',
      value: (r, st) => st.duelsWon,
      render: (r, st) => `${st.duelsWon}/${st.duelsAttempted}`,
    },
    {
      key: 'aerials',
      label: '空中戦（勝利/試行）',
      value: (r, st) => st.aerialsWon,
      render: (r, st) => `${st.aerialsWon}/${st.aerialsAttempted}`,
    },
    { key: 'tackles', label: 'タックル', value: (r, st) => st.tackles, render: (r, st) => st.tackles },
    { key: 'interceptions', label: 'インターセプト', value: (r, st) => st.interceptions, render: (r, st) => st.interceptions },
    { key: 'clearances', label: 'クリア', value: (r, st) => st.clearances, render: (r, st) => st.clearances },
    { key: 'turnovers', label: 'ボールロスト', value: (r, st) => st.turnovers, render: (r, st) => st.turnovers },
  ],
  gk: [
    { key: 'saves', label: 'セーブ', value: (r, st) => st.saves, render: (r, st) => st.saves },
    { key: 'shotsFaced', label: '被枠内シュート', value: (r, st) => st.shotsFaced, render: (r, st) => st.shotsFaced },
    { key: 'goalsConceded', label: '失点', value: (r, st) => st.goalsConceded, render: (r, st) => st.goalsConceded },
    { key: 'highClaims', label: 'ハイボール処理', value: (r, st) => st.highClaims, render: (r, st) => st.highClaims },
    {
      key: 'cleanSheet',
      label: 'クリーンシート',
      value: (r, st, cs) => (r.pos === 'GK' && cs ? 1 : 0),
      render: (r, st, cs) => (r.pos === 'GK' && cs ? '○' : '−'),
    },
  ],
  physical: [
    {
      key: 'distanceKm',
      label: '走行距離（km）',
      value: (r, st) => st.distanceKm,
      render: (r, st) => st.distanceKm.toFixed(1),
    },
    { key: 'sprints', label: 'スプリント', value: (r, st) => st.sprints, render: (r, st) => st.sprints },
    {
      key: 'topSpeed',
      label: 'トップスピード（km/h）',
      value: (r, st) => st.topSpeedKmh,
      render: (r, st) => st.topSpeedKmh.toFixed(1),
    },
  ],
};
type LeaderDef = { key: string; label: string; value: (st: PlayerMatchStats) => number; format?: (n: number) => string };
const LEADER_DEFS: LeaderDef[] = [
  { key: 'duelsWon', label: '最多デュエル勝利', value: (st) => st.duelsWon },
  { key: 'passesCompleted', label: '最多パス成功', value: (st) => st.passesCompleted },
  { key: 'distanceKm', label: '最多走行距離', value: (st) => st.distanceKm, format: (n) => `${n.toFixed(1)}km` },
  { key: 'saves', label: '最多セーブ', value: (st) => st.saves },
];
function computeLeaders(ratings: PlayerRating[], playerStats: Record<number, PlayerMatchStats>) {
  return LEADER_DEFS.map((def) => {
    let best: { name: string; val: number } | null = null;
    for (const row of ratings) {
      const st = playerStats[row.id];
      if (!st) continue;
      const val = def.value(st);
      if (val <= 0) continue;
      if (!best || val > best.val) best = { name: row.name, val };
    }
    if (!best) return null;
    return { key: def.key, label: def.label, name: best.name, display: def.format ? def.format(best.val) : `${Math.round(best.val)}` };
  }).filter((x): x is { key: string; label: string; name: string; display: string } => !!x);
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
  /** T4.2: 通常は渡さず、s.fundHistory から自動で算出する（下記参照）。テストなど
   *  値を明示したい場合だけ上書きに使える。 */
  fundsEarned?: { amount: number; reason: string }[];
}) {
  const m = s.match!;
  // T4.2: この試合で得た部費。試合中の収入（勝利ボーナス・大会の勝ち上がり等）は
  // すべて試合が行われた週・その週の日曜(day===6)というただ1つの時点で記録される
  // （resolveCompetitionMatch は simulateSegment から同期的に呼ばれるため）ので、
  // s.fundHistory から「現在の週・曜日(=6、試合が続く間はdayは6のまま)」に一致する
  // 記録を抽出すれば、この試合ぶんの収入だけを取り出せる（週の部費・年度予算・半年目標は
  // 別の曜日/週に記録されるため混ざらない）。
  const matchFunds =
    fundsEarned ??
    (s.fundHistory ?? [])
      .filter((f) => f.week === s.week && f.day === 6)
      .slice()
      .reverse();
  const ratings = matchRatings(s);
  const top = topRated(ratings);
  const cleanSheet = m.away === 0;
  const motmPlayer = top ? s.players.find((p) => p.id === top.id) : null;
  const growth = computeGrowth(s);
  const growthById = new Map(growth.map((g) => [g.id, g]));
  // M2: 活躍と見返りの関係が一目で分かるよう、成長差分は評価点の高い順に並べる。
  const ratingRank = new Map(ratings.map((r, i) => [r.id, i]));
  const notableGrowth = growth
    .filter(isNotableGrowth)
    .slice()
    .sort((a, b) => (ratingRank.get(a.id) ?? 999) - (ratingRank.get(b.id) ?? 999));
  const minorGrowth = groupMinorGrowth(growth);
  const timeline = buildTimeline(s);
  // M2: 選手ごとのスタッツ表。旧セーブの途中試合（m.playerStats が無い）では表を出さない。
  const hasStats = !!m.playerStats;
  const ownTotals = hasStats ? ownTeamTotals(m) : null;
  const leaders = hasStats ? computeLeaders(ratings, m.playerStats!) : [];
  const [statCategory, setStatCategory] = useState<StatCategory>('attack');
  const [statSort, setStatSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'rating',
    dir: 'desc',
  });
  const statColumns = [...FIXED_COLUMNS, ...CATEGORY_COLUMNS[statCategory]];
  const activeStatCol = statColumns.find((c) => c.key === statSort.key) ?? FIXED_COLUMNS[1];
  const statFor = (id: number) => m.playerStats?.[id] ?? zeroPlayerStats();
  const sortedStatRows = hasStats
    ? ratings.slice().sort((a, b) => {
        const av = activeStatCol.value(a, statFor(a.id), cleanSheet);
        const bv = activeStatCol.value(b, statFor(b.id), cleanSheet);
        return statSort.dir === 'desc' ? bv - av : av - bv;
      })
    : [];
  const toggleStatSort = (key: string) =>
    setStatSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
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
          {hasStats && ownTotals && (
            <>
              <span>
                パス数{' '}
                <b>
                  {ownTotals.passesAttempted} — {m.opponentTotals?.passesAttempted ?? 0}
                </b>
              </span>
              <span>
                パス成功率{' '}
                <b>
                  {pct(ownTotals.passesCompleted, ownTotals.passesAttempted)} —{' '}
                  {pct(m.opponentTotals?.passesCompleted ?? 0, m.opponentTotals?.passesAttempted ?? 0)}
                </b>
              </span>
              <span>
                デュエル勝率{' '}
                <b>
                  {pct(ownTotals.duelsWon, ownTotals.duelsAttempted)} —{' '}
                  {pct(m.opponentTotals?.duelsWon ?? 0, m.opponentTotals?.duelsAttempted ?? 0)}
                </b>
              </span>
            </>
          )}
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
                  {/* M2: 評価点の高い選手ほど伸びていることが一目で分かるよう、評価点順の
                      この行にそのまま「この試合で伸びた能力」を添える。 */}
                  {(() => {
                    const chips = growthChipsFor(s, r, growthById.get(r.id));
                    if (!chips.length) return null;
                    return (
                      <span className="mr-rating-growth" aria-label="この試合で伸びた能力">
                        {chips.map((c) => (
                          <span key={c.key} className={`growth-chip ${c.cls}`}>
                            {c.label}
                          </span>
                        ))}
                      </span>
                    );
                  })()}
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
      <section className="panel mr-stats" aria-label="選手ごとのスタッツ">
        <h2>選手ごとのスタッツ</h2>
        {hasStats ? (
          <>
            <p className="muted">
              区分を切り替えると列が変わります。見出しをクリックすると並べ替えられます。
            </p>
            {leaders.length > 0 && (
              <div className="mr-stat-leaders">
                <h3>
                  <Trophy size={15} aria-hidden="true" /> 部門別の最多
                </h3>
                <ul>
                  {leaders.map((l) => (
                    <li key={l.key}>
                      <span className="mr-stat-leader-label">{l.label}</span>
                      <b>{l.name}</b>
                      <span className="mr-stat-leader-value">{l.display}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <RadioGroup
              className="mr-stat-tabs"
              aria-label="スタッツの区分"
              value={statCategory}
              onValueChange={(v) => {
                setStatCategory(v as StatCategory);
                setStatSort({ key: 'rating', dir: 'desc' });
              }}
            >
              {CATEGORY_ORDER.map((c) => (
                <label key={c} className={statCategory === c ? 'active' : ''}>
                  <RadioGroupItem value={c} />
                  {CATEGORY_LABEL[c]}
                </label>
              ))}
            </RadioGroup>
            <Table aria-label={`選手ごとのスタッツ（${CATEGORY_LABEL[statCategory]}）`}>
              <TableHeader>
                <TableRow>
                  <TableHead className="mr-stat-name-col">選手</TableHead>
                  {statColumns.map((col) => (
                    <TableHead key={col.key} aria-sort={
                      statSort.key === col.key ? (statSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'
                    }>
                      <button type="button" className="mr-stat-sort-btn" onClick={() => toggleStatSort(col.key)}>
                        {col.label}
                        {statSort.key === col.key &&
                          (statSort.dir === 'desc' ? (
                            <ArrowDown size={14} aria-hidden="true" />
                          ) : (
                            <ArrowUp size={14} aria-hidden="true" />
                          ))}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStatRows.map((row) => {
                  const st = statFor(row.id);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="mr-stat-name-col">
                        <button
                          type="button"
                          className="mr-stat-name-btn"
                          onClick={() => {
                            const p = s.players.find((pp) => pp.id === row.id);
                            if (p) onPlayer(p);
                          }}
                        >
                          {row.name}
                        </button>
                        <PositionBadge detail={row.detail} />
                      </TableCell>
                      {statColumns.map((col) => (
                        <TableCell key={col.key}>{col.render(row, st, cleanSheet)}</TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        ) : (
          <p className="muted">この試合は選手別の記録がありません。</p>
        )}
      </section>
      {matchFunds.length > 0 && (
        <section className="panel mr-funds" aria-label="この試合で得た部費">
          <h2>
            <Wallet size={17} /> この試合で得た部費
          </h2>
          <ul>
            {matchFunds.map((f, i) => (
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
        .mr-rating-row.mr-rating-top button { border-color: var(--rank-A-fg, #5b21b6);
          background: var(--rank-A-bg, #efe6fb); }
        .mr-rating-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .mr-rating-name { display: flex; align-items: center; gap: 6px; }
        .mr-rating-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
          font-size: 12px; color: var(--muted-foreground); }
        .mr-rating-value { font-size: 22px; font-weight: 700; min-width: 2.4em; text-align: right; }
        .mr-rating-growth { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
        .mr-funds ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex;
          flex-direction: column; gap: 6px; }
        .mr-funds li { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .mr-funds b { color: var(--success); }
        .mr-close { width: 100%; justify-content: center; display: flex; align-items: center;
          gap: 8px; min-height: 48px; }
        /* M2: 選手ごとのスタッツ表 */
        .mr-stat-leaders { margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--border);
          border-radius: 10px; background: var(--accent); }
        .mr-stat-leaders h3 { display: flex; align-items: center; gap: 6px; font-size: 13px;
          margin: 0 0 8px; color: var(--muted-foreground); }
        .mr-stat-leaders ul { list-style: none; margin: 0; padding: 0; display: flex;
          flex-direction: column; gap: 5px; }
        .mr-stat-leaders li { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
          font-size: 13px; }
        .mr-stat-leader-label { color: var(--muted-foreground); min-width: 8.5em; }
        .mr-stat-leader-value { color: var(--muted-foreground); font-size: 12px; }
        .mr-stat-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 10px; }
        .mr-stat-tabs > label { display: flex; align-items: center; gap: 6px; min-height: 44px;
          padding: 4px 14px; border: 1px solid var(--border); border-radius: 999px;
          background: var(--card); color: var(--muted-foreground); font-size: 13px; cursor: pointer; }
        .mr-stat-tabs > label.active { border-color: var(--primary); color: var(--primary);
          background: var(--accent); }
        .mr-stat-name-col { position: sticky; left: 0; background: var(--card); z-index: 1; }
        .mr-stat-name-btn { display: block; background: none; border: none; padding: 0;
          font: inherit; color: var(--primary); text-align: left; cursor: pointer; min-height: 22px; }
        .mr-stat-sort-btn { display: inline-flex; align-items: center; background: none; border: none;
          padding: 6px 2px; font: inherit; font-weight: 700; color: inherit; cursor: pointer;
          white-space: nowrap; min-height: 32px; }
      `}</style>
    </section>
  );
}
