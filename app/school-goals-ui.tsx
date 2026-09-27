import { type State } from '@/lib/game';
import { readCompetition } from '@/lib/competition';
import { schoolGoalLabels, schoolGoalProgress } from '@/lib/school-goals';

export function SchoolGoalsPanel({ state }: { state: State }) {
  const comp = readCompetition(state), goal = comp.schoolGoals;
  const progress = schoolGoalProgress(state, comp);
  if (!goal || !progress) return <p className="muted">学校からの目標は来シーズンから届きます。</p>;
  const labels = schoolGoalLabels(goal), assessment = comp.schoolAssessment;
  return <section className="panel school-goals" aria-label="学校からの目標と評価">
    <h2>今季の目標</h2>
    <div className="school-goal-grid">
      <p><strong>校長：{labels.league}</strong><span>{comp.teamA.played ? `${comp.teamA.played}/14試合・現在${progress.rank}位${progress.league ? '・達成' : ''}` : 'リーグ開幕前'}</span></p>
      <p><strong>OB会：{labels.cup}</strong><span>{progress.cup ? '達成' : `${goal.national ? '全国' : '県予選'} ${progress.rounds}/${goal.cupRounds}回戦突破`}（IH・選手権のいずれか）</span></p>
    </div>
    <details><summary>年度末の評価と支援{assessment ? `・前季 ${Number(assessment.league) + Number(assessment.cup)}/2達成` : ''}</summary>
      <p>各目標の達成で翌季の部費+1。両方達成すると評判も+0.1。未達でも減額はありません。</p>
      {assessment && <div className="school-assessment"><strong>{assessment.season}年目の評価</strong><p>校長：{assessment.leagueLabel} — {assessment.league ? '達成' : '未達'}<br />OB会：{assessment.cupLabel} — {assessment.cup ? '達成' : '未達'}</p><p>今季への支援：部費+{assessment.funds}・評判+{assessment.reputation}</p></div>}
    </details>
  </section>;
}
