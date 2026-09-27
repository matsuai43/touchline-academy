'use client';
import { type State, type Action, tactics } from '@/lib/game';
import { readCompetition, weekCalendarLabel } from '@/lib/competition';
import { currentFriendlyOffer, friendlyLabels } from '@/lib/friendlies';
import { TierChip } from './tier-chip';
import { RankBadge } from './ability-sheet';

export function FriendlyApplication({ state, run }: { state: State; run: (action: Action) => void }) {
  const offer = currentFriendlyOffer(state, readCompetition(state));
  if (!offer || state.match?.fixture.kind === 'friendly') return null;
  const editable = state.week < offer.week;
  const selected = offer.candidates.find((candidate) => candidate.choice === (offer.choice ?? 'peer'));
  const status = offer.choice === 'rest' ? '休養' : `${selected?.school.name}（${offer.choice ? friendlyLabels[offer.choice] : '未選択・同格を自動選択'}）`;
  return <details id="friendly-application" className="panel friendly-application">
    <summary>練習試合の申し込み <span>{status}</span></summary>
    <p className="muted">{weekCalendarLabel(offer.week)}に開催。未選択なら同格の相手を選びます。遠征も部費はかかりません。</p>
    {!editable && <p>申し込みは締め切りました。次の練習試合は、その1週前に選べます。</p>}
    <fieldset aria-label="練習試合の相手" className="friendly-options">
      <legend className="sr-only">練習試合の相手</legend>
      {offer.candidates.map((candidate) => <label key={candidate.choice} className="friendly-option">
        <span className="friendly-choice-label"><input type="radio" name="friendly-choice" value={candidate.choice} checked={(offer.choice ?? 'peer') === candidate.choice} aria-disabled={!editable}
          onChange={() => { if (editable) run({ type: 'friendlyChoice', choice: candidate.choice }); }} />{friendlyLabels[candidate.choice]}</span>
        <strong>{candidate.school.name}</strong>
        <TierChip tier={candidate.school.tier} districtId={candidate.school.districtId} />
        <span>戦力 <RankBadge value={candidate.school.strength} />・{tactics[candidate.school.tactic].name}</span>
        <span>経験値 {candidate.xp.toFixed(2)}倍（同格比）</span>
        <span>{candidate.fatigue ? `試合の疲労 +${candidate.fatigue}（90分出場）` : '通常の試合疲労'}</span>
      </label>)}
      <label className="friendly-rest"><input type="radio" name="friendly-choice" value="rest" checked={offer.choice === 'rest'} aria-disabled={!editable}
        onChange={() => { if (editable) run({ type: 'friendlyChoice', choice: 'rest' }); }} />今回は見送る（日曜日を休養にする）</label>
    </fieldset>
    <p className="muted">経験値は申し込み時の戦力差で決まります。公式戦に対する練習試合の倍率は0.8倍です。</p>
  </details>;
}
