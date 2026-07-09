const CONTRACT_VERSION = "gluco-ai-letter-worker-response-v0.1";
const LETTER_SLOT_KEYS = ["morning", "afternoon", "night"];

const DEFAULT_GUARD_CONFIG = {
  aiEnabled: true,
  provider: "prototype",
  openAiModel: "gpt-5.4-nano",
  openAiMaxOutputTokens: 700,
  dailyGenerationLimit: 3,
  slotGenerationLimit: 1,
  monthlyBudgetJpy: 1000,
  warningBudgetJpy: 800,
  stopBudgetJpy: 950,
  timezoneOffsetHours: 9,
  inputPriceJpyPerMillionTokens: 32,
  outputPriceJpyPerMillionTokens: 200
};

let prototypeUsageState = null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function okResponse(body = {}, status = 200) {
  return jsonResponse({
    ok: true,
    version: CONTRACT_VERSION,
    ...body
  }, status);
}

function errorResponse({ code, message, userMessage, retryable = false, details = null }, status = 400) {
  return jsonResponse({
    ok: false,
    version: CONTRACT_VERSION,
    status: "error",
    code,
    message,
    userMessage,
    retryable,
    details
  }, status);
}

function getClientMode(payload = {}) {
  return payload?.client?.mode || "unknown";
}

function readNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function readGuardConfig(env = {}) {
  const monthlyBudgetJpy = readNumber(env.AI_MONTHLY_BUDGET_JPY, DEFAULT_GUARD_CONFIG.monthlyBudgetJpy);
  const warningBudgetJpy = readNumber(env.AI_WARNING_BUDGET_JPY, Math.min(DEFAULT_GUARD_CONFIG.warningBudgetJpy, monthlyBudgetJpy * 0.8));
  const stopBudgetJpy = readNumber(env.AI_STOP_BUDGET_JPY, Math.min(DEFAULT_GUARD_CONFIG.stopBudgetJpy, monthlyBudgetJpy * 0.95));
  const provider = env.AI_PROVIDER === "openai" ? "openai" : DEFAULT_GUARD_CONFIG.provider;

  return {
    aiEnabled: readBoolean(env.AI_ENABLED, DEFAULT_GUARD_CONFIG.aiEnabled),
    provider,
    openAiModel: env.OPENAI_MODEL || DEFAULT_GUARD_CONFIG.openAiModel,
    openAiMaxOutputTokens: Math.max(100, Math.floor(readNumber(env.OPENAI_MAX_OUTPUT_TOKENS, DEFAULT_GUARD_CONFIG.openAiMaxOutputTokens))),
    dailyGenerationLimit: Math.max(0, Math.floor(readNumber(env.AI_DAILY_GENERATION_LIMIT, DEFAULT_GUARD_CONFIG.dailyGenerationLimit))),
    slotGenerationLimit: Math.max(0, Math.floor(readNumber(env.AI_SLOT_GENERATION_LIMIT, DEFAULT_GUARD_CONFIG.slotGenerationLimit))),
    monthlyBudgetJpy,
    warningBudgetJpy,
    stopBudgetJpy,
    timezoneOffsetHours: readNumber(env.AI_TIMEZONE_OFFSET_HOURS, DEFAULT_GUARD_CONFIG.timezoneOffsetHours),
    inputPriceJpyPerMillionTokens: readNumber(env.AI_INPUT_PRICE_JPY_PER_1M_TOKENS, DEFAULT_GUARD_CONFIG.inputPriceJpyPerMillionTokens),
    outputPriceJpyPerMillionTokens: readNumber(env.AI_OUTPUT_PRICE_JPY_PER_1M_TOKENS, DEFAULT_GUARD_CONFIG.outputPriceJpyPerMillionTokens)
  };
}

function getShiftedDate(date = new Date(), timezoneOffsetHours = 9) {
  return new Date(date.getTime() + timezoneOffsetHours * 60 * 60 * 1000);
}

function getDayKey(date = new Date(), timezoneOffsetHours = 9) {
  return getShiftedDate(date, timezoneOffsetHours).toISOString().slice(0, 10);
}

