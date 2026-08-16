# GlucoScope Limited Data Relay — live long-lived device session and rollback boundary

This directory contains the Gluroo-only relay, including its security, access-control, request-limit, and rollback boundaries.

## Current long-lived device-session release

On 2026-08-16, the 1–3 person early-access path replaced the one-hour browser ticket with an opaque device session. The browser Origin is `https://glucoscope.app`, the only relay target is the HTTPS custom domain `https://relay.glucoscope.app`, and the old public `workers.dev` target is disabled. The matching frontend is published from commit `64a92932a592dda1b6eb9d6dd7700279b1c7a47a` with GitHub Pages HTTPS enforcement enabled.

- `POST /v1/device-session` verifies Turnstile and confirms that the proposed Gluroo connection returns at least one valid glucose entry before it creates the new session, replaces any existing session, and sets the 256-bit opaque `__Host-glucoscope_relay_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`;
- `POST /v1/device-session/status` verifies and rolls the idle lifetime forward without exposing the token to JavaScript;
- session creation binds the new session to an HMAC fingerprint of the verified canonical Gluroo URL and credential; `POST /v1/entries` requires the same fingerprint on every later request;
- `DELETE /v1/device-session` deletes the server record and clears the cookie;
- one SQLite Durable Object is sharded per anonymous device session, and its alarm removes idle records;
- the device counter is atomic, resets on the UTC day boundary, and is checked before the Worker-wide counter.

The released implementation has no legacy `/v1/session` endpoint, signed-ticket acceptance path, `relayTicket` request field, or `RELAY_TICKET_SECRET` requirement. A failed replacement leaves the existing working session intact. Rollback must use a reviewed stopped Version of this same device-session code; the historical ticket Version is not a compatible rollback target.

The device-session object stores only an HMAC-derived token ID, creation and last-seen timestamps, idle expiry, revocation state, an HMAC source/credential fingerprint, and a UTC day bucket/count. It does not store the raw cookie token, raw Gluroo URL, credential, glucose data, IP address, User-Agent, display name, or email address. The relay identity and source fingerprint are not joined to the optional Usage profile or Plus identity. The idle lifetime is 180 days of inactivity and rolls forward on successful use without promising permanent access. The device limit is 3,000 relay requests per UTC day. The checked-in configuration keeps both activation flags `false` as a fail-closed baseline; the accepted production Version used reviewed runtime overrides.

Connection deletion removes the locally saved URL and credential first, then attempts server revocation and cookie removal. Local deletion never waits for or depends on the network. If revocation cannot reach the Worker, the server has no raw URL, credential, or glucose payload. The session becomes invalid at its existing idle expiry and the alarm removes the record afterward; an exact physical-deletion time is not promised.

