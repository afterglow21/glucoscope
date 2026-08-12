# GlucoScope Usage Worker – supervised re-acceptance active

This directory contains a dedicated, dependency-light Cloudflare Worker and D1 schema for minimal device-profile usage counts.

The stopped production foundation was created and verified on 2026-08-11. On 2026-08-12 JST, corrected Version `858cf438-b3d2-4a8c-801c-344503e0c58e` was used for a supervised device check. Profile creation succeeded, but a repeated callback after Turnstile reset produced a false error display after that success. The 2 known test profiles were later deleted, and the cascading deletion left `profiles`, `usage_daily`, and `event_receipts` at `0 / 0 / 0`. Clean stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb`, deployed as `25be2258-b72a-4e2c-8bf1-ab47781c48dc`, remains the rollback target. Active Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` now receives 100% of traffic with runtime `USAGE_COLLECTION_ENABLED=true` for supervised re-acceptance. The frontend enrollment gate is enabled in the same release candidate, while the checked-in configuration remains fail-safe at `false` and the separate general-user relay remains `RELAY_ENABLED=false`.

## Stopped production checkpoint (2026-08-11)

- D1 database `glucoscope-usage` was created in APAC and migration `0001_initial_usage_schema.sql` was applied.
- `profiles`, `usage_daily`, and `event_receipts` each contained 0 rows, and the `admin_device_usage` view returned 0 rows after setup.
- The Worker was deployed at `https://glucoscope-usage.afterglow21.workers.dev` with Version ID `3c2c3d19-3744-4d01-8e62-76a0f1bdd5bf` at that checkpoint.
- The required Secret binding name `TURNSTILE_SECRET_KEY` is registered. Its value is not recorded in this repository or this runbook.
- Allowed-origin preflight returned `204`; profile creation and event submission returned paused `503` responses; wrong-origin and originless requests returned `403`.
- `workers_dev=true`, `preview_urls=false`, `observability.enabled=false`, and `observability.logs.invocation_logs=false` were verified in the deployed configuration.

This checkpoint verifies a reachable but stopped production shell. It does not authorize collection, frontend connection, or a Friends & Family rollout.

## Supervised opt-in checkpoint (2026-08-12 JST)

- Corrected Version `858cf438-b3d2-4a8c-801c-344503e0c58e` received 100% traffic for the supervised check. Traffic then returned to stopped Version `3c2c3d19-3744-4d01-8e62-76a0f1bdd5bf` before the later clean stopped deployment below.
- The first enabled smoke check exposed a Siteverify request-format incompatibility before any profile was created. Traffic was returned to the stopped Version, the request was aligned with the proven relay pattern (`URLSearchParams` plus `application/x-www-form-urlencoded`), and the corrected Version was deployed only after 17 Worker tests passed.
- Allowed-origin preflight returns `204`; wrong-origin and originless requests return `403 origin_not_allowed`; a correctly formed request with a dummy invalid Turnstile token returns `403 turnstile_failed`.
- All checked responses use `Cache-Control: no-store` and `Vary: Origin`. Immediately after the checks, the three D1 tables and the administrator view still returned 0 rows.
- On a real device, the initial profile creation and daily record succeeded. Turnstile reset then caused a repeated callback and a false error display even though the first write had completed.
- At this checkpoint, D1 contained 2 test profiles and 2 daily records from supervised checking. No display name, profile ID, token, or record contents are recorded here.
- At that checkpoint, the local frontend integrated a required, non-real-name display name and profile creation into `GlucoScopeを始める`; public-demo viewing remained name-free. It removed the large standalone sharing panel, kept stop/resume/delete in a compact management path, and made export a small secondary link. Worker collection and frontend enrollment then remained stopped pending supervised re-acceptance.

## Clean stopped production checkpoint (2026-08-12 JST)

