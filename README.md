# GlucoScope

Personal Nightscout dashboard for glucose insights and daily reports.

GlucoScope is a gentle blood glucose reflection tool for people living with diabetes.
It is not a medical device and does not provide diagnosis, treatment decisions, insulin dose instructions, or emergency support.

## Current publishing target

The first public target is GitHub Pages.
Cloudflare Pages may be considered later, but the current priority is to publish the existing static site safely and quickly.

The AI letter API continues to run through Cloudflare Worker.
Provider API keys must stay server-side in the Worker environment and must never be committed to GitHub or placed in frontend JavaScript.

## User Foundation 0.4 / 1–3 person early access

The root page remains Kazuma's public demo. The user-data route is:

```text
user.html
```

or:

```text
index.html?mode=user
```

Two connection routes are kept separate:

- an existing Nightscout environment is read directly by the browser;
- Gluroo Global Connect uses the Gluroo-only Limited Data Relay because direct browser access is blocked by provider-side CORS in the verified environment.

The Gluroo relay accepts glucose entries only. It does not retrieve treatments, insulin, carbohydrates, medication, pump settings, or device-status data. The Gluroo URL, token, and glucose response pass transiently through Cloudflare infrastructure and the relay Worker, but the application does not store, cache, log, send to AI, or share those values. The SQLite Durable Object stores only a UTC date bucket and request count.

The first end-to-end acceptance used this path:

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

On 2026-08-06, the Guardian route completed its first iPhone Safari acceptance through Turnstile, the signed relay ticket, Gluroo, and GlucoScope. Later the same day, the FreeStyle Libre 2 route completed its first basic end-to-end acceptance from FreeStyle LibreLink through LibreLinkUp, Gluroo, the limited relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed in Safari Private Browsing. Closing Private Browsing removed its browser-stored configuration as expected; normal-tab persistence after fully quitting Safari was not retested by user choice. On 2026-08-12, the general-user Dexcom G7 route completed a supervised iPhone Safari acceptance through Gluroo and the limited relay: connection, current glucose, the graph periods today, yesterday, 7 days, and 30 days, display after reload, and connection deletion returning to setup all passed. Natural ticket expiry, persistence after fully quitting Safari, and live request-limit exhaustion were not part of that acceptance. The relay was returned immediately to `RELAY_ENABLED=false` after that check. Later on 2026-08-12, after a separate explicit approval, the accepted Usage and relay Versions were enabled continuously for a 1–3 person early-access group. This is not a broad public rollout. Separately, the public-demo Worker first completed source-specific G7 and Libre checks, then one approved Guardian/Libre/G7 public-page acceptance. After frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published by Pages run `31181233497`, the dedicated demo Worker began continuous public operation at 22:10:05 JST. This public-demo decision applies only to Kazuma's explicitly consented, public and non-anonymous Libre and G7 demo data.

