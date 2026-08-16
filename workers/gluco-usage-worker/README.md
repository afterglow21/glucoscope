# GlucoScope Usage Worker – lifecycle accepted and enabled for 1–3 person early access

This directory contains a dedicated, dependency-light Cloudflare Worker and D1 schema for minimal device-profile usage counts.

The stopped production foundation was created and verified on 2026-08-11. On 2026-08-12 JST, corrected Version `858cf438-b3d2-4a8c-801c-344503e0c58e` was used for a supervised device check. Profile creation succeeded, but a repeated callback after Turnstile reset produced a false error display after that success. The 2 known test profiles were later deleted, and the cascading deletion left `profiles`, `usage_daily`, and `event_receipts` at `0 / 0 / 0`. After the subsequent fixes, the full Create, reload deduplication and daily record, Stop, Resume, export, and Delete lifecycle passed on iPhone. After separate explicit approval, deployment `4fbf0e2c-5f5c-4f4f-98a9-ae57d73b4824` routed accepted Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` to 100% for a 1–3 person early-access group. Initial D1 counts remained `0 / 0 / 0`; invalid Turnstile and unapproved-origin requests returned `403` with no-store boundaries. The checked-in `USAGE_COLLECTION_ENABLED=false` remains unchanged, and stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` remains the immediate rollback target.

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

## Latest supervised re-acceptance checkpoint (2026-08-12 JST)

- Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` received 100% of production traffic with runtime `USAGE_COLLECTION_ENABLED=true` during the supervised attempt.
- Allowed-origin preflight returned `204`; an allowed-origin profile request with an invalid dummy Turnstile token returned `403 turnstile_failed`; wrong-origin and originless requests returned `403`.
- D1 remained `0 / 0 / 0` after these boundary checks. No real profile was created by the dummy request.
- The real-device connection test succeeded. After `GlucoScopeを始める` and a brief Turnstile display, the data-connection screen returned. D1 still contained `0 / 0 / 0`, confirming that no usage profile or daily record was created.
- After the first attempt, stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` was restored to 100% of production traffic through deployment `06aa2dbe-454b-45b8-859a-d8e5b9741a82`, with runtime `USAGE_COLLECTION_ENABLED=false`.
- The checked-in `wrangler.jsonc` remains `USAGE_COLLECTION_ENABLED=false`. The public frontend still has the supervised-candidate gate enabled at this checkpoint, while the general-user relay remains independently stopped at `RELAY_ENABLED=false`.
- A second iPhone retry temporarily enabled this same Usage Version and relay Version `a398d59e-54c1-4b8d-a9a4-b779af360a54`. The connection test again succeeded, but a brief Turnstile display was followed by the required data-connection screen. D1 remained `0 / 0 / 0`.
- Usage was immediately returned to stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb`, and the relay to stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a`.
- Reproduction identified an unnecessary reload in the already-user-mode save path. When Safari lost or could not access the sessionStorage relay ticket across that reload, initialization had saved config but no active adapter and reopened required setup. This release activates config and adapter in place for user mode while retaining full navigation from the public demo. Local tests and the later supervised device confirmation passed.

## Historical checkpoint: core CGM handoff accepted before Usage lifecycle (2026-08-12 JST)

- After the in-place fix was published, a third supervised iPhone acceptance temporarily used the same Usage and relay candidate Versions.
- Gluroo (Libre) connected, `GlucoScopeを始める` remained on the existing user-mode page, and live glucose was displayed. This accepts the core CGM handoff fix, not the Usage lifecycle.
- D1 remained `profiles / usage_daily / event_receipts = 0 / 0 / 0`, so no usage profile was created at this checkpoint. Create, Stop, Resume, Delete, and the secondary allowlisted-export check had not yet been accepted; the later checkpoint below completes them.
- Deployment `17de293b-2d38-4b07-aa5f-604c2cc65d43` restored Usage stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` at 100%, and deployment `a1962cbf-9f77-48c1-b33a-05bd39323a8c` restored relay stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` at 100%.
- Approved-origin preflight returned `204` and an approved-origin stopped `POST` returned `503` for both Workers. Checked-in flags remain `false`; the public supervised-candidate gate remains `true`, and the general-user relay is paused.

