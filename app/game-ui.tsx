'use client';
import {
  Portrait,
  IdentityDetails,
  DevelopmentView,
  ManagerNote,
  PotentialBadge,
} from './development-ui';
import { personalities } from '@/lib/development';
import { formationSlots, detailInfo, isBenchPlayer, DETAIL_POS, basePos, type DetailPos } from '@/lib/squad';
import {
  SquadPanel,
  SquadProfile,
  SquadTeamToggle,
  PlayStyleSelector,
  PrimaryPositionSelector,
} from './squad-ui';
import { AbilitySheet } from './ability-sheet';
import { LifeEventPanel } from './life-ui';
import { AudioSettingsPanel } from './audio-ui';
import { playScene, playSfx, primeAudio } from '@/lib/audio';
import { MatchView, Metric, Meter, Choices, Pitch } from './match-ui';
import { CompetitionPanel } from './competition-ui';
import { readCompetition, competitionFixture } from '@/lib/competition';
import { EventStills, type EventStillsChoice, type EventStillsResult } from './event-scenes';
import { getEventScenePanels } from '@/lib/event-scenes';
import { Progress } from '@/components/ui/progress';
import { TrainingPolicyBanner, TrainingPolicyPanel } from './training-policy-ui';

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
  MapPin,
  Save,
  Settings2,
  Shield,
  Star,
  Target,
  Trophy,
  Upload,
  Users,
  Wallet,
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
import {
  act,
  newGame,
  validateSave,
  strength,
  roster,
  dateLabel,
  training,
  tactics,
  DOW_NAMES,
  MATCH_MAX_SUBS,
  facilityUpgradeCost,
  LINEUP_POLICIES,
  lineupPolicyInfo,
  fixtureFormation,
  formationHint,
  type State,
  type Action,
  type Training,
  type Formation,
  type LineupPolicy,
} from '@/lib/game';

