'use client';
// V4-2 (DESIGN_V4 6章): 「今月の育成方針」画面。
// 1画面で3つを決める: 6.1 ポジション×学年の一括設定 / 6.2 方針と能力の対応の説明
// （選手ごとの「先月伸びた能力」も表示） / 6.3 重点育成選手。
// 10.6 U3: 個人の一覧は1人1行（ポジション札・名前学年・主な能力2つ・方針・先月の伸び・
// 個別札）にまとめ、ポジション・学年で絞り込める。行の名前を押すと既存の選手詳細を開く
// （能力シート・重点育成の指定はそちらに残す）。「育成の見通し（あと約n週）」はユーザー
// 判断により実装しない（DESIGN_V4 10.5）。
import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { RankBadge, growthKeyLabel } from './ability-sheet';
import {
  detailInfo,
  DETAIL_POS,
  basePos,
  extraStatNames,
  type DetailPos,
  type PlayerSquad,
  type ExtraStat,
} from '@/lib/squad';
import { type State, type Action, type Player, type Position, type Stat, stats } from '@/lib/game';
import {
  POLICY_KEYS,
  policyInfo,
  needsMonthlyReview,
  resolveEffectivePolicy,
  POSITION_GROUPS,
  GRADE_YEARS,
  groupKey,
  type PolicyKey,
} from '@/lib/training-policy';

const POS_LABEL: Record<Position, string> = { GK: 'GK', DF: 'DF', MF: 'MF', FW: 'FW' };
const POS_FULL_LABEL: Record<Position, string> = {
  GK: 'ゴールキーパー',
  DF: 'ディフェンダー',
  MF: 'ミッドフィルダー',
  FW: 'フォワード',
};
// 6.2: 方針ごとに「伸びる能力」を選手画面の能力名そのままで示す（方針名自体も
// このファイル内 lib/training-policy.ts の policyInfo で能力名にそろえてある）。
const policyStatLabel: Record<PolicyKey, string> = {
  auto: 'アーキタイプ・プレースタイルに合う能力（自動選択）',
  shoot: stats.shoot,
  pass: stats.pass,
  defend: stats.defend,
  speed: stats.speed,
  mental: stats.mental,
  dribble: extraStatNames.dribble,
  physical: `${extraStatNames.stamina}・${extraStatNames.power}`,
  keep: stats.keep,
  position: '指定したポジションの習熟度',
};
function policyOptionsFor(pos: Position): PolicyKey[] {
  return POLICY_KEYS.filter((k) => k !== 'keep' || pos === 'GK');
}
// 「ポジション習得」に切り替えたときの既定の対象（現在の主ポジション以外の
// サブポジションを優先する。既存の PolicyFields の既定選択と同じ考え方）。
function defaultPositionTarget(p: Player, sq: PlayerSquad | undefined, current: DetailPos | null): DetailPos | null {
  if (current) return current;
  const options = DETAIL_POS.filter((d) => basePos(d) === p.pos);
  return options.find((d) => d !== sq?.detail) ?? options[0] ?? null;
}

// ---------------------------------------------------------------------------
// 一括設定（6.1）: ポジション×学年の1マス分の選択欄。
// ---------------------------------------------------------------------------
function GroupPolicySelect({
  pos,
  year,
  value,
  run,
}: {
  pos: Position;
  year: number;
  value: PolicyKey;
  run: (a: Action) => State | null;
}) {
  return (
    <select
      className="policy-group-select"
      aria-label={`${POS_FULL_LABEL[pos]}・${year}年の一括方針`}
      value={value}
      onChange={(e) =>
        run({ type: 'trainingPolicyGroupSet', pos, year, policy: e.target.value as PolicyKey })
      }
    >
      {policyOptionsFor(pos).map((k) => (
        <option key={k} value={k}>
          {policyInfo[k].name}
        </option>
      ))}
    </select>
  );
}

