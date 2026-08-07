import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

import {
  buildMatchedComparisons,
  computeObservationSummary,
  formatElapsedMinute,
  validateDataset
} from "../demos/cgm-comparison/comparison-core.mjs";
import {
  LIVE_SOURCE_STALE_AFTER_MS,
  MAX_PRESERVED_LIVE_AGE_MS,
  buildLiveComparisonDataset,
  canPreserveLiveDataset,
  fetchOptionalPublicFeed,
  normalizePublicFeedEndpoint,
  validatePublicFeed,
  validatePublicLibreFeed
} from "../demos/cgm-comparison/live-comparison-core.mjs";
import {
  anonymizeEntries,
  buildAnonymizedDataset,
  validateCaptureRange
} from "../tools/cgm-comparison-capture/capture-core.mjs";

const sampleUrl = new URL("../demos/cgm-comparison/data/sample.json", import.meta.url);

test("public sample is explicitly synthetic, three-source, and privacy-safe", async () => {
  const sampleText = await readFile(sampleUrl, "utf8");
  const dataset = validateDataset(JSON.parse(sampleText));
  assert.equal(dataset.status, "synthetic");
  assert.deepEqual(dataset.sources.map((source) => source.id), ["guardian-4", "libre-2", "dexcom-g7"]);
  assert.deepEqual(dataset.sources.map((source) => source.dataStatus), ["available", "available", "available"]);
  assert.match(dataset.disclosure, /表示中の線は合成データ/);
  assert.match(dataset.disclosure, /公開3CGMライブデモは継続中/);
  assert.match(dataset.disclosure, /安全に読み込めない場合/);
  assert.match(dataset.sources[0].captureRoute, /Azure Nightscout/);
  assert.match(dataset.sources[1].captureRoute, /Gluroo Global Connect/);
  assert.match(dataset.sources[2].captureRoute, /Gluroo Global Connect/);
  assert.equal(dataset.sources[1].verificationLabel, "公開デモ経路を実機確認済み");
  assert.match(dataset.sources[1].captureRoute, /公開デモ用Worker、GitHub Pagesまで継続公開中/);
  assert.match(dataset.sources[1].note, /公開3CGMライブデモを継続中/);
  assert.match(dataset.sources[1].note, /2回の定期集計確認と1回のブラウザ自動更新/);
  assert.match(dataset.sources[1].note, /本番の自然失効は未確認/);
  assert.match(dataset.sources[1].note, /表示中の線は安全なフォールバック用の合成データ/);
  assert.equal(dataset.sources[2].verificationLabel, "公開デモ経路を実機確認済み");
  assert.match(dataset.sources[2].captureRoute, /公開デモ用Worker、GitHub Pagesまで継続公開中/);
  assert.match(dataset.sources[2].note, /一般利用者向け限定中継とは別/);
  assert.match(dataset.sources[2].note, /公開3CGMライブデモを継続中/);
  assert.match(dataset.sources[2].note, /dexcomRouteVerified=true/);
  assert.match(dataset.sources[2].note, /Workerの有効化ではありません/);
  assert.match(dataset.sources[2].note, /2回の定期集計確認と1回のブラウザ自動更新/);
  assert.match(dataset.sources[2].note, /本番の自然失効は未確認/);
  assert.match(dataset.sources[2].note, /表示中の線は安全なフォールバック用の合成データ/);
  assert.doesNotMatch(sampleText, /https?:\/\//i);
  assert.doesNotMatch(sampleText, /\b\d{4}-\d{2}-\d{2}\b/);
  assert.doesNotMatch(sampleText, /secret|password|email|account[-_ ]?id/i);
});

test("a public dataset can keep an unstarted CGM pending without fabricated readings", async () => {
  const sample = JSON.parse(await readFile(sampleUrl, "utf8"));
  sample.sources[2].dataStatus = "pending";
  sample.sources[2].readings = [];
  const dataset = validateDataset(sample);
  assert.equal(dataset.sources[2].dataStatus, "pending");
  assert.deepEqual(dataset.sources[2].readings, []);

  sample.sources[2].dataStatus = "available";
  assert.throws(() => validateDataset(sample), /available source needs readings/);
});

test("live comparison uses Guardian and Libre while Dexcom remains pending", () => {
  const nowMs = Date.parse("2026-08-06T06:00:00.000Z");
  const dataset = buildLiveComparisonDataset({
    nowMs,
    windowHours: 24,
    guardianEntries: [
      { sgv: 101, date: nowMs - 300_000, device: "private-guardian" },
      { sgv: 104, date: nowMs }
    ],
    librePayload: {
      ok: true,
      sourceId: "libre-2",
      updatedAt: nowMs,
      stale: false,
      entries: [
        { sgv: 99, date: nowMs - 300_000, direction: "Flat" },
        { sgv: 103, date: nowMs }
      ]
    }
  });
  assert.equal(dataset.status, "live");
  assert.deepEqual(dataset.sources.map((source) => source.dataStatus), ["available", "available", "pending"]);
  assert.equal(dataset.sources[0].readings.length, 2);
  assert.equal(dataset.sources[1].readings.length, 2);
  assert.equal(dataset.sources[1].verificationLabel, "公開デモ経路を実機確認済み");
  assert.match(dataset.sources[1].captureRoute, /公開デモ用Worker、GitHub Pagesまで継続公開中/);
  assert.match(dataset.sources[1].note, /接続情報は公開されません/);
  assert.match(dataset.sources[1].note, /公開3CGMライブデモを継続中/);
  assert.match(dataset.sources[1].note, /2回の定期集計確認と1回のブラウザ自動更新/);
  assert.match(dataset.sources[1].note, /本番の自然失効は未確認/);
  assert.deepEqual(dataset.sources[2].readings, []);
  assert.equal(dataset.sources[2].verificationLabel, "公開デモ経路を実機確認済み");
  assert.match(dataset.sources[2].captureRoute, /公開デモ用Worker、GitHub Pagesまで継続公開中/);
  assert.match(dataset.sources[2].note, /一般利用者向け限定中継とは別/);
  assert.match(dataset.sources[2].note, /公開3CGMライブデモを継続中/);
  assert.match(dataset.sources[2].note, /2回の定期集計確認と1回のブラウザ自動更新/);
  assert.match(dataset.sources[2].note, /本番の自然失効は未確認/);
  assert.doesNotMatch(JSON.stringify(dataset), /private-guardian|dateString|https?:\/\/|secret/i);
});

test("a valid G7 feed stays pending until frontend activation is separately approved", () => {
  const nowMs = Date.parse("2026-08-06T06:00:00.000Z");
  const libreUpdatedAt = nowMs - 60_000;
  const dexcomUpdatedAt = nowMs - 180_000;
  const base = {
    nowMs,
    guardianEntries: [{ sgv: 104, date: nowMs }],
    librePayload: {
      ok: true,
      sourceId: "libre-2",
      updatedAt: libreUpdatedAt,
      stale: false,
      entries: [{ sgv: 103, date: nowMs }]
    },
    dexcomPayload: {
      ok: true,
      sourceId: "dexcom-g7",
      updatedAt: dexcomUpdatedAt,
      stale: false,
      entries: [{ sgv: 102, date: nowMs }]
    }
  };
  const dormant = buildLiveComparisonDataset({ ...base, dexcomRouteVerified: false });
  assert.equal(dormant.sources[2].dataStatus, "pending");
  assert.deepEqual(dormant.sources[2].readings, []);
  assert.equal(dormant.updatedAt, libreUpdatedAt);

  const verified = buildLiveComparisonDataset({ ...base, dexcomRouteVerified: true });
  assert.equal(verified.sources[2].dataStatus, "available");
  assert.equal(verified.sources[2].readings.length, 1);
  assert.equal(verified.sources[2].verificationLabel, "公開デモ経路を実機確認済み");
  assert.match(verified.disclosure, /Dexcom G7/);
  assert.equal(verified.updatedAt, dexcomUpdatedAt);
});

test("Guardian and G7 use the latest reading age for the gentle update-delay state", () => {
  const nowMs = Date.parse("2026-08-06T06:00:00.000Z");
  const delayedReadingAt = nowMs - LIVE_SOURCE_STALE_AFTER_MS - 1;
  const dataset = buildLiveComparisonDataset({
    nowMs,
    guardianEntries: [{ sgv: 104, date: delayedReadingAt }],
    librePayload: {
      ok: true,
      sourceId: "libre-2",
      updatedAt: nowMs,
      stale: false,
      entries: [{ sgv: 103, date: nowMs }]
    },
    dexcomPayload: {
      ok: true,
      sourceId: "dexcom-g7",
      updatedAt: nowMs,
      stale: false,
      entries: [{ sgv: 102, date: delayedReadingAt }]
    },
    dexcomRouteVerified: true
  });

  assert.equal(LIVE_SOURCE_STALE_AFTER_MS, 15 * 60_000);
  assert.equal(dataset.sources[0].isStale, true);
  assert.match(dataset.sources[0].note, /Guardian 4の公開データ更新が遅れています/);
  assert.equal(dataset.sources[1].isStale, false);
  assert.equal(dataset.sources[2].isStale, true);
  assert.match(dataset.sources[2].note, /Dexcom G7の公開データ更新が遅れています/);
  assert.match(dataset.sources[2].note, /CGMや機器の停止を意味するものではありません/);
});

test("the upstream stale flag marks a fresh G7 snapshot as delayed", () => {
  const nowMs = Date.parse("2026-08-06T06:00:00.000Z");
  const dataset = buildLiveComparisonDataset({
    nowMs,
    guardianEntries: [{ sgv: 104, date: nowMs }],
    librePayload: {
      ok: true,
      sourceId: "libre-2",
      updatedAt: nowMs,
      stale: false,
      entries: [{ sgv: 103, date: nowMs }]
    },
    dexcomPayload: {
      ok: true,
      sourceId: "dexcom-g7",
      updatedAt: nowMs,
      stale: true,
      entries: [{ sgv: 102, date: nowMs }]
    },
    dexcomRouteVerified: true
  });

  assert.equal(dataset.sources[2].isStale, true);
  assert.match(dataset.sources[2].note, /公開経路から新しい表示をまだ受け取れていない状態/);
});

test("G7 is not described as live when its valid feed has no in-window readings", () => {
  const nowMs = Date.parse("2026-08-06T06:00:00.000Z");
  const outsideWindowAt = nowMs - 25 * 60 * 60_000;
  const dataset = buildLiveComparisonDataset({
    nowMs,
    windowHours: 24,
    guardianEntries: [{ sgv: 104, date: nowMs }],
    librePayload: {
      ok: true,
      sourceId: "libre-2",
      updatedAt: nowMs,
      stale: false,
      entries: [{ sgv: 103, date: nowMs }]
    },
    dexcomPayload: {
      ok: true,
      sourceId: "dexcom-g7",
      updatedAt: nowMs,
      stale: false,
      entries: [{ sgv: 102, date: outsideWindowAt }]
    },
    dexcomRouteVerified: true
  });

  assert.equal(dataset.sources[2].dataStatus, "pending");
  assert.deepEqual(dataset.sources[2].readings, []);
  assert.equal(dataset.title, "Guardian and Libre public demo observation");
  assert.doesNotMatch(dataset.disclosure, /Dexcom G7/);
});

test("a previous live view is preserved for at most the shared 15-minute boundary", () => {
  const loadedAt = Date.parse("2026-08-06T06:00:00.000Z");
  const liveDataset = { status: "live" };
  assert.equal(MAX_PRESERVED_LIVE_AGE_MS, LIVE_SOURCE_STALE_AFTER_MS);
  assert.equal(canPreserveLiveDataset(liveDataset, loadedAt, loadedAt + MAX_PRESERVED_LIVE_AGE_MS), true);
  assert.equal(canPreserveLiveDataset(liveDataset, loadedAt, loadedAt + MAX_PRESERVED_LIVE_AGE_MS + 1), false);
  assert.equal(canPreserveLiveDataset({ status: "synthetic" }, loadedAt, loadedAt + 1), false);
});

test("public Libre feed validation rejects private or unexpected fields", () => {
  const valid = {
    ok: true,
    sourceId: "libre-2",
    updatedAt: Date.parse("2026-08-06T06:00:00.000Z"),
    stale: false,
    entries: [{ sgv: 103, date: Date.parse("2026-08-06T05:55:00.000Z"), direction: "Flat" }]
  };
  assert.equal(validatePublicLibreFeed(valid), valid);
  assert.throws(
    () => validatePublicLibreFeed({ ...valid, entries: [{ ...valid.entries[0], device: "private" }] }),
    /unexpected fields/
  );
  assert.throws(() => validatePublicLibreFeed({ ...valid, privateAccount: "hidden" }), /unexpected fields/);
  assert.throws(() => validatePublicFeed(valid, "dexcom-g7"), /invalid/);
  assert.throws(
    () => validatePublicFeed({ ...valid, sourceId: "dexcom-g7", entries: [{ ...valid.entries[0], direction: "unknown" }] }, "dexcom-g7"),
    /direction/
  );
  assert.throws(
    () => validatePublicFeed({ ...valid, entries: [{ sgv: "103", date: valid.entries[0].date }] }, "libre-2"),
    /invalid/
  );
  assert.throws(
    () => validatePublicFeed({ ...valid, entries: [valid.entries[0], { ...valid.entries[0], sgv: 104 }] }, "libre-2"),
    /invalid/
  );
});

test("optional G7 feed failures return pending input without affecting required feeds", async () => {
  const endpoint = "https://example.invalid/v1/dexcom-g7";
  const nowMs = Date.parse("2026-08-06T06:00:00.000Z");
  const cases = [
    async () => new Response(JSON.stringify({ ok: false }), { status: 503 }),
    async () => { throw new Error("network unavailable"); },
    async () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })
  ];
  for (const fetchImpl of cases) {
    const dexcomPayload = await fetchOptionalPublicFeed(endpoint, "dexcom-g7", fetchImpl);
    assert.equal(dexcomPayload, null);
    const dataset = buildLiveComparisonDataset({
      nowMs,
      guardianEntries: [{ sgv: 104, date: nowMs }],
      librePayload: {
        ok: true,
        sourceId: "libre-2",
        updatedAt: nowMs,
        stale: false,
        entries: [{ sgv: 103, date: nowMs }]
      },
      dexcomPayload,
      dexcomRouteVerified: true
    });
    assert.equal(dataset.status, "live");
    assert.deepEqual(dataset.sources.map((source) => source.dataStatus), ["available", "available", "pending"]);
  }
});