function getMonthKey(date = new Date(), timezoneOffsetHours = 9) {
  return getShiftedDate(date, timezoneOffsetHours).toISOString().slice(0, 7);
}

function createEmptySlotCounts() {
  return {
    morning: 0,
    afternoon: 0,
    night: 0,
    unknown: 0
  };
}

function normalizeSlot(slot) {
  return LETTER_SLOT_KEYS.includes(slot) ? slot : "unknown";
}

function getSlotLabel(summary = {}, language = "ja") {
  if (summary.slotLabel) return summary.slotLabel;

  const slot = normalizeSlot(summary.slot);
  if (language === "en") {
    if (slot === "morning") return "morning letter";
    if (slot === "afternoon") return "afternoon letter";
    if (slot === "night") return "night letter";
    return "current letter";
  }

  if (slot === "morning") return "朝のお手紙";
  if (slot === "afternoon") return "昼のお手紙";
  if (slot === "night") return "夜のお手紙";
  return "今のお手紙";
}

function createUsageState(now = new Date(), config = DEFAULT_GUARD_CONFIG) {
  return {
    kind: "prototype-memory",
    note: "Prototype only. This in-memory state is not durable and will be replaced by KV/D1.",
    dayKey: getDayKey(now, config.timezoneOffsetHours),
    monthKey: getMonthKey(now, config.timezoneOffsetHours),
    dailyGenerationCount: 0,
    dailyCacheHitCount: 0,
    dailyRateLimitedCount: 0,
    dailySlotGenerationCounts: createEmptySlotCounts(),
    dailySlotCacheHitCounts: createEmptySlotCounts(),
    dailySlotRateLimitedCounts: createEmptySlotCounts(),
    monthlyGenerationCount: 0,
    monthlyCacheHitCount: 0,
    monthlyBudgetBlockedCount: 0,
    monthlyAiDisabledCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostJpy: 0,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function ensureSlotCounters(state) {
  state.dailySlotGenerationCounts = {
    ...createEmptySlotCounts(),
    ...(state.dailySlotGenerationCounts || {})
  };
  state.dailySlotCacheHitCounts = {
    ...createEmptySlotCounts(),
    ...(state.dailySlotCacheHitCounts || {})
  };
  state.dailySlotRateLimitedCounts = {
    ...createEmptySlotCounts(),
    ...(state.dailySlotRateLimitedCounts || {})
  };
}

function getUsageState(config, now = new Date()) {
  const dayKey = getDayKey(now, config.timezoneOffsetHours);
  const monthKey = getMonthKey(now, config.timezoneOffsetHours);

  if (!prototypeUsageState || prototypeUsageState.monthKey !== monthKey) {
    prototypeUsageState = createUsageState(now, config);
  }

  ensureSlotCounters(prototypeUsageState);

  if (prototypeUsageState.dayKey !== dayKey) {
    prototypeUsageState.dayKey = dayKey;
    prototypeUsageState.dailyGenerationCount = 0;
    prototypeUsageState.dailyCacheHitCount = 0;
    prototypeUsageState.dailyRateLimitedCount = 0;
    prototypeUsageState.dailySlotGenerationCounts = createEmptySlotCounts();
    prototypeUsageState.dailySlotCacheHitCounts = createEmptySlotCounts();
    prototypeUsageState.dailySlotRateLimitedCounts = createEmptySlotCounts();
  }

  return prototypeUsageState;
}

function cloneUsageState(state) {
  return JSON.parse(JSON.stringify(state));
}

function applyDebugUsageOverrides(state, payload = {}) {
  const debug = payload?.debug || {};
  const nextState = cloneUsageState(state);
  ensureSlotCounters(nextState);

  if (Number.isFinite(Number(debug.mockDailyGenerationCount))) {
    nextState.dailyGenerationCount = Number(debug.mockDailyGenerationCount);
  }

  if (Number.isFinite(Number(debug.mockMonthlyGenerationCount))) {
    nextState.monthlyGenerationCount = Number(debug.mockMonthlyGenerationCount);
  }

  if (Number.isFinite(Number(debug.mockMonthlyEstimatedCostJpy))) {
    nextState.estimatedCostJpy = Number(debug.mockMonthlyEstimatedCostJpy);
  }

  if (Number.isFinite(Number(debug.mockInputTokens))) {
    nextState.inputTokens = Number(debug.mockInputTokens);
  }

  if (Number.isFinite(Number(debug.mockOutputTokens))) {
    nextState.outputTokens = Number(debug.mockOutputTokens);
  }

  const mockSlot = normalizeSlot(debug.mockSlot || payload?.summary?.slot);
  if (Number.isFinite(Number(debug.mockSlotGenerationCount))) {
    nextState.dailySlotGenerationCounts[mockSlot] = Number(debug.mockSlotGenerationCount);
  }

  return nextState;
}

function estimateTokensFromText(text, charsPerToken = 4) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / charsPerToken));
}

