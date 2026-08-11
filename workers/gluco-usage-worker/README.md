# GlucoScope Usage Worker – supervised opt-in acceptance

This directory contains a dedicated, dependency-light Cloudflare Worker and D1 schema for minimal device-profile usage counts.

The stopped production foundation was created and verified on 2026-08-11. On 2026-08-12 JST, the dedicated Worker entered a supervised opt-in acceptance: production traffic is on Version `858cf438-b3d2-4a8c-801c-344503e0c58e` with the runtime collection switch enabled, while the checked-in `wrangler.jsonc` remains fail-safe at `USAGE_COLLECTION_ENABLED=false`. The frontend in this release exposes the start control, but opening the page alone creates no profile or usage record. The separate general-user relay remains `RELAY_ENABLED=false`.

## Stopped production checkpoint (2026-08-11)

- D1 database `glucoscope-usage` was created in APAC and migration `0001_initial_usage_schema.sql` was applied.
- `profiles`, `usage_daily`, and `event_receipts` each contained 0 rows, and the `admin_device_usage` view returned 0 rows after setup.
- The Worker was deployed at `https://glucoscope-usage.afterglow21.workers.dev` with current Version ID `3c2c3d19-3744-4d01-8e62-76a0f1bdd5bf`.
- The required Secret binding name `TURNSTILE_SECRET_KEY` is registered. Its value is not recorded in this repository or this runbook.
- Allowed-origin preflight returned `204`; profile creation and event submission returned paused `503` responses; wrong-origin and originless requests returned `403`.
- `workers_dev=true`, `preview_urls=false`, `observability.enabled=false`, and `observability.logs.invocation_logs=false` were verified in the deployed configuration.

This checkpoint verifies a reachable but stopped production shell. It does not authorize collection, frontend connection, or a Friends & Family rollout.

## Supervised opt-in checkpoint (2026-08-12 JST)

- The active Worker Version is `858cf438-b3d2-4a8c-801c-344503e0c58e` at 100% traffic. The reviewed rollback remains stopped Version `3c2c3d19-3744-4d01-8e62-76a0f1bdd5bf`.
- The first enabled smoke check exposed a Siteverify request-format incompatibility before any profile was created. Traffic was returned to the stopped Version, the request was aligned with the proven relay pattern (`URLSearchParams` plus `application/x-www-form-urlencoded`), and the corrected Version was deployed only after 17 Worker tests passed.
- Allowed-origin preflight returns `204`; wrong-origin and originless requests return `403 origin_not_allowed`; a correctly formed request with a dummy invalid Turnstile token returns `403 turnstile_failed`.
- All checked responses use `Cache-Control: no-store` and `Vary: Origin`. Immediately after the checks, the three D1 tables and the administrator view still returned 0 rows.
- The public frontend remains opt-in: no browser profile, identifier, visit, AI count, or memory count is created until the person presses the sharing button and completes Turnstile. The first real-device start, stop, export, and delete acceptance is still pending.

## Boundary

This is a browser-device profile, not a verified person account. It has no login or recovery flow. If the browser loses its profile token, the profile cannot be recovered from that browser.

The Worker may store only:

- a server-generated opaque profile UUID;
- the SHA-256 hash of a server-generated 256-bit bearer token;
- an optional normalized display name of at most 30 Unicode code points;
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

`displayName` is optional. The successful response returns the bearer token exactly once:

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

Either field may be omitted, but at least one is required. Stopping collection prevents new events without deleting the profile. Display-name changes, stopping collection, export, and deletion remain available while the global collection kill switch is off. Re-enabling collection with `collectionEnabled: true` is rejected until the global switch is on again.

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

## Supervised acceptance next step

1. On one user-controlled device, open “Your settings,” start sharing, and complete Turnstile.
2. Confirm only aggregate row counts and allowlisted administrator-view columns; do not print a display name, profile ID, token, or production record.
3. Verify stop, resume, allowlisted export, and deletion, then confirm the live D1 rows are removed.
4. Decide separately whether to return the frontend and Worker to stopped mode or continue a small open beta.
5. Keep the general-user relay decision independent; do not change `RELAY_ENABLED=false` as part of usage-profile rollout.

Secret values, profile tokens, display names, and production database content must never be copied into Git, command arguments, screenshots, logs, fixtures, or support messages.
