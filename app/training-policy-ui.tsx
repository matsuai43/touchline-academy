'use client';
// T3-2: 選手ごとの月次トレーニング方針。「今月の個人方針」バナー（月初に見直しを促す）と、
// 全員をまとめて設定できるパネル（一括「おまかせ」も可、月の途中でも変更可）。
import { ChevronRight, Sparkles } from 'lucide-react';
import { Portrait } from './development-ui';
import { detailInfo, DETAIL_POS, basePos, type DetailPos } from '@/lib/squad';
import { type State, type Action } from '@/lib/game';
import { POLICY_KEYS, policyInfo, needsMonthlyReview, type PolicyKey } from '@/lib/training-policy';

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
}: {
  s: State;
  run: (a: Action) => State | null;
  onClose: () => void;
}) {
  const tp = s.v3.trainingPolicy;
  return (
    <div className="training-policy-panel">
      <div className="training-policy-head">
        <p className="muted">
          練習日の成長は「チームメニュー60% ＋ 個人方針40%」に配分されます。
        </p>
        <button
          type="button"
          className="secondary small"
          onClick={() => run({ type: 'trainingPolicyBulkAuto' })}
        >
          全員「おまかせ」に戻す
        </button>
      </div>
      <ul className="training-policy-list">
        {s.players.map((p) => {
          const pol = tp.players[p.id];
          if (!pol) return null;
          const sq = s.v3.squad.players[p.id];
          const isGK = sq ? basePos(sq.detail) === 'GK' : p.pos === 'GK';
          const options = POLICY_KEYS.filter((k) => k !== 'keep' || isGK);
          const posOptions = DETAIL_POS.filter((d) => basePos(d) === p.pos);
          return (
            <li key={p.id} className="training-policy-row">
              <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
              <span className="training-policy-name">
                {p.name}
                <small>
                  {p.year}年 / {sq ? detailInfo[sq.detail].name : p.pos}
                </small>
              </span>
              <label className="field training-policy-select">
                方針
                <select
                  value={pol.key}
                  onChange={(e) => {
                    const key = e.target.value as PolicyKey;
                    if (key === 'position') {
                      const target = pol.target ?? posOptions.find((d) => d !== sq?.detail) ?? posOptions[0] ?? null;
                      run({ type: 'trainingPolicySet', id: p.id, policy: 'position', target });
                    } else {
                      run({ type: 'trainingPolicySet', id: p.id, policy: key });
                    }
                  }}
                >
                  {options.map((k) => (
                    <option key={k} value={k}>
                      {policyInfo[k].name}
                    </option>
                  ))}
                </select>
              </label>
              {pol.key === 'position' && (
                <label className="field training-policy-target">
                  対象ポジション
                  <select
                    value={pol.target ?? ''}
                    onChange={(e) => {
                      const target = e.target.value as DetailPos;
                      if (target)
                        run({ type: 'trainingPolicySet', id: p.id, policy: 'position', target });
                    }}
                  >
                    <option value="" disabled>
                      選ぶ
                    </option>
                    {posOptions.map((d) => (
                      <option key={d} value={d}>
                        {detailInfo[d].name}（{d}）
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="primary training-policy-done" onClick={onClose}>
        確認しました
      </button>
      <style>{`
        .training-policy-panel { display: flex; flex-direction: column; gap: 14px; }
        .training-policy-head { display: flex; align-items: center; justify-content: space-between;
          gap: 10px; flex-wrap: wrap; }
        .training-policy-list { list-style: none; margin: 0; padding: 0; display: flex;
          flex-direction: column; gap: 8px; max-height: 50vh; overflow-y: auto; }
        .training-policy-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px;
          background: var(--card); }
        .training-policy-name { display: flex; flex-direction: column; font-size: 13px;
          flex: 1 1 120px; min-width: 0; }
        .training-policy-name small { color: var(--muted-foreground); font-size: 12px; }
        .training-policy-select, .training-policy-target { min-width: 140px; }
        .training-policy-done { width: 100%; justify-content: center; display: flex;
          align-items: center; min-height: 44px; }
      `}</style>
    </div>
  );
}
