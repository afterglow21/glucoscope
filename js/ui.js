"use strict";

// Keep this legacy entry point safe until shared UI helpers are added here.
if (typeof globalThis.updateGlucoScore === "function") {
  globalThis.updateGlucoScore();
}