function estimateInputTokens(summary = {}) {
  return estimateTokensFromText(JSON.stringify(summary), 4);
}

function estimateOutputTokens(letterText = "") {
  return estimateTokensFromText(letterText, 2.5);
}

function estimateCostJpy({ inputTokens, outputTokens, config }) {
  const inputCost = inputTokens * config.inputPriceJpyPerMillionTokens / 1_000_000;
  const outputCost = outputTokens * config.outputPriceJpyPerMillionTokens / 1_000_000;
  return Number((inputCost + outputCost).toFixed(4));
}

function getPrototypeStatus(payload = {}) {
  const requestedStatus = payload?.debug?.forceStatus || payload?.forceStatus;

  if (requestedStatus === "cached") return "cached";
  if (requestedStatus === "rate_limited") return "rate_limited";
  if (requestedStatus === "budget_stopped") return "budget_stopped";
  if (requestedStatus === "ai_disabled") return "ai_disabled";
  return "success";
}

function buildPrototypeLetter(summary = {}) {
  const language = summary.language === "en" ? "en" : "ja";
  const metrics = summary.metrics || {};
  const slotLabel = getSlotLabel(summary, language);
  const rangeLabel = summary.rangeLabel || "--";
  const tir = metrics.tir ?? "--";
  const avg = metrics.averageGlucose ?? "--";
  const score = metrics.glucoScore ?? "--";
  const hints = Array.isArray(summary.patternHints) ? summary.patternHints.slice(0, 2) : [];

  if (language === "en") {
    const hintLine = hints.length ? `\nI also noticed: ${hints.join(" / ")}` : "";
    return `Gluco is here 🍀
This is a prototype AI letter for the ${slotLabel}.
I looked at the selected range: ${rangeLabel}.
TIR is ${tir}%, average glucose is ${avg}mg/dL, and GlucoScore is ${score}.${hintLine}
The numbers are not here to judge you; they are small clues for understanding today and improving tomorrow.`;
  }

  const hintLine = hints.length ? `\n見えている手がかり: ${hints.join(" / ")}` : "";
  return `グルコだよ🍀
これは${slotLabel}のテスト版だよ。
表示範囲は ${rangeLabel} だね。
TIRは${tir}%、平均血糖は${avg}mg/dL、GlucoScoreは${score}だったよ。${hintLine}
血糖はあなたを責める数字じゃなくて、今日を理解して明日を少し楽にするための手がかりだよ。`;
}

function buildOpenAiInstructions(language = "ja") {
  if (language === "en") {
    return [
      "You are gluco, GlucoScope's gentle AI companion.",
      "You help people living with diabetes reflect on summarized glucose data with kindness.",
      "Do not diagnose, judge, blame, scare, or give treatment decisions.",
      "Do not recommend insulin doses, medication changes, pump settings, or device-setting changes.",
      "Use the provided summarized data only. Do not invent measurements.",
      "Write as a short warm letter, not as a medical report.",
      "Keep it concise, concrete, and gentle. End with a small reflection clue for tomorrow."
    ].join(" ");
  }

  return [
    "あなたはGlucoScope公式AIパートナーのグルコです。",
    "糖尿病とともに生きる人が、血糖データを責められることなくやさしく振り返るための短いお手紙を書きます。",
    "診断、治療判断、インスリン量、薬、ポンプ設定、デバイス設定の変更指示はしません。",
    "血糖値の良し悪しを決めつけず、評価・採点・反省を迫る言い方を避けます。",
    "与えられた集計済みサマリーだけを使い、測定値や出来事を作りません。",
    "医療レポートではなく、グルコからのやさしいお手紙として書きます。",
    "短く、具体的で、やさしく。最後に明日を少し楽にする小さな手がかりを添えてください。"
  ].join(" ");
}

