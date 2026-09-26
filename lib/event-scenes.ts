// TOUCHLINE ACADEMY v3 — W9: 週ごとのイベントを複数枚の静止画（紙芝居）で表現する
//
// このファイルは DOM に一切依存しない「純粋データ」モジュール。
// - lib/school-life.ts の LIFE_EVENTS（36種）と、lib/game.ts の s.event に入る
//   クラブイベント3種（'部員たちの自主練習' / '主将からの提案' / '雨の日のミーティング'）
//   それぞれについて、「どの場面（SVG背景）で、どんな構図の静止画を何枚見せるか」を
//   定義する対応表（EVENT_SCENES）を持つ。
// - 実際の SVG 描画・React コンポーネントは app/event-scenes.tsx 側が担当する。
//   本ファイルは場面ID（SceneId）の一覧と、場面ID・時間帯・ナレーション文・
//   aria-label 文だけを持つ。
// - lib/school-life.ts（LIFE_EVENTS）は読み取り専用で import するだけで、
//   一切変更しない。lib/game.ts も import しない（クラブイベントは s.event の
//   文字列そのものをキーとして扱うため、依存が不要）。
//
// 表示の流れ（app/event-scenes.tsx の EventStills が実装）：
//   1枚目 establishing「情景」：場面の背景＋主役の顔＋本ファイルのnarration
//   2枚目 moment      「場面」：寄りの構図＋吹き出し（本文は呼び出し側が
//                       LIFE_EVENTS の event.prompt(name) 等から渡す）＋選択肢
//   3枚目 result       「結果」：結果ナレーション（呼び出し側が choice.resultText(name)
//                       等から渡す）＋効果（士気・信頼・スキル習得など）
//本ファイルの narration はあくまで1枚目の「情景」用の短い補足文であり、
// 2・3枚目の本文（選択肢・結果）は既存イベント文言をそのまま使う前提のため、
// ここでは持たない（aria-label のみ持つ）。

import { LIFE_EVENTS } from './school-life.ts';

// ---------------------------------------------------------------------------
// 場面（SVG背景）ID — 10〜12種に再利用できるよう設計する
// ---------------------------------------------------------------------------
export type SceneId =
  | 'schoolyard' // 校庭（体育祭）
  | 'classroom' // 教室
  | 'exam_room' // テスト中の教室
  | 'corridor_rooftop' // 廊下・屋上
  | 'festival_stall' // 文化祭の模擬店
  | 'ryokan_room' // 修学旅行の宿
  | 'living_room' // 家のリビング
  | 'clubroom' // 部室
  | 'pitch_training' // グラウンド（練習）
  | 'pitch_rain' // 雨のグラウンド
  | 'infirmary' // 保健室
  | 'dusk_street'; // 夕方の通学路

export const SCENE_IDS: readonly SceneId[] = [
  'schoolyard',
  'classroom',
  'exam_room',
  'corridor_rooftop',
  'festival_stall',
  'ryokan_room',
  'living_room',
  'clubroom',
  'pitch_training',
  'pitch_rain',
  'infirmary',
  'dusk_street',
];

/** 場面の日本語ラベル（UI のフォールバック aria-label などに使える） */
export const SCENE_LABELS: Record<SceneId, string> = {
  schoolyard: '校庭',
  classroom: '教室',
  exam_room: 'テスト中の教室',
  corridor_rooftop: '廊下・屋上',
  festival_stall: '文化祭の模擬店',
  ryokan_room: '修学旅行の宿',
  living_room: '家のリビング',
  clubroom: '部室',
  pitch_training: 'グラウンド',
  pitch_rain: '雨のグラウンド',
  infirmary: '保健室',
  dusk_street: '夕方の通学路',
};

/** 時間帯。SVG側は空の色などをこれで塗り分ける。 */
export type SceneTime = 'day' | 'evening' | 'night';

export type PanelRole = 'establishing' | 'moment' | 'result';

export type EventScenePanel = {
  role: PanelRole;
  scene: SceneId;
  time: SceneTime;
  /** aria-label 用の説明文（選手名を差し込む）。空文字は不可。 */
  ariaLabel: (name: string) => string;
  /**
   * 1枚目「情景」専用の短いナレーション補足文。2・3枚目は呼び出し側
   * （event.prompt / choice.resultText）が本文を持つため、ここでは省略可。
   */
  narration?: (name: string) => string;
};

