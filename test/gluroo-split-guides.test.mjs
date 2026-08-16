import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const guideUrl = new URL("../guides/gluroo-setup/index.html", import.meta.url);
const guide = await readFile(guideUrl, "utf8");
const dexcomGuide = await readFile(new URL("../guides/dexcom-share/index.html", import.meta.url), "utf8");
const libreGuide = await readFile(new URL("../guides/librelinkup/index.html", import.meta.url), "utf8");
const guideCss = await readFile(new URL("../guides/guide.css", import.meta.url), "utf8");

const manualStart = guide.indexOf('<div id="glurooDeviceGuide"');
const manualEnd = guide.lastIndexOf("    </div>\n  </main>");
const landing = guide.slice(guide.indexOf('<div id="glurooGuideLanding"'), manualStart);
const manual = guide.slice(manualStart, manualEnd);
const inlineScript = guide.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1] || "";

function getJpegDimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions were not found");
}

function runDeviceGuide(device) {
  const stepTags = Array.from(manual.matchAll(/<section class="guide-card guide-step"([^>]*)>/g));
  const fakeManual = {
    hidden: true,
    querySelectorAll(selector) {
      if (selector === "[data-device]") return steps.filter((step) => step.dataset.device);
      if (selector === "[data-device-copy]") return deviceCopy;
      if (selector === ".guide-step") return steps;
      return [];
    },
  };
  const steps = stepTags.map((match) => {
    const selectedDevice = match[1].match(/data-device="([^"]+)"/)?.[1] || "";
    const number = { textContent: "" };
    const progress = { textContent: "" };
    return {
      dataset: { ...(selectedDevice ? { device: selectedDevice } : {}) },
      hidden: false,
      closest(selector) {
        if (selector !== "[hidden]") return null;
        return this.hidden || fakeManual.hidden ? this : null;
      },
      querySelector(selector) {
        if (selector === ".guide-step-number") return number;
        if (selector === ".guide-progress") return progress;
        return null;
      },
      number,
      progress,
    };
  });
  const deviceCopy = Array.from(manual.matchAll(/data-device-copy="([^"]+)"/g), (match) => ({
    dataset: { deviceCopy: match[1] },
    hidden: false,
  }));
  const fakeLanding = { hidden: false };
  const backLink = { href: "", textContent: "" };
  const title = { textContent: "" };
  const lead = { textContent: "" };
  const elements = new Map([
    ["glurooGuideLanding", fakeLanding],
    ["glurooDeviceGuide", fakeManual],
    ["glurooGuideBack", backLink],
    ["glurooDeviceTitle", title],
    ["glurooDeviceLead", lead],
  ]);
  const document = {
    title: "",
    documentElement: { dataset: {} },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  const window = {
    location: { search: `?device=${device}`, hash: "" },
    addEventListener() {},
    cancelAnimationFrame() {},
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    setTimeout() { return 1; },
  };

  vm.runInNewContext(inlineScript, { document, window, URLSearchParams, Set });
  return { fakeLanding, fakeManual, backLink, title, lead, steps, deviceCopy };
}

test("Gluroo entry offers separate G7 and Libre routes while keeping Guardian standalone", () => {
  assert.ok(manualStart > 0 && manualEnd > manualStart);
  assert.match(landing, /href="\?device=g7"/);
  assert.match(landing, /href="\?device=libre"/);
  assert.match(landing, /Guardian Monitorの専用ガイドを開く/);
  assert.match(landing, /href="\.\.\/guardian-monitor\/"/);
  assert.doesNotMatch(manual, /Guardian|guardian-monitor/);
});

