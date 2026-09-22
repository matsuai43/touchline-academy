'use client';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Portrait } from './development-ui';
import { personalities } from '@/lib/development';
import { type State, type Action, type Player, type Position } from '@/lib/game';
import {
  detailInfo,
  archetypes,
  extraStatNames,
  SKILLS,
  squadOverall,
  type DetailPos,
  type Archetype,
  type ExtraStat,
  type PlayerSquad,
} from '@/lib/squad';

const groupOrder: Position[] = ['GK', 'DF', 'MF', 'FW'];
const groupLabel: Record<Position, string> = {
  GK: 'ゴールキーパー',
  DF: 'ディフェンダー',
  MF: 'ミッドフィルダー',
  FW: 'フォワード',
};

export function PositionBadge({ detail }: { detail: DetailPos }) {
  const info = detailInfo[detail];
  return (
    <span
      className={`position pos-${info.base} detail-badge`}
      title={info.name}
    >
      {detail}
    </span>
  );
}
export function ArchetypeBadge({ archetype }: { archetype: Archetype }) {
  const a = archetypes[archetype];
  return (
    <span className="archetype-badge" title={a.desc}>
      {a.name}
    </span>
  );
}
export function SkillChips({
  ps,
  empty = '未習得',
}: {
  ps: PlayerSquad;
  empty?: string;
}) {
  if (!ps.skills.length && !ps.negatives.length)
    return <span className="muted skill-empty">{empty}</span>;
  return (
    <span className="skill-chips">
      {ps.skills.map((id) => (
        <span key={id} className="skill-chip" title={SKILLS[id].desc}>
          {SKILLS[id].name}
        </span>
      ))}
      {ps.negatives.map((id) => (
        <span
          key={id}
          className="skill-chip negative"
          title={SKILLS[id].desc}
        >
          {SKILLS[id].name}
        </span>
      ))}
    </span>
  );
}
function ExtraMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <div>
        <span>{label}</span>
        <b>{Math.round(value)}</b>
      </div>
      <Progress aria-label={label} value={value} />
    </div>
  );
}

export function SquadProfile({ ps }: { ps: PlayerSquad }) {
  return (
    <div className="squad-profile">
      <div className="squad-profile-head">
        <PositionBadge detail={ps.detail} />
        <ArchetypeBadge archetype={ps.archetype} />
        <span className={`team-badge team-${ps.team}`}>
          {ps.team}チーム{ps.teamManual ? '・指定' : ''}
        </span>
      </div>
      <div className="stat-grid">
        {(Object.keys(extraStatNames) as ExtraStat[]).map((k) => (
          <ExtraMeter key={k} label={extraStatNames[k]} value={ps[k]} />
        ))}
      </div>
      <div className="squad-skills">
        <h4>
          特殊能力 <small className="muted">{ps.skills.length} / 5</small>
          {ps.negatives.length > 0 && (
            <small className="muted"> ・マイナス {ps.negatives.length} / 2</small>
          )}
        </h4>
        <SkillChips ps={ps} empty="まだ特殊能力を習得していません。練習の継続や試合の経験で身につきます。" />
      </div>
    </div>
  );
}

export function SquadTeamToggle({
  p,
  ps,
  run,
}: {
  p: Player;
  ps: PlayerSquad;
  run: (a: Action) => State | null;
}) {
  return (
    <button
      className="secondary"
      onClick={() =>
        run({ type: 'squadTeam', id: p.id, team: ps.team === 'A' ? 'B' : 'A' })
      }
    >
      {ps.team === 'A' ? 'Bチームへ移す' : 'Aチームへ指定する'}
    </button>
  );
}