export type EventSceneEntry = {
  /** LifeEvent.id、またはクラブイベントの s.event 文字列そのもの。 */
  id: string;
  /** 2〜3枚。先頭は必ず 'establishing'、末尾は必ず 'result'、'moment' をちょうど1枚含む。 */
  panels: EventScenePanel[];
};

// ---------------------------------------------------------------------------
// ビルダー（記述量を減らすための小さなヘルパー。データの意味は変えない）
// ---------------------------------------------------------------------------
function mk(
  id: string,
  opts: {
    scene: SceneId;
    time?: SceneTime;
    narration: (n: string) => string;
    establishingAria: (n: string) => string;
    momentAria: (n: string) => string;
    resultAria: (n: string) => string;
    /** 特定の局面だけ場面・時間帯を変えたい場合に指定（未指定なら establishing と同じ） */
    momentScene?: SceneId;
    momentTime?: SceneTime;
    resultScene?: SceneId;
    resultTime?: SceneTime;
  },
): EventSceneEntry {
  const time = opts.time ?? 'day';
  const momentScene = opts.momentScene ?? opts.scene;
  const momentTime = opts.momentTime ?? time;
  const resultScene = opts.resultScene ?? momentScene;
  const resultTime = opts.resultTime ?? momentTime;
  return {
    id,
    panels: [
      {
        role: 'establishing',
        scene: opts.scene,
        time,
        narration: opts.narration,
        ariaLabel: opts.establishingAria,
      },
      { role: 'moment', scene: momentScene, time: momentTime, ariaLabel: opts.momentAria },
      { role: 'result', scene: resultScene, time: resultTime, ariaLabel: opts.resultAria },
    ],
  };
}