The most likely explanation for D1 staying empty was a stale Safari-local `glucoscope.usageProfile.v1` credential left after the earlier server-side test-profile deletion. The browser treated it as registered, while profile `PATCH` returned exact `401 authentication_required`; the core CGM flow correctly failed open. The local recovery forgets only the exact credential that started that exact 401 request, preserves any newer or different profile and every non-401 failure, sends no usage events after cleanup, and waits for the next explicit save plus fresh Turnstile before creating. The later supervised device re-acceptance confirmed this diagnosis and behavior.

## Usage lifecycle accepted and stopped after the check (2026-08-12 JST)

- Deployment `6dabe28d-19a4-40f6-9c6d-e6f273d18298` routed 100% of Usage traffic to active Version `5d160aed-7b27-48e6-b0a8-783534f97b6f`. The general-user relay remained stopped, and an iPhone using direct Azure Nightscout displayed glucose.
- The first save safely removed the stale Safari credential and left D1 at `0 / 0 / 0`. A second explicit save with a fresh Turnstile created one profile. Reload kept one profile and produced `usage_daily=1` and `event_receipts=2`, accepting stale-credential recovery, creation, deduplication, and daily recording.
- Stop produced 0 recording and 1 stopped profile; Resume returned to 1 recording and 0 stopped. The allowlisted JSON export downloaded successfully.
- Delete cascaded the test profile and related records, returning `profiles / usage_daily / event_receipts` to `0 / 0 / 0`. No display name, profile identifier, token, glucose value, or connection detail is recorded here.
- Deployment `20216b73-27a9-41e0-a3be-25595babe185` restored stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` at 100%. At that checkpoint the stopped response was `503` with `Cache-Control: no-store` and `Vary: Origin`, and the general-user relay was also stopped.
- This release shows an explicit success message after deletion and moves export into a less prominent `More options` path. The separate general-user G7 relay path has also completed its recorded device acceptance.

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
https://glucoscope.app
```

Originless and other-origin requests are rejected. JSON bodies are limited to 8 KiB. All responses use `Cache-Control: no-store`, `Pragma: no-cache`, and `Vary: Origin`.

### Create a device profile

`POST /v1/profiles` requires a valid Turnstile token for action `glucoscope-usage-profile` and hostname `glucoscope.app`.

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

## Staged per-user AI quota RPC (checked in disabled)

Migration `0002_ai_quota.sql` and the named `AiQuotaService` entrypoint prepare the
server-authoritative AI limit. They do not add a public HTTP route and do not change any
existing profile or event response. The checked-in switch is deliberately
`AI_PER_USER_QUOTA_ENABLED=false`; applying the migration or deploying this code alone
must not turn enforcement on.

The fixed policy is:

- a free subject may complete 1 newly generated AI analysis per JST day;
- an account with an active Plus entitlement may complete 5 per JST day;
- cached results do not reserve or consume quota;
- provider errors, document/quality-check failures, incomplete output, aborted requests,
  and internal failures release the reservation and do not consume quota;
- a successful completion consumes quota exactly once, including when completion is
  retried;
- active, unexpired reservations count against capacity, so concurrent requests cannot
  exceed the limit;
- an abandoned reservation expires after 600 seconds and stops blocking capacity.

The internal RPC contract is:

- `reserveAiGeneration({ credential, requestId, analysisMode })` runs immediately before
  contacting the AI provider;
- `completeAiGeneration({ reservationId })` runs only after the final response has passed
  all required checks and is safe to show;
- `releaseAiGeneration({ reservationId, reasonCode })` runs for every non-success exit;
- `getAggregateAiUsage()` returns only aggregate successful-use counts for the
  administrator dashboard.

`requestId` and `reservationId` are UUIDs. `analysisMode` is `letter` or `deep`.
`credential` contains only `{ kind, token }`; extra fields are rejected. In particular,
the caller cannot submit `tier`, a daily limit, an entitlement date, or a success count.