Phase 3A connected the user onboarding flow to the paused relay client. Phase 3B created the paused Worker shell and SQLite Durable Object in Cloudflare, registered the required Worker Secrets, and passed stopped-response/CORS smoke tests. The approved `workers.dev` target is fixed in the checked-in frontend, and explicit consent is required before any relay request. `preview_urls=false`, `observability.enabled=false`, and the checked-in `RELAY_ENABLED=false` remain in place as the rollback-safe source configuration. Production deployment `5f8d00d9-9d68-4b2a-99cd-c58c26123684` currently routes 100% to accepted Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` for the 1–3 person early-access group; stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` remains the immediate rollback target. Usage deployment `4fbf0e2c-5f5c-4f4f-98a9-ae57d73b4824` similarly routes accepted Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` at 100%, with initial D1 counts `0 / 0 / 0`. Direct Nightscout and the separately consented public demo remain independent.

## 3CGM Comparison Lab

The comparison lab is now a continuous public live demo. Existing reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` was deployed at 100% as deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` at 22:10:05 JST. After the 22:15 Cron, the sanitized public responses contained 528 Libre entries and 290 G7 entries; a second scheduled aggregate check observed 526 Libre entries and 290 G7 entries. Both checks returned `200` for both routes with `stale=false`, fresh snapshots and latest readings, exact source IDs, and the reviewed schema, field allowlists, types, ranges, ordering, CORS, cache, and size boundaries. No glucose value, exact measurement timestamp, source credential, or Secret value entered validation output or Git. A new browser session showed `公開デモ · ライブデータ`, three available and selected source controls, the three-source chart message, and Guardian, Libre, and G7 cards without an update-delay state. The same open tab then completed one five-minute automatic refresh with all three sources still live, the Libre displayed-point aggregate changing from 526 to 525, and no console error. At about 01:10 JST on 2026-08-08, a read-only continuation check confirmed that deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` and live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` still received 100% of traffic. Both routes returned `200` with 526 Libre and 290 G7 entries, `stale=false`, fresh snapshots and latest readings, and passing reviewed schema, freshness, private-marker, CORS, cache, response-size, field, type, range, and ordering checks. KV contained exactly the two expected keys, each with a recent remaining TTL greater than 35 hours and no more than 36 hours 15 minutes. The existing public browser tab was inspected without reload at about 01:05 JST and again about five minutes later; both views remained three-source live, the displayed update age moved from about zero to about one minute instead of aging by five minutes, and the console stayed error-free. This verifies about three hours of continued operation and one further five-minute auto-refresh at a later checkpoint, bringing the total confirmed browser refreshes to two; it is not an overnight observation. Natural expiry is not expected during healthy operation because each successful five-minute refresh resets the 36-hour snapshot TTL, so natural expiry is now a separate, non-blocking stopped/failure-path test. The lab does not rank devices, claim accuracy, select a reference CGM, or support treatment decisions.

Current delivery order:

1. Completed after separate explicit approval: verify one Libre public-demo scheduled retrieval and sanitized public response, then restore the stopped Worker and confirm that the next stopped Cron does not extend the Libre snapshot expiration.
2. Completed: publish the configured stopped G7 frontend endpoint with `dexcomRouteVerified=false` and verify the synthetic fallback on GitHub Pages.
3. Completed after separate operational approval: briefly enable the required demo feeds and verify Guardian, Libre, and G7 together on GitHub Pages once.
4. Completed after the live check: restore the stopped Worker, verify both routes return `503`, verify a new page returns to the synthetic fallback, and confirm that the next stopped Cron does not extend either source snapshot expiration.
5. Completed after the frontend safety release and continuing-publication decision: start the continuous public 3CGM demo with the reviewed live Version, verify two fresh scheduled aggregate checks, and verify one new browser session plus its first five-minute automatic refresh.
6. Completed: confirm about three hours of continued live operation, one further five-minute auto-refresh at a later checkpoint for two confirmed browser refreshes in total, and healthy two-key KV refresh lifetimes without exposing glucose values, exact measurement timestamps, credentials, or Secrets.
7. Completed on 2026-08-12: verify the general-user Dexcom G7 connection, current glucose, today/yesterday/7-day/30-day graph periods, reload, and connection deletion in iPhone Safari, then return the relay to `RELAY_ENABLED=false`.
8. Current after separate explicit approval: keep the general-user relay enabled only for the 1–3 person early-access group, with the reviewed stopped Version ready for immediate rollback. Natural ticket expiry, persistence after fully quitting Safari, and live request-limit exhaustion remain operational observations.
9. Non-blocking later: exercise demo-snapshot natural expiry in a deliberately stopped/failure-path window; healthy five-minute refreshes reset the 36-hour TTL, so expiry is not expected during normal continuous operation.
10. Return to Worker usage-counter and Usage Dashboard production verification, the site-wide Trust/About review, feedback, and the first announcement.

Guardian is read directly from Kazuma's existing public Azure Nightscout. Libre uses the separate `workers/gluco-demo-feed/` Worker design: scheduled Gluroo fetches update an expiring sanitized KV snapshot, and public visitors read only that snapshot. The same Worker includes a separately gated G7 route. Kazuma explicitly chose to make his own Libre glucose values and measurement/update timing public for this demo. On 2026-08-07, he separately and explicitly chose to publish his own G7 glucose values and measurement/update timing through the same public comparison. These choices apply only to Kazuma's consented demo data; they do not authorize storing or publishing any general user's data. The public demo now continuously serves the reviewed Libre and G7 snapshots while the source gates remain enabled in the deployed Version. GlucoScope is not affiliated with Gluroo, the demo is not for medical decisions, and Gluroo Global Connect is not marketed as a free alternative to subscription Nightscout services. The general-user Limited Data Relay is separately enabled only for the 1–3 person early-access group and keeps its no-glucose-storage boundary.

The demo Worker remains checked in with the global `DEMO_FEED_ENABLED=false`, source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`, no application logging, and Worker observability disabled. Those safe defaults have not changed. Production alone now routes 100% to the separately reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567`, whose three delivery gates are enabled. Cloudflare's normal `workers.dev` route remains enabled and versioned Preview routing remains disabled. The published frontend keeps `dexcomRouteVerified=true` because the G7 display path passed; this frontend flag does not enable either Worker route. Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` remains the immediate rollback target.