test("optional public feed endpoint accepts HTTPS and local HTTP only", () => {
  const baseUrl = "https://afterglow21.github.io/glucoscope/demos/cgm-comparison/";
  assert.equal(normalizePublicFeedEndpoint("", baseUrl), "");
  assert.equal(normalizePublicFeedEndpoint("https://example.com/v1/dexcom-g7", baseUrl), "https://example.com/v1/dexcom-g7");
  assert.equal(normalizePublicFeedEndpoint("http://localhost:8787/v1/dexcom-g7", baseUrl), "http://localhost:8787/v1/dexcom-g7");
  assert.throws(() => normalizePublicFeedEndpoint("http://example.com/v1/dexcom-g7", baseUrl), /Unsafe/);
  assert.throws(() => normalizePublicFeedEndpoint("https://user:pass@example.com/v1/dexcom-g7", baseUrl), /Unsafe/);
});

test("comparison matching uses nearby readings without inventing a reference source", () => {
  const sources = [
    { readings: [[0, 100], [5, 110], [10, 120]] },
    { readings: [[1, 102], [6, 108], [15, 130]] },
    { readings: [[0, 99], [5, 112], [10, 117]] }
  ];
  const matched = buildMatchedComparisons(sources, 2);
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map((item) => item.spread), [3, 4]);
  assert.deepEqual(computeObservationSummary(sources, 2), {
    matchedCount: 2,
    medianSpread: 3.5,
    missingCount: 1
  });
});

