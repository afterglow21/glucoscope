import { validateDataset } from "./comparison-core.mjs";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const LIVE_SOURCE_STALE_AFTER_MS = 15 * MINUTE_MS;
export const MAX_PRESERVED_LIVE_AGE_MS = LIVE_SOURCE_STALE_AFTER_MS;
const ALLOWED_DIRECTIONS = new Set([
  "DoubleUp",
  "SingleUp",
  "FortyFiveUp",
  "Flat",
  "FortyFiveDown",
  "SingleDown",
  "DoubleDown",
  "NOT COMPUTABLE",
  "RATE OUT OF RANGE",
  "None",
]);
const ALLOWED_PUBLIC_SOURCE_IDS = new Set(["libre-2", "dexcom-g7"]);
const ALLOWED_PAYLOAD_KEYS = new Set(["ok", "sourceId", "updatedAt", "stale", "entries"]);
const ALLOWED_ENTRY_KEYS = new Set(["sgv", "date", "direction"]);

const SOURCE_DEFINITIONS = Object.freeze({
  guardian: Object.freeze({
    id: "guardian-4",
    label: "Guardian 4 / MiniMed 780G",
    shortLabel: "Guardian 4",
    color: "#3a7d68",
    verificationLabel: "基本接続を実機確認済み",
    captureRoute: "Kazumaの既存Azure Nightscoutからブラウザで直接取得",
    note: "公開中のGuardianデモデータを、Libre 2と同じ時間軸へ並べています。",
  }),
  libre: Object.freeze({
    id: "libre-2",
    label: "FreeStyle Libre 2",
    shortLabel: "Libre 2",
    color: "#c58a35",
    verificationLabel: "公開デモ経路を実機確認済み",
    captureRoute: "Gluroo Global Connectから公開デモ用Worker、GitHub Pagesまで継続公開中",
    note: "一般利用者向け限定中継とは別の公開デモWorkerで、公開3CGMライブデモを継続中です。接続情報は公開されません。2回の定期集計確認と1回のブラウザ自動更新を確認済みです。長時間・複数回のブラウザ自動更新観察と、本番の自然失効は未確認です。",
  }),
  dexcom: Object.freeze({
    id: "dexcom-g7",
    label: "Dexcom G7",
    shortLabel: "Dexcom G7",
    color: "#6d70ad",
    verificationLabel: "公開デモ経路を実機確認済み",
    captureRoute: "Gluroo Global Connectから公開デモ用Worker、GitHub Pagesまで継続公開中",
    note: "一般利用者向け限定中継とは別の公開デモWorkerで、公開3CGMライブデモを継続中です。接続情報は公開されません。2回の定期集計確認と1回のブラウザ自動更新を確認済みです。長時間・複数回のブラウザ自動更新観察と、本番の自然失効は未確認です。",
  }),
});
const VERIFIED_DEXCOM_DEFINITION = Object.freeze({
  ...SOURCE_DEFINITIONS.dexcom,
  verificationLabel: "公開デモ経路を実機確認済み",
  captureRoute: "Gluroo Global Connectから公開デモ専用Workerを経由",
  note: "Kazumaが公開を選んだDexcom G7の直近データです。公開3CGMライブデモを継続中で、2回の定期集計確認と1回のブラウザ自動更新を確認済みです。接続情報は公開されません。長時間・複数回のブラウザ自動更新観察と、本番の自然失効は未確認です。",
});

function normalizeTimestamp(entry) {
  let timestamp = Number(entry?.date ?? entry?.timestamp ?? entry?.time);
  if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < 10_000_000_000) timestamp *= 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) timestamp = Date.parse(entry?.dateString);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