The existing device-profile bearer token is accepted only as a temporary free subject.
A device profile is not a verified person account and can never grant Plus. Its quota
rows keep a foreign-key link to the existing profile solely so `DELETE /v1/me` also
deletes those rows. The raw profile token is not stored in the quota tables.

Account credentials require a separate trusted `PLUS_ENTITLEMENT` service binding. The
stub calls `resolveAiSubject(sessionToken)` and accepts only `status`, an opaque
`subjectId`, and `plusActive === true`; it ignores any client claim and any returned
daily-limit value. Until that binding is configured and enabled, account resolution
fails closed as temporarily unavailable. Session tokens and raw account identifiers are
not stored in quota tables; the subject key is a domain-separated SHA-256 digest.
The checked-in binding targets `glucoscope-plus-entitlement#PlusEntitlementRpc`; deploy
and validate that disabled target before deploying this configuration. A configured
binding is not permission to enable either quota switch.

The two D1 tables retain only the derived subject key, subject kind, JST day, mode,
free/Plus status at reservation time, bounded counters, UUID idempotency keys, state,
and lifecycle timestamps. They do not contain glucose data, AI text, email, payment
identifiers, connection details, or session tokens. The scheduled cleanup keeps quota
days and attempts for at most 90 days.

`PublicUsageAggregateEntrypoint.getPublicUsageAggregate()` is also service-binding only.
It preserves the public aggregate's minimum-contributor suppression and does not accept
an option that can lower that privacy threshold.
Its AI total deliberately remains consented device-profile telemetry from
`usage_daily.ai_generation_success_count`. It never reads `ai_quota_days`, whose account
subjects can have a different consent and contributor cohort. Authoritative quota totals
remain protected behind `AiQuotaService.getAggregateAiUsage()` for operational/admin use.

Before enforcement can be enabled, release in this order:

1. Apply `0002_ai_quota.sql` without changing either quota switch.
2. Deploy and validate the Plus entitlement named entrypoint, initially disabled.
3. Deploy this Usage Worker with `PLUS_ENTITLEMENT` bound and quota still off.
4. Deploy the AI-generation Worker with `AiQuotaService` bound and its quota flag off.
5. Publish Pages with its quota flag off; it must send no `Authorization` header.
6. Test Free, Plus, stopped optional analytics, deleted profile, duplicate, concurrent,
   expired, provider-error, quality-failure, abort, completion-failure, and cached cases.
7. Only after the dedicated quota notice/Privacy update and server-verified public-demo
   identity are accepted, enable Usage first, the AI Worker second, and Pages last.

The legacy `POST /v1/events` `ai_generation_success` counter remains unchanged for
backward-compatible telemetry. It is not an authorization source and must not be used to
decide whether an AI request is allowed.
A successful authoritative completion may still send that event once as best-effort
analytics when optional collection is on; it changes only `usage_daily`, never quota.
Stopping collection sends no analytics event but does not revoke the Free quota
credential. Deleting the profile invalidates the credential and cascades its quota rows.

## Retention and cleanup

The scheduled handler runs daily and applies these maximum application-level periods:

- daily counts: 90 days;
- event receipts: 7 days;
- inactive device profiles: 90 days.
- AI quota attempts and daily counters: 90 days; deleting a device profile cascades its
  quota rows immediately.

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

## Current early-access operations

1. Keep Usage limited to the approved 1–3 person group through deployment `4fbf0e2c-5f5c-4f4f-98a9-ae57d73b4824`; do not describe it as a broad public rollout.
2. Monitor only the reviewed allowlisted counts and lifecycle state. Do not copy display names, profile tokens, or production rows into operational notes.
3. If a privacy, safety, traffic, or provider-condition concern appears, route 100% back to stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb`. Usage and the general-user relay remain independently stoppable.

Secret values, profile tokens, display names, and production database content must never be copied into Git, command arguments, screenshots, logs, fixtures, or support messages.
