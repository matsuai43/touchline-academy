'use client';
import { Target, Shield, Hand, Brain, Zap, TriangleAlert } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverTitle,
  PopoverDescription,
} from '@/components/ui/popover';
import { stats, type Player, type Stat, type Position } from '@/lib/game';
import {
  detailInfo,
  archetypes,
  extraStatNames,
  SKILLS,
  squadOverall,
  DETAIL_POS,
  MASTERY_THRESHOLD,
  PLAY_STYLES,
  type DetailPos,
  type Archetype,
  type ExtraStat,
  type PlayerSquad,
  type SkillCategory,
} from '@/lib/squad';
import { rankOf, rankAriaLabel } from '@/lib/ability-rank';

// ---------------------------------------------------------------------------
// ランクバッジ（ランク文字のみ。色だけでなく文字自体で段階が分かる）
// ---------------------------------------------------------------------------
export function RankBadge({
  value,
  label,
  size = 'md',
}: {
  value: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const r = rankOf(value);
  return (
    <span
      className={`rank-badge rank-${r.id} rank-${size}`}
      title={rankAriaLabel(value, label)}
    >
      <span aria-hidden="true">{r.letter}</span>
      <span className="sr-only">{rankAriaLabel(value, label)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ポジション・アーキタイプの小バッジ（一覧・能力シート共通）
// ---------------------------------------------------------------------------
export function PositionBadge({ detail }: { detail: DetailPos }) {
  const info = detailInfo[detail];
  // S4: UIは日本語名を主表示にし、略号は補助として括弧書きで添える。
  return (
    <span className={`position pos-${info.base} detail-badge`} title={`${info.name}（${detail}）`}>
      {info.name}
      <span className="detail-badge-abbr">（{detail}）</span>
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

// ---------------------------------------------------------------------------
// 特殊能力チップ: 良い特殊能力=青系／悪い特殊能力=赤系、カテゴリごとにアイコン。
// title だけに頼らず、押す（またはフォーカスしてEnter/Space）と効果説明を表示する。
// ---------------------------------------------------------------------------
const categoryIcon: Record<SkillCategory, typeof Target> = {
  攻撃: Target,
  守備: Shield,
  GK: Hand,
  精神: Brain,
  身体: Zap,
  マイナス: TriangleAlert,
};

export function SkillChip({ id }: { id: string }) {
  const sk = SKILLS[id];
  if (!sk) return null;
  const Icon = categoryIcon[sk.category];
  return (
    <Popover>
      <PopoverTrigger
        className={`skill-chip ${sk.negative ? 'negative' : 'positive'}`}
      >
        <Icon size={12} aria-hidden="true" />
        {sk.name}
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>
          {sk.name} <span className="muted">（{sk.category}）</span>
        </PopoverTitle>
        <PopoverDescription>{sk.desc}</PopoverDescription>
        <p className="skill-acquire muted">{sk.acquire}</p>
      </PopoverContent>
    </Popover>
  );
}

export function SkillChips({
  ps,
  empty = '特殊能力なし',
}: {
  ps: PlayerSquad;
  empty?: string;
}) {
  if (!ps.skills.length && !ps.negatives.length)
    return <span className="muted skill-empty">{empty}</span>;
  return (
    <span className="skill-chips">
      {ps.skills.map((id) => (
        <SkillChip key={id} id={id} />
      ))}
      {ps.negatives.map((id) => (
        <SkillChip key={id} id={id} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 能力の1行: ランク文字（大）／能力名／数値／ゲージ
// ---------------------------------------------------------------------------
export function AbilityRow({ label, value }: { label: string; value: number }) {
  const r = rankOf(value);
  return (
    <div className={`ability-row rank-${r.id}`}>
      <span className="ability-row-rank" aria-hidden="true">
        {r.letter}
      </span>
      <span className="ability-row-body">
        <span className="ability-row-head">
          <span className="ability-row-label">{label}</span>
          <b className="ability-row-value">{value}</b>
        </span>
        <Progress
          aria-label={rankAriaLabel(value, label)}
          value={value}
          className="ability-row-gauge"
        />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// S4: ポジション適性（15ポジションのランク一覧。系統別の表で、主・サブを区別）
// ---------------------------------------------------------------------------
const basePosOrder: Position[] = ['GK', 'DF', 'MF', 'FW'];
const basePosLabel: Record<Position, string> = {
  GK: 'GK',
  DF: 'ディフェンダー',
  MF: 'ミッドフィルダー',
  FW: 'フォワード',
};
export function PositionAptitudeGrid({ ps }: { ps: PlayerSquad }) {
  return (
    <div className="position-aptitude">
      <h4>ポジション適性</h4>
      {basePosOrder.map((g) => {
        const list = DETAIL_POS.filter((d) => detailInfo[d].base === g);
        if (!list.length) return null;
        return (
          <div className="position-aptitude-group" key={g}>
            <span className="position-aptitude-group-label muted">{basePosLabel[g]}</span>
            <div className="position-aptitude-row">
              {list.map((d) => {
                const isPrimary = d === ps.detail;
                const unlocked = !isPrimary && ps.prof[d] >= MASTERY_THRESHOLD;
                const state = isPrimary ? '主ポジション' : unlocked ? 'サブポジション習得済み' : '未習得';
                return (
                  <span
                    key={d}
                    className={`position-aptitude-cell${isPrimary ? ' primary' : ''}${unlocked ? ' unlocked' : ''}`}
                    title={`${detailInfo[d].name}（${d}）：習熟度${ps.prof[d]}・${state}`}
                  >
                    <RankBadge value={ps.prof[d]} label={detailInfo[d].name} size="sm" />
                    <span className="position-aptitude-cell-label">
                      {detailInfo[d].name}
                      <small>{state}</small>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// S4: プレースタイル表示（名前＋効果の説明）。
// ---------------------------------------------------------------------------
export function PlayStyleCard({ ps }: { ps: PlayerSquad }) {
  const st = PLAY_STYLES[ps.style];
  return (
    <div className="play-style-card">
      <span className="play-style-label muted">プレースタイル</span>
      <strong className="play-style-name">{st.name}</strong>
      <p className="muted play-style-desc">{st.desc}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 能力シート本体（選手詳細）: 9能力＋特殊能力。GKはGK技術を先頭に。
// ---------------------------------------------------------------------------
export function AbilitySheet({ p, ps }: { p: Player; ps: PlayerSquad }) {
  const isGK = ps.detail === 'GK';
  const coreOrder: Stat[] = isGK
    ? ['keep', 'shoot', 'pass', 'defend', 'speed', 'mental']
    : ['shoot', 'pass', 'defend', 'speed', 'mental', 'keep'];
  const overall = squadOverall(p, ps);
  return (
    <div className="ability-sheet">
      <div className="ability-sheet-head">
        <RankBadge value={overall} label="総合力" size="lg" />
        <div className="ability-sheet-head-text">
          <span className="ability-sheet-overall">
            総合 <b>{overall}</b>
          </span>
          <div className="squad-profile-head">
            <PositionBadge detail={ps.detail} />
            <ArchetypeBadge archetype={ps.archetype} />
          </div>
        </div>
      </div>
      <div className="ability-sheet-grid">
        {coreOrder.map((k) => (
          <AbilityRow key={k} label={stats[k]} value={p.stats[k]} />
        ))}
        {(Object.keys(extraStatNames) as ExtraStat[]).map((k) => (
          <AbilityRow key={k} label={extraStatNames[k]} value={ps[k]} />
        ))}
      </div>
      <PlayStyleCard ps={ps} />
      <div className="squad-skills">
        <h4>
          特殊能力 <small className="muted">{ps.skills.length} / 5</small>
          {ps.negatives.length > 0 && (
            <small className="muted"> ・マイナス {ps.negatives.length} / 2</small>
          )}
        </h4>
        <SkillChips ps={ps} />
      </div>
      <PositionAptitudeGrid ps={ps} />
    </div>
  );
}
