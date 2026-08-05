import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(testDirectory, "..");
const nativeDirectory = path.join(repositoryDirectory, "app-native");

test("Capacitor config disables global HTTP patching and logging", async () => {
  const config = JSON.parse(await readFile(path.join(nativeDirectory, "capacitor.config.json"), "utf8"));

  assert.equal(config.loggingBehavior, "none");
  assert.equal(config.plugins?.CapacitorHttp?.enabled, false);
  assert.equal(config.server?.appStartPath, "user.html");
});

test("native data-source transport disables redirects", async () => {
  const source = await readFile(path.join(repositoryDirectory, "js", "native-app.js"), "utf8");
  let capturedCall = null;
  const context = {
    DOMException,
    Headers,
    Request,
    Response,
    Capacitor: {
      nativePromise: async (pluginName, methodName, options) => {
        capturedCall = { pluginName, methodName, options };
        return {
          status: 302,
          headers: { location: "https://redirect.invalid/" },
          data: ""
        };
      }
    }
  };
  context.globalThis = context;

  runInNewContext(source, context);
  const response = await context.GlucoScopeNativeApp.fetch("https://example.invalid/api", {
    method: "GET",
    headers: { "api-secret": "test-only-value" },
    redirect: "error"
  });

  assert.equal(response.status, 302);
  assert.equal(capturedCall.pluginName, "CapacitorHttp");
  assert.equal(capturedCall.methodName, "request");
  assert.equal(capturedCall.options.disableRedirects, true);
  assert.equal(capturedCall.options.connectTimeout, 18000);
  assert.equal(capturedCall.options.readTimeout, 18000);
  assert.equal(capturedCall.options.headers["api-secret"], "test-only-value");
});

test("native web preparation removes relay and analytics scripts", async () => {
  execFileSync(process.execPath, [path.join(nativeDirectory, "scripts", "prepare-web.mjs")], {
    cwd: nativeDirectory,
    stdio: "pipe"
  });

  const sourceIndex = await readFile(path.join(repositoryDirectory, "index.html"), "utf8");
  const nativeIndex = await readFile(path.join(nativeDirectory, "www", "index.html"), "utf8");

  assert.match(sourceIndex, /data-relay-client\.js/);
  assert.match(sourceIndex, /analytics-loader\.js/);
  assert.doesNotMatch(nativeIndex, /data-relay-client\.js/);
  assert.doesNotMatch(nativeIndex, /analytics-loader\.js/);
  assert.match(nativeIndex, /native-app\.js/);
});

test("cloud workflow is unsigned and does not reference repository secrets", async () => {
  const workflow = await readFile(
    path.join(repositoryDirectory, ".github", "workflows", "ios-cloud-build.yml"),
    "utf8"
  );

  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /app-store|testflight/i);
});
