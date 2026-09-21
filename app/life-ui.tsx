'use client';
// TOUCHLINE ACADEMY v3 — W3/W9: 日常イベント（学校生活）の表示UI
//
// 単体で完結するコンポーネント。lib/school-life.ts・lib/event-scenes.ts・
// app/event-scenes.tsx の公開APIのみに依存し、app/game-ui.tsx など他の
// ファイルは一切触らない。統括側が既存の event-panel（s.event の全員で
// 話し合う／個別に指導する）と同じあたりに
//   <LifeEventPanel state={s} onChoose={(choiceId) => run({ type: 'life', choiceId })} />
// を差し込むだけで配線できるように作ってある（このコンポーネントの公開
// props はW3から変更していない）。run() は既存の `(a: Action) => void`
// 相当のディスパッチ関数（lib/game.ts の act() を呼ぶラッパー）を想定して
// いるが、このファイルは Action 型に一切依存しない（LifeAction が Action
// に合流していなくても動く）。
//
// W9: 表示は文字だけのパネルから、app/event-scenes.tsx の EventStills
// （2〜3枚の静止画をめくる紙芝居コンポーネント）に置き換えた。選択の
// 適用（onChoose 経由で run({type:'life', choiceId}) を呼ぶタイミング）は
// 3枚目「結果」の「閉じる／次の週へ」を押した瞬間のみ。2枚目の選択肢を
// 押した時点ではまだ状態を変更しない（結果の文面はイベント側に既にある
// resultText を先読みして見せているだけ）ため、ゲームの決定性・
// 「連打で稼げない」制約は従来どおり保たれる。
//
// スタイルは EventStills 側（app/event-scenes.tsx、`es-` 接頭辞）で完結
// させており、globals.css の既存セレクタには依存しない。ここでは
// カテゴリバッジと effectHints の変換だけを担当する。

import { Sparkles, Heart, BookOpen, Users2, Home, HeartPulse } from 'lucide-react';
import type { State } from '@/lib/game';
import {
  getCurrentLifeEvent,
  readLifeState,
  type LifeCategory,
  type LifeEffect,
} from '@/lib/school-life';
import { personalities } from '@/lib/development';
import { getEventScenePanels } from '@/lib/event-scenes';
import { EventStills, type EventStillsChoice, type EventStillsResult } from './event-scenes';

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

/**
 * 週の進行中に発生した学校生活イベントを、2〜3枚の静止画の紙芝居
 * （EventStills）で表示し、選択肢を選ばせるパネル。
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
  const scenePanels = getEventScenePanels(event.id);
  if (!scenePanels) return null; // lib/event-scenes.ts の対応表が未登録（テストが検出する）

  const choices: EventStillsChoice[] = event.choices.map((c) => ({
    id: c.id,
    label: c.label,
    hints: effectHints(c.effect),
  }));
  const resolveResult = (choiceId: string): EventStillsResult => {
    const choice = event.choices.find((c) => c.id === choiceId);
    if (!choice) return { text: '' };
    return { text: choice.resultText(player.name), effects: effectHints(choice.effect) };
  };
  // 同じ週に新しいイベントが出たときに紙芝居のページを1枚目からやり直させるための key。
  const currentWeek = readLifeState(state).current?.week ?? state.week;
  const stillsKey = `${event.id}-${player.id}-${currentWeek}-${state.season}`;

  return (
    <section className={'life-event-panel ' + (className ?? '')} aria-label="学校生活イベント">
      <EventStills
        key={stillsKey}
        scenePanels={scenePanels}
        playerName={player.name}
        portraitIndex={player.identity.portrait}
        kicker={
          <>
            {categoryIcon[event.category]}
            {event.category}
          </>
        }
        heading={event.title}
        metaLine={`${player.name}（${personality.name}）`}
        momentNarration={event.prompt(player.name)}
        choices={choices}
        resolveResult={resolveResult}
        onCommit={onChoose}
      />
    </section>
  );
}

export default LifeEventPanel;
