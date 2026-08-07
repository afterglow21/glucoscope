# GlucoScope Public Demo Feed

This Worker is a public-demo-only, multi-source feed for Kazuma's data. It is separate from the general-user Limited Data Relay. Publication consent is recorded separately for Kazuma's public, non-anonymous Libre and G7 glucose values and measurement/update timing. After source-specific checks and one temporary Guardian/Libre/G7 GitHub Pages acceptance, a separate continuing-publication decision started continuous public operation at 22:10:05 JST on 2026-08-07. The frontend keeps `dexcomRouteVerified=true` as a record of the verified G7 display path, but this flag does not enable the Worker. Repeated scheduled aggregate checks, about three hours of continued live operation, and two browser auto-refresh checks at separate checkpoints have passed. This is not an overnight observation. Natural expiry remains a separate, non-blocking stopped/failure-path test because healthy five-minute refreshes reset the 36-hour snapshot TTL.

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
        -> scheduled demo-feed Worker
        -> public:dexcom-g7:v1
        -> continuous public 3CGM comparison
```

## Checked-in safety state

- `DEMO_FEED_ENABLED=false`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=false`.
- The dedicated `DEMO_FEED_CACHE` KV namespace was created after explicit approval on 2026-08-06, and its non-secret namespace id is recorded in `wrangler.jsonc`. It was empty through the initial stopped-deployment checks. Later temporary acceptances created the two source-specific keys. The current live Version refreshes and serves those sanitized keys; stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` remains the immediate rollback target.
- After a second explicit approval, stopped Version `4c8d40de-8877-4d70-800e-1607e1940b96` was deployed to `https://glucoscope-demo-feed.afterglow21.workers.dev`. A later explicit approval registered exactly `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`; it received 100% of traffic at that stage. The five-minute Cron is present but exits while disabled, before Secret access, upstream fetch, or KV write.
- The existing Libre Secret values remain Cloudflare-only. After separate explicit approval on 2026-08-07, the G7 values for `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET` were entered through masked prompts with `wrangler versions secret put`, creating unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. After another separate approval, reviewed multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` inherited exactly the four Libre/G7 Secret names and was deployed to 100% of production traffic with all three feed gates still `false`.
- Secret values must never enter Git, terminal arguments, screenshots, logs, fixtures, or support messages.
- `DEMO_G7_FEED_CACHE_KEY=public:dexcom-g7:v1` is a non-secret, source-specific KV key. Temporary checks first wrote this key without directly reading or printing its raw KV value. The current live Cron refreshes the sanitized snapshot, which expires within 36 hours after the last successful refresh.
- `DEMO_FEED_CACHE_KEY=public:libre-2:v1` is the corresponding non-secret Libre key. Temporary checks produced its sanitized public response without directly reading or printing its raw KV value.
- `GET /v1/libre` and `GET /v1/dexcom-g7` now continuously serve the reviewed sanitized snapshots from deployed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567`. `dexcomRouteVerified=true` records frontend verification only and does not bypass Worker gates.
- Observability is disabled to reduce health-data logging. Cloudflare's route-level subdomain API reports `enabled=true` and `previews_enabled=false`; version-level `has_preview` metadata does not mean the public Preview route is enabled.
- There is intentionally no real `deploy` npm script.

## Runtime boundary

- A Cron Trigger asks the Worker to refresh every five minutes.
- The global stop returns before reading any source Secret, calling Gluroo, or writing KV.
- A disabled source is skipped before reading that source's Secrets, calling Gluroo, or reading or writing its KV key, even if another source is later enabled.
- An enabled source refresh constructs only its approved Gluroo `/api/v1/entries.json` request in memory.
- Redirects are not followed, upstream time and response size are bounded, and only glucose value, numeric timestamp, and an allowlisted direction are retained.
- The rolling public snapshot covers at most 24 hours and expires from KV after 36 hours without a successful refresh.
- Once a reviewed source route is enabled, public visitors read only its source-specific KV snapshot and never cause a Gluroo request or receive a Gluroo URL or API Secret. Production currently routes 100% to the reviewed live Version with both source gates enabled; the five-minute Cron performs the upstream refresh separately from visitor requests.
- A stale snapshot may remain visible with a stale flag so the page can explain that updates stopped without implying that a CGM stopped.

## First G7-only scheduled acceptance

After separate explicit approval on 2026-08-07, temporary Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100% through deployment `5b7a0099-9425-4ddf-a500-68e2ed834ea5`. The global and G7 gates were `true`; the Libre gate remained `false`.

One scheduled refresh created `public:dexcom-g7:v1`. The raw KV value was not read directly. The direct public `/v1/dexcom-g7` response contained 190 entries and passed the reviewed top-level schema, entry-field allowlist, type, range, ordering, recency, CORS, and private-marker checks. Validation output contained only aggregate and schema results. No Secret value, Gluroo URL, glucose value, or measurement timestamp was printed or added to Git. Libre remained paused.

