'use client';
import { strength, type State, type Action } from '@/lib/game';
import { readCompetition, weekCalendarLabel, cupDrawWeek, type CompFixture } from '@/lib/competition';
import { currentFriendlyOffer } from '@/lib/friendlies';
import { needsMonthlyReview } from '@/lib/training-policy';
import { TierChip } from './tier-chip';
import { WeekCalendar } from './week-calendar';

export function HomeOverview({ state, next, run, onPolicy }: { state: State; next?: { week: number; f: CompFixture | null }; run: (a: Action) => void; onPolicy: () => void }) {
  const comp = readCompetition(state), offer = currentFriendlyOffer(state, comp);
  const fixture = next?.f, own = strength(state), days = next ? (next.week - state.week) * 7 + 6 - state.day : 0;
  const blocked = !!(state.event || state.v3.life.current || state.cupDraw);
  const drawPending = (['ih', 'wc'] as const).flatMap((key) => [false, true].filter((national) => {
    const bracket = national ? comp[key].national : comp[key].qualifier;
    return bracket && !bracket.drawn && cupDrawWeek(key, national) === state.week;
  }).map((national) => `${key === 'ih' ? 'インターハイ' : '選手権'}${national ? '全国' : '県予選'}の抽選`));
  return <section className="panel home-overview" aria-label="次の試合と今週の予定">
    <div className="home-next-head"><div><span className="eyebrow">NEXT MATCH</span><h2>次の試合</h2></div><strong>{fixture ? days === 0 ? '今日が試合日' : `あと${days}日` : '今季の試合は終了'}</strong></div>
    {fixture ? <><p className="home-opponent">{fixture.opponent} <TierChip tier={fixture.opponentTier} districtId={fixture.opponentDistrictId} asRepresentative={fixture.kind.endsWith('national')} /></p><p className="muted">{weekCalendarLabel(next!.week)}・日曜 / {fixture.label}</p>
      {!fixture.opponent.includes('未定') && <div className="home-strength"><span>自校 {own}</span><span>戦力の比較</span><span>相手 {fixture.strength}</span><div><i style={{ width: `${own / (own + fixture.strength) * 100}%` }} /></div></div>}
    </> : <p>来季に向けて育成・休養を進めましょう。</p>}
    <WeekCalendar state={state} />
    <div className="home-todos"><strong>今週やること</strong>
      <button className="text-link" onClick={onPolicy}>{needsMonthlyReview(state) ? '個人方針を開く' : '個人方針を確認する'}</button>
      {offer && state.week < offer.week && <button className="text-link" onClick={() => {
        const panel = document.getElementById('friendly-application') as HTMLDetailsElement | null;
        if (panel) { panel.open = true; panel.scrollIntoView({ block: 'start' }); }
      }}>{offer.choice ? '練習試合の申し込みを確認' : '練習試合の相手を選ぶ'}</button>}
      {drawPending.map((draw) => <span key={draw}>{draw}（週末）</span>)}
    </div>
    {!state.pending && <><button className="primary home-advance" aria-disabled={blocked} onClick={() => { if (!blocked) run({ type: 'autoWeek' }); }}>試合日まで進める</button>{blocked && <p className="muted">先に表示中のイベント・抽選を確認してください。</p>}</>}
  </section>;
}
