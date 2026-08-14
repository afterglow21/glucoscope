import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  filterGeneratedLetterPatternHints,
  getGlucoScoreMentionPolicy,
  getGeneratedLetterQualityIssues,
  isUnicornEligibleSummary,
  normalizeGeneratedLetterPunctuation,
  partitionGeneratedLetterQualityIssues
} from "../src/letter-quality.js";
import {
  DEFAULT_TURNSTILE_EXPECTED_ACTION,
  DEFAULT_TURNSTILE_EXPECTED_HOSTNAME,
  isAiGenerationRequest,
  isExpectedTurnstileResult,
  SHARED_AI_CACHE_ENABLED,
  shouldUseSharedCacheForSummary,
  USER_DATA_PAGE_MODE
} from "../src/request-policy.js";

const workerSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("worker uses cache schema v14 for trailing-emoji punctuation contract", () => {
  assert.match(workerSource, /AI_LETTER_CACHE_SCHEMA_VERSION = "gluco-ai-letter-cache-v14"/);
  assert.match(workerSource, /"Cache-Control": "no-store"/);
  assert.match(workerSource, /"X-Content-Type-Options": "nosniff"/);
});

test("shared KV stays disabled for every browser-provided page mode", () => {
  assert.equal(SHARED_AI_CACHE_ENABLED, false);
  assert.equal(shouldUseSharedCacheForSummary({ pageMode: "kazuma-public-demo" }), false);
  assert.equal(shouldUseSharedCacheForSummary({ pageMode: USER_DATA_PAGE_MODE }), false);
  assert.equal(shouldUseSharedCacheForSummary({ pageMode: "unknown" }), false);
  assert.equal(shouldUseSharedCacheForSummary({}), false);
  assert.match(workerSource, /if \(!shouldUseSharedCacheForSummary\(summary\)\) \{[\s\S]*?status: "browser-local-only"/);
  assert.equal((workerSource.match(/if \(!shouldUseSharedCacheForSummary\(summary\)\)/g) || []).length, 2);
  assert.match(workerSource, /storage: config\.sharedCacheEnabled[\s\S]*?: "disabled"/);
  assert.match(workerSource, /Shared cache is intentionally disabled during personal-user early access/);
});

test("AI generation POST requires an Origin while the usage GET remains operational", () => {
  assert.equal(isAiGenerationRequest(new Request("https://worker.example/api/gluco-letter", {
    method: "POST"
  })), true);
  assert.equal(isAiGenerationRequest(new Request("https://worker.example/api/gluco-letter/usage", {
    method: "GET"
  })), false);
  assert.match(workerSource, /isAiGenerationRequest\(request\) && !corsDecision\.origin/);
  assert.match(workerSource, /reason: "origin_header_required"/);
});

test("Turnstile success is bound to the expected production hostname and AI action", () => {
  const expectedResult = {
    success: true,
    hostname: DEFAULT_TURNSTILE_EXPECTED_HOSTNAME,
    action: DEFAULT_TURNSTILE_EXPECTED_ACTION
  };

  assert.equal(isExpectedTurnstileResult(expectedResult), true);
  assert.equal(isExpectedTurnstileResult({ ...expectedResult, hostname: "example.com" }), false);
  assert.equal(isExpectedTurnstileResult({ ...expectedResult, action: "glucoscope-usage-profile" }), false);
  assert.equal(isExpectedTurnstileResult({ ...expectedResult, success: false }), false);
  assert.match(workerSource, /!isExpectedTurnstileResult\(result, env\)/);
});

test("both retry paths block only hard quality issues after one rewrite", () => {
  assert.equal(
    (workerSource.match(/partitionGeneratedLetterQualityIssues\(retryQualityIssues\)/g) || []).length,
    2
  );
  assert.equal(
    (workerSource.match(/retryQualityAssessment\.blockingIssues\.length/g) || []).length,
    2
  );
  assert.doesNotMatch(workerSource, /if \(retryQualityIssues\.length\)/);
});

test("Japanese and English prompts preserve the exact opening and add welcome and everyday asides", () => {
  assert.match(workerSource, /Start with exactly \"Gluco is here 🍀\", then add a short, varied welcome on the next line/);
  assert.match(workerSource, /include one brief everyday aside unrelated to glucose/);
  assert.match(workerSource, /最初は必ず「グルコだよ🍀」で始め、次の行に「来てくれてうれしいよ」などの短い挨拶を入れる/);
  assert.match(workerSource, /血糖とは関係のない日常の短いひと言を1文入れる/);
});

test("score policy omits unavailable, unchanged, lower, and one-point-higher scores", () => {
  for (const [currentScore, previousScore, reason] of [
    [78, null, "comparison_unavailable"],
    [78, "", "comparison_unavailable"],
    [78, "--", "comparison_unavailable"],
    [78, 78, "same"],
    [77, 78, "lower"],
    [79, 78, "minor_increase"]
  ]) {
    assert.deepEqual(getGlucoScoreMentionPolicy({
      metrics: { glucoScore: currentScore, previousScore }
    }), {
      mention: false,
      difference: reason === "comparison_unavailable" ? null : currentScore - previousScore,
      reason
    });
  }
});

test("score policy allows only an increase of at least two as an optional clue", () => {
  assert.deepEqual(getGlucoScoreMentionPolicy({
    metrics: { glucoScore: 80, previousScore: 78 }
  }), {
    mention: true,
    difference: 2,
    reason: "higher_by_at_least_two"
  });
});

test("old pattern hints cannot reintroduce suppressed score or short-range GMI", () => {
  assert.deepEqual(filterGeneratedLetterPatternHints({
    period: "today",
    metrics: { glucoScore: 70, previousScore: 72 },
    patternHints: [
      "TIRは穏やかな手がかりだよ。",
      "GlucoScoreは前より低いよ。",
      "グルコスコアも見てみよう。",
      "GMIは6.8%だよ。"
    ]
  }), ["TIRは穏やかな手がかりだよ。"]);

  assert.deepEqual(filterGeneratedLetterPatternHints({
    period: "7d",
    metrics: { glucoScore: 74, previousScore: 72 },
    patternHints: ["GlucoScoreは2高いよ。", "GMIは6.8%だよ。"]
  }), ["GlucoScoreは2高いよ。", "GMIは6.8%だよ。"]);
});

test("suppressed GlucoScore wording remains a blocking output issue", () => {
  const issues = getGeneratedLetterQualityIssues(
    "グルコだよ🍀\nGlucoScoreは前より控えめだったよ。",
    "ja",
    { suppressGlucoScore: true }
  );
  assert.ok(issues.includes("suppressed_gluco_score_mention"));
  assert.ok(partitionGeneratedLetterQualityIssues(issues).blockingIssues.includes("suppressed_gluco_score_mention"));
});

test("allowed GlucoScore may appear only in one comparison sentence", () => {
  const repeatedIssues = getGeneratedLetterQualityIssues(
    "グルコだよ🍀\nGlucoScoreは80だったよ。\n別のまとめでもGlucoScoreを見てみたよ。",
    "ja",
    { suppressGlucoScore: false }
  );
  assert.ok(repeatedIssues.includes("repeated_gluco_score_mention"));
  assert.ok(partitionGeneratedLetterQualityIssues(repeatedIssues).blockingIssues.includes("repeated_gluco_score_mention"));

  const oneComparisonSentence = getGeneratedLetterQualityIssues(
    "グルコだよ🍀\nGlucoScoreは80で、比較期間のGlucoScore 78より2高かったよ。",
    "ja",
    { suppressGlucoScore: false }
  );
  assert.ok(!oneComparisonSentence.includes("repeated_gluco_score_mention"));
});

test("Japanese punctuation normalizer preserves openings and labels while completing prose", () => {
  const text = [
    "グルコだよ🍀",
    "📊 数字の手がかり",
    "・平均血糖 132mg/dL",
    "・落ち着いた時間",
    "来てくれてうれしいよ",
    "今日の数字を急いで答えにしなくて大丈夫",
    "ぼくはここにいるよ🍀",
    "そのままで大丈夫だよ！"
  ].join("\n");

  assert.equal(normalizeGeneratedLetterPunctuation(text, "ja"), [
    "グルコだよ🍀",
    "📊 数字の手がかり",
    "・平均血糖 132mg/dL",
    "・落ち着いた時間",
    "来てくれてうれしいよ。",
    "今日の数字を急いで答えにしなくて大丈夫。",
    "ぼくはここにいるよ🍀",
    "そのままで大丈夫だよ！"
  ].join("\n"));
});

test("Japanese punctuation normalizer removes a full stop around trailing emoji", () => {
  for (const input of [
    "ぼくはここにいるよ🍀",
    "ぼくはここにいるよ。🍀",
    "ぼくはここにいるよ🍀。",
    "ぼくはここにいるよ．🍀",
    "ぼくはここにいるよ🍀."
  ]) {
    assert.equal(normalizeGeneratedLetterPunctuation(input, "ja"), "ぼくはここにいるよ🍀");
  }

  assert.equal(normalizeGeneratedLetterPunctuation("ここにいるよ🫶💌。", "ja"), "ここにいるよ🫶💌");
  assert.equal(normalizeGeneratedLetterPunctuation("大丈夫かな？🍀", "ja"), "大丈夫かな？🍀");
  assert.equal(normalizeGeneratedLetterPunctuation("うれしいよ！🍀", "ja"), "うれしいよ！🍀");
});

test("worker prompt consistently uses no full stop with trailing emoji", () => {
  assert.match(workerSource, /ぼくはここにいるよ🍀/);
  assert.doesNotMatch(workerSource, /ぼくはここにいるよ。🍀/);
  assert.doesNotMatch(workerSource, /🍀は句点の後/);
});

test("punctuation normalizer does not alter English output", () => {
  assert.equal(normalizeGeneratedLetterPunctuation("Gluco is here 🍀\nI am here with you", "en"), "Gluco is here 🍀\nI am here with you");
});

test("worker removes short-range GMI and suppressed score values from generation input", () => {
  assert.match(workerSource, /isShortPromptPeriod\(summary\.period\) \? \[\] : \[`- GMI estimate:/);
  assert.match(workerSource, /scorePolicy\.mention \? \[/);
  assert.equal((workerSource.match(/filterGeneratedLetterPatternHints\(summary,/g) || []).length, 2);
  assert.match(workerSource, /suppressGlucoScore: !scorePolicy\.mention/);
  assert.doesNotMatch(workerSource, /GlucoScoreの比較差が1以内/);
  assert.match(workerSource, /それ以外はしっかり分析でも完全に省略する/);
});

test("worker may use a safe soft-only first draft if its optional rewrite fails", () => {
  assert.match(workerSource, /const canUseSafeFirstAttempt = \(/);
  assert.ok((workerSource.match(/if \(canUseSafeFirstAttempt\)/g) || []).length >= 3);
  assert.match(workerSource, /firstQualityAssessment\.blockingIssues\.length === 0/);
});

test("worker retries only transient OpenAI transport and HTTP errors internally", () => {
  assert.match(workerSource, /error\?\.code === "openai_transport_error"/);
  assert.match(workerSource, /status === 408/);
  assert.match(workerSource, /status === 409/);
  assert.match(workerSource, /status === 429/);
  assert.match(workerSource, /status >= 500/);
  assert.doesNotMatch(workerSource, /status === 401/);
});

test("classifies presentation-only issues as soft warnings", () => {
  assert.deepEqual(partitionGeneratedLetterQualityIssues([
    "repeated_metric_across_sections",
    "missing_compassion_acknowledgment",
    "minor_score_difference_overemphasized"
  ]), {
    blockingIssues: [],
    softWarnings: [
      "repeated_metric_across_sections",
      "missing_compassion_acknowledgment",
      "minor_score_difference_overemphasized"
    ]
  });
});

test("keeps safety, accuracy, and internal-leak issues blocking", () => {
  assert.deepEqual(partitionGeneratedLetterQualityIssues([
    "internal_identifier",
    "blame_weighted_metric",
    "unsupported_metric_change",
    "metric_optimization_directive",
    "short_range_gmi_mention",
    "unqualified_unicorn"
  ]), {
    blockingIssues: [
      "internal_identifier",
      "blame_weighted_metric",
      "unsupported_metric_change",
      "metric_optimization_directive",
      "short_range_gmi_mention",
      "unqualified_unicorn"
    ],
    softWarnings: []
  });
});

test("treats unknown quality issue codes as blocking by default", () => {
  assert.deepEqual(partitionGeneratedLetterQualityIssues([
    "future_unclassified_issue",
    "future_unclassified_issue"
  ]), {
    blockingIssues: ["future_unclassified_issue"],
    softWarnings: []
  });
});

test("accepts Gluco-style Japanese wording", () => {
  const text = "グルコだよ🍀\nTIRは82％で、落ち着いた時間がしっかり見えているよ。\n明日も流れをやさしく見てみよう。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts the public glucose unit mg/dL in Japanese output", () => {
  const text = "グルコだよ🍀\n平均血糖は132mg/dLで、表示中の流れをやさしく見返せるよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts the public glucose unit mg/dL in English output", () => {
  const text = "Gluco is here 🍀\nAverage glucose was 132mg/dL in the selected range.";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "en"), []);
});

test("does not discard readable Japanese because one polite ending appears", () => {
  const text = "グルコだよ🍀\nTIRは82％です。\n落ち着いた時間も見えているよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("does not require an exact opening string to display a safe letter", () => {
  const text = "グルコだよ 🍀\n表示中の流れをやさしく見てみたよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("does not discard a safe letter only because it contains a Markdown heading", () => {
  const text = "グルコだよ🍀\n## 全体の流れ\n落ち着いた時間が見えているよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects the observed unnatural suggestion ending", () => {
  const text = "グルコだよ🍀\n一緒にゆるく続けていこうかも。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("unnatural_japanese_suggestion"));
});

test("rejects another suggestion plus kamo combination", () => {
  const text = "グルコだよ🍀\n明日も一緒に見てみようかもね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("unnatural_japanese_suggestion"));
});

test("accepts a natural uncertain observation ending in kamo", () => {
  const text = "グルコだよ🍀\n午後は高めの時間が少し続くかもしれないね。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts a natural invitation without kamo", () => {
  const text = "グルコだよ🍀\n明日も一緒にやさしく見ていこうね🍀";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects repeated together wording in adjacent closing sentences", () => {
  const text = [
    "グルコだよ🍀",
    "GlucoScoreは比較期間より控えめに見えていて、その手がかりを一緒に辿っていこうね。",
    "一緒に見ていこうね🍀"
  ].join("\n");

  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("repeated_together_closing"));
});

test("accepts one together invitation followed by a different closing", () => {
  const text = [
    "グルコだよ🍀",
    "どこに表れているか一緒に辿っていこうね。",
    "明日もやさしく振り返ってみよう🍀"
  ].join("\n");

  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("does not reject two together phrases when another sentence separates them", () => {
  const text = [
    "グルコだよ🍀",
    "最初の手がかりは一緒に見てみよう。",
    "数字の流れを急がず振り返れるとよさそうだね。",
    "明日も一緒に見ていこうね🍀"
  ].join("\n");

  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});



test("rejects blame-weighted TBR wording", () => {
  const text = "グルコだよ🍀\nTBRは5.9％もあるから、低めだった時間を見返そう。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("blame_weighted_metric"));
});

test("accepts factual TBR wording with a gentle reflection clue", () => {
  const text = "グルコだよ🍀\nTBRは5.9％だったよ。低めだった時間を、責めずにやさしく振り返る手がかりにしてみよう🍀";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects deficit-weighted TIR wording", () => {
  const text = "グルコだよ🍀\nTIRは66％しかないね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("deficit_weighted_metric"));
});

test("rejects judgmental metric prefixes", () => {
  const text = "グルコだよ🍀\n残念ながらTARは18％だったよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("judgmental_metric_prefix"));
});

test("rejects a metric-only exclamation line", () => {
  const text = "グルコだよ🍀\nTIRは94.1％！\n表示中のほとんどが目標範囲の中だよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("isolated_metric_exclamation"));
});

test("accepts a metric connected to its meaning in the same line", () => {
  const text = "グルコだよ🍀\nTIRは94.1％で、表示中のほとんどが目標範囲の中に入っているよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects leaked internal identifier atLeast", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\natLeast 1つの手がかりがあるよ。", "ja");
  assert.ok(issues.includes("internal_identifier"));
});

test("rejects another known internal identifier", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\npatternHintsを見たよ。", "ja");
  assert.ok(issues.includes("internal_identifier"));
});

test("rejects leaked dotted implementation keys", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nsummary.metrics.tir を確認したよ。", "ja");
  assert.ok(issues.includes("internal_dotted_key"));
});

test("allows public metric names such as GlucoScore", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nGlucoScoreにも振り返りの手がかりが見えているよ。", "ja");
  assert.deepEqual(issues, []);
});

test("allows other public mixed-case health terms", () => {
  const text = "グルコだよ🍀\neGFRやHbA1cのような公開用語を内部変数とは扱わないよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects empty output", () => {
  assert.deepEqual(getGeneratedLetterQualityIssues("   ", "ja"), ["empty_output"]);
});

test("rejects internal identifier in English output too", () => {
  const issues = getGeneratedLetterQualityIssues("Gluco is here 🍀\natLeast one clue is visible.", "en");
  assert.ok(issues.includes("internal_identifier"));
});



test("rejects leaked compassion-priority wording", () => {
  const text = "グルコだよ🍀\nいたわり優先が対象になっているよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("internal_writing_guidance"));
});

test("rejects vague average atmosphere wording", () => {
  const text = "グルコだよ🍀\nGMI目安は5.2％で、平均の雰囲気がそれほど荒れていないよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("vague_metric_metaphor"));
});

test("rejects vague return-strength wording", () => {
  const text = "グルコだよ🍀\n過去7日平均の中では、戻りの力も感じるね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("vague_metric_metaphor"));
});

test("rejects turning lower time into reassurance", () => {
  const text = "グルコだよ🍀\n低めの時間を後からそっと見る場所にしておくと安心材料になるよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("vague_metric_metaphor"));
  assert.ok(issues.includes("low_time_as_reassurance"));
});

test("rejects minimizing TBR with a little", () => {
  const text = "グルコだよ🍀\nTBRは16.0％で、低めの時間が少し増えている流れだね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("tbr_minimizing_wording"));
  assert.ok(issues.includes("unsupported_metric_change"));
});

test("rejects unsupported change wording around TBR", () => {
  const text = "グルコだよ🍀\nTBRは16.0％で、低めの時間が増えているね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("unsupported_metric_change"));
});

test("rejects GMI interpretation as calm or stable", () => {
  const text = "グルコだよ🍀\nGMIは5.2％で、全体が安定しているよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("gmi_overinterpretation"));
});

test("accepts factual GMI wording", () => {
  const text = "グルコだよ🍀\nGMIの目安は5.2％だったよ。平均血糖から計算した参考値として、ほかの数字と一緒に見てみようね。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts factual TBR wording without minimizing it", () => {
  const text = "グルコだよ🍀\nTBRは16.0％だったよ。低めだった時間がまとまって見えているね。今日はここまで、おつかれさま🍀";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects observed unnatural delta metaphor", () => {
  const text = "グルコだよ🍀\n前回との差分は-4mg/dLで、小さくまとまる動きが見えているよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("vague_metric_metaphor"));
});



test("rejects causal TBR wording before reflection advice", () => {
  const text = "グルコだよ🍀\nTBRは12.9％だから、低めの時間を見返してみようね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("tbr_causal_connector"));
});

test("rejects reading a trend from one delta value", () => {
  const text = "グルコだよ🍀\n前回との差は+2mg/dLで、急に大きくは動いていない流れだね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("delta_trend_overinterpretation"));
});

test("accepts a factual delta sentence", () => {
  const text = "グルコだよ🍀\n前回との差は+2mg/dLだったよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects awkward fixed-amount wording", () => {
  const text = "グルコだよ🍀\nTBRは12.9％で、低めの時間が一定ぶんあるよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("awkward_metric_phrasing"));
});

test("rejects awkward GMI reference wording", () => {
  const text = "グルコだよ🍀\nGMIは5.2％で、参考値として押さえられるよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("awkward_metric_phrasing"));
});

test("rejects the same metric repeated in separate sections", () => {
  const text = [
    "グルコだよ🍀",
    "📊 数字の手がかり",
    "TIRは87.1％で、目標範囲で過ごせた時間がしっかりあるよ。",
    "🌟 うれしい手がかり",
    "TIRは87.1％で、積み重なりが見えているよ🍀"
  ].join("\n");
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("repeated_metric_across_sections"));
});

test("allows one comparison sentence to name GlucoScore twice", () => {
  const text = "グルコだよ🍀\nGlucoScoreは74で、比較期間のGlucoScore 73とほぼ同じだったよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja", {
    analysisMode: "deep",
    minorScoreDifference: true
  }), []);
});

test("rejects two adjacent closing invitations", () => {
  const text = [
    "グルコだよ🍀",
    "余裕があるときに、低めだった時間帯をそっと見返してみようね🍀",
    "一緒に見ていこうね🍀"
  ].join("\n");
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("repeated_closing_invitation"));
});

test("requires compassion when the summary requests it", () => {
  const text = "グルコだよ🍀\nTBRは12.9％だったよ。低めだった時間帯を見返してみようね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja", {
    compassionRequired: true
  });
  assert.ok(issues.includes("missing_compassion_acknowledgment"));
});

test("rejects compassion placed after the first reflection invitation", () => {
  const text = "グルコだよ🍀\n低めだった時間帯を見返してみようね。大変な時間もあったかもしれないね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja", {
    compassionRequired: true
  });
  assert.ok(issues.includes("compassion_after_reflection_invitation"));
});

test("accepts compassion before a reflection invitation", () => {
  const text = "グルコだよ🍀\nTBRは12.9％だったよ。大変な時間もあったかもしれないね。今日はここまで、おつかれさま🍀\n余裕があるときに、低めだった時間帯をそっと見返してみようね。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja", {
    compassionRequired: true
  }), []);
});

test("rejects GMI in today or yesterday reflections", () => {
  const text = "グルコだよ🍀\nGMIの目安は5.2％だったよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja", {
    period: "today"
  });
  assert.ok(issues.includes("short_range_gmi_mention"));
});

test("rejects a one-point GlucoScore comparison in a short letter", () => {
  const text = "グルコだよ🍀\nGlucoScoreは比較期間より1高く見えているよ。";
  const issues = getGeneratedLetterQualityIssues(text, "ja", {
    analysisMode: "letter",
    minorScoreDifference: true
  });
  assert.ok(issues.includes("minor_score_difference_overemphasized"));
});



test("rejects the observed target-time optimization directive", () => {
  const text = "グルコだよ🍀\n最後に、次の1日も「目標の時間を増やす」ことだけ意識して進めてみようね🍀";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("metric_optimization_directive"));
  assert.ok(issues.includes("single_focus_directive"));
});

test("rejects a directive to reduce TBR", () => {
  const text = "グルコだよ🍀\n次はTBRを減らすことを目指そうね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(
    issues.includes("metric_optimization_directive")
    || issues.includes("metric_target_invitation")
  );
});

test("rejects a directive to maintain GlucoScore", () => {
  const text = "グルコだよ🍀\nGlucoScoreを維持することを意識して進めてみようね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("metric_optimization_directive"));
});

test("rejects a single-focus instruction without a metric name", () => {
  const text = "グルコだよ🍀\n明日はこのことだけ意識して過ごしてみようね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("single_focus_directive"));
});

test("rejects a metric target invitation", () => {
  const text = "グルコだよ🍀\n目標範囲の時間を増やせるようにしていこうね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(
    issues.includes("metric_optimization_directive")
    || issues.includes("metric_target_invitation")
  );
});

test("accepts factual TIR recognition without turning it into a goal", () => {
  const text = "グルコだよ🍀\nTIRは98.2％で、目標範囲で過ごせた時間がしっかり見えているよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts a reflection-based closing", () => {
  const text = "グルコだよ🍀\n今日の数字を急いで答えにしなくて大丈夫だよ。余裕があるときに、今日の流れをそっと振り返ってみようね🍀";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts compassion before one gentle reflection", () => {
  const text = "グルコだよ🍀\nTBRは1.8％だったよ。大変に感じる時間もあったかもしれないね。今日はここまで、おつかれさま🍀\n余裕があるときに、その時間帯をそっと振り返ってみようね。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja", {
    compassionRequired: true
  }), []);
});

test("unicorn is eligible only for today's latest reading of exactly 100mg/dL", () => {
  assert.equal(isUnicornEligibleSummary({
    period: "today",
    currentGlucose: 100,
    metrics: { tir: 82 }
  }), true);
});

test("numeric-string 100 is accepted for the latest reading", () => {
  assert.equal(isUnicornEligibleSummary({
    period: "today",
    currentGlucose: "100"
  }), true);
});

test("TIR 100 alone does not qualify as a unicorn", () => {
  assert.equal(isUnicornEligibleSummary({
    period: "today",
    currentGlucose: 111,
    metrics: { tir: 100 }
  }), false);
});

test("average glucose 100 alone does not qualify as a unicorn", () => {
  assert.equal(isUnicornEligibleSummary({
    period: "today",
    currentGlucose: 111,
    metrics: { averageGlucose: 100 }
  }), false);
});

test("GlucoScore 100 alone does not qualify as a unicorn", () => {
  assert.equal(isUnicornEligibleSummary({
    period: "today",
    currentGlucose: 111,
    metrics: { glucoScore: 100 }
  }), false);
});

test("a latest reading of 100 outside today's view does not qualify", () => {
  assert.equal(isUnicornEligibleSummary({
    period: "yesterday",
    currentGlucose: 100
  }), false);
});

test("rejects unicorn wording when the summary is not eligible", () => {
  const text = "グルコだよ🍀\n🦄 ユニコーンをつかまえた！";
  const issues = getGeneratedLetterQualityIssues(text, "ja", {
    allowUnicorn: false
  });
  assert.ok(issues.includes("unqualified_unicorn"));
});

test("allows unicorn wording when the summary is eligible and wording is separate from TIR", () => {
  const text = "グルコだよ🍀\n🦄 ユニコーンをつかまえた！ 最新の測定は100mg/dLだったよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja", {
    allowUnicorn: true
  }), []);
});

test("rejects the observed TIR-to-unicorn causal wording even when unicorn is otherwise eligible", () => {
  const text = "グルコだよ🍀\nTIRが100％だから、🦄 ユニコーンをつかまえた！";
  const issues = getGeneratedLetterQualityIssues(text, "ja", {
    allowUnicorn: true
  });
  assert.ok(issues.includes("tir_unicorn_coupling"));
});

test("allows TIR and unicorn as separate independent clues when eligible", () => {
  const text = [
    "グルコだよ🍀",
    "TIRは100％！ 表示中の測定がすべて目標範囲の中だよ。",
    "🦄 ユニコーンをつかまえた！ 最新の測定は100mg/dLだったよ。"
  ].join("\n");

  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja", {
    allowUnicorn: true
  }), []);
});

test("rejects English unicorn wording when the summary is not eligible", () => {
  const text = "Gluco is here 🍀\n🦄 You caught a unicorn!";
  const issues = getGeneratedLetterQualityIssues(text, "en", {
    allowUnicorn: false
  });
  assert.ok(issues.includes("unqualified_unicorn"));
});