for (const device of ["g7", "libre"]) {
  test(`${device} route exposes only its selected CGM and renumbers every visible step`, () => {
    const rendered = runDeviceGuide(device);
    assert.equal(rendered.fakeLanding.hidden, true);
    assert.equal(rendered.fakeManual.hidden, false);
    assert.equal(rendered.backLink.href, "./");
    assert.equal(rendered.steps.length, 36);

    const visibleSteps = rendered.steps.filter((step) => !step.hidden);
    assert.equal(visibleSteps.length, 35);
    visibleSteps.forEach((step, index) => {
      assert.equal(step.number.textContent, String(index + 1));
      assert.equal(step.progress.textContent, `全35STEP中 ${index + 1}`);
    });

    const selectedSection = rendered.steps.find((step) => step.dataset.device === device);
    const otherSection = rendered.steps.find((step) => step.dataset.device && step.dataset.device !== device);
    assert.equal(selectedSection.hidden, false);
    assert.equal(otherSection.hidden, true);
    assert.ok(rendered.deviceCopy.filter((copy) => copy.dataset.deviceCopy === device).every((copy) => !copy.hidden));
    assert.ok(rendered.deviceCopy.filter((copy) => copy.dataset.deviceCopy !== device).every((copy) => copy.hidden));
  });
}

test("the early CGM prompt is always postponed and each later setup block is device-only", () => {
  const earlyPrompt = manual.slice(manual.indexOf('id="screen-22"'), manual.indexOf('id="screen-23"'));
  const dexcomSetup = manual.slice(manual.indexOf('id="screen-28"'), manual.indexOf('id="screen-29"'));
  const libreSetup = manual.slice(manual.indexOf('id="screen-29"'), manual.indexOf('id="screen-30"'));

  assert.match(earlyPrompt, /必ず「これは後で行います」を押して/);
  assert.doesNotMatch(earlyPrompt, /librelinkup|dexcom-share/i);
  assert.match(dexcomSetup, /data-device="g7"/);
  assert.match(dexcomSetup, /Dexcom Share/);
  assert.doesNotMatch(dexcomSetup, /Libre/);
  assert.match(libreSetup, /data-device="libre"/);
  assert.match(libreSetup, /LibreLinkUp/);
  assert.doesNotMatch(libreSetup, /Dexcom/);
});

test("Home Screen captures are action-labelled, sized, and used before first connection", async () => {
  const captures = [
    ["01-open-share-menu.jpg", 634, 1280],
    ["02-open-in-safari-add-home-screen.jpg", 630, 1280],
  ];
  assert.ok(manual.indexOf('id="home-screen-share"') < manual.indexOf('id="screen-01"'));
  assert.match(manual, /「ブックマークに追加」ではありません/);
  assert.match(manual, /「Safariで開く」が表示されたら、先にそれを押します/);
  assert.match(manual, /alt="GlucoScopeを開いたブラウザのメニューで、共有を選ぶ場所"/);
  assert.match(manual, /alt="iPhoneの共有メニューにある、Safariで開くとホーム画面に追加の操作"/);

  for (const [name, width, height] of captures) {
    const bytes = await readFile(new URL(`../guides/gluroo-setup/images/home-screen/${name}`, import.meta.url));
    assert.deepEqual(getJpegDimensions(bytes), { width, height });
    const ascii = bytes.toString("latin1");
    assert.doesNotMatch(ascii, /api-secret=|token=|GPSLatitude|GPSLongitude/i);
  }
});

test("final handoff names the one-button flow and exact success state", () => {
  const finalStep = manual.slice(manual.indexOf('id="screen-34"'));
  assert.match(finalStep, /GlucoScopeの接続画面へ戻る/);
  assert.match(finalStep, /接続してGlucoScopeを始める/);
  assert.match(finalStep, /接続を確認しているよ…/);
  assert.match(finalStep, /ようこそ、GlucoScopeへ 🍀/);
  assert.match(finalStep, /接続できました。最新の血糖データを表示しています。/);
  assert.match(finalStep, /現在の血糖値画面が見えたら成功/);
});

test("device preparation guides return to their matching later setup step", () => {
  assert.equal((dexcomGuide.match(/\.\.\/gluroo-setup\/\?device=g7#screen-28/g) || []).length, 2);
  assert.equal((libreGuide.match(/\.\.\/gluroo-setup\/\?device=libre#screen-29/g) || []).length, 2);
  assert.doesNotMatch(dexcomGuide, /gluroo-setup\/#screen-22/);
  assert.doesNotMatch(libreGuide, /gluroo-setup\/#screen-22/);
  assert.match(guideCss, /\[hidden\]\{display:none!important\}/);
});
