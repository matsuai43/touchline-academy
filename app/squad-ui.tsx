'use client';
import { useState } from 'react';
import { Star } from 'lucide-react';
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
import { type State, type Action, type Player, type Position, type Stat } from '@/lib/game';
import {
  squadOverall,
  isBenchPlayer,
  stylesFor,
  detailInfo,
  basePos,
  DETAIL_POS,
  MASTERY_THRESHOLD,
  type ExtraStat,
  type PlayerSquad,
  type DetailPos,
} from '@/lib/squad';
import {
  PositionBadge,
  ArchetypeBadge,
  RankBadge,
  SkillChips,
  MoodBadge,
  PolicyBadge,
} from './ability-sheet';

export { PositionBadge, ArchetypeBadge, SkillChips };

const groupOrder: Position[] = ['GK', 'DF', 'MF', 'FW'];
const groupLabel: Record<Position, string> = {
  GK: 'ゴールキーパー',
  DF: 'ディフェンダー',
  MF: 'ミッドフィルダー',
  FW: 'フォワード',
};
// 一覧で見せる「主要能力」。全9能力ではなく、ポジションに応じた3つ＋総合ランクに絞る。
const primaryStats: Record<Position, { key: Stat | ExtraStat; label: string }[]> = {
  GK: [
    { key: 'keep', label: 'GK技術' },
    { key: 'mental', label: '精神力' },
    { key: 'power', label: 'パワー' },
  ],
  DF: [
    { key: 'defend', label: '守備' },
    { key: 'power', label: 'パワー' },
    { key: 'speed', label: '走力' },
  ],
  MF: [
    { key: 'pass', label: 'パス' },
    { key: 'mental', label: '精神力' },
    { key: 'dribble', label: '突破' },
  ],
  FW: [
    { key: 'shoot', label: '決定力' },
    { key: 'dribble', label: '突破' },
    { key: 'speed', label: '走力' },
  ],
};
function statValue(p: Player, ps: PlayerSquad, key: Stat | ExtraStat): number {
  if (key === 'dribble' || key === 'stamina' || key === 'power') return ps[key as ExtraStat];
  return p.stats[key as Stat];
}

// ポジション・アーキタイプ・能力・特殊能力は AbilitySheet（app/ability-sheet.tsx）に
// 一本化した。ここでは AbilitySheet に含まれない「Aチーム/Bチーム」の所属表示のみ行う
// （A/Bは評価ではなくチーム分けなので、ギリシャ文字ランクの対象にはしない）。
export function SquadProfile({ ps }: { ps: PlayerSquad }) {
  return (
    <div className="squad-profile">
      <span className={`team-badge team-${ps.team}`}>
        {ps.team}チーム{ps.teamManual ? '・指定' : ''}
      </span>
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

// ---------------------------------------------------------------------------
// S4: プレースタイル変更（主ポジションに合うスタイルへ選手詳細から変更できる）。
// 選択肢は常に3つ以下（DESIGN_V3_2.md 5.2）なのでラジオボタンで表す（DADS: 5択以下）。
// ---------------------------------------------------------------------------
export function PlayStyleSelector({
  p,
  ps,
  run,
}: {
  p: Player;
  ps: PlayerSquad;
  run: (a: Action) => State | null;
}) {
  const options = stylesFor(ps.detail);
  if (options.length <= 1) return null;
  return (
    <div className="play-style-selector">
      <span className="play-style-selector-label">プレースタイルを変更</span>
      <RadioGroup
        className="play-style-options"
        aria-label={`${p.name}のプレースタイル`}
        value={ps.style}
        onValueChange={(v) => run({ type: 'squadStyle', id: p.id, style: v as PlayerSquad['style'] })}
      >
        {options.map((st) => (
          <label key={st.id} className={ps.style === st.id ? 'active' : ''}>
            <RadioGroupItem value={st.id} />
            {st.name}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S4: 主ポジション変更。習熟度がMASTERY_THRESHOLD(60)に達したサブポジションのみ
// 選べる（選択肢が6件を超えうるためセレクトで表す。DADS: 6択以上はセレクト可）。
// ---------------------------------------------------------------------------
export function PrimaryPositionSelector({
  p,
  ps,
  run,
}: {
  p: Player;
  ps: PlayerSquad;
  run: (a: Action) => State | null;
}) {
  const eligible = DETAIL_POS.filter(
    (d) => d !== ps.detail && basePos(d) === p.pos && ps.prof[d] >= MASTERY_THRESHOLD,
  );
  if (!eligible.length)
    return (
      <p className="muted primary-pos-hint">
        習熟度が{MASTERY_THRESHOLD}に達したポジションがあると、主ポジションを変更できます。
      </p>
    );
  return (
    <div className="primary-pos-selector">
      <label className="field">
        主ポジションを変更（習熟度{MASTERY_THRESHOLD}以上のサブポジションのみ）
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) run({ type: 'squadPrimaryPos', id: p.id, detail: e.target.value as DetailPos });
          }}
        >
          <option value="">変更先を選ぶ</option>
          {eligible.map((d) => (
            <option key={d} value={d}>
              {detailInfo[d].name}（{d}）
            </option>
          ))}
        </select>
      </label>
    </div>
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
                <TableHead>能力</TableHead>
                <TableHead>特殊能力</TableHead>
                <TableHead>個人方針</TableHead>
                <TableHead>調子</TableHead>
                <TableHead>疲労</TableHead>
                <TableHead>チーム</TableHead>
                <TableHead>起用</TableHead>
                <TableHead>能力シート</TableHead>
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
                    <span className="ability-rank-cell">
                      <RankBadge value={squadOverall(p, ps)} label="総合" size="sm" />
                      {primaryStats[g].map(({ key, label }) => (
                        <RankBadge
                          key={label}
                          value={statValue(p, ps, key)}
                          label={label}
                          size="sm"
                        />
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <SkillChips ps={ps} empty="なし" />
                  </TableCell>
                  <TableCell>
                    {s.v3.trainingPolicy.players[p.id] && (
                      <PolicyBadge policy={s.v3.trainingPolicy.players[p.id]} />
                    )}
                  </TableCell>
                  <TableCell>
                    <MoodBadge value={ps.mood} size="sm" />
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
                    {/* S3: 試合登録20人＝先発11＋ベンチ9。Aチームは常にちょうど20人
                        なので、先発以外のAチームの選手は自動的に全員ベンチ入りになる
                        （手動の入れ替えは先発の起用先を変えることで行う＝既存の
                        「選手を押して起用先を選ぶ」操作）。Bチームは常に控え。 */}
                    <span
                      className={
                        s.lineup.includes(p.id)
                          ? 'lime'
                          : isBenchPlayer(s, p.id)
                            ? 'squad-role-bench'
                            : 'muted'
                      }
                    >
                      {s.lineup.includes(p.id)
                        ? '先発'
                        : isBenchPlayer(s, p.id)
                          ? 'ベンチ'
                          : '控え'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="secondary small ability-toggle"
                      aria-label={`${p.name}の能力シートを見る`}
                      onClick={() => onSelect(p.id)}
                    >
                      能力シートを見る
                    </button>
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
