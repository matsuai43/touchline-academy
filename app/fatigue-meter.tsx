'use client';
// V4-1: 疲労ゲージの共通部品（DESIGN_V4 4章・5章）。
// 数字と文字ラベルの両方で疲労度を示す（色だけに頼らない）。交代パネル・部員一覧・
// 戦術ボードの選手詳細・クラブハウスの「先発の平均疲労」で同じ見た目を使う。
import { clamp } from '@/lib/game';

export type FatigueLevel = 'good' | 'tired' | 'critical';

// DESIGN_V4 4章: 0-39緑（良好）／40-64黄（疲れ）／65以上赤（限界）。
export function fatigueLevel(value: number): FatigueLevel {
  if (value >= 65) return 'critical';
  if (value >= 40) return 'tired';
  return 'good';
}

export const FATIGUE_LABEL: Record<FatigueLevel, string> = {
  good: '良好',
  tired: '疲れ',
  critical: '限界',
};

export function FatigueMeter({
  value,
  label,
  size = 'md',
}: {
  value: number;
  /** 見出し（例: 「先発の平均疲労」）を付ける場合。省略時は数値のみ横に並べる簡易表示。 */
  label?: string;
  size?: 'sm' | 'md';
}) {
  const v = clamp(value, 0, 100);
  const rounded = Math.round(v);
  const level = fatigueLevel(v);
  return (
    <div
      className={`fatigue-meter fatigue-meter-${size} fatigue-meter-${level}`}
      role="meter"
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label ? `${label}：` : ''}疲労 ${rounded}（${FATIGUE_LABEL[level]}）`}
    >
      {label && (
        <div className="fatigue-meter-head">
          <span>{label}</span>
          <b>{rounded}</b>
        </div>
      )}
      <div className="fatigue-meter-bar">
        <span className="fatigue-meter-track" aria-hidden="true">
          <span className="fatigue-meter-fill" style={{ width: `${v}%` }} />
        </span>
        {!label && <b className="fatigue-meter-num">{rounded}</b>}
        <span className="fatigue-meter-status">{FATIGUE_LABEL[level]}</span>
      </div>
    </div>
  );
}
