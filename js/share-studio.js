(function initializeGlucoScopeShareStudio(root) {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const VALUE_PATTERN = /^(?:--|\d{1,3}(?:\.\d)?%?)$/u;

  function safeMetric(value, fallback = "--") {
    const text = String(value ?? "").trim();
    return text.length <= 8 && VALUE_PATTERN.test(text) ? text : fallback;
  }

  function normalizeSnapshot(input = {}) {
    return Object.freeze({
      glucose: safeMetric(input.glucose),
      arrow: ["↘", "↓", "↙", "→", "↗", "↑", "⇈"].includes(input.arrow)
        ? input.arrow
        : "→",
      tir: safeMetric(input.tir),
      tar: safeMetric(input.tar),
      tbr: safeMetric(input.tbr),
      date: String(input.date || "").trim().slice(0, 24),
      language: input.language === "en" ? "en" : "ja"
    });
  }

  function roundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
  }

  function drawMetric(context, label, value, x, color) {
    context.fillStyle = "rgba(255,255,255,.07)";
    roundedRect(context, x, 815, 275, 180, 34);
    context.fillStyle = "#a9bad2";
    context.font = "700 34px system-ui, sans-serif";
    context.fillText(label, x + 34, 870);
    context.fillStyle = color;
    context.font = "800 62px system-ui, sans-serif";
    context.fillText(value, x + 34, 950);
  }

  async function generateBlob(input = {}, dependencies = {}) {
    const snapshot = normalizeSnapshot(input);
    if (snapshot.glucose === "--") throw new Error("glucose_unavailable");
    const documentObject = dependencies.document || root.document;
    const canvas = documentObject?.createElement?.("canvas");
    if (!canvas) throw new Error("canvas_unavailable");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");

    const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, "#10233c");
    background.addColorStop(1, "#07111f");
    context.fillStyle = background;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.fillStyle = "#f8fafc";
    context.font = "800 72px system-ui, sans-serif";
    context.fillText("🍀 GlucoScope", 72, 120);
    context.fillStyle = "#9fb1c9";
    context.font = "500 34px system-ui, sans-serif";
    context.fillText("Understand today. Improve tomorrow.", 74, 175);

    context.fillStyle = "rgba(255,255,255,.06)";
    roundedRect(context, 72, 250, 936, 465, 50);
    context.fillStyle = "#a9bad2";
    context.font = "700 36px system-ui, sans-serif";
    context.fillText(snapshot.language === "en" ? "CURRENT GLUCOSE" : "現在の血糖", 132, 335);
    context.fillStyle = "#ffffff";
    context.font = "850 215px system-ui, sans-serif";
    context.fillText(snapshot.glucose, 126, 575);
    context.fillStyle = "#35d07f";
    context.font = "750 95px system-ui, sans-serif";
    context.fillText(snapshot.arrow, 695, 555);
    context.fillStyle = "#dbe7f5";
    context.font = "650 42px system-ui, sans-serif";
    context.fillText("mg/dL", 825, 552);

    drawMetric(context, "TIR", snapshot.tir, 72, "#35d07f");
    drawMetric(context, "TAR", snapshot.tar, 402, "#f6bd3d");
    drawMetric(context, "TBR", snapshot.tbr, 732, "#fb7185");

    context.fillStyle = "#dbe7f5";
    context.font = "600 34px system-ui, sans-serif";
    context.fillText(snapshot.date, 74, 1110);
    context.fillStyle = "#91a7c2";
    context.font = "500 30px system-ui, sans-serif";
    const note = snapshot.language === "en"
      ? "A gentle snapshot for looking back — not medical advice."
      : "責めずにふりかえるための記録です。医療判断には使いません。";
    context.fillText(note, 74, 1185);
    context.fillStyle = "#55d894";
    context.font = "650 30px system-ui, sans-serif";
    context.fillText("glucoscope.app", 74, 1260);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image_failed")), "image/png");
    });
  }

  async function shareBlob(blob, language = "ja") {
    if (!(blob instanceof Blob)) throw new Error("image_unavailable");
    const file = new File([blob], "glucoscope-daily-snapshot.png", { type: "image/png" });
    if (typeof root.navigator?.share === "function" && root.navigator.canShare?.({ files: [file] })) {
      await root.navigator.share({
        files: [file],
        title: "GlucoScope",
        text: language === "en" ? "My GlucoScope snapshot 🍀" : "GlucoScopeのふりかえり 🍀"
      });
      return Object.freeze({ status: "shared" });
    }
    const url = URL.createObjectURL(blob);
    const link = root.document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    root.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Object.freeze({ status: "downloaded" });
  }

  root.GlucoScopeShareStudio = Object.freeze({
    generateBlob,
    shareBlob,
    _testing: Object.freeze({ normalizeSnapshot, safeMetric })
  });
})(typeof window !== "undefined" ? window : globalThis);