Historical stopped-deployment checkpoint: after separate explicit approvals on 2026-08-06, one dedicated KV namespace was created and the stopped `glucoscope-demo-feed` Worker was deployed as Version `4c8d40de-8877-4d70-800e-1607e1940b96`. A later explicit approval registered exactly the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets; their values were not printed, logged, or added to Git. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`. On 2026-08-07, after separate stopped-deployment approval and review, multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was uploaded and deployed to 100% of production traffic with all three gates still `false`. At that checkpoint, both source routes returned `503 demo_feed_paused`, approved-origin G7 preflight returned `204`, an unapproved browser origin returned `403`, the five-minute Cron exited before Secret access, Gluroo fetch, or KV write, and the dedicated KV remained empty after a Cron boundary. The Cloudflare subdomain setting remains `enabled=true` with `previews_enabled=false`; version-level `has_preview` metadata does not mean the public Preview route is enabled. This paragraph records the earlier stopped checkpoint; the current production state is the continuous live Version described above.

The deployed multi-source revision declares the G7 Secret names `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`, the separate `public:dexcom-g7:v1` KV key, and the stopped `/v1/dexcom-g7` route. After separate explicit approval on 2026-08-07, the two G7 values were entered through masked prompts with `wrangler versions secret put`, creating unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. The deployed Version inherited exactly the four Libre/G7 Secret names; Secret values were not placed in command arguments, captured output, or Git, and temporary registration logs were removed after verification. After another explicit approval, G7-only Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100% as deployment `5b7a0099-9425-4ddf-a500-68e2ed834ea5`, with the global and G7 gates `true` and the Libre gate still `false`. One scheduled refresh wrote only `public:dexcom-g7:v1`. The public `/v1/dexcom-g7` response contained 190 entries and passed the reviewed field, type, range, ordering, recency, CORS, and private-marker checks without printing glucose values or measurement times. Libre remained paused. Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored at 100% as deployment `8de64190-7558-43c6-83c1-1e29a2cf80de`; both source routes again returned `503`, and the next stopped Cron did not extend the G7 snapshot expiry. At that historical checkpoint, the published frontend configured the stopped G7 URL with `dexcomRouteVerified=false`, and GitHub Pages synthetic fallback verification passed. The later simultaneous live acceptance is recorded below. Raw exports, credentials, and unreviewed candidate files remain out of Git.

After another separate explicit approval on 2026-08-07, Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was temporarily deployed for one scheduled refresh. The 19:25 JST Cron produced a public `/v1/libre` response containing 523 entries. Aggregate-only validation passed the reviewed top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. G7 remained paused at `503`. Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored; both source routes again returned `503`, and the next stopped Cron did not extend the Libre snapshot expiration. This earlier checkpoint verified one Libre scheduled retrieval and sanitized public Worker response only; the later simultaneous live acceptance is recorded next.

After separate operational approval, live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` was deployed at 100% as deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST. The sanitized public responses contained 527 Libre entries and 276 G7 entries, and aggregate-only checks passed for the reviewed fields, types, ranges, ordering, recency, and exact CORS. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. GitHub Pages showed Guardian, Libre, and G7 as live with all three cards enabled, and Kazuma visually confirmed the three plotted lines. At that checkpoint this was one public-page acceptance; continued operation, repeated browser display refreshes, stale behavior, and natural expiry were still unverified. The review window crossed scheduled triggers, so no exact scheduled-refresh count was claimed.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was restored at 100% as deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4` at 21:16:31 JST. Both public routes returned `503`, and a newly opened GitHub Pages view returned to the clearly labelled synthetic dataset. After the 21:25 JST stopped Cron, metadata showed only the two expected source keys, no metadata payload, and unchanged expirations for both keys. This confirms that the stopped Cron did not refresh either snapshot or extend either expiration. `dexcomRouteVerified=true` remains in the frontend as a display-path verification record; it is not a Worker enable switch. At that historical checkpoint, the general-user Limited Data Relay remained stopped.

Continuous public operation started after frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published successfully by Pages run `31181233497`. Deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` assigned 100% of demo-Worker traffic to reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` at 22:10:05 JST. Repeated scheduled aggregate checks, about three hours of continued live operation, and two browser auto-refresh checks at separate checkpoints have now passed. This is not an overnight observation. Natural expiry is a separate, non-blocking stopped/failure-path acceptance because healthy five-minute refreshes reset the 36-hour snapshot TTL. The frontend derives each source's freshness from the latest reading or upstream stale state with a 15-minute boundary. A previously live view is preserved for at most 15 minutes during transient failures and then falls back to labelled synthetic data. Pause immediately if Kazuma withdraws consent, Gluroo objects or materially changes applicable terms, unexpected data or abnormal traffic appears, or a privacy or safety concern is found. From `workers/gluco-demo-feed/`, the reviewed emergency rollback is `$env:WRANGLER_WRITE_LOGS='false'; .\node_modules\.bin\wrangler.cmd versions deploy '9994a142-a4ca-4885-9077-952ec8e7e8d2@100%' --yes --message 'Restore stopped public demo feed'`.

The unlinked `tools/cgm-comparison-capture/` helper remains available for a later reviewed three-source static snapshot. It uses browser memory only, does not load analytics, and does not persist connection details.

Design and safety details are documented in:

```text
docs/Feature_Specs/CGM_COMPARISON_DEMO.md
```

Run the frontend tests with:

```bash
node --check js/data-source.js
node --check js/data-relay-client.js
node --check js/local-profile.js
node --check js/app.js
node --test test/data-source.test.mjs test/data-relay-client.test.mjs test/local-profile.test.mjs test/user-onboarding.test.mjs test/privacy-boundary.test.mjs test/trust-pack.test.mjs
```

The design and safety boundaries are documented in:

```text
docs/Feature_Specs/USER_DATA_SOURCE_FOUNDATION.md
docs/Feature_Specs/USER_ANALYTICS_FOUNDATION.md
docs/Feature_Specs/LIMITED_DATA_RELAY.md
```

## GitHub Pages setup

Use the repository root as the GitHub Pages source.

1. Push the latest `main` branch to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` → `Pages`.
4. Set `Build and deployment` to `Deploy from a branch`.
5. Select:
   - Branch: `main`
   - Folder: `/ (root)`