// ---------------------------------------------------------------------------
// 学校生活イベント（36種）の場面対応表
// ---------------------------------------------------------------------------
const LIFE_SCENES: EventSceneEntry[] = [
  // ===== 学校行事 =====
  mk('sports_day_relay', {
    scene: 'schoolyard',
    narration: () => '放課後の校庭に歓声が響く。部活対抗リレー、いよいよアンカー勝負だ。',
    establishingAria: (n) => `体育祭の校庭で、アンカー区間の出番を待つ${n}`,
    momentAria: (n) => `トラックでバトンを受け取ろうと身構える${n}`,
    resultAria: (n) => `走り終えて仲間に迎えられる${n}`,
  }),
  mk('sports_day_cheer', {
    scene: 'schoolyard',
    narration: () => 'クラス対抗の応援合戦。スタンドの熱気が校庭いっぱいに広がる。',
    establishingAria: (n) => `応援合戦の隊列に並ぶ${n}`,
    momentAria: (n) => `声を張り上げて応援する${n}`,
    resultAria: (n) => `応援を終えて笑顔の${n}`,
  }),
  mk('culture_fest_booth', {
    scene: 'classroom',
    narration: () => '放課後の教室、黒板には模擬店の企画案が並んでいる。',
    establishingAria: (n) => `模擬店の相談をするクラスの輪の中にいる${n}`,
    momentAria: (n) => `意見を求められて考え込む${n}`,
    resultAria: (n) => `方針が決まりほっとした表情の${n}`,
  }),
  mk('culture_fest_day', {
    scene: 'festival_stall',
    narration: () => '文化祭当日、模擬店の前には長い行列ができている。',
    establishingAria: (n) => `文化祭の模擬店に立つ${n}`,
    momentAria: (n) => `お客さんの対応に追われる${n}`,
    resultAria: (n) => `大盛況の一日を終えて満足そうな${n}`,
  }),
  mk('school_trip_night', {
    scene: 'ryokan_room',
    time: 'night',
    narration: () => '修学旅行の夜、旅館の一室で仲間たちが集まっている。',
    establishingAria: (n) => `旅館の部屋で仲間と話し込む${n}`,
    momentAria: (n) => `将来の話で盛り上がる${n}`,
    resultAria: (n) => `夜が更けて満ち足りた顔の${n}`,
  }),
  mk('school_trip_free', {
    scene: 'dusk_street',
    narration: () => '修学旅行の自由行動。班のみんなで行き先を相談中だ。',
    establishingAria: (n) => `旅先の通りで班のみんなと相談する${n}`,
    momentAria: (n) => `行き先を提案する${n}`,
    resultAria: (n) => `班のみんなと楽しそうに歩く${n}`,
  }),
  // ===== 学業 =====
  mk('midterm_exam', {
    scene: 'classroom',
    narration: () => '中間試験の答案が返却される教室。部員たちも成績が気になる様子。',
    establishingAria: (n) => `答案を受け取る教室にいる${n}`,
    momentAria: (n) => `結果を見つめる${n}`,
    resultAria: (n) => `結果を受け止めて表情を変える${n}`,
  }),
  mk('remedial_class', {
    scene: 'exam_room',
    time: 'evening',
    narration: () => '夕方の教室に居残り、補習の問題集と向き合う${n}の姿がある。',
    establishingAria: (n) => `放課後の補習教室に残る${n}`,
    momentAria: (n) => `問題集に向き合う${n}`,
    resultAria: (n) => `補習を終えて席を立つ${n}`,
  }),
  mk('career_talk', {
    scene: 'classroom',
    narration: () => '進路面談の順番が回ってきた。先生の机には資料が積まれている。',
    establishingAria: (n) => `進路面談の順番を待つ${n}`,
    momentAria: (n) => `将来について問われる${n}`,
    resultAria: (n) => `面談を終えて廊下に出る${n}`,
  }),
  mk('mock_exam_result', {
    scene: 'exam_room',
    narration: () => '模試の結果が張り出され、教室がざわついている。',
    establishingAria: (n) => `模試の結果に注目が集まる教室の${n}`,
    momentAria: (n) => `結果表を確認する${n}`,
    resultAria: (n) => `結果を受けて表情を変える${n}`,
  }),
  mk('study_balance', {
    scene: 'living_room',
    time: 'evening',
    narration: () => 'テスト週間と練習が重なった夜、机には教科書とスパイクが並ぶ。',
    establishingAria: (n) => `自室で教科書を広げる${n}`,
    momentAria: (n) => `勉強と部活の両立に悩む${n}`,
    resultAria: (n) => `自分なりの答えを出した${n}`,
  }),
  mk('group_project', {
    scene: 'classroom',
    narration: () => 'グループ課題の相談中、机を囲んだメンバーの意見が割れている。',
    establishingAria: (n) => `グループ課題の話し合いに加わる${n}`,
    momentAria: (n) => `意見の対立の中で発言する${n}`,
    resultAria: (n) => `話し合いを終えた${n}`,
  }),
  // ===== 人間関係 =====
  mk('confession_received', {
    scene: 'corridor_rooftop',
    time: 'evening',
    narration: () => '夕暮れの屋上、他クラスの生徒が緊張した面持ちで待っていた。',
    establishingAria: (n) => `屋上に呼び出された${n}`,
    momentAria: (n) => `告白を受け止める${n}`,
    resultAria: (n) => `答えを伝えたあとの${n}`,
  }),
  mk('crush_realized', {
    scene: 'corridor_rooftop',
    narration: () => '廊下ですれ違うたび、なんだか胸がざわつく${n}。',
    establishingAria: (n) => `廊下でふと誰かを目で追う${n}`,
    momentAria: (n) => `気になる気持ちに気づく${n}`,
    resultAria: (n) => `その後どう動くか決めた${n}`,
  }),
  mk('date_invite', {
    scene: 'dusk_street',
    time: 'evening',
    narration: () => '週末、友人からお出かけの誘いが届いた。',
    establishingAria: (n) => `友人からの誘いを受け取る${n}`,
    momentAria: (n) => `週末の予定を考える${n}`,
    resultAria: (n) => `決めた予定どおりに過ごす${n}`,
  }),
  mk('friend_fight', {
    scene: 'corridor_rooftop',
    narration: () => 'サッカーの考え方をめぐって、廊下で親友と言い合いになった。',
    establishingAria: (n) => `親友と向き合う廊下の${n}`,
    momentAria: (n) => `本音をぶつけ合う${n}`,
    resultAria: (n) => `気まずい空気の中に立つ${n}`,
  }),
  mk('reconciliation', {
    scene: 'corridor_rooftop',
    time: 'evening',
    narration: () => 'ぎくしゃくしていた友人関係を、今日こそ修復したい。',
    establishingAria: (n) => `友人との仲直りを試みる${n}`,
    momentAria: (n) => `勇気を出して声をかける${n}`,
    resultAria: (n) => `仲直りできて晴れやかな${n}`,
  }),
  mk('junior_consult', {
    scene: 'clubroom',
    time: 'evening',
    narration: () => '練習後の部室、後輩が神妙な顔で相談を切り出した。',
    establishingAria: (n) => `後輩の相談を受ける部室の${n}`,
    momentAria: (n) => `真剣に話を聞く${n}`,
    resultAria: (n) => `相談を終えて頼もしい顔の${n}`,
  }),
  mk('senior_clash', {
    scene: 'clubroom',
    narration: () => 'プレーの考え方をめぐって、先輩との意見がぶつかった。',
    establishingAria: (n) => `先輩と向き合う部室の${n}`,
    momentAria: (n) => `自分の考えを伝えるか迷う${n}`,
    resultAria: (n) => `やり取りを終えた${n}`,
  }),
  mk('sns_misunderstanding', {
    scene: 'dusk_street',
    time: 'night',
    narration: () => '何気ない投稿がきっかけで、SNS上に誤解が広がってしまった。',
    establishingAria: (n) => `スマートフォンを手にする夜道の${n}`,
    momentAria: (n) => `誤解にどう向き合うか考える${n}`,
    resultAria: (n) => `気持ちの整理がついた${n}`,
  }),
  // ===== 家庭 =====
  mk('family_support', {
    scene: 'living_room',
    time: 'evening',
    narration: () => '今度の試合、家族が応援に来てくれることになったと知らされた。',
    establishingAria: (n) => `リビングで家族の話を聞く${n}`,
    momentAria: (n) => `応援の知らせに向き合う${n}`,
    resultAria: (n) => `気持ちを固めた${n}`,
  }),
  mk('family_conflict', {
    scene: 'living_room',
    time: 'evening',
    narration: () => '勉強と部活のことで、リビングの空気が少し重くなっている。',
    establishingAria: (n) => `家族との話し合いの場にいる${n}`,
    momentAria: (n) => `自分の思いを言葉にするか迷う${n}`,
    resultAria: (n) => `話し合いを終えた${n}`,
  }),
  mk('sibling_care', {
    scene: 'living_room',
    narration: () => '家の事情で、弟や妹の面倒を見ることになった昼下がり。',
    establishingAria: (n) => `弟や妹と過ごすリビングの${n}`,
    momentAria: (n) => `家族との時間を過ごす${n}`,
    resultAria: (n) => `一区切りついた${n}`,
  }),
  mk('family_move_talk', {
    scene: 'living_room',
    time: 'night',
    narration: () => '家庭の事情で環境が変わるかもしれないと聞き、落ち着かない夜。',
    establishingAria: (n) => `夜のリビングで考え込む${n}`,
    momentAria: (n) => `揺れる気持ちと向き合う${n}`,
    resultAria: (n) => `自分の気持ちを固めた${n}`,
  }),
  // ===== 部活 =====
  mk('captain_selection', {
    scene: 'clubroom',
    time: 'evening',
    narration: () => '新チームの主将決め。部室に部員たちが集まっている。',
    establishingAria: (n) => `主将決めの話し合いに参加する${n}`,
    momentAria: (n) => `名前が挙がり考え込む${n}`,
    resultAria: (n) => `結果を受け止めた${n}`,
  }),
  mk('meeting_disagreement', {
    scene: 'clubroom',
    time: 'evening',
    narration: () => '部のミーティングで意見が割れ、部室の空気が張り詰めている。',
    establishingAria: (n) => `ミーティングの輪の中にいる${n}`,
    momentAria: (n) => `どう振る舞うか考える${n}`,
    resultAria: (n) => `ミーティングを終えた${n}`,
  }),
  mk('snacks', {
    scene: 'clubroom',
    narration: () => '練習後の部室に、マネージャーからの差し入れが届いた。',
    establishingAria: (n) => `差し入れを前に喜ぶ部室の${n}`,
    momentAria: (n) => `差し入れを分ける${n}`,
    resultAria: (n) => `満足そうな${n}`,
  }),
  mk('gear_prep', {
    scene: 'clubroom',
    narration: () => '遠征前の部室、用具の準備が山積みになっている。',
    establishingAria: (n) => `用具の準備を任された部室の${n}`,
    momentAria: (n) => `準備の進め方を考える${n}`,
    resultAria: (n) => `準備を終えた${n}`,
  }),
  mk('new_member_coach', {
    scene: 'pitch_training',
    narration: () => 'グラウンドの片隅、新入部員が緊張した顔で待っている。',
    establishingAria: (n) => `新入部員の指導を任されたグラウンドの${n}`,
    momentAria: (n) => `教え方を考える${n}`,
    resultAria: (n) => `指導を終えた${n}`,
  }),
  mk('send_off', {
    scene: 'clubroom',
    time: 'evening',
    narration: () => '引退する先輩を送る会が、部室で静かに開かれている。',
    establishingAria: (n) => `先輩を送る会に参加する${n}`,
    momentAria: (n) => `感謝の伝え方を考える${n}`,
    resultAria: (n) => `会を終えた${n}`,
  }),
  // ===== 身体 =====
  mk('growth_spurt', {
    scene: 'infirmary',
    narration: () => 'ここ数ヶ月で体つきが変わってきたと、保健室で告げられた。',
    establishingAria: (n) => `保健室で体の変化を説明される${n}`,
    momentAria: (n) => `これからの過ごし方を考える${n}`,
    resultAria: (n) => `方針を決めた${n}`,
  }),
  mk('minor_cold', {
    scene: 'infirmary',
    narration: () => '少し体調を崩し、保健室のベッドで顔色をうかがっている。',
    establishingAria: (n) => `保健室で体調を確認される${n}`,
    momentAria: (n) => `今日の練習をどうするか考える${n}`,
    resultAria: (n) => `決断したあとの${n}`,
  }),
  mk('mild_sprain', {
    scene: 'pitch_training',
    momentScene: 'infirmary',
    resultScene: 'infirmary',
    narration: () => '練習中、グラウンドで軽く足首をひねってしまった。',
    establishingAria: (n) => `グラウンドで足首を気にする${n}`,
    momentAria: (n) => `保健室で処置を受けるか迷う${n}`,
    resultAria: (n) => `処置を終えた${n}`,
  }),
  mk('sleep_deprivation', {
    scene: 'living_room',
    time: 'night',
    narration: () => 'ここ数日、寝不足が続いている夜のリビング。',
    establishingAria: (n) => `夜遅くまで起きている${n}`,
    momentAria: (n) => `生活を見直すか考える${n}`,
    resultAria: (n) => `決めたことを実行する${n}`,
  }),
  mk('appetite', {
    scene: 'living_room',
    narration: () => '成長期の食卓、いつもよりお皿の数が多い。',
    establishingAria: (n) => `食卓につく${n}`,
    momentAria: (n) => `食事の向き合い方を考える${n}`,
    resultAria: (n) => `食事を終えて満足そうな${n}`,
  }),
  mk('resilience_moment', {
    scene: 'pitch_training',
    time: 'evening',
    narration: () => '伸び悩みの時期が続いていたが、夕暮れのグラウンドに変化の兆しが見える。',
    establishingAria: (n) => `夕方のグラウンドに立つ${n}`,
    momentAria: (n) => `苦しい時期と向き合う${n}`,
    resultAria: (n) => `一回り成長した表情の${n}`,
  }),
];