Deployment `8de64190-7558-43c6-83c1-1e29a2cf80de` then restored stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` at 100% with all three gates `false`. At that checkpoint both routes returned `503`. After the next stopped Cron boundary, KV metadata still listed only the G7 key and its expiration was unchanged, so the stopped Cron neither refreshed the snapshot nor extended its lifetime. At that checkpoint the retained key was not served and its expiration remained unchanged. The frontend G7 endpoint was blank and `dexcomRouteVerified=false`; commit `8b0481a` later published the stopped G7 URL with the verification gate still `false`, and its Pages synthetic fallback check passed.

That acceptance verified one G7 scheduled retrieval, source-specific key creation, sanitized public Worker response, and the stopped-endpoint synthetic fallback. At that time it did not verify G7 live frontend activation, simultaneous live three-source comparison, repeated refreshes, stale/expiry behavior, continuing enablement, or the general-user Limited Data Relay G7 path.

## First Libre-only scheduled acceptance

After another separate explicit approval on 2026-08-07, temporary Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was deployed for one scheduled refresh. The 19:25 JST Cron produced a public `/v1/libre` response containing 523 entries. Aggregate-only validation passed the reviewed top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. G7 remained paused at `503` throughout the check.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored. At that checkpoint both `/v1/libre` and `/v1/dexcom-g7` again returned `503`. The next stopped Cron did not extend the Libre snapshot expiration. That acceptance verified one Libre scheduled retrieval and sanitized public Worker response only; at that time it did not verify GitHub Pages browser rendering, simultaneous three-source comparison, repeated refreshes, stale/fallback/natural-expiry behavior, or continuing enablement.

## First simultaneous three-source public-page acceptance

After separate operational approval on 2026-08-07, live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` was deployed at 100% through deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST. The global, Libre, and G7 gates were enabled only for this temporary review window.

The sanitized public responses contained 527 Libre entries and 276 G7 entries. Aggregate-only validation passed the reviewed top-level and entry allowlists, types, ranges, chronological ordering, recency, and exact CORS boundary. No Secret value, Gluroo URL, glucose value, or measurement timestamp was printed or added to Git. GitHub Pages displayed Guardian, Libre, and G7 as live with all three cards enabled, and Kazuma visually confirmed all three plotted lines.

