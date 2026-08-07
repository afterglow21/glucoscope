# GlucoScope

Personal Nightscout dashboard for glucose insights and daily reports.

GlucoScope is a gentle blood glucose reflection tool for people living with diabetes.
It is not a medical device and does not provide diagnosis, treatment decisions, insulin dose instructions, or emergency support.

## Current publishing target

The first public target is GitHub Pages.
Cloudflare Pages may be considered later, but the current priority is to publish the existing static site safely and quickly.

The AI letter API continues to run through Cloudflare Worker.
Provider API keys must stay server-side in the Worker environment and must never be committed to GitHub or placed in frontend JavaScript.

## User Foundation 0.4 / Limited Data Relay stopped after first acceptance

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

On 2026-08-06, the Guardian route completed its first iPhone Safari acceptance through Turnstile, the signed relay ticket, Gluroo, and GlucoScope. Later the same day, the FreeStyle Libre 2 route completed its first basic end-to-end acceptance from FreeStyle LibreLink through LibreLinkUp, Gluroo, the limited relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed in Safari Private Browsing. Closing Private Browsing removed its browser-stored configuration as expected; normal-tab persistence after fully quitting Safari was not retested by user choice. The relay was returned immediately to `RELAY_ENABLED=false`. Extended period, expiry, deletion, and limit checks remain before a continuing Friends & Family enablement. On 2026-08-07, Dexcom G7 readings were confirmed in Gluroo and its connection details were prepared. The limited-relay G7 path remains unverified. Separately, the public-demo Worker route has been deployed and verified only in its stopped state; scheduled live retrieval, KV publication, and frontend activation remain unverified. G7 is not described as supported or live.

Phase 3A connected the user onboarding flow to the paused relay client. Phase 3B created the paused Worker shell and SQLite Durable Object in Cloudflare, registered the required Worker Secrets, and passed stopped-response/CORS smoke tests. The approved `workers.dev` target is fixed in the checked-in frontend, and explicit consent is required before any relay request. `preview_urls=false`, `observability.enabled=false`, and the checked-in `RELAY_ENABLED=false` remain in place. The production Worker was returned to `RELAY_ENABLED=false` after each basic acceptance, so live Gluroo data is not currently available. Direct Nightscout and the public demo remain independent.

## 3CGM Comparison Lab preparation

The comparison lab is prepared to show live Guardian and Libre data together while Dexcom G7 remains visibly pending. It does not rank devices, claim accuracy, select a reference CGM, or support treatment decisions. If the live sources are not configured or cannot be loaded, the page clearly falls back to the checked-in synthetic dataset. PR #14 merged the comparison frontend to `main` in merge commit `7e96648c27ce20fabe2f283c384124e36ce0b2d2`. GitHub Pages publication was verified on 2026-08-07 after the official deployment-lag incident was mitigated: `/demos/cgm-comparison/` loaded with the clearly labelled `準備中 · 合成データ` fallback and all three device cards.

Guardian is read directly from Kazuma's existing public Azure Nightscout. Libre uses the separate `workers/gluco-demo-feed/` Worker design: one scheduled Gluroo fetch updates an expiring sanitized KV snapshot, and public visitors read only that snapshot. The same Worker now includes a separately gated G7 route that is deployed only in its stopped state. Kazuma explicitly chose to make his own Libre glucose values and measurement/update timing public for this demo. On 2026-08-07, he separately and explicitly chose to publish his own G7 glucose values and measurement/update timing through the same public comparison. These choices apply only to Kazuma's consented demo data; they do not authorize storing or publishing any general user's data. No G7 glucose value has been written to the demo KV or published by GlucoScope, and the general-user Limited Data Relay remains paused with its no-glucose-storage boundary.

The demo Worker is checked in with the global `DEMO_FEED_ENABLED=false`, source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`, no application logging, and Worker observability disabled. After separate explicit approvals on 2026-08-06, one dedicated KV namespace was created and the stopped `glucoscope-demo-feed` Worker was deployed as Version `4c8d40de-8877-4d70-800e-1607e1940b96`. A later explicit approval registered exactly the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets; their values were not printed, logged, or added to Git. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`. On 2026-08-07, after separate stopped-deployment approval and review, multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was uploaded and deployed to 100% of production traffic with all three gates still `false`. Both `/v1/libre` and `/v1/dexcom-g7` return `503 demo_feed_paused`, approved-origin G7 preflight returns `204`, an unapproved browser origin returns `403`, the five-minute Cron exits before Secret access, Gluroo fetch, or KV write, and the dedicated KV remained empty after a Cron boundary. The Cloudflare subdomain setting remains `enabled=true` with `previews_enabled=false`; version-level `has_preview` metadata does not mean the public Preview route is enabled. The comparison frontend still uses only the stopped `/v1/libre` endpoint and falls back to clearly labelled synthetic data.

The deployed multi-source revision declares the G7 Secret names `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`, the separate `public:dexcom-g7:v1` KV key, and the stopped `/v1/dexcom-g7` route. After separate explicit approval on 2026-08-07, the two G7 values were entered through masked prompts with `wrangler versions secret put`, creating unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. The deployed Version inherited exactly the four Libre/G7 Secret names; Secret values were not placed in command arguments, captured output, or Git, and temporary registration logs were removed after verification. No G7 KV value was written, no live Gluroo retrieval occurred, and no G7 frontend endpoint was activated. Live retrieval and frontend activation still require separate explicit approvals. Raw exports, credentials, and unreviewed candidate files remain out of Git.

The unlinked `tools/cgm-comparison-capture/` helper remains available for a later reviewed three-source static snapshot after the Dexcom public path is verified. It uses browser memory only, does not load analytics, and does not persist connection details.

Design and safety details are documented in:

```text
docs/Feature_Specs/CGM_COMPARISON_DEMO.md
```

Run the frontend tests with:

```bash
node --check js/data-source.js
node --check js/data-relay-client.js
node --check js/app.js
node --test test/data-source.test.mjs test/data-relay-client.test.mjs test/user-onboarding.test.mjs test/privacy-boundary.test.mjs test/trust-pack.test.mjs
```

The design and safety boundaries are documented in:

```text
docs/Feature_Specs/USER_DATA_SOURCE_FOUNDATION.md
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

Public-demo HTML pages use a local privacy-gated loader for Cloudflare Web Analytics aggregate page-view and performance monitoring. The loader does not fetch the analytics beacon when `mode=user` is active, when either GlucoScope user-connection storage key exists, or when browser storage cannot be checked. This applies across the same-origin About and Trust pages as well as the main page. The archived `backup/` pages and setup guides are excluded.

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
- General-user Gluroo connection details may stay in the selected browser and pass transiently through the limited relay. They are not stored in Azure, KV, Durable Objects, relay logs, shared cache, or AI. The separate public demo feed is limited to Kazuma's explicitly consented Libre and G7 demo values and never receives a general user's connection details or glucose data. The deployed G7 slot remains disabled and is not activated in the frontend despite the completed publication choice and Secret registration.
- Existing Nightscout remains a direct browser route and does not use the limited relay.