function buildOpenAiPrompt(summary = {}) {
  const language = summary.language === "en" ? "en" : "ja";
  const slotLabel = getSlotLabel(summary, language);
  const metrics = summary.metrics || {};
  const hints = Array.isArray(summary.patternHints) ? summary.patternHints : [];

  const safeSummary = {
    language,
    period: summary.period,
    slot: normalizeSlot(summary.slot),
    slotLabel,
    rangeLabel: summary.rangeLabel,
    latestMeasuredAt: summary.latestMeasuredAt,
    currentGlucose: summary.currentGlucose,
    direction: summary.direction,
    delta: summary.delta,
    metrics: {
      tir: metrics.tir,
      tar: metrics.tar,
      tbr: metrics.tbr,
      averageGlucose: metrics.averageGlucose,
      cv: metrics.cv,
      gmi: metrics.gmi,
      glucoScore: metrics.glucoScore,
      previousScore: metrics.previousScore,
      sevenDayAverageScore: metrics.sevenDayAverageScore
    },
    patternHints: hints.slice(0, 4)
  };

  if (language === "en") {
    return `Write one Gluco letter for this summarized glucose view.

Requirements:
- Start with "Gluco is here 🍀"
- 5 to 8 short lines
- Mention the active letter time: ${slotLabel}
- Mention 1 to 3 concrete clues from the summary
- Avoid medical advice, dosing advice, diagnosis, blame, fear, or strict instructions
- Use gentle, plain language

Summarized data:
${JSON.stringify(safeSummary, null, 2)}`;
  }

  return `この集計済み血糖サマリーをもとに、グルコからのお手紙を1通書いてください。

条件:
- 最初は「グルコだよ🍀」で始める
- 5〜8行くらいの短いお手紙
- 今のお手紙の時間帯「${slotLabel}」を自然に含める
- サマリーから見える具体的な手がかりを1〜3個だけ入れる
- 医療判断、診断、インスリン量、薬、ポンプ設定、デバイス設定の助言はしない
- 責めない、怖がらせない、急かさない
- やさしく、自然な日本語で書く

集計済みサマリー:
${JSON.stringify(safeSummary, null, 2)}`;
}

function extractOpenAiText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const textParts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function getOpenAiUsage(data = {}) {
  const usage = data.usage || {};
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null
  };
}

async function callOpenAiLetter({ summary, env, config }) {
  if (!env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY");
    error.code = "missing_openai_api_key";
    throw error;
  }

  const model = config.openAiModel;
  const language = summary.language === "en" ? "en" : "ja";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions: buildOpenAiInstructions(language),
      input: buildOpenAiPrompt(summary),
      max_output_tokens: config.openAiMaxOutputTokens,
      tool_choice: "none",
      store: false
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `OpenAI returned ${response.status}`);
    error.code = "openai_api_error";
    error.status = response.status;
    throw error;
  }

  const text = extractOpenAiText(data);
  if (!text) {
    const error = new Error("OpenAI response did not include output text.");
    error.code = "openai_empty_output";
    throw error;
  }

  const openAiUsage = getOpenAiUsage(data);
  const inputTokens = openAiUsage.inputTokens ?? estimateInputTokens(summary);
  const outputTokens = openAiUsage.outputTokens ?? estimateOutputTokens(text);

  return {
    text,
    provider: "openai",
    model,
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostJpy: estimateCostJpy({
        inputTokens,
        outputTokens,
        config
      })
    }
  };
}

