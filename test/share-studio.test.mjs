import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/share-studio.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const about = fs.readFileSync(new URL("../pages/about/share-studio.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

function readPngDimensions(relativeUrl) {
  const bytes = fs.readFileSync(new URL(relativeUrl, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function loadModule() {
  const context = { Object, String, URL, Blob, File: class {}, setTimeout };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "share-studio.js" });
  return context.GlucoScopeShareStudio;
}

function createTextContext() {
  const calls = [];
  const context = {
    font: '700 16px "Yu Gothic"',
    fillStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    measureText(value) {
      const size = Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/u)?.[1] || "16");
      const width = Array.from(String(value ?? "")).reduce((total, character) => (
        total + (/^[\u0000-\u00ff]$/u.test(character) ? size * .56 : size)
      ), 0);
      return { width };
    },
    fillText(value, x, y) {
      calls.push({ value: String(value), x, y, font: this.font, width: this.measureText(value).width });
    }
  };
  return { context, calls };
}

function createRenderDependencies() {
  const imageSources = [];
  const drawImageCalls = [];
  const textCalls = [];
  const gradient = { addColorStop() {} };
  const context = {
    font: '700 16px "Yu Gothic"',
    fillStyle: "",
    strokeStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    imageSmoothingEnabled: true,
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    arc() {},
    rect() {},
    closePath() {},
    fill() {},
    stroke() {},
    clip() {},
    save() {},
    restore() {},
    setLineDash() {},
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    measureText(value) {
      const size = Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/u)?.[1] || "16");
      return { width: Array.from(String(value ?? "")).length * size * .56 };
    },
    fillText(value, x, y) { textCalls.push({ value: String(value), x, y, font: this.font }); },
    drawImage(image, ...coordinates) {
      drawImageCalls.push({ source: image.source, coordinates });
    }
  };
  class FakeImage {
    width = 1080;
    height = 1350;
    set src(value) {
      this.source = value;
      imageSources.push(value);
      queueMicrotask(() => this.onload?.());
    }
  }
  const document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() { return context; },
        toBlob(callback) { callback(new Blob(["png"], { type: "image/png" })); }
      };
    }
  };
  return { document, Image: FakeImage, imageSources, drawImageCalls, textCalls };
}

test("Share Studio normalizes only bounded display metrics", () => {
  const api = loadModule();
  assert.deepEqual({ ...api._testing.normalizeSnapshot({
    glucose: "154",
    arrow: "→",
    tir: "97.0%",
    tar: "3.0%",
    tbr: "0.0%",
    date: "2026/08/18 12:34 and too much text",
    language: "ja",
    connectionUrl: "must-not-pass"
  }) }, {
    glucose: "154",
    arrow: "→",
    tir: "97.0%",
    tar: "3.0%",
    tbr: "0.0%",
    date: "2026/08/18 12:34 and too",
    language: "ja"
  });
  assert.equal(api._testing.safeMetric("https://secret.example"), "--");
  assert.equal(api._testing.normalizeLetter("1行目\r\n- 2行目"), "1行目\n- 2行目");
  assert.throws(
    () => api._testing.normalizeLetter("あ".repeat(1401)),
    /share_studio_letter_too_long/u
  );
});

