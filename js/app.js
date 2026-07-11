const NIGHTSCOUT_URL = "https://kazuma-nightscoutweb.azurewebsites.net";

let glucoseChart = null;
let currentLanguage = localStorage.getItem("glucoscope.language.v1") || "ja";

const GLUCO_COLLECTION_STORAGE_KEY = "glucoscope.glucoCollection.v1";
const GLUCO_LUCKY_STATE_STORAGE_KEY = "glucoscope.luckyGlucoState.v1";
const GLUCO_VISITOR_SEED_STORAGE_KEY = "glucoscope.visitorSeed.v1";
const GLUCO_DEBUG_FORCE_LUCKY_DATE_STORAGE_KEY = "glucoscope.debug.forceLuckyDate.v1";
const LANGUAGE_STORAGE_KEY = "glucoscope.language.v1";
const LIVE_PERIOD_STORAGE_KEY = "glucoscope.livePeriod.v1";
const CUSTOM_RANGE_STORAGE_KEY = "glucoscope.customRange.v1";
const AI_LETTER_WORKER_ENDPOINT_STORAGE_KEY = "glucoscope.aiLetterWorkerEndpoint.v1";
const AI_LETTER_WORKER_ENABLED_STORAGE_KEY = "glucoscope.aiLetterWorkerEnabled.v1";
const AI_LETTER_LOCAL_CACHE_STORAGE_KEY = "glucoscope.aiLetterLocalCache.v1";
const AI_LETTER_MODE_STORAGE_KEY = "glucoscope.aiLetterMode.v1";
const AI_LETTER_LOCAL_CACHE_MAX_ITEMS = 30;
const AI_LETTER_MODES = ["letter", "deep"];
const TURNSTILE_SITE_KEY = "0x4AAAAAADyftbRcWQW23mEa";
const TURNSTILE_SCRIPT_ID = "glucoscope-turnstile-script";
const DEFAULT_AI_LETTER_WORKER_ENDPOINT = "http://127.0.0.1:8787/api/gluco-letter";

let currentLivePeriod = localStorage.getItem(LIVE_PERIOD_STORAGE_KEY) || "today";
let currentAiLetterMode = localStorage.getItem(AI_LETTER_MODE_STORAGE_KEY) === "deep" ? "deep" : "letter";
let latestAiLetterSummary = null;
let latestRuleCommentMetrics = null;
let aiLetterRequestInFlight = false;

const GLUCO_NORMAL_MAX_ID = 50;
const GLUCO_LUCKY_MIN_ID = 51;
const GLUCO_LUCKY_MAX_ID = 70;
const LUCKY_GLUCO_BASE_RATE = 0.03;
const LUCKY_GLUCO_MAX_RATE = 0.40;
const LUCKY_GLUCO_SPECIAL_DATES = new Set([
  "01-01",
  "01-21",
  "02-14",
  "03-14",
  "07-07",
  "10-31",
  "12-24",
  "12-25",
  "12-31"
]);

const directionMap = {
  DoubleUp: "⇈",
  SingleUp: "↑",
  FortyFiveUp: "↗",
  Flat: "→",
  FortyFiveDown: "↘",
  SingleDown: "↓",
  DoubleDown: "⇊",
  "NOT COMPUTABLE": "?",
  "RATE OUT OF RANGE": "?"
};

const glucoLiveItems = [
  { id: 1, image: "assets/gluco/live/gluco-live-01.png", title: { ja: "朝ごはん", en: "Breakfast" } },
  { id: 2, image: "assets/gluco/live/gluco-live-02.png", title: { ja: "ティータイム", en: "Tea time" } },
  { id: 3, image: "assets/gluco/live/gluco-live-03.png", title: { ja: "ボールあそび", en: "Ball play" } },
  { id: 4, image: "assets/gluco/live/gluco-live-04.png", title: { ja: "テニス", en: "Tennis" } },
  { id: 5, image: "assets/gluco/live/gluco-live-05.png", title: { ja: "クローバー散歩", en: "Clover walk" } },
  { id: 6, image: "assets/gluco/live/gluco-live-06.png", title: { ja: "雨の日のおでかけ", en: "Rainy outing" } },
  { id: 7, image: "assets/gluco/live/gluco-live-07.png", title: { ja: "おすわり", en: "Sitting together" } },
  { id: 8, image: "assets/gluco/live/gluco-live-08.png", title: { ja: "読書", en: "Reading" } },
  { id: 9, image: "assets/gluco/live/gluco-live-09.png", title: { ja: "お料理", en: "Cooking" } },
  { id: 10, image: "assets/gluco/live/gluco-live-10.png", title: { ja: "おでかけ準備", en: "Ready to go" } },
  { id: 11, image: "assets/gluco/live/gluco-live-11.png", title: { ja: "おやすみ", en: "Good night" } },
  { id: 12, image: "assets/gluco/live/gluco-live-12.png", title: { ja: "パジャマ", en: "Pajamas" } },
  { id: 13, image: "assets/gluco/live/gluco-live-13.png", title: { ja: "おえかき", en: "Drawing" } },
  { id: 14, image: "assets/gluco/live/gluco-live-14.png", title: { ja: "ガーデン", en: "Garden" } },
  { id: 15, image: "assets/gluco/live/gluco-live-15.png", title: { ja: "音楽時間", en: "Music time" } },
  { id: 16, image: "assets/gluco/live/gluco-live-16.png", title: { ja: "日記", en: "Journaling" } },
  { id: 17, image: "assets/gluco/live/gluco-live-17.png", title: { ja: "ピクニック", en: "Picnic" } },
  { id: 18, image: "assets/gluco/live/gluco-live-18.png", title: { ja: "ストレッチ", en: "Stretching" } },
  { id: 19, image: "assets/gluco/live/gluco-live-19.png", title: { ja: "お茶会", en: "Tea party" } },
  { id: 20, image: "assets/gluco/live/gluco-live-20.png", title: { ja: "いちごのおめかし", en: "Strawberry outfit" } },
  { id: 21, image: "assets/gluco/live/gluco-live-21.png", title: { ja: "ほっとひと息", en: "A gentle pause" } },
  { id: 22, image: "assets/gluco/live/gluco-live-22.png", title: { ja: "サイクリング", en: "Cycling" } },
  { id: 23, image: "assets/gluco/live/gluco-live-23.png", title: { ja: "クローバー畑", en: "Clover field" } },
  { id: 24, image: "assets/gluco/live/gluco-live-24.png", title: { ja: "芽吹き", en: "New sprout" } },
  { id: 25, image: "assets/gluco/live/gluco-live-25.png", title: { ja: "星空観察", en: "Stargazing" } },
  { id: 26, image: "assets/gluco/live/gluco-live-26.png", title: { ja: "窓辺の時間", en: "Window time" } },
  { id: 27, image: "assets/gluco/live/gluco-live-27.png", title: { ja: "大きなクローバー", en: "Big clover" } },
  { id: 28, image: "assets/gluco/live/gluco-live-28.png", title: { ja: "キャンプファイヤー", en: "Campfire" } },
  { id: 29, image: "assets/gluco/live/gluco-live-29.png", title: { ja: "みどりのボール", en: "Green ball" } },
  { id: 30, image: "assets/gluco/live/gluco-live-30.png", title: { ja: "にっこり", en: "Smile" } },
  { id: 31, image: "assets/gluco/live/gluco-live-31.png", title: { ja: "クローバーの椅子", en: "Clover chair" } },
  { id: 32, image: "assets/gluco/live/gluco-live-32.png", title: { ja: "花畑", en: "Flower field" } },
  { id: 33, image: "assets/gluco/live/gluco-live-33.png", title: { ja: "プレゼント", en: "Gift" } },
  { id: 34, image: "assets/gluco/live/gluco-live-34.png", title: { ja: "水あそび", en: "Water play" } },
  { id: 35, image: "assets/gluco/live/gluco-live-35.png", title: { ja: "キックボード", en: "Kick scooter" } },
  { id: 36, image: "assets/gluco/live/gluco-live-36.png", title: { ja: "しゃぼん玉", en: "Soap bubbles" } },
  { id: 37, image: "assets/gluco/live/gluco-live-37.png", title: { ja: "雪だるま", en: "Snowman" } },
  { id: 38, image: "assets/gluco/live/gluco-live-38.png", title: { ja: "ランタンの夜", en: "Lantern night" } },
  { id: 39, image: "assets/gluco/live/gluco-live-39.png", title: { ja: "虹の散歩", en: "Rainbow walk" } },
  { id: 40, image: "assets/gluco/live/gluco-live-40.png", title: { ja: "植物のお世話", en: "Plant care" } },
  { id: 41, image: "assets/gluco/live/gluco-live-41.png", title: { ja: "望遠鏡", en: "Telescope" } },
  { id: 42, image: "assets/gluco/live/gluco-live-42.png", title: { ja: "ギター", en: "Guitar" } },
  { id: 43, image: "assets/gluco/live/gluco-live-43.png", title: { ja: "ぎゅっと安心", en: "A safe hug" } },
  { id: 44, image: "assets/gluco/live/gluco-live-44.png", title: { ja: "ハイキング", en: "Hiking" } },
  { id: 45, image: "assets/gluco/live/gluco-live-45.png", title: { ja: "ふわふわ泡", en: "Fluffy bubbles" } },
  { id: 46, image: "assets/gluco/live/gluco-live-46.png", title: { ja: "雨上がり", en: "After the rain" } },
  { id: 47, image: "assets/gluco/live/gluco-live-47.png", title: { ja: "収穫バスケット", en: "Harvest basket" } },
  { id: 48, image: "assets/gluco/live/gluco-live-48.png", title: { ja: "地図をひろげて", en: "Map time" } },
  { id: 49, image: "assets/gluco/live/gluco-live-49.png", title: { ja: "ドーナツ時間", en: "Doughnut time" } },
  { id: 50, image: "assets/gluco/live/gluco-live-50.png", title: { ja: "キャンプ", en: "Camping" } },
  { id: 51, image: "assets/gluco/live/gluco-live-51.png", title: { ja: "メリーゴーランド", en: "Carousel" } },
  { id: 52, image: "assets/gluco/live/gluco-live-52.png", title: { ja: "ゴンドラ", en: "Gondola" } },
  { id: 53, image: "assets/gluco/live/gluco-live-53.png", title: { ja: "クローバーボート", en: "Clover boat" } },
  { id: 54, image: "assets/gluco/live/gluco-live-54.png", title: { ja: "ティーカップ", en: "Teacup" } },
  { id: 55, image: "assets/gluco/live/gluco-live-55.png", title: { ja: "わたあめ", en: "Cotton candy" } },
  { id: 56, image: "assets/gluco/live/gluco-live-56.png", title: { ja: "お菓子屋さん", en: "Sweet shop" } },
  { id: 57, image: "assets/gluco/live/gluco-live-57.png", title: { ja: "テーマパーク", en: "Theme park" } },
  { id: 58, image: "assets/gluco/live/gluco-live-58.png", title: { ja: "ナイトパレード", en: "Night parade" } },
  { id: 59, image: "assets/gluco/live/gluco-live-59.png", title: { ja: "汽車ぽっぽ", en: "Little train" } },
  { id: 60, image: "assets/gluco/live/gluco-live-60.png", title: { ja: "バルーン", en: "Balloon" } },
  { id: 61, image: "assets/gluco/live/gluco-live-61.png", title: { ja: "幼稚園バッグ", en: "Kindergarten bag" } },
  { id: 62, image: "assets/gluco/live/gluco-live-62.png", title: { ja: "工作の時間", en: "Craft time" } },
  { id: 63, image: "assets/gluco/live/gluco-live-63.png", title: { ja: "おもちゃのお部屋", en: "Toy room" } },
  { id: 64, image: "assets/gluco/live/gluco-live-64.png", title: { ja: "ぬいぐるみ時間", en: "Plush friends" } },
  { id: 65, image: "assets/gluco/live/gluco-live-65.png", title: { ja: "お昼寝", en: "Nap time" } },
  { id: 66, image: "assets/gluco/live/gluco-live-66.png", title: { ja: "お弁当", en: "Lunch box" } },
  { id: 67, image: "assets/gluco/live/gluco-live-67.png", title: { ja: "おえかき教室", en: "Drawing class" } },
  { id: 68, image: "assets/gluco/live/gluco-live-68.png", title: { ja: "お花畑", en: "Flower garden" } },
  { id: 69, image: "assets/gluco/live/gluco-live-69.png", title: { ja: "すべり台", en: "Slide" } },
  { id: 70, image: "assets/gluco/live/gluco-live-70.png", title: { ja: "公園のおでかけ", en: "Park outing" } }
];

const dailyLetterGlucoImages = glucoLiveItems.map((item) => item.image);
const normalGlucoItems = glucoLiveItems.filter((item) => item.id <= GLUCO_NORMAL_MAX_ID);
const luckyGlucoItems = glucoLiveItems.filter((item) => item.id >= GLUCO_LUCKY_MIN_ID && item.id <= GLUCO_LUCKY_MAX_ID);

const scoreGlucoImageByRank = {
  excellent: "assets/gluco/about/gluco-growing.png",
  great: "assets/gluco/about/gluco-gentle-watch.png",
  good: "assets/gluco/about/gluco-small-notice.png",
  fair: "assets/gluco/about/gluco-data-link.png",
  gentle: "assets/gluco/about/gluco-safety.png"
};

