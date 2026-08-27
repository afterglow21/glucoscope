import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const guideUrl = new URL("../guides/gluroo-android-review-6f93c2b7a4d1/index.html", import.meta.url);
const guide = await readFile(guideUrl, "utf8");
const publicFiles = [
  "../index.html",
  "../guides/gluroo-setup/index.html",
  "../guides/librelinkup/index.html",
  "../guides/dexcom-share/index.html",
  "../pages/trust/roadmap.html",
];

test("Android review manual is unlinked and excluded from indexing", async () => {
  assert.match(guide, /画面提供者・カズマ確認用/);
  assert.match(guide, /meta name="robots" content="noindex, nofollow, noarchive"/);
  for (const relativePath of publicFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /gluroo-android-review-6f93c2b7a4d1/);
  }
});

test("Android review manual has thirty-one ordered image-led steps", () => {
  const ids = Array.from(guide.matchAll(/id="android-step-(\d+)"/g), (match) => Number(match[1]));
  assert.deepEqual(ids, Array.from({ length: 31 }, (_, index) => index + 1));
  const steps = Array.from(guide.matchAll(/<section class="guide-card guide-step"[\s\S]*?<\/section>/g), (match) => match[0]);
  assert.equal(steps.length, 31);
  assert.ok(steps.every((step) => /<img\s/.test(step)));
});

test("CGM account step links to the existing Libre and G7 iPhone guides", () => {
  const step = guide.match(/id="android-step-20"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(step, /href="\.\.\/librelinkup\/"/);
  assert.match(step, /href="\.\.\/dexcom-share\/"/);
  assert.match(step, /Libreを使っている方/);
  assert.match(step, /Dexcom G7を使っている方/);
});

test("review HTML and selected new images exclude supplied private values", async () => {
  assert.doesNotMatch(guide, /nutsnyao|62dd|fd07730|@gmail\.com/i);
  assert.match(guide, /Nightscout URL[\s\S]*接続先URL/);
  assert.match(guide, /API Secret Token[\s\S]*接続用の合言葉/);
  assert.match(guide, /「API Secret Header \(SHA1\)」は使いません/);
  const imageDir = new URL("../guides/gluroo-android-review-6f93c2b7a4d1/images/steps/", import.meta.url);
  const names = (await readdir(imageDir)).sort();
  assert.equal(names.length, 31);
  for (const name of names) {
    const bytes = await readFile(new URL(name, imageDir));
    const ascii = bytes.toString("latin1");
    assert.doesNotMatch(ascii, /GPSLatitude|GPSLongitude|DateTimeOriginal|nutsnyao|62dd|fd07730|@gmail\.com/i);
  }
});

test("all reorganized uploads are published only as renamed metadata-stripped assets", async () => {
  const imageDir = new URL("../guides/gluroo-android-review-6f93c2b7a4d1/images/steps/", import.meta.url);
  const names = (await readdir(imageDir)).sort();
  assert.deepEqual(names, [
    "01-play-store.jpg", "02-gluroo-install.jpg", "03-start.jpg",
    "04-who-for.jpg", "05-diabetes-type.jpg", "06-daily-design.jpg",
    "07-profile-demographics.jpg", "08-goals.jpg", "09-notifications.jpg",
    "10-cgm-choice.jpg", "11-pump-question.jpg", "12-insulin-settings.jpg",
    "13-medication-reminder.jpg", "14-google-login.jpg", "15-access-confirmed.jpg",
    "16-terms-review.jpg", "17-terms-agreed.jpg", "18-battery.jpg",
    "19-profile-nickname.jpg", "20-cgm-account.jpg", "21-a1c-skip.jpg",
    "21-cgm-connected.jpg", "22-ready.jpg", "23-glucoscope-connect.jpg",
    "24-home-dashboard.jpg", "25-menu-settings.jpg", "26-settings-global-connect.jpg",
    "27-global-connect-open.jpg", "28-copy-format-popup.jpg", "29-copy-url-token.jpg",
    "31-glucoscope-success.jpg",
  ]);
  assert.doesNotMatch(guide, /\.\.\/gluroo-setup\/images/);
});

test("fixed-choice onboarding steps use the exact buttons shown in the screenshots", () => {
  assert.doesNotMatch(guide, /小さなお子さんやご年配の方とも、1画面ずつ/);
  assert.match(guide, /URLとTokenは、メモ、メール、LINE、スクリーンショット、SNSへ保存・共有しないでください。/);

  const step12 = guide.match(/<section class="guide-card guide-step" id="android-step-12">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const step13 = guide.match(/<section class="guide-card guide-step" id="android-step-13">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const step22 = guide.match(/<section class="guide-card guide-step" id="android-step-22">([\s\S]*?)<\/section>/)?.[1] ?? "";

  assert.match(step12, /「後で設定する」を押します/);
  assert.doesNotMatch(step12, /分からない場合/);
  assert.match(step13, /「スキップして後でやる」を押します/);
  assert.doesNotMatch(step13, /今は設定しない場合/);
  assert.match(step22, /「これは後で行います」を押します/);
  assert.doesNotMatch(step22, /分からなければ|手元になければ/);
});
