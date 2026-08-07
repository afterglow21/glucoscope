# GlucoScope Public Demo Feed

This Worker is a public-demo-only, multi-source feed for Kazuma's data. It is separate from the general-user Limited Data Relay. Publication consent is recorded separately for Kazuma's Libre and G7 glucose values and measurement/update timing. G7 nevertheless remains a stopped, unverified source until its Worker, KV, frontend, and live-data path are separately verified.

The prepared routes use source-specific Gluroo Global Connect slots:

```text
FreeStyle LibreLink
        -> LibreLinkUp
        -> Gluroo Global Connect
        -> scheduled demo-feed Worker
        -> public:libre-2:v1
        -> public 3CGM Comparison Lab

Dexcom G7
        -> Gluroo Global Connect (display confirmed)
        -> stopped local G7 source slot
        -> public:dexcom-g7:v1 (not written)
        -> public comparison remains pending
```

## Checked-in safety state

- `DEMO_FEED_ENABLED=false`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=false`.
- The dedicated `DEMO_FEED_CACHE` KV namespace was created after explicit approval on 2026-08-06, and its non-secret namespace id is recorded in `wrangler.jsonc`. The namespace remains empty.
- After a second explicit approval, stopped Version `4c8d40de-8877-4d70-800e-1607e1940b96` was deployed to `https://glucoscope-demo-feed.afterglow21.workers.dev`. A later explicit approval registered exactly `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`, which now receives 100% of traffic. The five-minute Cron is present but exits while disabled, before Secret access, upstream fetch, or KV write.
- The existing Libre Secret values remain Cloudflare-only. After separate explicit approval on 2026-08-07, the G7 values for `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET` were entered through masked prompts with `wrangler versions secret put`. This created unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. The latest contains all four Secret names and keeps `DEMO_FEED_ENABLED=false`; production traffic remains 100% on stopped Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`.
- Secret values must never enter Git, terminal arguments, screenshots, logs, fixtures, or support messages.
- `DEMO_G7_FEED_CACHE_KEY=public:dexcom-g7:v1` is a non-secret, source-specific KV key. No G7 KV value has been written.
- `GET /v1/dexcom-g7` is locally prepared but has not been deployed or activated in the frontend. The two unpublished Secret-only Versions clone the currently deployed stopped code and do not deploy the local G7 route or source-specific gates. No G7 KV value, production code/binding change, traffic allocation change, or frontend activation occurred.
- Observability is disabled to reduce health-data logging. Cloudflare's route-level subdomain API reports `enabled=true` and `previews_enabled=false`; version-level `has_preview` metadata does not mean the public Preview route is enabled.
- There is intentionally no real `deploy` npm script.

## Runtime boundary

- A Cron Trigger asks the Worker to refresh every five minutes.
- The global stop returns before reading any source Secret, calling Gluroo, or writing KV.
- A disabled source is skipped before reading that source's Secrets, calling Gluroo, or reading or writing its KV key, even if another source is later enabled.
- An enabled source refresh constructs only its approved Gluroo `/api/v1/entries.json` request in memory.
- Redirects are not followed, upstream time and response size are bounded, and only glucose value, numeric timestamp, and an allowlisted direction are retained.
- The rolling public snapshot covers at most 24 hours and expires from KV after 36 hours without a successful refresh.
- Once a reviewed source route is deployed and enabled, public visitors read only its source-specific KV snapshot and never cause a Gluroo request or receive a Gluroo URL or API Secret. Production currently has only the stopped `/v1/libre` route; `/v1/dexcom-g7` remains local and unavailable.
- A stale snapshot may remain visible with a stale flag so the page can explain that updates stopped without implying that a CGM stopped.

The feed is public by design. CORS limits normal browser embedding to the GlucoScope GitHub Pages origin but is not an authentication boundary. Anyone who can reach the public endpoint may read the published snapshot.

## Local verification

```bash
npm install
npm run types
npm run types:check
npm run verify
npm run deploy:dry
```

The generated `worker-configuration.d.ts` is a local validation artifact and is ignored because this Worker is implemented in JavaScript. No Cloudflare resource is created and no production state changes during those local checks.

## Approval-gated production sequence

Each change below requires a separate explicit approval:

1. Completed: create one dedicated, empty KV namespace after explicit approval.
2. Completed: replace the placeholder namespace id in `wrangler.jsonc` with that reviewed id.
3. Completed: create the stopped Worker with `DEMO_FEED_ENABLED=false`.
4. Completed after separate explicit approval: register exactly the two required Secret values interactively without printing or copying them into commands.
5. Completed after registration: verify stopped GET, the two Secret names, Cron no-op behavior, empty KV, KV binding, and 100% traffic to the stopped Version.
6. Completed after explicit approval: set the comparison frontend to the stopped Worker endpoint and verify the labelled synthetic fallback in a browser. PR #14 later merged this preparation to `main`, and GitHub Pages publication was verified on 2026-08-07.
7. Completed after explicit approval: verify the normal `workers.dev` route is enabled and Preview routing is disabled with `previews_enabled=false`.
8. Completed locally only: prepare the source-specific G7 gates, Secret names, KV key, and `/v1/dexcom-g7` route with every checked-in enable flag set to `false`. No Cloudflare state changed.
9. Completed on 2026-08-07: record separate explicit consent for Kazuma's G7 glucose values and measurement/update timing.
10. Completed after separate explicit approval: register only the two G7 Secret values as unpublished Secret-only Versions, without deploying or shifting traffic. Masked input was used; no value entered command arguments, captured output, or Git, and temporary registration logs were removed after verification.
11. After separate explicit approval, deploy the reviewed multi-source revision with the global and both source gates still `false`. Do not combine this stopped deployment with live enablement.
12. Verify the stopped G7 GET, approved-origin CORS and preflight, unapproved-origin rejection, Secret names, bindings, absent G7 KV value, and Cron exit before G7 Secret access or KV access.
13. After another separate explicit approval, enable only the intended source. Confirm one scheduled refresh, inspect only the sanitized public response, and verify that all Gluroo URLs and API Secrets are absent.
14. Keep the general-user Limited Data Relay paused unless it receives its own separate approval.

If Gluroo objects, terms materially change, unexpected data appears, abnormal traffic is detected, or Kazuma no longer wants the data public, disable the affected source or restore `DEMO_FEED_ENABLED=false` immediately and remove only the affected KV snapshot.