function normalizeEntries(entries, startMs, endMs) {
  const unique = new Map();
  for (const rawEntry of entries || []) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const sgv = Number(rawEntry.sgv ?? rawEntry.glucose ?? rawEntry.value);
    const date = normalizeTimestamp(rawEntry);
    if (!Number.isFinite(sgv) || sgv < 20 || sgv > 600 || !date || date < startMs || date > endMs) continue;
    const reading = [Number(((date - startMs) / 60_000).toFixed(3)), Math.round(sgv)];
    unique.set(date, reading);
  }
  return [...unique.entries()].sort((left, right) => left[0] - right[0]).map(([, reading]) => reading);
}

function getLatestReadingTimestamp(entries) {
  let latestTimestamp = null;
  for (const rawEntry of entries || []) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const sgv = Number(rawEntry.sgv ?? rawEntry.glucose ?? rawEntry.value);
    const date = normalizeTimestamp(rawEntry);
    if (!Number.isFinite(sgv) || sgv < 20 || sgv > 600 || !date) continue;
    latestTimestamp = latestTimestamp === null ? date : Math.max(latestTimestamp, date);
  }
  return latestTimestamp;
}

export function isReadingSeriesStale(entries, nowMs, upstreamStale = false) {
  const latestTimestamp = getLatestReadingTimestamp(entries);
  return upstreamStale === true || (
    latestTimestamp !== null && nowMs - latestTimestamp > LIVE_SOURCE_STALE_AFTER_MS
  );
}

export function canPreserveLiveDataset(dataset, loadedAt, nowMs = Date.now()) {
  return dataset?.status === "live" &&
    Number.isSafeInteger(loadedAt) &&
    loadedAt > 0 &&
    Number.isFinite(nowMs) &&
    nowMs >= loadedAt &&
    nowMs - loadedAt <= MAX_PRESERVED_LIVE_AGE_MS;
}

function buildDelayedSourceNote(shortLabel) {
  return `${shortLabel}の公開データ更新が遅れています。公開経路から新しい表示をまだ受け取れていない状態です。CGMや機器の停止を意味するものではありません。`;
}

export function normalizePublicFeedEndpoint(rawEndpoint, baseUrl) {
  const endpoint = String(rawEndpoint || "").trim();
  if (!endpoint) return "";
  const parsed = new URL(endpoint, baseUrl);
  const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !isLocalHttp) || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Unsafe demo feed endpoint.");
  }
  return parsed.toString();
}

export function validatePublicFeed(payload, expectedSourceId) {
  if (!ALLOWED_PUBLIC_SOURCE_IDS.has(expectedSourceId)) throw new Error("Unsupported public demo source.");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Public demo feed is invalid.");
  if (Object.keys(payload).some((key) => !ALLOWED_PAYLOAD_KEYS.has(key))) throw new Error("Public demo feed contains unexpected fields.");
  if (
    payload.ok !== true ||
    payload.sourceId !== expectedSourceId ||
    !Number.isSafeInteger(payload.updatedAt) ||
    payload.updatedAt <= 0 ||
    typeof payload.stale !== "boolean" ||
    !Array.isArray(payload.entries) ||
    payload.entries.length < 1 ||
    payload.entries.length > 1_000
  ) {
    throw new Error("Public demo feed is invalid.");
  }
  let previousDate = -Infinity;
  for (const entry of payload.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Public demo entry is invalid.");
    if (Object.keys(entry).some((key) => !ALLOWED_ENTRY_KEYS.has(key))) throw new Error("Public demo entry contains unexpected fields.");
    if (
      !Number.isFinite(entry.sgv) ||
      entry.sgv < 20 ||
      entry.sgv > 600 ||
      !Number.isSafeInteger(entry.date) ||
      entry.date <= previousDate
    ) {
      throw new Error("Public demo entry is invalid.");
    }
    if (entry.direction !== undefined && !ALLOWED_DIRECTIONS.has(entry.direction)) throw new Error("Public demo direction is invalid.");
    previousDate = entry.date;
  }
  return payload;
}

export function validatePublicLibreFeed(payload) {
  return validatePublicFeed(payload, "libre-2");
}