async function generateLetter({ summary, payload, env, config, status }) {
  if (status === "cached" || config.provider !== "openai") {
    const text = buildPrototypeLetter(summary);
    const inputTokens = estimateInputTokens(summary);
    const outputTokens = estimateOutputTokens(text);

    return {
      text,
      provider: "none",
      model: "prototype-fixed-letter",
      usage: status === "cached"
        ? emptyRequestUsage()
        : {
            inputTokens,
            outputTokens,
            estimatedCostJpy: estimateCostJpy({
              inputTokens,
              outputTokens,
              config
            })
          }
    };
  }

  return callOpenAiLetter({
    summary,
    env,
    config
  });
}

function buildUsagePayload({ state, requestUsage, config, summary = {} }) {
  ensureSlotCounters(state);

  const slotKey = normalizeSlot(summary.slot);
  const monthlyEstimatedCostJpy = Number(state.estimatedCostJpy.toFixed(4));
  const budgetUsageRate = config.monthlyBudgetJpy > 0
    ? Number((monthlyEstimatedCostJpy / config.monthlyBudgetJpy * 100).toFixed(2))
    : 0;

  return {
    inputTokens: requestUsage.inputTokens,
    outputTokens: requestUsage.outputTokens,
    estimatedCostJpy: requestUsage.estimatedCostJpy,
    totalInputTokens: state.inputTokens,
    totalOutputTokens: state.outputTokens,
    dailyGenerationCount: state.dailyGenerationCount,
    dailyCacheHitCount: state.dailyCacheHitCount,
    dailySlotGenerationCounts: state.dailySlotGenerationCounts,
    dailySlotCacheHitCounts: state.dailySlotCacheHitCounts,
    activeSlot: {
      key: slotKey,
      label: getSlotLabel(summary, summary.language === "en" ? "en" : "ja"),
      generationCount: state.dailySlotGenerationCounts[slotKey] || 0,
      cacheHitCount: state.dailySlotCacheHitCounts[slotKey] || 0
    },
    monthlyGenerationCount: state.monthlyGenerationCount,
    monthlyCacheHitCount: state.monthlyCacheHitCount,
    monthlyEstimatedCostJpy,
    monthlyBudgetJpy: config.monthlyBudgetJpy,
    budgetUsageRate,
    currency: "JPY",
    dayKey: state.dayKey,
    monthKey: state.monthKey,
    storage: state.kind
  };
}

function buildSlotRemainingCounts(state, config) {
  ensureSlotCounters(state);

  return {
    morning: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.morning || 0)),
    afternoon: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.afternoon || 0)),
    night: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.night || 0)),
    unknown: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.unknown || 0))
  };
}

function buildGuardPayload({ state, config, budgetBlocked = false, summary = {} }) {
  ensureSlotCounters(state);

  const slotKey = normalizeSlot(summary.slot);
  const slotGenerationCount = state.dailySlotGenerationCounts[slotKey] || 0;
  const monthlyEstimatedCostJpy = Number(state.estimatedCostJpy.toFixed(4));
  const budgetWarning = monthlyEstimatedCostJpy >= config.warningBudgetJpy;
  const dailyGenerationRemaining = Math.max(0, config.dailyGenerationLimit - state.dailyGenerationCount);
  const slotGenerationRemaining = Math.max(0, config.slotGenerationLimit - slotGenerationCount);
  const totalRateLimited = state.dailyGenerationCount >= config.dailyGenerationLimit;
  const slotRateLimited = slotGenerationCount >= config.slotGenerationLimit;

  return {
    turnstileRequired: false,
    turnstileVerified: false,
    rateLimited: totalRateLimited || slotRateLimited,
    totalRateLimited,
    slotRateLimited,
    budgetBlocked,
    budgetWarning,
    aiEnabled: config.aiEnabled,
    dailyGenerationLimit: config.dailyGenerationLimit,
    dailyGenerationRemaining,
    slotGenerationLimit: config.slotGenerationLimit,
    slotGenerationRemaining,
    activeSlot: {
      key: slotKey,
      label: getSlotLabel(summary, summary.language === "en" ? "en" : "ja"),
      generationCount: slotGenerationCount
    },
    dailySlotGenerationCounts: state.dailySlotGenerationCounts,
    monthlyBudgetJpy: config.monthlyBudgetJpy,
    warningBudgetJpy: config.warningBudgetJpy,
    stopBudgetJpy: config.stopBudgetJpy,
    monthlyEstimatedCostJpy
  };
}