test("elapsed labels expose no calendar date", () => {
  assert.equal(formatElapsedMinute(0), "Day 1 00:00");
  assert.equal(formatElapsedMinute(1505), "Day 2 01:05");
});

test("capture range is ordered and limited", () => {
  const range = validateCaptureRange("2026-08-01T00:00:00Z", "2026-08-11T00:00:00Z");
  assert.equal(range.durationMinutes, 14_400);
  assert.throws(() => validateCaptureRange("2026-08-11", "2026-08-01"), /終了日時/);
  assert.throws(() => validateCaptureRange("2026-01-01", "2026-03-01"), /31日以内/);
});

test("capture conversion removes exact timestamps and unrelated entry fields", () => {
  const startMs = Date.parse("2026-08-01T00:00:00Z");
  const endMs = startMs + 10 * 60_000;
  const readings = anonymizeEntries([
    { sgv: 101, date: startMs, direction: "Flat", device: "private-device" },
    { sgv: 108, date: startMs + 5 * 60_000, dateString: "2026-08-01T00:05:00Z" },
    { sgv: 111, date: endMs + 1 }
  ], startMs, endMs);
  assert.deepEqual(readings, [[0, 101], [5, 108]]);
});

test("candidate dataset includes only the anonymized publication schema", () => {
  const startMs = Date.parse("2026-08-01T00:00:00Z");
  const endMs = startMs + 10 * 60_000;
  const entries = [{ sgv: 101, date: startMs }, { sgv: 108, date: endMs }];
  const dataset = buildAnonymizedDataset({
    startMs,
    endMs,
    entriesBySource: {
      "guardian-4": entries,
      "libre-2": entries,
      "dexcom-g7": entries
    }
  });
  const serialized = JSON.stringify(dataset);
  assert.equal(dataset.status, "anonymized");
  assert.deepEqual(dataset.sources.map((source) => source.dataStatus), ["available", "available", "available"]);
  assert.equal(dataset.sources[1].verificationLabel, "基本接続を実機確認済み");
  assert.equal(dataset.sources[2].verificationLabel, "実機確認前");
  assert.doesNotMatch(serialized, /2026-08-01|https?:\/\/|secret|dateString|device/i);
});

