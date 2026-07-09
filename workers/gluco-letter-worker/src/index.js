const CONTRACT_VERSION = "gluco-ai-letter-worker-response-v0.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  const slotLabel = summary.slotLabel || (language === "en" ? "current letter" : "今のお手紙");
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

function buildSuccessPayload({ summary, payload, status }) {
  const cached = status === "cached";
  const generatedAt = new Date().toISOString();

  return {
    status,
    source: "prototype-worker",
    clientMode: getClientMode(payload),
    letter: {
      text: buildPrototypeLetter(summary),
      language: summary.language === "en" ? "en" : "ja",
      generatedAt,
      provider: "none",
      model: "prototype-fixed-letter",
      cached,
      cacheKey: null,
      slot: {
        key: summary.slot || "unknown",
        label: summary.slotLabel || ""
      }
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostJpy: 0
    },
    guard: {
      turnstileRequired: false,
      turnstileVerified: false,
      rateLimited: false,
      budgetBlocked: false,
      aiEnabled: true
    }
  };
}

function buildGuardError(status) {
  if (status === "rate_limited") {
    return {
      code: "rate_limited",
      message: "Daily AI generation limit reached.",
      userMessage: "今日のAI分析は上限に近づいています。前回のお手紙やChatGPTコピー機能は使えます🍀",
      retryable: false,
      status: 429
    };
  }

  if (status === "budget_stopped") {
    return {
      code: "budget_stopped",
      message: "Monthly AI budget guard is active.",
      userMessage: "今月のAI分析は利用上限に近づいたため、新しいお手紙を少しお休みしています。",
      retryable: false,
      status: 402
    };
  }

  if (status === "ai_disabled") {
    return {
      code: "ai_disabled",
      message: "AI generation is currently disabled.",
      userMessage: "AI分析はただいまお休み中です。いつものグルコのお話とChatGPTコピー機能は使えます🍀",
      retryable: false,
      status: 503
    };
  }

  return null;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
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
    const guardError = buildGuardError(prototypeStatus);
    if (guardError) {
      const { status, ...errorBody } = guardError;
      return errorResponse(errorBody, status);
    }

    return okResponse(buildSuccessPayload({
      summary,
      payload,
      status: prototypeStatus
    }));
  }
};