export async function fetchOptionalPublicFeed(endpoint, expectedSourceId, fetchImpl = fetch) {
  if (!endpoint) return null;
  try {
    const response = await fetchImpl(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return validatePublicFeed(await response.json(), expectedSourceId);
  } catch {
    return null;
  }
}

function makeSource(definition, readings, extra = {}) {
  return {
    ...definition,
    dataStatus: readings.length ? "available" : "pending",
    readings,
    ...extra,
  };
}

export function buildLiveComparisonDataset({
  guardianEntries,
  librePayload,
  dexcomPayload = null,
  dexcomRouteVerified = false,
  nowMs = Date.now(),
  windowHours = 24,
}) {
  const feed = validatePublicLibreFeed(librePayload);
  let dexcomFeed = null;
  if (dexcomRouteVerified && dexcomPayload) {
    try {
      dexcomFeed = validatePublicFeed(dexcomPayload, "dexcom-g7");
    } catch {
      dexcomFeed = null;
    }
  }
  const durationMinutes = windowHours * 60;
  const startMs = nowMs - windowHours * HOUR_MS;
  const guardianReadings = normalizeEntries(guardianEntries, startMs, nowMs);
  const libreReadings = normalizeEntries(feed.entries, startMs, nowMs);
  const dexcomReadings = normalizeEntries(dexcomFeed?.entries, startMs, nowMs);
  const guardianIsStale = isReadingSeriesStale(guardianEntries, nowMs);
  const libreIsStale = isReadingSeriesStale(feed.entries, nowMs, feed.stale);
  const dexcomIsStale = isReadingSeriesStale(dexcomFeed?.entries, nowMs, dexcomFeed?.stale);
  const hasDexcomReadings = dexcomReadings.length > 0;
  const dexcomDefinition = hasDexcomReadings ? VERIFIED_DEXCOM_DEFINITION : SOURCE_DEFINITIONS.dexcom;
  const sources = [
    makeSource(SOURCE_DEFINITIONS.guardian, guardianReadings, {
      isStale: guardianIsStale,
      note: guardianIsStale
        ? buildDelayedSourceNote(SOURCE_DEFINITIONS.guardian.shortLabel)
        : SOURCE_DEFINITIONS.guardian.note,
    }),
    makeSource(SOURCE_DEFINITIONS.libre, libreReadings, {
      isStale: libreIsStale,
      note: libreIsStale
        ? buildDelayedSourceNote(SOURCE_DEFINITIONS.libre.shortLabel)
        : SOURCE_DEFINITIONS.libre.note,
    }),
    makeSource(dexcomDefinition, dexcomReadings, {
      isStale: dexcomIsStale,
      note: dexcomIsStale
        ? buildDelayedSourceNote(SOURCE_DEFINITIONS.dexcom.shortLabel)
        : dexcomDefinition.note,
    }),
  ];
  const updateTimes = [nowMs, feed.updatedAt];
  if (hasDexcomReadings) updateTimes.push(dexcomFeed.updatedAt);

  return validateDataset({
    schemaVersion: 1,
    status: "live",
    title: hasDexcomReadings
      ? "Guardian, Libre, and Dexcom public demo observation"
      : "Guardian and Libre public demo observation",
    durationMinutes,
    matchToleranceMinutes: 3,
    updatedAt: Math.min(...updateTimes),
    disclosure: hasDexcomReadings
      ? "Kazumaが公開を選んだGuardian 4、Libre 2、Dexcom G7の直近表示です。血糖値と更新時刻は公開情報になります。接続情報、治療・食事・薬・ポンプ情報は含みません。機器の精度、優劣、医療判断を示すものではありません。"
      : "Kazumaが公開を選んだGuardian 4とLibre 2の直近表示です。血糖値と更新時刻は公開情報になります。接続情報、治療・食事・薬・ポンプ情報は含みません。機器の精度、優劣、医療判断を示すものではありません。",
    sources,
  });
}
