'use client';
import { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import {
  plans,
  personalities,
  origins,
  managers,
  supports,
  type PlanKey,
  type Support,
  type Commands,
} from '@/lib/development';
import type { State, Player, Action } from '@/lib/game';
import { RANK_BY_ID, type RankId } from '@/lib/ability-rank';

// 成長の素質は「潜在力の高さ」を3段階で示す評価であり、能力値（1〜99）のランクとは
// 別の指標。値の意味は変えず（ロジックは lib/development.ts のまま）、表示だけを
// 能力ランクと同じA〜G表記・同じ四角いバッジ（RankBadgeと同じ見た目）に揃える。
// 「Aチーム/Bチーム」と紛れないよう、単独の1文字テキストではなく必ずこのバッジ
// （rank-badge）の形で出す。
function potentialRankId(potential: number): RankId {
  if (potential >= 1.7) return 'A';
  if (potential >= 1.5) return 'B';
  return 'C';
}
export function PotentialBadge({ potential }: { potential: number }) {
  const r = RANK_BY_ID[potentialRankId(potential)];
  return (
    <span className={`rank-badge rank-${r.id} rank-md`} title={`成長の素質：ランク${r.letter}`}>
      <span aria-hidden="true">{r.letter}</span>
      <span className="sr-only">成長の素質はランク{r.letter}</span>
    </span>
  );
}
export function Portrait({
  index,
  name,
  size = 'normal',
  manager = false,
}: {
  index: number;
  name: string;
  size?: 'tiny' | 'normal' | 'large';
  manager?: boolean;
}) {
  const extra = !manager && index >= 12,
    cols = extra ? 3 : 4,
    rows = extra ? 2 : 4,
    i = extra ? index - 12 : index;
  return (
    <span
      role="img"
      aria-label={name + 'の顔'}
      className={`portrait portrait-${size}`}
      style={{
        backgroundImage: `url(/${extra ? 'character-extra.png' : 'character-atlas.png'})`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${((i % cols) / (cols - 1)) * 100}% ${(Math.floor(i / cols) / (rows - 1)) * 100}%`,
      }}
    />
  );
}
function Options({
  value,
  items,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  items: { id: string; name: string }[];
  onChange: (s: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(v) => onChange(String(v))}
      className="v2-options"
      disabled={disabled}
    >
      {items.map((v) => (
        <label key={v.id} className={v.id === value ? 'active' : ''}>
          <RadioGroupItem value={v.id} />
          {v.name}
        </label>
      ))}
    </RadioGroup>
  );
}
export function IdentityDetails({ player: p }: { player: Player }) {
  const i = p.identity;
  return (
    <div className="identity-details">
      <div className="identity-header">
        <Portrait index={i.portrait} name={p.name} size="large" />
        <div>
          <span className="origin-badge">{origins[i.origin].name}</span>
          <h3>
            {personalities[i.personality].name} · {p.trait}
          </h3>
          <p>「{personalities[i.personality].line}」</p>
        </div>
      </div>
      <div className="identity-meters">
        {[
          ['信頼', i.trust],
          ['積極性', i.courage],
          ['献身性', i.workRate],
        ].map(([label, v]) => (
          <div key={String(label)}>
            <span>
              {label} <b>{v}</b>
            </span>
            <Progress value={Number(v)} aria-label={String(label)} />
          </div>
        ))}
      </div>
      <details>
        <summary>この選手との思い出 ({i.memories.length})</summary>
        {i.memories.length ? (
          i.memories.map((v, j) => <p key={j}>{v}</p>)
        ) : (
          <p>試合中の声かけが、ここに残っていきます。</p>
        )}
      </details>
    </div>
  );
}
export function DevelopmentView({
  s,
  run,
}: {
  s: State;
  run: (a: Action) => State | null;
}) {
  const [view, setView] = useState('plan'),
    [draft, setDraft] = useState<PlanKey>('technique'),
    [origin, setOrigin] = useState('all'),
    [scoutSort, setScoutSort] = useState<'interest' | 'potential' | 'ability'>(
      'interest',
    ),
    [scoutShown, setScoutShown] = useState(6),
    [scoutOpen, setScoutOpen] = useState<Record<string, boolean>>({});
  const d = s.development,
    manager = d.manager === null ? null : managers[d.manager],
    left = 24 - (s.week % 24);
  return (
    <section className="development-page">
      <div className="season-overview panel">
        <div>
          <span className="eyebrow">BUILD YOUR CLUB’S FUTURE</span>
          <h2>どんなチームを、育てよう。</h2>
          <p>半年の目標を決めて、来年の仲間に会いにいこう。</p>
        </div>
        <span className="season-chip">
          {s.week < 24 ? '前期 4〜9月' : '後期 10〜3月'}
        </span>
      </div>
      <Options
        label="部の未来の画面"
        value={view}
        onChange={setView}
        items={[
          { id: 'plan', name: '半年の育成方針' },
          { id: 'scout', name: '新入生スカウト' },
          { id: 'manager', name: 'マネージャー' },
        ]}
      />
      <p className="development-notice" role="status">
        {d.message}
      </p>
      {view === 'plan' && (
        <>
          <div className="plan-layout">
            <section className="panel">
              <span className="eyebrow">24-WEEK DEVELOPMENT PLAN</span>
              <h2>{d.plan ? plans[d.plan].name : 'この半年の方針を決める'}</h2>
              <p className="muted">
                残り{left}週。確定後は次の半年まで変更できません。
              </p>
              {d.plan ? (
                // 確定済みの半年方針は選び直せない（lib/development.ts が確定済みなら
                // throwする）。DADSは無効化(disabled)より「その状況で押す意味がない
                // 選択肢は出さない」を推奨するため、ラジオではなく決定済みの1枚だけを
                // 読み取り専用で表示する。
                <div className="plan-cards" aria-label="確定した半年の育成方針">
                  <div className="selected plan-card-locked">
                    <h3>{plans[d.plan].name}</h3>
                    <p>{plans[d.plan].desc}</p>
                    <small>目標：対象メニューで{plans[d.plan].goal}日練習</small>
                  </div>
                </div>
              ) : (
                <RadioGroup
                  className="plan-cards"
                  value={draft}
                  aria-label="半年の育成方針"
                  onValueChange={(v) => setDraft(v as PlanKey)}
                >
                  {(Object.keys(plans) as PlanKey[]).map((k) => (
                    <label className={draft === k ? 'selected' : ''} key={k}>
                      <RadioGroupItem value={k} />
                      <div>
                        <h3>{plans[k].name}</h3>
                        <p>{plans[k].desc}</p>
                        <small>目標：対象メニューで{plans[k].goal}日練習</small>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              )}
              {!d.plan ? (
                <button
                  className="primary"
                  onClick={() => run({ type: 'plan', plan: draft })}
                >
                  この半年の方針を確定
                </button>
              ) : (
                <div className="plan-progress">
                  <strong>
                    {d.rewarded
                      ? '半年目標達成！'
                      : `練習日数 ${d.progress} / ${plans[d.plan].goal}`}
                  </strong>
                  <Progress
                    value={Math.min(100, (d.progress / plans[d.plan].goal) * 100)}
                    aria-label="半年目標の進捗（練習日数）"
                  />
                  <p>
                    達成時：部費＋20 / 学校の評判＋3。ボーナスは各半年に1回。
                  </p>
                </div>
              )}
            </section>
            <aside className="panel">
              <h2>チームの歩み</h2>
              {d.archive.length ? (
                d.archive.map((l, i) => (
                  <p className="plan-record" key={i}>
                    {l}
                  </p>
                ))
              ) : (
                <p className="muted">
                  半年が終わると方針と成果が残ります。練習はクラブハウスで進めます。
                </p>
              )}
              <h3 className="v2-subhead">新しい仲間</h3>
              {d.intake.length ? (
                d.intake.map((n) => <p key={n}>{n}が入部</p>)
              ) : (
                <p className="muted">
                  スカウトの内諾は来春の入部につながります。
                </p>
              )}
            </aside>
          </div>
        </>
      )}
      {view === 'scout' && (
        <>
          <div className="scout-summary">
            <div>
              <h2>来春の仲間を探す</h2>
              <p>
                評判 <b>{Math.round(s.reputation)}</b> / 部費 <b>{s.funds}</b> / 内諾{' '}
                <b>{d.candidates.filter((c) => c.promised).length} / 6</b>
              </p>
            </div>
            <span className="pill">
              {d.lastVisit === s.season * 48 + s.week
                ? '今週の活動は完了'
                : '今週はあと1回活動できます'}
            </span>
          </div>
          <p className="muted">
            視察（3）→面談（5）で関心70以上→入学を提案（8）。活動は週1回、入部は来年4月。能力は視察するまで概算です。
          </p>
          <Options
            label="候補の経歴"
            value={origin}
            onChange={(v) => {
              setOrigin(v);
              setScoutShown(6);
            }}
            items={[
              { id: 'all', name: '全員' },
              ...Object.entries(origins).map(([id, v]) => ({
                id,
                name: v.name,
              })),
            ]}
          />
          <Options
            label="並び替え"
            value={scoutSort}
            onChange={(v) => {
              setScoutSort(v as typeof scoutSort);
              setScoutShown(6);
            }}
            items={[
              { id: 'interest', name: '関心度順' },
              { id: 'potential', name: '素質順' },
              { id: 'ability', name: '現在の力順' },
            ]}
          />
          {(() => {
            // 内諾済み・交渉中（視察済みだが未内諾）を常に上に、その上で選んだ並び順で
            // 並べる。1画面あたりの表示件数を抑えるため、最初は6件のみ描画し、
            // 「さらに表示」で6件ずつ増やす（縦の長さを抑えるのが目的）。
            const groupRank = (c: (typeof d.candidates)[number]) =>
                c.promised ? 2 : c.scouted ? 1 : 0,
              sortValue = (c: (typeof d.candidates)[number]) => {
                if (scoutSort === 'interest') return c.interest;
                if (scoutSort === 'potential') return c.potential;
                return c.scouted ? c.ability : -1;
              },
              filtered = d.candidates
                .filter((c) => origin === 'all' || origin === c.origin)
                .slice()
                .sort(
                  (a, b) =>
                    groupRank(b) - groupRank(a) || sortValue(b) - sortValue(a),
                ),
              visible = filtered.slice(0, scoutShown);
            return (
              <>
                <div className="scout-grid">
                  {visible.map((c) => {
                    const locked = s.reputation < c.required,
                      used = d.lastVisit === s.season * 48 + s.week,
                      slots =
                        s.players.filter(
                          (p) => p.year === 3 && p.pos === c.pos,
                        ).length -
                        d.candidates.filter(
                          (x) => x.promised && x.pos === c.pos,
                        ).length,
                      isOpen = !!scoutOpen[c.id];
                    return (
                      <article
                        className={`scout-card ${locked ? 'locked' : ''}`}
                        key={c.id}
                      >
                        <div className="scout-card-top">
                          <Portrait index={c.portrait} name={c.name} />
                          <div>
                            <span className="origin-badge">
                              {origins[c.origin].name}
                            </span>
                            <h3>{c.name}</h3>
                            <span className={`position pos-${c.pos}`}>
                              {c.pos}
                            </span>{' '}
                            <span className="muted">
                              {personalities[c.personality].name}
                            </span>
                          </div>
                        </div>
                        {c.promised ? (
                          <strong className="lime sc-status">
                            内諾済み・来春の仲間に
                          </strong>
                        ) : c.scouted ? (
                          <span className="sc-status sc-status-active">
                            交渉中
                          </span>
                        ) : null}
                        <div className="scout-values">
                          <span>
                            現在の力 <b>{c.scouted ? c.ability : '未視察'}</b>
                          </span>
                          <span>
                            成長の素質{' '}
                            {c.scouted ? (
                              <PotentialBadge potential={c.potential} />
                            ) : (
                              <b>？</b>
                            )}
                          </span>
                        </div>
                        <div className="scout-interest">
                          <span>関心 {c.interest} / 100</span>
                          <Progress
                            value={c.interest}
                            aria-label={c.name + 'の関心'}
                          />
                        </div>
                        {c.promised ? null : locked ? (
                          <p>接触条件：学校の評判 {c.required}</p>
                        ) : (
                          <div className="scout-actions">
                            {/* disabled は使わず aria-disabled で見た目だけ落ち着かせる。
                                押した場合は lib/development.ts 側の検証がそのまま働き、
                                理由（週1回制限・部費不足など）が既存のトーストに出る。 */}
                            <button
                              className="secondary"
                              aria-disabled={used || c.scouted || s.funds < 3}
                              onClick={() =>
                                run({
                                  type: 'scout',
                                  id: c.id,
                                  mode: 'observe',
                                })
                              }
                            >
                              {c.scouted ? '視察済' : '視察 / 3'}
                            </button>
                            <button
                              className="secondary"
                              aria-disabled={used || !c.scouted || s.funds < 5}
                              onClick={() =>
                                run({ type: 'scout', id: c.id, mode: 'visit' })
                              }
                            >
                              面談 / 5
                            </button>
                            <button
                              className="secondary"
                              aria-disabled={
                                used ||
                                !c.scouted ||
                                c.interest < 70 ||
                                slots <= 0 ||
                                s.funds < 8
                              }
                              onClick={() =>
                                run({ type: 'scout', id: c.id, mode: 'offer' })
                              }
                            >
                              入学提案 / 8
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="secondary sc-toggle"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setScoutOpen((o) => ({ ...o, [c.id]: !o[c.id] }))
                          }
                        >
                          {isOpen ? '閉じる' : '詳しく'}
                        </button>
                        {isOpen && (
                          <div className="sc-detail">
                            <p>{origins[c.origin].story}</p>
                            <small className="muted">
                              {c.pos}の残り卒業枠 {Math.max(0, slots)}名
                            </small>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
                {visible.length < filtered.length && (
                  <button
                    type="button"
                    className="secondary sc-more"
                    onClick={() => setScoutShown((n) => n + 6)}
                  >
                    さらに表示（あと{filtered.length - visible.length}人）
                  </button>
                )}
              </>
            );
          })()}
          <p className="muted instruction">
            経歴や親選手・育成組織はすべて架空です。部活の原石は現在の力が低くても、時間をかけて大きく育つ選手がいます。
          </p>
        </>
      )}
      {view === 'manager' && (
        <section className="panel">
          <h2>チームを支える、もう一人の仲間。</h2>
          <p className="muted">
            担当するマネージャーと今週の活動を選べます。週の練習終了時に一度だけサポートが届きます。
          </p>
          <div className="manager-grid">
            {managers.map((m, i) => (
              <button
                key={m.name}
                className={`manager-card ${d.manager === i ? 'selected' : ''}`}
                onClick={() => run({ type: 'manager', manager: i })}
              >
                <Portrait
                  index={m.portrait}
                  name={m.name}
                  manager
                  size="large"
                />
                <h3>{m.name}</h3>
                <p>「{m.line}」</p>
                <span>{d.manager === i ? '担当中' : '担当をお願いする'}</span>
              </button>
            ))}
          </div>
          {manager && (
            <>
              <h3>今週の活動</h3>
              <Options
                label="マネージャーの活動"
                value={d.support}
                onChange={(v) =>
                  run({ type: 'support', support: v as Support })
                }
                items={Object.entries(supports).map(([id, v]) => ({
                  id,
                  name: v.name,
                }))}
              />
              <p className="manager-message">
                {manager.name}：{supports[d.support].desc}。任せてください！
              </p>
            </>
          )}
        </section>
      )}
    </section>
  );
}
export function ManagerNote({ s }: { s: State }) {
  const d = s.development;
  if (d.manager === null) return null;
  const m = managers[d.manager];
  const tired = s.players.filter((p) => p.fatigue > 65).length;
  return (
    <div className="manager-note">
      <Portrait index={m.portrait} name={m.name} manager />
      <div>
        <b>{m.name}</b>
        <p>
          {tired
            ? `疲労が高い選手が${tired}人。休養も大事な練習ですよ。`
            : d.plan
              ? `「${plans[d.plan].name}」、目標まであと${Math.max(0, plans[d.plan].goal - d.progress)}日！ 一緒に頑張ろう。`
              : m.line}
        </p>
        <small>{supports[d.support].name}でサポート中</small>
      </div>
    </div>
  );
}
export function MatchCommands({
  s,
  run,
}: {
  s: State;
  run: (a: Action) => State | null;
}) {
  const m = s.match!,
    c = m.details.commands;
  const send = (field: keyof Commands, value: string | number | null) =>
    run({ type: 'command', field, value });
  return (
    <details className="detailed-commands" open>
      <summary>細かなチーム指示・個人の役割</summary>
      {/* MatchCommands は match-ui.tsx から試合中（!m.done）にしか呼ばれないため、
          m.done を理由にした無効化は常にfalseの死んだ分岐だった。DADSはdisabledを
          非推奨とするので、そもそも付けない（押しても常に有効。lib/development.ts
          側のtype:'command'ガードは試合終了後の防御として引き続き効く）。 */}
      <h3>攻撃の経路</h3>
      <Options
        label="攻撃の経路"
        value={c.lane}
        onChange={(v) => send('lane', v)}
        items={[
          { id: 'mixed', name: '自由に' },
          { id: 'wide', name: 'サイド' },
          { id: 'middle', name: '中央' },
        ]}
      />
      <h3>テンポ</h3>
      <Options
        label="テンポ"
        value={c.tempo}
        onChange={(v) => send('tempo', v)}
        items={[
          { id: 'patient', name: 'じっくり' },
          { id: 'normal', name: '標準' },
          { id: 'quick', name: '速く' },
        ]}
      />
      <h3>守備ライン</h3>
      <Options
        label="守備ライン"
        value={c.line}
        onChange={(v) => send('line', v)}
        items={[
          { id: 'deep', name: '低く' },
          { id: 'normal', name: '標準' },
          { id: 'high', name: '高く' },
        ]}
      />
      <label className="field">
        個別に役割を伝える選手
        <select
          value={c.player ?? ''}
          onChange={(e) =>
            send('player', e.target.value ? +e.target.value : null)
          }
        >
          <option value="">指定なし</option>
          {s.lineup.map((id) => {
            const p = s.players.find((p) => p.id === id)!;
            return (
              <option key={id} value={id}>
                {p.name} ({p.pos})
              </option>
            );
          })}
        </select>
      </label>
      {/* 個人の役割は対象選手を指定して初めて意味を持つため、未指定の間は
          選択肢ごと出さない（DADS: 押す意味がない場合は要素を出さない）。 */}
      {c.player !== null && (
        <Options
          label="個人の役割"
          value={c.role}
          onChange={(v) => send('role', v)}
          items={[
            { id: 'free', name: '自由に判断' },
            { id: 'attack', name: '積極的に仕掛ける' },
            { id: 'cover', name: '守備を優先' },
          ]}
        />
      )}
      <p className="muted">
        サイドは走力、中央はパスを活用。速いテンポは好機と疲労が増加。高いラインは相手のカウンターに注意。守備優先は攻撃の機会も減ります。
      </p>
    </details>
  );
}
export function VoicePanel({
  s,
  run,
}: {
  s: State;
  run: (a: Action) => State | null;
}) {
  const e = s.match?.details.moment;
  if (!e)
    return (
      <div className="voice-panel" id="match-voice">
        <h3>選手の行動を見て、声をかけよう。</h3>
        <p>15分進めると、選手の挑戦や守備の様子が届きます。</p>
      </div>
    );
  const p = s.players.find((p) => p.id === e.playerId)!;
  return (
    <section className="voice-panel" id="match-voice">
      <span className="eyebrow">A MOMENT TO GROW / {s.match!.minute}′</span>
      <div className="voice-player">
        <Portrait index={p.identity.portrait} name={p.name} />
        <div>
          <h3>
            {p.name} <span>{personalities[p.identity.personality].name}</span>
          </h3>
          <p>{e.text}</p>
        </div>
      </div>
      {e.answered ? (
        <p className="voice-response" role="status">
          {e.response}
        </p>
      ) : (
        <>
          <div className="voice-actions">
            {(
              [
                { id: 'praise', name: '挑戦をほめる' },
                { id: 'correct', name: '厳しく指摘する' },
                { id: 'encourage', name: '励ます' },
                { id: 'watch', name: '見守る' },
              ] as const
            ).map((v) => (
              <button
                className="secondary"
                key={v.id}
                onClick={() => run({ type: 'voice', voice: v.id })}
              >
                {v.name}
              </button>
            ))}
          </div>
          <small>
            声かけはこの場面で一度だけ。挑戦・守備への戻り・疲労を見分けよう。人を否定せず、プレーの改善を伝えます。
          </small>
        </>
      )}
    </section>
  );
}
