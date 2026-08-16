import { PUBLIC_DEMO_PAGE_MODE, USER_DATA_PAGE_MODE } from "./request-policy.js";

const ANALYSIS_MODES = new Set(["letter", "deep"]);

const APPROVED_DEMO_LETTERS = Object.freeze({
  ja: Object.freeze({
    letter: [
      "こんにちは、グルコだよ🍀",
      "これは公開デモのために、あらかじめ内容を確認して用意したサンプルのお手紙だよ。画面の数字は、良い・悪いを決めるものではなく、その日の流れをやさしく振り返る手がかりとして見てみてね。",
      "気になる動きがあったときは、いつものCGMアプリの記録と一緒に、無理のない範囲で見返してみよう。治療や機器の設定については、主治医や医療機関からの案内を優先してね。"
    ].join("\n\n"),
    deep: [
      "こんにちは、グルコだよ🍀",
      "これは公開デモ専用に、あらかじめ内容を確認して用意した詳しいサンプルのお手紙だよ。TIR・TAR・TBR・平均・CVなどは、点数や努力の評価ではなく、時間帯や日の違いを振り返るための手がかりとして使えるよ。",
      "グラフを見るときは、食事、活動、睡眠、体調など、その日にあった出来事と一緒に眺めると、自分なりの気づきを見つけやすいかもしれないね。数字だけで結論を急がず、治療や機器設定の判断は主治医や医療機関と相談してね。"
    ].join("\n\n")
  }),
  en: Object.freeze({
    letter: [
      "Hi, it’s Gluco 🍀",
      "This is a human-reviewed sample letter prepared for the public demo. The numbers on screen are not a judgment of good or bad; they are gentle clues for looking back at the day’s glucose pattern.",
      "If a movement catches your attention, you can look at it alongside the records in your usual CGM app when it feels comfortable. For treatment or device-setting decisions, please follow guidance from your healthcare team."
    ].join("\n\n"),
    deep: [
      "Hi, it’s Gluco 🍀",
      "This is a human-reviewed detailed sample prepared only for the public demo. TIR, TAR, TBR, average glucose, and CV are not scores or judgments of effort; they are clues for gently reviewing differences across times and days.",
      "It may help to view the graph alongside meals, activity, sleep, health, and other events from the day. There is no need to rush to a conclusion from numbers alone, and treatment or device-setting decisions should be discussed with your healthcare team."
    ].join("\n\n")
  })
});

export function classifyAiRequestAudience(summary = {}) {
  if (summary?.pageMode === PUBLIC_DEMO_PAGE_MODE) return "public_demo";
  if (summary?.pageMode === USER_DATA_PAGE_MODE) return "personal_user";
  return "unknown";
}

export function buildApprovedPublicDemoLetter(summary = {}) {
  if (classifyAiRequestAudience(summary) !== "public_demo") return null;
  const language = summary.language === "en" ? "en" : "ja";
  const analysisMode = ANALYSIS_MODES.has(summary.analysisMode)
    ? summary.analysisMode
    : "letter";
  return Object.freeze({
    text: APPROVED_DEMO_LETTERS[language][analysisMode],
    provider: "approved-demo-sample",
    model: "human-reviewed-v1",
    generatedAt: new Date().toISOString(),
    attempts: 0,
    retriedAfterIncomplete: false,
    initialIncompleteReason: null,
    maxOutputTokens: null,
    usage: Object.freeze({ inputTokens: 0, outputTokens: 0, estimatedCostJpy: 0 })
  });
}

export const demoLetterTesting = Object.freeze({ APPROVED_DEMO_LETTERS });
