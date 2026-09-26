'use client';
// TOUCHLINE ACADEMY v3 — W2: 大会・リーグ体系の表示UI
//
// 単体で完結するコンポーネント。lib/competition.ts の公開APIのみに依存し、
// app/game-ui.tsx など他のファイルは一切触らない。統括側が既存のメニュー
// （部活メニューの「大会・リーグ」タブなど）に
//   <CompetitionPanel state={s} onChoosePrefecture={(id) => run({ type: 'compPrefecture', districtId: id })} />
// を差し込むだけで配線できるように作ってある。run() は既存の
// `(a: Action) => void` 相当のディスパッチ関数（lib/game.ts の act() を
// 呼ぶラッパー）を想定しているが、このファイルは Action 型に一切依存しない
// （CompetitionAction が Action に合流していなくても動く）。
//
// スタイルは Tailwind ユーティリティクラスと既存の shadcn コンポーネント
// （Badge/Button/Table）を基本としつつ、T4.1（順位表）の専用装飾だけは本ファイル末尾の
// <style> タグ（クラス名は lt- 接頭辞）で完結させている。globals.css は一切変更しない。

import { useState } from 'react';
import { MapPin, Star, Trophy, ShieldHalf, ArrowUpCircle, ArrowDownCircle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import type { State } from '@/lib/game';
import {
  readCompetition,
  choosablePrefectures,
  canChoosePrefecture,
  districtById,
  tierInfo,
  computeLeagueTable,
  leagueRemaining,
  leagueNextFixture,
  promotionZoneActive,
  relegationZoneActive,
  cupDrawWeek,
  weekCalendarLabel,
  type District,
  type LeagueTier,
  type CupState,
  type CupBracket,
} from '@/lib/competition';

function Stars({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`激戦度${count}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={13}
          className={i < count ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}
        />
      ))}
    </span>
  );
}

/**
 * 都道府県（赴任先）の選択画面。初期と3年ごとにのみ表示すべきなので、
 * 呼び出し側は canChoosePrefecture(state) を見て表示可否を決めるか、
 * このコンポーネント自身の内部判定に任せてよい（非選択可能時は何も描画しない）。
 */
export function PrefectureSelectPanel({
  state,
  onChoosePrefecture,
  className,
}: {
  state: State;
  onChoosePrefecture: (districtId: string) => void;
  className?: string;
}) {
  if (!canChoosePrefecture(state)) return null;
  const current = readCompetition(state).districtId;
  const districts = choosablePrefectures();
  return (
    <section
      className={'flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm ' + (className ?? '')}
      aria-label="赴任先の選択"
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <MapPin size={14} />
          赴任先の選択
        </span>
        <span className="text-xs text-muted-foreground">
          現在: {districtById(current).name}（3年ごとに選び直せます）
        </span>
      </div>
      {/* T-13: 大会・日程タブを「リーグ順位」サブタブに独立させたところ、47都道府県ぶんの
          選択肢がこのサブタブの縦の長さの大半を占めてしまっていた。滅多に使わない操作
          （3年に一度）なので、既存の「週間メニューを編集」等と同じ <details> に収め、
          既定では畳んでおく（一覧性そのものは開けば変わらない）。 */}
      <details className="prefecture-picker">
        <summary className="text-sm font-medium text-foreground cursor-pointer">
          都道府県を選ぶ（{districts.length}件）
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {districts.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onChoosePrefecture(d.id)}
              aria-pressed={d.id === current}
              className={
                'flex min-h-11 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ' +
                (d.id === current
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border')
              }
            >
              <span className="text-sm font-medium leading-tight">{d.name}</span>
              <Stars count={d.stars} />
              <span className="text-[0.7rem] text-muted-foreground">参加校目安 {d.schools}校</span>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

function tierBadge(tier: LeagueTier) {
  const variant = tier === 'national' ? 'default' : tier === 'regional' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{tierInfo[tier].name}</Badge>;
}

function outcomeLabel(outcome: 'win' | 'draw' | 'lose'): string {
  return outcome === 'win' ? '勝' : outcome === 'draw' ? '分' : '負';
}

/**
 * T4.1/T4.3: 指定チーム（A/B）の順位表（自校＋7クラブ、他校同士の試合も実際に消化した結果から
 * 算出）。残り試合数・次節の相手・首位との勝ち点差を表示し、昇格圏・降格圏は色＋アイコン＋
 * 凡例テキストで示す（色だけに頼らない）。自校の行は強調表示。ライバル校の行をクリックすると
 * そのクラブの今季の戦績一覧（節・相手・スコア・勝敗）を下に展開する。Bチームが今季参戦して
 * いない（comp.teamB が null）場合は、参加条件を示すメッセージだけを表示する。
 */
function LeagueStandingsSection({ state, which }: { state: State; which: 'A' | 'B' }) {
  // フック呼び出しは常に同じ順序で実行する必要があるため、「Bが今季不在」の早期returnより前に
  // useState を呼んでおく（未参加時は selectedId は単に使われない）。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const comp = readCompetition(state);
  const team = which === 'B' ? comp.teamB : comp.teamA;
  const teamLabel = which === 'B' ? 'Bチーム' : 'Aチーム';
  if (!team) {
    return (
      <section
        className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4 shadow-sm"
        aria-label={`${teamLabel}のU18リーグ順位表`}
      >
        <div className="flex items-center gap-2">
          <Trophy size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">{teamLabel}・順位表</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Bチームは今季リーグに参加していません（参加条件: 評判55以上・B所属11人以上）
        </p>
      </section>
    );
  }
  const { rows, resultsByTeam } = computeLeagueTable(state, comp, state.season, which);
  const remaining = leagueRemaining(comp, which);
  const next = leagueNextFixture(comp, which);
  const leader = rows[0];
  const self = rows.find((r) => r.isSelf);
  const behind = leader && self ? Math.max(0, leader.points - self.points) : 0;
  const isLeading = !!leader && !!self && leader.teamId === self.teamId;
  const promoActive = promotionZoneActive(team.tier);
  const relActive = relegationZoneActive(team.tier);
  const selectedRow = selectedId ? rows.find((r) => r.teamId === selectedId) : null;
  const selectedResults = selectedId ? (resultsByTeam[selectedId] ?? []) : [];

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm"
      aria-label={`${teamLabel}のU18リーグ順位表`}
    >
      <div className="flex items-center gap-2">
        <Trophy size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {teamLabel}・{tierInfo[team.tier].name}・順位表
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="lt-stat">
          <span className="lt-stat-label">残り試合数</span>
          <span className="lt-stat-value">{remaining}節</span>
        </div>
        <div className="lt-stat">
          <span className="lt-stat-label">次節の相手</span>
          <span className="lt-stat-value">
            {next ? `${next.opponent}（${next.leg === 0 ? 'ホーム' : 'アウェー'}）` : 'シーズン終了'}
          </span>
        </div>
        <div className="lt-stat">
          <span className="lt-stat-label">首位との勝ち点差</span>
          <span className="lt-stat-value">{isLeading ? '首位' : `-${behind}`}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table aria-label="U18リーグ順位表（横にスクロールできます）">
          <TableHeader>
            <TableRow>
              <TableHead>順位</TableHead>
              <TableHead>学校名</TableHead>
              <TableHead className="text-right">試</TableHead>
              <TableHead className="text-right">勝</TableHead>
              <TableHead className="text-right">分</TableHead>
              <TableHead className="text-right">負</TableHead>
              <TableHead className="text-right">得点</TableHead>
              <TableHead className="text-right">失点</TableHead>
              <TableHead className="text-right">得失差</TableHead>
              <TableHead className="text-right">勝点</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const rank = i + 1;
              const zone: 'promotion' | 'relegation' | null =
                rank <= 2 && promoActive ? 'promotion' : rank >= rows.length - 1 && relActive ? 'relegation' : null;
              const rowClass = [
                zone === 'promotion' ? 'lt-row-up' : '',
                zone === 'relegation' ? 'lt-row-down' : '',
                row.isSelf ? 'lt-row-self' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <TableRow key={row.teamId} className={rowClass || undefined}>
                  <TableCell className="font-medium">
                    <span className="lt-rank-cell">
                      {rank}
                      {zone === 'promotion' && <ArrowUpCircle size={14} className="lt-icon-up" aria-label="昇格圏" />}
                      {zone === 'relegation' && (
                        <ArrowDownCircle size={14} className="lt-icon-down" aria-label="降格圏" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.isSelf ? (
                      <span className="font-semibold">{row.name}（自校）</span>
                    ) : (
                      <button
                        type="button"
                        className="lt-rival-btn"
                        onClick={() => setSelectedId(selectedId === row.teamId ? null : row.teamId)}
                        aria-expanded={selectedId === row.teamId}
                      >
                        {row.name}
                        {row.youth && <span className="lt-youth-badge">ユース</span>}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{row.played}</TableCell>
                  <TableCell className="text-right">{row.win}</TableCell>
                  <TableCell className="text-right">{row.draw}</TableCell>
                  <TableCell className="text-right">{row.lose}</TableCell>
                  <TableCell className="text-right">{row.gf}</TableCell>
                  <TableCell className="text-right">{row.ga}</TableCell>
                  <TableCell className="text-right">{row.gd > 0 ? `+${row.gd}` : row.gd}</TableCell>
                  <TableCell className="text-right font-semibold">{row.points}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {(promoActive || relActive) && (
        <div className="lt-zone-legend">
          {promoActive && (
            <span className="lt-zone-mark lt-zone-up">
              <ArrowUpCircle size={13} aria-hidden="true" />
              昇格圏（上位2位）
            </span>
          )}
          {relActive && (
            <span className="lt-zone-mark lt-zone-down">
              <ArrowDownCircle size={13} aria-hidden="true" />
              降格圏（下位2位）
            </span>
          )}
        </div>
      )}

      {selectedRow && (
        <section className="lt-rival-panel" aria-label={`${selectedRow.name}の戦績`}>
          <div className="lt-rival-panel-header">
            <span className="text-sm font-semibold">{selectedRow.name} の戦績</span>
            <button
              type="button"
              className="lt-rival-close"
              onClick={() => setSelectedId(null)}
              aria-label="ライバル校の戦績を閉じる"
            >
              <X size={16} />
            </button>
          </div>
          {selectedResults.length === 0 ? (
            <p className="text-xs text-muted-foreground">まだ試合がありません。</p>
          ) : (
            <ul className="lt-rival-results">
              {selectedResults
                .slice()
                .sort((a, b) => a.roundIndex - b.roundIndex)
                .map((r) => (
                  <li key={`${r.week}-${r.opponentId}`} className="lt-rival-result-row">
                    <span className="lt-rival-round">第{r.roundIndex + 1}節</span>
                    <span className="lt-rival-opp">{r.opponentName}</span>
                    <span className="lt-rival-score">
                      {r.gf} - {r.ga}
                    </span>
                    <span className={`lt-outcome lt-outcome-${r.outcome}`}>{outcomeLabel(r.outcome)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
      <style>{`
        .lt-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 10px;
          background: var(--card);
        }
        .lt-stat-label {
          font-size: 12px;
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .lt-stat-value {
          font-size: 14px;
          font-weight: 700;
          color: var(--foreground);
        }
        .lt-row-self {
          background: color-mix(in srgb, var(--primary) 14%, var(--card));
        }
        .lt-row-up {
          box-shadow: inset 3px 0 0 var(--success-border);
        }
        .lt-row-down {
          box-shadow: inset 3px 0 0 var(--danger-border);
        }
        .lt-rank-cell {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .lt-icon-up {
          color: var(--success);
        }
        .lt-icon-down {
          color: var(--danger);
        }
        .lt-rival-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 44px;
          padding: 4px 2px;
          background: transparent;
          border: none;
          font-size: 13px;
          font-weight: 400;
          color: var(--foreground);
          text-align: left;
          text-decoration: underline;
          text-decoration-color: var(--border);
          text-underline-offset: 3px;
          cursor: pointer;
        }
        .lt-rival-btn:hover,
        .lt-rival-btn:focus-visible {
          color: var(--primary);
          text-decoration-color: var(--primary);
        }
        .lt-rival-btn:focus-visible {
          outline: 3px solid var(--primary);
          outline-offset: 2px;
        }
        .lt-youth-badge {
          font-size: 11px;
          font-weight: 700;
          color: var(--muted-foreground);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 1px 6px;
        }
        .lt-zone-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 12px;
          font-weight: 400;
          color: var(--muted-foreground);
        }
        .lt-zone-mark {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .lt-zone-up {
          color: var(--success);
        }
        .lt-zone-down {
          color: var(--danger);
        }
        .lt-rival-panel {
          display: flex;
          flex-direction: column;
          gap: 8px;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          background: var(--card);
        }
        .lt-rival-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .lt-rival-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 44px;
          min-height: 44px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--foreground);
          cursor: pointer;
        }
        .lt-rival-close:hover,
        .lt-rival-close:focus-visible {
          border-color: var(--primary);
          color: var(--primary);
        }
        .lt-rival-close:focus-visible {
          outline: 3px solid var(--primary);
          outline-offset: 2px;
        }
        .lt-rival-results {
          display: flex;
          flex-direction: column;
          gap: 4px;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .lt-rival-result-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 400;
          padding: 6px 2px;
          border-bottom: 1px solid var(--border);
        }
        .lt-rival-round {
          min-width: 52px;
          color: var(--muted-foreground);
        }
        .lt-rival-opp {
          flex: 1;
        }
        .lt-rival-score {
          min-width: 52px;
          text-align: center;
          font-weight: 700;
        }
        .lt-outcome {
          min-width: 20px;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
        }
        .lt-outcome-win {
          color: var(--success);
        }
        .lt-outcome-draw {
          color: var(--muted-foreground);
        }
        .lt-outcome-lose {
          color: var(--danger);
        }
      `}</style>
    </section>
  );
}

/**
 * T4.3: A/Bチームの順位表を切り替えて表示するトグル（2択の状態切り替え。既存の赴任先選択
 * ボタンと同じ流儀で aria-pressed を使う。role="radio" はセマンティックHTML優先の方針
 * （lint: jsx-a11y/prefer-tag-over-role）に反するため使わない）。Bチーム側は
 * LeagueStandingsSection 自身が「今季参加していません」のメッセージを出す。
 */
function LeagueSection({ state }: { state: State }) {
  const [which, setWhich] = useState<'A' | 'B'>('A');
  return (
    <div className="flex flex-col gap-2">
      <div className="lt-team-toggle" aria-label="表示するチームの切り替え">
        <button
          type="button"
          aria-pressed={which === 'A'}
          className={`lt-team-toggle-btn${which === 'A' ? ' lt-team-toggle-active' : ''}`}
          onClick={() => setWhich('A')}
        >
          Aチーム
        </button>
        <button
          type="button"
          aria-pressed={which === 'B'}
          className={`lt-team-toggle-btn${which === 'B' ? ' lt-team-toggle-active' : ''}`}
          onClick={() => setWhich('B')}
        >
          Bチーム
        </button>
      </div>
      <LeagueStandingsSection state={state} which={which} />
      <style>{`
        .lt-team-toggle {
          display: inline-flex;
          gap: 4px;
          padding: 3px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--muted);
          width: fit-content;
        }
        .lt-team-toggle-btn {
          min-height: 44px;
          min-width: 44px;
          padding: 6px 14px;
          border: none;
          border-radius: 7px;
          background: transparent;
          font-size: 13px;
          font-weight: 400;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .lt-team-toggle-btn:hover {
          color: var(--foreground);
        }
        .lt-team-toggle-btn:focus-visible {
          outline: 3px solid var(--primary);
          outline-offset: 2px;
        }
        .lt-team-toggle-active {
          background: var(--card);
          color: var(--foreground);
          font-weight: 700;
          box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 12%, transparent);
        }
      `}</style>
    </div>
  );
}

function CupStatus({ name, cup }: { name: string; cup: CupState }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Trophy size={14} />
        {name}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{cup.best}</span>
        {cup.qualified && (
          <Badge variant="secondary" className="text-[0.65rem]">
            全国出場中
          </Badge>
        )}
        {!cup.alive && (
          <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
            敗退
          </Badge>
        )}
      </div>
    </div>
  );
}

const cupRoundLabels = {
  qualifier: ['1回戦', '準々決勝', '準決勝', '決勝'],
  national: ['1回戦', '2回戦', '準々決勝', '準決勝', '決勝'],
};

/** T-12: 抽選前の出場校一覧（組み合わせはまだ無い）。 */
function DrawPendingList({
  bracket,
  cupKey,
  national,
}: {
  bracket: CupBracket;
  cupKey: 'ih' | 'wc';
  national: boolean;
}) {
  const week = cupDrawWeek(cupKey, national);
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/10 p-3"
      aria-label={`${national ? '全国大会' : '県予選'}・抽選前の出場校一覧`}
    >
      <p className="text-sm font-medium">
        抽選前（{weekCalendarLabel(week)}に抽選）
      </p>
      <p className="text-xs text-muted-foreground">出場校（{bracket.teams.length}校）</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
        {bracket.teams.map((team) => (
          <li key={team.id} className={team.id === 'self' ? 'font-semibold' : ''}>
            {team.name}
            {team.id === 'self' ? '（自校）' : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CupBracketView({
  bracket,
  stage,
  cupKey,
}: {
  bracket: CupBracket;
  stage: 'qualifier' | 'national';
  cupKey: 'ih' | 'wc';
}) {
  if (!bracket.drawn) {
    return <DrawPendingList bracket={bracket} cupKey={cupKey} national={stage === 'national'} />;
  }
  const teams = new Map(bracket.teams.map((team) => [team.id, team]));
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A focused scroll region supports keyboard scrolling on narrow screens.
    <section className="overflow-x-auto rounded-lg border border-border/60" tabIndex={0} aria-label={`${stage === 'qualifier' ? '県予選' : '全国大会'}トーナメント表（横にスクロールできます）`}>
      <div className="flex min-w-max gap-3 bg-muted/10 p-3">
        {bracket.rounds.map((matches, round) => (
          <div key={round} className="flex w-44 flex-col" style={{ minHeight: stage === 'national' ? 1190 : 620 }}>
            <h4 className="mb-2 text-center text-xs font-bold">{cupRoundLabels[stage][round]}</h4>
            <div className="flex flex-1 flex-col justify-around gap-2">
              {matches.map((match, index) => (
                <div key={index} className="rounded-lg border border-border bg-card p-2 text-xs" aria-label={`${cupRoundLabels[stage][round]}第${index + 1}試合`}>
                  {([match.homeId, match.awayId] as const).map((id, side) => (
                    <div key={side} className={`flex items-center justify-between gap-2 py-0.5 ${id === match.winnerId ? 'font-bold' : ''}`}>
                      <span className="min-w-0 truncate">{id ? teams.get(id)?.name ?? '勝者未定' : '勝者未定'}{id === 'self' ? '（自校）' : ''}</span>
                      <span>{match.home === null ? '—' : side === 0 ? match.home : match.away}</span>
                    </div>
                  ))}
                  {match.penalties && <div className="mt-1 text-muted-foreground">PK {match.penalties}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CupTournament({ name, cup, cupKey }: { name: string; cup: CupState; cupKey: 'ih' | 'wc' }) {
  if (!cup.qualifier || !cup.national) return null;
  return (
    <details className="rounded-xl border border-border/60 bg-card p-3">
      <summary className="cursor-pointer text-sm font-semibold">{name}のトーナメント表</summary>
      <div className="mt-3 flex flex-col gap-4">
        <div><h3 className="mb-2 text-sm font-semibold">県予選</h3><CupBracketView bracket={cup.qualifier} stage="qualifier" cupKey={cupKey} /></div>
        <div><h3 className="mb-2 text-sm font-semibold">全国大会</h3><CupBracketView bracket={cup.national} stage="national" cupKey={cupKey} /></div>
      </div>
    </details>
  );
}

/**
 * T-13: 大会・日程タブが縦に長くなっていたため、呼び出し側（app/game-ui.tsx）で
 * 「リーグ順位」「トーナメント」のサブタブに分けられるよう、中身を3つの部品に割った。
 * view を指定しなければ従来どおり全部まとめて表示する（既存の呼び出しとの後方互換）。
 */
export function CompetitionStatusSection({
  state,
  onChoosePrefecture,
  className,
}: {
  state: State;
  onChoosePrefecture: (districtId: string) => void;
  className?: string;
}) {
  const comp = readCompetition(state);
  const district = districtById(comp.districtId);
  return (
    <div className={'flex flex-col gap-3 ' + (className ?? '')}>
      <PrefectureSelectPanel state={state} onChoosePrefecture={onChoosePrefecture} />

      <section className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm" aria-label="大会・リーグ状況">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <MapPin size={14} />
            {district.name}
          </span>
          <Stars count={district.stars} />
          {!canChoosePrefecture(state) && (
            <span className="text-xs text-muted-foreground">
              次に選び直せるのは {comp.nextChoiceSeason} 年目から
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CupStatus name="インターハイ" cup={comp.ih} />
          <CupStatus name="選手権" cup={comp.wc} />
        </div>
      </section>

      <LeagueSection state={state} />

      {comp.history.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4 shadow-sm" aria-label="大会の歴史">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldHalf size={14} />
            シーズンの歩み
          </div>
          <ul className="flex flex-col gap-1.5">
            {comp.history.slice(0, 5).map((h) => (
              <li key={h.season} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{h.season}年目</span>
                <span>{districtById(h.districtId).name}</span>
                {tierBadge(h.tierA)}
                <span className="text-muted-foreground">{h.rankA ? `${h.rankA}位` : ''}</span>
                <span className="text-muted-foreground">IH: {h.ihBest}</span>
                <span className="text-muted-foreground">選手権: {h.wcBest}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** T-13: トーナメント表だけをまとめた部品（大会・日程タブの「トーナメント」サブタブ用）。 */
export function CompetitionTournamentSection({ state, className }: { state: State; className?: string }) {
  const comp = readCompetition(state);
  return (
    <div className={'flex flex-col gap-3 ' + (className ?? '')}>
      <CupTournament name="インターハイ" cup={comp.ih} cupKey="ih" />
      <CupTournament name="選手権" cup={comp.wc} cupKey="wc" />
    </div>
  );
}

/**
 * 大会・リーグの現在状況（赴任地区、U18リーグのA/B階層と成績、インターハイ・選手権の進捗、
 * 直近の昇格・降格履歴）をまとめて表示するパネル。後方互換のため残す（サブタブ分割前の全部入り）。
 */
export function CompetitionPanel({
  state,
  onChoosePrefecture,
  className,
}: {
  state: State;
  onChoosePrefecture: (districtId: string) => void;
  className?: string;
}) {
  return (
    <div className={'flex flex-col gap-3 ' + (className ?? '')}>
      <CompetitionStatusSection state={state} onChoosePrefecture={onChoosePrefecture} />
      <CompetitionTournamentSection state={state} />
    </div>
  );
}

/** 参考: DISTRICTS を使った単純な星表示バッジ（一覧などから個別に使いたい場合向け）。 */
export function DistrictBadge({ district }: { district: District }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <MapPin size={12} />
      {district.name}
      <Stars count={district.stars} />
    </span>
  );
}

export default CompetitionPanel;
