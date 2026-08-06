import { validateDataset } from "./comparison-core.mjs";

const HOUR_MS = 60 * 60 * 1000;
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
    verificationLabel: "基本接続を実機確認済み",
    captureRoute: "Gluroo Global Connectから公開デモ専用Workerを経由",
    note: "Kazumaが公開を選んだLibre 2の直近データです。接続情報は公開されません。",
  }),
  dexcom: Object.freeze({
    id: "dexcom-g7",
    label: "Dexcom G7",
    shortLabel: "Dexcom G7",
    color: "#6d70ad",
    verificationLabel: "実機確認前",
    captureRoute: "公開デモ用の取得経路は準備中",
    note: "装着と実機経路の確認が終わるまで、データ準備中として表示します。",
  }),
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

export function validatePublicLibreFeed(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Libre demo feed is invalid.");
  const allowedPayloadKeys = new Set(["ok", "sourceId", "updatedAt", "stale", "entries"]);
  if (Object.keys(payload).some((key) => !allowedPayloadKeys.has(key))) throw new Error("Libre demo feed contains unexpected fields.");
  if (
    payload.ok !== true ||
    payload.sourceId !== "libre-2" ||
    !Number.isSafeInteger(payload.updatedAt) ||
    payload.updatedAt <= 0 ||
    typeof payload.stale !== "boolean" ||
    !Array.isArray(payload.entries) ||
    payload.entries.length > 1_000
  ) {
    throw new Error("Libre demo feed is invalid.");
  }
  for (const entry of payload.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Libre demo entry is invalid.");
    const allowedEntryKeys = new Set(["sgv", "date", "direction"]);
    if (Object.keys(entry).some((key) => !allowedEntryKeys.has(key))) throw new Error("Libre demo entry contains unexpected fields.");
    if (!Number.isFinite(Number(entry.sgv)) || !Number.isFinite(Number(entry.date))) throw new Error("Libre demo entry is invalid.");
    if (entry.direction !== undefined && !ALLOWED_DIRECTIONS.has(entry.direction)) throw new Error("Libre demo direction is invalid.");
  }
  return payload;
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
  nowMs = Date.now(),
  windowHours = 24,
}) {
  const feed = validatePublicLibreFeed(librePayload);
  const durationMinutes = windowHours * 60;
  const startMs = nowMs - windowHours * HOUR_MS;
  const guardianReadings = normalizeEntries(guardianEntries, startMs, nowMs);
  const libreReadings = normalizeEntries(feed.entries, startMs, nowMs);
  const sources = [
    makeSource(SOURCE_DEFINITIONS.guardian, guardianReadings),
    makeSource(SOURCE_DEFINITIONS.libre, libreReadings, {
      isStale: feed.stale,
      note: feed.stale
        ? "Libre 2の公開データ更新が遅れています。CGMの停止を意味する表示ではありません。"
        : SOURCE_DEFINITIONS.libre.note,
    }),
    makeSource(SOURCE_DEFINITIONS.dexcom, []),
  ];

  return validateDataset({
    schemaVersion: 1,
    status: "live",
    title: "Guardian and Libre public demo observation",
    durationMinutes,
    matchToleranceMinutes: 3,
    updatedAt: Math.min(nowMs, feed.updatedAt),
    disclosure: "Kazumaが公開を選んだGuardian 4とLibre 2の直近表示です。血糖値と更新時刻は公開情報になります。接続情報、治療・食事・薬・ポンプ情報は含みません。機器の精度、優劣、医療判断を示すものではありません。",
    sources,
  });
}