const SAVE_KEY = 'touchline-academy-v1';
// D1: ライト/ダークテーマの明示指定を保存するキー。app/layout.tsx のちらつき防止スクリプトと
// 同じキー・同じ値（'light' | 'dark'）を使う。未保存（＝'system'）は端末設定に追従する。
const THEME_KEY = 'touchline-academy-theme';
type ThemePref = 'system' | 'light' | 'dark';
function readStoredTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {}
  return 'system';
}
const menu = [
  ['club', 'クラブハウス', Flag],
  ['team', '選手・編成', Users],
  ['season', '大会・日程', Trophy],
  ['future', '育成・スカウト', Target],
  ['history', '部の記録', ClipboardList],
] as const;
const trainingIcons: Record<Training, typeof Dumbbell> = {
  balance: Dumbbell,
  attack: Target,
  possession: Users,
  defense: Shield,
  physical: Zap,
  rest: HeartPulse,
  position: MapPin,
};
// S1: lib/game.ts の training[].fatigue は「従来の週あたり」の目安値のまま残している
// （互換・参照用）。日次コマンドでの実際の1日あたりの疲労変化は
// 休養=-15固定、それ以外=t.fatigue/6-3（自然回復込み）なので、表示用に換算する。
function dailyFatigueDelta(key: Training): number {
  return key === 'rest' ? -15 : Math.round(training[key].fatigue / 6 - 3);
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
    [policyOpen, setPolicyOpen] = useState(false),
    [welcome, setWelcome] = useState(false),
    [school, setSchool] = useState('風見ヶ丘高校'),
    [reset, setReset] = useState(false),
    [pendingImport, setPendingImport] = useState<State | null>(null),
    // 初期値は遅延初期化で読む（マウント後のeffectでsetStateすると二度描画になるため）。
    // layout.tsx のちらつき防止スクリプトがハイドレーション前に <html data-theme> を
    // 付け終えているので、ここでの読み込みは状態表示（設定ダイアログのラジオ）を
    // 実際の保存値に合わせるためだけに使う。
    [theme, setTheme] = useState<ThemePref>(() =>
      typeof window === 'undefined' ? 'system' : readStoredTheme(),
    );
  useEffect(() => {
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {}
    const root = document.documentElement;
    if (theme === 'system') {
      // globals.css 自前のトークンは data-theme 無し＋@media(prefers-color-scheme)で
      // 自動追従するが、shadcn/ui 側の Tailwind `dark:` バリアントは .dark クラスを
      // 見ている（@custom-variant dark (&:is(.dark *))）ため、端末設定に合わせて
      // ここでも .dark を付け外しし、端末設定が変わった場合もライブで追従させる。
      root.removeAttribute('data-theme');
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => root.classList.toggle('dark', mq.matches);
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const stateRef = useRef<State | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    mainRef = useRef<HTMLElement | null>(null),
    scrollMemory = useRef<Record<string, number>>({}),
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
    // ユーザー操作（このディスパッチ）を起点に AudioContext を起動・再開する。
    // 設定でBGM/SEがオフの間は無音のまま（lib/audio.ts 側でガード済み）。
    primeAudio();
    const next = act(stateRef.current, a);
    persist(next);
    setNotice(
      a.type === 'train' ||
        a.type === 'autoWeek' ||
        a.type === 'event' ||
        a.type === 'upgrade'
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
  const lastGoalLogRef = useRef<string | null>(null);
  useEffect(() => {
    // 場面に応じてBGMを切り替える。設定でBGMがオフの間は lib/audio.ts 側が
    // 無音のまま場面だけを記憶するので、常に呼んでよい。
    if (!s) return;
    if (s.match) {
      const latest = s.match.logs[0] ?? null;
      if (latest && latest.includes('GOAL') && latest !== lastGoalLogRef.current) {
        playSfx('goal');
      }
      lastGoalLogRef.current = latest;
      playScene(s.match.done ? (s.match.won ? 'victory' : 'defeat') : 'match');
    } else {
      lastGoalLogRef.current = null;
      playScene(s.pending ? 'prematch' : 'clubhouse');
    }
  }, [s]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    // W6: 横画面ではタブ本文だけが独立スクロールする（main-content が overflow: auto に
    // なる）。タブを離れる前のスクロール位置を憶えておき、戻ってきたら復元する。
    // main-content が通常のページスクロールのまま（縦持ち・デスクトップ）の場合は
    // scrollTop は常に0なので、この処理は何もしない（無害）。
    const el = mainRef.current;
    // instant 指定: main-content には scroll-behavior: smooth を付けていないため通常は
    // 不要だが、ブラウザ既定や将来の変更に関わらず復元だけは必ず即時にする。
    el?.scrollTo({ top: scrollMemory.current[tab] || 0, behavior: 'instant' });
  }, [tab]);
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
        name: 'complete_training_day',
        description:
          'Complete one training day (Mon-Sat), grow players and advance the local game by one day. A week is 6 training days plus a match (or an automatic off day) on Sunday. Fails if a match or club event is pending.',
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
            day: x.day,
            message: x.feed[0],
            pending: x.pending?.label || x.event,
          };
        },
      },
      {
        name: 'advance_to_match_day',
        description:
          'Automatically advance day by day using the saved weekly training menu until a match is scheduled, or stop early on a newly triggered life event, club event, or injury that day.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: () => {
          const x = actionRef.current({ type: 'autoWeek' });
          return {
            season: x.season,
            week: x.week,
            day: x.day,
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
    // S4: ポジション練習の対象（選手＋ポジション）。
    positionFocusPlayer = s.players.find((p) => p.id === s.positionFocus?.id),
    fatigue = s.players.reduce((a, p) => a + p.fatigue, 0) / s.players.length;
  // W2配線: 予定表・シーズン状況はすべて lib/competition.ts の大会データ（s.v3.competition）から
  // 導出する。旧 s.qualified/s.alive/s.summerAlive は試合結果の反映先ではなくなったため、表示にも使わない。
  const comp = readCompetition(s);
  const nextFixture = Array.from({ length: 48 - s.week }, (_, i) => ({
    week: s.week + i,
    f: competitionFixture(s, s.week + i),
  })).find((x) => x.f);
  // 「大会・日程」タブの年間カレンダーは、実際の敗退状況にかかわらず1年分の予定を一覧できるよう、
  // インターハイ・選手権を「勝ち上がった場合」の想定（alive/qualified=true）でプレビューする。
  const seasonPreviewState: State = {
    ...s,
    v3: {
      ...s.v3,
      competition: {
        ...comp,
        ih: { ...comp.ih, alive: true, qualified: true },
        wc: { ...comp.wc, alive: true, qualified: true },
      },
    },
  };
  const cupsAlive = comp.ih.alive || comp.wc.alive;
  const cupsQualified =
    (comp.ih.qualified && comp.ih.alive) || (comp.wc.qualified && comp.wc.alive);
  const coachTip = s.pending
    ? '試合の前に編成を確認。疲労の少ない選手を起用しましょう。'
    : fatigue > 55
      ? '疲労がたまっています。休養を入れて、けがと能力低下を防ぎましょう。'
      : s.week < 7
        ? 'まずは総合練習で基礎づくり。4週目に最初の練習試合です。'
        : !cupsAlive
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
        <main
          id="main"
          className="main-content"
          tabIndex={-1}
          ref={mainRef}
          onScroll={(e) => {
            scrollMemory.current[tab] = e.currentTarget.scrollTop;
          }}
        >
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
                        {cupsQualified
                          ? '全国への挑戦'
                          : cupsAlive
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
                        <span>部員 {s.players.length}名</span>
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
                        学校の評判 <b>{Math.round(s.reputation)}</b>
                      </span>
                      <span>
                        部費 <b>{s.funds}</b>
                      </span>
                    </div>
                  </section>
                </div>
                {s.event &&
                  (() => {
                    // W9/D1: クラブイベントは、週の学校生活イベント（LifeEventPanel）と同じ
                    // EventStills（情景→場面→結果の紙芝居）で表示する。選手個人のイベントでは
                    // ないため、代表として重点育成の選手（未指定なら部員1人目）の顔を使う。
                    const scenePanels = getEventScenePanels(s.event);
                    const repPlayer = focus ?? s.players[0] ?? null;
                    if (!scenePanels || !repPlayer) {
                      // 対応表に無い／部員が0人などの異常系のみの保険（通常到達しない）。
                      return (
                        <section className="event-panel">
                          <div>
                            <span className="eyebrow">CLUB EVENT</span>
                            <h2>{s.event}</h2>
                            <p>今週は、どんな時間を大切にしますか？</p>
                          </div>
                          <button
                            className="secondary"
                            onClick={() => {
                              playSfx('click');
                              run({ type: 'event', choice: 'team' });
                            }}
                          >
                            全員で話し合う <small>連携＋7 / 士気＋8</small>
                          </button>
                          <button
                            className="secondary"
                            onClick={() => {
                              playSfx('click');
                              run({ type: 'event', choice: 'individual' });
                            }}
                          >
                            個別に指導する{' '}
                            <small>{focus?.name || '部員1人'}の全能力＋2</small>
                          </button>
                        </section>
                      );
                    }
                    const momentByEvent: Record<string, string> = {
                      部員たちの自主練習:
                        '居残って自主練習をする部員たちを前に、どう声をかけますか？',
                      主将からの提案: '改まった様子の主将に、どう向き合いますか？',
                      雨の日のミーティング:
                        '雨で練習ができない今日、部室でどう過ごしますか？',
                    };
                    const choices: EventStillsChoice[] = [
                      {
                        id: 'team',
                        label: '全員で話し合う',
                        hints: [
                          { label: '連携+7', positive: true },
                          { label: '士気+8', positive: true },
                        ],
                      },
                      {
                        id: 'individual',
                        label: '個別に指導する',
                        hints: [{ label: `${repPlayer.name}の全能力+2`, positive: true }],
                      },
                    ];
                    const resolveResult = (choiceId: string): EventStillsResult =>
                      choiceId === 'team'
                        ? {
                            text: '部員全員でじっくり話し合い、チームの結びつきが強まった。',
                            effects: [
                              { label: '連携+7', positive: true },
                              { label: '士気+8', positive: true },
                            ],
                          }
                        : {
                            text: `${repPlayer.name}と1対1で向き合い、丁寧に指導した。`,
                            effects: [
                              { label: `${repPlayer.name}の全能力+2`, positive: true },
                            ],
                          };
                    return (
                      <section className="event-panel-stills" aria-label="クラブイベント">
                        <EventStills
                          key={`${s.event}-${s.week}-${s.season}`}
                          scenePanels={scenePanels}
                          playerName={repPlayer.name}
                          portraitIndex={repPlayer.identity.portrait}
                          kicker={
                            <>
                              <Flag size={14} /> CLUB EVENT
                            </>
                          }
                          heading={s.event}
                          metaLine="今週は、どんな時間を大切にしますか？"
                          momentNarration={
                            momentByEvent[s.event] ??
                            `${s.event}。どちらの方針で臨みますか？`
                          }
                          choices={choices}
                          resolveResult={resolveResult}
                          onCommit={(choiceId) => {
                            playSfx('click');
                            run({ type: 'event', choice: choiceId as 'team' | 'individual' });
                          }}
                        />
                      </section>
                    );
                  })()}
                <LifeEventPanel
                  state={s}
                  onChoose={(choiceId) => {
                    playSfx('click');
                    run({ type: 'life', choiceId });
                  }}
                />
                <TrainingPolicyBanner s={s} onOpen={() => setPolicyOpen(true)} />
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
                        ・ {tactics[s.pending.style].name} ・ {fixtureFormation(s.pending)}
                      </p>
                      {formationHint(fixtureFormation(s.pending)) && (
                        <p>{formationHint(fixtureFormation(s.pending))}</p>
                      )}
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setTab('team')}
                    >
                      編成を確認
                    </button>
                    <button
                      className="primary"
                      onClick={() => {
                        playSfx('whistle');
                        run({ type: 'start' });
                      }}
                    >
                      試合へ進む <ArrowRight size={18} />
                    </button>
                  </section>
                ) : null}
                <div className="lower-grid">
                  <section className="panel training-panel">
                    <div className="section-head">
                      <div>
                        <span className="eyebrow">DAILY TRAINING</span>
                        <h2>今日の練習</h2>
                      </div>
                      <span className="muted">月〜土は1日ごと・日曜は試合</span>
                    </div>
                    {/* 今週6日間の予定と、どこまで実施済みかを1行で見せる（S1）。
                        s.day より前の枠は実施済み、s.day は今日、それより先は予定。 */}
                    {!s.pending && (
                      <p className="muted" style={{ margin: '0 0 10px' }}>
                        今週：
                        {s.weeklyMenu.map((t, i) => (
                          <span key={i}>
                            {i > 0 ? ' / ' : ''}
                            {DOW_NAMES[i]}
                            {i < s.day ? '済' : i === s.day ? '(今日)' : ''}
                            {training[t].name.slice(0, 2)}
                          </span>
                        ))}
                      </p>
                    )}
                    {/* 練習メニューを選ぶだけでは何も進行しない（ローカルなプレビュー
                        状態）ため、試合・イベント待ちの間も選ばせて構わない。実際に
                        日を進める操作は下のボタン側でガードする。 */}
                    <RadioGroup
                      className="training-grid"
                      value={plan}
                      onValueChange={(v) => setPlan(v as Training)}
                      aria-label="練習メニュー"
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
                              疲労(1日) {dailyFatigueDelta(key) > 0 ? '+' : ''}
                              {dailyFatigueDelta(key)}
                            </small>
                          </label>
                        );
                      })}
                    </RadioGroup>
                    <div>
                      <span className="muted">重点育成</span>
                      <button
                        className="text-link"
                        onClick={() => setTab('team')}
                      >
                        {focus?.name || '選手を指定する'} <ChevronRight size={15} />
                      </button>
                    </div>
                    <div>
                      <span className="muted">ポジション練習の対象</span>
                      <button
                        className="text-link"
                        onClick={() => setTab('team')}
                      >
                        {positionFocusPlayer && s.positionFocus
                          ? `${positionFocusPlayer.name} / ${detailInfo[s.positionFocus.pos].name}`
                          : '選手とポジションを指定する'}{' '}
                        <ChevronRight size={15} />
                      </button>
                      {s.positionFocus && (
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => run({ type: 'positionFocus', id: null, pos: null })}
                        >
                          解除
                        </button>
                      )}
                    </div>
                    <div>
                      <span className="muted">今月の個人方針</span>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setPolicyOpen(true)}
                      >
                        選手ごとの方針を確認・変更する <ChevronRight size={15} />
                      </button>
                    </div>
                    {!s.pending && (
                      <div className="training-footer">
                        <button
                          className="secondary"
                          aria-disabled={!!s.event || !!s.v3.life.current}
                          onClick={() => {
                            playSfx('click');
                            run({ type: 'train', training: plan });
                          }}
                        >
                          今日は{training[plan].name}で1日進める
                        </button>
                        <button
                          className="primary"
                          aria-disabled={!!s.event || !!s.v3.life.current}
                          onClick={() => {
                            playSfx('click');
                            run({ type: 'autoWeek' });
                          }}
                        >
                          試合日まで進める <ArrowRight size={18} />
                        </button>
                      </div>
                    )}
                    <details className="weekly-menu-editor">
                      <summary>週間メニューを編集</summary>
                      <p className="muted">
                        「試合日まで進める」はここで決めたメニューで自動進行します。
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '10px',
                        }}
                      >
                        {s.weeklyMenu.map((t, i) => (
                          <label className="field" key={i} style={{ minWidth: '120px' }}>
                            {DOW_NAMES[i]}曜
                            <select
                              value={t}
                              onChange={(e) => {
                                const menu = [...s.weeklyMenu];
                                menu[i] = e.target.value as Training;
                                run({ type: 'setMenu', menu });
                              }}
                            >
                              {(Object.keys(training) as Training[]).map((key) => (
                                <option key={key} value={key}>
                                  {training[key].name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </details>
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
                {/* T4.2: 部費の見える化。「設備強化まであと◯」のゲージと直近の収入5件。
                    実際の設備強化ボタンは「選手・編成」タブに残したまま（経済バランスは
                    変えず、表示だけをここに足す）。 */}
                <section className="panel club-funds" aria-label="部費">
                  <div className="section-head">
                    <h2>
                      <Wallet size={18} aria-hidden="true" /> 部費
                    </h2>
                    <span className="muted">
                      現在 <b>{s.funds}</b>
                    </span>
                  </div>
                  {s.facilities < 5 ? (
                    <div className="funds-gauge">
                      <div>
                        <span>設備強化まで</span>
                        <b>あと {Math.max(0, facilityUpgradeCost(s.facilities) - s.funds)}</b>
                      </div>
                      <Progress
                        aria-label="設備強化までの部費"
                        value={Math.max(0, Math.min(100, (s.funds / facilityUpgradeCost(s.facilities)) * 100))}
                      />
                    </div>
                  ) : (
                    <p className="muted">練習設備は最高レベルです。</p>
                  )}
                  <h3 className="v2-subhead">直近の収入</h3>
                  {s.fundHistory.length ? (
                    <ul className="funds-history">
                      {s.fundHistory.slice(0, 5).map((f, i) => (
                        <li key={i}>
                          <b>+{f.amount}</b>
                          <span>{f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">まだ収入の記録がありません。</p>
                  )}
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
                      label="おまかせ編成の方針"
                      value={s.autoLineupPolicy}
                      onChange={(v) =>
                        run({ type: 'autoLineupPolicy', policy: v as LineupPolicy })
                      }
                      items={LINEUP_POLICIES.map((p) => ({
                        value: p,
                        label: lineupPolicyInfo[p].name,
                      }))}
                    />
                    <p className="muted instruction">
                      {lineupPolicyInfo[s.autoLineupPolicy].desc}
                    </p>
                    <Choices
                      label="試合前に自動で編成する"
                      value={s.autoLineupOnMatch ? 'on' : 'off'}
                      onChange={(v) =>
                        run({ type: 'autoLineupOnMatch', on: v === 'on' })
                      }
                      items={[
                        { value: 'on', label: '自動で編成する' },
                        { value: 'off', label: '手動のまま' },
                      ]}
                    />
                    <Choices
                      label="フォーメーション"
                      value={s.formation}
                      onChange={(v) =>
                        run({ type: 'formation', formation: v as Formation })
                      }
                      items={['4-3-3', '4-4-2', '3-4-3', '4-2-3-1'].map((v) => ({
                        value: v,
                        label: v,
                      }))}
                    />
                    <Pitch s={s} onPick={(p) => setSelected(p.id)} />
                    <p className="muted instruction">
                      選手を押すと能力と起用先を変更できます。起用先は詳細ポジション（例:
                      CB・DM・CFなど）で決まり、同じ系統内なら低下はわずか、系統をまたぐ配置は総合力が大きく下がります。黄色の輪はGK/DF/MF/FWの系統をまたぐ適性外です。
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
                        aria-disabled={
                          s.funds < facilityUpgradeCost(s.facilities) || s.facilities >= 5
                        }
                        onClick={() => run({ type: 'upgrade' })}
                      >
                        {s.facilities === 5
                          ? '最高レベル'
                          : `強化する / ${facilityUpgradeCost(s.facilities)}`}
                      </button>
                    </div>
                  </section>
                  <SquadPanel s={s} run={run} onSelect={setSelected} />
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
                <CompetitionPanel
                  state={s}
                  onChoosePrefecture={(districtId) =>
                    run({ type: 'compPrefecture', districtId })
                  }
                />
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
                          f = competitionFixture(seasonPreviewState, week);
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
                  U18リーグは通年のホーム&アウェー総当たり。インターハイ・選手権は勝ち抜き方式で、
                  県予選を優勝すると全国大会へ進みます。敗退後も育成もリーグ戦も続き、4月には新しい世代で再挑戦できます。
                  日程はゲーム用に簡略化した独自大会です。
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
          TOUCHLINE ACADEMY <small>v3.0</small>
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
              <b>01</b> 週間メニューを決め、試合日まで進める
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
              // ここがほぼ全ての新規プレイヤーにとって最初の操作になるため、
              // ここで AudioContext を起動しておく（実際に音が鳴るのは設定でオンにしてから）。
              primeAudio();
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
                <Metric label="疲労" value={Math.round(player.fatigue)} />
                <div className="metric">
                  <span>成長の素質</span>
                  <strong className="profile-potential-value">
                    <PotentialBadge potential={player.talent} />
                  </strong>
                </div>
              </div>
              {s.v3.squad.players[player.id] && (
                <>
                  <AbilitySheet
                    p={player}
                    ps={s.v3.squad.players[player.id]}
                    policy={s.v3.trainingPolicy.players[player.id]}
                  />
                  <SquadProfile ps={s.v3.squad.players[player.id]} />
                </>
              )}
              {!s.match && (
                <div className="profile-actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      run({
                        type: 'focus',
                        id: s.focus === player.id ? null : player.id,
                      })
                    }
                  >
                    {s.focus === player.id ? (
                      <>
                        <Star size={14} aria-hidden="true" fill="currentColor" />
                        重点育成を解除
                      </>
                    ) : (
                      '重点育成に指定する / 成長1.5倍'
                    )}
                  </button>
                  {s.v3.squad.players[player.id] && (
                    <SquadTeamToggle
                      p={player}
                      ps={s.v3.squad.players[player.id]}
                      run={run}
                    />
                  )}
                </div>
              )}
              {!s.match && s.v3.squad.players[player.id] && (
                <div className="profile-actions position-focus-picker">
                  <label className="field">
                    ポジション練習の対象にする
                    <select
                      value={s.positionFocus?.id === player.id ? s.positionFocus.pos : ''}
                      onChange={(e) => {
                        if (e.target.value)
                          run({
                            type: 'positionFocus',
                            id: player.id,
                            pos: e.target.value as DetailPos,
                          });
                      }}
                    >
                      <option value="">鍛えるポジションを選ぶ</option>
                      {DETAIL_POS.filter((d) => basePos(d) === player.pos).map((d) => (
                        <option key={d} value={d}>
                          {detailInfo[d].name}（{d}）
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {!s.match && s.v3.squad.players[player.id] && (
                <>
                  <PlayStyleSelector p={player} ps={s.v3.squad.players[player.id]} run={run} />
                  <PrimaryPositionSelector p={player} ps={s.v3.squad.players[player.id]} run={run} />
                </>
              )}
              <h3>
                {s.match ? '交代する先発選手を選ぶ' : '先発の起用先を選ぶ'}
              </h3>
              <div className="assignment-grid">
                {roster(s).map((p, i) => (
                  <button
                    type="button"
                    className="assignment"
                    key={i}
                    aria-disabled={
                      s.match
                        ? !!s.match.done ||
                          s.match.used.includes(player.id) ||
                          s.match.subs >= MATCH_MAX_SUBS ||
                          !!player.injury ||
                          !isBenchPlayer(s, player.id)
                        : p.id === player.id ||
                          s.v3.squad.players[player.id]?.team !== 'A'
                    }
                    onClick={() => {
                      if (run({ type: 'swap', index: i, id: player.id }))
                        setSelected(null);
                    }}
                  >
                    <b>
                      {detailInfo[formationSlots(s.formation)[i]].name} {i + 1}
                    </b>
                    <span>{p.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
              {s.match && (
                <p className="muted">
                  交代はベンチ入りの未出場・健康な選手と{MATCH_MAX_SUBS}人まで。ベンチ外の選手は交代投入できません。
                </p>
              )}
              {!s.match && s.v3.squad.players[player.id]?.team !== 'A' && (
                <p className="muted">
                  Bチームの選手は先発にできません。先にAチームへ移してください。
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={policyOpen}
        onOpenChange={(v) => {
          if (!v) {
            run({ type: 'trainingPolicyReviewed' });
            setPolicyOpen(false);
          } else setPolicyOpen(true);
        }}
      >
        <DialogContent className="game-dialog policy-dialog">
          <DialogTitle>今月の個人方針</DialogTitle>
          <DialogDescription>
            選手ごとに伸ばしたい能力を選べます。月の途中でも変更できます。
          </DialogDescription>
          <TrainingPolicyPanel
            s={s}
            run={run}
            onClose={() => {
              run({ type: 'trainingPolicyReviewed' });
              setPolicyOpen(false);
            }}
          />
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
          <h3>テーマ</h3>
          <Choices
            label="テーマ"
            value={theme}
            onChange={(v) => setTheme(v as ThemePref)}
            items={[
              { value: 'system', label: '端末に合わせる' },
              { value: 'light', label: 'ライト' },
              { value: 'dark', label: 'ダーク' },
            ]}
          />
          <h3>サウンド</h3>
          <AudioSettingsPanel />
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
            最大50人の部員を育て、世代をつなぐ高校サッカー部シミュレーション。
          </DialogDescription>
          <div className="help-copy">
            <h3>練習と育成</h3>
            <p>
              練習を選んで1週間進めます。疲労が高いと能力が下がり、けがのリスクも増加。休養で33回復します。重点育成は1人を指定でき、練習による成長が1.5倍。部費を使った設備強化も有効です。
            </p>
            <h3>編成と試合</h3>
            <p>
              選手を押して先発の起用先を選びます。起用先は「左サイドバック」「ボランチ」のような詳細ポジションで決まり、近いポジションなら影響は小さく、GK・DF・MF・FWの系統をまたぐと総合力が大きく下がります。試合は15分ごとに進行。ポゼッションはカウンターに、カウンターはハイプレスに、ハイプレスはポゼッションに有利です。選手の能力や疲労、運も結果に影響します。
            </p>
            <p>
              攻撃重視は得点と失点が増え、守備重視は両方が減ります。交代はベンチの選手を選んで{MATCH_MAX_SUBS}人まで。大会の90分同点は延長30分、なお同点ならPK戦です。試合後は元の先発編成に戻ります。
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
