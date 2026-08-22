(function initializeGlucoScopeShareStudio(root) {
  "use strict";

  // Canvas composition is adapted from the reviewed administrator Social
  // Share Studio renderer. Authentication, data loading, Plus checks and
  // browser storage deliberately remain in the public app's own boundary.

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const DB_NAME = "glucoscope.shareStudio.v1";
  const DB_VERSION = 1;
  const STORE_NAME = "carousels";
  const LATEST_KEY = "latest";
  const RECORD_VERSION = 2;
  const LEGACY_RECORD_VERSION = 1;
  const RENDERER_REVISION = 7;
  const FONT = '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Segoe UI", "Segoe UI Emoji", sans-serif';
  const VALUE_PATTERN = /^(?:--|\d{1,3}(?:\.\d)?%?)$/u;
  const SAFE_ASSET_PATTERN = /^assets\/gluco\/(?:live|unicorn|ui|profile)\/[a-z0-9._-]+\.png$/u;
  const ENDING_CARD_PATHS = Object.freeze([
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

  function normalizeLetter(value, maximum = 1400) {
    const text = String(value ?? "")
      .replace(/\r\n?/gu, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
      .trim();
    if (text.length > maximum) throw new Error("share_studio_letter_too_long");
    return text;
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
    const defaultRangeStart = entries[0]?.date;
    const defaultRangeEnd = entries[entries.length - 1]?.date;
    const rangeStart = finiteMetric(input.rangeStart, defaultRangeStart);
    const rangeEnd = finiteMetric(input.rangeEnd, defaultRangeEnd);
    const treatments = (Array.isArray(input.treatments) ? input.treatments : [])
      .map((treatment) => ({
        date: finiteMetric(treatment?.date),
        kind: treatment?.kind === "correction" ? "correction" : "meal"
      }))
      .filter((treatment) => Number.isFinite(treatment.date)
        && treatment.date >= rangeStart
        && treatment.date <= rangeEnd)
      .slice(-500);
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
      treatments: Object.freeze(treatments),
      rangeStart,
      rangeEnd,
      gluco: Object.freeze({
        id: finiteMetric(gluco.id),
        title: safeText(gluco.title, 48),
        imagePath,
        isUnicorn: Boolean(gluco.isUnicorn)
      }),
      letter: normalizeLetter(input.letter)
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

  function panel(context, x, y, width, height, radius = 30, fill = "rgba(255,255,255,.055)", stroke = "rgba(255,255,255,.09)") {
    roundedPath(context, x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 2;
      context.stroke();
    }
  }

  function drawText(context, value, x, y, options = {}) {
    const { size = 32, weight = 700, color = "#f8fafc", align = "left", baseline = "alphabetic" } = options;
    context.font = `${weight} ${size}px ${FONT}`;
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(String(value ?? ""), x, y);
  }

  function isClosingPunctuation(token) {
    return /^[、。，．！？!?：:；;）)］\]｝}〉》」』】％%]$/u.test(token);
  }

  function tokenizeLine(value) {
    return String(value || "").match(
      /[+＋\-−－]?\d+(?:\.\d+)?(?:\s?(?:%|％|mg\/dL|mg\/dl|U))?|[A-Za-z]+(?:[’'\-][A-Za-z]+)*|\s+|./gu
    ) || [];
  }

  function wrapLines(context, value, maximumWidth) {
    const tokens = tokenizeLine(String(value || "").replace(/\r/gu, ""));
    const lines = [];
    let line = "";
    for (const token of tokens) {
      const normalizedToken = /^\s+$/u.test(token) ? " " : token;
      const candidate = `${line}${normalizedToken}`;
      if (!line || context.measureText(candidate).width <= maximumWidth || isClosingPunctuation(normalizedToken)) {
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = normalizedToken.trimStart();
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }

  function normalizeProse(value, language) {
    return String(value || "")
      .replace(/\r/gu, "")
      .split(/\n+/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(language === "en" ? " " : "");
  }

  function splitSentences(value, language) {
    const normalized = normalizeProse(value, language);
    if (!normalized) return [];
    const decimalMarker = "\uE000";
    const protectedValue = language === "en"
      ? normalized.replace(/(\d)\.(?=\d)/gu, `$1${decimalMarker}`)
      : normalized;
    const pattern = language === "en"
      ? /[^.!?]+(?:[.!?]+|$)/gu
      : /[^。！？!?]+(?:[。！？!?]+|$)/gu;
    return (protectedValue.match(pattern) || [protectedValue])
      .map((part) => part.replaceAll(decimalMarker, ".").trim())
      .filter(Boolean);
  }

  function splitLetterParagraphs(value, language) {
    const raw = String(value || "").replace(/\r/gu, "").trim();
    if (!raw) return [];
    const structuredRaw = raw
      .replace(/\s*(?=[🌿📊🔎🌙🌱📈💌🫶])/gu, "\n")
      .replace(/[ \t]+(?=(?:[-−–—－*]\s+|[•●・]\s*))/gu, "\n")
      .replace(/([。！？!?🍀])(?=(?:[-−–—－*]\s+|[•●・]\s*))/gu, "$1\n")
      .trim();
    const explicit = structuredRaw
      .split(/\n+/u)
      .map((part) => part
        .trim()
        .replace(/^(?:[-−–—－*]\s+|[•●・]\s*)/u, language === "en" ? "• " : "・ "))
      .map((part) => normalizeProse(part, language))
      .filter(Boolean);
    if (explicit.length >= 2) return explicit;

    let normalized = normalizeProse(structuredRaw, language);
    const paragraphs = [];
    const greetingPattern = language === "en"
      ? /^(Gluco(?: is here| here)?[.!]?\s*[🍀🌿]?)/iu
      : /^(グルコだよ[🍀🌿]?)/u;
    const greeting = normalized.match(greetingPattern);
    if (greeting) {
      paragraphs.push(greeting[1].trim());
      normalized = normalized.slice(greeting[0].length).trim();
    }

    const sentences = splitSentences(normalized, language);
    const targetLength = language === "en" ? 155 : 72;
    let buffer = "";
    let sentenceCount = 0;
    for (const sentence of sentences) {
      const separator = language === "en" && buffer ? " " : "";
      const candidate = `${buffer}${separator}${sentence}`;
      if (buffer && (sentenceCount >= 2 || candidate.length > targetLength)) {
        paragraphs.push(buffer);
        buffer = sentence;
        sentenceCount = 1;
      } else {
        buffer = candidate;
        sentenceCount += 1;
      }
    }
    if (buffer) paragraphs.push(buffer);
    return paragraphs;
  }

  function buildParagraphLayout(context, value, maximumWidth, language, size, weight) {
    context.font = `${weight} ${size}px ${FONT}`;
    const paragraphs = splitLetterParagraphs(value, language);
    const lineHeight = Math.round(size * (language === "en" ? 1.42 : 1.46));
    const paragraphGap = Math.round(size * .58);
    const blocks = paragraphs.map((paragraph) => wrapLines(context, paragraph, maximumWidth));
    const lineCount = blocks.reduce((total, lines) => total + lines.length, 0);
    const totalHeight = (lineCount * lineHeight) + (Math.max(0, blocks.length - 1) * paragraphGap);
    const overWidth = blocks.some((lines) => lines.some((line) => context.measureText(line).width > maximumWidth));
    return { blocks, lineHeight, paragraphGap, totalHeight, overWidth };
  }

  function fittedParagraphText(context, value, x, y, maximumWidth, maximumHeight, options = {}) {
    const language = options.language === "en" ? "en" : "ja";
    const maxSize = options.maxSize || (language === "en" ? 31 : 34);
    const minSize = options.minSize || (language === "en" ? 19 : 20);
    const weight = options.weight || 800;
    const color = options.color || "#f0f5fa";
    let chosen;

    for (let size = maxSize; size >= minSize; size -= 1) {
      const layout = buildParagraphLayout(context, value, maximumWidth, language, size, weight);
      chosen = { size, ...layout };
      if (layout.totalHeight <= maximumHeight && !layout.overWidth) break;
    }

    if (!chosen || chosen.totalHeight > maximumHeight || chosen.overWidth) {
      throw new Error("share_studio_letter_too_long");
    }

    context.font = `${weight} ${chosen.size}px ${FONT}`;
    context.fillStyle = color;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    let cursorY = y;
    chosen.blocks.forEach((lines, blockIndex) => {
      lines.forEach((line) => {
        context.fillText(line, x, cursorY);
        cursorY += chosen.lineHeight;
      });
      if (blockIndex < chosen.blocks.length - 1) cursorY += chosen.paragraphGap;
    });
    return chosen;
  }

  function fittedText(context, value, x, y, maximumWidth, options = {}) {
    const maxSize = options.maxSize || 32;
    const minSize = options.minSize || 18;
    const weight = options.weight || 800;
    let size = maxSize;
    for (; size > minSize; size -= 1) {
      context.font = `${weight} ${size}px ${FONT}`;
      if (context.measureText(String(value ?? "")).width <= maximumWidth) break;
    }
    drawText(context, value, x, y, { ...options, size, weight });
    return size;
  }

  function background(context) {
    context.clearRect(0, 0, WIDTH, HEIGHT);
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
    drawText(context, "🍀 GlucoScope", 70, 86, { size: 40, weight: 900 });
    drawText(context, "Understand today. Improve tomorrow.", 70, 126, { size: 21, weight: 800, color: "#a7f3d0" });
    drawText(context, model.language === "en" ? `SLIDE ${slideNumber} / 4` : `${slideNumber}枚目 / 4枚`, 1010, 77, {
      size: 18,
      weight: 900,
      color: "#86efac",
      align: "right"
    });
    fittedText(context, model.dateLabel, 1010, 119, 500, { maxSize: 24, minSize: 18, weight: 900, color: "#d3dfed", align: "right" });
    fittedText(context, title, 70, 193, 880, { maxSize: 43, minSize: 30, weight: 900 });
  }

  function drawImageContain(context, image, x, y, width, height) {
    if (!image) return;
    const ratio = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    context.drawImage(image, x + ((width - drawWidth) / 2), y + ((height - drawHeight) / 2), drawWidth, drawHeight);
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

  function selectEndingCardPath(dependencies = {}) {
    if (Number.isInteger(dependencies.endingCardIndex)) {
      const index = ((dependencies.endingCardIndex % ENDING_CARD_PATHS.length) + ENDING_CARD_PATHS.length)
        % ENDING_CARD_PATHS.length;
      return ENDING_CARD_PATHS[index];
    }
    const cryptoObject = dependencies.crypto || root.crypto;
    if (typeof cryptoObject?.getRandomValues === "function") {
      const value = new Uint32Array(1);
      cryptoObject.getRandomValues(value);
      return ENDING_CARD_PATHS[value[0] % ENDING_CARD_PATHS.length];
    }
    const random = typeof dependencies.random === "function" ? dependencies.random : Math.random;
    const value = Number(random());
    const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9999999999999999) : 0;
    return ENDING_CARD_PATHS[Math.floor(normalized * ENDING_CARD_PATHS.length)];
  }

  function drawCover(context, model, glucoImage) {
    background(context);
    header(context, model.language === "en" ? "🍀 Today’s reflection" : "🍀 今日のふりかえり", model, 1);
    panel(context, 70, 225, 940, 655, 42, "rgba(255,255,255,.052)", "rgba(134,239,172,.17)");
    context.save();
    roundedPath(context, 88, 243, 904, 619, 36);
    context.clip();
    const imageGlow = context.createRadialGradient(540, 520, 80, 540, 520, 500);
    imageGlow.addColorStop(0, "rgba(167,243,208,.25)");
    imageGlow.addColorStop(1, "rgba(167,243,208,0)");
    context.fillStyle = imageGlow;
    context.fillRect(88, 243, 904, 619);
    drawImageContain(context, glucoImage, 126, 260, 828, 580);
    context.restore();
    drawText(context, model.language === "en" ? "The Gluco you met today" : "今日出逢ったグルコ", 540, 916, { size: 24, weight: 900, color: "#bff7d7", align: "center" });
    const glucoNumber = Number.isFinite(model.gluco.id) ? `No. ${String(model.gluco.id).padStart(2, "0")} · ` : "";
    fittedText(context, `${glucoNumber}${model.gluco.title}`, 540, 958, 860, { maxSize: 29, minSize: 20, weight: 900, align: "center" });
    panel(context, 70, 986, 940, 294, 36, "rgba(7,22,38,.72)", "rgba(74,222,128,.24)");
    drawText(context, "🍀 GlucoScore", 108, 1044, { size: 27, weight: 900, color: "#d1fae5" });
    const scoreValue = Number.isFinite(model.metrics.glucoScore) ? String(Math.round(model.metrics.glucoScore)) : "--";
    fittedText(context, scoreValue, 210, 1170, 190, { maxSize: 118, minSize: 72, weight: 900, color: "#4ade80", align: "center" });
    const scoreCopy = model.language === "en"
      ? "A clue for gentle reflection — never a score of your effort."
      : "努力を採点する点数ではなく、やさしく振り返るための手がかりです。";
    fittedParagraphText(context, scoreCopy, 350, 1064, 600, 90, {
      language: model.language,
      maxSize: 27,
      minSize: 22,
      weight: 800,
      color: "#e7eef8"
    });
    scoreChip(context, model.language === "en" ? "vs previous day" : "前日比", scoreDifference(model.metrics.glucoScore, model.metrics.previousScore, model.language), 350, 1182, 275);
    scoreChip(context, model.language === "en" ? "7-day avg" : "7日平均", Number.isFinite(model.metrics.sevenDayAverageScore) ? String(Math.round(model.metrics.sevenDayAverageScore)) : "--", 640, 1182, 275);
  }

  function scoreDifference(current, previous, language) {
    if (!Number.isFinite(Number(previous))) return "--";
    const difference = Number(current) - Number(previous);
    if (difference > 0) return `+${Math.round(difference)}`;
    if (difference < 0) return String(Math.round(difference));
    return language === "en" ? "same" : "同じ";
  }

  function scoreChip(context, label, value, x, y, width) {
    panel(context, x, y, width, 72, 22, "rgba(255,255,255,.045)", "rgba(134,239,172,.14)");
    drawText(context, label, x + 22, y + 29, { size: 16, weight: 900, color: "#98abc2" });
    fittedText(context, value, x + 22, y + 58, width - 44, { maxSize: 24, minSize: 16, weight: 900, color: "#d7fbe7" });
  }

  function drawMetricCard(context, label, value, detail, x, y, width, color, language) {
    panel(context, x, y, width, 140, 25);
    drawText(context, label, x + 23, y + 31, { size: 21, weight: 900, color: "#aebdd2" });
    fittedParagraphText(context, detail, x + 23, y + 55, width - 46, 36, { language, maxSize: language === "en" ? 12 : 13, minSize: 10, weight: 800, color: "#8093aa" });
    fittedText(context, value, x + 23, y + 121, width - 46, { maxSize: 45, minSize: 28, weight: 900, color });
  }

  function getGlucoseSegmentColor(startValue, endValue) {
    if (startValue < 70 || endValue < 70) return "#fb7185";
    if (startValue > 180 || endValue > 180) return "#f59e0b";
    return "#38bdf8";
  }

  function splitGraphSegments(entries, maximumGapMinutes = 45) {
    const segments = [];
    let current = [];
    const maximumGap = maximumGapMinutes * 60 * 1000;
    entries.forEach((entry) => {
      const previous = current[current.length - 1];
      if (previous && entry.date - previous.date > maximumGap) {
        if (current.length) segments.push(current);
        current = [];
      }
      current.push(entry);
    });
    if (current.length) segments.push(current);
    return segments;
  }

  function findGlucoseAtTime(entries, time, maximumGapMinutes = 45) {
    const maximumGap = maximumGapMinutes * 60 * 1000;
    let lower = 0;
    let upper = entries.length - 1;
    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (entries[middle].date < time) lower = middle + 1;
      else upper = middle - 1;
    }
    const next = entries[lower] || null;
    const previous = entries[lower - 1] || null;
    if (previous && next && next.date - previous.date <= maximumGap && time >= previous.date && time <= next.date) {
      const ratio = (time - previous.date) / (next.date - previous.date);
      return previous.sgv + ((next.sgv - previous.sgv) * ratio);
    }
    const nearest = [previous, next]
      .filter(Boolean)
      .sort((left, right) => Math.abs(left.date - time) - Math.abs(right.date - time))[0];
    return nearest && Math.abs(nearest.date - time) <= 15 * 60 * 1000 ? nearest.sgv : null;
  }

  function formatGraphTime(time, language) {
    return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(time));
  }

  function drawTreatmentPoints(context, treatments, entries, projectX, projectY, rangeStart, rangeEnd, inner, language) {
    const points = treatments.map((treatment) => ({
      ...treatment,
      glucose: findGlucoseAtTime(entries, treatment.date)
    })).filter((treatment) => treatment.date >= rangeStart
      && treatment.date <= rangeEnd
      && Number.isFinite(treatment.glucose));
    if (!points.length) return;

    const hasMeal = points.some((point) => point.kind !== "correction");
    const hasCorrection = points.some((point) => point.kind === "correction");
    let legendX = inner.x + inner.width;
    context.textAlign = "right";
    if (hasCorrection) {
      drawText(context, language === "en" ? "● correction" : "● 自動補正", legendX, inner.y - 17, { size: 14, weight: 900, color: "#a78bfa", align: "right" });
      legendX -= language === "en" ? 116 : 94;
    }
    if (hasMeal) drawText(context, language === "en" ? "● bolus" : "● ボーラス", legendX, inner.y - 17, { size: 14, weight: 900, color: "#fbbf24", align: "right" });

    context.save();
    context.beginPath();
    context.rect(inner.x, inner.y, inner.width, inner.height);
    context.clip();
    points.forEach((point) => {
      context.beginPath();
      context.arc(projectX(point.date), projectY(point.glucose), 9, 0, Math.PI * 2);
      context.fillStyle = point.kind === "correction" ? "#a78bfa" : "#fbbf24";
      context.strokeStyle = "rgba(15,23,42,.90)";
      context.lineWidth = 3;
      context.fill();
      context.stroke();
    });
    context.restore();
  }

  function drawGraph(context, model, x, y, width, height) {
    const entries = model.entries;
    panel(context, x, y, width, height, 30, "rgba(7,17,30,.50)", "rgba(255,255,255,.09)");
    const inner = { x: x + 56, y: y + 54, width: width - 92, height: height - 104 };
    const glucoseValues = entries.map((entry) => entry.sgv);
    const minimumGlucose = Math.min(...glucoseValues);
    const maximumGlucose = Math.max(...glucoseValues);
    const yMin = minimumGlucose < 40 ? Math.max(0, Math.floor((minimumGlucose - 10) / 20) * 20) : 40;
    const yMax = maximumGlucose > 250 ? Math.max(250, Math.ceil((maximumGlucose + 20) / 50) * 50) : 250;
    const rangeStart = Number.isFinite(model.rangeStart) ? model.rangeStart : entries[0].date;
    const rangeEnd = Number.isFinite(model.rangeEnd) ? model.rangeEnd : entries[entries.length - 1].date;
    const timeRange = Math.max(60 * 60 * 1000, rangeEnd - rangeStart);
    const projectX = (time) => inner.x + (((time - rangeStart) / timeRange) * inner.width);
    const projectY = (value) => inner.y + inner.height - (((value - yMin) / (yMax - yMin)) * inner.height);

    context.fillStyle = "rgba(245,158,11,.075)";
    context.fillRect(inner.x, projectY(yMax), inner.width, projectY(180) - projectY(yMax));
    context.fillStyle = "rgba(34,197,94,.10)";
    context.fillRect(inner.x, projectY(180), inner.width, projectY(70) - projectY(180));
    context.fillStyle = "rgba(251,113,133,.085)";
    context.fillRect(inner.x, projectY(70), inner.width, projectY(yMin) - projectY(70));

    [...new Set([yMin, 120, 250, yMax])]
      .filter((value) => value >= yMin && value <= yMax && value !== 70 && value !== 180)
      .forEach((value) => {
        const py = projectY(value);
        context.strokeStyle = "rgba(148,163,184,.10)";
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(inner.x, py);
        context.lineTo(inner.x + inner.width, py);
        context.stroke();
        drawText(context, String(value), inner.x - 10, py + 5, { size: 15, weight: 700, color: "#91a4bd", align: "right" });
      });
    [70, 180].forEach((value) => {
      context.strokeStyle = value === 70 ? "#f472b6" : "#fbbf24";
      context.setLineDash([7, 7]);
      context.beginPath();
      context.moveTo(inner.x, projectY(value));
      context.lineTo(inner.x + inner.width, projectY(value));
      context.stroke();
      drawText(context, String(value), inner.x - 10, projectY(value) + 5, { size: 15, weight: 700, color: "#91a4bd", align: "right" });
    });
    context.setLineDash([]);

    [0, .25, .5, .75, 1].forEach((ratio) => {
      const px = inner.x + (ratio * inner.width);
      context.strokeStyle = "rgba(148,163,184,.08)";
      context.beginPath();
      context.moveTo(px, inner.y);
      context.lineTo(px, inner.y + inner.height);
      context.stroke();
      drawText(context, formatGraphTime(rangeStart + (ratio * timeRange), model.language), px, inner.y + inner.height + 31, { size: 15, weight: 700, color: "#91a4bd", align: "center" });
    });

    context.save();
    context.beginPath();
    context.rect(inner.x, inner.y, inner.width, inner.height);
    context.clip();
    splitGraphSegments(entries).forEach((segment) => {
      for (let index = 1; index < segment.length; index += 1) {
        const previous = segment[index - 1];
        const current = segment[index];
        context.beginPath();
        context.moveTo(projectX(previous.date), projectY(previous.sgv));
        context.lineTo(projectX(current.date), projectY(current.sgv));
        context.strokeStyle = getGlucoseSegmentColor(previous.sgv, current.sgv);
        context.lineWidth = 6;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.stroke();
      }
    });
    context.restore();
    drawTreatmentPoints(context, model.treatments, entries, projectX, projectY, rangeStart, rangeEnd, inner, model.language);
  }

  function drawData(context, model, peekImage) {
    background(context);
    header(context, model.language === "en" ? "📊 A day in numbers" : "📊 数字から見える一日", model, 2);
    const metrics = model.metrics;
    const gap = 16;
    const cardWidth = (940 - (gap * 2)) / 3;
    drawMetricCard(context, "TIR", `${metrics.tir?.toFixed?.(1) ?? "--"}%`, "70–180 mg/dL", 70, 225, cardWidth, "#86efac", model.language);
    drawMetricCard(context, "TAR", `${metrics.tar?.toFixed?.(1) ?? "--"}%`, model.language === "en" ? "Time above 180 mg/dL" : "180 mg/dLより高い時間", 70 + cardWidth + gap, 225, cardWidth, "#fde68a", model.language);
    drawMetricCard(context, "TBR", `${metrics.tbr?.toFixed?.(1) ?? "--"}%`, model.language === "en" ? "Time below 70 mg/dL" : "70 mg/dLより低い時間", 70 + ((cardWidth + gap) * 2), 225, cardWidth, "#fda4af", model.language);
    drawMetricCard(context, model.language === "en" ? "AVERAGE" : "平均", `${Math.round(metrics.averageGlucose ?? 0)} mg/dL`, model.language === "en" ? "Average for this period" : "表示期間の平均血糖", 70, 385, cardWidth, "#f8fafc", model.language);
    drawMetricCard(context, "CV", `${metrics.cv?.toFixed?.(1) ?? "--"}%`, model.language === "en" ? "Glucose variability" : "血糖のばらつき", 70 + cardWidth + gap, 385, cardWidth, "#c4b5fd", model.language);
    drawMetricCard(context, "GMI", `${metrics.gmi?.toFixed?.(1) ?? "--"}%`, model.language === "en" ? "Estimated HbA1c" : "平均血糖からの推定値", 70 + ((cardWidth + gap) * 2), 385, cardWidth, "#f9a8d4", model.language);
    drawText(context, model.language === "en" ? "📈 Today’s glucose graph" : "📈 今日の血糖グラフ", 78, 606, { size: model.language === "en" ? 23 : 27, weight: 900, color: "#dce7f5" });
    drawImageContain(context, peekImage, 835, 520, 165, 130);
    drawGraph(context, model, 70, 635, 940, 645);
  }

  function defaultLetter(model) {
    if (model.language === "en") return "Gluco is here 🍀 Today’s numbers are not a grade. They are small clues that can help you look back with kindness and understand tomorrow a little better.";
    return "グルコだよ🍀 今日の数字は、がんばりを採点するものじゃないよ。明日を少しやさしく考えるための、小さな手がかりとして一緒に眺めてみようね。";
  }

  function drawLetter(context, model, peekImage) {
    background(context);
    header(context, model.language === "en" ? "💌 A letter from Gluco" : "💌 グルコからのお手紙", model, 3);
    panel(context, 70, 225, 940, 1055, 42, "rgba(255,255,255,.052)", "rgba(134,239,172,.18)");
    drawText(context, model.language === "en" ? "🍀 Gentle AI reflection" : "🍀 やさしいAI分析", 110, 303, { size: 29, weight: 900, color: "#bff7d7" });
    fittedParagraphText(context, model.letter || defaultLetter(model), 110, 382, 850, 640, {
      language: model.language,
      maxSize: model.language === "en" ? 29 : 31,
      minSize: model.language === "en" ? 15 : 18,
      weight: 800,
      color: "#f0f5fa"
    });
    drawImageContain(context, peekImage, 835, 1100, 145, 105);
    const note = model.language === "en"
      ? "This does not replace medical judgment."
      : "医療判断を置き換えるものではありません";
    fittedText(context, note, 110, 1235, 630, { maxSize: model.language === "en" ? 17 : 18, minSize: 13, weight: 800, color: "#bad7c8" });
  }

  function drawEnding(context, endingImage, qrImage) {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(endingImage, 0, 0, WIDTH, HEIGHT);
    const qrCenterX = 882;
    const qrSize = 176;
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(qrImage, qrCenterX - (qrSize / 2), 1076, qrSize, qrSize);
    context.imageSmoothingEnabled = true;
    drawText(context, "glucoscope.app", qrCenterX, 1261, {
      size: 16,
      weight: 900,
      color: "#245f3a",
      align: "center"
    });
    context.restore();
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image_failed")), "image/png");
    });
  }

  async function generateCarousel(input = {}, dependencies = {}) {
    const model = normalizeCarouselModel(input);
    const documentObject = dependencies.document || root.document;
    const endingCardPath = selectEndingCardPath(dependencies);
    const [glucoImage, peekImage, endingImage, qrImage] = await Promise.all([
      loadImage(model.gluco.imagePath, dependencies),
      loadImage("assets/gluco/ui/gluco-peek-clover.png", dependencies).catch(() => null),
      loadImage(endingCardPath, dependencies),
      loadImage("assets/share-studio/glucoscope-qr.png", dependencies)
    ]);
    const canvases = Array.from({ length: 4 }, () => createCanvas(documentObject));
    const contexts = canvases.map((canvas) => canvas.getContext("2d"));
    if (contexts.some((context) => !context)) throw new Error("canvas_unavailable");
    drawCover(contexts[0], model, glucoImage);
    drawData(contexts[1], model, peekImage);
    drawLetter(contexts[2], model, peekImage);
    drawEnding(contexts[3], endingImage, qrImage);
    return Promise.all(canvases.map(canvasToBlob));
  }

  function validateCarouselRecord(record) {
    return Boolean(record && [LEGACY_RECORD_VERSION, RECORD_VERSION].includes(record.version) && record.key === LATEST_KEY
      && Array.isArray(record.blobs) && record.blobs.length === 4
      && record.blobs.every((blob) => blob instanceof Blob && blob.type === "image/png"));
  }

  function isCurrentCarouselRecord(record) {
    return Boolean(validateCarouselRecord(record)
      && record.version === RECORD_VERSION
      && record.rendererRevision === RENDERER_REVISION);
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
      rendererRevision: RENDERER_REVISION,
      createdAt: new Date().toISOString(),
      dateKey: safeText(metadata.dateKey, 10),
      glucoId: finiteMetric(metadata.glucoId),
      accessGrant: metadata.accessGrant === "trial" ? "trial" : "plus",
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
    _testing: Object.freeze({
      normalizeSnapshot,
      normalizeCarouselModel,
      normalizeLetter,
      safeMetric,
      safeAssetPath,
      validateCarouselRecord,
      isCurrentCarouselRecord,
      fileName,
      tokenizeLine,
      wrapLines,
      buildParagraphLayout,
      fittedParagraphText,
      fittedText,
      scoreDifference,
      splitGraphSegments,
      endingCardPaths: ENDING_CARD_PATHS,
      selectEndingCardPath
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