export function SquadPanel({
  s,
  run,
  onSelect,
}: {
  s: State;
  run: (a: Action) => State | null;
  onSelect: (id: number) => void;
}) {
  const [teamFilter, setTeamFilter] = useState<'all' | 'A' | 'B'>('all');
  const [posFilter, setPosFilter] = useState<'all' | Position>('all');
  const [sort, setSort] = useState<'overall' | 'name' | 'fatigue' | 'skills'>(
    'overall',
  );
  const sq = s.v3.squad;
  const rows = s.players
    .map((p) => ({ p, ps: sq.players[p.id] }))
    .filter((r) => !!r.ps)
    .filter((r) => teamFilter === 'all' || r.ps.team === teamFilter)
    .filter((r) => posFilter === 'all' || r.p.pos === posFilter);
  const sorter = (
    a: { p: Player; ps: PlayerSquad },
    b: { p: Player; ps: PlayerSquad },
  ) => {
    if (sort === 'name') return a.p.name.localeCompare(b.p.name, 'ja');
    if (sort === 'fatigue') return b.p.fatigue - a.p.fatigue;
    if (sort === 'skills')
      return (
        b.ps.skills.length +
        b.ps.negatives.length -
        (a.ps.skills.length + a.ps.negatives.length)
      );
    return squadOverall(b.p, b.ps) - squadOverall(a.p, a.ps);
  };
  const aCount = s.players.filter((p) => sq.players[p.id]?.team === 'A').length;
  const groups = groupOrder
    .map((g) => ({
      g,
      list: rows.filter((r) => r.p.pos === g).sort(sorter),
    }))
    .filter((x) => x.list.length);
  return (
    <section className="panel roster-panel squad-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">SQUAD LIST</span>
          <h2>
            部員一覧{' '}
            <span className="muted">
              {s.players.length}名（A {aCount} / B {s.players.length - aCount}）
            </span>
          </h2>
        </div>
        <button className="secondary small" onClick={() => run({ type: 'squadAuto' })}>
          A/B自動振り分け
        </button>
      </div>
      <div className="squad-filters">
        <div className="squad-filter-group">
          {(['all', 'A', 'B'] as const).map((v) => (
            <button
              key={v}
              className={`chip-filter ${teamFilter === v ? 'active' : ''}`}
              onClick={() => setTeamFilter(v)}
            >
              {v === 'all' ? '全チーム' : `${v}チーム`}
            </button>
          ))}
        </div>
        <div className="squad-filter-group">
          {(['all', ...groupOrder] as const).map((v) => (
            <button
              key={v}
              className={`chip-filter ${posFilter === v ? 'active' : ''}`}
              onClick={() => setPosFilter(v)}
            >
              {v === 'all' ? '全ポジション' : v}
            </button>
          ))}
        </div>
        <div className="squad-sort">
          <span>並び替え</span>
          {/* DADS: 選択肢が5つ以下のセレクトはラジオボタンにする。 */}
          <RadioGroup
            className="sort-options"
            aria-label="並び替え"
            value={sort}
            onValueChange={(v) => setSort(v as typeof sort)}
          >
            {(
              [
                ['overall', '総合力'],
                ['name', '名前'],
                ['fatigue', '疲労'],
                ['skills', '特殊能力数'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className={sort === v ? 'active' : ''}>
                <RadioGroupItem value={v} />
                {label}
              </label>
            ))}
          </RadioGroup>
        </div>
      </div>
      {groups.map(({ g, list }) => (
        <div className="squad-group" key={g}>
          <h3 className="squad-group-title">
            {groupLabel[g]} <span className="muted">{list.length}名</span>
          </h3>
          <Table aria-label={`${groupLabel[g]}の一覧表（横にスクロールできます）`}>
            <TableHeader>
              <TableRow>
                <TableHead>選手 / 学年</TableHead>
                <TableHead>ポジション</TableHead>
                <TableHead>アーキタイプ</TableHead>
                <TableHead>総合</TableHead>
                <TableHead>特殊能力</TableHead>
                <TableHead>疲労</TableHead>
                <TableHead>チーム</TableHead>
                <TableHead>起用</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map(({ p, ps }) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <button className="player-link" onClick={() => onSelect(p.id)}>
                      <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
                      <span className="roster-name">
                        {p.name}
                        {s.focus === p.id && (
                          <span className="focus-dot">
                            <Star size={12} aria-hidden="true" fill="currentColor" />
                            <span className="sr-only">重点育成中</span>
                          </span>
                        )}
                        <small>
                          {p.year}年 /{' '}
                          {p.injury
                            ? `調整 ${p.injury}週`
                            : personalities[p.identity.personality].name}
                        </small>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <PositionBadge detail={ps.detail} />
                  </TableCell>
                  <TableCell>
                    <ArchetypeBadge archetype={ps.archetype} />
                  </TableCell>
                  <TableCell>
                    <b className="overall">{squadOverall(p, ps)}</b>
                  </TableCell>
                  <TableCell>
                    <SkillChips ps={ps} empty="なし" />
                  </TableCell>
                  <TableCell>
                    <span className={p.fatigue > 65 ? 'danger-text' : ''}>
                      {Math.round(p.fatigue)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`team-badge team-${ps.team}`}>{ps.team}</span>
                  </TableCell>
                  <TableCell>
                    <span className={s.lineup.includes(p.id) ? 'lime' : 'muted'}>
                      {s.lineup.includes(p.id) ? '先発' : '控え'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      {!rows.length && (
        <p className="muted">条件に合う選手がいません。絞り込みを見直してください。</p>
      )}
    </section>
  );
}