test("Share Studio creates and stores four slides before completing a trial", () => {
  assert.match(index, /id="mobileShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="mobileShareStudioButton"[\s\S]*Plus・1回体験あり/u);
  assert.match(index, /id="shareStudioAccessNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(index, /js\/share-studio\.js/u);
  assert.match(index, /今日出逢ったグルコ、血糖グラフ、やさしいAIふりかえり/u);
  assert.match(index, /id="shareStudioPreviewGrid"/u);
  assert.match(index, /id="shareStudioHealthConfirm"/u);
  assert.match(index, /id="shareStudioTrialConsumedNotice"[^>]*hidden/u);
  assert.match(index, /無料体験1回分を使用しました/u);
  assert.match(index, /写真アプリにはまだ保存されていません/u);
  assert.match(index, /この画面に保管した4枚を削除する/u);
  assert.match(index, /id="shareStudioTurnstile"[^>]*hidden/u);
  assert.match(index, /3枚目のやさしいふりかえりには集計値だけを送り、接続URL・合言葉・血糖一覧は送りません/u);
  assert.match(app, /requestShareStudioGentleReflection/u);
  assert.match(app, /analysisMode: "letter"/u);
  assert.match(app, /action:\s*"glucoscope-ai-letter"/u);
  assert.match(app, /shareTrialRequestId/u);
  assert.match(app, /reserveShareStudio[\s\S]*generateCarousel[\s\S]*saveCarousel[\s\S]*completeShareStudio/u);
  assert.match(app, /!completionStarted[\s\S]*releaseShareStudio/u);
  assert.match(app, /completionStarted[\s\S]*4枚はこの画面に保管されています/u);
  assert.match(app, /loadCarousel[\s\S]*この画面に保管した4枚を再表示しました/u);
  assert.match(app, /写真アプリへ保存した画像は削除されていません/u);
  assert.match(app, /deleteCarousel/u);
  assert.match(app, /getStoredTodayUnicornDecision[\s\S]*getStoredDailyGlucoDecision/u);
  assert.match(app, /event\.key === "Escape"[\s\S]*closeShareStudio/u);
  assert.match(app, /shareStudioOpener\?\.focus/u);
  assert.match(app, /setInlinePlusNotice\(noticeId, messageKey, \{ focus: true \}\)/u);
  assert.match(source, /generateCarousel/u);
  assert.match(source, /indexedDB/u);
  assert.match(source, /record\.blobs\.length === 4/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(/u);
});

test("Share Studio keeps a verified four-image set in device storage", async () => {
  const api = loadModule();
  let saved = null;
  const store = {
    put(record) {
      saved = record;
      return record;
    },
    get() {
      return saved;
    },
    delete() {
      saved = null;
      return undefined;
    }
  };
  const blobs = Array.from({ length: 4 }, () => new Blob(["png"], { type: "image/png" }));
  const record = await api.saveCarousel(blobs, {
    dateKey: "2026-08-21",
    glucoId: 7,
    accessGrant: "trial"
  }, { store });
  assert.equal(record.blobs.length, 4);
  assert.equal(record.version, 2);
  assert.equal(record.rendererRevision, 7);
  assert.equal(api._testing.isCurrentCarouselRecord(record), true);
  assert.equal(record.dateKey, "2026-08-21");
  assert.equal(record.glucoId, 7);
  assert.equal(record.accessGrant, "trial");
  assert.equal((await api.loadCarousel({ store })).blobs.length, 4);
  assert.equal(api._testing.isCurrentCarouselRecord({ ...record, rendererRevision: 6 }), false);
  await api.deleteCarousel({ store });
  assert.equal(await api.loadCarousel({ store }), null);
});

test("Share Studio keeps legacy local images readable without silently replacing their data", () => {
  const api = loadModule();
  const legacy = {
    key: "latest",
    version: 1,
    dateKey: "2026-08-21",
    blobs: Array.from({ length: 4 }, () => new Blob(["png"], { type: "image/png" }))
  };
  assert.equal(api._testing.validateCarouselRecord(legacy), true);
  assert.equal(api._testing.isCurrentCarouselRecord(legacy), false);
  const loadStart = app.indexOf("const saved = await window.GlucoScopeShareStudio?.loadCarousel?.();");
  const savedStart = app.indexOf("if (saved) {", loadStart);
  assert.ok(loadStart >= 0 && savedStart > loadStart);
  assert.doesNotMatch(app.slice(loadStart, savedStart), /generateCarousel|saveCarousel|reserveShareStudio|completeShareStudio/u);
  assert.match(app, /isCurrentCarouselRecord\?\.\(saved\) === true/u);
  assert.match(app, /以前のレイアウトで保存した4枚を、内容を変えずに表示しています/u);
});

test("Share Studio accepts only an exact local Gluco asset and bounded glucose entries", () => {
  const api = loadModule();
  const model = api._testing.normalizeCarouselModel({
    dateKey: "2026-08-21",
    dateLabel: "2026年8月21日",
    language: "ja",
    metrics: { tir: 90, tar: 8, tbr: 2, glucoScore: 88 },
    entries: [{ date: 1, sgv: 100 }, { date: 2, sgv: 120 }],
    gluco: { id: 7, title: "おすわり", imagePath: "assets/gluco/live/gluco-live-07.png" },
    connectionUrl: "https://must-not-pass.example"
  });
  assert.equal(model.gluco.id, 7);
  assert.equal(model.gluco.imagePath, "assets/gluco/live/gluco-live-07.png");
  assert.equal(model.entries.length, 2);
  assert.throws(() => api._testing.normalizeCarouselModel({
    entries: [{ date: 1, sgv: 100 }],
    gluco: { imagePath: "https://secret.example/gluco.png" }
  }), /daily_gluco_unavailable/u);
});

test("the administrator-quality renderer keeps long Japanese and a score of 100 inside their columns", () => {
  const api = loadModule();
  const { context, calls } = createTextContext();
  context.font = '800 34px "Yu Gothic"';
  const lines = api._testing.wrapLines(
    context,
    "最新の測定では122mg/dLでした。TIRは100.0%で表示中のデータが目標範囲にあります。",
    360
  );
  assert.ok(lines.length > 2);
  assert.ok(lines.every((line) => context.measureText(line).width <= 360));

  const layout = api._testing.fittedParagraphText(
    context,
    "グルコだよ🍀 ".repeat(12) + "今日の数字を、責めずにいっしょに眺めてみようね。".repeat(12),
    110,
    382,
    850,
    640,
    { language: "ja", maxSize: 34, minSize: 20, weight: 800 }
  );
  assert.ok(layout.totalHeight <= 640);
  assert.ok(calls.every((call) => call.width <= 850));

  const scoreSize = api._testing.fittedText(context, "100", 210, 1170, 190, {
    maxSize: 118,
    minSize: 72,
    weight: 900,
    align: "center"
  });
  assert.ok(scoreSize < 118);
  assert.ok(calls.at(-1).width <= 190);
  assert.match(source, /assets\/share-studio\/ending-sunrise\.png/u);
  assert.match(source, /assets\/share-studio\/glucoscope-qr\.png/u);
  assert.doesNotMatch(source, /assets\/gluco\/about\/gluco-small-notice\.png/u);
  assert.doesNotMatch(source, /assets\/gluco\/profile\/gluco\.png/u);
});

test("Share Studio never truncates an overlong gentle letter", () => {
  const api = loadModule();
  const { context, calls } = createTextContext();
  assert.throws(
    () => api._testing.fittedParagraphText(
      context,
      "全文を省略せずに届けるためのやさしい文章です。".repeat(160),
      110,
      382,
      850,
      120,
      { language: "ja", maxSize: 20, minSize: 18, weight: 800 }
    ),
    /share_studio_letter_too_long/u
  );
  assert.equal(calls.length, 0, "an overlong letter must fail before any body text is drawn");
  assert.throws(
    () => api._testing.fittedParagraphText(
      context,
      "A".repeat(200),
      110,
      382,
      850,
      640,
      { language: "en", maxSize: 15, minSize: 15, weight: 800 }
    ),
    /share_studio_letter_too_long/u,
    "an unbreakable token must never be drawn past the panel edge"
  );
  assert.doesNotMatch(source, /chosen\.truncated|maximumLines|ellipsized/u);
  assert.match(app, /全文が安全に収まらなかったため、4枚は作らず、体験回数も使っていません/u);
  assert.match(app, /SHARE_STUDIO_AI_CACHE_NAMESPACE = "share-studio-r6"/u);
  assert.match(app, /getFreshCachedAiLetter\([\s\S]*SHARE_STUDIO_AI_CACHE_NAMESPACE/u);
  assert.match(app, /saveAiLetterLocalCache\([\s\S]*SHARE_STUDIO_AI_CACHE_NAMESPACE/u);
  assert.match(app, /return \(namespace \? \[namespace, \.\.\.parts\] : parts\)\.join\("\|"\)/u);
  const requestStart = app.indexOf("async function requestShareStudioGentleReflection");
  const cacheWrite = app.indexOf("saveAiLetterLocalCache(", requestStart);
  const pendingWrite = app.indexOf("pendingShareStudioGentleReflection =", requestStart);
  const responseReturn = app.indexOf("return Object.freeze({ text: letterText });", requestStart);
  assert.ok(requestStart >= 0 && cacheWrite > requestStart && pendingWrite > cacheWrite && responseReturn > pendingWrite);
  assert.match(app, /pendingShareStudioGentleReflection\?\.key === cacheKey[\s\S]*pendingShareStudioGentleReflection\.text/u);
});

test("Share Studio keeps signed decimals atomic and does not mistake them for list markers", () => {
  const api = loadModule();
  assert.deepEqual(
    [...api._testing.tokenizeLine("-3.5mg/dL +2.0% 24.4％ －4.0mg/dL ＋1.0％")].filter((token) => !/^\s+$/u.test(token)),
    ["-3.5mg/dL", "+2.0%", "24.4％", "－4.0mg/dL", "＋1.0％"]
  );
  const { context, calls } = createTextContext();
  api._testing.fittedParagraphText(
    context,
    "-3.5mg/dLの変化だよ。\n- やさしく眺めようね。\n•急がなくて大丈夫。",
    110,
    382,
    850,
    300,
    { language: "ja", maxSize: 28, minSize: 20, weight: 800 }
  );
  const rendered = calls.map((call) => call.value).join("\n");
  assert.match(rendered, /-3\.5mg\/dL/u);
  assert.doesNotMatch(rendered, /・ 3\.5mg\/dL/u);
  assert.match(rendered, /・ やさしく眺めようね/u);
  assert.match(rendered, /・ 急がなくて大丈夫/u);
});

test("Share Studio preserves the full gentle analysis in one fitted panel with readable section breaks", async () => {
  const api = loadModule();
  const dependencies = createRenderDependencies();
  await api.generateCarousel({
    dateKey: "2026-08-22",
    dateLabel: "2026年8月22日(土)",
    language: "ja",
    metrics: { tir: 96.7, tar: 3.3, tbr: 0, average: 117, cv: 21.8, gmi: 6.1, glucoScore: 98 },
    entries: [{ date: Date.UTC(2026, 7, 22, 0), sgv: 117 }],
    gluco: { id: 3, title: "ボールあそび", imagePath: "assets/gluco/live/gluco-live-03.png" },
    letter: "🌿 全体の流れ - 夜のお手紙の集計だね。TIRは96.7％で、表示中のほとんどの時間が目標範囲の中だよ。📊数字の手がかり - ちょっと見てみようね。平均は117mg/dLで、CVは21.8％だったよ。🔎 気になった動き：少しだけ気になったよ。GlucoScoreは98で、比較期間の78より20高く見えているよ。🌱明日の小さな見返し–ぼくはここにいるよ🍀。余裕があるときに、今日の数字をそっと振り返ってみようね。"
  }, dependencies);
  const bodyCalls = dependencies.textCalls.filter((call) => call.x === 110 && call.y >= 382 && call.y < 1100);
  const rendered = bodyCalls.map((call) => call.value).join("\n");
  assert.match(rendered, /🌿 全体の流れ/u);
  assert.match(rendered, /・ 夜のお手紙の集計だね/u);
  assert.match(rendered, /TIRは96\.7％/u);
  assert.match(rendered, /📊数字の手がかり/u);
  assert.match(rendered, /平均は117mg\/dL/u);
  assert.match(rendered, /CVは21\.8％/u);
  assert.match(rendered, /比較期間の78/u);
  assert.match(rendered, /余裕があるとき/u);
  assert.match(rendered, /ぼくはここにいるよ🍀/u);
  assert.doesNotMatch(source, /compactLetterSections|selectSubstantiveLetterSentence|drawLetterSections/u);
  assert.ok(bodyCalls.every((call) => call.x === 110 && call.y <= 1022));
});

test("the renderer preserves English decimals and never joins a sensor gap", () => {
  const api = loadModule();
  const { context, calls } = createTextContext();
  api._testing.fittedParagraphText(
    context,
    "CV is 24.4%. TIR is 100.0%. These are gentle clues, not grades.",
    10,
    30,
    620,
    180,
    { language: "en", maxSize: 31, minSize: 19, weight: 800 }
  );
  const rendered = calls.map((call) => call.value).join(" ");
  assert.match(rendered, /24\.4%/u);
  assert.match(rendered, /100\.0%/u);
  assert.doesNotMatch(rendered, /24\.\s+4%|100\.\s+0%/u);

  const minute = 60 * 1000;
  const segments = api._testing.splitGraphSegments([
    { date: 0, sgv: 100 },
    { date: 5 * minute, sgv: 110 },
    { date: 65 * minute, sgv: 120 },
    { date: 70 * minute, sgv: 125 }
  ]);
  assert.equal(segments.length, 2);
  assert.deepEqual(Array.from(segments, (segment) => segment.length), [2, 2]);
});

test("the four-image renderer loads the reviewed ending art and current public QR", async () => {
  const api = loadModule();
  const dependencies = createRenderDependencies();
  dependencies.endingCardIndex = 0;
  const blobs = await api.generateCarousel({
    dateKey: "2026-08-22",
    dateLabel: "2026年8月22日",
    language: "ja",
    metrics: {
      glucose: 112,
      tir: 100,
      tar: 0,
      tbr: 0,
      averageGlucose: 112,
      cv: 17.4,
      gmi: 6,
      glucoScore: 100,
      previousScore: 92,
      sevenDayAverageScore: 94
    },
    entries: [
      { date: Date.UTC(2026, 7, 22, 0, 0), sgv: 108 },
      { date: Date.UTC(2026, 7, 22, 0, 5), sgv: 112 }
    ],
    treatments: [],
    gluco: { id: 3, title: "ボールあそび", imagePath: "assets/gluco/live/gluco-live-03.png" },
    letter: "グルコだよ🍀 来てくれてうれしいよ。🌿 全体の流れ・TIRは95.4%だよ。TARは4.6%だよ。📊 数字の手がかり・平均血糖は120mg/dLだよ。CVは22.1%だよ。🔎 気になった動き・数字は答えではなく手がかりだよ。🌙 もうひとつ・GlucoScoreは98だよ。🌱 今日の見返し・急いで答えにしなくて大丈夫だよ。"
  }, dependencies);
  assert.equal(blobs.length, 4);
  assert.deepEqual(dependencies.imageSources, [
    "assets/gluco/live/gluco-live-03.png",
    "assets/gluco/ui/gluco-peek-clover.png",
    "assets/share-studio/ending-sunrise.png",
    "assets/share-studio/glucoscope-qr.png"
  ]);
  assert.ok(dependencies.drawImageCalls.some((call) => call.source === "assets/share-studio/ending-sunrise.png"));
  assert.ok(dependencies.drawImageCalls.some((call) => call.source === "assets/share-studio/glucoscope-qr.png"));
  assert.ok(dependencies.textCalls.some((call) => call.value.includes("グルコからのお手紙")));
  assert.ok(dependencies.textCalls.some((call) => call.value.includes("やさしいAI分析")));
  for (const marker of ["🌿", "📊", "🔎", "🌱"]) {
    assert.ok(dependencies.textCalls.some((call) => call.x === 110 && call.value.startsWith(marker)));
  }
  const gentleBodyLines = dependencies.textCalls.filter((call) => call.x === 110 && call.y >= 382 && call.y < 1100);
  assert.ok(gentleBodyLines.length >= 5);
  assert.ok(gentleBodyLines.every((call) => call.y <= 1022));
  assert.deepEqual(readPngDimensions("../assets/share-studio/ending-sunrise.png"), { width: 1080, height: 1350 });
  assert.deepEqual(readPngDimensions("../assets/share-studio/glucoscope-qr.png"), { width: 256, height: 256 });
});

test("each new user Share Studio set randomly selects only one of the ten reviewed ending cards", () => {
  const api = loadModule();
  const paths = Array.from(api._testing.endingCardPaths);
  assert.deepEqual(paths, [
    "assets/share-studio/ending-sunrise.png",
    "assets/share-studio/ending-02-night.webp",
    "assets/share-studio/ending-03-seaside.webp",
    "assets/share-studio/ending-04-rainbow.webp",
    "assets/share-studio/ending-05-clover-field.webp",
    "assets/share-studio/ending-06-snow.webp",
    "assets/share-studio/ending-07-sunset.webp",
    "assets/share-studio/ending-08-cherry-blossom.webp",
    "assets/share-studio/ending-09-flower-meadow.webp",
    "assets/share-studio/ending-10-forest.webp"
  ]);
  paths.forEach((path, index) => {
    assert.equal(api._testing.selectEndingCardPath({ endingCardIndex: index }), path);
    assert.equal(fs.existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} must be shipped`);
  });
  assert.equal(api._testing.selectEndingCardPath({
    crypto: { getRandomValues(values) { values[0] = 9; return values; } }
  }), paths[9]);
  assert.equal(api._testing.selectEndingCardPath({ random: () => 0.4 }), paths[4]);
  assert.match(about, /10種類の締めくくりカードからランダムに1枚/u);
  assert.match(about, /selected at random from ten reviewed designs/u);
});

test("the free trial is separate from purchase and explains Share Studio before email verification", () => {
  assert.match(index, /id="shareStudioTrialDialog"[^>]*aria-modal="true"[^>]*hidden/u);
  assert.match(index, /メールを確認するだけで、4枚セットを1回作れます/u);
  assert.match(app, /shareStudioTrialLead: "Verify an email to create one set of four reflection images\."/u);
  assert.match(index, /この確認では料金はかかりません/u);
  assert.match(index, /クレジットカード情報は入力しません/u);
  assert.match(index, /Stripeで400円の支払いを完了した時だけ料金が発生します/u);
  assert.match(index, /id="shareStudioTrialVerifyButton"[^>]*>無料体験のためメールを確認する（課金なし）<\/button>/u);
  assert.match(index, /id="shareStudioTrialUsedContent"[^>]*hidden/u);
  assert.match(index, /id="shareStudioTrialPurchaseButton"[^>]*hidden>Plus 30日パスを見る<\/button>/u);
  assert.match(index, /href="pages\/about\/share-studio\.html"/u);
  assert.match(app, /const opener = event\?\.currentTarget \|\| document\.activeElement[\s\S]*openShareStudioTrialDialog\(opener, \{ mode: "verify" \}\)/u);
  assert.match(app, /access\.reason === "plus_required"[\s\S]*openShareStudioTrialDialog\(opener, \{ mode: "used" \}\)/u);
  assert.doesNotMatch(app, /event\?\.currentTarget\?\.id === "mobileShareStudioButton"[\s\S]*openLocalProfileDialog/u);
  assert.match(app, /trialAlreadyUsed[\s\S]*plusEntitlementClient\?\.refresh[\s\S]*mode: "used"/u);
  assert.match(app, /entryContext: "share_trial"/u);
  assert.match(app, /shareStudioTrialSendCodeButton: "無料体験の確認コードを送る（課金なし）"/u);
  assert.match(app, /shareStudioTrialGuardianConfirmed: "私は保護者として、この無料体験のメール確認を管理します"/u);
  assert.match(index, /Share Studioとは？<\/span><span[^>]*>できることを見る<\/span>/u);
  assert.match(app, /shareStudioTrialProfileTitle: "Share Studioを1回無料で試す"/u);
  assert.match(app, /profileDialogCard\?\.classList\.toggle\("is-share-trial-entry", shareTrialEntry\)/u);
  for (const id of ["localProfileDisplayNameField", "usageProfileCard", "usageProfileStatus", "localProfileStatus", "localProfileActions"]) {
    assert.match(style, new RegExp(`\\.local-profile-dialog-card\\.is-share-trial-entry #${id}`, "u"), id);
  }

  const openStart = app.indexOf("const openShareStudio = async (event) => {");
  const openEnd = app.indexOf('["mobileShareStudioButton", "plusAccountShareStudioButton"]', openStart);
  const openHandler = app.slice(openStart, openEnd);
  assert.doesNotMatch(openHandler, /setPlusFeatureNotice\(/u);

  assert.match(about, /4枚の画像/u);
  assert.doesNotMatch(`${index}\n${app}\n${about}`, /カルーセル/u);
  assert.match(app, /Share Studioの4枚セットを1回無料で作れます/u);
  assert.match(app, /one free set of four Share Studio images/u);
  assert.doesNotMatch(app, /one Share Studio image|Share Studioの画像を1回|Four slides are saved/u);
  assert.match(about, /その日にGlucoScopeで実際に出逢ったグルコ/u);
  assert.match(about, /画面を閉じても、保存済みの4枚/u);
  assert.match(about, /メール確認だけでは料金はかかりません/u);
  assert.match(about, /クレジットカード情報も入力しません/u);
  assert.match(about, /4枚はこのブラウザの中で作り/u);
  assert.match(about, /確認済みメールを見分ける印だけを保存します/u);
  assert.match(about, /メールアドレスそのものは、この記録に残しません/u);
  assert.doesNotMatch(about, /メールへ戻せない照合用の印/u);
  assert.match(about, /健康情報が含まれます/u);
  assert.match(about, /window\.navigator\.standalone === true[\s\S]*ios-home-screen-app/u);
  assert.match(style, /html\.ios-home-screen-app:not\(\.force-desktop-view\) \.about-detail-wrap/u);
  assert.match(style, /html\.ios-home-screen-app:not\(\.force-desktop-view\) \.share-studio-dialog/u);
  assert.match(style, /\.share-studio-dialog\{[^}]*height:100dvh[^}]*safe-area-inset-top/u);
  assert.match(about, /analytics-loader\.js/u);
});
