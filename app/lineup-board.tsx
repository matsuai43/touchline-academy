'use client';
import { useState, type ReactNode } from 'react';
import { strength, overall, type State, type Action, type Player } from '@/lib/game';
import { formationSlots, detailInfo, isBenchPlayer } from '@/lib/squad';
import { Pitch } from './match-ui';
import { RankBadge, MasteryBadge, MoodBadge } from './ability-sheet';
import { FatigueMeter } from './fatigue-meter';

export function LineupBoard({ state, run, onPlayer, children }: { state: State; run: (a: Action) => State | null; onPlayer: (p: Player) => void; children: ReactNode }) {
  const [slot, setSlot] = useState<number | null>(null);
  const [benchId, setBenchId] = useState<number | null>(null);
  const [change, setChange] = useState<string>('');
  const slots = formationSlots(state.formation);
  const selected = slot === null ? null : state.players.find((p) => p.id === state.lineup[slot]);
  const bench = state.players.filter((p) => isBenchPlayer(state, p.id));
  const preview = bench.find((p) => p.id === benchId) ?? null;
  function swap(index: number, id: number) {
    const before = strength(state), after = run({ type: 'swap', index, id });
    if (!after) return;
    const value = strength(after);
    setChange(`総合力 ${before} → ${value}（${value - before >= 0 ? '+' : ''}${value - before}）`);
    setSlot(null); setBenchId(null);
  }
  return <>
    <div className="board-strength"><strong>チーム総合力 {strength(state)}</strong><output>{change}</output></div>
    <Pitch s={state} previewPlayer={preview} selectedId={selected?.id} onPick={(player) => {
      const index = state.lineup.indexOf(player.id);
      if (preview) swap(index, preview.id); else { setSlot(index); setBenchId(null); }
    }} />
    <div className="board-selection"><p>{preview ? `${preview.name}を入れる位置をピッチで選んでください。習熟度はこの選手の値です。` : selected ? `${selected.name}（${detailInfo[slots[slot!]].name}）と入れ替える控えを選んでください。` : 'ピッチの選手と控えを順に押すと入れ替わります。控えから選ぶと、各位置での習熟度を確認できます。'}</p>
      {(selected || preview) && <><button className="secondary small" onClick={() => onPlayer((selected ?? preview)!)}>選手の詳細</button><button className="secondary small" onClick={() => { setSlot(null); setBenchId(null); }}>選択を解除</button></>}
    </div>
    <section className="board-bench" aria-label="控えの選手"><h3>控え</h3><div className="board-bench-grid">{bench.map((player) => <button key={player.id} className="secondary" aria-pressed={benchId === player.id} aria-disabled={player.injury > 0}
      onClick={() => { if (player.injury) return; if (slot !== null) swap(slot, player.id); else setBenchId(player.id === benchId ? null : player.id); }}>
      <strong>{player.name}</strong><span>{slot === null ? <>総合力 <RankBadge value={overall(player)} /></> : <>習熟度 <MasteryBadge value={state.v3.squad.players[player.id].prof[slots[slot]] ?? 0} /></>}</span>
      <FatigueMeter value={player.fatigue} size="sm" /><MoodBadge value={state.v3.squad.players[player.id].mood} size="sm" />{player.injury > 0 && <span>けがの治療中</span>}
    </button>)}</div></section>
    <details className="board-settings"><summary>編成の設定</summary>{children}</details>
  </>;
}