6. Save.

Expected URL format:

```text
https://<github-user>.github.io/<repository-name>/
```

For example:

```text
https://<github-user>.github.io/glucoscope/
```

This repository includes `.nojekyll` so GitHub Pages serves the static files directly.

## Pre-publish checklist

Run these from the repository root before publishing:

```bash
git status
git rev-parse HEAD
git ls-files | grep -E '(^|/)(\.env|\.dev\.vars)'
```

The last command should return nothing.

Also check that secrets are not committed:

```bash
git grep -n -E 'sk-[A-Za-z0-9_-]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}' -- .
```

This check looks for common secret value patterns. Documentation may mention secret names as examples, but real secret values must not appear.

## AI letter Worker on GitHub Pages

The frontend never calls OpenAI directly. It calls the production Cloudflare
Worker endpoint:

```text
https://gluco-letter-worker.afterglow21.workers.dev/api/gluco-letter
```

The public GitHub Pages site enables AI letters by default. It does not require
`debugAiWorker`, `aiWorkerEndpoint`, or browser-local configuration.

The following protections remain active:

- Cloudflare Turnstile
- Worker-side time-slot and daily generation limits
- browser-local and shared one-hour cache behavior
- Usage Dashboard and estimated-cost recording
- budget stops and safe error fallbacks
- medical and AI safety wording