// ---------------------------------------------------------------------------
// クラブイベント（lib/game.ts の s.event に入る3種）の場面対応表
// s.event の文字列そのものを id として使う（lib/game.ts は変更しない）。
// ---------------------------------------------------------------------------
export const CLUB_EVENT_IDS: readonly string[] = [
  '部員たちの自主練習',
  '主将からの提案',
  '雨の日のミーティング',
];

const CLUB_SCENES: EventSceneEntry[] = [
  mk('部員たちの自主練習', {
    scene: 'pitch_training',
    narration: () => '練習後のグラウンドに、居残った部員たちのボールを蹴る音が響く。',
    establishingAria: () => '放課後のグラウンドで自主練習をする部員たち',
    momentAria: () => 'どう指導するか考える監督視点のグラウンド',
    resultAria: () => '自主練習を終えた部員たち',
  }),
  mk('主将からの提案', {
    scene: 'clubroom',
    narration: () => '練習前の部室、主将が改まった様子で話しかけてきた。',
    establishingAria: () => '部室で主将から相談を受ける場面',
    momentAria: () => '主将の提案にどう応じるか考える場面',
    resultAria: () => '提案への返答を終えた部室',
  }),
  mk('雨の日のミーティング', {
    scene: 'pitch_rain',
    momentScene: 'clubroom',
    resultScene: 'clubroom',
    narration: () => '雨が降りしきるグラウンドを窓の外に見ながら、部室でミーティングが始まる。',
    establishingAria: () => '雨で使えないグラウンドを窓越しに眺める部室',
    momentAria: () => '雨の日のミーティングでどう過ごすか考える場面',
    resultAria: () => 'ミーティングを終えた部室',
  }),
];