- The 2 known test profiles were deleted. Cascading deletion removed their related rows, after which `profiles`, `usage_daily`, and `event_receipts` returned `0 / 0 / 0`.
- New stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` receives 100% of production traffic through deployment `25be2258-b72a-4e2c-8bf1-ab47781c48dc`.
- Runtime `USAGE_COLLECTION_ENABLED=false` was verified. Allowed-origin preflight returned `204`; allowed-origin profile `POST` returned `503 usage_collection_paused`; wrong-origin and originless requests returned `403`.
- D1 was rechecked after deployment and remained `0 / 0 / 0` for `profiles`, `usage_daily`, and `event_receipts`.
- The general-user relay remains independently stopped at `RELAY_ENABLED=false`.

## Current supervised re-acceptance (2026-08-12 JST)

- Active Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` receives 100% of production traffic with runtime `USAGE_COLLECTION_ENABLED=true`.
- Allowed-origin preflight returned `204`; an allowed-origin profile request with an invalid dummy Turnstile token returned `403 turnstile_failed`; wrong-origin and originless requests returned `403`.
- D1 remained `0 / 0 / 0` after these boundary checks. No real profile was created by the dummy request.
- The frontend gate is enabled only for supervised re-acceptance. Public-demo viewing remains name-free; a required, non-real-name display name is requested only when a person starts a new own-data connection.
- Checked-in `wrangler.jsonc` remains `USAGE_COLLECTION_ENABLED=false`. Clean stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` remains the rollback target, and the general-user relay remains independently stopped at `RELAY_ENABLED=false`.

## Boundary

This is a browser-device profile, not a verified person account. It has no login or recovery flow. If the browser loses its profile token, the profile cannot be recovered from that browser.

The Worker may store only:

- a server-generated opaque profile UUID;
- the SHA-256 hash of a server-generated 256-bit bearer token;
- a normalized display name of at most 30 Unicode code points, required when a profile is created;
- whether collection is enabled for that profile;
- notice version and profile lifecycle timestamps;
- one daily visit marker;
- successful new AI-generation count, capped at 30 per profile per day;
- the maximum ordinary Gluco-memory count snapshot, from 0 through 50;
- short-lived event receipts used only for idempotency.

The JSON usage payload must not contain glucose values, reading times, TIR/TAR/TBR, CGM type, AI text, analysis period, Nightscout or Gluroo connection details, treatment information, IP address, raw User-Agent, referrer, query strings, or arbitrary event metadata. The Worker must not read, application-log, or D1-store IP addresses, raw User-Agent, or referrer. Cloudflare may process transport and security metadata under its own policies. Display names, profile tokens, token hashes, request bodies, and profile IDs must never be written to application logs.

## API contract

Every request, including preflight, must carry the exact origin:

```text
https://afterglow21.github.io
```

Originless and other-origin requests are rejected. JSON bodies are limited to 8 KiB. All responses use `Cache-Control: no-store`, `Pragma: no-cache`, and `Vary: Origin`.

### Create a device profile

`POST /v1/profiles` requires a valid Turnstile token for action `glucoscope-usage-profile` and hostname `afterglow21.github.io`.

```json
{
  "displayName": "グルコさん",
  "turnstileToken": "browser-turnstile-token"
}
```

`displayName` is required and must remain non-empty after normalization. The successful response returns the bearer token exactly once:

```json
{
  "ok": true,
  "profile": {
    "id": "server-generated-uuid",
    "displayName": "グルコさん",
    "collectionEnabled": true
  },
  "profileToken": "server-generated-256-bit-token"
}
```

The raw `profileToken` is never stored in D1. Later device requests send it as `Authorization: Bearer <profileToken>`.

### Update display name or stop collection

`PATCH /v1/me`

```json
{
  "displayName": "新しい表示名",
  "collectionEnabled": false
}
```

Either field may be omitted, but at least one is required. On PATCH, omitting `displayName` leaves it unchanged, while an empty value clears the saved display name. Stopping collection prevents new events without deleting the profile. Display-name changes, stopping collection, export, and deletion remain available while the global collection kill switch is off. Re-enabling collection with `collectionEnabled: true` is rejected until the global switch is on again.

### Record minimal events

`POST /v1/events`

```json
{
  "events": [
    {
      "type": "visit_day",
      "eventId": "00000000-0000-4000-8000-000000000001"
    },
    {
      "type": "ai_generation_success",
      "eventId": "00000000-0000-4000-8000-000000000002"
    },
    {
      "type": "ordinary_gluco_memory_count",
      "eventId": "00000000-0000-4000-8000-000000000003",
      "count": 12
    }
  ]
}
```

The top-level object may contain only `events`; each event uses the exact field allowlist above. A request contains 1 through 20 events. The server assigns the Japanese calendar day; clients do not send timestamps.

```json
{
  "ok": true,
  "results": [
    {
      "eventId": "00000000-0000-4000-8000-000000000001",
      "type": "visit_day",
      "status": "accepted"
    }
  ]
}
```

Possible result statuses are `accepted`, `duplicate`, and `daily_limit`. A `visit_day` is stored as at most one marker per profile and day. Only newly generated successful AI results count; cached displays and failures must not be sent. Ordinary memory count is a maximum snapshot, not an additive event.

### Export and delete

- `GET /v1/me/export` returns one allowlisted profile record and up to 90 days of daily counts.
- `DELETE /v1/me` deletes the profile, daily counts, and event receipts from the live D1 database.

D1 Time Travel is always on and may retain recoverable pre-deletion history for up to 7 days on the Workers Free plan or up to 30 days on a Workers Paid plan. The public privacy wording states both plan-dependent periods. A Time Travel restore is never a routine user-data recovery path: pause collection first, then ensure previously deleted records stay out of normal operation before resuming.

## Retention and cleanup

The scheduled handler runs daily and applies these maximum application-level periods:

- daily counts: 90 days;
- event receipts: 7 days;
- inactive device profiles: 90 days.

Migration `0001_initial_usage_schema.sql` also creates the D1-only `admin_device_usage` view. It provides profile ID, display name, collection state, created/last-seen timestamps, active days, total successful AI generations, and current ordinary memory count. There is no HTTP admin API in this phase. The view is for the authenticated Cloudflare D1 console only; an authenticated administrator dashboard remains a separate phase.

## Local verification

Node verification does not contact Cloudflare:

```powershell
npm run verify
```

Wrangler local and dry-run checks may use:

```powershell
npm run types
npm run types:check
npm run dev
npm run deploy:dry
```

There is intentionally no real `deploy` npm script.

## Current supervised acceptance steps

1. Keep the repeated-callback guard and simplified data-connection-integrated flow active only for supervised re-acceptance. Keep Gluroo relay confirmation as a separate boundary.
2. Starting from the clean `0 / 0 / 0` D1 baseline, recheck profile creation without a false callback error, then stop, resume, deletion, and the secondary allowlisted-export link on one user-controlled device.
3. Only after those checks, decide separately whether to resume a small rollout. Keep the general-user relay independent at `RELAY_ENABLED=false`.

Secret values, profile tokens, display names, and production database content must never be copied into Git, command arguments, screenshots, logs, fixtures, or support messages.
