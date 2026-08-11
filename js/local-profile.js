(function initializeGlucoScopeLocalProfile(root) {
  "use strict";

  const STORAGE_KEY = "glucoscope.localProfile.v1";
  const SCHEMA_VERSION = 1;
  const MAX_DISPLAY_NAME_CODE_POINTS = 30;
  const CONTROL_AND_BIDI_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

  function createDefaultProfile() {
    return {
      schemaVersion: SCHEMA_VERSION,
      displayName: ""
    };
  }

  function normalizeDisplayName(value) {
    let text;
    try {
      text = String(value ?? "");
    } catch (error) {
      return "";
    }

    const normalized = text
      .replace(/\s+/gu, " ")
      .replace(CONTROL_AND_BIDI_CONTROL_PATTERN, "")
      .trim();

    return Array.from(normalized)
      .slice(0, MAX_DISPLAY_NAME_CODE_POINTS)
      .join("")
      .trim();
  }

  function normalizeProfile(input = {}) {
    let displayName = "";

    try {
      if (input && typeof input === "object") {
        displayName = normalizeDisplayName(input.displayName);
      }
    } catch (error) {
      return createDefaultProfile();
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      displayName
    };
  }

  function getLocalStorage() {
    try {
      const storage = root?.localStorage;
      if (!storage
        || typeof storage.getItem !== "function"
        || typeof storage.setItem !== "function"
        || typeof storage.removeItem !== "function") {
        return null;
      }
      return storage;
    } catch (error) {
      return null;
    }
  }

  function read() {
    const fallback = createDefaultProfile();
    const storage = getLocalStorage();
    if (!storage) {
      return {
        ok: false,
        stored: false,
        profile: fallback,
        error: "storage_unavailable"
      };
    }

    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        ok: false,
        stored: false,
        profile: fallback,
        error: "read_failed"
      };
    }

    if (raw === null) {
      return { ok: true, stored: false, profile: fallback, error: null };
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== SCHEMA_VERSION) {
        return {
          ok: false,
          stored: false,
          profile: fallback,
          error: "invalid_profile"
        };
      }

      const profile = normalizeProfile(parsed);
      return {
        ok: true,
        stored: Boolean(profile.displayName),
        profile,
        error: null
      };
    } catch (error) {
      return {
        ok: false,
        stored: false,
        profile: fallback,
        error: "invalid_profile"
      };
    }
  }

  function save(input = {}) {
    const profile = normalizeProfile(input);
    const storage = getLocalStorage();
    if (!storage) {
      return { ok: false, stored: false, profile, error: "storage_unavailable" };
    }

    try {
      if (!profile.displayName) {
        storage.removeItem(STORAGE_KEY);
        return { ok: true, stored: false, profile, error: null };
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(profile));
      return { ok: true, stored: true, profile, error: null };
    } catch (error) {
      return { ok: false, stored: false, profile, error: "save_failed" };
    }
  }

  function clear() {
    const storage = getLocalStorage();
    if (!storage) {
      return { ok: false, error: "storage_unavailable" };
    }

    try {
      storage.removeItem(STORAGE_KEY);
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: "clear_failed" };
    }
  }

  root.GlucoScopeLocalProfile = Object.freeze({
    STORAGE_KEY,
    SCHEMA_VERSION,
    MAX_DISPLAY_NAME_CODE_POINTS,
    read,
    save,
    clear,
    normalizeDisplayName,
    _testing: Object.freeze({
      normalizeProfile
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