const translations = {
  ja: {
    tabLive: "🟢 Live",
    tabJournal: "📖 Journal",
    tabClinic: "🏥 Clinic",
    comingSoonEyebrow: "準備中",
    journalComingSoonTitle: "📖 Journal は準備中です",
    journalComingSoonLead: "食事、体調、気づいたことを、血糖の振り返りと一緒に残せる場所を準備しています。",
    journalComingSoonNote: "血糖データを責めるためではなく、あとからやさしく思い出せる小さなメモ帳にしていく予定です。",
    clinicComingSoonTitle: "🏥 Clinic は準備中です",
    clinicComingSoonLead: "診察前に見返したい血糖の流れや、相談したいことをまとめやすくする場所を準備しています。",
    clinicComingSoonNote: "医療判断を置き換えるものではなく、主治医との会話を少し助けるための振り返りページとして育てていきます。",
    tabCollection: "🍀 想い出",
    tabAbout: "✨ About",
    languageLabel: "Language",
    glucoScoreLabel: "🍀 GlucoScore",
    currentGlucoseLabel: "現在血糖",
    mobileNavGlucose: "血糖値",
    mobileNavGraph: "グラフ",
    mobileNavReflection: "ふりかえり",
    mobileNavLetter: "お手紙",
    mobileNavMore: "その他",
    mobileDisplayLabel: "表示",
    mobileDesktopViewButton: "PC画面で見る",
    mobileReturnViewButton: "📱 スマホ表示に戻す",
    mobileRangeTitle: "目標範囲のバランス",
    mobileRangeLead: "表示中の期間を、ひと目でやさしく振り返ります。",
    mobileMoreTitle: "その他",
    mobileMoreLead: "GlucoScopeのほかのページや設定を開けます。",
    mobileMoreJournal: "Journal",
    mobileMoreClinic: "Clinic",
    mobileMoreCollection: "想い出",
    mobileMoreCollectionNote: "グルコとの記録",
    mobileMoreAbout: "About",
    mobileMoreAboutNote: "GlucoScopeについて",
    mobileMoreDeveloperStatus: "Developer Status",
    mobileMoreUsageDashboard: "Usage Dashboard",
    mobileSimpleModeButton: "🍀 やさしい表示",
    mobileDetailModeButton: "📊 詳しく見る",
    mobileSimpleCurrentEyebrow: "いまの血糖",
    mobileSimpleLetterEyebrow: "グルコからのお手紙",
    mobileSimpleLetterTitle: "今日をやさしく振り返る",
    mobileSimpleShowDetailButton: "詳しいグラフを見る",
    chartTitle: "📈 血糖グラフ",
    legendToday: "血糖値",
    legendYesterday: "昨日の重ね表示",
    legendRange: "TIR目標範囲",
    legendMealBolus: "手動ボーラス",
    legendCorrectionBolus: "自動ボーラス",
    mealBolusLabel: "手動ボーラス",
    correctionBolusLabel: "自動ボーラス",
    letterTitle: "✉ グルコからのお手紙",
    ruleCommentTitle: "🍀 いつものグルコのお話",
    ruleCommentBadge: "",
    ruleCommentDeepBadge: "",
    ruleCommentLead: "外部AIを使わず、表示中の血糖サマリーから短いふりかえりを表示します。",
    aiLetterTitle: "✨ AI分析 beta",
    aiLetterLead: "選んだモードで、AIによる分析結果を表示します。",
    aiLetterModeSwitchTitle: "分析モード",
    aiLetterModeSwitchLead: "表示中のパネルに反映されます。",
    aiLetterModeLetter: "🍀 やさしい分析",
    aiLetterModeDeep: "📊 しっかり分析",
    aiLetterModeLetterLabel: "やさしい分析",
    aiLetterModeDeepLabel: "しっかり分析",
    aiLetterPanelSwitchTitle: "表示",
    aiLetterPanelBrowser: "いつものグルコ",
    aiLetterPanelAi: "AI分析",
    aiLetterPanelChat: "ChatGPT",
    aiLetterButtonPreparing: "AI分析は準備中",
    aiLetterButtonReady: "AI分析を試す",
    aiLetterButtonCached: "保存済みの分析を表示",
    aiLetterButtonLoading: "グルコがお手紙を書いてるよ...",
    aiLetterStatusPreparing: "AIお手紙の準備を確認しています。",
    aiLetterStatusLocalOnly: "",
    aiLetterStatusWaitingForSummary: "血糖サマリーを読み込むと、AIお手紙を試せます。",
    aiLetterStatusReady: "",
    aiLetterStatusSuccess: "グルコのお手紙を表示しました🍀",
    aiLetterStatusCached: "前回のグルコAIお手紙を表示しました🍀",
    aiLetterStatusLocalCache: "保存済みのグルコAIお手紙を表示しています🍀",
    aiLetterStatusLocalCacheAfterLimit: "今日の新しいお手紙は上限に達しました。保存済みのお手紙を表示しています🍀",
    aiLetterStatusRateLimited: "今日の新しいAIお手紙は上限に達しました。表示中または保存済みのお手紙があれば、そのまま読めます。ChatGPTコピー機能も使えます🍀",
    aiLetterStatusBudgetStopped: "今月のAI分析は利用上限に近づいたため、新しいお手紙を少しお休みしています。",
    aiLetterStatusDisabled: "AI分析はただいまお休み中です。いつものグルコのお話とChatGPTコピー機能は使えます🍀",
    aiLetterStatusTurnstileFailed: "AI分析の安全確認がうまくいきませんでした。少し時間をおいて、もう一度試してください🍀",
    aiLetterStatusTurnstileWaiting: "AI分析の安全確認を準備しています。少し待ってからもう一度試してください🍀",
    aiLetterStatusError: "AIお手紙を表示できませんでした。少し時間をおいて、もう一度試してください🍀",
    chatGptLetterTitle: "🤖 ChatGPTに貼って相談",
    chatGptLetterBadge: "",
    chatGptLetterLead: "集計済みサマリーだけを使って、ChatGPTに貼るための文章を作ります。",
    chatGptCopyButton: "ChatGPTに貼る文をコピー",
    chatGptOpenLink: "ChatGPTを開く",
    chatGptCopyWaiting: "データ取得後にコピーできます。",
    chatGptCopyReady: "",
    chatGptCopied: "ChatGPTに貼る文をコピーしました🍀",
    chatGptCopyFailed: "コピーできませんでした。ブラウザの権限を確認してください。",
    aiSummaryUnavailable: "まだAI分析用サマリーを作れていません。",
    slotMorning: "朝のお手紙",
    slotAfternoon: "昼のお手紙",
    slotNight: "夜のお手紙",
    averageLabel: "平均",
    cvLabel: "（変動係数）",
    tirDesc: "目標範囲内の時間",
    tirSmall: "70〜180mg/dLだった割合",
    tarDesc: "高血糖の時間",
    tarSmall: "180mg/dL超だった割合",
    tbrDesc: "低血糖の時間",
    tbrSmall: "70mg/dL未満だった割合",
    avgDesc: "平均血糖値",
    avgSmall: "表示中の期間の平均",
    cvDesc: "血糖のばらつき",
    cvSmall: "目標は36%未満",
    gmiDesc: "HbA1cの目安",
    gmiSmall: "表示中の平均血糖から推定",
    lastUpdatedLabel: "最終更新",
    collectionTitle: "🍀 グルコとの想い出",
    collectionLead: "毎日出会ったグルコを、ブラウザの中にそっと記録します。",
    collectionToday: "出会ったグルコが、ここに少しずつ増えていきます。",
    collectionLocked: "まだ出会っていないGluco",
    collectionFirstSeen: "初めて出会った日",
    collectionTimes: "回目",
    collectionProgress: "出会ったグルコ",
    luckyGlucoBadge: "🍀 小さな幸運",
    luckyGlucoMet: "🍀 小さな幸運ラッキーグルコと出逢ったよ",
    achievementLabel: "称号",
    shareAchievement: "称号をシェア",
    shareCopied: "シェア文をコピーしました",
    shareText: "GlucoScopeで{count}種類のグルコと出会って、称号「{title}」になりました🍀",
    periodToday: "今日",
    periodYesterday: "昨日",
    periodSevenDays: "7日",
    periodThirtyDays: "30日",
    periodCustom: "カスタム",
    customFromLabel: "開始",
    customToLabel: "終了",
    customApplyLabel: "表示",
    selectedRangeLabel: "表示中の期間",
    periodPreviousDay: "前日",
    periodPreviousRange: "前期間",
    batteryUnavailable: "🔋 --",
    signalChecking: "📶 確認中",
    signalLive: "📶 LIVE",
    signalStale: "📶 更新待ち",
    cloudConnected: "☁ 接続中",
    cloudWaiting: "☁ 待機中",
    cloudError: "☁ エラー",
    sensorRemainingUnavailable: "🧪 --",
    sensorRemainingLabel: "🧪 センサー",
    pumpReservoirUnavailable: "💧 --",
    pumpReservoirLabel: "💧 ポンプ",
    iobUnavailable: "💉 --",
    iobLabel: "💉 IOB",
    healthLegend: "🔋 電池 / 📶 更新 / ☁ Nightscout接続",
    rangeLow: "● Low",
    rangeHigh: "● High",
    rangeIn: "● In Range",
    latestNoData: "データが見つかりません",
    noDataDetail: "Nightscoutに最新データがありません",
    latestUnknown: "方向不明",
    updatedMinutesAgo: "分前に更新",
    statusError: "Nightscout接続エラー",
    commentLoadingError: "データ取得中にエラーが出ました。Consoleを確認してみてください。",
    noDailyData: "表示中の期間のデータが見つかりませんでした。",
    chartRangeSeparator: "〜",
    todayLabel: "今日",
    yesterdayLabel: "昨日",
    glucoseLabel: "血糖値",
    lowLineLabel: "低血糖ライン 70",
    highLineLabel: "高血糖ライン 180",
    deltaUnavailable: "前回更新との差分はまだ表示できません",
    deltaTitle: "前回更新との差分",
    scoreExcellent: "落ち着いた時間がたくさん見えているよ。流れをやさしく見てみよう。",
    scoreGreat: "良い流れが見えているよ。小さな手がかりも見つかっているね。",
    scoreGood: "落ち着きも見えているよ。流れを一緒に見よう。",
    scoreFair: "少し動きも見えているよ。明日のヒントとして一緒に見よう。",
    scoreGentle: "ゆらぎも見えているよ。無理せず、流れをやさしく見よう。"
  },
  en: {
    tabLive: "🟢 Live",
    tabJournal: "📖 Journal",
    tabClinic: "🏥 Clinic",
    comingSoonEyebrow: "Coming soon",
    journalComingSoonTitle: "📖 Journal is coming soon",
    journalComingSoonLead: "A place to keep meals, how you felt, and small notes alongside glucose reflections is being prepared.",
    journalComingSoonNote: "It will be a gentle notebook for looking back later, not a place to judge glucose data.",
    clinicComingSoonTitle: "🏥 Clinic is coming soon",
    clinicComingSoonLead: "A place to organize glucose patterns and notes you may want to review before clinic visits is being prepared.",
    clinicComingSoonNote: "It will not replace medical decisions. It is meant to gently support conversations with your clinician.",
    tabCollection: "🍀 Collection",
    tabAbout: "✨ About",
    languageLabel: "Language",
    glucoScoreLabel: "🍀 GlucoScore",
    currentGlucoseLabel: "Current glucose",
    mobileNavGlucose: "Glucose",
    mobileNavGraph: "Graph",
    mobileNavReflection: "Reflection",
    mobileNavLetter: "Letter",
    mobileNavMore: "More",
    mobileDisplayLabel: "Display",
    mobileDesktopViewButton: "View desktop layout",
    mobileReturnViewButton: "📱 Return to mobile view",
    mobileRangeTitle: "Range balance",
    mobileRangeLead: "A gentle at-a-glance view of the selected period.",
    mobileMoreTitle: "More",
    mobileMoreLead: "Open other GlucoScope pages and settings.",
    mobileMoreJournal: "Journal",
    mobileMoreClinic: "Clinic",
    mobileMoreCollection: "Memories",
    mobileMoreCollectionNote: "Your moments with Gluco",
    mobileMoreAbout: "About",
    mobileMoreAboutNote: "About GlucoScope",
    mobileMoreDeveloperStatus: "Developer Status",
    mobileMoreUsageDashboard: "Usage Dashboard",
    mobileSimpleModeButton: "🍀 Simple view",
    mobileDetailModeButton: "📊 Details",
    mobileSimpleCurrentEyebrow: "Current glucose",
    mobileSimpleLetterEyebrow: "Letter from Gluco",
    mobileSimpleLetterTitle: "A gentle look at today",
    mobileSimpleShowDetailButton: "See detailed chart",
    chartTitle: "📈 Glucose chart",
    legendToday: "Glucose",
    legendYesterday: "Yesterday overlay",
    legendRange: "TIR target range",
    legendMealBolus: "Manual bolus",
    legendCorrectionBolus: "Auto bolus",
    mealBolusLabel: "Manual bolus",
    correctionBolusLabel: "Auto bolus",
    letterTitle: "✉ Letter from Gluco",
    ruleCommentTitle: "🍀 Gluco’s everyday story",
    ruleCommentBadge: "",
    ruleCommentDeepBadge: "",
    ruleCommentLead: "A short reflection made from the selected glucose summary without calling external AI.",
    aiLetterTitle: "✨ AI analysis beta",
    aiLetterLead: "Shows AI-generated analysis in the selected mode.",
    aiLetterModeSwitchTitle: "Reflection mode",
    aiLetterModeSwitchLead: "Applied to all three panels.",
    aiLetterModeLetter: "🍀 Gentle analysis",
    aiLetterModeDeep: "📊 Detailed analysis",
    aiLetterModeLetterLabel: "gentle analysis",
    aiLetterModeDeepLabel: "detailed analysis",
    aiLetterPanelSwitchTitle: "View",
    aiLetterPanelBrowser: "Gluco story",
    aiLetterPanelAi: "AI analysis",
    aiLetterPanelChat: "ChatGPT",
    aiLetterButtonPreparing: "AI analysis is preparing",
    aiLetterButtonReady: "Try AI analysis",
    aiLetterButtonLoading: "Gluco is writing...",
    aiLetterStatusPreparing: "Checking whether AI letters are ready.",
    aiLetterStatusLocalOnly: "AI letters are not available in this view yet.",
    aiLetterStatusWaitingForSummary: "AI letters will be available after the glucose summary loads.",
    aiLetterStatusReady: "Gluco can write using the selected reflection mode.",
    aiLetterStatusSuccess: "Gluco reflection displayed 🍀",
    aiLetterStatusCached: "Previous Gluco AI reflection displayed 🍀",
    aiLetterStatusLocalCache: "Saved Gluco AI reflection displayed 🍀",
    aiLetterStatusLocalCacheAfterLimit: "Today’s new reflection has reached its limit. A saved reflection is displayed 🍀",
    aiLetterStatusRateLimited: "Today’s new AI reflections have reached the limit. The previous reflection and ChatGPT copy handoff are still available 🍀",
    aiLetterStatusBudgetStopped: "New AI letters are paused because the monthly AI limit is near.",
    aiLetterStatusDisabled: "AI analysis is paused for now. Gluco’s everyday story and ChatGPT copy handoff are still available 🍀",
    aiLetterStatusTurnstileFailed: "The AI safety check did not work. Please try again later 🍀",
    aiLetterStatusTurnstileWaiting: "Preparing the AI safety check. Please try again in a moment 🍀",
    aiLetterStatusError: "AI letter could not be displayed. Please try again later 🍀",
    chatGptLetterTitle: "🤖 Ask ChatGPT",
    chatGptLetterBadge: "",
    chatGptLetterLead: "Create text you can paste into ChatGPT using only the summarized data.",
    chatGptCopyButton: "Copy text for ChatGPT",
    chatGptOpenLink: "Open ChatGPT",
    chatGptCopyWaiting: "Available after the data loads.",
    chatGptCopyReady: "You can copy the selected summary.",
    chatGptCopied: "Copied text for ChatGPT 🍀",
    chatGptCopyFailed: "Could not copy. Please check browser permissions.",
    aiSummaryUnavailable: "The AI-ready summary is not ready yet.",
    slotMorning: "Morning letter",
    slotAfternoon: "Afternoon letter",
    slotNight: "Night letter",
    averageLabel: "Average",
    cvLabel: "(coefficient of variation)",
    tirDesc: "Time in target range",
    tirSmall: "Share of time at 70–180mg/dL",
    tarDesc: "Time above range",
    tarSmall: "Share of time above 180mg/dL",
    tbrDesc: "Time below range",
    tbrSmall: "Share of time below 70mg/dL",
    avgDesc: "Average glucose",
    avgSmall: "Average for selected range",
    cvDesc: "Glucose variability",
    cvSmall: "Target is under 36%",
    gmiDesc: "HbA1c estimate",
    gmiSmall: "Estimated from selected average",
    lastUpdatedLabel: "Last updated",
    collectionTitle: "🍀 Gluco Collection",
    collectionLead: "Gluco friends you meet each day are gently saved in this browser.",
    collectionToday: "Meet today’s Gluco and it will be saved here.",
    collectionLocked: "Gluco not met yet",
    collectionFirstSeen: "First seen",
    collectionTimes: "time",
    collectionProgress: "Gluco met",
    luckyGlucoBadge: "🍀 Little luck",
    luckyGlucoMet: "🍀 You met a little Lucky Gluco today",
    achievementLabel: "Title",
    shareAchievement: "Share title",
    shareCopied: "Share text copied",
    shareText: "I met {count} Gluco friends in GlucoScope and earned the title: {title} 🍀",
    periodToday: "Today",
    periodYesterday: "Yesterday",
    periodSevenDays: "7 days",
    periodThirtyDays: "30 days",
    periodCustom: "Custom",
    customFromLabel: "From",
    customToLabel: "To",
    customApplyLabel: "Show",
    selectedRangeLabel: "Selected range",
    periodPreviousDay: "Previous day",
    periodPreviousRange: "Previous range",
    batteryUnavailable: "🔋 --",
    signalChecking: "📶 Checking",
    signalLive: "📶 LIVE",
    signalStale: "📶 Stale",
    cloudConnected: "☁ Connected",
    cloudWaiting: "☁ Waiting",
    cloudError: "☁ Error",
    sensorRemainingUnavailable: "🧪 --",
    sensorRemainingLabel: "🧪 Sensor",
    pumpReservoirUnavailable: "💧 --",
    pumpReservoirLabel: "💧 Pump",
    iobUnavailable: "💉 --",
    iobLabel: "💉 IOB",
    healthLegend: "🔋 Battery / 📶 Data freshness / ☁ Nightscout",
    rangeLow: "● Low",
    rangeHigh: "● High",
    rangeIn: "● In Range",
    latestNoData: "No data found",
    noDataDetail: "No latest data was found in Nightscout",
    latestUnknown: "Unknown direction",
    updatedMinutesAgo: "min ago",
    statusError: "Nightscout connection error",
    commentLoadingError: "Something went wrong while loading the data. Please check the console.",
    noDailyData: "No data was found for the selected range.",
    chartRangeSeparator: "to",
    todayLabel: "Today",
    yesterdayLabel: "Yesterday",
    glucoseLabel: "Glucose",
    lowLineLabel: "Low line 70",
    highLineLabel: "High line 180",
    deltaUnavailable: "The difference from the previous update is not available yet",
    deltaTitle: "Difference from previous update",
    scoreExcellent: "There are many steady moments. Let’s look gently together.",
    scoreGreat: "A gentle flow is visible. Small clues are showing up too.",
    scoreGood: "There are steady moments too. Let’s look together.",
    scoreFair: "There is some movement. We can use it as a gentle clue.",
    scoreGentle: "Some waviness is visible. Let’s look gently, without forcing it."
  }
};

function t(key) {
  const currentTranslations = translations[currentLanguage] || {};
  if (Object.prototype.hasOwnProperty.call(currentTranslations, key)) {
    return currentTranslations[key];
  }

  if (Object.prototype.hasOwnProperty.call(translations.ja, key)) {
    return translations.ja[key];
  }

  return key;
}

