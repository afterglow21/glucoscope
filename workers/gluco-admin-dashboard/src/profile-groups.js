import { normalizeDisplayName } from "./admin-store.js";

const MAX_INTERNAL_DISPLAY_NAMES = 10;
const MAX_INTERNAL_DISPLAY_NAMES_JSON_LENGTH = 1024;

function invalidConfiguration() {
  throw new TypeError("internal profile display-name configuration is invalid");
}

export function readInternalProfileDisplayNames(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_INTERNAL_DISPLAY_NAMES_JSON_LENGTH
  ) {
    return invalidConfiguration();
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidConfiguration();
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > MAX_INTERNAL_DISPLAY_NAMES
  ) {
    return invalidConfiguration();
  }

  const names = [];
  const seen = new Set();
  for (const valueName of parsed) {
    if (typeof valueName !== "string") return invalidConfiguration();
    const name = normalizeDisplayName(valueName);
    if (name === "（表示名なし）" || seen.has(name)) return invalidConfiguration();
    seen.add(name);
    names.push(name);
  }
  return Object.freeze(names);
}

function freezeGroup(displayName, internal, profiles) {
  return Object.freeze({
    displayName,
    internal,
    profiles: Object.freeze(profiles),
  });
}

export function groupProfilesByDisplayName(profiles, internalDisplayNames) {
  const internalNames = new Set(internalDisplayNames);
  const groupsByName = new Map();
  for (const profile of profiles) {
    const displayName = normalizeDisplayName(profile?.displayName);
    let group = groupsByName.get(displayName);
    if (!group) {
      group = { displayName, internal: internalNames.has(displayName), profiles: [] };
      groupsByName.set(displayName, group);
    }
    group.profiles.push(profile);
  }

  const externalGroups = [];
  const internalGroups = [];
  for (const group of groupsByName.values()) {
    const frozenGroup = freezeGroup(group.displayName, group.internal, group.profiles);
    (group.internal ? internalGroups : externalGroups).push(frozenGroup);
  }
  return Object.freeze({
    externalGroups: Object.freeze(externalGroups),
    internalGroups: Object.freeze(internalGroups),
  });
}

export const profileGroupsTesting = Object.freeze({
  MAX_INTERNAL_DISPLAY_NAMES,
  MAX_INTERNAL_DISPLAY_NAMES_JSON_LENGTH,
});
