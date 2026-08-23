import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import vm from "node:vm";

const projectRoot = new URL("../", import.meta.url);
const index = await readFile(new URL("index.html", projectRoot), "utf8");
const css = await readFile(new URL("style.css", projectRoot), "utf8");
const manifestUrl = new URL("manifest.webmanifest", projectRoot);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

function runEarlyHeadScript({ navigatorStandalone = false } = {}) {
  const script = index.match(/<script>\s*([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, "the early head script must exist");

  const classes = new Set();
  vm.runInNewContext(script, {
    URLSearchParams,
    console: { warn() {} },
    document: {
      documentElement: {
        classList: {
          add(value) {
            classes.add(value);
          }
        }
      },
      getElementById() {
        return null;
      }
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    window: {
      location: { search: "" },
      navigator: { standalone: navigatorStandalone }
    }
  });

  return classes;
}

test("user Home Screen launch uses the personal-user route in standalone mode", () => {
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/?mode=user");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "GlucoScope");
  assert.equal(manifest.short_name, "GlucoScope");
  assert.equal(manifest.theme_color, "#0f172a");
  assert.equal(manifest.background_color, "#0f172a");
});

test("root-relative launch and icon paths resolve on the apex and local server", () => {
  for (const origin of ["https://glucoscope.app/", "http://localhost:8791/"]) {
    assert.equal(new URL(manifest.id, origin).toString(), origin);
    assert.equal(new URL(manifest.start_url, origin).toString(), `${origin}?mode=user`);
    assert.equal(
      new URL(manifest.icons[0].src, origin).toString(),
      `${origin}assets/gluco/about/gluco-small-notice.png`
    );
  }
});

test("manifest icon is an existing square RGBA PNG suitable for iPhone scaling", async () => {
  assert.equal(manifest.icons.length, 1);
  const [icon] = manifest.icons;
  assert.equal(icon.src, "/assets/gluco/about/gluco-small-notice.png");
  assert.equal(icon.sizes, "768x768");
  assert.equal(icon.type, "image/png");
  assert.equal(icon.purpose, "any");

  const iconUrl = new URL(icon.src.replace(/^\//u, ""), projectRoot);
  await access(iconUrl);
  const png = await readFile(iconUrl);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(8), 13, "PNG must begin with a standard IHDR chunk");
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 768);
  assert.equal(png.readUInt32BE(20), 768);
  assert.equal(png[25], 6, "PNG must use RGBA rather than an indexed/unknown format");
});

test("main page advertises the manifest and iPhone standalone metadata", () => {
  assert.match(index, /<meta id="viewportMeta" name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/u);
  assert.match(index, /<link rel="manifest" href="manifest\.webmanifest">/u);
  assert.match(index, /<meta name="theme-color" content="#0f172a">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-capable" content="yes">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-status-bar-style" content="black">/u);
  assert.doesNotMatch(index, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/u);
  assert.match(index, /<meta name="apple-mobile-web-app-title" content="GlucoScope">/u);
  assert.match(index, /<link rel="apple-touch-icon" href="assets\/gluco\/about\/gluco-small-notice\.png">/u);
  assert.match(index, /<link rel="stylesheet" href="style\.css\?v=20260823-plus-quota-reliability-1">/u);
});

test("early launch detection marks only an installed Home Screen app", () => {
  const browserClasses = runEarlyHeadScript();
  const iosClasses = runEarlyHeadScript({ navigatorStandalone: true });

  assert.equal(browserClasses.has("ios-home-screen-app"), false);
  assert.equal(iosClasses.has("ios-home-screen-app"), true);
});

test("portrait iPhone layouts reserve a WebKit-safe top inset with Home Screen fallbacks", () => {
  assert.match(css, /@media \(orientation:portrait\) and \(hover:none\) and \(pointer:coarse\)/u);
  assert.match(css, /html:not\(\.force-desktop-view\) \.about-detail-wrap,\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.dashboard\{\s*padding-top:max\(6px,env\(safe-area-inset-top,0px\)\);/u);
  assert.match(css, /\(min-aspect-ratio:27\/50\)[^{]*\(max-aspect-ratio:57\/100\)[^{]*\{\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.dashboard,\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.about-detail-wrap,\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.share-studio-dialog\{\s*padding-top:max\(20px,env\(safe-area-inset-top,0px\)\);/u);
  assert.match(css, /\(max-aspect-ratio:10\/21\)[^{]*\{\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.dashboard,\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.about-detail-wrap,\s*html\.ios-home-screen-app:not\(\.force-desktop-view\) \.share-studio-dialog\{\s*padding-top:max\(59px,env\(safe-area-inset-top,0px\)\);/u);
  assert.doesNotMatch(css, /@media[^{}]*\(orientation:landscape\)[^{]*\{[^{}]*html\.ios-home-screen-app/u);
});

test("every About, Trust, and Plus detail page receives the iPhone safe-area stylesheet", async () => {
  const detailDirectories = ["pages/about/", "pages/trust/"];
  const detailPages = [];

  for (const directory of detailDirectories) {
    const directoryUrl = new URL(directory, projectRoot);
    for (const name of await readdir(directoryUrl)) {
      if (!name.endsWith(".html")) continue;
      const page = await readFile(new URL(name, directoryUrl), "utf8");
      if (page.includes('class="about-detail-topbar"')) detailPages.push(page);
    }
  }

  assert.equal(detailPages.length, 26);
  for (const page of detailPages) {
    assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/u);
    assert.match(page, /\.\.\/\.\.\/style\.css\?v=20260823-ios-detail-safe-area-1/u);
  }
});