function injectAiLetterLayoutStyles() {
  if (document.getElementById("glucoscope-ai-letter-layout-styles")) return;

  const style = document.createElement("style");
  style.id = "glucoscope-ai-letter-layout-styles";
  style.textContent = `
    .gluco-comment,
    .gluco-comment-body,
    .letter-action-grid,
    .rule-letter-section,
    .letter-action-panel {
      min-width: 0;
    }

    .gluco-letter-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .gluco-letter-title-row .gluco-letter-controls {
      margin-left: auto;
    }

    .gluco-letter-controls {
      margin: 0;
      padding: 0;
      background: transparent;
      overflow: visible;
      max-width: 100%;
    }

    .gluco-letter-controls.is-in-body {
      margin: 0 0 12px;
    }

    .gluco-letter-controls-inner {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .gluco-letter-control-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
      min-width: 0;
    }

    .gluco-letter-control-title {
      color: #9fb3d1;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .06em;
      white-space: nowrap;
    }

    .gluco-letter-mode-toggle {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
      min-width: 0;
    }

    .gluco-letter-mode-toggle-button {
      appearance: none;
      border: 1px solid rgba(59,130,246,.34);
      border-radius: 999px;
      background: rgba(37,99,235,.18);
      color: #dbeafe;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 10px;
      min-width: 44px;
      min-height: 34px;
      font-size: 12px !important;
      line-height: 1.1;
      font-weight: 900;
      text-indent: 0 !important;
      overflow: visible;
      cursor: pointer;
      transition: transform .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease;
      white-space: nowrap;
    }

    .gluco-letter-panel-toggle-button {
      background: rgba(15,23,42,.42);
      border-color: rgba(148,163,184,.26);
      color: #e2e8f0;
    }

    .gluco-letter-mode-toggle-button:hover {
      transform: translateY(-1px);
      background: rgba(37,99,235,.26);
    }

    .gluco-letter-mode-toggle-button.is-active {
      border-color: rgba(46,204,113,.58);
      background: rgba(46,204,113,.20);
      color: #dcfce7;
      box-shadow: 0 0 0 2px rgba(46,204,113,.16), 0 12px 24px rgba(0,0,0,.14);
    }

    .ai-letter-turnstile {
      display: none;
      margin-top: 12px;
      max-width: 100%;
      overflow: hidden;
    }

    .ai-letter-turnstile.is-visible {
      display: block;
    }

    .ai-letter-panel .letter-primary-button {
      width: 100%;
      justify-content: center;
    }

    .ai-letter-result {
      margin-top: 14px;
      padding: 16px 18px;
      border: 1px solid rgba(46,204,113,.22);
      border-radius: 18px;
      background:
        radial-gradient(circle at 12% 0%, rgba(46,204,113,.12), transparent 44%),
        rgba(15, 61, 63, .46);
      color: #e5f7ef;
      font-size: 16px;
      line-height: 1.85;
      white-space: pre-wrap;
    }

    .rule-letter-section #comment {
      font-size: 16px;
      line-height: 1.85;
      white-space: pre-wrap;
    }


    .ai-letter-result[hidden] {
      display: none !important;
    }

    .letter-action-panel .letter-section-title,
    .rule-letter-section .letter-section-title {
      overflow-wrap: anywhere;
    }

    .gluco-letter-panel-hidden {
      display: none !important;
    }

    .gluco-letter-controls .gluco-letter-mode-toggle-button {
      appearance: none;
      border: 1px solid rgba(59,130,246,.34) !important;
      border-radius: 999px;
      background: rgba(37,99,235,.18) !important;
      color: #dbeafe !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 11px;
      min-height: 34px;
      font-size: 12px !important;
      line-height: 1.1;
      font-weight: 900;
      text-indent: 0 !important;
      overflow: visible;
      white-space: nowrap;
      box-shadow: none;
    }

    .gluco-letter-controls .gluco-letter-mode-toggle-button.is-active {
      border-color: rgba(46,204,113,.58) !important;
      background: rgba(46,204,113,.20) !important;
      color: #dcfce7 !important;
      box-shadow: 0 0 0 2px rgba(46,204,113,.16), 0 12px 24px rgba(0,0,0,.14);
    }

    .rule-letter-section .letter-section-badge,
    .chatgpt-letter-panel .letter-section-badge {
      display: none !important;
    }

    .letter-status:empty,
    .letter-copy-status:empty,
    .ai-letter-status:empty {
      display: none !important;
    }

    .chatgpt-letter-panel .letter-section-lead {
      margin-bottom: 12px !important;
    }

    .chatgpt-letter-panel .letter-button-row {
      margin-top: 0 !important;
    }

    .gluco-comment-avatar {
      justify-content: flex-start;
    }

    .gluco-comment-image {
      width: clamp(220px, 46%, 340px);
      max-width: 72%;
      height: auto;
    }

    @media (min-width: 980px) {
      .gluco-comment-image {
        width: clamp(260px, 58%, 380px);
        max-width: 78%;
      }
    }

    .comment-card-header.gluco-letter-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .comment-card-header.gluco-letter-title-row .gluco-letter-controls {
      margin-left: auto;
    }

    @media (min-width: 980px) {
      .gluco-comment {
        display: grid;
        grid-template-columns: minmax(260px, 36%) minmax(0, 1fr);
        align-items: start;
        gap: 26px;
        overflow: hidden;
      }

      .gluco-comment-body {
        display: block;
        width: 100%;
        overflow: hidden;
      }

      .gluco-comment-avatar {
        align-self: start;
        min-height: 420px;
        align-items: flex-start;
        justify-content: center;
        padding-top: 74px;
        box-sizing: border-box;
      }

      .gluco-comment-image {
        margin-top: 18px;
      }

      .rule-letter-section {
        padding: 18px;
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 20px;
        background:
          radial-gradient(circle at 10% 0%, rgba(46,204,113,.10), transparent 38%),
          rgba(15,23,42,.24);
      }

      .letter-action-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
        margin-top: 14px;
      }

      .letter-action-panel {
        width: 100%;
      }
    }

    @media (min-width: 1320px) {
      .gluco-comment {
        grid-template-columns: minmax(300px, 35%) minmax(0, 1fr);
        gap: 30px;
      }

      .letter-action-grid {
        gap: 16px;
      }
    }

    @media (max-width: 979px) {
      .gluco-letter-controls.is-in-body {
        margin-top: 14px;
      }

      .letter-action-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
      }
    }

    @media (max-width: 720px) {
      .gluco-letter-title-row,
      .gluco-letter-controls-inner,
      .gluco-letter-control-group,
      .gluco-letter-mode-toggle {
        flex-direction: column;
        align-items: stretch;
      }

      .gluco-letter-title-row .gluco-letter-controls {
        margin-left: 0;
        width: 100%;
      }

      .gluco-letter-mode-toggle-button {
        width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
}

function normalizeAiLetterMode(mode) {
  return AI_LETTER_MODES.includes(mode) ? mode : "letter";
}

function getAiLetterModeLabel(mode = currentAiLetterMode) {
  return normalizeAiLetterMode(mode) === "deep"
    ? t("aiLetterModeDeepLabel")
    : t("aiLetterModeLetterLabel");
}

function getAiLetterModeButtonLabel(mode = currentAiLetterMode) {
  return normalizeAiLetterMode(mode) === "deep"
    ? t("aiLetterModeDeep")
    : t("aiLetterModeLetter");
}

function normalizeLetterPanel(panel) {
  if (panel === "ai" || panel === "chat") return panel;
  return "browser";
}

function getLetterPanelLabel(panel) {
  const normalizedPanel = normalizeLetterPanel(panel);

  const labels = currentLanguage === "en"
    ? {
        browser: "Gluco",
        ai: "AI",
        chat: "ChatGPT"
      }
    : {
        browser: "いつものグルコ",
        ai: "AI",
        chat: "ChatGPT"
      };

  return labels[normalizedPanel] || labels.browser;
}

function getClosestLetterPanel(element) {
  if (!element) return null;

  let node = element;
  while (node && node !== document.body) {
    if (
      node.classList?.contains("letter-action-panel") ||
      node.classList?.contains("rule-letter-section") ||
      node.parentElement?.classList?.contains("letter-action-grid")
    ) {
      return node;
    }

    node = node.parentElement;
  }

  return element.closest?.("section, article, .card, .panel") || element.parentElement;
}

function getLetterPanelElements() {
  const body = document.querySelector(".gluco-comment-body");
  return {
    browser: body?.querySelector("[data-letter-panel='browser']") || document.querySelector("[data-letter-panel='browser'], .rule-letter-section"),
    ai: body?.querySelector("[data-letter-panel='ai']") || document.querySelector("[data-letter-panel='ai'], .ai-letter-panel"),
    chat: body?.querySelector("[data-letter-panel='chat']") || document.querySelector("[data-letter-panel='chat'], .chatgpt-letter-panel")
  };
}

function setLetterPanel(panel) {
  currentAiLetterPanel = "browser";
  localStorage.removeItem(AI_LETTER_PANEL_STORAGE_KEY);
  showAllLetterPanels();
}

function setAiLetterMode(mode, options = {}) {
  const previousMode = currentAiLetterMode;
  currentAiLetterMode = normalizeAiLetterMode(mode);
  localStorage.setItem(AI_LETTER_MODE_STORAGE_KEY, currentAiLetterMode);

  updateAiModeSwitcher();
  updateLetterPanelSwitcher();
  updateRuleCommentDisplay();
  updateAiSlotDisplay();

  if (options.showCached && latestAiLetterSummary) {
    const restored = showCachedAiLetter(
      latestAiLetterSummary,
      "aiLetterStatusLocalCache",
      "success",
      currentAiLetterMode
    );

    if (!restored && previousMode !== currentAiLetterMode) {
      showAiLetterResult("");
      setAiLetterPanelStatus("aiLetterStatusReady");
    }
  }

  updateAiLetterControls(null, "", { preserveAiStatus: true });
}

const livePeriodOptions = {
  today: { key: "today", days: 1, offsetDays: 0, count: 1000 },
  yesterday: { key: "yesterday", days: 1, offsetDays: 1, count: 1000 },
  seven: { key: "seven", days: 7, offsetDays: 0, count: 3000 },
  thirty: { key: "thirty", days: 30, offsetDays: 0, count: 12000 },
  custom: { key: "custom", days: 1, offsetDays: 0, count: 1000 }
};


function formatDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDayStartTime(value = Date.now()) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

function getLocalDayEndTime(value = Date.now()) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}


function parseLocalDateInput(value, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);

  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function getDefaultCustomRangeValues(now = Date.now()) {
  const today = new Date(now);
  const value = formatDateInputValue(today);
  return { startDate: value, endDate: value };
}

function readCustomRangeValues(now = Date.now()) {
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_RANGE_STORAGE_KEY) || "null");
    if (stored?.startDate && stored?.endDate) return stored;
  } catch (error) {
    // Ignore broken localStorage values and use today's date instead.
  }

  return getDefaultCustomRangeValues(now);
}

function saveCustomRangeValues(values) {
  localStorage.setItem(CUSTOM_RANGE_STORAGE_KEY, JSON.stringify(values));
}

function getFetchCountForDuration(durationMs) {
  const estimatedFiveMinutePoints = Math.ceil(durationMs / (5 * 60 * 1000));
  return Math.min(20000, Math.max(1000, estimatedFiveMinutePoints + 500));
}

function getCustomPeriodRange(now = Date.now()) {
  let { startDate, endDate } = readCustomRangeValues(now);
  let rangeStart = parseLocalDateInput(startDate, false);
  let rangeEnd = parseLocalDateInput(endDate, true);

  if (rangeStart === null || rangeEnd === null) {
    const fallback = getDefaultCustomRangeValues(now);
    startDate = fallback.startDate;
    endDate = fallback.endDate;
    rangeStart = parseLocalDateInput(startDate, false);
    rangeEnd = parseLocalDateInput(endDate, true);
  }

  if (rangeStart > rangeEnd) {
    [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
    [startDate, endDate] = [endDate, startDate];
  }

  const durationMs = rangeEnd - rangeStart;
  return {
    key: "custom",
    startDate,
    endDate,
    rangeStart,
    rangeEnd,
    durationMs,
    count: getFetchCountForDuration(durationMs)
  };
}

function syncCustomRangeInputs(now = Date.now()) {
  const controls = document.getElementById("customRangeControls");
  const startInput = document.getElementById("customRangeStart");
  const endInput = document.getElementById("customRangeEnd");
  const values = readCustomRangeValues(now);

  if (startInput && !startInput.value) startInput.value = values.startDate;
  if (endInput && !endInput.value) endInput.value = values.endDate;
  if (controls) controls.hidden = currentLivePeriod !== "custom";
}

function saveCustomRangeFromInputs() {
  const startInput = document.getElementById("customRangeStart");
  const endInput = document.getElementById("customRangeEnd");
  const fallback = readCustomRangeValues();
  const startDate = startInput?.value || fallback.startDate;
  const endDate = endInput?.value || fallback.endDate;

  saveCustomRangeValues({ startDate, endDate });
  if (startInput) startInput.value = startDate;
  if (endInput) endInput.value = endDate;
}

function getLivePeriodConfig(periodKey = currentLivePeriod) {
  return livePeriodOptions[periodKey] || livePeriodOptions.today;
}

function getLivePeriodRange(periodKey = currentLivePeriod, now = Date.now()) {
  if (periodKey === "custom") return getCustomPeriodRange(now);

  const config = getLivePeriodConfig(periodKey);
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (periodKey === "today" || periodKey === "yesterday") {
    const targetTime = now - (config.offsetDays * oneDayMs);
    const rangeStart = getLocalDayStartTime(targetTime);
    const rangeEnd = getLocalDayEndTime(targetTime);

    return {
      ...config,
      rangeStart,
      rangeEnd,
      durationMs: rangeEnd - rangeStart
    };
  }

  const rangeEnd = now - (config.offsetDays * oneDayMs);
  const rangeStart = rangeEnd - (config.days * oneDayMs);

  return {
    ...config,
    rangeStart,
    rangeEnd,
    durationMs: rangeEnd - rangeStart
  };
}

function getPreviousLivePeriodRange(periodRange) {
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (periodRange.key === "today" || periodRange.key === "yesterday") {
    return {
      previousRangeStart: periodRange.rangeStart - oneDayMs,
      previousRangeEnd: periodRange.rangeEnd - oneDayMs
    };
  }

  return {
    previousRangeStart: periodRange.rangeStart - periodRange.durationMs,
    previousRangeEnd: periodRange.rangeStart
  };
}

function updatePeriodButtons() {
  document.querySelectorAll(".period-button").forEach((button) => {
    const isActive = button.dataset.period === currentLivePeriod;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  syncCustomRangeInputs();
}

function setupPeriodSwitch() {
  if (!livePeriodOptions[currentLivePeriod]) currentLivePeriod = "today";
  syncCustomRangeInputs();

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPeriod = button.dataset.period;
      if (!livePeriodOptions[nextPeriod] || nextPeriod === currentLivePeriod) return;

      currentLivePeriod = nextPeriod;
      if (currentLivePeriod === "custom") saveCustomRangeFromInputs();
      localStorage.setItem(LIVE_PERIOD_STORAGE_KEY, currentLivePeriod);
      updatePeriodButtons();
      loadDailyStats();
    });
  });

  const applyButton = document.getElementById("customRangeApply");
  if (applyButton) {
    applyButton.addEventListener("click", () => {
      saveCustomRangeFromInputs();
      currentLivePeriod = "custom";
      localStorage.setItem(LIVE_PERIOD_STORAGE_KEY, currentLivePeriod);
      updatePeriodButtons();
      loadDailyStats();
    });
  }

  updatePeriodButtons();
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashString(value) {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getOrCreateVisitorSeed() {
  try {
    const existingSeed = localStorage.getItem(GLUCO_VISITOR_SEED_STORAGE_KEY);
    if (existingSeed) return existingSeed;

    const seed = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(GLUCO_VISITOR_SEED_STORAGE_KEY, seed);
    return seed;
  } catch (error) {
    return "glucoscope-local-seed";
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizedHash(value) {
  return (hashString(value) % 10000) / 10000;
}

function isLocalDebugEnvironment() {
  const host = window.location.hostname;
  return window.location.protocol === "file:"
    || host === ""
    || host === "localhost"
    || host === "127.0.0.1";
}

function isForceLuckyDebugRequested(dateKey) {
  if (!isLocalDebugEnvironment()) return false;

  try {
    const params = new URLSearchParams(window.location.search);
    const queryForce = params.get("debugLucky") === "1" || params.get("forceLucky") === "1";

    if (queryForce) {
      localStorage.setItem(GLUCO_DEBUG_FORCE_LUCKY_DATE_STORAGE_KEY, dateKey);
      return true;
    }

    const storedDate = localStorage.getItem(GLUCO_DEBUG_FORCE_LUCKY_DATE_STORAGE_KEY);
    return storedDate === dateKey;
  } catch (error) {
    return false;
  }
}

function dateKeyToLocalTime(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1).getTime();
}

function getDateDistanceInDays(fromDateKey, toDateKey) {
  if (!fromDateKey || !toDateKey) return null;

  const diffMs = dateKeyToLocalTime(toDateKey) - dateKeyToLocalTime(fromDateKey);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function readLuckyGlucoState() {
  try {
    return JSON.parse(localStorage.getItem(GLUCO_LUCKY_STATE_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function writeLuckyGlucoState(state) {
  try {
    localStorage.setItem(GLUCO_LUCKY_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Collection and lucky state are nice-to-have local memories.
  }
}

function isLuckyGlucoNumber(number) {
  const value = Number(number);
  return value >= GLUCO_LUCKY_MIN_ID && value <= GLUCO_LUCKY_MAX_ID;
}

function isLuckyGlucoItem(item) {
  return Boolean(item && isLuckyGlucoNumber(item.id));
}

function pickGlucoItemFromPool(pool, seedValue) {
  if (!pool.length) return null;
  return pool[hashString(seedValue) % pool.length];
}

function getSpecialDateKey(dateKey) {
  return String(dateKey || getLocalDateKey()).slice(5);
}

function isLuckySpecialDate(dateKey, firstVisitDate) {
  const specialDateKey = getSpecialDateKey(dateKey);
  const firstVisitAnniversary = firstVisitDate
    && firstVisitDate !== dateKey
    && getSpecialDateKey(firstVisitDate) === specialDateKey;

  return LUCKY_GLUCO_SPECIAL_DATES.has(specialDateKey) || Boolean(firstVisitAnniversary);
}

function getCollectedGlucoCount(collection = readGlucoCollection()) {
  return Object.keys(collection).length;
}

function calculateLuckyGlucoChance(context, stateContext) {
  const currentScore = Number(context?.score);
  const tir = Number(context?.tir);
  const yesterdayScore = Number(context?.yesterdayScore);
  const collectedCount = Number(stateContext.collectedCount || 0);
  const visitStreak = Number(stateContext.visitStreak || 1);
  const normalDaysSinceLucky = Number(stateContext.normalDaysSinceLucky || 0);
  const daysSinceLastVisit = Number(stateContext.daysSinceLastVisit || 0);

  let chance = LUCKY_GLUCO_BASE_RATE;

  if (Number.isFinite(currentScore) && currentScore >= 90) chance += 0.08;
  if (Number.isFinite(tir) && tir >= 70) chance += 0.05;

  if (Number.isFinite(currentScore) && Number.isFinite(yesterdayScore)) {
    const scoreDiff = currentScore - yesterdayScore;
    if (scoreDiff >= 10) chance += 0.08;
    else if (scoreDiff >= 3) chance += 0.04;
  }

  chance += Math.min(Math.max(visitStreak, 1), 7) * 0.01;

  if (collectedCount >= 30) {
    chance += Math.min((collectedCount - 29) * 0.003, 0.12);
  }

  if (daysSinceLastVisit >= 3) chance += 0.06;
  if (isLuckySpecialDate(stateContext.dateKey, stateContext.firstVisitDate)) chance += 0.10;
  if (stateContext.duplicateNormalCarry) chance += 0.08;

  chance += Math.min(Math.max(normalDaysSinceLucky, 0) * 0.02, 0.10);

  return clamp(chance, LUCKY_GLUCO_BASE_RATE, LUCKY_GLUCO_MAX_RATE);
}

function getStoredDailyGlucoDecision(dateKey = getLocalDateKey()) {
  const state = readLuckyGlucoState();

  if (state.dailyDateKey !== dateKey || !state.dailyGlucoId) return null;

  const item = getGlucoLiveItemByNumber(state.dailyGlucoId);
  if (!item) return null;

  return {
    item,
    imagePath: item.image,
    isLucky: isLuckyGlucoItem(item),
    chance: Number(state.lastLuckyChance || 0),
    isPreview: false
  };
}

function getPreviewDailyGlucoDecision(dateKey = getLocalDateKey()) {
  const seed = getOrCreateVisitorSeed();
  const item = pickGlucoItemFromPool(normalGlucoItems, `${dateKey}:preview:${seed}`);

  if (!item) return null;

  return {
    item,
    imagePath: item.image,
    isLucky: false,
    chance: 0,
    isPreview: true
  };
}

function getOrCreateDailyGlucoDecision(context = {}, date = new Date()) {
  const dateKey = getLocalDateKey(date);
  const forceLuckyDebug = isForceLuckyDebugRequested(dateKey);
  const storedDecision = getStoredDailyGlucoDecision(dateKey);
  if (storedDecision && !forceLuckyDebug) return storedDecision;

  const state = readLuckyGlucoState();
  const seed = getOrCreateVisitorSeed();
  const collection = readGlucoCollection();
  const previousVisitDate = state.lastVisitDate;
  const daysSinceLastVisit = getDateDistanceInDays(previousVisitDate, dateKey);
  const isConsecutiveVisit = daysSinceLastVisit === 1;
  const isSameDayVisit = daysSinceLastVisit === 0;
  const visitStreak = isSameDayVisit
    ? Number(state.visitStreak || 1)
    : isConsecutiveVisit
      ? Number(state.visitStreak || 0) + 1
      : 1;
  const firstVisitDate = state.firstVisitDate || dateKey;
  const stateContext = {
    dateKey,
    firstVisitDate,
    visitStreak,
    daysSinceLastVisit: Number.isFinite(daysSinceLastVisit) ? daysSinceLastVisit : 0,
    collectedCount: getCollectedGlucoCount(collection),
    duplicateNormalCarry: Boolean(state.duplicateNormalCarry),
    normalDaysSinceLucky: Number(state.normalDaysSinceLucky || 0)
  };
  const luckyChance = calculateLuckyGlucoChance(context, stateContext);
  const luckyRoll = normalizedHash(`${dateKey}:lucky-roll:${seed}`);
  const shouldPickLucky = luckyGlucoItems.length > 0 && (forceLuckyDebug || luckyRoll < luckyChance);
  const pool = shouldPickLucky ? luckyGlucoItems : normalGlucoItems;
  const item = pickGlucoItemFromPool(pool, `${dateKey}:${shouldPickLucky ? "lucky" : "normal"}:${seed}`);

  if (!item) return getPreviewDailyGlucoDecision(dateKey);

  const previousNormalGlucoId = Number(state.lastNormalGlucoId);
  const isLucky = isLuckyGlucoItem(item);
  const isDuplicateNormal = !isLucky && previousNormalGlucoId === Number(item.id);

  const nextState = {
    ...state,
    firstVisitDate,
    lastVisitDate: dateKey,
    visitStreak,
    dailyDateKey: dateKey,
    dailyGlucoId: item.id,
    lastSelectedGlucoId: item.id,
    lastSelectedWasLucky: isLucky,
    lastLuckyChance: forceLuckyDebug ? 1 : Number(luckyChance.toFixed(4)),
    debugForcedLucky: forceLuckyDebug,
    duplicateNormalCarry: isLucky ? false : isDuplicateNormal,
    normalDaysSinceLucky: isLucky ? 0 : Number(state.normalDaysSinceLucky || 0) + 1,
    lastNormalGlucoId: isLucky ? state.lastNormalGlucoId : item.id,
    lastLuckyDate: isLucky ? dateKey : state.lastLuckyDate
  };

  writeLuckyGlucoState(nextState);

  return {
    item,
    imagePath: item.image,
    isLucky,
    chance: forceLuckyDebug ? 1 : luckyChance,
    isPreview: false
  };
}

function getGlucoLiveNumber(imagePath) {
  const match = imagePath.match(/gluco-live-(\d+)\.png$/);
  if (!match) return null;

  return Number(match[1]);
}

function formatGlucoLiveNumber(number) {
  if (!number) return "No. --";
  return `No. ${String(number).padStart(2, "0")}`;
}

function getGlucoLiveItemByNumber(number) {
  return glucoLiveItems.find((item) => item.id === Number(number));
}

function getGlucoLiveItemByPath(imagePath) {
  const number = getGlucoLiveNumber(imagePath);
  return getGlucoLiveItemByNumber(number);
}

function getGlucoLiveTitle(number) {
  const item = getGlucoLiveItemByNumber(number);
  if (!item) return currentLanguage === "en" ? "Gluco memory" : "グルコの想い出";
  return item.title[currentLanguage] || item.title.ja;
}

function formatGlucoLiveTitle(number) {
  return `${formatGlucoLiveNumber(number)} ${getGlucoLiveTitle(number)}`;
}

function formatLuckyGlucoDailyTitle(number) {
  return `${formatGlucoLiveNumber(number)} Lucky Gluco! ${getGlucoLiveTitle(number)}`;
}

function readGlucoCollection() {
  try {
    return JSON.parse(localStorage.getItem(GLUCO_COLLECTION_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function writeGlucoCollection(collection) {
  localStorage.setItem(GLUCO_COLLECTION_STORAGE_KEY, JSON.stringify(collection));
}

function formatEncounterLabel(count) {
  const value = Number(count || 1);

  if (currentLanguage === "en") {
    return `${value} ${value === 1 ? "time" : "times"}`;
  }

  return `${value}${t("collectionTimes")}`;
}

function updateGlucoLetterCollection(imagePath, dateKey, options = {}) {
  const imageNumber = getGlucoLiveNumber(imagePath);

  if (!imageNumber) {
    return { label: "No. --", isNew: false, encounterCount: null, isLucky: false };
  }

  try {
    const collection = readGlucoCollection();
    const imageId = `gluco-live-${String(imageNumber).padStart(2, "0")}`;
    const current = collection[imageId];
    const isLucky = Boolean(options.isLucky ?? isLuckyGlucoNumber(imageNumber));

    if (!current) {
      collection[imageId] = {
        firstSeenDate: dateKey,
        lastSeenDate: dateKey,
        encounterCount: 1,
        imagePath,
        isLucky
      };
      writeGlucoCollection(collection);
      return {
        label: `${formatGlucoLiveTitle(imageNumber)} · New!`,
        isNew: true,
        encounterCount: 1,
        isLucky
      };
    }

    if (current.lastSeenDate !== dateKey) {
      current.lastSeenDate = dateKey;
      current.encounterCount = Number(current.encounterCount || 1) + 1;
      current.imagePath = imagePath;
      current.isLucky = isLucky;
      collection[imageId] = current;
      writeGlucoCollection(collection);
    }

    return {
      label: `${formatGlucoLiveTitle(imageNumber)} · ${formatEncounterLabel(current.encounterCount)}`,
      isNew: false,
      encounterCount: current.encounterCount,
      isLucky
    };
  } catch (error) {
    return { label: formatGlucoLiveTitle(imageNumber), isNew: false, encounterCount: null, isLucky: isLuckyGlucoNumber(imageNumber) };
  }
}

function renderDailyGlucoDecision(decision, dateKey = getLocalDateKey()) {
  const commentImage = document.getElementById("commentGlucoImage");
  const commentNumber = document.getElementById("commentGlucoNumber");
  const commentAvatar = document.querySelector(".gluco-comment-avatar");
  const luckyBadge = document.getElementById("commentGlucoLuckyBadge");

  if (!commentImage || !decision?.imagePath) return;

  const imageNumber = getGlucoLiveNumber(decision.imagePath);
  const isLucky = Boolean(decision.isLucky);
  commentImage.src = decision.imagePath;
  commentImage.alt = isLucky
    ? `${formatGlucoLiveNumber(imageNumber)} Lucky Gluco`
    : `Gluco ${formatGlucoLiveTitle(imageNumber)}`;

  if (commentAvatar) {
    commentAvatar.classList.toggle("lucky-gluco", isLucky);
  }

  if (commentNumber) {
    const collectionInfo = decision.isPreview
      ? { label: formatGlucoLiveTitle(imageNumber), isLucky }
      : updateGlucoLetterCollection(decision.imagePath, dateKey, { isLucky });
    commentNumber.textContent = isLucky ? formatLuckyGlucoDailyTitle(imageNumber) : collectionInfo.label;
    commentNumber.classList.toggle("lucky-gluco", isLucky);
  }

  if (luckyBadge) {
    luckyBadge.textContent = t("luckyGlucoMet");
    luckyBadge.hidden = !isLucky;
  }

  renderCollectionView();
}

function setDailyLetterGlucoImage(context = null) {
  const dateKey = getLocalDateKey();
  const decision = context
    ? getOrCreateDailyGlucoDecision(context)
    : getStoredDailyGlucoDecision(dateKey) || getPreviewDailyGlucoDecision(dateKey);

  renderDailyGlucoDecision(decision, dateKey);
}

function renderStoredDailyLetterGlucoImage() {
  const dateKey = getLocalDateKey();
  renderDailyGlucoDecision(getStoredDailyGlucoDecision(dateKey) || getPreviewDailyGlucoDecision(dateKey), dateKey);
}

function getScoreGlucoImage(score) {
  const value = Number(score);

  if (value >= 95) return scoreGlucoImageByRank.excellent;
  if (value >= 85) return scoreGlucoImageByRank.great;
  if (value >= 70) return scoreGlucoImageByRank.good;
  if (value >= 50) return scoreGlucoImageByRank.fair;
  return scoreGlucoImageByRank.gentle;
}

function getLocalizedScoreMessage(score, fallback = "") {
  const value = Number(score);

  if (value >= 95) return t("scoreExcellent");
  if (value >= 85) return t("scoreGreat");
  if (value >= 70) return t("scoreGood");
  if (value >= 50) return t("scoreFair");
  if (Number.isFinite(value)) return t("scoreGentle");
  return fallback;
}

function updateScoreGlucoImage(score) {
  const scoreImage = document.getElementById("scoreGlucoImage");
  if (!scoreImage) return;

  scoreImage.src = getScoreGlucoImage(score);
}

function renderScoreMessage(element, message = "") {
  if (!element) return;

  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    element.textContent = "";
    return;
  }

  const firstJapanesePeriod = normalizedMessage.indexOf("。");
  const firstEnglishPeriod = normalizedMessage.indexOf(". ");
  let firstSentenceEnd = -1;
  let punctuationLength = 1;

  if (firstJapanesePeriod >= 0) {
    firstSentenceEnd = firstJapanesePeriod;
  } else if (firstEnglishPeriod >= 0) {
    firstSentenceEnd = firstEnglishPeriod;
    punctuationLength = 1;
  }

  if (firstSentenceEnd < 0 || firstSentenceEnd >= normalizedMessage.length - punctuationLength) {
    element.textContent = normalizedMessage;
    return;
  }

  const firstLine = normalizedMessage.slice(0, firstSentenceEnd + punctuationLength).trim();
  const secondLine = normalizedMessage.slice(firstSentenceEnd + punctuationLength).trim();

  element.textContent = "";
  element.appendChild(document.createTextNode(firstLine));
  element.appendChild(document.createElement("br"));
  element.appendChild(document.createTextNode(secondLine));
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage === "en" ? "en" : "ja";

  document.querySelectorAll("[data-i18n-key]").forEach((element) => {
    const key = element.dataset.i18nKey;
    element.textContent = t(key);
  });

  document.querySelectorAll(".language-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.language === currentLanguage);
  });

  updatePeriodButtons();
  renderStoredDailyLetterGlucoImage();
  renderCollectionView();
  safelyUpdateLetterControls();
  updateRuleCommentDisplay();
  updateAiLetterControls();
  syncMobileApp();
}

function setLanguage(language) {
  if (!translations[language]) return;

  currentLanguage = language;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  applyLanguage();
  loadDailyStats();
}

function setupLanguageSwitch() {
  document.querySelectorAll(".language-button").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });
}

function getSgvValuesInRange(entries, rangeStart, rangeEnd) {
  return [...entries]
    .filter((entry) => {
      const time = getEntryTime(entry);
      return Number.isFinite(time) && time >= rangeStart && time <= rangeEnd;
    })
    .map((entry) => Number(entry.sgv))
    .filter((value) => Number.isFinite(value));
}

function calculateGlucoScoreFromValues(values) {
  if (!values.length) return null;

  const inRange = values.filter((v) => v >= 70 && v <= 180).length;
  const belowRange = values.filter((v) => v < 70).length;
  const tir = pct(inRange, values.length);
  const tbr = pct(belowRange, values.length);
  const avg = Math.round(average(values));
  const sd = standardDeviation(values);
  const cv = avg > 0 ? ((sd / avg) * 100).toFixed(1) : 0;

  return calculateGlucoScore({ tir, tbr, cv, avg }).score;
}

function calculateGlucoScoreForEntries(entries, rangeStart, rangeEnd) {
  return calculateGlucoScoreFromValues(getSgvValuesInRange(entries, rangeStart, rangeEnd));
}

function calculateSevenDayAverageGlucoScore(entries, now) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const scores = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const rangeEnd = now - (offset * oneDayMs);
    const rangeStart = rangeEnd - oneDayMs;
    const score = calculateGlucoScoreForEntries(entries, rangeStart, rangeEnd);
    if (score !== null) scores.push(score);
  }

  if (!scores.length) return null;
  return Math.round(average(scores));
}

function getPreviousScoreLabel(periodKey) {
  if (currentLanguage === "en") {
    if (periodKey === "today") return "vs yesterday";
    if (periodKey === "yesterday") return "vs previous day";
    return "vs previous range";
  }

  if (periodKey === "today") return "昨日より";
  if (periodKey === "yesterday") return "前日より";
  return "前期間より";
}

function updateScoreMetaDisplay(currentScore, previousScore, sevenDayAverageScore, periodKey = currentLivePeriod) {
  const previousEl = document.getElementById("scoreYesterdayDelta");
  const sevenDayEl = document.getElementById("scoreSevenDayAverage");

  if (previousEl) {
    if (currentScore === null || previousScore === null) {
      previousEl.textContent = currentLanguage === "en" ? "Previous: --" : "比較: --";
    } else {
      const diff = Number(currentScore) - Number(previousScore);
      const label = getPreviousScoreLabel(periodKey);
      if (diff > 0) {
        previousEl.textContent = currentLanguage === "en" ? `↗ +${diff} ${label}` : `↗ ${label} +${diff}`;
      } else if (diff < 0) {
        previousEl.textContent = currentLanguage === "en" ? `↘ ${diff} ${label}` : `↘ ${label} ${diff}`;
      } else {
        previousEl.textContent = currentLanguage === "en" ? `→ same ${label}` : `→ ${label} 同じ`;
      }
    }
  }

  if (sevenDayEl) {
    if (sevenDayAverageScore === null) {
      sevenDayEl.textContent = currentLanguage === "en" ? "7-day avg: --" : "過去7日平均: --";
    } else {
      sevenDayEl.textContent = currentLanguage === "en" ? `7-day avg: ${sevenDayAverageScore}` : `過去7日平均: ${sevenDayAverageScore}`;
    }
  }
}

function setLiveStatus(statusType, label, detail = "") {
  const liveIndicator = document.getElementById("liveIndicator");
  const liveLabel = document.getElementById("liveLabel");

  if (!liveIndicator || !liveLabel) return;

  liveIndicator.classList.remove("live-online", "live-stale", "live-error", "live-pending");
  liveIndicator.classList.add(`live-${statusType}`);
  liveLabel.textContent = label;
  liveIndicator.title = detail || label;
}

function updateCurrentGlucoseColor(glucose) {
  const glucoseValue = document.getElementById("glucoseValue");
  if (!glucoseValue) return;

  const value = Number(glucose);
  glucoseValue.classList.remove("glucose-high", "glucose-low", "glucose-in-range");

  if (!Number.isFinite(value)) return;

  if (value >= 180) {
    glucoseValue.classList.add("glucose-high");
    return;
  }

  if (value <= 69) {
    glucoseValue.classList.add("glucose-low");
    return;
  }

  glucoseValue.classList.add("glucose-in-range");
}

function updateRangeStatus(glucose) {
  updateCurrentGlucoseColor(glucose);

  const rangeStatus = document.getElementById("rangeStatus");
  if (!rangeStatus) return;

  rangeStatus.classList.remove("in-range", "above-range", "below-range");

  if (glucose < 70) {
    rangeStatus.classList.add("below-range");
    rangeStatus.textContent = t("rangeLow");
    return;
  }

  if (glucose > 180) {
    rangeStatus.classList.add("above-range");
    rangeStatus.textContent = t("rangeHigh");
    return;
  }

  rangeStatus.classList.add("in-range");
  rangeStatus.textContent = t("rangeIn");
}

function formatGlucoseDelta(latestValue, previousValue) {
  const latest = Number(latestValue);
  const previous = Number(previousValue);

  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return "--";

  const diff = latest - previous;

  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return "±0";
}

function updateGlucoseDelta(latestValue, previousValue) {
  const deltaEl = document.getElementById("glucoseDelta");
  if (!deltaEl) return;

  const deltaText = formatGlucoseDelta(latestValue, previousValue);
  deltaEl.textContent = deltaText;

  deltaEl.classList.remove("delta-up", "delta-down", "delta-flat");

  if (deltaText.startsWith("+")) {
    deltaEl.classList.add("delta-up");
  } else if (deltaText.startsWith("-")) {
    deltaEl.classList.add("delta-down");
  } else {
    deltaEl.classList.add("delta-flat");
  }

  if (deltaText === "--") {
    deltaEl.title = t("deltaUnavailable");
  } else {
    deltaEl.title = `${t("deltaTitle")}: ${deltaText} mg/dL`;
  }
}

function formatRelativeUpdate(date) {
  if (!date || Number.isNaN(date.getTime())) return "--";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);

  if (diffSec < 60) return currentLanguage === "en" ? "just now" : "たった今";
  if (diffMin < 60) return currentLanguage === "en" ? `${diffMin} min ago` : `${diffMin}分前`;
  if (diffHour < 24) {
    return currentLanguage === "en"
      ? `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`
      : `${diffHour}時間前`;
  }

  return date.toLocaleDateString(currentLanguage === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function updateHeaderUpdated(measuredAt) {
  const headerUpdated = document.getElementById("headerUpdated");
  if (!headerUpdated) return;
  headerUpdated.textContent = formatRelativeUpdate(measuredAt);
}

function formatDateTime(date) {
  return date.toLocaleString(currentLanguage === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}


function getAiLetterWorkerEndpoint() {
  const params = new URLSearchParams(window.location.search);
  const queryEndpoint = params.get("aiWorkerEndpoint");
  if (queryEndpoint) return queryEndpoint;

  return localStorage.getItem(AI_LETTER_WORKER_ENDPOINT_STORAGE_KEY) || DEFAULT_AI_LETTER_WORKER_ENDPOINT;
}

function isAiLetterWorkerEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.has("debugAiWorker") || localStorage.getItem(AI_LETTER_WORKER_ENABLED_STORAGE_KEY) === "true";
}

function setElementTextOrHide(element, text = "") {
  if (!element) return;

  const normalizedText = String(text || "").trim();
  element.textContent = normalizedText;
  element.hidden = normalizedText.length === 0;
}

function setAiLetterPanelStatus(statusKey, statusType = "", detailText = "") {
  const status = document.getElementById("aiLetterStatus");
  if (!status) return;

  status.classList.remove("success", "error");
  if (statusType) status.classList.add(statusType);

  const baseText = t(statusKey);
  const message = detailText
    ? `${baseText ? `${baseText} ` : ""}${detailText}`
    : baseText;

  setElementTextOrHide(status, message);
}

function setAiLetterPanelMessage(message, statusType = "") {
  const status = document.getElementById("aiLetterStatus");
  if (!status) return;

  status.classList.remove("success", "error");
  if (statusType) status.classList.add(statusType);
  setElementTextOrHide(status, message);
}

function ensureAiLetterResultElement() {
  let result = document.getElementById("aiLetterResult");
  if (result) return result;

  const aiPanel =
    document.getElementById("aiLetterButton")?.closest(".ai-letter-panel") ||
    document.getElementById("aiLetterButton")?.closest(".letter-action-panel");

  if (!aiPanel) return null;

  result = document.createElement("div");
  result.id = "aiLetterResult";
  result.className = "ai-letter-result";
  result.hidden = true;

  const status = document.getElementById("aiLetterStatus");
  if (status?.parentElement === aiPanel) {
    status.insertAdjacentElement("afterend", result);
  } else {
    aiPanel.appendChild(result);
  }

  return result;
}

function showAiLetterResult(letter) {
  const result = ensureAiLetterResultElement();
  if (!result) return;

  if (!letter) {
    result.hidden = true;
    result.textContent = "";
    return;
  }

  result.hidden = false;
  result.textContent = letter;
}

function hasVisibleAiLetterResult() {
  const result = document.getElementById("aiLetterResult");
  return Boolean(result && !result.hidden && result.textContent.trim());
}

function getAiLetterLocalCacheKey(summary = {}, mode = currentAiLetterMode) {
  return [
    summary.pageMode || "page",
    summary.language || currentLanguage || "ja",
    summary.period || currentLivePeriod || "today",
    summary.slot || "unknown",
    normalizeAiLetterMode(mode),
    summary.rangeLabel || ""
  ].join("|");
}

function readAiLetterLocalCache() {
  try {
    const raw = localStorage.getItem(AI_LETTER_LOCAL_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const cache = JSON.parse(raw);
    return cache && typeof cache === "object" ? cache : {};
  } catch (error) {
    console.warn("Failed to read AI letter local cache", error);
    return {};
  }
}

function writeAiLetterLocalCache(cache) {
  try {
    localStorage.setItem(AI_LETTER_LOCAL_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("Failed to write AI letter local cache", error);
  }
}

function trimAiLetterLocalCache(cache) {
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

  return Object.fromEntries(entries.slice(0, AI_LETTER_LOCAL_CACHE_MAX_ITEMS));
}

function getCachedAiLetter(summary = latestAiLetterSummary, mode = currentAiLetterMode) {
  if (!summary) return null;

  const cache = readAiLetterLocalCache();
  const item = cache[getAiLetterLocalCacheKey(summary, mode)];

  if (!item || typeof item.text !== "string" || !item.text.trim()) return null;
  return item;
}

function hasCachedAiLetter(summary = latestAiLetterSummary, mode = currentAiLetterMode) {
  return Boolean(getCachedAiLetter(summary, mode));
}

function saveAiLetterLocalCache(summary, data, letterText, mode = currentAiLetterMode) {
  if (!summary || !letterText) return;

  const cache = readAiLetterLocalCache();
  const analysisMode = normalizeAiLetterMode(mode);
  const key = getAiLetterLocalCacheKey(summary, analysisMode);

  cache[key] = {
    text: letterText,
    analysisMode,
    savedAt: new Date().toISOString(),
    status: data?.status || "success",
    source: data?.source || "",
    provider: data?.letter?.provider || "",
    model: data?.letter?.model || "",
    usage: data?.usage || null,
    slot: {
      key: summary.slot || "unknown",
      label: summary.slotLabel || ""
    },
    period: summary.period || currentLivePeriod || "today",
    rangeLabel: summary.rangeLabel || ""
  };

  writeAiLetterLocalCache(trimAiLetterLocalCache(cache));
}

function showCachedAiLetter(summary = latestAiLetterSummary, statusKey = "aiLetterStatusLocalCache", statusType = "success", mode = currentAiLetterMode) {
  const cached = getCachedAiLetter(summary, mode);
  if (!cached) return false;

  showAiLetterResult(cached.text);
  setAiLetterPanelStatus(statusKey, statusType);
  return true;
}

function getAiLetterTextFromResponse(data) {
  if (!data || typeof data !== "object") return "";

  if (typeof data.letter === "string") return data.letter;
  if (data.letter && typeof data.letter.text === "string") return data.letter.text;
  if (typeof data.letterText === "string") return data.letterText;
  return "";
}

function getAiLetterStatusKeyFromResponse(data) {
  if (!data || typeof data !== "object") return "aiLetterStatusSuccess";

  if (data.status === "cached" || data.cached === true || data.letter?.cached === true) {
    return "aiLetterStatusCached";
  }

  return "aiLetterStatusSuccess";
}

function getAiLetterUsageDetailFromResponse(data) {
  const usage = data?.usage;
  if (!usage || typeof usage !== "object") return "";

  const generations = Number(usage.monthlyGenerationCount);
  const cost = Number(usage.monthlyEstimatedCostJpy);
  if (!Number.isFinite(generations) || !Number.isFinite(cost)) return "";

  const isTemporaryMemory = usage.storage !== "durable-object-sqlite";

  if (currentLanguage === "en") {
    const label = isTemporaryMemory ? "this Worker session" : "this month";
    return `(${label}: ${generations} new / approx. ¥${cost.toFixed(2)}, paid by the developer)`;
  }

  const label = isTemporaryMemory ? "このWorker起動中" : "今月";
  return `（${label}: 新規${generations}回 / 約${cost.toFixed(2)}円・開発者負担）`;
}

function getAiLetterErrorStatusKey(data) {
  const code = data?.code || data?.errorCode || data?.error;

  if (code === "rate_limited") return "aiLetterStatusRateLimited";
  if (code === "budget_stopped") return "aiLetterStatusBudgetStopped";
  if (code === "ai_disabled") return "aiLetterStatusDisabled";
  if (code === "turnstile_failed") return "aiLetterStatusTurnstileFailed";
  return "aiLetterStatusError";
}

function ensureTurnstileScript() {
  if (!TURNSTILE_SITE_KEY) return;
  if (document.getElementById(TURNSTILE_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = () => renderAiLetterTurnstileWidget();
  document.head.appendChild(script);
}

function findTextElementByLabel(label) {
  if (!label) return null;

  const normalizedLabel = String(label).replace(/\s+/g, " ").trim();
  const candidates = Array.from(document.querySelectorAll("h1, h2, h3, h4, .section-title, .card-title, .letter-title, div, span"))
    .filter((element) => {
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text.includes(normalizedLabel)) return false;
      if (text.length > normalizedLabel.length + 8) return false;
      return true;
    })
    .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);

  return candidates[0] || null;
}

function findGlucoMessageBadge() {
  const candidates = Array.from(document.querySelectorAll("a, button, span, div, p"));
  return candidates.find((element) => {
    const text = (element.textContent || "").trim().toLowerCase();
    return text === "gluco message";
  }) || null;
}

function findLetterTitleRow() {
  const titleLabel = t("letterTitle").replace(/^\S+\s*/, "").trim();
  const titleElement =
    findTextElementByLabel(t("letterTitle")) ||
    findTextElementByLabel(titleLabel);

  if (!titleElement) return null;

  const row =
    titleElement.closest?.(".section-header, .card-header, .panel-header, header") ||
    titleElement.parentElement;

  if (row) {
    row.classList.add("gluco-letter-title-row");
  }

  return row;
}

function findActionPanelRootByProbe(probeElement) {
  if (!probeElement) return null;

  const actionGrid = document.querySelector(".letter-action-grid");
  if (actionGrid) {
    const directChild = Array.from(actionGrid.children)
      .find((child) => child.contains(probeElement));
    if (directChild) return directChild;
  }

  return probeElement.closest?.(".letter-action-panel") || probeElement.parentElement;
}

function cacheLetterPanelElements(force = false) {
  if (letterPanelElementsCache && !force) return letterPanelElementsCache;

  const browserPanel = document.querySelector(".rule-letter-section");
  const aiPanel = findActionPanelRootByProbe(document.getElementById("aiLetterButton"));
  const chatPanel = findActionPanelRootByProbe(
    document.getElementById("chatGptCopyButton") ||
    document.getElementById("chatGptOpenLink")
  );

  letterPanelElementsCache = {
    browser: browserPanel,
    ai: aiPanel,
    chat: chatPanel
  };

  Object.entries(letterPanelElementsCache).forEach(([panel, element]) => {
    if (element) element.dataset.letterPanelRoot = panel;
  });

  return letterPanelElementsCache;
}

function setPanelVisibility(element, isVisible) {
  if (!element) return;

  element.classList.toggle("gluco-letter-panel-hidden", !isVisible);
  element.hidden = !isVisible;
  element.setAttribute("aria-hidden", isVisible ? "false" : "true");

  if (isVisible) {
    element.style.removeProperty("display");
  } else {
    element.style.setProperty("display", "none", "important");
  }
}

function placeLetterControls(controls, body, firstPanel) {
  const badge = findGlucoMessageBadge();
  if (badge) {
    badge.hidden = true;
    badge.style.display = "none";
  }

  const titleRow = findLetterTitleRow();
  if (titleRow) {
    controls.classList.remove("is-in-body");
    if (controls.parentElement !== titleRow) {
      titleRow.appendChild(controls);
    }
    return;
  }

  controls.classList.add("is-in-body");
  if (body && firstPanel && controls.parentElement !== body) {
    body.insertBefore(controls, firstPanel);
  } else if (body && !controls.parentElement) {
    body.prepend(controls);
  }
}

function ensureAiLetterModeSwitcher() {
  let controls = document.getElementById("glucoLetterControls");

  if (!controls) {
    const header = findLetterTitleRow();
    controls = document.createElement("div");
    controls.id = "glucoLetterControls";
    controls.className = "gluco-letter-controls";
    controls.innerHTML = `
      <div class="gluco-letter-controls-inner">
        <div class="gluco-letter-control-group">
          <span id="glucoLetterModeTitle" class="gluco-letter-control-title">分析</span>
          <div class="gluco-letter-mode-toggle" role="group" aria-label="Analysis mode">
            <button id="aiModeLetterToggle" type="button" class="gluco-letter-mode-toggle-button" data-ai-mode-toggle="letter">🍀 やさしい分析</button>
            <button id="aiModeDeepToggle" type="button" class="gluco-letter-mode-toggle-button" data-ai-mode-toggle="deep">📊 しっかり分析</button>
          </div>
        </div>
      </div>
    `;

    if (header) {
      header.appendChild(controls);
    } else {
      const body = document.querySelector(".gluco-comment-body");
      const firstPanel = document.querySelector("[data-letter-panel='browser'], .rule-letter-section");
      if (body && firstPanel) body.insertBefore(controls, firstPanel);
    }
  }

  setupLetterControlsClickHandler();
  updateAiModeSwitcher();
  updateLetterPanelSwitcher();
}

function updateAiModeSwitcher() {
  const controls = document.getElementById("glucoLetterControls");
  if (!controls) return;

  const title = document.getElementById("glucoLetterModeTitle");
  if (title) title.textContent = t("aiLetterModeSwitchTitle");

  controls.querySelectorAll("[data-ai-mode-toggle]").forEach((button) => {
    const mode = normalizeAiLetterMode(button.dataset.aiModeToggle);
    const label = mode === "deep"
      ? (currentLanguage === "en" ? "📊 Detailed analysis" : "📊 しっかり分析")
      : (currentLanguage === "en" ? "🍀 Gentle analysis" : "🍀 やさしい分析");
    button.textContent = label;
    button.classList.toggle("is-active", mode === currentAiLetterMode);
    button.setAttribute("aria-pressed", mode === currentAiLetterMode ? "true" : "false");
  });
}

function getGlucoLetterRoot() {
  return document.querySelector(".gluco-comment");
}

function applyLetterPanelRootClass(panel = currentAiLetterPanel) {
  const normalizedPanel = normalizeLetterPanel(panel);
  const root = getGlucoLetterRoot();
  const body = document.querySelector(".gluco-comment-body");

  if (root) {
    root.classList.remove("letter-panel-browser", "letter-panel-ai", "letter-panel-chat");
    root.classList.add(`letter-panel-${normalizedPanel}`);
  }

  if (body) {
    body.dataset.activeLetterPanel = normalizedPanel;
  }
}

function showAllLetterPanels() {
  const root = document.querySelector(".gluco-comment");
  const body = document.querySelector(".gluco-comment-body");

  if (root) {
    root.classList.remove("letter-panel-browser", "letter-panel-ai", "letter-panel-chat");
  }

  if (body) {
    body.removeAttribute("data-active-letter-panel");
  }

  const panelSelectors = [
    ".rule-letter-section",
    ".ai-letter-panel",
    ".chatgpt-letter-panel",
    "[data-letter-panel]"
  ];

  document.querySelectorAll(panelSelectors.join(",")).forEach((element) => {
    element.hidden = false;
    element.removeAttribute("aria-hidden");
    element.classList.remove("gluco-letter-panel-hidden");
    element.style.removeProperty("display");
  });

  const actionGrid = document.querySelector(".letter-action-grid");
  if (actionGrid) {
    actionGrid.hidden = false;
    actionGrid.style.removeProperty("display");
  }
}

function updateLetterPanelSwitcher() {
  showAllLetterPanels();
}

function safelyUpdateLetterControls() {
  try {
    if (!document.getElementById("glucoLetterControls")) {
      ensureAiLetterModeSwitcher();
    } else {
      updateAiModeSwitcher();
      updateLetterPanelSwitcher();
    }
    showAllLetterPanels();
  } catch (error) {
    console.warn("Letter controls update skipped", error);
  }
}

function cleanupAiLetterModeActionButtons() {
  const aiButton = document.getElementById("aiLetterButton");
  const actions = document.getElementById("aiLetterModeActions");

  if (actions && aiButton && actions.parentNode) {
    actions.parentNode.insertBefore(aiButton, actions);
    actions.remove();
  }

  if (aiButton) {
    aiButton.removeAttribute("data-ai-letter-mode");
    aiButton.classList.remove("ai-letter-mode-button", "is-active");
  }

  const deepButton = document.getElementById("aiLetterDeepButton");
  if (deepButton) deepButton.remove();
}

function ensureAiLetterTurnstileContainer() {
  const aiButton = document.getElementById("aiLetterButton");
  if (!aiButton) return null;

  let container = document.getElementById("aiLetterTurnstile");
  if (container) return container;

  container = document.createElement("div");
  container.id = "aiLetterTurnstile";
  container.className = "ai-letter-turnstile";
  container.setAttribute("aria-label", "AI safety check");

  aiButton.insertAdjacentElement("afterend", container);
  return container;
}

function renderAiLetterTurnstileWidget() {
  const container = ensureAiLetterTurnstileContainer();
  if (!container || !TURNSTILE_SITE_KEY) return;
  if (!window.turnstile || typeof window.turnstile.render !== "function") return;
  if (container.dataset.rendered === "true") return;

  window.glucoTurnstileToken = "";

  const widgetId = window.turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "auto",
    callback: (token) => {
      window.glucoTurnstileToken = token;

      if (pendingAiLetterModeAfterTurnstile) {
        const pendingMode = pendingAiLetterModeAfterTurnstile;
        pendingAiLetterModeAfterTurnstile = null;
        handleAiLetterRequest(pendingMode, { skipTurnstilePrep: true });
      }
    },
    "expired-callback": () => {
      window.glucoTurnstileToken = "";
    },
    "error-callback": () => {
      window.glucoTurnstileToken = "";
      setAiLetterPanelStatus("aiLetterStatusTurnstileFailed", "error");
    }
  });

  container.dataset.rendered = "true";
  container.dataset.widgetId = String(widgetId);
}

function setupAiLetterTurnstile() {
  // Turnstile is intentionally lazy.
  // It is rendered only after the user presses the AI analysis button,
  // so live data refreshes do not keep running browser checks.
}

function prepareAiLetterTurnstile(analysisMode) {
  if (!TURNSTILE_SITE_KEY) return false;

  const existingToken = getTurnstileTokenForAiLetter();
  if (existingToken) return false;

  pendingAiLetterModeAfterTurnstile = normalizeAiLetterMode(analysisMode);
  const container = ensureAiLetterTurnstileContainer();

  if (container) {
    container.classList.add("is-visible");
    container.removeAttribute("hidden");
  }

  setAiLetterPanelStatus("aiLetterStatusTurnstileWaiting", "success");
  ensureTurnstileScript();

  if (window.turnstile && typeof window.turnstile.render === "function") {
    renderAiLetterTurnstileWidget();

    const widgetId = container?.dataset?.widgetId;
    if (widgetId && typeof window.turnstile.reset === "function") {
      try {
        window.turnstile.reset(widgetId);
      } catch (error) {
        console.warn("Failed to reset AI letter Turnstile widget", error);
      }
    }
  }

  return true;
}

function resetAiLetterTurnstile() {
  const container = document.getElementById("aiLetterTurnstile");
  const widgetId = container?.dataset?.widgetId;

  window.glucoTurnstileToken = "";

  if (container) {
    container.classList.remove("is-visible");
    container.setAttribute("hidden", "hidden");
  }

  pendingAiLetterModeAfterTurnstile = null;

  if (widgetId && window.turnstile && typeof window.turnstile.reset === "function") {
    try {
      window.turnstile.reset(widgetId);
    } catch (error) {
      console.warn("Failed to reset AI letter Turnstile widget", error);
    }
  }
}

function getTurnstileTokenForAiLetter() {
  const responseInput = document.querySelector("#aiLetterTurnstile [name='cf-turnstile-response']");
  if (responseInput && responseInput.value) return responseInput.value;

  if (typeof window !== "undefined" && typeof window.glucoTurnstileToken === "string") {
    return window.glucoTurnstileToken;
  }

  return "";
}

function getAiLetterSlot(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return { key: "morning", label: t("slotMorning") };
  if (hour < 18) return { key: "afternoon", label: t("slotAfternoon") };
  return { key: "night", label: t("slotNight") };
}

function updateAiSlotDisplay() {
  const slotBadge = document.getElementById("aiSlotBadge");
  if (!slotBadge) return;
  slotBadge.textContent = `${getAiLetterSlot().label} / ${getAiLetterModeLabel()}`;
}

function setAiLetterSummary(summary) {
  latestAiLetterSummary = summary;
  updateAiLetterControls();

  if (!hasVisibleAiLetterResult()) {
    showCachedAiLetter(summary);
  }
}

function updateAiLetterControls(statusKey = null, statusType = "", options = {}) {
  updateAiSlotDisplay();

  const copyButton = document.getElementById("chatGptCopyButton");
  const copyStatus = document.getElementById("chatGptCopyStatus");
  const hasSummary = Boolean(latestAiLetterSummary);

  if (copyButton) {
    copyButton.disabled = !hasSummary;
    copyButton.textContent = t("chatGptCopyButton");
  }

  if (copyStatus) {
    copyStatus.classList.remove("success", "error");
    if (statusType) copyStatus.classList.add(statusType);

    if (statusKey) {
      setElementTextOrHide(copyStatus, t(statusKey));
    } else {
      setElementTextOrHide(copyStatus, hasSummary ? t("chatGptCopyReady") : t("chatGptCopyWaiting"));
    }
  }

  const workerEnabled = isAiLetterWorkerEnabled();
  safelyUpdateLetterControls();

  const aiButton = document.getElementById("aiLetterButton");
  if (aiButton) {
    const hasCachedCurrentMode = hasCachedAiLetter(latestAiLetterSummary, currentAiLetterMode);
    aiButton.disabled = !hasSummary || !workerEnabled || aiLetterRequestInFlight;

    if (aiLetterRequestInFlight) {
      aiButton.textContent = t("aiLetterButtonLoading");
    } else if (workerEnabled && hasSummary && hasCachedCurrentMode) {
      aiButton.textContent = t("aiLetterButtonCached");
    } else {
      aiButton.textContent = workerEnabled && hasSummary ? t("aiLetterButtonReady") : t("aiLetterButtonPreparing");
    }
  }

  const aiStatus = document.getElementById("aiLetterStatus");
  if (
    aiStatus
    && !aiLetterRequestInFlight
    && !options.preserveAiStatus
    && !hasVisibleAiLetterResult()
  ) {
    aiStatus.classList.remove("success", "error");

    if (!workerEnabled) {
      setElementTextOrHide(aiStatus, t("aiLetterStatusLocalOnly"));
    } else if (!hasSummary) {
      setElementTextOrHide(aiStatus, t("aiLetterStatusWaitingForSummary"));
    } else {
      setElementTextOrHide(aiStatus, t("aiLetterStatusReady"));
    }
  }
}

function forceEnableAiLetterButtonSoon() {
  window.setTimeout(() => {
    const aiButton = document.getElementById("aiLetterButton");
    const hasSummary = Boolean(latestAiLetterSummary);
    const workerEnabled = isAiLetterWorkerEnabled();

    if (aiButton && hasSummary && workerEnabled && !aiLetterRequestInFlight) {
      aiButton.disabled = false;
      aiButton.textContent = hasCachedAiLetter(latestAiLetterSummary, currentAiLetterMode)
        ? t("aiLetterButtonCached")
        : t("aiLetterButtonReady");
    }
  }, 0);
}

function formatAiDateRange(rangeStart, rangeEnd) {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return "--";
  return `${formatDateTime(new Date(rangeStart))} ${t("chartRangeSeparator")} ${formatDateTime(new Date(rangeEnd))}`;
}

function getLatestDeltaFromEntries(entries) {
  const sortedEntries = [...entries]
    .filter((entry) => Number.isFinite(getEntryTime(entry)) && Number.isFinite(Number(entry.sgv)))
    .sort((a, b) => getEntryTime(b) - getEntryTime(a));

  if (sortedEntries.length < 2) return "--";
  return formatGlucoseDelta(sortedEntries[0].sgv, sortedEntries[1].sgv);
}

function buildPatternHints({ tir, tar, tbr, cv, avg, glucoScore, previousScore }) {
  const hints = [];
  const numericTir = Number(tir);
  const numericTar = Number(tar);
  const numericTbr = Number(tbr);
  const numericCv = Number(cv);

  if (currentLanguage === "en") {
    if (numericTir >= 70) hints.push(`TIR is ${tir}%, and steady moments are visible in this range.`);
    if (numericTar >= 20) hints.push(`TAR is ${tar}%, so higher periods may offer gentle clues when reviewed later.`);
    if (numericTbr >= 4) hints.push(`TBR is ${tbr}%, so lower periods may be gentle clues to look back on later.`);
    if (numericCv >= 36) hints.push(`CV is ${cv}%, so the day looks a little more wavy.`);
    if (previousScore !== null && Number.isFinite(Number(previousScore))) {
      const diff = Number(glucoScore) - Number(previousScore);
      if (diff > 0) hints.push(`GlucoScore looks ${diff} points higher than the previous comparison period.`);
      if (diff < 0) hints.push(`GlucoScore looks ${Math.abs(diff)} points softer than the previous comparison period.`);
    }
    if (!hints.length) hints.push(`Average glucose is ${avg}mg/dL, and the selected range has clues we can review gently.`);
    return hints.slice(0, 4);
  }

  if (numericTir >= 70) hints.push(`TIRは${tir}%で、落ち着いている時間もちゃんと見えているよ。`);
  if (numericTar >= 20) hints.push(`TARは${tar}%で、高めの時間もあとでやさしく振り返るヒントになりそうだよ。`);
  if (numericTbr >= 4) hints.push(`TBRは${tbr}%で、低めの時間もあとでそっと見返す手がかりになりそうだよ。`);
  if (numericCv >= 36) hints.push(`CVは${cv}%で、血糖の動きが少し大きめに見えているよ。`);
  if (previousScore !== null && Number.isFinite(Number(previousScore))) {
    const diff = Number(glucoScore) - Number(previousScore);
    if (diff > 0) hints.push(`GlucoScoreは比較期間より${diff}高く見えているよ。`);
    if (diff < 0) hints.push(`GlucoScoreは比較期間より${Math.abs(diff)}控えめに見えているよ。`);
  }
  if (!hints.length) hints.push(`平均血糖は${avg}mg/dLで、表示中の期間にも振り返りの手がかりがあるよ。`);
  return hints.slice(0, 4);
}

function buildAiLetterSummary({ periodKey, rangeStart, rangeEnd, latest, entries, tir, tar, tbr, avg, cv, gmi, glucoScore, previousScore, sevenDayAverageScore }) {
  const slot = getAiLetterSlot();
  const latestTime = latest ? getEntryTime(latest) : NaN;
  const latestDate = Number.isFinite(latestTime) ? new Date(latestTime) : null;
  const direction = latest?.direction ? (directionMap[latest.direction] || latest.direction) : "--";
  const delta = getLatestDeltaFromEntries(entries);

  return {
    version: "gluco-ai-letter-summary-v0.1",
    pageMode: "kazuma-public-demo",
    language: currentLanguage,
    period: periodKey,
    slot: slot.key,
    slotLabel: slot.label,
    rangeLabel: formatAiDateRange(rangeStart, rangeEnd),
    latestMeasuredAt: latestDate ? formatDateTime(latestDate) : "--",
    currentGlucose: latest?.sgv ?? null,
    direction,
    delta,
    metrics: {
      tir,
      tar,
      tbr,
      averageGlucose: avg,
      cv,
      gmi,
      glucoScore,
      previousScore,
      sevenDayAverageScore
    },
    patternHints: buildPatternHints({ tir, tar, tbr, cv, avg, glucoScore, previousScore })
  };
}

function buildChatGptPrompt(summary, mode = currentAiLetterMode) {
  if (!summary) return "";

  const analysisMode = normalizeAiLetterMode(mode);
  const modeLabel = getAiLetterModeLabel(analysisMode);

  if (currentLanguage === "en") {
    const task = analysisMode === "deep"
      ? "Please create a structured, detailed reflection for someone living with diabetes, using only the glucose summary below."
      : "Please write a short, gentle letter for someone living with diabetes, using only the glucose summary below.";
    const outputRule = analysisMode === "deep"
      ? "- Use short sections and bullet points. Include overview, metric clues, pattern hints, and gentle things to look back on."
      : "- Keep it to 3-6 short sentences.";

    return `You are gluco, the official AI companion of GlucoScope.

Mode: ${modeLabel}
${task}

Rules:
- Do not diagnose.
- Do not make treatment decisions.
- Do not suggest insulin doses, medication changes, or device setting changes.
- Do not shame, blame, or frighten the person.
- Treat glucose data as clues for reflection, not as a grade.
- Use simple, warm language.
- Avoid real-time wording such as "right now" because this may be read later.
${outputRule}

Glucose summary:
- Page mode: ${summary.pageMode}
- Period: ${summary.period}
- Letter time: ${summary.slotLabel}
- Range: ${summary.rangeLabel}
- Latest measured at: ${summary.latestMeasuredAt}
- Latest glucose reading: ${summary.currentGlucose ?? "--"} mg/dL
- Direction: ${summary.direction}
- Delta from previous reading: ${summary.delta} mg/dL
- TIR: ${summary.metrics.tir}%
- TAR: ${summary.metrics.tar}%
- TBR: ${summary.metrics.tbr}%
- Average glucose: ${summary.metrics.averageGlucose} mg/dL
- CV: ${summary.metrics.cv}%
- GMI estimate: ${summary.metrics.gmi}%
- GlucoScore: ${summary.metrics.glucoScore}
- Previous comparison score: ${summary.metrics.previousScore ?? "--"}
- 7-day average score: ${summary.metrics.sevenDayAverageScore ?? "--"}
- Reflection hints:
${summary.patternHints.map((hint) => `  - ${hint}`).join("\n")}

Please write as gluco, a small kind companion nearby.`;
  }

  const task = analysisMode === "deep"
    ? "下の血糖サマリーだけをもとに、糖尿病とともに生きる人へ、少し詳しい振り返りを書いてください。"
    : "下の血糖サマリーだけをもとに、糖尿病とともに生きる人へ、短くてやさしいお手紙を書いてください。";
  const outputRule = analysisMode === "deep"
    ? "- 短い見出しと箇条書きを使う。全体感、指標の手がかり、見返すとよさそうな観点を分けて書く。"
    : "- 3〜6文くらいの短いお手紙にする。";

  return `あなたはGlucoScope公式AIパートナー「グルコ」です。

モード: ${modeLabel}
${task}

ルール:
- 診断しない。
- 治療判断をしない。
- インスリン量、薬、医療機器設定の変更を指示しない。
- 責めない。怖がらせない。急かさない。
- 血糖データを採点ではなく、振り返りの手がかりとして扱う。
- 子どもにも伝わるくらいやさしい言葉にする。
- キャッシュ表示される可能性があるため、「今の血糖」「現在」などのリアルタイム断定は避ける。
${outputRule}

血糖サマリー:
- ページ種別: ${summary.pageMode}
- 期間: ${summary.period}
- お手紙の時間: ${summary.slotLabel}
- 表示範囲: ${summary.rangeLabel}
- 最新測定: ${summary.latestMeasuredAt}
- 最新の血糖測定: ${summary.currentGlucose ?? "--"} mg/dL
- 矢印: ${summary.direction}
- 前回との差分: ${summary.delta} mg/dL
- TIR: ${summary.metrics.tir}%
- TAR: ${summary.metrics.tar}%
- TBR: ${summary.metrics.tbr}%
- 平均血糖: ${summary.metrics.averageGlucose} mg/dL
- CV: ${summary.metrics.cv}%
- GMI目安: ${summary.metrics.gmi}%
- GlucoScore: ${summary.metrics.glucoScore}
- 比較期間のGlucoScore: ${summary.metrics.previousScore ?? "--"}
- 過去7日平均GlucoScore: ${summary.metrics.sevenDayAverageScore ?? "--"}
- 振り返りヒント:
${summary.patternHints.map((hint) => `  - ${hint}`).join("\n")}

グルコとして、そばにいる小さなともだちのように書いてください。`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function handleChatGptCopy() {
  if (!latestAiLetterSummary) {
    updateAiLetterControls("aiSummaryUnavailable", "error");
    return;
  }

  try {
    await copyTextToClipboard(buildChatGptPrompt(latestAiLetterSummary, currentAiLetterMode));
    updateAiLetterControls("chatGptCopied", "success");
  } catch (error) {
    console.error(error);
    updateAiLetterControls("chatGptCopyFailed", "error");
  }
}

async function handleAiLetterRequest(mode = currentAiLetterMode, options = {}) {
  const analysisMode = normalizeAiLetterMode(mode);
  setAiLetterMode(analysisMode);

  if (!latestAiLetterSummary) {
    setAiLetterPanelStatus("aiLetterStatusWaitingForSummary", "error");
    return;
  }

  if (!isAiLetterWorkerEnabled()) {
    setAiLetterPanelStatus("aiLetterStatusLocalOnly", "error");
    return;
  }

  const cached = getCachedAiLetter(latestAiLetterSummary, analysisMode);
  if (cached) {
    showAiLetterResult(cached.text);
    setAiLetterPanelStatus("aiLetterStatusLocalCache", "success");
    updateAiLetterControls(null, "", { preserveAiStatus: true });
    forceEnableAiLetterButtonSoon();
    return;
  }

  if (!options.skipTurnstilePrep && prepareAiLetterTurnstile(analysisMode)) {
    return;
  }

  aiLetterRequestInFlight = true;
  updateAiLetterControls();
  setAiLetterPanelStatus("aiLetterButtonLoading");

  try {
    const response = await fetch(getAiLetterWorkerEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: latestAiLetterSummary,
        analysisMode,
        turnstileToken: getTurnstileTokenForAiLetter(),
        client: {
          app: "GlucoScope",
          mode: "worker-prototype"
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    const letterText = getAiLetterTextFromResponse(data);

    if (!response.ok || data.ok === false || !letterText) {
      const error = new Error(data.message || data.error || `Worker returned ${response.status}`);
      error.aiLetterData = data;
      throw error;
    }

    showAiLetterResult(letterText);
    saveAiLetterLocalCache(latestAiLetterSummary, data, letterText, analysisMode);
    setAiLetterPanelStatus(
      getAiLetterStatusKeyFromResponse(data),
      "success",
      getAiLetterUsageDetailFromResponse(data)
    );
  } catch (error) {
    console.error("AI letter prototype call failed", error);
    const workerMessage = error.aiLetterData?.userMessage;
    const errorStatusKey = getAiLetterErrorStatusKey(error.aiLetterData);
    const restoredFromCache = showCachedAiLetter(
      latestAiLetterSummary,
      errorStatusKey === "aiLetterStatusRateLimited"
        ? "aiLetterStatusLocalCacheAfterLimit"
        : "aiLetterStatusLocalCache",
      errorStatusKey === "aiLetterStatusRateLimited" ? "error" : "success",
      analysisMode
    );

    if (!restoredFromCache && workerMessage) {
      setAiLetterPanelMessage(workerMessage, "error");
    } else if (!restoredFromCache) {
      setAiLetterPanelStatus(errorStatusKey, "error");
    }
  } finally {
    aiLetterRequestInFlight = false;
    resetAiLetterTurnstile();
    updateAiLetterControls(null, "", { preserveAiStatus: true });
    forceEnableAiLetterButtonSoon();
  }
}

function exposeLetterControlGlobals() {
  window.glucoSetLetterPanel = () => { showAllLetterPanels(); };

  window.glucoSetAiLetterMode = (mode) => {
    setAiLetterMode(mode, { showCached: true });
  };
}

function setupLetterControlsClickHandler() {
  if (window.glucoLetterControlsClickHandlerAttached) return;
  window.glucoLetterControlsClickHandlerAttached = true;

  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest?.("[data-ai-mode-toggle]");
    if (modeButton) {
      event.preventDefault();
      event.stopPropagation();
      setAiLetterMode(modeButton.dataset.aiModeToggle, { showCached: true });
      return;
    }

    const panelButton = event.target.closest?.("[data-letter-panel-toggle]");
    if (panelButton) {
      event.preventDefault();
      event.stopPropagation();
      setLetterPanel(panelButton.dataset.letterPanelToggle);
    }
  }, true);
}

function setupAiLetterPrototype() {
  try {
    injectAiLetterLayoutStyles();
    cleanupAiLetterModeActionButtons();
    ensureAiLetterModeSwitcher();
    exposeLetterControlGlobals();
    setupLetterControlsClickHandler();
    showAllLetterPanels();
    window.setTimeout(() => safelyUpdateLetterControls(), 0);
    window.setTimeout(() => safelyUpdateLetterControls(), 50);
  } catch (error) {
    console.warn("AI letter controls setup skipped", error);
  }

  const aiButton = document.getElementById("aiLetterButton");
  if (aiButton) {
    aiButton.addEventListener("click", () => handleAiLetterRequest(currentAiLetterMode));
  }

  setupAiLetterTurnstile();
}

function setupChatGptHandoff() {
  const copyButton = document.getElementById("chatGptCopyButton");
  if (copyButton) {
    copyButton.addEventListener("click", handleChatGptCopy);
  }
}

function getRuleCommentPeriodText(periodKey = currentLivePeriod) {
  if (currentLanguage === "en") {
    if (periodKey === "today") return "today";
    if (periodKey === "yesterday") return "yesterday";
    if (periodKey === "seven") return "in this 7-day view";
    if (periodKey === "thirty") return "in this 30-day view";
    if (periodKey === "custom") return "in this selected range";
    return "in this selected range";
  }

  if (periodKey === "today") return "今日は";
  if (periodKey === "yesterday") return "昨日は";
  if (periodKey === "seven") return "この7日間は";
  if (periodKey === "thirty") return "この30日間は";
  if (periodKey === "custom") return "選んだ期間は";
  return "この期間は";
}

function makeComment(tir, tar, tbr, avg, cv, periodKey = currentLivePeriod) {
  const periodText = getRuleCommentPeriodText(periodKey);

  if (currentLanguage === "en") {
    if (Number(tir) >= 90 && Number(tbr) < 4 && Number(cv) < 30) {
      return `Gluco is here 🍀
There are many steady moments ${periodText}.
TIR is ${tir}%, and average glucose is ${avg}mg/dL.
This flow can be a gentle clue for tomorrow too.`;
    }

    if (Number(tbr) >= 4) {
      return `Gluco is here 🍀
Some lower moments are visible ${periodText}.
TBR is ${tbr}%.
When you have time, looking back at overnight or pre-meal flow may give you a gentle clue.`;
    }

    if (Number(tar) >= 20) {
      return `Gluco is here 🍀
Some higher moments are visible ${periodText}.
TAR is ${tar}%.
Post-meal or afternoon flow may hold a small clue, without blaming the numbers.`;
    }

    if (Number(cv) >= 36) {
      return `Gluco is here 🍀
The glucose flow looks a little wavy ${periodText}.
CV is ${cv}%.
You do not have to force anything; we can simply notice when the ups and downs appeared.`;
    }

    return `Gluco is here 🍀
There are steady moments ${periodText}.
TIR is ${tir}%.
Let’s keep using these numbers as small clues, not as a judgment.`;
  }

  if (Number(tir) >= 90 && Number(tbr) < 4 && Number(cv) < 30) {
    return `グルコだよ🍀
${periodText}落ち着いた時間がたくさん見えているよ。
TIRは${tir}%、平均血糖は${avg}mg/dLだったね。
この流れも、明日を少し楽にするためのやさしい手がかりになりそうだよ。`;
  }

  if (Number(tbr) >= 4) {
    return `グルコだよ🍀
${periodText}低めの時間も少し見えているよ。
TBRは${tbr}%だったね。
夜間や食前の流れを、あとでそっと振り返る手がかりにできそうだよ。`;
  }

  if (Number(tar) >= 20) {
    return `グルコだよ🍀
${periodText}高めの時間も少し見えているよ。
TARは${tar}%だったね。
食後や午後の流れをやさしく見返すと、小さなヒントが見つかるかもしれないね。`;
  }

  if (Number(cv) >= 36) {
    return `グルコだよ🍀
${periodText}血糖の動きが少し大きめに見えているよ。
CVは${cv}%だったね。
無理に整えようとしなくて大丈夫。どの時間帯に動きがあったか、一緒にそっと見てみよう。`;
  }

  return `グルコだよ🍀
${periodText}落ち着いている時間もちゃんと見えているよ。
TIRは${tir}%だったね。
血糖はあなたを責める数字じゃなくて、明日を少し楽にするための手がかりだよ。`;
}

function makeDeepComment(metrics = {}) {
  const {
    tir = "--",
    tar = "--",
    tbr = "--",
    avg = "--",
    cv = "--",
    gmi = "--",
    glucoScore = "--",
    previousScore = null,
    sevenDayAverageScore = null,
    periodKey = currentLivePeriod
  } = metrics;

  const periodText = getRuleCommentPeriodText(periodKey);
  const scoreDiff = Number.isFinite(Number(previousScore))
    ? Number(glucoScore) - Number(previousScore)
    : null;
  const scoreLine = scoreDiff === null
    ? (currentLanguage === "en" ? "Comparison score is not available yet." : "比較スコアはまだ見えていないよ。")
    : scoreDiff > 0
      ? (currentLanguage === "en" ? `GlucoScore is ${scoreDiff} higher than the comparison period.` : `GlucoScoreは比較期間より${scoreDiff}高く見えているよ。`)
      : scoreDiff < 0
        ? (currentLanguage === "en" ? `GlucoScore is ${Math.abs(scoreDiff)} softer than the comparison period.` : `GlucoScoreは比較期間より${Math.abs(scoreDiff)}控えめに見えているよ。`)
        : (currentLanguage === "en" ? "GlucoScore is about the same as the comparison period." : "GlucoScoreは比較期間と同じくらいに見えているよ。");

  if (currentLanguage === "en") {
    return `Detailed Gluco reflection 🍀
${periodText}, TIR is ${tir}%, TAR is ${tar}%, and TBR is ${tbr}%.
Average glucose is ${avg}mg/dL, CV is ${cv}%, and GMI estimate is ${gmi}%.
GlucoScore is ${glucoScore}. ${scoreLine}
Higher, lower, or wavier periods can be gentle clues to look back on later.
This is not medical advice; it is a small note to help you organize what you notice.`;
  }

  return `グルコだよ🍀
${periodText}TIRは${tir}%、TARは${tar}%、TBRは${tbr}%だったよ。
平均血糖は${avg}mg/dL、CVは${cv}%、GMI目安は${gmi}%だね。
GlucoScoreは${glucoScore}。${scoreLine}
高め・低め・ゆらぎが見えた時間は、あとでそっと見返す手がかりになりそう。
これは医療判断ではなく、気づいたことを整理するための小さなメモとして見てね。`;
}

function updateRuleCommentDisplay() {
  const comment = document.getElementById("comment");
  if (!comment) return;

  const badge = document.querySelector(".rule-letter-section .letter-section-badge");
  if (badge) {
    badge.textContent = currentAiLetterMode === "deep"
      ? t("ruleCommentDeepBadge")
      : t("ruleCommentBadge");
  }

  if (!latestRuleCommentMetrics) return;

  comment.textContent = currentAiLetterMode === "deep"
    ? makeDeepComment(latestRuleCommentMetrics)
    : makeComment(
        latestRuleCommentMetrics.tir,
        latestRuleCommentMetrics.tar,
        latestRuleCommentMetrics.tbr,
        latestRuleCommentMetrics.avg,
        latestRuleCommentMetrics.cv,
        latestRuleCommentMetrics.periodKey
      );
}


function getEntryTime(entry) {
  if (entry.date) return Number(entry.date);
  if (entry.dateString) return new Date(entry.dateString).getTime();
  if (entry.created_at) return new Date(entry.created_at).getTime();
  return NaN;
}

function getTreatmentTime(treatment) {
  if (treatment.mills) return Number(treatment.mills);
  if (treatment.date) return Number(treatment.date);
  if (treatment.created_at) return new Date(treatment.created_at).getTime();
  if (treatment.timestamp) return new Date(treatment.timestamp).getTime();
  return NaN;
}

function getTreatmentSearchText(treatment) {
  return [
    treatment.eventType,
    treatment.event_type,
    treatment.type,
    treatment.enteredBy,
    treatment.createdBy,
    treatment.notes,
    treatment.reason,
    treatment.pumpType,
    treatment.programmed,
    treatment.bolusType
  ].filter(Boolean).join(" ").toLowerCase();
}

function getTreatmentCategory(treatment) {
  const text = getTreatmentSearchText(treatment);
  const carbs = Number(treatment.carbs);
  const insulin = Number(treatment.insulin);

  if (text.includes("auto bolus")
    || text.includes("autobolus")
    || text.includes("auto correction")
    || text.includes("autocorrection")
    || text.includes("auto-correction")
    || text.includes("microbolus")
    || text.includes("smb")
    || text.includes("smartguard")
    || text.includes("780g")
    || text.includes("correction")
    || text.includes("補正")) {
    return "correctionBolus";
  }

  if (text.includes("meal") || text.includes("carb") || text.includes("food") || text.includes("食事") || carbs > 0) {
    return "mealBolus";
  }

  if (text.includes("bolus") || insulin > 0) {
    return "mealBolus";
  }

  return "otherEvent";
}

function isRelevantTreatment(treatment) {
  return getTreatmentCategory(treatment) !== "otherEvent";
}

function normalizeEntriesForChart(entries, rangeStart, shiftMs = 0) {
  return [...entries]
    .map((entry) => {
      const time = getEntryTime(entry);
      return {
        x: (time + shiftMs - rangeStart) / 60000,
        y: Number(entry.sgv),
        rawTime: time
      };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x);
}


function getChartGapThresholdMinutes(periodKey, rangeDurationMs, bucketMinutes = 0) {
  if (bucketMinutes && bucketMinutes > 0) return Math.max(bucketMinutes * 2.5, 90);

  const oneDayMs = 24 * 60 * 60 * 1000;
  if (periodKey === "today" || periodKey === "yesterday" || rangeDurationMs <= 36 * 60 * 60 * 1000) {
    return 45;
  }

  if (rangeDurationMs <= 8 * oneDayMs) return 120;
  return 360;
}

function insertChartGaps(points, maxGapMinutes) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(maxGapMinutes)) return points;

  const withGaps = [];

  points.forEach((point, index) => {
    if (index > 0) {
      const previousPoint = points[index - 1];
      const gapMinutes = point.x - previousPoint.x;

      if (Number.isFinite(gapMinutes) && gapMinutes > maxGapMinutes) {
        withGaps.push({
          x: previousPoint.x + gapMinutes / 2,
          y: null,
          isGap: true
        });
      }
    }

    withGaps.push(point);
  });

  return withGaps;
}

function getChartBucketMinutes(periodKey, rangeDurationMs) {
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (periodKey === "seven") return 30;
  if (periodKey === "thirty") return 180;
  if (rangeDurationMs > 21 * oneDayMs) return 180;
  if (rangeDurationMs > 8 * oneDayMs) return 60;
  if (rangeDurationMs > 36 * 60 * 60 * 1000) return 30;
  return 0;
}

function aggregateChartPoints(points, bucketMinutes = 0) {
  if (!bucketMinutes || bucketMinutes <= 0) return points;

  const buckets = new Map();

  points.forEach((point) => {
    const bucketIndex = Math.floor(point.x / bucketMinutes);
    const bucket = buckets.get(bucketIndex) || { sum: 0, count: 0, rawTime: point.rawTime };
    bucket.sum += point.y;
    bucket.count += 1;
    bucket.rawTime = point.rawTime;
    buckets.set(bucketIndex, bucket);
  });

  return [...buckets.entries()]
    .map(([bucketIndex, bucket]) => ({
      x: (bucketIndex * bucketMinutes) + (bucketMinutes / 2),
      y: Math.round(bucket.sum / bucket.count),
      rawTime: bucket.rawTime
    }))
    .sort((a, b) => a.x - b.x);
}

function shouldShowTreatmentEvents(periodKey, rangeDurationMs) {
  return periodKey === "today"
    || periodKey === "yesterday"
    || rangeDurationMs <= 2 * 24 * 60 * 60 * 1000;
}

function minutesToLabel(rangeStart, minutes, rangeDurationMs = 24 * 60 * 60 * 1000) {
  const locale = currentLanguage === "en" ? "en-US" : "ja-JP";
  const date = new Date(rangeStart + minutes * 60000);

  if (rangeDurationMs <= 36 * 60 * 60 * 1000) {
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (rangeDurationMs <= 8 * 24 * 60 * 60 * 1000) {
    return date.toLocaleString(locale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit"
    });
  }

  return date.toLocaleDateString(locale, {
    month: "numeric",
    day: "numeric"
  });
}

function getGlucoseSegmentColor(startValue, endValue) {
  if (startValue === null || endValue === null
    || !Number.isFinite(Number(startValue))
    || !Number.isFinite(Number(endValue))) {
    return "rgba(56,189,248,0)";
  }

  const start = Number(startValue);
  const end = Number(endValue);
  if (start < 70 || end < 70) return "#fb7185";
  if (start > 180 || end > 180) return "#f59e0b";
  return "#38bdf8";
}

function findNearestGlucoseValue(points, xValue) {
  if (!points.length) return null;

  let nearest = points[0];
  let nearestDistance = Math.abs(points[0].x - xValue);

  points.forEach((point) => {
    const distance = Math.abs(point.x - xValue);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });

  if (nearestDistance > 45) return null;
  return nearest.y;
}

function normalizeTreatmentEvents(treatments, todayPoints, rangeStart, rangeEnd) {
  return treatments
    .filter(isRelevantTreatment)
    .map((treatment) => {
      const time = getTreatmentTime(treatment);
      const x = (time - rangeStart) / 60000;
      const y = findNearestGlucoseValue(todayPoints, x);
      const eventCategory = getTreatmentCategory(treatment);
      const fallbackLabel = eventCategory === "correctionBolus" ? t("correctionBolusLabel") : t("mealBolusLabel");
      return {
        x,
        y: y ?? 70,
        eventType: treatment.eventType || treatment.event_type || fallbackLabel,
        eventCategory,
        insulin: treatment.insulin,
        carbs: treatment.carbs,
        rawTime: time
      };
    })
    .filter((point) => Number.isFinite(point.x) && point.x >= 0 && point.x <= ((rangeEnd - rangeStart) / 60000));
}

const glucoseRangeBackgroundPlugin = {
  id: "glucoseRangeBackground",
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const yScale = scales.y;
    if (!chartArea || !yScale) return;

    const drawBand = (fromValue, toValue, color) => {
      const y1 = yScale.getPixelForValue(fromValue);
      const y2 = yScale.getPixelForValue(toValue);
      const top = Math.min(y1, y2);
      const height = Math.abs(y2 - y1);

      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, height);
      ctx.restore();
    };

    drawBand(yScale.max, 180, "rgba(245,158,11,.075)");
    drawBand(180, 70, "rgba(46,204,113,.105)");
    drawBand(70, yScale.min, "rgba(251,113,133,.085)");
  }
};

function drawGlucoseChart(entries, options = {}) {
  const canvas = document.getElementById("glucoseChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const rangeStart = options.rangeStart ?? Date.now() - 24 * 60 * 60 * 1000;
  const rangeEnd = options.rangeEnd ?? Date.now();
  const rangeDurationMs = Math.max(rangeEnd - rangeStart, 60 * 60000);
  const rangeMinutes = Math.max(1, Math.floor(rangeDurationMs / 60000));

  const chartBucketMinutes = getChartBucketMinutes(options.periodKey, rangeDurationMs);
  const rawTodayPoints = normalizeEntriesForChart(entries, rangeStart);
  const gapThresholdMinutes = getChartGapThresholdMinutes(options.periodKey, rangeDurationMs, chartBucketMinutes);
  const todayPoints = insertChartGaps(
    aggregateChartPoints(rawTodayPoints, chartBucketMinutes),
    gapThresholdMinutes
  );
  const comparisonPoints = insertChartGaps(
    aggregateChartPoints(
      normalizeEntriesForChart(options.comparisonEntries || [], rangeStart, rangeDurationMs),
      chartBucketMinutes
    ),
    gapThresholdMinutes
  );
  const showTreatmentEvents = shouldShowTreatmentEvents(options.periodKey, rangeDurationMs);
  const treatmentPoints = showTreatmentEvents
    ? normalizeTreatmentEvents(options.treatmentEvents || [], rawTodayPoints, rangeStart, rangeEnd)
    : [];
  const mealBolusPoints = treatmentPoints.filter((point) => point.eventCategory === "mealBolus");
  const correctionBolusPoints = treatmentPoints.filter((point) => point.eventCategory === "correctionBolus");
  const showComparison = comparisonPoints.length > 0;

  const comparisonLegendItem = document.getElementById("comparisonLegendItem");
  if (comparisonLegendItem) comparisonLegendItem.hidden = !showComparison;

  const manualBolusLegendItem = document.getElementById("manualBolusLegendItem");
  const autoBolusLegendItem = document.getElementById("autoBolusLegendItem");
  if (manualBolusLegendItem) manualBolusLegendItem.hidden = !showTreatmentEvents;
  if (autoBolusLegendItem) autoBolusLegendItem.hidden = !showTreatmentEvents;

  if (glucoseChart) glucoseChart.destroy();

  const datasets = [];

  if (showComparison) {
    datasets.push({
      label: options.comparisonLabel || t("yesterdayLabel"),
      data: comparisonPoints,
      borderWidth: 2,
      borderColor: "rgba(203,213,225,.42)",
      pointRadius: 0,
      tension: 0.35,
      spanGaps: false,
      order: 1
    });
  }

  datasets.push({
    label: options.primaryLabel || t("glucoseLabel"),
    data: todayPoints,
    borderWidth: 3,
    borderColor: "#38bdf8",
    pointRadius: 0,
    tension: chartBucketMinutes ? 0.42 : 0.35,
    spanGaps: false,
    segment: {
      borderColor: (context) => getGlucoseSegmentColor(context.p0.parsed.y, context.p1.parsed.y)
    },
    order: 0
  });

  if (showTreatmentEvents) {
    datasets.push(
      {
        label: t("mealBolusLabel"),
        type: "scatter",
        data: mealBolusPoints,
        showLine: false,
        borderWidth: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#fbbf24",
        pointBorderColor: "rgba(15,23,42,.82)",
        pointBorderWidth: 2,
        order: -1
      },
      {
        label: t("correctionBolusLabel"),
        type: "scatter",
        data: correctionBolusPoints,
        showLine: false,
        borderWidth: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#a78bfa",
        pointBorderColor: "rgba(15,23,42,.82)",
        pointBorderWidth: 2,
        order: -1
      }
    );
  }

  datasets.push(
    {
      label: t("lowLineLabel"),
      data: [{ x: 0, y: 70 }, { x: rangeMinutes, y: 70 }],
      borderWidth: 1,
      borderColor: "rgba(251,113,133,.72)",
      borderDash: [6, 6],
      pointRadius: 0,
      order: 2
    },
    {
      label: t("highLineLabel"),
      data: [{ x: 0, y: 180 }, { x: rangeMinutes, y: 180 }],
      borderWidth: 1,
      borderColor: "rgba(245,158,11,.78)",
      borderDash: [6, 6],
      pointRadius: 0,
      order: 2
    }
  );

  const isMobileChart = window.matchMedia && window.matchMedia("(max-width: 720px), (max-width: 960px) and (orientation: landscape) and (hover: none) and (pointer: coarse)").matches;

  glucoseChart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          titleFont: { size: isMobileChart ? 14 : 12, weight: "700" },
          bodyFont: { size: isMobileChart ? 14 : 12 },
          padding: isMobileChart ? 12 : 10,
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              return minutesToLabel(rangeStart, items[0].parsed.x, rangeDurationMs);
            },
            label: (context) => {
              const point = context.raw || {};

              if (context.dataset.label === t("mealBolusLabel") || context.dataset.label === t("correctionBolusLabel")) {
                const pieces = [context.dataset.label];
                if (point.eventType) pieces.push(String(point.eventType));
                if (point.carbs) pieces.push(`${point.carbs}g carbs`);
                if (point.insulin) pieces.push(`${point.insulin}U`);
                return pieces.join(" / ");
              }

              if (point.isGap || context.parsed.y === null) {
                return currentLanguage === "en" ? "Data gap" : "データなし";
              }

              return `${context.dataset.label}: ${context.parsed.y} mg/dL`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: rangeMinutes,
          grid: {
            color: "rgba(148,163,184,.10)"
          },
          ticks: {
            maxTicksLimit: isMobileChart ? (options.periodKey === "thirty" ? 4 : 5) : (options.periodKey === "thirty" ? 7 : 8),
            font: { size: isMobileChart ? 12 : 11, weight: isMobileChart ? "600" : "400" },
            callback: (value) => minutesToLabel(rangeStart, Number(value), rangeDurationMs)
          }
        },
        y: {
          min: 40,
          max: 250,
          grid: {
            color: "rgba(148,163,184,.10)"
          },
          ticks: {
            font: { size: isMobileChart ? 12 : 11, weight: isMobileChart ? "600" : "400" }
          }
        }
      }
    },
    plugins: [glucoseRangeBackgroundPlugin]
  });
}

function normalizeBatteryPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < 0) return null;
  if (number <= 1) return Math.round(number * 100);
  if (number <= 100) return Math.round(number);
  return null;
}

function extractBatteryPercent(latestEntry, deviceStatus) {
  const status = Array.isArray(deviceStatus) ? deviceStatus[0] : deviceStatus;
  const candidates = [
    latestEntry?.uploaderBattery,
    latestEntry?.battery,
    latestEntry?.pumpBattery,
    status?.uploaderBattery,
    status?.battery,
    status?.pump?.battery?.percent,
    status?.pump?.battery?.value,
    status?.pump?.battery,
    status?.openaps?.battery,
    status?.openaps?.iob?.battery
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBatteryPercent(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
}

function firstFiniteNumber(candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function firstValidDate(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function formatRemainingDuration(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return null;

  const roundedMinutes = Math.round(totalMinutes);
  const days = Math.floor(roundedMinutes / (60 * 24));
  const hours = Math.floor((roundedMinutes % (60 * 24)) / 60);
  const minutes = roundedMinutes % 60;

  if (currentLanguage === "en") {
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  }

  if (days > 0) return hours > 0 ? `${days}日${hours}時間` : `${days}日`;
  if (hours > 0) return `${hours}時間`;
  return `${minutes}分`;
}

function extractSensorRemaining(deviceStatus) {
  const status = Array.isArray(deviceStatus) ? deviceStatus[0] : deviceStatus;
  if (!status) return null;

  const explicitHours = firstFiniteNumber([
    status.sensorHoursRemaining,
    status.sensorRemainingHours,
    status.sensor?.hoursRemaining,
    status.sensor?.remainingHours,
    status.pump?.sensor?.hoursRemaining,
    status.pump?.sensor?.remainingHours
  ]);
  if (explicitHours !== null) return formatRemainingDuration(explicitHours * 60);

  const explicitDays = firstFiniteNumber([
    status.sensorDaysRemaining,
    status.sensorRemainingDays,
    status.sensor?.daysRemaining,
    status.sensor?.remainingDays,
    status.pump?.sensor?.daysRemaining,
    status.pump?.sensor?.remainingDays
  ]);
  if (explicitDays !== null) return formatRemainingDuration(explicitDays * 24 * 60);

  const expiryDate = firstValidDate([
    status.sensorExpiresAt,
    status.sensorExpiry,
    status.sensorExpireAt,
    status.sensor?.expiresAt,
    status.sensor?.expires_at,
    status.sensor?.expiry,
    status.pump?.sensor?.expiresAt,
    status.pump?.sensor?.expires_at,
    status.pump?.sensor?.expiry
  ]);
  if (expiryDate) return formatRemainingDuration((expiryDate.getTime() - Date.now()) / 60000);

  return null;
}

function extractPumpReservoir(deviceStatus) {
  const status = Array.isArray(deviceStatus) ? deviceStatus[0] : deviceStatus;
  if (!status) return null;

  const reservoir = firstFiniteNumber([
    status.pump?.reservoir,
    status.pump?.reservoirAmount,
    status.pump?.reservoir_remaining,
    status.pump?.remainingInsulin,
    status.reservoir,
    status.reservoirAmount,
    status.openaps?.pump?.reservoir,
    status.openaps?.suggested?.reservoir
  ]);

  if (reservoir === null) return null;
  return Number.isInteger(reservoir) ? `${reservoir}U` : `${reservoir.toFixed(1)}U`;
}

function extractIob(deviceStatus) {
  const status = Array.isArray(deviceStatus) ? deviceStatus[0] : deviceStatus;
  if (!status) return null;

  const iob = firstFiniteNumber([
    status.openaps?.iob?.iob,
    status.openaps?.suggested?.iob,
    status.iob,
    status.pump?.iob,
    status.pump?.activeInsulin,
    status.activeInsulin,
    status.bolus?.iob
  ]);

  if (iob === null) return null;
  return `${iob.toFixed(1)}U`;
}

function setHealthItem(element, text, statusClass, title = "") {
  if (!element) return;

  element.classList.remove("health-online", "health-stale", "health-error", "health-muted");
  if (statusClass) element.classList.add(statusClass);
  element.textContent = text;
  element.title = title || text;
  element.setAttribute("aria-label", title || text);
}

function updateHealthBar(latestEntry = null, deviceStatus = null, connectionState = "waiting") {
  const batteryEl = document.getElementById("batteryStatus");
  const cloudEl = document.getElementById("cloudStatus");

  const batteryPercent = extractBatteryPercent(latestEntry, deviceStatus);
  if (batteryPercent === null) {
    setHealthItem(
      batteryEl,
      t("batteryUnavailable"),
      "health-muted",
      currentLanguage === "en" ? "Pump battery" : "ポンプ電池"
    );
  } else {
    const statusClass = batteryPercent <= 20 ? "health-stale" : "health-online";
    setHealthItem(
      batteryEl,
      `🔋 ${batteryPercent}%`,
      statusClass,
      currentLanguage === "en" ? `Pump battery: ${batteryPercent}%` : `ポンプ電池: ${batteryPercent}%`
    );
  }

  if (connectionState === "error") {
    setHealthItem(cloudEl, t("cloudError"), "health-error", currentLanguage === "en" ? "NightScout connection status" : "NightScout接続状況");
  } else if (connectionState === "connected") {
    setHealthItem(cloudEl, t("cloudConnected"), "health-online", currentLanguage === "en" ? "NightScout connection status" : "NightScout接続状況");
  } else {
    setHealthItem(cloudEl, t("cloudWaiting"), "health-muted", currentLanguage === "en" ? "NightScout connection status" : "NightScout接続状況");
  }
}

async function loadDeviceStatus() {
  return fetchJson(`${NIGHTSCOUT_URL}/api/v1/devicestatus.json?count=1`, []);
}

async function fetchEntriesInRange(rangeStart, rangeEnd, count = 1000) {
  return fetchJson(`${NIGHTSCOUT_URL}/api/v1/entries/sgv.json?find[date][$gte]=${Math.round(rangeStart)}&find[date][$lte]=${Math.round(rangeEnd)}&count=${count}`, []);
}

async function fetchJson(url, fallback = []) {
  const response = await fetch(url);
  if (!response.ok) return fallback;
  return response.json();
}

async function loadLatestGlucose() {
  const glucoseValue = document.getElementById("glucoseValue");
  const glucoseArrow = document.getElementById("glucoseArrow");
  const status = document.getElementById("status");
  const lastUpdate = document.getElementById("lastUpdate");
  const response = await fetch(`${NIGHTSCOUT_URL}/api/v1/entries.json?count=2`);
  if (!response.ok) throw new Error(`Latest glucose request failed: ${response.status}`);

  const data = await response.json();

  if (!data || data.length === 0) {
    if (status) status.textContent = t("latestNoData");
    updateCurrentGlucoseColor(null);
    updateGlucoseDelta(null, null);
    setLiveStatus("error", "NO DATA", t("noDataDetail"));
    updateHeaderUpdated(null);
    updateHealthBar(null, null, "waiting");
    return null;
  }

  const latest = data[0];
  const previous = data[1];

  if (glucoseValue) glucoseValue.textContent = latest.sgv ?? "--";
  if (glucoseArrow) glucoseArrow.textContent = directionMap[latest.direction] ?? "→";
  updateRangeStatus(Number(latest.sgv));
  updateGlucoseDelta(latest.sgv, previous?.sgv);

  const measuredAt = new Date(latest.date);
  updateHeaderUpdated(measuredAt);
  const now = new Date();
  const minutesAgo = Math.round((now - measuredAt) / 60000);

  if (status) {
    status.textContent = currentLanguage === "en"
      ? `${minutesAgo} ${t("updatedMinutesAgo")} / ${latest.direction ?? t("latestUnknown")}`
      : `${minutesAgo}${t("updatedMinutesAgo")} / ${latest.direction ?? t("latestUnknown")}`;
  }

  if (lastUpdate) {
    lastUpdate.textContent = `${t("lastUpdatedLabel")}: ${formatDateTime(measuredAt)}`;
  }

  if (minutesAgo >= 30) {
    setLiveStatus("stale", "STALE", currentLanguage === "en" ? `Last data is ${minutesAgo} minutes old` : `最終データは${minutesAgo}分前です`);
  } else {
    setLiveStatus("online", "LIVE", currentLanguage === "en" ? `Nightscout connected / ${minutesAgo} min ago` : `Nightscout接続中 / ${minutesAgo}分前に更新`);
  }

  const currentLastUpdate = document.getElementById("currentLastUpdate");
  if (currentLastUpdate) {
    currentLastUpdate.textContent = measuredAt.toLocaleTimeString(currentLanguage === "en" ? "en-US" : "ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const graphLastUpdateValue = document.getElementById("graphLastUpdateValue");
  if (graphLastUpdateValue) {
    graphLastUpdateValue.textContent = formatDateTime(measuredAt);
  }

  return latest;
}

async function loadTreatmentEvents(rangeStart, rangeEnd) {
  const startIso = encodeURIComponent(new Date(rangeStart).toISOString());
  const url = `${NIGHTSCOUT_URL}/api/v1/treatments.json?find[created_at][$gte]=${startIso}&count=1000`;
  const treatments = await fetchJson(url, []);

  if (!Array.isArray(treatments)) return [];

  return treatments.filter((treatment) => {
    const time = getTreatmentTime(treatment);
    return Number.isFinite(time) && time >= rangeStart && time <= rangeEnd;
  });
}

function updateChartRangeLabel(rangeStart, rangeEnd) {
  const chartRange = document.getElementById("chartRange");
  if (!chartRange) return;
  chartRange.textContent = `${formatDateTime(new Date(rangeStart))} ${t("chartRangeSeparator")} ${formatDateTime(new Date(rangeEnd))}`;
}

function updateDisplayedMetrics({ tir, tar, tbr, avg, cv, gmi }) {
  document.getElementById("tirValue").textContent = `${tir}%`;
  document.getElementById("tarValue").textContent = `${tar}%`;
  document.getElementById("tbrValue").textContent = `${tbr}%`;
  document.getElementById("avgValue").textContent = avg;
  document.getElementById("cvValue").textContent = `${cv}%`;
  document.getElementById("gmiValue").textContent = `${gmi}%`;
}

async function loadDailyStats() {
  try {
    const latest = await loadLatestGlucose();
    const deviceStatus = await loadDeviceStatus().catch(() => []);
    updateHealthBar(latest, deviceStatus, latest ? "connected" : "waiting");

    const now = Date.now();
    const periodRange = getLivePeriodRange(currentLivePeriod, now);
    const { rangeStart, rangeEnd, durationMs } = periodRange;
    const { previousRangeStart, previousRangeEnd } = getPreviousLivePeriodRange(periodRange);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const showTodayComparison = currentLivePeriod === "today";
    const showTreatmentsForRange = shouldShowTreatmentEvents(currentLivePeriod, durationMs);

    updatePeriodButtons();
    updateChartRangeLabel(rangeStart, rangeEnd);

    const [entriesRaw, previousEntriesRaw, sevenDayEntriesRaw, treatmentsRaw] = await Promise.all([
      fetchEntriesInRange(rangeStart, rangeEnd, periodRange.count),
      fetchEntriesInRange(previousRangeStart, previousRangeEnd, Math.min(periodRange.count, 3000)),
      fetchEntriesInRange(sevenDaysAgo, now, 3000),
      showTreatmentsForRange ? loadTreatmentEvents(rangeStart, rangeEnd) : Promise.resolve([])
    ]);

    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const previousEntries = Array.isArray(previousEntriesRaw) ? previousEntriesRaw : [];
    const sevenDayEntries = Array.isArray(sevenDayEntriesRaw) ? sevenDayEntriesRaw : [];
    const treatments = Array.isArray(treatmentsRaw) ? treatmentsRaw : [];

    drawGlucoseChart(entries, {
      comparisonEntries: showTodayComparison ? previousEntries : [],
      comparisonLabel: t("yesterdayLabel"),
      primaryLabel: t("glucoseLabel"),
      treatmentEvents: treatments,
      rangeStart,
      rangeEnd,
      periodKey: currentLivePeriod
    });

    const values = getSgvValuesInRange(entries, rangeStart, rangeEnd);

    if (values.length === 0) {
      latestRuleCommentMetrics = null;
      document.getElementById("comment").textContent = t("noDailyData");
      setAiLetterSummary(null);
      updateScoreMetaDisplay(null, null, null, currentLivePeriod);
      return;
    }

    const inRange = values.filter(v => v >= 70 && v <= 180).length;
    const aboveRange = values.filter(v => v > 180).length;
    const belowRange = values.filter(v => v < 70).length;

    const tir = pct(inRange, values.length);
    const tar = pct(aboveRange, values.length);
    const tbr = pct(belowRange, values.length);

    const avg = Math.round(average(values));
    const sd = standardDeviation(values);
    const cv = avg > 0 ? ((sd / avg) * 100).toFixed(1) : "0.0";
    const gmi = calculateGMI(avg).toFixed(1);

    const glucoScore = calculateGlucoScore({
      tir,
      tbr,
      cv,
      avg
    });

    document.getElementById("scoreValue").textContent = `${glucoScore.score}`;
    document.getElementById("scoreReason").textContent =
     `${glucoScore.rank} ${glucoScore.emoji}`;
    updateScoreGlucoImage(glucoScore.score);

    const previousScore = calculateGlucoScoreForEntries(previousEntries, previousRangeStart, previousRangeEnd);
    const sevenDayAverageScore = calculateSevenDayAverageGlucoScore(sevenDayEntries, now);
    updateScoreMetaDisplay(glucoScore.score, previousScore, sevenDayAverageScore, currentLivePeriod);

    if (currentLivePeriod === "today") {
      setDailyLetterGlucoImage({
        score: glucoScore.score,
        tir,
        yesterdayScore: previousScore
      });
    } else {
      renderStoredDailyLetterGlucoImage();
    }

    const scoreMessage = document.querySelector(".score-message");
    if (scoreMessage) {
      renderScoreMessage(scoreMessage, getLocalizedScoreMessage(glucoScore.score, glucoScore.message));
    }

    updateDisplayedMetrics({ tir, tar, tbr, avg, cv, gmi });

    setAiLetterSummary(buildAiLetterSummary({
      periodKey: currentLivePeriod,
      rangeStart,
      rangeEnd,
      latest,
      entries,
      tir,
      tar,
      tbr,
      avg,
      cv,
      gmi,
      glucoScore: glucoScore.score,
      previousScore,
      sevenDayAverageScore
    }));

    latestRuleCommentMetrics = {
      tir,
      tar,
      tbr,
      avg,
      cv,
      gmi,
      glucoScore: glucoScore.score,
      previousScore,
      sevenDayAverageScore,
      periodKey: currentLivePeriod
    };
    updateRuleCommentDisplay();

  } catch (error) {
    console.error(error);
    setLiveStatus("error", "OFFLINE", t("statusError"));
    updateHealthBar(null, null, "error");
    updateHeaderUpdated(null);
    document.getElementById("status").textContent = t("statusError");
    updateCurrentGlucoseColor(null);
    updateGlucoseDelta(null, null);
    updateScoreMetaDisplay(null, null, null, currentLivePeriod);
    setAiLetterSummary(null);
    latestRuleCommentMetrics = null;
    document.getElementById("comment").textContent = t("commentLoadingError");
  }
}

function updateClock() {
  const now = new Date();

  const clockEl = document.getElementById("clock");
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString(currentLanguage === "en" ? "en-US" : "ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const dateEl = document.getElementById("headerDate");
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(currentLanguage === "en" ? "en-US" : "ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    });
  }
}

function getCollectionAchievement(collectedCount) {
  const achievements = [
    { count: 70, ja: "グルコの大切な人（70枚達成！）", en: "Gluco's special person (70 collected!)" },
    { count: 50, ja: "グルコの心の友（50枚達成！）", en: "Gluco's heart friend (50 collected!)" },
    { count: 30, ja: "グルコと親友（30枚達成！）", en: "Best friends with Gluco (30 collected!)" },
    { count: 10, ja: "グルコと仲良し（10枚達成！）", en: "Close with Gluco (10 collected!)" },
    { count: 1, ja: "グルコのともだち", en: "Gluco friend" },
    { count: 0, ja: "はじめの一歩", en: "First step" }
  ];

  return achievements.find((achievement) => collectedCount >= achievement.count) || achievements[achievements.length - 1];
}

function getLocalizedAchievementTitle(achievement) {
  return currentLanguage === "en" ? achievement.en : achievement.ja;
}

async function shareCollectionAchievement() {
  const collection = readGlucoCollection();
  const collectedCount = Object.keys(collection).length;
  const achievement = getCollectionAchievement(collectedCount);
  const title = getLocalizedAchievementTitle(achievement);
  const shareText = t("shareText")
    .replace("{count}", collectedCount)
    .replace("{title}", title);

  if (navigator.share) {
    try {
      await navigator.share({ text: shareText });
      return;
    } catch (error) {
      // User cancelled sharing; fall back to copy below if possible.
    }
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(shareText);
    const button = document.getElementById("collectionShareButton");
    if (button) {
      const originalText = button.textContent;
      button.textContent = t("shareCopied");
      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1600);
    }
  }
}

function renderCollectionView() {
  const grid = document.getElementById("collectionGrid");
  const progress = document.getElementById("collectionProgress");
  const achievementEl = document.getElementById("collectionAchievement");
  const shareButton = document.getElementById("collectionShareButton");
  const today = document.getElementById("collectionToday");

  if (!grid) return;

  const collection = readGlucoCollection();
  const collectedCount = Object.keys(collection).length;

  if (progress) {
    progress.textContent = `${collectedCount} / ${dailyLetterGlucoImages.length}`;
    progress.title = `${t("collectionProgress")}: ${collectedCount} / ${dailyLetterGlucoImages.length}`;
  }

  const achievement = getCollectionAchievement(collectedCount);
  const achievementTitle = getLocalizedAchievementTitle(achievement);

  if (achievementEl) {
    achievementEl.textContent = `${t("achievementLabel")}: ${achievementTitle}`;
  }

  if (shareButton) {
    shareButton.textContent = t("shareAchievement");
  }

  if (today) {
    today.textContent = t("collectionToday");
  }

  grid.replaceChildren();

  glucoLiveItems.forEach((glucoItem) => {
    const imagePath = glucoItem.image;
    const number = glucoItem.id;
    const imageId = `gluco-live-${String(number).padStart(2, "0")}`;
    const item = document.createElement("div");
    const collected = collection[imageId];

    const isLucky = isLuckyGlucoItem(glucoItem);
    item.className = `collection-item ${collected ? "collected" : "locked"} ${isLucky ? "lucky-gluco" : "normal-gluco"}`;

    const imageBox = document.createElement("div");
    imageBox.className = collected ? "collection-image-wrap" : "collection-locked";

    if (collected) {
      const img = document.createElement("img");
      img.src = imagePath;
      img.alt = `Gluco ${formatGlucoLiveNumber(number)}`;
      imageBox.appendChild(img);
    } else {
      imageBox.textContent = "?";
      imageBox.setAttribute("aria-label", t("collectionLocked"));
    }

    const numberEl = document.createElement("div");
    numberEl.className = "collection-number";
    numberEl.textContent = formatGlucoLiveTitle(number);

    const luckyBadge = document.createElement("div");
    luckyBadge.className = "collection-lucky-badge";
    luckyBadge.textContent = t("luckyGlucoBadge");

    const meta = document.createElement("div");
    meta.className = "collection-meta";

    if (collected) {
      const firstSeen = collected.firstSeenDate || "--";
      const firstSeenLine = document.createElement("span");
      firstSeenLine.textContent = `${t("collectionFirstSeen")}: ${firstSeen}`;
      const countLine = document.createElement("span");
      countLine.textContent = formatEncounterLabel(collected.encounterCount);
      meta.replaceChildren(firstSeenLine, countLine);
    } else {
      meta.textContent = t("collectionLocked");
    }

    item.appendChild(imageBox);
    item.appendChild(numberEl);
    if (isLucky) item.appendChild(luckyBadge);
    item.appendChild(meta);
    grid.appendChild(item);
  });
}

function setupCollectionShareButton() {
  const shareButton = document.getElementById("collectionShareButton");
  if (!shareButton) return;
  shareButton.addEventListener("click", () => {
    shareCollectionAchievement().catch((error) => console.warn("Share failed", error));
  });
}

function openDatePicker(input) {
  if (!input) return;

  try {
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
  } catch (error) {
    // Some browsers restrict showPicker; focus/click keeps the control usable.
  }

  input.focus();
  input.click();
}

function setupDatePickerButtons() {
  document.querySelectorAll(".date-input-icon[data-date-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.dateTarget;
      const input = targetId ? document.getElementById(targetId) : null;
      openDatePicker(input);
    });
  });
}


function copyTextContent(targetId, sourceSelector, fallback = "--") {
  const target = document.getElementById(targetId);
  const source = document.querySelector(sourceSelector);
  if (!target) return;

  const text = source?.textContent?.trim() || fallback;
  target.textContent = text;
}

function copyHtmlContent(targetId, sourceSelector, fallback = "--") {
  const target = document.getElementById(targetId);
  const source = document.querySelector(sourceSelector);
  if (!target) return;

  const html = source?.innerHTML?.trim();
  if (html) {
    target.innerHTML = html;
  } else {
    target.textContent = fallback;
  }
}

function parseMetricPercentage(selector) {
  const value = Number.parseFloat(document.querySelector(selector)?.textContent || "");
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function syncMobileRangeSummary() {
  const tir = parseMetricPercentage("#tirValue");
  const tar = parseMetricPercentage("#tarValue");
  const tbr = parseMetricPercentage("#tbrValue");
  const donut = document.getElementById("mobileRangeDonut");

  if (donut) {
    donut.style.setProperty("--tir-angle", `${tir * 3.6}deg`);
    donut.style.setProperty("--tar-angle", `${Math.min(100, tir + tar) * 3.6}deg`);
    donut.setAttribute("aria-label", `TIR ${tir.toFixed(1)}%, TAR ${tar.toFixed(1)}%, TBR ${tbr.toFixed(1)}%`);
  }

  copyTextContent("mobileRangeTirValue", "#tirValue");
  copyTextContent("mobileRangeTirText", "#tirValue");
  copyTextContent("mobileRangeTarText", "#tarValue");
  copyTextContent("mobileRangeTbrText", "#tbrValue");
}

const MOBILE_DISPLAY_MODE_KEY = "glucoscope.mobileDisplayMode.v1";

function updateMobileNavState(page = "glucose") {
  const mobilePages = ["glucose", "graph", "reflection", "letter", "more"];
  const allowedPages = new Set(mobilePages);
  const resolvedPage = allowedPages.has(page) ? page : "glucose";

  mobilePages.forEach((name) => {
    document.body.classList.toggle(`mobile-page-${name}`, name === resolvedPage);
  });

  // Remove the previous Phase 1 class if it remains in a cached document.
  document.body.classList.remove("mobile-page-monitor");

  document.querySelectorAll(".mobile-bottom-nav-button[data-mobile-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mobilePage === resolvedPage);
  });

  document.body.classList.remove("mobile-secondary-view");
  syncMobileRangeSummary();
}

function activateLiveViewForMobile() {
  if (document.getElementById("liveView")?.classList.contains("active")) return;
  document.querySelector('.view-tab[data-view="live"]')?.click();
}

function setMobilePage(page = "glucose", options = {}) {
  const allowedPages = new Set(["glucose", "graph", "reflection", "letter", "more"]);
  const legacyPage = page === "monitor" ? "glucose" : page;
  const resolvedPage = allowedPages.has(legacyPage) ? legacyPage : "glucose";
  activateLiveViewForMobile();
  updateMobileNavState(resolvedPage);

  if (options.updateHash !== false) {
    window.history.replaceState(null, "", `#${resolvedPage}`);
  }

  if (resolvedPage === "graph") {
    window.requestAnimationFrame(() => glucoseChart?.resize());
    window.setTimeout(() => glucoseChart?.resize(), 180);
  }

  window.scrollTo({ top: 0, behavior: options.smooth ? "smooth" : "auto" });
}

