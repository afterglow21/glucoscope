import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

test("public UI clearly pauses new starts while preserving existing use", () => {
  const html = read("index.html");
  const app = read("js/app.js");

  assert.match(html, /name="glucoscope-new-user-starts-enabled" content="false"/u);
  assert.match(html, /name="glucoscope-plus-purchases-enabled" content="false"/u);
  assert.match(html, /新規利用開始を停止中です。/u);
  assert.match(html, /すでに接続済みの方は引き続き利用できます/u);
  assert.match(html, /id="dataSourcePausedPanel"/u);
  assert.match(app, /const NEW_USER_STARTS_ENABLED =/u);
  assert.match(app, /else if \(!NEW_USER_STARTS_ENABLED\) \{[\s\S]*?dataSourcePausedPanel/u);
  assert.match(app, /if \(firstConnection && !NEW_USER_STARTS_ENABLED\)/u);
  assert.match(app, /Plusの新規購入を停止中です/u);
});

test("server-side release flags default to rejecting new connections and purchases", () => {
  const relayConfig = read("workers/gluco-data-relay/wrangler.jsonc");
  const plusConfig = read("workers/gluco-plus-entitlement/wrangler.jsonc");
  const relayCore = read("workers/gluco-data-relay/src/relay-core.js");

  assert.match(relayConfig, /"RELAY_NEW_DEVICE_SESSIONS_ENABLED": "false"/u);
  assert.match(plusConfig, /"PLUS_PURCHASES_ENABLED": "false"/u);
  assert.match(relayCore, /new_connections_paused/u);
});
