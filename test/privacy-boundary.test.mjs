import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile, readdir, stat } from "node:fs/promises";

const rootUrl = new URL("../", import.meta.url);
const analyticsSource = await readFile(new URL("../js/analytics-loader.js", import.meta.url), "utf8");

const connectionStorageKey = "glucoscope.dataSource.v1";
const sessionConnectionStorageKey = "glucoscope.dataSource.session.v1";
const profileStorageKey = "glucoscope.localProfile.v1";

function storageWith(values = {}, throws = false) {
  return {
    getItem(key) {
      if (throws) throw new Error("storage unavailable");
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    }
  };
}

function runAnalyticsLoader({
  search = "",
  pathname = "/index.html",
  localValue = null,
  sessionValue = null,
  profileValue = null,
  localStorageThrows = false,
  sessionStorageThrows = false
} = {}) {
  const appended = [];
  const context = {
    URLSearchParams,
    location: { search, pathname },
    localStorage: storageWith({
      [connectionStorageKey]: localValue,
      [profileStorageKey]: profileValue
    }, localStorageThrows),
    sessionStorage: storageWith({
      [sessionConnectionStorageKey]: sessionValue
    }, sessionStorageThrows),
    document: {
      head: {
        appendChild(node) {
          appended.push(node);
        }
      },
      createElement(tagName) {
        return { tagName, dataset: {} };
      }
    },
    console
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(analyticsSource, context, { filename: "analytics-loader.js" });
  return appended;
}

async function collectHtmlFiles(relativeDir) {
  const files = [];
  const entries = await readdir(new URL(relativeDir, rootUrl), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = `${relativeDir}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await collectHtmlFiles(`${relativePath}/`));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(relativePath);
    }
  }
  return files;
}

test("analytics loads only on a public page with no stored user connection", () => {
  const scripts = runAnalyticsLoader();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://static.cloudflareinsights.com/beacon.min.js");
  assert.equal(scripts[0].referrerPolicy, "no-referrer");
});

test("analytics is disabled in user mode and while either connection key is stored", () => {
  assert.equal(runAnalyticsLoader({ search: "?mode=user" }).length, 0);
  assert.equal(runAnalyticsLoader({ pathname: "/user.html" }).length, 0);
  assert.equal(runAnalyticsLoader({ localValue: "stored-config" }).length, 0);
  assert.equal(runAnalyticsLoader({ sessionValue: "session-config" }).length, 0);
});

test("a local display-name profile does not disable public Web Analytics", () => {
  for (const profileValue of [
    JSON.stringify({ schemaVersion: 1, displayName: "nickname" }),
    JSON.stringify({
      schemaVersion: 1,
      displayName: "legacy",
      futureUsageSharingPreference: "willing"
    }),
    "{broken"
  ]) {
    assert.equal(runAnalyticsLoader({ profileValue }).length, 1);
  }
  assert.doesNotMatch(analyticsSource, /glucoscope\.localProfile\.v1|LOCAL_PROFILE_STORAGE_KEY/);
});

test("analytics fails closed when either browser storage cannot be inspected", () => {
  assert.equal(runAnalyticsLoader({ localStorageThrows: true }).length, 0);
  assert.equal(runAnalyticsLoader({ sessionStorageThrows: true }).length, 0);
});

test("active HTML pages do not directly execute remote runtime scripts", async () => {
  const files = ["index.html", ...await collectHtmlFiles("pages/about/"), ...await collectHtmlFiles("pages/trust/")];
  for (const file of files) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /<script[^>]+src=["']https:\/\//i, file);
  }
});

test("main, About, and Trust pages use the local analytics privacy gate", async () => {
  const files = ["index.html", ...await collectHtmlFiles("pages/about/"), ...await collectHtmlFiles("pages/trust/")];
  for (const file of files) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /analytics-loader\.js/, file);
    assert.doesNotMatch(html, /static\.cloudflareinsights\.com/, file);
  }
});

test("Chart.js is vendored locally with its license", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /vendor\/chart\.js\/chart\.umd\.min\.js\?v=4\.5\.1/);
  assert.doesNotMatch(index, /cdn\.jsdelivr\.net\/npm\/chart\.js/i);
  const runtime = await stat(new URL("../vendor/chart.js/chart.umd.min.js", import.meta.url));
  const license = await readFile(new URL("../vendor/chart.js/LICENSE.md", import.meta.url), "utf8");
  assert.ok(runtime.size > 100_000);
  assert.match(license, /MIT License/);
});