// ---------------------------------------------------------------------------
// T-12: 大会の組み合わせ抽選イベント（lib/competition.ts drawPendingCup が返す
// CupDrawResult を app/game-ui.tsx が表示する際に使う場面対応表）。s.cupDraw.national
// の真偽で id を切り替える（'cup_draw_qualifier' / 'cup_draw_national'）。
// ---------------------------------------------------------------------------
export const CUP_DRAW_EVENT_IDS: readonly string[] = ['cup_draw_qualifier', 'cup_draw_national'];

const CUP_DRAW_SCENES: EventSceneEntry[] = [
  mk('cup_draw_qualifier', {
    scene: 'clubroom',
    narration: () => '抽選会場に主将が向かった。県予選の組み合わせ抽選がまもなく始まる。',
    establishingAria: () => '抽選会場でくじを引く順番を待つ主将',
    momentAria: () => 'くじを引く瞬間の主将',
    resultAria: () => '初戦の相手が決まり、部室で報告する主将',
  }),
  mk('cup_draw_national', {
    scene: 'clubroom',
    narration: () => '県予選を勝ち抜いたチームに、全国大会の組み合わせ抽選の知らせが届いた。',
    establishingAria: () => '全国大会の抽選会場でくじを引く順番を待つ主将',
    momentAria: () => 'くじを引く瞬間の主将',
    resultAria: () => '全国大会の初戦の相手が決まり、部室で報告する主将',
  }),
];