function PolicyGroupGrid({ s, run }: { s: State; run: (a: Action) => State | null }) {
  const tp = s.v3.trainingPolicy;
  return (
    <div className="policy-group-grid">
      {POSITION_GROUPS.map((pos) => (
        <div className="policy-group-row" key={pos}>
          <span className="policy-group-row-label" title={POS_FULL_LABEL[pos]}>
            {POS_LABEL[pos]}
          </span>
          <div className="policy-group-row-cells">
            {GRADE_YEARS.map((year) => (
              <label className="policy-group-cell" key={year}>
                <span className="policy-group-cell-year">{year}年</span>
                <GroupPolicySelect pos={pos} year={year} value={tp.groups[groupKey(pos, year)]} run={run} />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 方針と能力の対応の説明（6.2）。
// ---------------------------------------------------------------------------
function PolicyExplainTable() {
  return (
    <table className="policy-explain-table">
      <thead>
        <tr>
          <th scope="col">方針</th>
          <th scope="col">伸びる能力</th>
        </tr>
      </thead>
      <tbody>
        {POLICY_KEYS.map((k) => (
          <tr key={k}>
            <th scope="row">{policyInfo[k].name}</th>
            <td>{policyStatLabel[k]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// U3: 1人1行の個人方針の選択欄（個別に変更すると「個別」の扱いになる）。
// ---------------------------------------------------------------------------
function PlayerPolicySelect({
  p,
  sq,
  eff,
  run,
}: {
  p: Player;
  sq: PlayerSquad | undefined;
  eff: { key: PolicyKey; target: DetailPos | null };
  run: (a: Action) => State | null;
}) {
  return (
    <div className="policy-row-select">
      <select
        aria-label={`${p.name}の個人方針`}
        value={eff.key}
        onChange={(e) => {
          const key = e.target.value as PolicyKey;
          if (key === 'position') {
            run({
              type: 'trainingPolicySet',
              id: p.id,
              policy: 'position',
              target: defaultPositionTarget(p, sq, eff.target),
            });
          } else {
            run({ type: 'trainingPolicySet', id: p.id, policy: key });
          }
        }}
      >
        {policyOptionsFor(p.pos).map((k) => (
          <option key={k} value={k}>
            {policyInfo[k].name}
          </option>
        ))}
      </select>
      {eff.key === 'position' && (
        <select
          aria-label={`${p.name}の鍛えるポジション`}
          value={eff.target ?? ''}
          onChange={(e) => {
            const target = e.target.value as DetailPos;
            if (target) run({ type: 'trainingPolicySet', id: p.id, policy: 'position', target });
          }}
        >
          <option value="" disabled>
            ポジションを選ぶ
          </option>
          {DETAIL_POS.filter((d) => basePos(d) === p.pos).map((d) => (
            <option key={d} value={d}>
              {detailInfo[d].name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// 一覧の「主な能力2つ」: core Stat・拡張能力（突破/持久/パワー）の中から値が高い順に2つ。
function topAbilities(p: Player, sq: PlayerSquad | undefined): { label: string; value: number }[] {
  if (!sq) return [];
  const all = [
    ...(Object.keys(stats) as Stat[]).map((k) => ({ label: stats[k], value: p.stats[k] })),
    ...(Object.keys(extraStatNames) as ExtraStat[]).map((k) => ({ label: extraStatNames[k], value: sq[k] })),
  ];
  return all.sort((a, b) => b.value - a.value).slice(0, 2);
}

function growthSummary(growth: Record<string, number>): string {
  const entries = Object.entries(growth)
    .filter(([, v]) => v >= 0.1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!entries.length) return 'なし';
  return entries.map(([k, v]) => `${growthKeyLabel(k)} +${(Math.round(v * 10) / 10).toFixed(1)}`).join('・');
}

function PlayerPolicyRow({
  s,
  p,
  run,
  onOpenDetail,
}: {
  s: State;
  p: Player;
  run: (a: Action) => State | null;
  onOpenDetail: (id: number) => void;
}) {
  const tp = s.v3.trainingPolicy;
  const pol = tp.players[p.id];
  const sq = s.v3.squad.players[p.id];
  const eff = resolveEffectivePolicy(s, p);
  return (
    <li className="policy-row">
      <div className="policy-row-head">
        <span className={`position pos-${p.pos} policy-row-pos`} aria-hidden="true">
          {p.pos}
        </span>
        <button type="button" className="policy-row-name" onClick={() => onOpenDetail(p.id)}>
          <span>
            {p.name}
            <small>{p.year}年</small>
          </span>
        </button>
        {pol.individual && <span className="policy-row-individual-tag">個別</span>}
      </div>
      <div className="policy-row-abilities">
        {topAbilities(p, sq).map((a) => (
          <span className="policy-row-ability" key={a.label}>
            {a.label} <RankBadge value={a.value} label={a.label} size="sm" />
          </span>
        ))}
      </div>
      <div className="policy-row-controls">
        <PlayerPolicySelect p={p} sq={sq} eff={eff} run={run} />
        {pol.individual && (
          <button
            type="button"
            className="secondary small policy-row-clear"
            onClick={() => run({ type: 'trainingPolicyClearIndividual', id: p.id })}
          >
            個別の設定を解除
          </button>
        )}
      </div>
      <p className="muted policy-row-growth">先月の伸び：{growthSummary(pol.previousMonthGrowth)}</p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 重点育成選手（6.3）。人数は1人のまま（DESIGN_V4 9章 D3）。既存の focus アクション・
// 選手詳細からの指定を両方とも使えるようにする。
// ---------------------------------------------------------------------------
function FocusPlayerPicker({ s, run }: { s: State; run: (a: Action) => State | null }) {
  const focusPlayer = s.players.find((p) => p.id === s.focus) ?? null;
  return (
    <div className="policy-focus">
      <label className="field policy-focus-field">
        重点育成選手（1人・成長1.5倍）
        <select
          value={s.focus ?? ''}
          onChange={(e) => run({ type: 'focus', id: e.target.value ? +e.target.value : null })}
        >
          <option value="">指定しない</option>
          {s.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.pos}・{p.year}年）
            </option>
          ))}
        </select>
      </label>
      <p className="muted policy-focus-hint">
        {focusPlayer
          ? `${focusPlayer.name}を重点育成中です。選手詳細からも指定・解除できます。`
          : '選手詳細の「重点育成に指定する」からも指定できます。'}
      </p>
    </div>
  );
}

export function TrainingPolicyBanner({
  s,
  onOpen,
}: {
  s: State;
  onOpen: () => void;
}) {
  if (!needsMonthlyReview(s)) return null;
  return (
    <section className="policy-banner">
      <div className="policy-banner-icon">
        <Sparkles size={20} aria-hidden="true" />
      </div>
      <div className="policy-banner-body">
        <span className="eyebrow">MONTHLY POLICY</span>
        <h3>今月の個人方針を見直しましょう</h3>
        <p className="muted">
          4週ごとに、選手ごとに伸ばしたい能力を選び直せます。何もしなければ「おまかせ」のままです。
        </p>
      </div>
      <button type="button" className="secondary" onClick={onOpen}>
        個人方針を開く <ChevronRight size={16} />
      </button>
    </section>
  );
}

export function TrainingPolicyPanel({
  s,
  run,
  onClose,
  onSelectPlayer,
}: {
  s: State;
  run: (a: Action) => State | null;
  onClose: () => void;
  onSelectPlayer: (id: number) => void;
}) {
  const [posFilter, setPosFilter] = useState<'all' | Position>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | number>('all');
  const rows = s.players
    .filter((p) => posFilter === 'all' || p.pos === posFilter)
    .filter((p) => gradeFilter === 'all' || p.year === gradeFilter)
    .filter((p) => !!s.v3.squad.players[p.id]);
  return (
    <div className="training-policy-panel">
      <p className="muted training-policy-lead">
        練習日の成長は「チームメニュー60% ＋ 個人方針40%」に配分されます。
      </p>

      <section className="policy-section">
        <h3 className="policy-section-title">ポジション×学年の一括設定</h3>
        <p className="muted policy-section-desc">
          選手は既定でここに従います。個別に変えた選手は「個別」の札がつき、ここを変えても上書きされません。
        </p>
        <PolicyGroupGrid s={s} run={run} />
      </section>

      <section className="policy-section">
        <h3 className="policy-section-title">方針と能力の対応</h3>
        <PolicyExplainTable />
      </section>

      <section className="policy-section">
        <h3 className="policy-section-title">選手ごとの方針</h3>
        <div className="policy-filters">
          <div className="policy-filter-group">
            {(['all', ...POSITION_GROUPS] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`policy-filter-chip ${posFilter === v ? 'active' : ''}`}
                onClick={() => setPosFilter(v)}
              >
                {v === 'all' ? '全ポジション' : v}
              </button>
            ))}
          </div>
          <div className="policy-filter-group">
            {(['all', ...GRADE_YEARS] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`policy-filter-chip ${gradeFilter === v ? 'active' : ''}`}
                onClick={() => setGradeFilter(v)}
              >
                {v === 'all' ? '全学年' : `${v}年`}
              </button>
            ))}
          </div>
        </div>
        <p className="muted policy-table-hint">横にスクロールすると方針と先月の伸びを確認できます。</p>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 横スクロールをキーボードで操作するため */}
        <section className="policy-table-scroll" aria-label="選手ごとの方針一覧" tabIndex={0}>
        <ul className="policy-row-list">
          {rows.map((p) => (
            <PlayerPolicyRow key={p.id} s={s} p={p} run={run} onOpenDetail={onSelectPlayer} />
          ))}
        </ul>
        </section>
        {!rows.length && <p className="muted">条件に合う選手がいません。絞り込みを見直してください。</p>}
      </section>

      <section className="policy-section">
        <h3 className="policy-section-title">重点育成選手</h3>
        <FocusPlayerPicker s={s} run={run} />
      </section>

      <button type="button" className="primary training-policy-done" onClick={onClose}>
        確認しました
      </button>
    </div>
  );
}