test("public demo is linked while the capture helper stays unlinked and noindex", async () => {
  const rootIndex = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const demo = await readFile(new URL("../demos/cgm-comparison/index.html", import.meta.url), "utf8");
  const capture = await readFile(new URL("../tools/cgm-comparison-capture/index.html", import.meta.url), "utf8");
  const captureModule = await readFile(new URL("../tools/cgm-comparison-capture/capture.mjs", import.meta.url), "utf8");
  const comparisonModule = await readFile(new URL("../demos/cgm-comparison/comparison.mjs", import.meta.url), "utf8");
  const liveConfig = await readFile(new URL("../demos/cgm-comparison/live-config.js", import.meta.url), "utf8");
  assert.match(rootIndex, /href="demos\/cgm-comparison\/"/);
  assert.doesNotMatch(rootIndex, /tools\/cgm-comparison-capture/);
  assert.match(demo, /vendor\/chart\.js\/chart\.umd\.min\.js/);
  assert.match(demo, /analytics-loader\.js/);
  assert.match(demo, /js\/data-source\.js/);
  assert.match(demo, /live-config\.js\?v=20260807-three-cgm-live-1/);
  assert.match(demo, /現在は合成データです。3本の線は表示確認用で、Kazumaの実測値ではありません/);
  assert.match(comparisonModule, /現在は実測ライブデータです。取得できた\$\{liveSourceCount\}種類/);
  assert.match(comparisonModule, /現在は合成データです。3本の線は表示確認用で、Kazumaの実測値ではありません/);
  assert.match(comparisonModule, /現在表示：合成データ/);
  assert.match(comparisonModule, /現在表示：準備中/);
  assert.match(comparisonModule, /error instanceof DemoFeedPausedError/);
  assert.match(comparisonModule, /公開デモは停止中のため、合成データを表示しています/);
  assert.match(capture, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(capture, /analytics-loader\.js|static\.cloudflareinsights\.com/);
  assert.equal((capture.match(/type="password"/g) || []).length, 2);
  assert.doesNotMatch(capture, /name="guardian(?:Url|Secret)"/);
  assert.match(capture, /Azure Nightscout/);
  assert.match(captureModule, /createAdapter\(\{ mode: "public-demo" \}\)/);
  assert.match(captureModule, /prepareConnection\(relayConfigs\["libre-2"\]\)/);
  assert.match(liveConfig, /libreFeedEndpoint:\s*"https:\/\/glucoscope-demo-feed\.afterglow21\.workers\.dev\/v1\/libre"/);
  assert.match(liveConfig, /dexcomFeedEndpoint:\s*"https:\/\/glucoscope-demo-feed\.afterglow21\.workers\.dev\/v1\/dexcom-g7"/);
  assert.match(liveConfig, /dexcomRouteVerified:\s*true/);
  assert.doesNotMatch(liveConfig, /ns\.gluroo\.com|api.?secret|token/i);
});

test("live rendering gently identifies delayed sources and caps the preserved view", async () => {
  const comparisonModule = await readFile(new URL("../demos/cgm-comparison/comparison.mjs", import.meta.url), "utf8");
  const comparisonCss = await readFile(new URL("../demos/cgm-comparison/comparison.css", import.meta.url), "utf8");
  assert.match(comparisonModule, /更新が遅れているデータあり/);
  assert.match(comparisonModule, /現在表示：更新が遅れています/);
  assert.match(comparisonModule, /CGMや機器の停止を意味する表示ではありません/);
  assert.match(comparisonModule, /source\.isStale === true/);
  assert.match(comparisonModule, /canPreserveLiveDataset\(state\.dataset, state\.liveLoadedAt, Date\.now\(\)\)/);
  assert.match(comparisonModule, /古い表示を残さず合成データへ切り替えました/);
  assert.match(comparisonModule, /live-comparison-core\.mjs\?v=20260807-three-cgm-live-3/);
  assert.match(comparisonCss, /\.comparison-status-delayed/);
  assert.match(comparisonCss, /\.comparison-source-state-delayed/);
});

test("Method and privacy covers both Gluroo-backed public demo routes and Secrets", async () => {
  const demo = await readFile(new URL("../demos/cgm-comparison/index.html", import.meta.url), "utf8");
  assert.match(demo, /Libre 2とDexcom G7は公開デモ専用Worker/);
  assert.match(demo, /Libre 2とDexcom G7それぞれのGluroo URLとAPI SecretはCloudflare Secret/);
  assert.match(demo, /comparison\.mjs\?v=20260807-three-cgm-live-3/);
});

test("comparison and capture helper local links and assets resolve", async () => {
  const pages = [
    new URL("../demos/cgm-comparison/index.html", import.meta.url),
    new URL("../tools/cgm-comparison-capture/index.html", import.meta.url)
  ];
  for (const pageUrl of pages) {
    const html = await readFile(pageUrl, "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (/^(?:https?:|#|data:)/i.test(target)) continue;
      const resolved = new URL(target, pageUrl);
      resolved.hash = "";
      resolved.search = "";
      await assert.doesNotReject(access(resolved), `${pageUrl.pathname}: ${target}`);
    }
  }
});