function syncMobileApp() {
  syncMobileRangeSummary();
}

function setupMobileDisplayMode() {
  const desktopButton = document.getElementById("mobileDesktopViewButton");
  const returnButton = document.getElementById("mobileViewReturnButton");
  const isForcedDesktop = document.documentElement.classList.contains("force-desktop-view");

  if (returnButton) {
    returnButton.hidden = !isForcedDesktop;
    returnButton.addEventListener("click", () => {
      try {
        localStorage.setItem(MOBILE_DISPLAY_MODE_KEY, "mobile");
      } catch (error) {
        console.warn("Could not save mobile display mode", error);
      }
      window.location.href = `${window.location.pathname}?display=mobile#more`;
    });
  }

  desktopButton?.addEventListener("click", () => {
    try {
      localStorage.setItem(MOBILE_DISPLAY_MODE_KEY, "desktop");
    } catch (error) {
      console.warn("Could not save desktop display mode", error);
    }
    window.location.href = `${window.location.pathname}?display=desktop#live`;
  });
}

function setupMobileApp() {
  // In forced desktop mode the early head script widened the viewport, so the
  // existing desktop dashboard is used without mobile page switching.
  if (document.documentElement.classList.contains("force-desktop-view")) {
    return;
  }

  document.querySelectorAll(".mobile-bottom-nav-button[data-mobile-page]").forEach((button) => {
    button.addEventListener("click", () => {
      setMobilePage(button.dataset.mobilePage || "glucose", { smooth: true });
    });
  });

  document.querySelectorAll("[data-mobile-open-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const viewName = button.dataset.mobileOpenView;
      updateMobileNavState("more");
      document.body.classList.add("mobile-secondary-view");
      document.querySelector(`.view-tab[data-view="${viewName}"]`)?.click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  const watchTargets = ["#tirValue", "#tarValue", "#tbrValue"];
  const observer = new MutationObserver(() => syncMobileApp());
  watchTargets.forEach((selector) => {
    const node = document.querySelector(selector);
    if (node) observer.observe(node, { childList: true, characterData: true, subtree: true });
  });

  const rawHash = window.location.hash.replace("#", "");
  const hash = rawHash === "monitor" ? "glucose" : rawHash;
  const mobilePages = new Set(["glucose", "graph", "reflection", "letter", "more"]);
  const secondaryViews = new Set(["journal", "clinic", "collection", "about"]);

  if (secondaryViews.has(hash)) {
    updateMobileNavState("more");
    document.body.classList.add("mobile-secondary-view");
  } else {
    setMobilePage(mobilePages.has(hash) ? hash : "glucose", { updateHash: false });
  }

  syncMobileApp();
  window.setInterval(syncMobileApp, 2000);
}

function setupViewTabs() {
  const tabs = document.querySelectorAll(".view-tab");
  const panels = {
    live: document.getElementById("liveView"),
    journal: document.getElementById("journalView"),
    clinic: document.getElementById("clinicView"),
    about: document.getElementById("aboutView"),
    collection: document.getElementById("collectionView")
  };

  function activateView(viewName) {
    const resolvedView = panels[viewName] ? viewName : "live";

    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === resolvedView);
    });

    Object.entries(panels).forEach(([name, panel]) => {
      if (panel) panel.classList.toggle("active", name === resolvedView);
    });

    if (resolvedView === "collection") {
      renderCollectionView();
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const viewName = tab.dataset.view || "live";
      const resolvedView = panels[viewName] ? viewName : "live";
      activateView(resolvedView);
      window.location.hash = resolvedView === "live" ? "live" : resolvedView;
    });
  });

  const initialHash = window.location.hash.replace("#", "") || "live";
  const initialView = initialHash === "more" ? "about" : initialHash;
  activateView(panels[initialView] ? initialView : "live");
}

// Set up top-level navigation first so tabs keep working even if a later
// data/AI initialization step has a temporary error.
setupViewTabs();
setupLanguageSwitch();
setupMobileDisplayMode();
setupMobileApp();
setupPeriodSwitch();
setupCollectionShareButton();
applyLanguage();
updateClock();
renderStoredDailyLetterGlucoImage();
setLiveStatus("pending", "CHECKING", "Nightscoutの最新データを確認中");
updateHealthBar(null, null, "waiting");
updateAiLetterControls();
loadDailyStats();
setupDatePickerButtons();
setupChatGptHandoff();
setupAiLetterPrototype();

setInterval(updateClock, 1000);
setInterval(loadDailyStats, 60000);