function buildSuccessPayload({ summary, payload, status, usageState, requestUsage, config, generationResult }) {
  const cached = status === "cached";
  const generatedAt = new Date().toISOString();
  const source = generationResult.provider === "openai" ? "openai" : "prototype-worker";

  return {
    status,
    source,
    clientMode: getClientMode(payload),
    letter: {
      text: generationResult.text,
      language: summary.language === "en" ? "en" : "ja",
      generatedAt,
      provider: generationResult.provider,
      model: generationResult.model,
      cached,
      cacheKey: cached ? buildPrototypeCacheKey(summary) : null,
      slot: {
        key: normalizeSlot(summary.slot),
        label: getSlotLabel(summary, summary.language === "en" ? "en" : "ja")
      }
    },
    usage: buildUsagePayload({
      state: usageState,
      requestUsage,
      config,
      summary
    }),
    guard: buildGuardPayload({
      state: usageState,
      config,
      budgetBlocked: false,
      summary
    })
  };
}

function buildPrototypeCacheKey(summary = {}) {
  return [
    summary.pageMode || "unknown-page",
    summary.period || "unknown-period",
    normalizeSlot(summary.slot),
    summary.rangeLabel || "unknown-range"
  ].join(":");
}

function buildRateLimitedUserMessage({ summary = {}, reason = "total" }) {
  const language = summary.language === "en" ? "en" : "ja";
  const slotLabel = getSlotLabel(summary, language);

  if (language === "en") {
    if (reason === "slot") {
      return `Today's new ${slotLabel} has reached its limit. The letter on screen stays available, and the ChatGPT copy feature still works 🍀`;
    }

    return "Today's new AI letters have reached the limit. The letter on screen stays available, and the ChatGPT copy feature still works 🍀";
  }

  if (reason === "slot") {
    return `今日の新しい${slotLabel}は上限に達しました。表示中のお手紙はそのまま読めます。ChatGPTコピー機能も使えます🍀`;
  }

  return "今日の新しいAIお手紙は上限に達しました。表示中のお手紙はそのまま読めます。ChatGPTコピー機能も使えます🍀";
}

function buildGuardError(status, { usageState, config, payload, summary = {}, reason = "manual" }) {
  ensureSlotCounters(usageState);
  const slotKey = normalizeSlot(summary.slot);

  if (status === "rate_limited") {
    usageState.dailyRateLimitedCount += 1;
    usageState.dailySlotRateLimitedCounts[slotKey] = (usageState.dailySlotRateLimitedCounts[slotKey] || 0) + 1;
    usageState.updatedAt = new Date().toISOString();

    return {
      code: "rate_limited",
      message: reason === "slot" ? "Daily AI generation limit reached for this slot." : "Daily AI generation limit reached.",
      userMessage: buildRateLimitedUserMessage({ summary, reason }),
      retryable: false,
      status: 429,
      details: {
        reason,
        usage: buildUsagePayload({ state: usageState, requestUsage: emptyRequestUsage(), config, summary }),
        guard: buildGuardPayload({ state: usageState, config, budgetBlocked: false, summary }),
        clientMode: getClientMode(payload)
      }
    };
  }

  if (status === "budget_stopped") {
    usageState.monthlyBudgetBlockedCount += 1;
    usageState.updatedAt = new Date().toISOString();

    return {
      code: "budget_stopped",
      message: "Monthly AI budget guard is active.",
      userMessage: "今月のAI分析は利用上限に近づいたため、新しいお手紙を少しお休みしています。",
      retryable: false,
      status: 402,
      details: {
        usage: buildUsagePayload({ state: usageState, requestUsage: emptyRequestUsage(), config, summary }),
        guard: buildGuardPayload({ state: usageState, config, budgetBlocked: true, summary }),
        clientMode: getClientMode(payload)
      }
    };
  }

  if (status === "ai_disabled") {
    usageState.monthlyAiDisabledCount += 1;
    usageState.updatedAt = new Date().toISOString();

    return {
      code: "ai_disabled",
      message: "AI generation is currently disabled.",
      userMessage: "AI分析はただいまお休み中です。いつものグルコのお話とChatGPTコピー機能は使えます🍀",
      retryable: false,
      status: 503,
      details: {
        usage: buildUsagePayload({ state: usageState, requestUsage: emptyRequestUsage(), config, summary }),
        guard: buildGuardPayload({ state: usageState, config, budgetBlocked: false, summary }),
        clientMode: getClientMode(payload)
      }
    };
  }

  return null;
}

function emptyRequestUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostJpy: 0
  };
}

function getGuardBlock({ status, usageState, config, summary = {} }) {
  if (status === "cached") return null;
  if (!config.aiEnabled) return { status: "ai_disabled", reason: "ai_disabled" };
  if (usageState.estimatedCostJpy >= config.stopBudgetJpy) return { status: "budget_stopped", reason: "budget" };
  if (usageState.dailyGenerationCount >= config.dailyGenerationLimit) return { status: "rate_limited", reason: "total" };

  const slotKey = normalizeSlot(summary.slot);
  const slotGenerationCount = usageState.dailySlotGenerationCounts?.[slotKey] || 0;
  if (slotGenerationCount >= config.slotGenerationLimit) {
    return { status: "rate_limited", reason: "slot" };
  }

  return null;
}

function recordSuccess({ usageState, status, requestUsage, summary = {} }) {
  ensureSlotCounters(usageState);
  const slotKey = normalizeSlot(summary.slot);

  if (status === "cached") {
    usageState.dailyCacheHitCount += 1;
    usageState.monthlyCacheHitCount += 1;
    usageState.dailySlotCacheHitCounts[slotKey] = (usageState.dailySlotCacheHitCounts[slotKey] || 0) + 1;
  } else {
    usageState.dailyGenerationCount += 1;
    usageState.monthlyGenerationCount += 1;
    usageState.dailySlotGenerationCounts[slotKey] = (usageState.dailySlotGenerationCounts[slotKey] || 0) + 1;
    usageState.inputTokens += requestUsage.inputTokens;
    usageState.outputTokens += requestUsage.outputTokens;
    usageState.estimatedCostJpy = Number((usageState.estimatedCostJpy + requestUsage.estimatedCostJpy).toFixed(4));
  }

  usageState.updatedAt = new Date().toISOString();
}

function buildUsageReport({ state, config }) {
  ensureSlotCounters(state);

  return {
    status: "usage",
    source: "prototype-worker",
    report: {
      today: {
        dayKey: state.dayKey,
        aiGenerationCount: state.dailyGenerationCount,
        cacheHitCount: state.dailyCacheHitCount,
        rateLimitedCount: state.dailyRateLimitedCount,
        slotGenerationCounts: state.dailySlotGenerationCounts,
        slotCacheHitCounts: state.dailySlotCacheHitCounts,
        slotRateLimitedCounts: state.dailySlotRateLimitedCounts,
        slotGenerationLimit: config.slotGenerationLimit
      },
      month: {
        monthKey: state.monthKey,
        aiGenerationCount: state.monthlyGenerationCount,
        cacheHitCount: state.monthlyCacheHitCount,
        budgetBlockedCount: state.monthlyBudgetBlockedCount,
        aiDisabledCount: state.monthlyAiDisabledCount,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        estimatedCostJpy: Number(state.estimatedCostJpy.toFixed(4)),
        monthlyBudgetJpy: config.monthlyBudgetJpy,
        budgetUsageRate: config.monthlyBudgetJpy > 0
          ? Number((state.estimatedCostJpy / config.monthlyBudgetJpy * 100).toFixed(2))
          : 0
      },
      guard: {
        turnstileRequired: false,
        turnstileVerified: false,
        rateLimited: state.dailyGenerationCount >= config.dailyGenerationLimit,
        totalRateLimited: state.dailyGenerationCount >= config.dailyGenerationLimit,
        slotRateLimited: Object.values(state.dailySlotGenerationCounts).some((count) => count >= config.slotGenerationLimit),
        budgetBlocked: state.estimatedCostJpy >= config.stopBudgetJpy,
        budgetWarning: state.estimatedCostJpy >= config.warningBudgetJpy,
        aiEnabled: config.aiEnabled,
        dailyGenerationLimit: config.dailyGenerationLimit,
        dailyGenerationRemaining: Math.max(0, config.dailyGenerationLimit - state.dailyGenerationCount),
        slotGenerationLimit: config.slotGenerationLimit,
        slotGenerationRemainingBySlot: buildSlotRemainingCounts(state, config),
        dailySlotGenerationCounts: state.dailySlotGenerationCounts,
        monthlyBudgetJpy: config.monthlyBudgetJpy,
        warningBudgetJpy: config.warningBudgetJpy,
        stopBudgetJpy: config.stopBudgetJpy,
        monthlyEstimatedCostJpy: Number(state.estimatedCostJpy.toFixed(4))
      },
      storage: {
        kind: state.kind,
        note: state.note,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt
      }
    }
  };
}

