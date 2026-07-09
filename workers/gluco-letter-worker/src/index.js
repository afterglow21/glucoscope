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

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/gluco-letter") {
      return jsonResponse({ ok: false, error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const summary = payload?.summary;
    if (!summary || typeof summary !== "object") {
      return jsonResponse({ ok: false, error: "Missing summary" }, 400);
    }

    return jsonResponse({
      ok: true,
      source: "prototype-worker",
      aiProvider: "none",
      cached: false,
      generatedAt: new Date().toISOString(),
      letter: buildPrototypeLetter(summary)
    });
  }
};