The existing early-access browser connection completed one safety check after the coordinated migration. On the tested iPhone, Dexcom G7 remained connected when GlucoScope was opened again from the Home Screen icon. The beginner path still adds GlucoScope to the Home Screen first and completes the initial connection inside the icon because WebKit can copy cookies into the Home Screen app but does not copy local storage. See [WebKit's Home Screen web app storage note](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

## Device-session production acceptance — 2026-08-16

- Relay Version 21 (`91a36e38-1fa4-4fe2-80cf-a74327ccef90`) received 100% of traffic for the supervised G7 acceptance.
- Version 20 (`7e356782-976a-4e46-9692-70ea1689462a`) was the reviewed stopped rollback at that checkpoint. Ticket-era Versions are evidence only and must never be used as direct rollback targets for the new frontend.
- Approved-origin credentialed preflight passed, missing-session status failed closed, an invalid creation request was rejected, the legacy `/v1/session` route returned `404`, an unapproved Origin returned `403`, and the old `workers.dev` public target returned `404`.
- The person completed the one-time safety check, reopened GlucoScope from the iPhone Home Screen icon, and reached the G7 display again without reconnecting.
- No connection URL, credential, cookie value, Turnstile token, or glucose value was printed, logged, committed, or included in this acceptance record.
- After obsolete Secret cleanup, current live Version 22 is `b4b2064d-6dd4-4de6-8a68-3d0d39aea2ec` at 100%, and unserved stopped rollback Version 23 is `10d0a825-c098-462e-89fd-a69937c47a9b` with both activation flags `false`. Both retain the same two Durable Object bindings, custom domain, and exact Origin, and contain only the required `RELAY_DEVICE_SESSION_SECRET` and `TURNSTILE_SECRET_KEY` Secret bindings. Versions 20 and earlier must never be used as direct rollback targets.

## Historical one-hour ticket deployment record

Phase 3A connected the user onboarding flow to the relay client while keeping the endpoint blank. Phase 3B created the stopped Cloudflare Worker shell and Durable Object, registered the required Worker Secrets, and verified the stopped production response. At that historical checkpoint, the frontend pointed only to the approved target and required explicit consent. Guardian, FreeStyle Libre 2, and Dexcom G7 device acceptances passed. After separate explicit approval on 2026-08-12, deployment `5f8d00d9-9d68-4b2a-99cd-c58c26123684` routed accepted Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` to 100% for a 1–3 person early-access group. This was not a broad public rollout. The old deployment's stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` remains its rollback evidence; the checked-in candidate boundary is the section above.

## Historical ticket implementation through Phase 3B

- `POST /v1/session` verifies a Cloudflare Turnstile token server-side;
- the Siteverify request follows Cloudflare's Worker pattern: form-encoded POST, a 10-second timeout, and no redirect or cache override;
- failed server-side Turnstile checks return only an allowlisted opaque six-digit confirmation code; no token, Secret, hostname, or provider detail is logged or returned;
- successful verification issues a signed, origin-bound, one-hour relay ticket;
- `POST /v1/entries` requires a valid relay ticket;
- a SQLite-backed Durable Object stores daily counters only;
- per-session and Worker-wide request limits fail closed;
- the checked-in kill switch remains `RELAY_ENABLED=false`;
- Workers Logs remain disabled.

The Durable Object stores only a UTC day bucket and a request count. It does not store Gluroo URLs, credentials, glucose values, entry timestamps, response bodies, IP addresses, or AI content.

## Required Secret bindings

The following names are required Cloudflare Worker Secrets for the device-session release. Their values must never be placed in `wrangler.jsonc`, committed `.env` or `.dev.vars` files, screenshots, deployment records, or support messages:

```text
TURNSTILE_SECRET_KEY
RELAY_DEVICE_SESSION_SECRET
```

`TURNSTILE_SECRET_KEY` uses the GlucoScope Turnstile configuration for `glucoscope.app`. `RELAY_DEVICE_SESSION_SECRET` is a separate random value used only to derive opaque device-session IDs and source fingerprints in this Worker.

The two names are also declared under `secrets.required` in `wrangler.jsonc`. Secret names are not credentials; their values remain only in Cloudflare. This declaration makes Wrangler validate that the required bindings exist before a future deployment.

## Local verification

```powershell
cd workers/gluco-data-relay
npm install
npm run verify
npm run deploy:dry
```

The dry-run binding summary must show the `RELAY_USAGE_COUNTER` and `RELAY_DEVICE_SESSION` Durable Object bindings and both activation flags as `false`. Wrangler does not print every routing or privacy setting in that summary, so `workers_dev=false`, the `relay.glucoscope.app` custom-domain route, `preview_urls=false`, the SQLite `exports` declaration, `secrets.required`, and `observability.enabled=false` are verified from `wrangler.jsonc`, the automated tests, and a read-only Cloudflare Secret-name check.

## Historical: Phase 3B production verification — 2026-08-05

- `RelayUsageCounter` was created with SQLite storage.
- Both required Secret names were present on the final Worker Version.
- An allowed-origin POST returned `503 relay_temporarily_paused`.
- Allowed-origin preflight returned `204`.
- Wrong-origin and missing-origin requests returned `403`.
- Paused responses returned `Cache-Control: no-store` and `Pragma: no-cache`.
- The temporary `workers.dev` smoke-test target was removed immediately after verification.
- The final stopped/no-target Version ID was `89a2e968-96df-49bb-b8f0-ce631c3b4b32`.
- No Gluroo credential or glucose payload was used during the stopped-state test.

## Historical: pre-activation Cloudflare re-audit — 2026-08-05

- Wrangler `4.118.0` completed a local `deploy --dry-run`; no deployment occurred.
- The current declarative `exports` configuration is valid and keeps `RelayUsageCounter` on Cloudflare's recommended SQLite storage backend. It must not be mixed with the legacy `migrations` flow.
- The Worker uses Web Platform APIs only, so `nodejs_compat` is intentionally not enabled.
- At the time of this pre-activation audit, `workers_dev=false` and the absence of a route or Custom Domain left the uploaded Worker without a public target.
- `observability.enabled=false` is an intentional privacy exception to the general recommendation to enable logs. This relay handles a source URL, credential, requested range, and glucose entries transiently; request or invocation logging could widen that boundary. The source also contains no console logging.
- CORS remains an exact-origin allowlist, originless requests remain disabled, and the upstream destination remains restricted to one Gluroo hostname suffix and one internally constructed entries path.
- The request, upstream response, timeout, entry-count, date-range, session, and Worker-wide limits remain explicit and fail closed.
- No Worker source or Wrangler setting change was required by this re-audit.

## Deployment boundary

There is intentionally no real `deploy` npm script. The checked-in configuration declares only the active `relay.glucoscope.app` custom domain and keeps `workers_dev=false`, Preview URLs disabled, and both activation flags `false`. Production enablement uses a reviewed Version with explicit runtime overrides; any Secret change, upload, deployment, Pages publication, or traffic change remains a separate recorded rollout action.

The old `workers.dev` target and ticket Versions in the sections below are historical production and rollback evidence. They are not an endpoint or compatibility path in the checked-in candidate.

The Phase 3C public-policy review, stopped-target deployment, Trust Pack review, historical Guardian and FreeStyle Libre 2 ticket acceptances, and the G7 device-session Home Screen relaunch acceptance are complete. On 2026-08-06, Gluroo support replied in writing that the proposed use should work and was acceptable to them only while it remains consistent with their EULA, terms, and other documents. The response does not create affiliation, endorsement, partnership, legal assurance about CGM data re-sharing, or permission to use GGC for medical decisions. GlucoScope must handle its own user questions, must not market GGC as a free alternative to subscription Nightscout services, and may say only that GGC currently has no cost during its testing phase while a future subscription is being considered. Wider device-route claims, limit exhaustion, any routing change, and expansion beyond the small early-access group still require separate review and explicit approval.

## Historical: permanent stopped target verification — 2026-08-05

- Target: `https://glucoscope-data-relay.afterglow21.workers.dev`
- Version ID: `ea0b8f59-3e9b-4475-b93a-91855834b3ce`
- `workers_dev=true`, `preview_urls=false`, `RELAY_ENABLED=false`, and `observability.enabled=false`.
- Both required Secret names and the SQLite Durable Object binding remained present after deployment.
- Allowed-origin preflight returned `204`; repeated allowed-origin POST requests returned `503 relay_temporarily_paused`; wrong-origin and missing-origin requests returned `403`.
- One Cloudflare `1042` response occurred immediately after deployment and did not reproduce on the subsequent empty-body or repeated JSON-body stopped checks. Live enablement must stop for investigation if it reappears.
- No Gluroo URL, credential, glucose payload, Turnstile token, relay ticket, or Durable Object counter was used.

## Historical: paused frontend acceptance — 2026-08-05

- At that historical checkpoint, the checked-in endpoint was exactly the approved `workers.dev` target above; there was no additional route or Preview URL.
- Gluroo requires an unchecked-by-default consent control before any relay request. Missing consent stops in the browser before the Turnstile or Worker request begins.
- The consent and privacy wording was confirmed in the desktop layout and at a 375 × 667 mobile viewport.
- Nightscout hides the relay consent control and retains its direct-connection wording.
- The public target returned `503 relay_temporarily_paused` with `Cache-Control: no-store` during the acceptance check.
- Only placeholder values were used. No real Gluroo URL, credential, glucose payload, relay ticket, or Secret value was entered or printed.

## Historical: final pre-live configuration audit — 2026-08-05

- Gluroo's current EULA, Privacy Policy, User Manual, FAQ, Nightscout integration guidance, and third-party-tool guidance were rechecked. No new express prohibition or known provider objection was found; GlucoScope still makes no claim of approval, affiliation, endorsement, or partnership.
- Gluroo's 2026-08-06 written support response was recorded with its EULA/terms condition, medical-decision boundary, CGM re-sharing legal boundary, possible future GGC subscription, no-free-alternative marketing boundary, non-affiliation statement, and GlucoScope-owned support responsibility.
- Wrangler `4.118.0` passed `deploy --dry-run` without deploying. The bundle retained `RELAY_ENABLED=false`, the exact GitHub Pages CORS origin, originless-request rejection, the SQLite Durable Object binding, and all reviewed request and response limits.
- The checked-in config now declares `RELAY_TICKET_SECRET` and `TURNSTILE_SECRET_KEY` under `secrets.required`. Only the names are versioned; their values remain Cloudflare Secrets.
- A read-only check of deployed Version `ea0b8f59-3e9b-4475-b93a-91855834b3ce` confirmed that all plain-text variables match `wrangler.jsonc`, both Secret bindings are present, the Durable Object binding is present, Preview URLs are absent, and the version remains the only 100% deployment.
- A fresh stopped-target check returned `204` for the exact-origin preflight, `503 relay_temporarily_paused` for the exact-origin POST, and `403` without an allow-origin header for wrong-origin and missing-origin POSTs. The earlier one-time Cloudflare `1042` response did not recur.
- `observability.enabled=false` remains an intentional privacy exception. The Worker contains no console logging, and this audit did not use a Gluroo URL, credential, glucose payload, Turnstile token, relay ticket, or Durable Object counter.
- No Worker deployment, Secret mutation, routing change, or live enablement occurred during that audit. The later accepted live test is recorded below.

## Historical: final stopped validation deployment — 2026-08-05

- Source commit: `98def2e96065f1a801728e060673ea22d4ff9e44`.
- Wrangler `4.118.0` deployed with `--strict` and message `paused pre-live safety audit` after separate explicit approval.
- Validation Version ID: `1a51631d-1e53-4f88-ac27-2125b43f1ab2`; it had no Preview URL and was later superseded by the Guardian acceptance attempt described below.
- All plain-text variables match `wrangler.jsonc`; `RELAY_ENABLED=false`, the exact CORS origin, originless-request rejection, `preview_urls=false`, and `observability.enabled=false` remain intact.
- Both names in `secrets.required` were present as Cloudflare Secret bindings, and the SQLite `RelayUsageCounter` Durable Object binding remained present.
- The exact-origin preflight returned `204`; three consecutive exact-origin POSTs returned `503 relay_temporarily_paused`; wrong-origin and missing-origin POSTs returned `403` without an allow-origin header. The earlier one-time Cloudflare `1042` response did not recur.
- No Gluroo URL, credential, glucose payload, Turnstile token, relay ticket, or Durable Object counter was used. No Secret mutation, routing change, or live enablement occurred.

## Historical: Guardian candidate-route acceptance pause — 2026-08-05

- A separately approved acceptance attempt temporarily routed 100% of traffic to Version `84139213-8521-4772-b3f3-47ee0018c5d3` with message `temporary Guardian route acceptance`.
- The attempt stopped before a Gluroo URL, credential, or glucose payload was submitted because the current public Pages build did not yet expose the Guardian guide needed for the test.
- Version `89d8166d-a50e-4e94-b3d3-a06f7a0b6fb1` was then deployed immediately with message `pause after Guardian guide deployment gap`; it has `RELAY_ENABLED=false`, receives 100% of traffic, and has no Preview URL.
- The current stopped Version retains the exact CORS origin, originless-request rejection, both required Secret bindings, and the SQLite `RelayUsageCounter` Durable Object binding.
- End-to-end acceptance through GlucoScope remains incomplete. Restarting it and setting `RELAY_ENABLED=true` still require a separate explicit approval.

## Historical: stopped safe-diagnostic deployment — 2026-08-06

- Source merge commit: `06dba2dc1321562e494a572e0da0c2cfbeb206a8`.
- Wrangler `4.113.0` deployed with `--strict` and message `stopped safe Turnstile diagnostics from main 06dba2d` after explicit approval.
- Version ID: `86149056-cba7-41b8-80c1-15f0e2c26cf0`; it received 100% of traffic until the later Siteverify alignment and acceptance deployments.
- `RELAY_ENABLED=false`, the exact GitHub Pages CORS origin, originless-request rejection, `workers_dev=true`, `preview_urls=false`, and `observability.enabled=false` remain intact.
- Both required Secret names and the SQLite `RelayUsageCounter` Durable Object binding are present. No Secret value was read, printed, changed, or registered.
- The exact-origin preflight returned `204`; the exact-origin POST returned `503 relay_temporarily_paused`; wrong-origin and missing-origin POSTs returned `403`. Responses retained `Cache-Control: no-store`.
- Only a dummy request body was used. No Gluroo URL, credential, glucose payload, real Turnstile token, relay ticket, or Durable Object counter was used.
- This deployment added safe server-side diagnostics but did not complete the end-to-end real-device test by itself.

## Historical: first Guardian end-to-end acceptance — 2026-08-06

- PR #12 merged Siteverify request alignment at `d3051852b6a3b698de67d163cd290bd2b4ad2c3a` after Worker tests (43) and frontend tests (73) passed.
- Stopped Version `2ea372de-a7c5-44c8-8852-0c21f5382633` first verified the merged code, exact CORS origin, both required Secret names, and Durable Object binding with `RELAY_ENABLED=false`.
- Temporary Version `f1c02561-e92a-4a9b-8b70-b9bab2a89fb2` received 100% of traffic with `RELAY_ENABLED=true` after separate explicit approval.
- A dummy invalid Turnstile token returned expected `403` with safe diagnostic `710202`, replacing the earlier transport diagnostic `710001` and confirming Siteverify reachability without using a real Gluroo URL, credential, or glucose payload in a command.
- iPhone Safari completed consent, Turnstile, ticket issuance, Gluroo entry retrieval, current glucose and graph display, and a successful reload for the Guardian route.
- Stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` was deployed immediately afterward and receives 100% of traffic with `RELAY_ENABLED=false`.
- Exact CORS, originless-request rejection, both required Secret bindings, the SQLite Durable Object binding, `preview_urls=false`, and `observability.enabled=false` remain intact.
- No Secret value, Turnstile token, Gluroo URL, credential, or glucose payload was printed, logged, or committed.

This completes the first basic end-to-end acceptance. Today/yesterday/7-day/30-day coverage, deletion, ticket expiry, limit behavior, and any continuing Friends & Family enablement remain separate gates.

## Historical: first FreeStyle Libre 2 end-to-end acceptance — 2026-08-06

- FreeStyle LibreLink, LibreLinkUp, and live Libre 2 readings in Gluroo were confirmed before relay enablement.
- After separate explicit approval, temporary Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` received 100% of traffic with deployment message `temporary Libre 2 end-to-end acceptance` and `RELAY_ENABLED=true`.
- Exact CORS, both required Secret bindings, the SQLite Durable Object binding, request limits, `preview_urls=false`, and `observability.enabled=false` remained unchanged. A dummy invalid Turnstile token returned the expected `403` with safe diagnostic `710202`.
- iPhone Safari Private Browsing completed consent, Turnstile, ticket issuance, Gluroo entry retrieval, current glucose, graph display, reload, and return from the iOS Home Screen for the Libre 2 route.
- Closing Private Browsing removed its browser-stored configuration as expected. Normal-tab persistence after fully quitting Safari was not retested by user choice.
- Stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` was restored immediately afterward, receives 100% of traffic with `RELAY_ENABLED=false`, and returned the expected paused `503` response.
- No Secret value, Turnstile token, Gluroo URL, credential, glucose payload, or relay ticket was printed, logged, or committed.

This completes the first basic Libre 2 end-to-end acceptance only. Historical comparison capture, extended periods, deletion, ticket expiry, limit behavior, and any continuing enablement remain separate gates.

## Historical: supervised user-flow retry — 2026-08-12

- Usage Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` and relay Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` were temporarily enabled for a second supervised iPhone retry.
- Relay connection testing succeeded. After `GlucoScopeを始める`, Usage Turnstile appeared briefly and the required data-connection screen reopened. Usage D1 remained `0 / 0 / 0`; no usage profile was created.
- Usage was immediately returned to stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb`, and this relay was returned to stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` with `RELAY_ENABLED=false`.
- Reproduction traced the screen return to an unnecessary already-user-mode reload. If Safari lost or could not access the sessionStorage relay ticket during that reload, the saved config had no active adapter and required setup reopened. This was a browser handoff failure after successful connection testing, not a new relay acceptance result.
- This release activates the saved config and adapter in place for an already-user-mode page and retains full navigation from the public demo. Local tests passed, and the later supervised Libre acceptance confirmed the fix on-device.
- No Secret value, Turnstile token, Gluroo URL, credential, glucose payload, relay ticket, display name, or profile identifier is recorded here.

## Historical: successful supervised user-mode acceptance — 2026-08-12

- After the in-place fix was published, the same relay and Usage candidate Versions were temporarily enabled for a third supervised iPhone acceptance.
- The Gluroo (Libre) connection passed, `GlucoScopeを始める` kept the existing user-mode page, and live glucose was displayed. This accepts the core CGM handoff fix on the tested device.
- Usage D1 remained `profiles / usage_daily / event_receipts = 0 / 0 / 0` in this historical checkpoint. The later separate Usage acceptance completed Create, Stop, Resume, export, and Delete.
- Deployment `a1962cbf-9f77-48c1-b33a-05bd39323a8c` restored this relay's stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` to 100%. Deployment `17de293b-2d38-4b07-aa5f-604c2cc65d43` restored Usage stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` to 100%.
- Approved-origin preflight returned `204` and an approved-origin stopped `POST` returned `503` for both Workers. Checked-in flags remain `false`; the public frontend supervised-candidate gate remains `true`, and the general-user relay is paused.
- No Secret value, Turnstile token, Gluroo URL, credential, glucose payload, relay ticket, display name, or profile identifier is recorded here.

## Historical: general-user Dexcom G7 acceptance — 2026-08-12

- After separate approval, deployment `eb10444c-56ca-46eb-8e6c-0a15d2bd9fdf` routed active Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` to 100% after stopped-state CORS and rejection checks passed.
- iPhone normal Safari passed connection testing, current glucose, graph display, today/yesterday/7-day/30-day switching, reload and redisplay, and browser-connection deletion followed by return to setup.
- The public 3CGM demo Worker and Usage Worker were untouched; Usage stayed stopped.
- Deployment `5c390d07-13ce-4547-b53c-9a7ea9936696` restored stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` at 100%. Stopped `POST` returned `503` with `Cache-Control: no-store` and `Vary: Origin`.
- No Secret value, URL, credential, token, relay ticket, or glucose value was printed, logged, or committed.

Historical result: the G7 basic user route and its period/reload/deletion checks are verified under the ticket Version. Separate explicit approval later enabled that Version for the small early-access group. This evidence does not accept the new device-session lifecycle.

## Accepted activation sequence and continuing checks

Each numbered boundary is independently reviewable. Steps 1–7 were completed for the 2026-08-16 small-group release and G7 Home Screen relaunch acceptance; deletion, less common limits, additional routes, and any wider rollout remain continuing checks. Do not combine infrastructure creation, live enablement, and personal-data acceptance in one unreviewed operation.

1. Recheck the current Gluroo public materials for material changes or a known provider objection.
2. Confirm that each intended device route is described according to its actual verification status. The accepted general-user Dexcom G7 route may be described only within its recorded connection, period, reload, and deletion checks; other untested relay routes must not be advertised as verified, and Libre 2 must not be described beyond its completed basic-path checks. The separate public-demo Worker keeps its own verification record.
3. Run `npm run verify`, `npm run deploy:dry`, `git diff --check`, frontend checks, and a Secret-pattern scan. Confirm both activation flags are `false`, `workers_dev=false`, Preview URLs and observability are off, both SQLite Durable Object exports exist, only the two candidate Secret names are required, the exact Origin is `https://glucoscope.app`, and only the `relay.glucoscope.app` custom-domain route is declared.
4. Before the site switch, add `glucoscope.app` to every production Turnstile widget hostname allowlist and deploy every backend that must accept the new Origin. Create and verify only the `relay.glucoscope.app` custom domain; do not expose the candidate on `workers.dev`.
5. With both activation flags `false`, deploy only after a recorded rollout decision. Verify exact-Origin credentialed preflight, wrong- and missing-Origin rejection, paused responses, no-store headers, both Durable Object bindings, both Secret binding names, and absence of the old ticket endpoint. Never print or copy Secret values into the repository, terminal record, screenshot, or support message.
6. Publish the matching `glucoscope.app` site only after the stopped Worker boundary passes. Confirm the plain relay explanation, one-time reconnect message, Home-Screen-first iPhone guide, and independence of direct Nightscout and the public demo.
7. After a separate live-test decision, enable the device-session and relay gates. Use a person's Global Connect URL and API Secret only in the browser UI. Accept creation, rotation, status, source binding and mismatch, rolling idle expiry, daily/global limits, reload, full Safari quit, Home Screen launch, and one-time reconnect without logging private data.
8. Accept deletion with local credentials removed before any network dependency, online server revocation, offline best-effort behavior, cookie clearing, and scheduled expiry cleanup. Then accept current, today, yesterday, 7-day, and 30-day reads for each route before widening its verified claim.
9. Immediately return both activation flags to `false` if Gluroo objects, applicable terms materially change, abnormal traffic is detected, or a privacy or safety concern appears. The old Cloudflare ticket Version remains historical rollback evidence, but the candidate contains no dual-authentication compatibility and the new site must fail closed if the relay is paused.

## Accepted routes and remaining operational checks

The first candidate is the verified iPhone input segment extended through the full GlucoScope path:

```text
MiniMed / CareLink
        ↓
Guardian Monitor
        ↓ Nightscout sync
Gluroo Global Connect
        ↓
Limited Data Relay
        ↓
GlucoScope
```

The Guardian path has completed its first end-to-end iPhone Safari acceptance through the relay and GlucoScope for current glucose, graph display, and reload. The FreeStyle Libre 2 path has separately completed its first basic acceptance through FreeStyle LibreLink, LibreLinkUp, Gluroo, the relay, and GlucoScope for current glucose, graph display, reload, and return from the iOS Home Screen. The general-user Dexcom G7 route completed connection, current, today, yesterday, 7-day, 30-day, reload, and deletion checks in normal Safari. Other untested routes remain unverified, and every accepted route may be described only to the extent of its recorded checks. The separate public-demo Worker is outside this relay acceptance matrix.

Before any expansion beyond the approved small group or any new device-route acceptance, complete the candidate activation sequence, recheck current public materials and configuration, obtain a separate rollout decision, and enter the person's Global Connect URL and API Secret only in the browser UI. Never place them in commands, fixtures, screenshots, or documents.

The remaining operational observation must confirm:

- entries-only behavior with no treatments, insulin, carbohydrate, medication, pump-setting, or device-status retrieval;
- gentle handling of missing, delayed, duplicated, invalid-session, source-mismatch, expired-session, and rate-limited states;
- simulated 180-day idle expiry and alarm cleanup, full-Safari-quit restoration, Home Screen launch, and live limit behavior;
- AI failures remain independent and no connection detail, raw glucose response, session identifier, or source fingerprint enters the AI Worker or shared cache;
- direct Nightscout and the public demo remain independent;
- an immediate return to `RELAY_ENABLED=false` works and produces the reviewed paused message.