For privacy, deployed public pages always use the production Worker endpoint.
The `aiWorkerEndpoint` query parameter and browser-local endpoint override are
accepted only on `localhost` or `127.0.0.1`.

For local development, the default endpoint remains:

```text
http://127.0.0.1:8787/api/gluco-letter
```

Enable the local AI button with either:

```text
?debugAiWorker=1
```

or:

```js
localStorage.setItem("glucoscope.aiLetterWorkerEnabled.v1", "true");
```

On a local host only, `aiWorkerEndpoint` or
`glucoscope.aiLetterWorkerEndpoint.v1` may override the local endpoint.

## Shared AI letter cache

The public demo uses a browser-local cache first and can also use a shared Cloudflare Workers KV cache.

For the same page mode, language, period, morning/afternoon/night slot, analysis mode, and displayed range:

- a letter younger than one hour is reused without a new OpenAI request,
- cache displays do not consume a new-generation count,
- the shared KV value stores only the generated letter and minimal metadata, not the glucose summary,
- entries expire automatically within 24 hours after remaining available as a gentle stale fallback,
- incomplete OpenAI output is rejected; a `max_output_tokens` cutoff is retried once with a larger mode-specific limit, and partial text is never cached, and
- AI output is checked for Gluco-style Japanese wording and leaked internal labels; a failed first draft is rewritten once, and text that still fails is not shown or cached.

Production KV setup is documented in:

```text
workers/gluco-letter-worker/README.md
```

## Worker CORS policy

The production Worker uses an explicit browser-origin allowlist instead of `Access-Control-Allow-Origin: *`.
The current public origin is:

```text
https://afterglow21.github.io
```

A browser `Origin` contains only the scheme, host, and optional port, so the repository path is not included. Allowed browser responses echo the exact approved origin and include `Vary: Origin`. Disallowed browser origins receive `403`, while command-line and operational requests without an `Origin` header remain available for verification.

For local frontend development, add a non-committed Worker variable such as the following to `workers/gluco-letter-worker/.dev.vars`:

```text
CORS_LOCAL_ORIGINS="http://127.0.0.1:5500,http://localhost:5500"
```

CORS limits which browser pages can read the API response. It is not a replacement for Turnstile, usage guards, secrets, or other server-side controls.

## Cloudflare Web Analytics

Public-demo HTML pages use a local privacy-gated loader for Cloudflare Web Analytics aggregate page-view and performance monitoring. The loader does not fetch the analytics beacon when `mode=user` is active, when either GlucoScope user-connection storage key exists, when the usage browser-profile key containing a bearer credential exists, when the main page is configured to offer usage-profile enrollment, or when browser storage cannot be checked. Saving or removing the optional local display name alone does not disable or enable Cloudflare Web Analytics. This applies across the same-origin About and Trust pages as well as the main page. The archived `backup/` pages and setup guides are excluded.

