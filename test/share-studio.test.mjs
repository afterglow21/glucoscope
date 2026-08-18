import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/share-studio.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function loadModule() {
  const context = { Object, String, URL, Blob, File: class {}, setTimeout };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "share-studio.js" });
  return context.GlucoScopeShareStudio;
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
});

test("Share Studio is rollout-hidden and completes a trial only after local image creation", () => {
  assert.match(index, /id="mobileShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioButton"[^>]*hidden/u);
  assert.match(index, /js\/share-studio\.js/u);
  assert.match(index, /接続URLや合言葉は画像にもサーバーにも送りません/u);
  assert.match(app, /reserveShareStudio[\s\S]*generateBlob[\s\S]*completeShareStudio/u);
  assert.match(app, /!completionStarted[\s\S]*releaseShareStudio/u);
  assert.match(app, /completionStarted[\s\S]*体験の完了を確認できなかったため/u);
  assert.match(app, /event\.key === "Escape"[\s\S]*closeShareStudio/u);
  assert.match(app, /shareStudioOpener\?\.focus/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(/u);
});