// ---------------------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------------------
export const EVENT_SCENES: EventSceneEntry[] = [...LIFE_SCENES, ...CLUB_SCENES, ...CUP_DRAW_SCENES];
export const EVENT_SCENES_BY_ID: Record<string, EventSceneEntry> = Object.fromEntries(
  EVENT_SCENES.map((e) => [e.id, e]),
);

/** id（LifeEvent.id、またはクラブイベント文字列）から場面列を取得する。 */
export function getEventScenePanels(id: string): EventScenePanel[] | null {
  return EVENT_SCENES_BY_ID[id]?.panels ?? null;
}

// ---------------------------------------------------------------------------
// 検証（テスト・起動時チェック向け）
// ---------------------------------------------------------------------------
export function validateEventScenes(): void {
  const sceneSet = new Set<string>(SCENE_IDS);
  const seenIds = new Set<string>();
  for (const entry of EVENT_SCENES) {
    if (seenIds.has(entry.id)) throw Error(`場面対応表のIDが重複しています: ${entry.id}`);
    seenIds.add(entry.id);
    if (entry.panels.length < 2 || entry.panels.length > 3)
      throw Error(`${entry.id} のパネル数が2〜3枚の範囲外です: ${entry.panels.length}`);
    if (entry.panels[0].role !== 'establishing')
      throw Error(`${entry.id} の1枚目は 'establishing' である必要があります`);
    if (entry.panels[entry.panels.length - 1].role !== 'result')
      throw Error(`${entry.id} の最後は 'result' である必要があります`);
    const momentCount = entry.panels.filter((p) => p.role === 'moment').length;
    if (momentCount !== 1)
      throw Error(`${entry.id} は 'moment' パネルをちょうど1枚持つ必要があります: ${momentCount}枚`);
    for (const panel of entry.panels) {
      if (!sceneSet.has(panel.scene))
        throw Error(`${entry.id} の場面ID「${panel.scene}」が場面一覧に存在しません`);
      const aria = panel.ariaLabel('テスト太郎');
      if (!aria || !aria.trim()) throw Error(`${entry.id}(${panel.role}) の aria-label が空です`);
      if (panel.role === 'establishing') {
        if (!panel.narration) throw Error(`${entry.id} の establishing に narration がありません`);
        const text = panel.narration('テスト太郎');
        if (!text || !text.trim()) throw Error(`${entry.id} の establishing の narration が空です`);
      }
    }
  }
  // すべての学校生活イベント（LIFE_EVENTS）に場面が定義されているか
  for (const e of LIFE_EVENTS) {
    if (!EVENT_SCENES_BY_ID[e.id]) throw Error(`学校生活イベント「${e.id}」の場面が未定義です`);
  }
  // クラブイベント3種すべてに場面が定義されているか
  for (const id of CLUB_EVENT_IDS) {
    if (!EVENT_SCENES_BY_ID[id]) throw Error(`クラブイベント「${id}」の場面が未定義です`);
  }
  // T-12: 組み合わせ抽選イベント2種すべてに場面が定義されているか
  for (const id of CUP_DRAW_EVENT_IDS) {
    if (!EVENT_SCENES_BY_ID[id]) throw Error(`組み合わせ抽選イベント「${id}」の場面が未定義です`);
  }
}