Chart.js 4.5.1 is vendored under `vendor/chart.js/` with its MIT license. The user-data page therefore does not execute the chart runtime from a third-party CDN in the same origin context as browser-stored connection details.

GlucoScope does not add custom analytics events or a custom visitor identifier. Glucose values, GlucoScore, AI letter text, Nightscout URLs, API information, and mobile-tab actions must not be intentionally encoded into analytics event names or additional analytics data. Public-facing details are maintained in:

```text
pages/trust/privacy-notes.html
```

The Web Analytics token is a public site identifier embedded in HTML. It is not an API secret. OpenAI keys, Turnstile secrets, and other credentials must still remain outside the repository.

## Safe wording boundary

GlucoScope should use:

- 糖尿病とともに生きる人
- 血糖マネジメント
- 振り返り
- 手がかり
- やさしく

GlucoScope should avoid language that makes blood glucose data feel like blame, grading, or failure.
AI letters are supportive reflections, not medical judgment.

Gluco should also celebrate clearly when the summarized data contains a genuinely positive clue. TIR of 75% or higher, CV below 30%, and a latest reading near 100mg/dL may receive specific positive recognition. TIR of 100% should be celebrated enthusiastically. When today's latest reading is exactly 100mg/dL, Gluco may say `🦄 ユニコーンをつかまえた！` as a playful small-luck moment. These are writing rules, not medical grades, treatment targets, or judgments of the person.

Unicorn Gluco illustrations are also available as a local collection encounter. The browser watches only newly received latest-glucose entries while the page is open; it never searches historical data for 100mg/dL. A fresh new reading of exactly 100mg/dL can unlock one encounter per local day. The Letter-tab illustration stays Unicorn Gluco for that day without a new AI request, while the glucose-tab peek switches to Unicorn Gluco only while the current fresh reading remains 100mg/dL.


## User Foundation 0.4 onboarding details

The user-mode onboarding is designed for people with little technical knowledge, including older smartphone users.

- `index.html?mode=user` presents two clearly numbered routes and states that only one is needed.
- Tapping a route card advances immediately; there is no separate “select, then continue” button.
- Method 1 is the Gluroo route for FreeStyle Libre 2, Dexcom G7, and the verified Guardian Monitor input path.
- Method 2 is for people who already use their own Nightscout environment or can build and maintain one.
- Guardian (MiniMed 780G) uses the dedicated `guides/guardian-monitor/` path from Guardian Monitor to Gluroo Global Connect.
- The main setup uses `接続先URL` and `接続用の合言葉`; internal terms stay in implementation and developer diagnostics.
- The screenshot guide is maintained separately at `guides/gluroo-setup/` so Gluroo screen changes can be updated without redesigning the dashboard.
- Guide screenshots are displayed without fixed-position overlays. Numbered steps and captions identify what to look for without risking marker drift across devices.
- Separate preparation pages explain Dexcom Share, LibreLinkUp, and Guardian Monitor.
- The beginner guides now incorporate all 27 supplied LibreLink / LibreLinkUp captures and all 10 supplied Dexcom Share captures as one-screen-per-step walkthroughs. Personal fields in the supplied captures are masked, each guide warns that app updates may change screens, and completion continues into the common Gluroo guide at `#screen-30`.
- The screenshots and instructions are connection guidance only. Example glucose values or graph settings are not targets or medical advice; treatment decisions, alerts, and current sensor state remain with the original CGM app and the person's medical guidance.
- General-user Gluroo connection details may stay in the selected browser and pass transiently through the limited relay. They are not stored in Azure, KV, Durable Objects, relay logs, shared cache, or AI. The separate public demo feed now continuously publishes only Kazuma's explicitly consented Libre and G7 demo values and never receives a general user's connection details or glucose data. The frontend keeps `dexcomRouteVerified=true` as a record of the verified G7 display path, while the deployed demo-Worker Version independently controls publication. The general-user relay is currently enabled only for the approved 1–3 person early-access group.
- Existing Nightscout remains a direct browser route and does not use the limited relay.
