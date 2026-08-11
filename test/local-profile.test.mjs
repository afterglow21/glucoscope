import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/local-profile.js", import.meta.url), "utf8");

function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  const calls = { get: 0, set: 0, remove: 0 };

  return {
    calls,
    getItem(key) {
      calls.get += 1;
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.set += 1;
      values.set(key, String(value));
    },
    removeItem(key) {
      calls.remove += 1;
      values.delete(key);
    }
  };
}

function loadModule({ storage = createStorage(), rootOverrides = {} } = {}) {
  const context = {
    localStorage: storage,
    ...rootOverrides
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "local-profile.js" });
  return { context, storage, api: context.GlucoScopeLocalProfile };
}

test("loading the module and reading an empty profile never writes", () => {
  const { api, storage } = loadModule();

  assert.equal(storage.calls.get, 0);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);

  const result = api.read();
  assert.equal(result.ok, true);
  assert.equal(result.stored, false);
  assert.deepEqual(Object.keys(result.profile), ["schemaVersion", "displayName"]);
  assert.equal(result.profile.schemaVersion, 1);
  assert.equal(result.profile.displayName, "");
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
});

test("save persists only schemaVersion and displayName", () => {
  const { api, storage } = loadModule();
  const result = api.save({
    schemaVersion: 999,
    displayName: "  カズマ   🍀  ",
    futureUsageSharingPreference: "willing",
    usageAnalyticsPreference: "enabled",
    analyticsConsent: true,
    userId: "must-not-be-saved",
    visitorId: "must-not-be-saved",
    glucose: 123,
    cgmType: "Libre 2",
    connectionUrl: "https://secret.example",
    apiSecret: "must-not-be-saved",
    aiLetterText: "must-not-be-saved",
    savedAt: "must-not-be-saved"
  });

  assert.equal(result.ok, true);
  assert.equal(result.stored, true);
  assert.deepEqual(Object.keys(result.profile), ["schemaVersion", "displayName"]);
  assert.equal(result.profile.displayName, "カズマ 🍀");
  const persisted = JSON.parse(storage.getItem(api.STORAGE_KEY));
  assert.deepEqual(Object.keys(persisted), ["schemaVersion", "displayName"]);
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.displayName, "カズマ 🍀");
  for (const forbiddenField of [
    "futureUsageSharingPreference",
    "usageAnalyticsPreference",
    "analyticsConsent",
    "userId",
    "visitorId",
    "glucose",
    "cgmType",
    "connectionUrl",
    "apiSecret",
    "aiLetterText",
    "savedAt"
  ]) {
    assert.equal(forbiddenField in result.profile, false, forbiddenField);
    assert.equal(forbiddenField in persisted, false, forbiddenField);
  }
});

test("display names remove controls and bidi controls while preserving Japanese and emoji", () => {
  const { api } = loadModule();
  const normalized = api.normalizeDisplayName(
    " \t 山田\n太郎 \u202e🍀\u2066 👨‍👩‍👧‍👦 \u0000 "
  );

  assert.equal(normalized, "山田 太郎 🍀 👨‍👩‍👧‍👦");
  assert.doesNotMatch(normalized, /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
});

test("display names are limited to 30 Unicode code points", () => {
  const { api } = loadModule();
  const original = `${"あ".repeat(28)}🍀🌿tail`;
  const normalized = api.normalizeDisplayName(original);

  assert.equal(Array.from(normalized).length, 30);
  assert.equal(normalized, `${"あ".repeat(28)}🍀🌿`);
});

test("saving a blank display name removes only the local profile key", () => {
  const key = "glucoscope.localProfile.v1";
  const storage = createStorage({
    [key]: JSON.stringify({ schemaVersion: 1, displayName: "old name" }),
    "glucoscope.other": "keep"
  });
  const { api } = loadModule({ storage });
  const result = api.save({
    displayName: " \t\n ",
    analyticsConsent: true,
    userId: "must-not-be-saved"
  });

  assert.equal(result.ok, true);
  assert.equal(result.stored, false);
  assert.deepEqual(Object.keys(result.profile), ["schemaVersion", "displayName"]);
  assert.equal(result.profile.displayName, "");
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem("glucoscope.other"), "keep");
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 1);
});

