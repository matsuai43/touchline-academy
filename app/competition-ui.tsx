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
// （Badge/Button/Table）のみで完結させており、globals.css の新規セレクタには
// 依存しない（app/life-ui.tsx と同じ流儀）。

import { MapPin, Star, Trophy, Users2, ShieldHalf } from 'lucide-react';
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
  type District,
  type LeagueTier,
  type TeamLeagueState,
  type CupState,
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {districts.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onChoosePrefecture(d.id)}
            disabled={d.id === current}
            className={
              'flex min-h-11 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ' +
              (d.id === current
                ? 'border-primary/60 bg-primary/10 cursor-default'
                : 'border-border/60 bg-muted/20 hover:bg-muted/50 hover:border-border')
            }
          >
            <span className="text-sm font-medium leading-tight">{d.name}</span>
            <Stars count={d.stars} />
            <span className="text-[0.7rem] text-muted-foreground">参加校目安 {d.schools}校</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function tierBadge(tier: LeagueTier) {
  const variant = tier === 'national' ? 'default' : tier === 'regional' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{tierInfo[tier].name}</Badge>;
}

function TeamStandingRow({ label, team }: { label: string; team: TeamLeagueState }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell>{tierBadge(team.tier)}</TableCell>
      <TableCell className="text-right">{team.played}</TableCell>
      <TableCell className="text-right">{team.win}</TableCell>
      <TableCell className="text-right">{team.draw}</TableCell>
      <TableCell className="text-right">{team.lose}</TableCell>
      <TableCell className="text-right">
        {team.gf}-{team.ga}
      </TableCell>
      <TableCell className="text-right font-semibold">{team.points}</TableCell>
      <TableCell className="text-right text-muted-foreground">
        {team.lastRank ? `${team.lastRank}位` : '—'}
      </TableCell>
    </TableRow>
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

/**
 * 大会・リーグの現在状況（赴任地区、U18リーグのA/B階層と成績、インターハイ・選手権の進捗、
 * 直近の昇格・降格履歴）をまとめて表示するパネル。
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

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>チーム</TableHead>
                <TableHead>階層</TableHead>
                <TableHead className="text-right">試</TableHead>
                <TableHead className="text-right">勝</TableHead>
                <TableHead className="text-right">分</TableHead>
                <TableHead className="text-right">負</TableHead>
                <TableHead className="text-right">得失</TableHead>
                <TableHead className="text-right">点</TableHead>
                <TableHead className="text-right">前季</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TeamStandingRow label="Aチーム" team={comp.teamA} />
              {comp.teamB ? (
                <TeamStandingRow label="Bチーム" team={comp.teamB} />
              ) : (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={9}>
                    <span className="flex items-center gap-1.5">
                      <Users2 size={14} />
                      Bチームはまだリーグに参戦していません（学校評判と部員数が育つと自動参戦します）
                    </span>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CupStatus name="インターハイ" cup={comp.ih} />
          <CupStatus name="選手権" cup={comp.wc} />
        </div>
      </section>

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