export default {
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const config = readGuardConfig(env);
    const usageState = getUsageState(config);

    const url = new URL(request.url);
    if (url.pathname === "/api/gluco-letter/usage" && request.method === "GET") {
      return okResponse(buildUsageReport({
        state: usageState,
        config
      }));
    }

    if (url.pathname !== "/api/gluco-letter") {
      return errorResponse({
        code: "not_found",
        message: "Not found",
        userMessage: "AI分析の入口が見つかりませんでした。"
      }, 404);
    }

    if (request.method !== "POST") {
      return errorResponse({
        code: "method_not_allowed",
        message: "Method not allowed",
        userMessage: "AI分析の呼び出し方法が違うようです。"
      }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return errorResponse({
        code: "invalid_json",
        message: "Invalid JSON",
        userMessage: "AI分析用のデータを読み取れませんでした。"
      }, 400);
    }

    const summary = payload?.summary;
    if (!summary || typeof summary !== "object") {
      return errorResponse({
        code: "missing_summary",
        message: "Missing summary",
        userMessage: "AI分析用の血糖サマリーが見つかりませんでした。"
      }, 400);
    }

    const prototypeStatus = getPrototypeStatus(payload);
    const effectiveUsageState = applyDebugUsageOverrides(usageState, payload);
    const forcedGuardError = buildGuardError(prototypeStatus, {
      usageState,
      config,
      payload,
      summary,
      reason: "manual"
    });

    if (forcedGuardError) {
      const { status, ...errorBody } = forcedGuardError;
      return errorResponse(errorBody, status);
    }

    const guardBlock = getGuardBlock({
      status: prototypeStatus,
      usageState: effectiveUsageState,
      config,
      summary
    });

    if (guardBlock) {
      const guardError = buildGuardError(guardBlock.status, {
        usageState,
        config,
        payload,
        summary,
        reason: guardBlock.reason
      });
      const { status, ...errorBody } = guardError;
      return errorResponse(errorBody, status);
    }

    let generationResult;
    try {
      generationResult = await generateLetter({
        summary,
        payload,
        env,
        config,
        status: prototypeStatus
      });
    } catch (error) {
      console.error("AI letter provider failed", error);

      return errorResponse({
        code: "provider_error",
        message: error.message || "AI letter provider failed.",
        userMessage: "AIお手紙の生成中に小さなエラーが起きました。表示中のお手紙やChatGPTコピー機能はそのまま使えます🍀",
        retryable: true,
        details: {
          provider: config.provider,
          model: config.openAiModel,
          errorCode: error.code || "unknown_provider_error"
        }
      }, 502);
    }

    const requestUsage = generationResult.usage || emptyRequestUsage();

    recordSuccess({
      usageState,
      status: prototypeStatus,
      requestUsage,
      summary
    });

    return okResponse(buildSuccessPayload({
      summary,
      payload,
      status: prototypeStatus,
      usageState,
      requestUsage,
      config,
      generationResult
    }));
  }
};
