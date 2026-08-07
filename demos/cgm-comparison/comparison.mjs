import {
  computeObservationSummary,
  filterSourcesByWindow,
  formatElapsedMinute,
  formatLiveClockMinute,
  validateDataset
} from "./comparison-core.mjs?v=20260808-clock-axis-1";
import {
  buildLiveComparisonDataset,
  canPreserveLiveDataset,
  fetchOptionalPublicFeed,
  normalizePublicFeedEndpoint
} from "./live-comparison-core.mjs?v=20260808-clock-axis-1";
import { createLiveRefreshController } from "./live-refresh-core.mjs?v=20260808-clock-axis-1";

const DATASET_URL = "./data/sample.json";
const state = {
  dataset: null,
  chart: null,
  hours: 12,
  enabledSources: new Set(),
  loadNotice: "",
  liveLoadedAt: 0
};

class DemoFeedPausedError extends Error {}

function byId(id) {
  return document.getElementById(id);
}

function getWindowStart() {
  if (state.hours === "all") return 0;
  return Math.max(0, state.dataset.durationMinutes - Number(state.hours) * 60);
}

function getVisibleSources() {
  const startMinute = getWindowStart();
  return filterSourcesByWindow(
    state.dataset.sources.filter((source) => state.enabledSources.has(source.id)),
    startMinute
  );
}

function formatTimelineMinute(totalMinutes) {
  if (state.dataset.status !== "live") return formatElapsedMinute(totalMinutes);
  return formatLiveClockMinute(totalMinutes, {
    durationMinutes: state.dataset.durationMinutes,
    windowEndAt: state.dataset.windowEndAt
  });
}

function renderDatasetHeader() {
  const status = byId("datasetStatus");
  const isSynthetic = state.dataset.status === "synthetic";
  const isLive = state.dataset.status === "live";
  const liveSourceCount = state.dataset.sources.filter((source) =>
    source.dataStatus === "available" && source.readings.length > 0
  ).length;
  const delayedSources = isLive
    ? state.dataset.sources.filter((source) =>
      source.dataStatus === "available" && source.readings.length > 0 && source.isStale === true
    )
    : [];
  const hasDelayedSources = delayedSources.length > 0;
  status.textContent = isLive
    ? hasDelayedSources
      ? "公開デモ · 更新が遅れているデータあり"
      : "公開デモ · ライブデータ"
    : isSynthetic
      ? "準備中 · 合成データ"
      : "匿名化済み実測データ";
  status.className = `comparison-status ${isLive
    ? hasDelayedSources ? "comparison-status-delayed" : "comparison-status-live"
    : isSynthetic ? "comparison-status-synthetic" : "comparison-status-anonymized"}`;
  const modeNotice = byId("datasetModeNotice");
  const liveNotice = `現在は実測ライブデータです。取得できた${liveSourceCount}種類のCGMデータを表示しています。`;
  const delayedNotice = hasDelayedSources
    ? ` ${delayedSources.map((source) => source.shortLabel).join("、")}の公開データ更新が遅れています。CGMや機器の停止を意味する表示ではありません。`
    : "";
  modeNotice.textContent = isLive
    ? `${liveNotice}${delayedNotice}`
    : isSynthetic
      ? "現在は合成データです。3本の線は表示確認用で、Kazumaの実測値ではありません。"
      : "現在は匿名化済み実測データです。現在時刻や個人を特定する情報は含みません。";
  modeNotice.className = `comparison-mode-notice ${isLive
    ? hasDelayedSources ? "comparison-mode-notice-delayed" : "comparison-mode-notice-live"
    : isSynthetic ? "comparison-mode-notice-synthetic" : "comparison-mode-notice-anonymized"}`;
  const updatedText = isLive
    ? ` · 約${Math.max(0, Math.round((Date.now() - state.dataset.updatedAt) / 60_000))}分前に更新`
    : "";
  byId("datasetWindow").textContent = `${Math.round(state.dataset.durationMinutes / 60)}時間の比較ウィンドウ${updatedText}`;
  byId("datasetDisclosure").textContent = state.dataset.disclosure;
}

function renderSourceControls() {
  const container = byId("sourceControls");
  container.replaceChildren(...state.dataset.sources.map((source) => {
    const isAvailable = source.dataStatus === "available" && source.readings.length > 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comparison-source-toggle";
    button.style.setProperty("--source-color", source.color);
    button.dataset.sourceId = source.id;
    button.setAttribute("aria-pressed", state.enabledSources.has(source.id) ? "true" : "false");
    button.disabled = !isAvailable;
    const sourceStatusText = !isAvailable
      ? " · 準備中"
      : source.isStale === true
        ? " · 更新遅れ"
        : "";
    button.innerHTML = `<span class="comparison-source-dot" aria-hidden="true"></span>${source.shortLabel}${sourceStatusText}`;
    button.addEventListener("click", () => {
      if (!isAvailable) return;
      if (state.enabledSources.has(source.id) && state.enabledSources.size > 1) {
        state.enabledSources.delete(source.id);
      } else {
        state.enabledSources.add(source.id);
      }
      renderSourceControls();
      renderChart();
      renderSummary();
    });
    return button;
  }));
}