That historical checkpoint recorded one public-page acceptance. The visual-review window crossed scheduled triggers, so it did not claim an exact scheduled-refresh count. Continued operation, repeated browser display refreshes, stale behavior, and natural expiry were still unverified then.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was restored at 100% through deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4` at 21:16:31 JST. Both public routes returned `503`, and a newly opened GitHub Pages view returned to the clearly labelled synthetic dataset. After the 21:25 JST stopped Cron, KV metadata listed only the two expected source keys, carried no metadata payload, and showed unchanged expirations for both keys. This confirms that the stopped Cron did not refresh either snapshot or extend either expiration.

The frontend retains `dexcomRouteVerified=true` because the G7 display path passed this acceptance. That frontend flag is not a Worker enable switch. At this historical checkpoint production was restored to the stopped Version, and the general-user Limited Data Relay remained stopped independently.

The feed is public by design when a source is enabled. CORS limits normal browser embedding to the GlucoScope GitHub Pages origin but is not an authentication boundary. While a source route is enabled, anyone who can reach the public endpoint may read the published snapshot.

## Continuous public operation

Frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published successfully by Pages run `31181233497` before continuing publication began. Deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` assigned 100% of demo-Worker traffic to existing reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` at `2026-08-07T13:10:05Z` (22:10:05 JST). The checked-in global, Libre, and G7 gates remain `false`; only this deployed Version has all three delivery gates enabled. Application logging is absent and Worker observability remains disabled.

After the 22:15 JST Cron, aggregate-only validation observed 528 Libre entries and 290 G7 entries. A second scheduled check observed 526 Libre entries and 290 G7 entries. Both checks returned `200` for both routes with `stale=false`, fresh snapshots and latest readings, exact reviewed source identifiers, and passing schema, field-allowlist, type, range, chronological-order, CORS, cache, and response-size boundaries. No glucose value, exact measurement timestamp, source credential, Gluroo URL, Secret, or token was printed or added to Git.

A new browser session showed `公開デモ · ライブデータ`, three available and selected controls, the three-source chart message, and Guardian, Libre, and G7 cards without an update-delay state. The same tab completed its five-minute automatic refresh with the live state and all three sources preserved; the Libre displayed-point aggregate changed from 526 to 525, and no console error was observed. This historical checkpoint verifies multiple scheduled aggregate checks and one browser auto-refresh.

At about 01:10 JST on 2026-08-08, a read-only continuation check confirmed that deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` and live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` still received 100% of demo-Worker traffic. Both routes returned `200` with aggregate counts of 526 Libre entries and 290 G7 entries. The full reviewed schema, field-allowlist, type, range, chronological-order, freshness, latest-reading, `stale=false`, private-marker, CORS, cache, and response-size checks passed. KV metadata listed exactly the two expected source keys, each with a recent remaining TTL greater than 35 hours and no more than 36 hours 15 minutes. The general-user Limited Data Relay independently remained at `RELAY_ENABLED=false`. No glucose value, exact measurement timestamp, source credential, Gluroo URL, Secret, or token was printed or added to Git.

The existing public browser tab was inspected without reload at about 01:05 JST and again about five minutes later. Both views remained three-source live; the displayed update age moved from about zero to about one minute rather than aging by about five minutes, and the console stayed error-free. Together with the deployment check, this verifies about three hours of continued operation and one further five-minute auto-refresh at a later checkpoint, bringing the total confirmed browser refreshes to two; it is not an overnight observation or evidence of multiple refreshes within this continuation window. Natural expiry is not expected during healthy operation because each successful five-minute refresh resets the 36-hour snapshot TTL. It remains a separate, non-blocking stopped/failure-path acceptance.

The frontend evaluates every source independently from the latest reading or upstream stale state using a 15-minute boundary. A previously live view may be preserved for at most 15 minutes during transient failures and then falls back to clearly labelled synthetic data. The publication is public and non-anonymous and applies only to Kazuma's expressly consented demo data. GlucoScope is not affiliated with Gluroo, the demo is not for medical advice or medical decisions, and Gluroo Global Connect is not marketed as a free alternative to subscription Nightscout services.

Pause the affected source or the entire Worker immediately if Kazuma withdraws consent, Gluroo objects or materially changes applicable terms, unexpected data or abnormal traffic appears, or a privacy or safety concern is found. From this directory, the reviewed rollback is:

```powershell
$env:WRANGLER_WRITE_LOGS='false'; .\node_modules\.bin\wrangler.cmd versions deploy '9994a142-a4ca-4885-9077-952ec8e7e8d2@100%' --yes --message 'Restore stopped public demo feed'
```

The general-user Limited Data Relay remains independently stopped at `RELAY_ENABLED=false` with 100% of its traffic on its stopped Version.

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
11. Completed after separate explicit approval: upload and deploy reviewed multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` with the global and both source gates still `false`.
12. Completed after deployment: verify stopped Libre and G7 GETs, approved-origin CORS and G7 preflight, unapproved-origin rejection, all four Secret names, bindings, absent G7 KV value, and Cron exit before Secret or KV access.
13. Completed after separate explicit approval: enable only G7 for one scheduled refresh, verify the G7 key and sanitized public response without printing values or timestamps, then restore the stopped Version at 100%.
14. Completed after restore: verify both routes are paused and the next stopped Cron does not extend the retained G7 key expiry.
15. Completed after separate explicit approval on 2026-08-07: deploy Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` for the 19:25 JST Cron, verify the aggregate 523-entry sanitized public response, reviewed schema/type/range/order/recency/private-marker/CORS boundaries, and G7 isolation at `503`, then restore stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`.
16. Completed after the Libre restore: verify both source routes return `503` and the next stopped Cron does not extend the Libre snapshot expiration.
17. Completed with commit `8b0481a`: publish the configured stopped G7 URL with `dexcomRouteVerified=false` and verify the synthetic fallback on GitHub Pages.
18. Completed after separate operational approval: deploy temporary live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567`, validate the sanitized Libre and G7 public responses without printing values or timestamps, and verify one simultaneous Guardian/Libre/G7 display on GitHub Pages.
19. Completed immediately afterward: restore stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` through deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4`, verify both routes return `503`, and verify a new page returns to the synthetic fallback.
20. Completed after the next stopped Cron: confirm that both source-key expirations remain unchanged and no snapshot is refreshed.
21. Completed: publish frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` through successful Pages run `31181233497` before continuing publication.
22. Completed after separate continuing-publication approval: deploy reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` to 100% through deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8`, then verify the first post-activation scheduled aggregate check and a new three-source browser session.
23. Completed: verify a second scheduled aggregate-only check and one five-minute browser auto-refresh without exposing glucose values, exact measurement timestamps, credentials, or Secrets.
24. Completed: confirm about three hours of continued live operation, one further five-minute browser auto-refresh at a later checkpoint for two confirmed refreshes in total, the same live Version at 100%, both sanitized routes healthy, and exactly two recently refreshed KV keys without exposing glucose values, exact measurement timestamps, credentials, or Secrets.
25. Current project step: complete the general-user Limited Data Relay period, expiry, deletion, and limit acceptance before any Friends & Family continuing-enablement decision. Keep `RELAY_ENABLED=false` outside separately approved temporary test windows.
26. Non-blocking later: exercise demo-snapshot natural expiry during a deliberately stopped/failure-path window. Healthy five-minute refreshes reset the 36-hour TTL, so natural expiry is not expected during normal continuous operation.

If Gluroo objects, terms materially change, unexpected data appears, abnormal traffic is detected, or Kazuma no longer wants the data public, disable the affected source or restore `DEMO_FEED_ENABLED=false` immediately and remove only the affected KV snapshot.
