(function initializeGlucoScopeShareStudio(root) {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const DB_NAME = "glucoscope.shareStudio.v1";
  const DB_VERSION = 1;
  const STORE_NAME = "carousels";
  const LATEST_KEY = "latest";
  const RECORD_VERSION = 1;
  const VALUE_PATTERN = /^(?:--|\d{1,3}(?:\.\d)?%?)$/u;
  const SAFE_ASSET_PATTERN = /^assets\/gluco\/(?:live|unicorn|ui|profile)\/[a-z0-9._-]+\.png$/u;

  function safeMetric(value, fallback = "--") {
    const text = String(value ?? "").trim();
    return text.length <= 8 && VALUE_PATTERN.test(text) ? text : fallback;
  }

  function finiteMetric(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeText(value, maximum = 120) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maximum);
  }

  function safeAssetPath(value) {
    const path = String(value || "").trim();
    return SAFE_ASSET_PATTERN.test(path) ? path : "";
  }

  function normalizeSnapshot(input = {}) {
    return Object.freeze({
      glucose: safeMetric(input.glucose),
      arrow: ["↘", "↓", "↙", "→", "↗", "↑", "⇈", "⇊"].includes(input.arrow)
        ? input.arrow
        : "→",
      tir: safeMetric(input.tir),
      tar: safeMetric(input.tar),
      tbr: safeMetric(input.tbr),
      date: safeText(input.date, 24),
      language: input.language === "en" ? "en" : "ja"
    });
  }

  function normalizeCarouselModel(input = {}) {
    const language = input.language === "en" ? "en" : "ja";
    const metrics = input.metrics || {};
    const gluco = input.gluco || {};
    const entries = (Array.isArray(input.entries) ? input.entries : [])
      .map((entry) => ({ date: finiteMetric(entry?.date), sgv: finiteMetric(entry?.sgv) }))
      .filter((entry) => Number.isFinite(entry.date) && Number.isFinite(entry.sgv))
      .sort((a, b) => a.date - b.date)
      .slice(-3000);
    const imagePath = safeAssetPath(gluco.imagePath);
    if (!imagePath) throw new Error("daily_gluco_unavailable");
    if (!entries.length) throw new Error("glucose_unavailable");

    return Object.freeze({
      dateKey: safeText(input.dateKey, 10),
      dateLabel: safeText(input.dateLabel, 48),
      language,
      metrics: Object.freeze({
        glucose: finiteMetric(metrics.glucose),
        direction: ["↘", "↓", "↙", "→", "↗", "↑", "⇈", "⇊"].includes(metrics.direction)
          ? metrics.direction
          : "→",
        tir: finiteMetric(metrics.tir),
        tar: finiteMetric(metrics.tar),
        tbr: finiteMetric(metrics.tbr),
        averageGlucose: finiteMetric(metrics.averageGlucose),
        cv: finiteMetric(metrics.cv),
        gmi: finiteMetric(metrics.gmi),
        glucoScore: finiteMetric(metrics.glucoScore),
        previousScore: finiteMetric(metrics.previousScore),
        sevenDayAverageScore: finiteMetric(metrics.sevenDayAverageScore)
      }),
      entries: Object.freeze(entries),
      gluco: Object.freeze({
        id: finiteMetric(gluco.id),
        title: safeText(gluco.title, 48),
        imagePath,
        isUnicorn: Boolean(gluco.isUnicorn)
      }),
      letter: safeText(input.letter, 1400)
    });
  }

  function roundedPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function panel(context, x, y, width, height, radius = 34, fill = "rgba(255,255,255,.06)") {
    roundedPath(context, x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.10)";
    context.lineWidth = 2;
    context.stroke();
  }

  function drawText(context, value, x, y, options = {}) {
    const { size = 32, weight = 700, color = "#f8fafc", align = "left", baseline = "alphabetic" } = options;
    context.font = `${weight} ${size}px "Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, sans-serif`;
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(String(value ?? ""), x, y);
  }

  function wrapLines(context, value, maximumWidth) {
    const tokens = String(value || "").replace(/\r/gu, "").split(/(?<=。|！|？|\s)/u);
    const lines = [];
    let line = "";
    for (const token of tokens) {
      const candidate = `${line}${token}`;
      if (!line || context.measureText(candidate).width <= maximumWidth) line = candidate;
      else {
        lines.push(line.trim());
        line = token.trimStart();
      }
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function drawWrapped(context, value, x, y, maximumWidth, options = {}) {
    const { size = 32, weight = 700, color = "#f8fafc", lineHeight = Math.round(size * 1.55), maxLines = 12 } = options;
    drawText(context, "", x, y, { size, weight, color });
    const lines = wrapLines(context, value, maximumWidth).slice(0, maxLines);
    lines.forEach((line, index) => drawText(context, line, x, y + (index * lineHeight), { size, weight, color }));
    return lines.length;
  }

  function background(context) {
    const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, "#153047");
    gradient.addColorStop(.55, "#102238");
    gradient.addColorStop(1, "#07111f");
    context.fillStyle = gradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    const glow = context.createRadialGradient(120, 80, 20, 120, 80, 620);
    glow.addColorStop(0, "rgba(74,222,128,.22)");
    glow.addColorStop(1, "rgba(74,222,128,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function header(context, title, model, slideNumber) {
    drawText(context, title, 70, 88, { size: 38, weight: 900 });
    drawText(context, model.dateLabel, 70, 136, { size: 24, weight: 650, color: "#a9bad2" });
    drawText(context, `SLIDE ${slideNumber} / 4`, 1010, 88, { size: 20, weight: 850, color: "#86efac", align: "right" });
  }

  function footer(context, language) {
    drawText(context, "🍀 GlucoScope", 70, 1282, { size: 28, weight: 900, color: "#bbf7d0" });
    drawText(context, language === "en" ? "Understand today. Improve tomorrow." : "今日を知って、明日を少しやさしく。", 1010, 1282, { size: 22, weight: 650, color: "#91a7c2", align: "right" });
  }

  function createCanvas(documentObject) {
    const canvas = documentObject?.createElement?.("canvas");
    if (!canvas) throw new Error("canvas_unavailable");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    return canvas;
  }

  function loadImage(source, dependencies = {}) {
    const ImageConstructor = dependencies.Image || root.Image;
    if (!ImageConstructor) return Promise.reject(new Error("image_unavailable"));
    return new Promise((resolve, reject) => {
      const image = new ImageConstructor();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image_unavailable"));
      image.src = source;
    });
  }

  function drawCover(context, model, glucoImage) {
    background(context);
    header(context, model.language === "en" ? "🍀 Today’s reflection" : "🍀 今日のふりかえり", model, 1);
    panel(context, 70, 185, 940, 690, 46, "rgba(255,255,255,.055)");
    const ratio = Math.min(760 / glucoImage.width, 610 / glucoImage.height);
    const width = glucoImage.width * ratio;
    const height = glucoImage.height * ratio;
    context.drawImage(glucoImage, 540 - (width / 2), 220 + ((610 - height) / 2), width, height);
    drawText(context, model.language === "en" ? "The Gluco you met today" : "今日出逢ったグルコ", 540, 925, { size: 26, weight: 800, color: "#bbf7d0", align: "center" });
    const glucoNumber = Number.isFinite(model.gluco.id) ? `No. ${String(model.gluco.id).padStart(2, "0")} · ` : "";
    drawText(context, `${glucoNumber}${model.gluco.title}`, 540, 970, { size: 30, weight: 850, align: "center" });
    panel(context, 70, 1010, 940, 190, 36, "rgba(34,197,94,.10)");
    drawText(context, Number.isFinite(model.metrics.glucoScore) ? Math.round(model.metrics.glucoScore) : "--", 120, 1147, { size: 104, weight: 900, color: "#4ade80" });
    drawText(context, "GlucoScore", 330, 1080, { size: 25, weight: 850, color: "#bbf7d0" });
    const scoreCopy = model.language === "en"
      ? "A clue for gentle reflection — never a score of your effort."
      : "努力を採点する点数ではなく、やさしく振り返るための手がかりです。";
    drawWrapped(context, scoreCopy, 330, 1130, 610, { size: 27, weight: 700, color: "#dbe7f5", lineHeight: 43, maxLines: 2 });
    footer(context, model.language);
  }

  function drawMetricCard(context, label, value, detail, x, y, color) {
    panel(context, x, y, 285, 170, 30);
    drawText(context, label, x + 28, y + 48, { size: 25, weight: 850, color: "#b7c7da" });
    drawText(context, value, x + 28, y + 112, { size: 48, weight: 900, color });
    drawText(context, detail, x + 28, y + 148, { size: 18, weight: 600, color: "#8fa5bf" });
  }

  function drawGraph(context, entries) {
    const x = 92;
    const y = 680;
    const width = 896;
    const height = 430;
    panel(context, 70, 635, 940, 535, 36, "rgba(2,6,23,.30)");
    const times = entries.map((entry) => entry.date);
    const minimumTime = Math.min(...times);
    const maximumTime = Math.max(...times);
    const timeRange = Math.max(1, maximumTime - minimumTime);
    const projectX = (time) => x + (((time - minimumTime) / timeRange) * width);
    const projectY = (value) => y + height - (((Math.max(40, Math.min(250, value)) - 40) / 210) * height);
    context.fillStyle = "rgba(34,197,94,.10)";
    context.fillRect(x, projectY(180), width, projectY(70) - projectY(180));
    [70, 180].forEach((value) => {
      context.strokeStyle = value === 70 ? "#f472b6" : "#fbbf24";
      context.setLineDash([12, 10]);
      context.beginPath();
      context.moveTo(x, projectY(value));
      context.lineTo(x + width, projectY(value));
      context.stroke();
    });
    context.setLineDash([]);
    context.strokeStyle = "#38bdf8";
    context.lineWidth = 7;
    context.lineJoin = "round";
    context.beginPath();
    entries.forEach((entry, index) => {
      const px = projectX(entry.date);
      const py = projectY(entry.sgv);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
    drawText(context, "250", 82, y + 8, { size: 18, weight: 700, color: "#8297b2", align: "right" });
    drawText(context, "40", 82, y + height, { size: 18, weight: 700, color: "#8297b2", align: "right" });
  }

  function drawData(context, model) {
    background(context);
    header(context, model.language === "en" ? "📊 A day in numbers" : "📊 数字から見える一日", model, 2);
    const metrics = model.metrics;
    drawMetricCard(context, "TIR", `${metrics.tir ?? "--"}%`, "70–180 mg/dL", 70, 190, "#4ade80");
    drawMetricCard(context, "TAR", `${metrics.tar ?? "--"}%`, "> 180 mg/dL", 398, 190, "#fbbf24");
    drawMetricCard(context, "TBR", `${metrics.tbr ?? "--"}%`, "< 70 mg/dL", 726, 190, "#fb7185");
    drawMetricCard(context, model.language === "en" ? "AVERAGE" : "平均", `${metrics.averageGlucose ?? "--"}`, "mg/dL", 70, 390, "#f8fafc");
    drawMetricCard(context, "CV", `${metrics.cv ?? "--"}%`, model.language === "en" ? "variability" : "血糖のばらつき", 398, 390, "#c4b5fd");
    drawMetricCard(context, "GMI", `${metrics.gmi ?? "--"}%`, model.language === "en" ? "estimated" : "推定値", 726, 390, "#93c5fd");
    drawText(context, model.language === "en" ? "📈 Today’s glucose graph" : "📈 今日の血糖グラフ", 90, 620, { size: 29, weight: 850 });
    drawGraph(context, model.entries);
    footer(context, model.language);
  }

  function defaultLetter(model) {
    if (model.language === "en") return "Gluco is here 🍀 Today’s numbers are not a grade. They are small clues that can help you look back with kindness and understand tomorrow a little better.";
    return "グルコだよ🍀 今日の数字は、がんばりを採点するものじゃないよ。明日を少しやさしく考えるための、小さな手がかりとして一緒に眺めてみようね。";
  }

  function drawLetter(context, model, peekImage) {
    background(context);
    header(context, model.language === "en" ? "💌 A letter from Gluco" : "💌 グルコからのお手紙", model, 3);
    panel(context, 70, 190, 940, 940, 46, "rgba(255,255,255,.055)");
    drawText(context, model.language === "en" ? "🍀 Gentle reflection" : "🍀 やさしいふりかえり", 110, 280, { size: 31, weight: 900, color: "#86efac" });
    drawWrapped(context, model.letter || defaultLetter(model), 110, 370, 850, {
      size: model.language === "en" ? 31 : 35,
      weight: 750,
      color: "#eef6ff",
      lineHeight: model.language === "en" ? 51 : 58,
      maxLines: 12
    });
    if (peekImage) context.drawImage(peekImage, 720, 895, 220, 220);
    drawText(context, model.language === "en" ? "Not medical advice" : "医療判断を置き換えるものではありません", 110, 1088, { size: 22, weight: 650, color: "#91a7c2" });
    footer(context, model.language);
  }

  function drawEnding(context, model, profileImage) {
    background(context);
    header(context, model.language === "en" ? "🍀 A gentle moment to share" : "🍀 やさしい時間を、たいせつな人へ", model, 4);
    panel(context, 70, 205, 940, 875, 50, "rgba(34,197,94,.09)");
    if (profileImage) {
      const ratio = Math.min(440 / profileImage.width, 360 / profileImage.height);
      const width = profileImage.width * ratio;
      const height = profileImage.height * ratio;
      context.drawImage(profileImage, 540 - (width / 2), 265 + ((360 - height) / 2), width, height);
    }
    drawText(context, "GlucoScope", 540, 735, { size: 72, weight: 900, align: "center" });
    const copy = model.language === "en"
      ? "Every number has a story.\nEvery story deserves kindness."
      : "ひとつひとつの数字に、物語がある。\nその物語に、やさしさを。";
    copy.split("\n").forEach((line, index) => drawText(context, line, 540, 825 + (index * 62), { size: 38, weight: 800, color: "#dff8e9", align: "center" }));
    drawText(context, "Understand today. Improve tomorrow.", 540, 990, { size: 28, weight: 700, color: "#9fb1c9", align: "center" });
    drawText(context, "glucoscope.app", 540, 1040, { size: 30, weight: 850, color: "#55d894", align: "center" });
    footer(context, model.language);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image_failed")), "image/png");
    });
  }

  async function generateCarousel(input = {}, dependencies = {}) {
    const model = normalizeCarouselModel(input);
    const documentObject = dependencies.document || root.document;
    const [glucoImage, peekImage, profileImage] = await Promise.all([
      loadImage(model.gluco.imagePath, dependencies),
      loadImage("assets/gluco/ui/gluco-peek-clover.png", dependencies).catch(() => null),
      loadImage("assets/gluco/profile/gluco.png", dependencies).catch(() => null)
    ]);
    const canvases = Array.from({ length: 4 }, () => createCanvas(documentObject));
    const contexts = canvases.map((canvas) => canvas.getContext("2d"));
    if (contexts.some((context) => !context)) throw new Error("canvas_unavailable");
    drawCover(contexts[0], model, glucoImage);
    drawData(contexts[1], model);
    drawLetter(contexts[2], model, peekImage);
    drawEnding(contexts[3], model, profileImage);
    return Promise.all(canvases.map(canvasToBlob));
  }

  function validateCarouselRecord(record) {
    return Boolean(record && record.version === RECORD_VERSION && record.key === LATEST_KEY
      && Array.isArray(record.blobs) && record.blobs.length === 4
      && record.blobs.every((blob) => blob instanceof Blob && blob.type === "image/png"));
  }

  function openDatabase(indexedDb = root.indexedDB) {
    if (!indexedDb?.open) return Promise.reject(new Error("storage_unavailable"));
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("storage_unavailable"));
    });
  }

  async function withStore(mode, operation, dependencies = {}) {
    if (dependencies.store) return operation(dependencies.store);
    const database = await openDatabase(dependencies.indexedDB);
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = operation(store);
        let result;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error || new Error("storage_failed"));
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(transaction.error || new Error("storage_failed"));
        transaction.onerror = () => reject(transaction.error || new Error("storage_failed"));
      });
    } finally {
      database.close();
    }
  }

  async function saveCarousel(blobs, metadata = {}, dependencies = {}) {
    const record = {
      key: LATEST_KEY,
      version: RECORD_VERSION,
      createdAt: new Date().toISOString(),
      dateKey: safeText(metadata.dateKey, 10),
      glucoId: finiteMetric(metadata.glucoId),
      blobs: Array.isArray(blobs) ? blobs : []
    };
    if (!validateCarouselRecord(record)) throw new Error("storage_invalid");
    await withStore("readwrite", (store) => store.put(record), dependencies);
    const saved = await loadCarousel(dependencies);
    if (!validateCarouselRecord(saved)) throw new Error("storage_failed");
    return saved;
  }

  async function loadCarousel(dependencies = {}) {
    const record = await withStore("readonly", (store) => store.get(LATEST_KEY), dependencies);
    return validateCarouselRecord(record) ? record : null;
  }

  async function deleteCarousel(dependencies = {}) {
    await withStore("readwrite", (store) => store.delete(LATEST_KEY), dependencies);
    return Object.freeze({ ok: true });
  }

  function fileName(record, index) {
    const dateKey = /^\d{4}-\d{2}-\d{2}$/u.test(record?.dateKey || "") ? record.dateKey : "today";
    return `glucoscope-${dateKey}-slide-${index + 1}.png`;
  }

  async function shareCarousel(record, language = "ja") {
    if (!validateCarouselRecord(record)) throw new Error("image_unavailable");
    const files = record.blobs.map((blob, index) => new File([blob], fileName(record, index), { type: "image/png" }));
    if (typeof root.navigator?.share === "function" && root.navigator.canShare?.({ files })) {
      await root.navigator.share({ files, title: "GlucoScope", text: language === "en" ? "My GlucoScope reflection 🍀" : "GlucoScopeのやさしいふりかえり 🍀" });
      return Object.freeze({ status: "shared" });
    }
    record.blobs.forEach((blob, index) => {
      root.setTimeout(() => {
        const url = URL.createObjectURL(blob);
        const link = root.document.createElement("a");
        link.href = url;
        link.download = fileName(record, index);
        link.click();
        root.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, index * 350);
    });
    return Object.freeze({ status: "downloaded" });
  }

  root.GlucoScopeShareStudio = Object.freeze({
    generateCarousel,
    saveCarousel,
    loadCarousel,
    deleteCarousel,
    shareCarousel,
    _testing: Object.freeze({ normalizeSnapshot, normalizeCarouselModel, safeMetric, safeAssetPath, validateCarouselRecord, fileName })
  });
})(typeof window !== "undefined" ? window : globalThis);
