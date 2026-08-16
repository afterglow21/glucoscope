import { validateDataset } from "../../demos/cgm-comparison/comparison-core.mjs";

const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "guardian-4",
    label: "Guardian 4 / MiniMed 780G",
    shortLabel: "Guardian 4",
    color: "#3a7d68",
    verificationLabel: "基本接続を実機確認済み",
    dataStatus: "available",
    captureRoute: "Kazumaの既存Azure Nightscoutからブラウザで直接取得し、公開前に匿名化",
    note: "比較期間中の表示を同じ時間軸で観察します。基準値や正解として扱いません。"
  }),
  Object.freeze({
    id: "libre-2",
    label: "FreeStyle Libre 2",
    shortLabel: "Libre 2",
    color: "#c58a35",
    verificationLabel: "基本接続を実機確認済み",
    dataStatus: "available",
    captureRoute: "別Gluroo Global Connectから取得し、公開前に匿名化",
    note: "基本接続は確認済みです。比較期間の実測値は、基準値や正解として扱いません。"
  }),
  Object.freeze({
    id: "dexcom-g7",
    label: "Dexcom G7",
    shortLabel: "Dexcom G7",
    color: "#6d70ad",
    verificationLabel: "実機確認前",
    dataStatus: "available",
    captureRoute: "別Gluroo Global Connectから取得し、公開前に匿名化",
    note: "Dexcom Share、Gluroo、限定リレーを含む実機経路は未確認です。確認前に対応済みとは案内しません。"
  })
]);

export function validateCaptureRange(startInput, endInput, maxRangeDays = 31) {
  const startMs = new Date(startInput).getTime();
  const endMs = new Date(endInput).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error("開始日時と終了日時を入力してください。");
  if (endMs <= startMs) throw new Error("終了日時は開始日時より後にしてください。");
  const durationMs = endMs - startMs;
  if (durationMs > maxRangeDays * 86_400_000) throw new Error(`比較期間は${maxRangeDays}日以内にしてください。`);
  return { startMs, endMs, durationMinutes: durationMs / 60_000 };
}

export async function collectCaptureEntries({
  range,
  relayConfigs,
  preparedRelaySourceId = null,
  prepareRelaySource,
  createPublicAdapter,
  createRelayAdapter,
  onProgress = () => {},
  onPreparedRelaySource = () => {}
}) {
  if (!Number.isFinite(range?.startMs) || !Number.isFinite(range?.endMs)) {
    throw new Error("取得期間を確認してください。");
  }
  if (
    typeof prepareRelaySource !== "function"
    || typeof createPublicAdapter !== "function"
    || typeof createRelayAdapter !== "function"
  ) {
    throw new Error("取得機能を開始できませんでした。");
  }

  let activeRelaySourceId = preparedRelaySourceId;
  const entriesBySource = {};

  for (let index = 0; index < SOURCE_DEFINITIONS.length; index += 1) {
    const source = SOURCE_DEFINITIONS[index];
    onProgress(source, index, SOURCE_DEFINITIONS.length);

    let adapter;
    if (source.id === "guardian-4") {
      adapter = createPublicAdapter(source);
    } else {
      const config = relayConfigs?.[source.id];
      if (!config) throw new Error(`${source.shortLabel}の接続情報を確認してください。`);

      // A persistent device session is bound to exactly one Gluroo source.
      // Rotate it before touching the next source so two credentials can never
      // share one anonymous server-side session.
      if (activeRelaySourceId !== source.id) {
        await prepareRelaySource(config, source);
        activeRelaySourceId = source.id;
        onPreparedRelaySource(source.id);
      }
      adapter = createRelayAdapter(config, source);
    }

    const result = await adapter.fetchEntries(range.startMs, range.endMs, 12_000);
    entriesBySource[source.id] = Array.isArray(result?.data) ? result.data : [];
  }

  return { entriesBySource, preparedRelaySourceId: activeRelaySourceId };
}

export function anonymizeEntries(entries, startMs, endMs) {
  const unique = new Map();
  for (const entry of entries || []) {
    const glucose = Number(entry?.sgv ?? entry?.glucose ?? entry?.value);
    const rawTimestamp = Number(entry?.date ?? entry?.timestamp ?? entry?.time);
    const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp < 100_000_000_000
      ? rawTimestamp * 1000
      : rawTimestamp;
    if (!Number.isFinite(glucose) || !Number.isFinite(timestamp)) continue;
    if (timestamp < startMs || timestamp > endMs) continue;
    if (glucose < 20 || glucose > 600) continue;
    unique.set(timestamp, [Number(((timestamp - startMs) / 60_000).toFixed(3)), glucose]);
  }
  return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, reading]) => reading);
}

export function buildAnonymizedDataset({ startMs, endMs, entriesBySource }) {
  const durationMinutes = (endMs - startMs) / 60_000;
  const sources = SOURCE_DEFINITIONS.map((definition) => ({
    ...definition,
    readings: anonymizeEntries(entriesBySource[definition.id], startMs, endMs)
  }));
  if (sources.some((source) => source.readings.length === 0)) {
    throw new Error("3種類すべてに、選択期間の血糖エントリーが必要です。");
  }

  return validateDataset({
    schemaVersion: 1,
    status: "anonymized",
    title: "Three CGM simultaneous observation",
    durationMinutes,
    matchToleranceMinutes: 3,
    disclosure: "Kazuma自身が同じ期間に装着した3種類のCGM表示を匿名化したスナップショットです。正確な日付、接続情報、治療・食事・薬・ポンプ情報は含みません。CGMの精度や優劣、医療判断を示すものではありません。",
    sources
  });
}

export { SOURCE_DEFINITIONS };
