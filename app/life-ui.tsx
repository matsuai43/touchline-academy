'use client';
// TOUCHLINE ACADEMY v3 — W3: 日常イベント（学校生活）の表示UI
//
// 単体で完結するコンポーネント。lib/school-life.ts の公開APIのみに依存し、
// app/game-ui.tsx など他のファイルは一切触らない。統括側が既存の
// event-panel（s.event の全員で話し合う／個別に指導する）と同じあたりに
//   <LifeEventPanel state={s} onChoose={(choiceId) => run({ type: 'life', choiceId })} />
// を差し込むだけで配線できるように作ってある。run() は既存の
// `(a: Action) => void` 相当のディスパッチ関数（lib/game.ts の act() を
// 呼ぶラッパー）を想定しているが、このファイルは Action 型に一切依存しない
// （LifeAction が Action に合流していなくても動く）。
//
// スタイルは Tailwind ユーティリティクラスのみで完結させており、
// globals.css の既存セレクタには依存しない。

import { Sparkles, Heart, BookOpen, Users2, Home, HeartPulse } from 'lucide-react';
import { Portrait } from './development-ui';
import { personalities } from '@/lib/development';
import type { State } from '@/lib/game';
import {
  getCurrentLifeEvent,
  type LifeCategory,
  type LifeChoice,
  type LifeEffect,
} from '@/lib/school-life';

const categoryIcon: Record<LifeCategory, React.ReactNode> = {
  学校行事: <Sparkles size={16} />,
  学業: <BookOpen size={16} />,
  人間関係: <Heart size={16} />,
  家庭: <Home size={16} />,
  部活: <Users2 size={16} />,
  身体: <HeartPulse size={16} />,
};

function effectHints(effect: LifeEffect): { label: string; positive: boolean }[] {
  const hints: { label: string; positive: boolean }[] = [];
  if (effect.morale) hints.push({ label: `士気${effect.morale > 0 ? '↑' : '↓'}`, positive: effect.morale > 0 });
  if (effect.cohesion)
    hints.push({ label: `連携${effect.cohesion > 0 ? '↑' : '↓'}`, positive: effect.cohesion > 0 });
  if (effect.fatigue)
    hints.push({
      label: effect.fatigue > 0 ? '疲労↑' : '疲労回復',
      positive: effect.fatigue < 0,
    });
  if (effect.trust) hints.push({ label: `信頼${effect.trust > 0 ? '↑' : '↓'}`, positive: effect.trust > 0 });
  if (effect.injury) hints.push({ label: 'けがのリスク', positive: false });
  if (effect.growth && Object.keys(effect.growth).length)
    hints.push({ label: '能力成長', positive: true });
  if (effect.skillId) hints.push({ label: '特殊能力の芽', positive: !effect.skillId.match(/egoist|glass_body|moody/) });
  return hints;
}

function ChoiceButton({
  choice,
  onChoose,
}: {
  choice: LifeChoice;
  onChoose: (choiceId: string) => void;
}) {
  const hints = effectHints(choice.effect);
  return (
    <button
      type="button"
      onClick={() => onChoose(choice.id)}
      className="flex w-full flex-col items-start gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 hover:border-border"
    >
      <span className="text-sm font-medium leading-snug">{choice.label}</span>
      {hints.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {hints.map((h, i) => (
            <span
              key={i}
              className={
                'rounded-full px-2 py-0.5 text-[0.7rem] leading-tight ' +
                (h.positive
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400')
              }
            >
              {h.label}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * 週の進行中に発生した学校生活イベントを表示し、選択肢を選ばせるパネル。
 * `getCurrentLifeEvent(state)` が null を返す間（イベントが無い週）は何も描画しない。
 */
export function LifeEventPanel({
  state,
  onChoose,
  className,
}: {
  state: State;
  onChoose: (choiceId: string) => void;
  className?: string;
}) {
  const current = getCurrentLifeEvent(state);
  if (!current) return null;
  const { event, player } = current;
  const personality = personalities[player.identity.personality];

  return (
    <section
      className={
        'flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm ' +
        (className ?? '')
      }
      aria-label="学校生活イベント"
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          {categoryIcon[event.category]}
          {event.category}
        </span>
        <span className="text-xs text-muted-foreground">今週の出来事</span>
      </div>
      <div className="flex items-start gap-3">
        <Portrait index={player.identity.portrait} name={player.name} size="normal" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-tight">{event.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {player.name}（{personality.name}）
          </p>
          <p className="mt-2 text-sm leading-relaxed">{event.prompt(player.name)}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {event.choices.map((c) => (
          <ChoiceButton key={c.id} choice={c} onChoose={onChoose} />
        ))}
      </div>
    </section>
  );
}

export default LifeEventPanel;
