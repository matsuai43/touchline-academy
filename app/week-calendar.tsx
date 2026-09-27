'use client';
import { useState } from 'react';
import { training, stats, type State, type Training, type Action } from '@/lib/game';
import { competitionFixture } from '@/lib/competition';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
export function trainingLoad(key: Training): string { return key === 'rest' ? '休養' : training[key].fatigue <= 7 ? '軽い' : training[key].fatigue >= 12 ? '重い' : '普通'; }
export function trainingAbilities(key: Training): string { return key === 'rest' ? '疲労を回復' : key === 'position' ? '選んだ位置の習熟度' : training[key].stats.map((stat) => stats[stat]).join('・'); }

export function WeekCalendar({ state, run }: { state: State; run?: (action: Action) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const fixture = competitionFixture(state, state.week);
  const cells = DAYS.map((day, index) => {
    const title = index === 6 ? fixture?.opponent ?? '休養・調整' : training[state.weeklyMenu[index]].name;
    const content = <><strong>{day}{index === state.day ? '・今日' : index < state.day ? '・済' : ''}</strong><span>{title}</span></>;
    return run && index < 6 ? <button key={day} type="button" aria-current={index === state.day ? 'date' : undefined} aria-label={`${day}曜の練習：${title}${index < state.day ? '（実施済み）' : 'を編集'}`} aria-disabled={index < state.day}
      onClick={() => { if (index >= state.day) setEditing(index); }}>{content}</button> : <div key={day} aria-current={index === state.day ? 'date' : undefined} title={title}>{content}</div>;
  });
  return <><div className="week-calendar" aria-label={run ? '週間メニューの編集' : '今週7日の予定'}>{cells}</div>
    {run && <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent className="game-dialog">
      <DialogTitle>{editing !== null ? DAYS[editing] : ''}曜の練習を選ぶ</DialogTitle>
      <DialogDescription>選んだメニューを週間予定に保存します。「試合日まで進める」で実施します。</DialogDescription>
      <div className="week-training-options">{(Object.keys(training) as Training[]).map((key) => <button key={key} className="secondary" onClick={() => {
        if (editing === null) return;
        const menu = [...state.weeklyMenu]; menu[editing] = key; run({ type: 'setMenu', menu }); setEditing(null);
      }}><strong>{training[key].name}</strong><span>{trainingAbilities(key)}</span><span>負荷：{trainingLoad(key)}</span></button>)}</div>
    </DialogContent></Dialog>}
  </>;
}
