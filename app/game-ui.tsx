'use client';
import {
  Portrait,
  IdentityDetails,
  DevelopmentView,
  ManagerNote,
  MatchCommands,
  VoicePanel,
} from './development-ui';
import MatchCinema from './match-cinema';
import { personalities } from '@/lib/development';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  ClipboardList,
  Download,
  Dumbbell,
  Flag,
  HeartPulse,
  HelpCircle,
  Save,
  Settings2,
  Shield,
  Target,
  Trophy,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  act,
  newGame,
  validateSave,
  overall,
  strength,
  roster,
  slots,
  dateLabel,
  calendar,
  training,
  tactics,
  stats,
  type State,
  type Action,
  type Player,
  type Training,
  type Tactic,
  type Formation,
  type Stat,
} from '@/lib/game';

const SAVE_KEY = 'touchline-academy-v1';
const menu = [
  ['club', 'クラブハウス', Flag],
  ['team', '選手・編成', Users],
  ['season', '大会・日程', Trophy],
  ['future', '育成・スカウト', Target],
  ['history', '部の記録', ClipboardList],
] as const;
const trainingIcons = {
  balance: Dumbbell,
  attack: Target,
  possession: Users,
  defense: Shield,
  physical: Zap,
  rest: HeartPulse,
};
function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
    </div>
  );
}
function Meter({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className={`meter ${warn ? 'warning' : ''}`}>
      <div>
        <span>{label}</span>
        <b>{Math.round(value)}</b>
      </div>
      <Progress aria-label={label} value={value} />
    </div>
  );
}
function Choices({
  value,
  onChange,
  items,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      className="choices"
      value={value}
      onValueChange={(v) => onChange(String(v))}
      aria-label={label}
      disabled={disabled}
    >
      {items.map((i) => (
        <label key={i.value} className={value === i.value ? 'selected' : ''}>
          <RadioGroupItem value={i.value} />
          <span>{i.label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

function Pitch({
  s,
  onPick,
  live = false,
}: {
  s: State;
  onPick?: (p: Player) => void;
  live?: boolean;
}) {
  const positions = slots(s.formation);
  const team = roster(s);
  return (
    <div
      className={`pitch ${live ? 'live' : ''}`}
      aria-label={live ? '試合の戦術図' : 'スターティングイレブンの配置'}
    >
      <svg
        className="pitch-lines"
        viewBox="0 0 440 390"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M22 18H418V372H22ZM22 195H418M130 18V80H310V18M172 18V43H268V18M130 372V310H310V372M172 372V347H268V372" />
        <ellipse cx="220" cy="195" rx="45" ry="40" />
        <circle cx="220" cy="195" r="2" />
      </svg>
      {team.map((p, i) => {
        const pos = positions[i],
          members = positions.filter((x) => x === pos).length,
          order = positions.slice(0, i).filter((x) => x === pos).length,
          x = ((order + 1) / (members + 1)) * 100,
          y = pos === 'GK' ? 86 : pos === 'DF' ? 65 : pos === 'MF' ? 42 : 19;
        return (
          <button
            className={`pitch-player ${p.pos !== pos ? 'mismatch' : ''} ${p.injury ? 'injured' : ''}`}
            key={p.id}
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onPick?.(p)}
            aria-label={`${p.name} ${pos} 総合${overall(p)} 疲労${Math.round(p.fatigue)}`}
          >
            <Portrait index={p.identity.portrait} name={p.name} size="tiny" />
            <span className="number">{i + 1}</span>
            <span className="pitch-name">{p.name.split(' ')[0]}</span>
            <span className="energy">
              <i style={{ width: `${100 - p.fatigue}%` }} />
            </span>
          </button>
        );
      })}
      {live && (
        <span
          className="match-ball"
          key={s.match?.minute}
          style={{
            left: `${28 + (s.seed % 45)}%`,
            top: `${27 + (s.seed % 41)}%`,
          }}
          aria-hidden="true"
        >
          ●
        </span>
      )}
    </div>
  );
}

export default function Game() {
  const [s, setS] = useState<State | null>(null),
    [tab, setTab] = useState('club'),
    [plan, setPlan] = useState<Training>('balance'),
    [notice, setNotice] = useState(''),
    [saving, setSaving] = useState(''),
    [selected, setSelected] = useState<number | null>(null),
    [help, setHelp] = useState(false),
    [settings, setSettings] = useState(false),
    [welcome, setWelcome] = useState(false),
    [school, setSchool] = useState('風見ヶ丘高校'),
    [reset, setReset] = useState(false),
    [pendingImport, setPendingImport] = useState<State | null>(null),
    [filter, setFilter] = useState('all');
  const stateRef = useRef<State | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    actionRef = useRef<(a: Action) => State>(() => {
      throw Error('準備中です');
    });
  const persist = (next: State) => {
    stateRef.current = next;
    setS(next);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      setSaving('自動保存済み');
    } catch {
      setSaving('保存できません。データを書き出してください');
    }
  };
  const dispatch = (a: Action) => {
    if (!stateRef.current) throw Error('準備中です');
    const next = act(stateRef.current, a);
    persist(next);
    setNotice(
      a.type === 'train' || a.type === 'event' || a.type === 'upgrade'
        ? next.feed[0]
        : '',
    );
    return next;
  };
  actionRef.current = dispatch;
  const run = (a: Action) => {
    try {
      return dispatch(a);
    } catch (e) {
      setNotice((e as Error).message);
      return null;
    }
  };
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const loaded = validateSave(JSON.parse(raw));
        stateRef.current = loaded;
        setS(loaded);
        setSaving('自動保存済み');
        return;
      }
    } catch {
      setNotice(
        '保存データを読み込めませんでした。元のデータは上書きせず、新しい部を表示しています。',
      );
    }
    const fresh = newGame();
    stateRef.current = fresh;
    setS(fresh);
    setWelcome(true);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: { registerTool: (t: unknown, o: unknown) => unknown };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    for (const tool of [
      {
        name: 'read_club_status',
        description: 'Read the current local soccer club and match status.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const x = stateRef.current;
          if (!x) throw Error('Game loading');
          return {
            school: x.school,
            season: x.season,
            week: x.week,
            strength: strength(x),
            pending: x.pending,
            match: x.match
              ? {
                  minute: x.match.minute,
                  score: [x.match.home, x.match.away],
                  done: x.match.done,
                }
              : null,
          };
        },
      },
      {
        name: 'complete_training_week',
        description:
          'Complete one training week, grow players and advance the local game. Fails if a match or club event is pending.',
        inputSchema: {
          type: 'object',
          properties: {
            training: { type: 'string', enum: Object.keys(training) },
          },
          required: ['training'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          const v = input as { training?: Training };
          if (!v || !v.training || !Object.hasOwn(training, v.training))
            throw Error('Invalid training');
          const x = actionRef.current({ type: 'train', training: v.training });
          return {
            season: x.season,
            week: x.week,
            message: x.feed[0],
            pending: x.pending?.label || x.event,
          };
        },
      },
    ]) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: life.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => life.abort();
  }, []);
  const exportSave = () => {
    if (!stateRef.current) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(stateRef.current, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `touchline-season-${stateRef.current.season}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function importSave(file?: File) {
    if (!file) return;
    try {
      if (file.size > 250000)
        throw Error('250KB以下のセーブファイルを選んでください。');
      setPendingImport(validateSave(JSON.parse(await file.text())));
    } catch (e) {
      setNotice((e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = '';
  }
  if (!s)
    return (
      <main className="loading">
        <span className="wordmark">
          TOUCHLINE<span>ACADEMY</span>
        </span>
        <p>クラブハウスを準備しています…</p>
      </main>
    );
  const focus = s.players.find((p) => p.id === s.focus),
    player = s.players.find((p) => p.id === selected),
    fatigue = s.players.reduce((a, p) => a + p.fatigue, 0) / 18;
  const nextFixture = Array.from({ length: 48 - s.week }, (_, i) => ({
    week: s.week + i,
    f: calendar(s.week + i, s),
  })).find((x) => x.f);
  const coachTip = s.pending
    ? '試合の前に編成を確認。疲労の少ない選手を起用しましょう。'
    : fatigue > 55
      ? '疲労がたまっています。休養を入れて、けがと能力低下を防ぎましょう。'
      : s.week < 7
        ? 'まずは総合練習で基礎づくり。4週目に最初の練習試合です。'
        : !s.alive
          ? '今季の大会は終了。下級生の重点育成で来季につなげましょう。'
          : '相手の戦術を読み、育成と休養を組み合わせて大会に備えましょう。';
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        メインに移動
      </a>
      <header className="topbar">
        <a href="/" className="brand" aria-label="TOUCHLINE ACADEMY ホーム">
          <span className="brand-icon">
            <Flag size={23} />
          </span>
          <span className="wordmark">
            TOUCHLINE<span>ACADEMY</span>
          </span>
        </a>
        <div className="top-right">
          <span className="save-status">
            <span
              className={saving.includes('できません') ? 'dot bad' : 'dot'}
            />
            {saving || '端末内セーブ'}
          </span>
          <button
            className="icon-button"
            aria-label="遊び方"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="保存・設定"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={20} />
          </button>
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(String(v))}
        className="game-tabs"
      >
        <div className="nav-wrap">
          <TabsList className="main-nav" variant="line">
            {menu.map(([id, name, Icon]) => (
              <TabsTrigger key={id} value={id}>
                <Icon size={18} />
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="season-chip">
            SEASON {String(s.season).padStart(2, '0')}
          </span>
        </div>
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">HIGH SCHOOL FOOTBALL CLUB</span>
              <h1>
                {s.school}
                <span>サッカー部</span>
              </h1>
            </div>
            <div className="date">
              <CalendarDays size={19} />
              <div>
                <small>{s.season}年目</small>
                <strong>{dateLabel(s)}</strong>
              </div>
            </div>
          </div>
          {s.match ? (
            <MatchView s={s} run={run} onPlayer={(p) => setSelected(p.id)} />
          ) : (
            <>
              <TabsContent value="club">
                <ManagerNote s={s} />
                <div className="overview-grid">
                  <section className="club-hero">
                    <div className="hero-squad">
                      {s.players.slice(0, 3).map((p) => (
                        <div key={p.id}>
                          <Portrait
                            index={p.identity.portrait}
                            name={p.name}
                            size="large"
                          />
                          <b>{p.name}</b>
                          <small>
                            {personalities[p.identity.personality].name}
                          </small>
                        </div>
                      ))}
                    </div>
                    <div className="hero-shade" />
                    <div className="hero-content">
                      <span className="pill">
                        <span className="dot" />{' '}
                        {s.qualified
                          ? '全国への挑戦'
                          : s.alive
                            ? '全国を目指す、新しい一週間'
                            : '次の世代へ、つなぐ時間'}
                      </span>
                      <h2>
                        {s.pending
                          ? 'さあ、ピッチへ。'
                          : s.week >= 44
                            ? 'この仲間と、最後まで。'
                            : '一人ひとりを育て、\n未来のチームへ。'}
                      </h2>
                      <p>
                        {s.pending
                          ? `${s.pending.label} / ${s.pending.opponent}`
                          : '練習を決める。仲間を信じる。\nあなたの采配で、この部の未来を変えよう。'}
                      </p>
                      <div className="hero-bottom">
                        <span>
                          <Flag size={16} /> {s.best}
                        </span>
                        <span>部員 18名</span>
                      </div>
                    </div>
                  </section>
                  <section className="panel club-status">
                    <div className="section-head">
                      <h2>チームコンディション</h2>
                      <ChartNoAxesCombined size={19} />
                    </div>
                    <div className="rating">
                      <strong>{strength(s)}</strong>
                      <div>
                        <span>チーム総合力</span>
                        <small>疲労・配置を反映</small>
                      </div>
                      <span className="rank">
                        {s.reputation < 30
                          ? '新鋭'
                          : s.reputation < 60
                            ? '注目校'
                            : '強豪'}
                      </span>
                    </div>
                    <Meter label="チーム連携" value={s.cohesion} />
                    <Meter label="士気" value={s.morale} />
                    <Meter
                      label="平均疲労"
                      value={fatigue}
                      warn={fatigue > 55}
                    />
                    <div className="status-foot">
                      <span>
                        学校の評判 <b>{s.reputation}</b>
                      </span>
                      <span>
                        部費 <b>{s.funds}</b>
                      </span>
                    </div>
                  </section>
                </div>
                {s.event && (
                  <section className="event-panel">
                    <div>
                      <span className="eyebrow">CLUB EVENT</span>
                      <h2>{s.event}</h2>
                      <p>今週は、どんな時間を大切にしますか？</p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => run({ type: 'event', choice: 'team' })}
                    >
                      全員で話し合う <small>連携＋7 / 士気＋8</small>
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        run({ type: 'event', choice: 'individual' })
                      }
                    >
                      個別に指導する{' '}
                      <small>{focus?.name || '部員1人'}の全能力＋2</small>
                    </button>
                  </section>
                )}
                {s.pending ? (
                  <section className="fixture-banner">
                    <div className="fixture-icon">
                      <Trophy />
                    </div>
                    <div>
                      <span className="eyebrow">MATCH DAY</span>
                      <h2>{s.pending.label}</h2>
                      <p>
                        vs {s.pending.opponent} ・ 総合力 {s.pending.strength}{' '}
                        ・ {tactics[s.pending.style].name}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setTab('team')}
                    >
                      編成を確認
                    </button>
                    <button
                      className="primary"
                      onClick={() => run({ type: 'start' })}
                    >
                      試合へ進む <ArrowRight size={18} />
                    </button>
                  </section>
                ) : null}
                <div className="lower-grid">
                  <section className="panel training-panel">
                    <div className="section-head">
                      <div>
                        <span className="eyebrow">WEEKLY TRAINING</span>
                        <h2>今週の練習</h2>
                      </div>
                      <span className="muted">1回で1週間進行</span>
                    </div>
                    <RadioGroup
                      className="training-grid"
                      value={plan}
                      onValueChange={(v) => setPlan(v as Training)}
                      aria-label="練習メニュー"
                      disabled={!!s.pending || !!s.event}
                    >
                      {(Object.keys(training) as Training[]).map((key) => {
                        const t = training[key],
                          Icon = trainingIcons[key];
                        return (
                          <label
                            className={`training-card ${plan === key ? 'selected' : ''}`}
                            key={key}
                          >
                            <div>
                              <Icon size={21} />
                              <RadioGroupItem value={key} />
                            </div>
                            <strong>{t.name}</strong>
                            <span>{t.desc}</span>
                            <small className={key === 'rest' ? 'lime' : ''}>
                              疲労 {t.fatigue > 0 ? '+' : ''}
                              {t.fatigue}
                            </small>
                          </label>
                        );
                      })}
                    </RadioGroup>
                    <div className="training-footer">
                      <div>
                        <span className="muted">重点育成</span>
                        <button
                          className="text-link"
                          onClick={() => setTab('team')}
                        >
                          {focus?.name || '選手を指定する'}{' '}
                          <ChevronRight size={15} />
                        </button>
                      </div>
                      <button
                        className="primary"
                        disabled={!!s.pending || !!s.event}
                        onClick={() => run({ type: 'train', training: plan })}
                      >
                        この練習で1週間進める <ArrowRight size={18} />
                      </button>
                    </div>
                  </section>
                  <section className="panel lineup-preview">
                    <div className="section-head">
                      <h2>スターティング XI</h2>
                      <span className="formation-label">{s.formation}</span>
                    </div>
                    <Pitch s={s} onPick={(p) => setSelected(p.id)} />
                    <button
                      className="wide-link"
                      onClick={() => setTab('team')}
                    >
                      選手・編成を開く <ArrowRight size={16} />
                    </button>
                  </section>
                </div>
                <div className="bottom-grid">
                  <section className="coach-note">
                    <span className="coach-icon">
                      <ClipboardList />
                    </span>
                    <div>
                      <span className="eyebrow">COACH&apos;S NOTE</span>
                      <p>{coachTip}</p>
                    </div>
                  </section>
                  <section className="next-up">
                    <span className="eyebrow">NEXT MATCH</span>
                    <strong>{nextFixture?.f?.label || '来季への準備'}</strong>
                    <span>
                      {nextFixture
                        ? `${Math.floor(nextFixture.week / 4) + 4 > 12 ? Math.floor(nextFixture.week / 4) - 8 : Math.floor(nextFixture.week / 4) + 4}月 第${(nextFixture.week % 4) + 1}週`
                        : '3月は卒業・世代交代'}
                    </span>
                  </section>
                </div>
                <section className="activity">
                  <h2>部活ノート</h2>
                  {s.feed.slice(0, 4).map((line, i) => (
                    <p key={i}>
                      <span className={i === 0 ? 'dot' : 'dot dim'} />
                      {line}
                    </p>
                  ))}
                </section>
              </TabsContent>
              <TabsContent value="future">
                <DevelopmentView s={s} run={run} />
              </TabsContent>
              <TabsContent value="team">
                <div className="team-grid">
                  <section className="panel">
                    <div className="section-head">
                      <h2>戦術ボード</h2>
                      <button
                        className="secondary small"
                        onClick={() => run({ type: 'auto' })}
                      >
                        おすすめ編成
                      </button>
                    </div>
                    <Choices
                      label="フォーメーション"
                      value={s.formation}
                      onChange={(v) =>
                        run({ type: 'formation', formation: v as Formation })
                      }
                      items={['4-3-3', '4-4-2', '3-4-3'].map((v) => ({
                        value: v,
                        label: v,
                      }))}
                    />
                    <Pitch s={s} onPick={(p) => setSelected(p.id)} />
                    <p className="muted instruction">
                      選手を押すと能力と起用先を変更できます。適性外の配置は総合力が下がります。黄色の輪は適性外です。
                    </p>
                    <div className="facility">
                      <div>
                        <h3>練習設備 Lv.{s.facilities}</h3>
                        <p>
                          練習効率 ＋{(s.facilities - 1) * 14}% ・ 部費{' '}
                          {s.funds}
                        </p>
                      </div>
                      <button
                        className="secondary"
                        disabled={
                          s.funds < s.facilities * 40 || s.facilities >= 5
                        }
                        onClick={() => run({ type: 'upgrade' })}
                      >
                        {s.facilities === 5
                          ? '最高レベル'
                          : `強化する / ${s.facilities * 40}`}
                      </button>
                    </div>
                  </section>
                  <section className="panel roster-panel">
                    <div className="section-head">
                      <div>
                        <span className="eyebrow">SQUAD LIST</span>
                        <h2>
                          部員一覧 <span className="muted">18名</span>
                        </h2>
                      </div>
                      <span className="muted">重点育成は成長1.5倍</span>
                    </div>
                    <Choices
                      label="学年で絞り込み"
                      value={filter}
                      onChange={setFilter}
                      items={[
                        { value: 'all', label: '全員' },
                        ...['1', '2', '3'].map((v) => ({
                          value: v,
                          label: v + '年',
                        })),
                      ]}
                    />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>選手 / 学年</TableHead>
                          <TableHead>適性</TableHead>
                          <TableHead>総合</TableHead>
                          <TableHead>疲労</TableHead>
                          <TableHead>起用</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.players
                          .filter((p) => filter === 'all' || p.year === +filter)
                          .sort((a, b) => overall(b) - overall(a))
                          .map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>
                                <button
                                  className="player-link"
                                  onClick={() => setSelected(p.id)}
                                >
                                  <Portrait
                                    index={p.identity.portrait}
                                    name={p.name}
                                    size="tiny"
                                  />
                                  <span className="roster-name">
                                    {p.name}
                                    {s.focus === p.id && (
                                      <span className="focus-dot">★</span>
                                    )}
                                    <small>
                                      {p.year}年 /{' '}
                                      {p.injury
                                        ? `調整 ${p.injury}週`
                                        : personalities[p.identity.personality]
                                            .name}
                                    </small>
                                  </span>
                                </button>
                              </TableCell>
                              <TableCell>
                                <span className={`position pos-${p.pos}`}>
                                  {p.pos}
                                </span>
                              </TableCell>
                              <TableCell>
                                <b className="overall">{overall(p)}</b>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={
                                    p.fatigue > 65 ? 'danger-text' : ''
                                  }
                                >
                                  {Math.round(p.fatigue)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={
                                    s.lineup.includes(p.id) ? 'lime' : 'muted'
                                  }
                                >
                                  {s.lineup.includes(p.id) ? '先発' : '控え'}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </section>
                </div>
              </TabsContent>
              <TabsContent value="season">
                <div className="season-overview panel">
                  <div>
                    <span className="eyebrow">ROAD TO THE NATIONAL TITLE</span>
                    <h2>この一年が、部の歴史になる。</h2>
                    <p>
                      {s.best} / 今季 {s.seasonWins}勝・{s.seasonGoals}得点
                    </p>
                  </div>
                  <Trophy size={52} />
                </div>
                <div className="calendar-grid">
                  {Array.from({ length: 12 }, (_, month) => (
                    <section
                      className={`month-card ${Math.floor(s.week / 4) === month ? 'current' : ''}`}
                      key={month}
                    >
                      <h3>
                        {((month + 3) % 12) + 1}
                        <small>月</small>
                        {Math.floor(s.week / 4) === month && (
                          <span className="pill">今月</span>
                        )}
                      </h3>
                      {Array.from({ length: 4 }, (_, w) => {
                        const week = month * 4 + w,
                          f = calendar(week, {
                            ...s,
                            alive: true,
                            summerAlive: true,
                            qualified: true,
                          });
                        return (
                          <div
                            key={w}
                            className={`calendar-week ${week < s.week ? 'past' : ''} ${week === s.week ? 'now' : ''}`}
                          >
                            <span>{w + 1}週</span>
                            <strong>
                              {f?.label ||
                                (week === 47
                                  ? '卒業・新入生加入'
                                  : '練習・育成')}
                            </strong>
                            {week === s.week && <span className="dot" />}
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>
                <p className="muted instruction">
                  大会は勝ち抜き方式。県大会を優勝すると全国大会へ進みます。敗退後も育成は続き、4月には新しい世代で再挑戦できます。日程はゲーム用に簡略化した独自大会です。
                </p>
              </TabsContent>
              <TabsContent value="history">
                <div className="record-stats">
                  <Metric label="通算勝利" value={s.records.wins} suffix="勝" />
                  <Metric
                    label="通算得点"
                    value={s.records.goals}
                    suffix="点"
                  />
                  <Metric
                    label="全国優勝"
                    value={s.records.trophies}
                    suffix="回"
                  />
                  <Metric
                    label="指導したシーズン"
                    value={s.season}
                    suffix="年"
                  />
                </div>
                <section className="panel">
                  <div className="section-head">
                    <h2>世代のアルバム</h2>
                    <Trophy size={20} />
                  </div>
                  {s.history.length ? (
                    s.history.map((h) => (
                      <article key={h.season} className="year-record">
                        <span className="year-number">
                          {String(h.season).padStart(2, '0')}
                        </span>
                        <div>
                          <h3>{h.result}</h3>
                          <p>
                            {h.wins}勝 / {h.goals}得点
                          </p>
                          <p className="muted">
                            卒業生：{h.graduates.join('、')}
                          </p>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty-state">
                      <Flag size={36} />
                      <h3>最初の世代の物語は、ここから。</h3>
                      <p>
                        3月を終えると、この一年の成績と卒業生が記録されます。
                      </p>
                      <button
                        className="secondary"
                        onClick={() => setTab('club')}
                      >
                        クラブハウスへ
                      </button>
                    </div>
                  )}
                </section>
                <section className="activity">
                  <h2>最近の記録</h2>
                  {s.feed.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </section>
              </TabsContent>
            </>
          )}
        </main>
      </Tabs>
      <footer>
        <span>
          TOUCHLINE ACADEMY <small>v2.0</small>
        </span>
        <button onClick={() => setHelp(true)}>遊び方・クレジット</button>
        <span>無料 / 登録不要 / この端末に保存</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <Dialog open={welcome} onOpenChange={setWelcome}>
        <DialogContent className="game-dialog">
          <span className="eyebrow">WELCOME, COACH.</span>
          <DialogTitle>あなたの部の、はじまり。</DialogTitle>
          <DialogDescription>
            高校サッカー部の監督として、練習と采配で全国を目指しましょう。1年は48週。何年でも続けられます。
          </DialogDescription>
          <label className="field">
            学校名
            <input
              maxLength={20}
              value={school}
              onChange={(e) => setSchool(e.target.value)}
            />
          </label>
          <div className="onboarding-steps">
            <p>
              <b>01</b> 練習を選び、1週間進める
            </p>
            <p>
              <b>02</b> 疲労を見ながら、選手を育てる
            </p>
            <p>
              <b>03</b> 試合は15分ごとに采配する
            </p>
          </div>
          <button
            className="primary"
            onClick={() => {
              persist(newGame(school));
              setWelcome(false);
            }}
          >
            この学校で始める <ArrowRight size={18} />
          </button>
          <small className="muted">
            セーブはこのブラウザ内だけに保存されます。設定から書き出してバックアップできます。
          </small>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!player}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <DialogContent className="game-dialog player-dialog">
          {player && (
            <>
              <span className="eyebrow">PLAYER PROFILE / {player.year}年</span>
              <DialogTitle className="profile-name">
                {player.name}{' '}
                <span className={`position pos-${player.pos}`}>
                  {player.pos}
                </span>
              </DialogTitle>
              <DialogDescription>
                {player.trait} ・ {player.appearances}試合 / {player.goals}得点
                {player.injury ? ` ・ 調整あと${player.injury}週` : ''}
              </DialogDescription>
              <IdentityDetails player={player} />
              <div className="profile-summary">
                <Metric label="総合能力" value={overall(player)} />
                <Metric label="疲労" value={Math.round(player.fatigue)} />
                <Metric
                  label="成長の素質"
                  value={
                    player.talent > 1.35
                      ? 'A'
                      : player.talent > 1.15
                        ? 'B'
                        : 'C'
                  }
                />
              </div>
              <div className="stat-grid">
                {(Object.keys(stats) as Stat[]).map((k) => (
                  <Meter key={k} label={stats[k]} value={player.stats[k]} />
                ))}
              </div>
              {!s.match && (
                <button
                  className="secondary"
                  onClick={() =>
                    run({
                      type: 'focus',
                      id: s.focus === player.id ? null : player.id,
                    })
                  }
                >
                  {s.focus === player.id
                    ? '★ 重点育成を解除'
                    : '重点育成に指定する / 成長1.5倍'}
                </button>
              )}
              <h3>
                {s.match ? '交代する先発選手を選ぶ' : '先発の起用先を選ぶ'}
              </h3>
              <div className="assignment-grid">
                {roster(s).map((p, i) => (
                  <button
                    className="assignment"
                    key={i}
                    disabled={
                      s.match
                        ? !!s.match.done ||
                          s.match.used.includes(player.id) ||
                          s.match.subs >= 3 ||
                          !!player.injury
                        : p.id === player.id
                    }
                    onClick={() => {
                      if (run({ type: 'swap', index: i, id: player.id }))
                        setSelected(null);
                    }}
                  >
                    <b>
                      {slots(s.formation)[i]} {i + 1}
                    </b>
                    <span>{p.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
              {s.match && (
                <p className="muted">
                  交代は未出場の選手と3人まで。交代する控え選手をベンチから選んでください。
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="game-dialog">
          <DialogTitle>保存・設定</DialogTitle>
          <DialogDescription>
            ゲームは操作ごとに自動保存されます。端末やブラウザを変えるときは、セーブを書き出して移してください。
          </DialogDescription>
          <div className="settings-actions">
            <button className="secondary" onClick={exportSave}>
              <Download size={18} /> セーブを書き出す
            </button>
            <button
              className="secondary"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={18} /> セーブを読み込む
            </button>
            <button
              className="secondary"
              onClick={() => {
                persist(s);
                setNotice('現在のゲームを保存しました。');
              }}
            >
              <Save size={18} /> 今すぐ保存
            </button>
            <button className="danger-button" onClick={() => setReset(true)}>
              新しい部で始める
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => importSave(e.target.files?.[0])}
          />
          <p className="muted">
            ブラウザのデータ削除やプライベートモード終了でセーブが消えることがあります。定期的な書き出しをおすすめします。
          </p>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={reset || !!pendingImport}
        onOpenChange={(v) => {
          if (!v) {
            setReset(false);
            setPendingImport(null);
          }
        }}
      >
        <AlertDialogContent className="game-dialog">
          <AlertDialogTitle>
            {pendingImport
              ? 'セーブを読み込みますか？'
              : '新しい部で始めますか？'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            現在のゲームを置き換えます。残したい場合は、先に設定からセーブを書き出してください。
          </AlertDialogDescription>
          <AlertDialogCancel>戻る</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (pendingImport) {
                persist(pendingImport);
                setPendingImport(null);
                setNotice('セーブを読み込みました。');
              } else {
                persist(newGame());
                setWelcome(true);
              }
              setReset(false);
              setSettings(false);
              setTab('club');
            }}
          >
            置き換える
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="game-dialog help-dialog">
          <DialogTitle>監督の手引き</DialogTitle>
          <DialogDescription>
            18人の部員を育て、世代をつなぐ高校サッカー部シミュレーション。
          </DialogDescription>
          <div className="help-copy">
            <h3>練習と育成</h3>
            <p>
              練習を選んで1週間進めます。疲労が高いと能力が下がり、けがのリスクも増加。休養で33回復します。重点育成は1人を指定でき、練習による成長が1.5倍。部費を使った設備強化も有効です。
            </p>
            <h3>編成と試合</h3>
            <p>
              選手を押して先発の起用先を選びます。GK・DF・MF・FWの適性を合わせましょう。試合は15分ごとに進行。ポゼッションはカウンターに、カウンターはハイプレスに、ハイプレスはポゼッションに有利です。選手の能力や疲労、運も結果に影響します。
            </p>
            <p>
              攻撃重視は得点と失点が増え、守備重視は両方が減ります。交代はベンチの選手を選んで3人まで。大会の同点はPK戦です。試合後は元の先発編成に戻ります。
            </p>
            <h3>大会と世代交代</h3>
            <p>
              夏季招待大会、秋の県大会、冬の全国大会を戦います。県大会優勝が全国出場条件。3月終了で3年生が卒業し、新入生6人が加入。評判が高い学校には有望な選手が集まります。何年でも挑戦できます。
            </p>
            <h3>半年方針・スカウト・マネージャー</h3>
            <p>
              育成・スカウト画面で24週の方針を確定。対応能力の練習成長が25%増え、専門練習8週で報酬。期の途中から選ぶ場合も期限は同じです。学校の評判で候補の経歴が増え、視察・面談・内諾を経て来春の卒業枠に加入。活動は週1回です。マネージャーは選択した活動で週ごとに部を支えます。
            </p>
            <h3>声かけと試合の映像</h3>
            <p>
              15分ごとの選手の行動に一度だけ声をかけられます。挑戦や好守をほめ、戻りが遅ければ行動を厳しく指摘し、疲れた選手を励ます。適切な対応で能力と信頼が成長し、選手の思い出に残ります。慎重な性格の選手は不適切な叱責に傷つきやすくなります。
            </p>
            <p>
              細かな指示では攻撃経路・テンポ・守備ライン・個人の役割を変更。ゴールとセーブは試合結果に対応した2Dアニメーションで再生します。リプレイ、一時停止、スキップも可能です。
            </p>
            <h3>作品について</h3>
            <p>
              選手、チーム設定、大会、文章、画面デザインは本作独自のものです。画像はAIで制作した架空の人物。実在の選手・学校や既存ゲームとの提携はありません。名前が一致する場合も関係はありません。
            </p>
            <p>
              監督の判断を楽しむ育成シミュレーションです。試合はオリジナルのデフォルメ選手による2D演出です。連続した3D試合映像や手動での選手操作はありません。
            </p>
            <p>
              React / Base UI / shadcn/ui /
              Lucide等を使用。ライセンスと生成画像の記録は
              <a href="/credits.txt" target="_blank" rel="noreferrer">
                クレジット
              </a>
              へ。広告・外部解析・アカウント登録はありません。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MatchView({
  s,
  run,
  onPlayer,
}: {
  s: State;
  run: (a: Action) => State | null;
  onPlayer: (p: Player) => void;
}) {
  const m = s.match!;
  return (
    <section className="match-view">
      <div className="scoreboard">
        <div className="match-caption">
          <span className="pill">
            {m.done
              ? 'FULL TIME'
              : m.minute === 45
                ? 'HALF TIME'
                : 'MATCH LIVE'}
          </span>
          <span>{m.fixture.label}</span>
        </div>
        <div className="score-row">
          <div>
            <span className="club-emblem">
              <Flag size={30} />
            </span>
            <h2>{s.school}</h2>
            <small>HOME</small>
          </div>
          <div className="score">
            <strong>
              {m.home}
              <span>:</span>
              {m.away}
            </strong>
            <b>
              {m.done
                ? m.won
                  ? 'WIN'
                  : m.home === m.away && !m.penalties
                    ? 'DRAW'
                    : 'LOSE'
                : `${m.minute}′`}
            </b>
            {m.penalties && <small>PK {m.penalties}</small>}
          </div>
          <div>
            <span className="club-emblem away">
              <Shield size={30} />
            </span>
            <h2>{m.fixture.opponent}</h2>
            <small>{tactics[m.fixture.style].name}</small>
          </div>
        </div>
        <div className="match-stats">
          <span>
            シュート{' '}
            <b>
              {m.shots[0]} — {m.shots[1]}
            </b>
          </span>
          <span>
            得点期待値{' '}
            <b>
              {m.xg[0].toFixed(1)} — {m.xg[1].toFixed(1)}
            </b>
          </span>
          <span>
            ボール保持{' '}
            <b>
              {m.possession}% — {100 - m.possession}%
            </b>
          </span>
        </div>
      </div>
      <div className="match-actionbar">
        <nav aria-label="試合中の移動">
          <a href="#match-movie">映像</a>
          <a href="#match-voice">声かけ</a>
          <a href="#match-tactics">戦術</a>
          <a href="#match-bench">交代</a>
        </nav>{' '}
        <button
          className="primary match-advance"
          onClick={() => {
            const next = run({ type: m.done ? 'finish' : 'segment' });
            if (next)
              requestAnimationFrame(() =>
                document
                  .getElementById(m.done ? 'main' : 'match-movie')
                  ?.scrollIntoView({ block: 'start' }),
              );
          }}
        >
          {m.done
            ? '結果を確定して部に戻る'
            : m.minute === 45
              ? '後半の15分を進める'
              : '次の15分を進める'}{' '}
          <ArrowRight size={19} />
        </button>
      </div>
      <MatchCinema key={m.minute} s={s} />
      <VoicePanel s={s} run={run} />
      <div className="match-grid">
        <section className="panel">
          <div className="section-head">
            <h2>タッチラインからの指示</h2>
            <span className="formation-label">{s.formation}</span>
          </div>
          <Pitch s={s} live onPick={onPlayer} />
          <div className="live-log" aria-live="polite">
            {m.logs.slice(0, 5).map((l, i) => (
              <p
                className={l.includes('GOAL') ? 'goal-log' : ''}
                key={`${m.minute}-${i}`}
              >
                {l}
              </p>
            ))}
          </div>
        </section>
        <section className="panel command-panel" id="match-tactics">
          <span className="eyebrow">MANAGER&apos;S DECISION</span>
          <h2>
            {m.done
              ? '試合終了'
              : m.minute === 45
                ? '後半のプランを。'
                : '次の15分を、どう戦う？'}
          </h2>
          <p className="muted">
            相手：{tactics[m.fixture.style].name} / 総合力 {m.fixture.strength}
          </p>
          <RadioGroup
            className="tactic-grid"
            aria-label="試合の戦術"
            value={m.tactic}
            onValueChange={(v) => run({ type: 'tactic', tactic: v as Tactic })}
            disabled={m.done}
          >
            {(Object.keys(tactics) as Tactic[]).map((key) => (
              <label
                key={key}
                className={`tactic-card ${m.tactic === key ? 'selected' : ''}`}
              >
                <RadioGroupItem value={key} />
                <div>
                  <b>{tactics[key].name}</b>
                  <small>{tactics[key].desc}</small>
                </div>
              </label>
            ))}
          </RadioGroup>
          <h3>攻守の意識</h3>
          <Choices
            label="攻守の意識"
            value={m.mentality}
            disabled={m.done}
            onChange={(v) =>
              run({
                type: 'mentality',
                mentality: v as 'safe' | 'normal' | 'attack',
              })
            }
            items={[
              { value: 'safe', label: '守備重視' },
              { value: 'normal', label: '標準' },
              { value: 'attack', label: '攻撃重視' },
            ]}
          />
          <MatchCommands s={s} run={run} />
          <div className="bench-head" id="match-bench">
            <h3>ベンチ</h3>
            <span>交代 {m.subs} / 3</span>
          </div>
          <div className="bench">
            {s.players
              .filter((p) => !s.lineup.includes(p.id))
              .map((p) => (
                <button
                  key={p.id}
                  disabled={
                    m.done || m.used.includes(p.id) || m.subs >= 3 || !!p.injury
                  }
                  onClick={() => onPlayer(p)}
                >
                  <Portrait
                    index={p.identity.portrait}
                    name={p.name}
                    size="tiny"
                  />
                  <span className={`position pos-${p.pos}`}>{p.pos}</span>
                  <b>{p.name}</b>
                  <small>
                    {m.used.includes(p.id)
                      ? '交代済'
                      : p.injury
                        ? '調整中'
                        : `疲労 ${Math.round(p.fatigue)}`}
                  </small>
                </button>
              ))}
          </div>

          <small className="muted">
            {m.done
              ? '結果は保存済み。戻ると日程が次の週へ進みます。'
              : '采配は次の15分に反映。途中でも自動保存されます。'}
          </small>
        </section>
      </div>
    </section>
  );
}
