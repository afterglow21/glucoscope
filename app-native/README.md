# GlucoScope iOS feasibility build

This folder wraps the existing static GlucoScope interface with Capacitor for an
early iPhone-only feasibility check.

## What this spike proves

- GitHub Actions can create an unsigned iOS Simulator build without a local Mac.
- The data-source adapter uses Capacitor's native HTTP bridge explicitly for
  device-direct requests, with redirects disabled.
- Gluroo connection information and glucose data do not pass through the
  GlucoScope Cloudflare relay in this build.
- Cloudflare Web Analytics is omitted from the app bundle.

## Safety boundaries

- This is not an App Store or TestFlight build.
- No signing certificate, Apple key, provider secret, or user credential belongs
  in this repository or in the workflow.
- Connection information is session-only until iOS Keychain-backed storage is
  implemented and reviewed.
- Capacitor's global `fetch` patch stays disabled so unrelated requests are not
  silently rerouted through the native bridge.
- A successful technical connection does not imply Gluroo authorization for a
  distributed app. Provider approval remains a separate release requirement.

## Local preparation

From this directory, run `npm ci` and then `npm run build:web`. The generated
`www/` and `ios/` folders are intentionally ignored because CI recreates them.