function renderSourceCards() {
  const cards = state.dataset.sources.map((source) => {
    const article = document.createElement("article");
    const isAvailable = source.dataStatus === "available" && source.readings.length > 0;
    const isDelayed = state.dataset.status === "live" && isAvailable && source.isStale === true;
    article.className = `comparison-source-card comparison-card${isDelayed ? " comparison-source-card-delayed" : ""}`;
    article.style.setProperty("--source-color", source.color);
    const sourceStateLabel = state.dataset.status === "synthetic"
      ? "現在表示：合成データ"
      : isAvailable
        ? isDelayed
          ? "現在表示：更新が遅れています"
          : source.verificationLabel
        : "現在表示：準備中";
    article.innerHTML = `
      <h3>${source.label}</h3>
      <span class="comparison-source-state${isDelayed ? " comparison-source-state-delayed" : ""}">${sourceStateLabel}</span>
      <p class="comparison-source-route">${source.captureRoute}</p>
      <p class="comparison-source-note">${source.note}</p>
      <p class="comparison-source-meta">${source.dataStatus === "available" ? `現在の表示点: ${source.readings.length}` : "データ準備中"}</p>
    `;
    return article;
  });
  byId("sourceCards").replaceChildren(...cards);
}

function renderChart() {
  const visibleSources = getVisibleSources();
  const datasets = visibleSources.map((source) => ({
    label: source.label,
    data: source.readings.map(([x, y]) => ({ x, y })),
    borderColor: source.color,
    backgroundColor: source.color,
    borderWidth: 2.5,
    pointRadius: 2,
    pointHoverRadius: 5,
    tension: 0,
    spanGaps: false
  }));

  state.chart?.destroy();
  state.chart = new Chart(byId("comparisonChart"), {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      parsing: false,
      scales: {
        x: {
          type: "linear",
          min: getWindowStart(),
          max: state.dataset.durationMinutes,
          grid: { color: "rgba(86, 121, 107, 0.10)" },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 7,
            callback: (value) => formatTimelineMinute(value)
          },
          title: {
            display: true,
            text: state.dataset.status === "live"
              ? "日本時間（24時間表記・昨日／今日・右端が現在）"
              : "装着開始からの経過時間（正確な日付は非公開）"
          }
        },
        y: {
          suggestedMin: 70,
          suggestedMax: 220,
          grid: { color: "rgba(86, 121, 107, 0.12)" },
          title: { display: true, text: "表示値 (mg/dL)" }
        }
      },
      plugins: {
        legend: { display: true, position: "bottom", labels: { usePointStyle: true, padding: 18 } },
        tooltip: {
          callbacks: {
            title: (items) => items.length ? formatTimelineMinute(items[0].parsed.x) : "",
            label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y)} mg/dL`
          }
        }
      }
    }
  });

  const baseMessage = visibleSources.length > 1
    ? `${visibleSources.length}種類を表示しています。線の間を基準値や正解として扱いません。`
    : `${visibleSources.length}種類を表示しています。比較できるデータが届くまで、単独の表示として見られます。`;
  byId("chartMessage").textContent = state.loadNotice ? `${state.loadNotice} ${baseMessage}` : baseMessage;
}

function renderSummary() {
  const visibleSources = getVisibleSources();
  if (visibleSources.length < 2) {
    byId("matchedCount").textContent = "2種類以上で比較";
    byId("medianSpread").textContent = "--";
    byId("missingCount").textContent = "--";
    return;
  }

  const summary = computeObservationSummary(visibleSources, state.dataset.matchToleranceMinutes);
  byId("matchedCount").textContent = `${summary.matchedCount}時点`;
  byId("medianSpread").textContent = summary.medianSpread == null ? "--" : `${Math.round(summary.medianSpread)} mg/dL`;
  byId("missingCount").textContent = `${summary.missingCount}点`;
}

function bindRangeControls() {
  byId("rangeControls").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-hours]");
    if (!button) return;
    state.hours = button.dataset.hours === "all" ? "all" : Number(button.dataset.hours);
    for (const candidate of byId("rangeControls").querySelectorAll("button")) {
      candidate.classList.toggle("active", candidate === button);
    }
    renderChart();
    renderSummary();
  });
}

function readLiveConfig() {
  const config = globalThis.GlucoScopeCgmComparisonConfig || {};
  const libreEndpoint = normalizePublicFeedEndpoint(config.libreFeedEndpoint, window.location.href);
  let dexcomEndpoint = "";
  try {
    dexcomEndpoint = normalizePublicFeedEndpoint(config.dexcomFeedEndpoint, window.location.href);
  } catch {
    dexcomEndpoint = "";
  }
  const dexcomRouteVerified = config.dexcomRouteVerified === true;
  const windowHours = Number(config.windowHours) || 24;
  const refreshMinutes = Number(config.refreshMinutes) || 5;
  return { libreEndpoint, dexcomEndpoint, dexcomRouteVerified, windowHours, refreshMinutes };
}

async function loadStaticDataset() {
  const response = await fetch(DATASET_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Comparison data returned HTTP ${response.status}.`);
  return validateDataset(await response.json());
}

async function loadLiveDataset(config) {
  const nowMs = Date.now();
  const rangeStart = nowMs - config.windowHours * 60 * 60 * 1000;
  const guardianAdapter = globalThis.GlucoScopeDataSource.createAdapter({ mode: "public-demo" });
  const [guardianResult, libreResponse, dexcomPayload] = await Promise.all([
    guardianAdapter.fetchEntries(rangeStart, nowMs, 1_000),
    fetch(config.libreEndpoint, { cache: "no-store", headers: { Accept: "application/json" } }),
    fetchOptionalPublicFeed(config.dexcomEndpoint, "dexcom-g7")
  ]);
  if (!libreResponse.ok) {
    if (libreResponse.status === 503) {
      throw new DemoFeedPausedError("The public demo feed is paused.");
    }
    throw new Error(`Libre demo feed returned HTTP ${libreResponse.status}.`);
  }
  return buildLiveComparisonDataset({
    guardianEntries: guardianResult.data,
    librePayload: await libreResponse.json(),
    dexcomPayload,
    dexcomRouteVerified: config.dexcomRouteVerified,
    nowMs,
    windowHours: config.windowHours
  });
}

async function loadDataset({ preserveLiveOnError = false } = {}) {
  let config;
  try {
    config = readLiveConfig();
    state.loadNotice = "";
    const nextDataset = config.libreEndpoint
      ? await loadLiveDataset(config)
      : await loadStaticDataset();
    state.dataset = nextDataset;
    state.liveLoadedAt = nextDataset.status === "live" ? Date.now() : 0;
  } catch (error) {
    const wasLive = state.dataset?.status === "live";
    const canPreserveLive = preserveLiveOnError &&
      !(error instanceof DemoFeedPausedError) &&
      canPreserveLiveDataset(state.dataset, state.liveLoadedAt, Date.now());
    if (canPreserveLive) {
      state.loadNotice = "ライブデータの更新が遅れています。前回取得できた表示を残しています。";
    } else {
      state.dataset = await loadStaticDataset();
      state.liveLoadedAt = 0;
      state.loadNotice = error instanceof DemoFeedPausedError
        ? "公開デモは停止中のため、合成データを表示しています。"
        : preserveLiveOnError && wasLive
          ? "ライブデータの更新が続いて遅れているため、古い表示を残さず合成データへ切り替えました。"
        : "ライブデータはまだ準備中のため、合成データを表示しています。";
    }
  }
  state.enabledSources = new Set(state.dataset.sources
    .filter((source) => source.dataStatus === "available" && source.readings.length > 0)
    .map((source) => source.id));
  renderDatasetHeader();
  renderSourceControls();
  renderSourceCards();
  renderChart();
  renderSummary();
}

function getLiveRefreshDelayMs() {
  try {
    const config = readLiveConfig();
    return config.libreEndpoint ? Math.max(1, config.refreshMinutes) * 60_000 : null;
  } catch {
    return null;
  }
}

function reportLoadError(error) {
  console.error("Could not load the CGM comparison dataset.", error);
  byId("chartMessage").textContent = "比較データを読み込めませんでした。公開デモの通常画面はそのまま利用できます。";
}

const liveRefresh = createLiveRefreshController({
  load: loadDataset,
  getDelayMs: getLiveRefreshDelayMs,
  isVisible: () => document.visibilityState !== "hidden",
  onError: reportLoadError
});

document.addEventListener("visibilitychange", () => {
  void liveRefresh.handleVisibilityChange().catch(reportLoadError);
});
window.addEventListener("pageshow", (event) => {
  void liveRefresh.handlePageShow(event).catch(reportLoadError);
});

bindRangeControls();
liveRefresh.start().catch(reportLoadError);