test("read accepts schema version 1 and drops legacy, unknown, and sensitive fields without rewriting", () => {
  const key = "glucoscope.localProfile.v1";
  const storage = createStorage({
    [key]: JSON.stringify({
      schemaVersion: 1,
      displayName: "  ミドリ   🌿 ",
      futureUsageSharingPreference: "willing",
      usageAnalyticsPreference: "enabled",
      analyticsConsent: true,
      trackingId: "ignored",
      glucose: 145,
      apiSecret: "ignored",
      aiLetterText: "ignored",
      savedAt: "ignored"
    })
  });
  const { api } = loadModule({ storage });
  const result = api.read();

  assert.equal(result.ok, true);
  assert.equal(result.stored, true);
  assert.deepEqual(Object.keys(result.profile), ["schemaVersion", "displayName"]);
  assert.equal(result.profile.displayName, "ミドリ 🌿");
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
});

test("a legacy preference-only draft is treated as no saved display name", () => {
  const key = "glucoscope.localProfile.v1";
  const storage = createStorage({
    [key]: JSON.stringify({
      schemaVersion: 1,
      displayName: "",
      futureUsageSharingPreference: "willing"
    })
  });
  const { api } = loadModule({ storage });
  const result = api.read();

  assert.equal(result.ok, true);
  assert.equal(result.stored, false);
  assert.deepEqual(Object.keys(result.profile), ["schemaVersion", "displayName"]);
  assert.equal(result.profile.displayName, "");
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
});

test("malformed or incompatible stored data returns a closed default without mutation", () => {
  const key = "glucoscope.localProfile.v1";

  for (const raw of ["{broken", JSON.stringify({ schemaVersion: 2 })]) {
    const storage = createStorage({ [key]: raw });
    const { api } = loadModule({ storage });
    const result = api.read();

    assert.equal(result.ok, false);
    assert.equal(result.stored, false);
    assert.equal(result.error, "invalid_profile");
    assert.deepEqual(Object.keys(result.profile), ["schemaVersion", "displayName"]);
    assert.equal(result.profile.displayName, "");
    assert.equal(storage.calls.set, 0);
    assert.equal(storage.calls.remove, 0);
  }
});

test("read, save, and clear report storage failures without throwing", () => {
  const unavailable = loadModule({ storage: null }).api;
  assert.equal(unavailable.read().error, "storage_unavailable");
  assert.equal(unavailable.save({ displayName: "A" }).error, "storage_unavailable");
  assert.equal(unavailable.clear().error, "storage_unavailable");

  const failingStorage = {
    getItem() {
      throw new Error("read blocked");
    },
    setItem() {
      throw new Error("write blocked");
    },
    removeItem() {
      throw new Error("delete blocked");
    }
  };
  const failing = loadModule({ storage: failingStorage }).api;
  assert.equal(failing.read().error, "read_failed");
  assert.equal(failing.save({ displayName: "A" }).error, "save_failed");
  assert.equal(failing.clear().error, "clear_failed");
});

test("clear removes only the local profile key", () => {
  const key = "glucoscope.localProfile.v1";
  const storage = createStorage({
    [key]: JSON.stringify({ schemaVersion: 1 }),
    "glucoscope.other": "keep"
  });
  const { api } = loadModule({ storage });

  const result = api.clear();
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem("glucoscope.other"), "keep");
});

test("the module contains no network, identifier, logging, or timestamp APIs", () => {
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/u);
  assert.doesNotMatch(source, /\b(?:navigator|document|Image)\b/u);
  assert.doesNotMatch(source, /\b(?:crypto|randomUUID|Math\.random|getRandomValues)\b/u);
  assert.doesNotMatch(source, /\b(?:visitorSeed|userId|visitorId|deviceId|sessionId|trackingId)\b/u);
  assert.doesNotMatch(source, /\b(?:console|Date|performance|Temporal)\b/u);
  assert.doesNotMatch(source, /futureUsage|UsageSharing|willing|unwilling|undecided|consent/iu);
});
