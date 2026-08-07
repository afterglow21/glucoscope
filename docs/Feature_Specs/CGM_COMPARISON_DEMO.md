# 3CGM Comparison Demo 0.3

## Purpose

The 3CGM Comparison Lab prepares a public observation page for Guardian 4, FreeStyle Libre 2, and Dexcom G7 worn by Kazuma during the same period.

It is not an accuracy study, a clinical evaluation, a device ranking, a reference-CGM experiment, or a treatment-decision tool. No device is treated as the correct value. The page observes display differences, recording cadence, and missing points without deciding which CGM is better.

## Current public-live plan

On 2026-08-06, Kazuma explicitly chose to publish his own Libre glucose values and update timing as part of the public demo. This is a deliberate public-data choice for Kazuma's data only. It does not authorize storing, publishing, or re-sharing data from general users.

On 2026-08-07, one separately approved Libre-only scheduled public-demo Worker retrieval and sanitized public response were verified. The Worker was returned immediately to its stopped Version. At that checkpoint, GitHub Pages browser rendering, repeated refreshes, stale/fallback/natural-expiry behavior, continuing enablement, and the simultaneous three-source path were unverified.

On 2026-08-07, Kazuma confirmed that Dexcom G7 readings appear in Gluroo and that the G7 connection details are prepared. He then separately and explicitly chose to publish his own G7 glucose values and measurement/update timing through the public comparison. One approved G7-only scheduled retrieval, source-specific KV key creation, and sanitized public Worker response were verified before the Worker was returned to its stopped Version. At that checkpoint, frontend activation and the full public-page end-to-end path were unverified. The choice applies only to Kazuma's own G7 demo data and does not authorize any general-user data use.

Later on 2026-08-07, after separate operational approval, the full Guardian/Libre/G7 public-page path completed one live acceptance. GitHub Pages showed all three sources as live with all three cards enabled, and Kazuma visually confirmed all three plotted lines. The demo Worker was then returned to the stopped Version; both source routes returned `503`, a newly opened page returned to the synthetic fallback, and the next stopped Cron did not extend either source-key expiration. This remains the historical one-time acceptance record.

After frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published successfully by Pages run `31181233497`, Kazuma separately approved continuing publication. Reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` began serving 100% of dedicated demo-Worker traffic through deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` at `2026-08-07T13:10:05Z` (22:10:05 JST). This public and non-anonymous publication applies only to Kazuma's expressly consented Libre and G7 demo data. It does not apply to general-user data.

```text
Guardian 4 -> Kazuma Azure Nightscout -> comparison page (browser direct)
Libre 2   -> LibreLinkUp -> Gluroo -> demo-feed Worker -> continuously published sanitized snapshot
Dexcom G7 -> Gluroo -> demo-feed Worker -> continuously published sanitized snapshot; frontend verification flag true
```

The public comparison page now uses Guardian, Libre, and G7 while their feeds are fresh and the separately reviewed G7 display flag is `true`. `dexcomRouteVerified=true` records the frontend-path acceptance; it does not enable the Worker or bypass its global and source-specific stops. Each source's latest reading or upstream stale state is evaluated independently against a 15-minute freshness boundary. A previously live view may be preserved for at most 15 minutes during a transient failure; after that it falls back to clearly labelled synthetic data. If G7 alone is unavailable while Guardian and Libre are live, G7 remains visibly pending with no fabricated live series.

This architecture does not use or enable the general-user Limited Data Relay. That relay remains paused with `RELAY_ENABLED=false`, and its no-storage boundary remains unchanged.

## Dedicated demo-feed Worker

`workers/gluco-demo-feed/` is a separate, multi-source Worker for Kazuma's demo data. Publication consent has been recorded separately for Kazuma's Libre and G7 values. Both sources completed source-specific checks, one temporary simultaneous public-page acceptance, and the continuing-publication safety gates. Public visitors read only sanitized, source-specific KV snapshots; they never cause a direct request to Gluroo.

The Worker:

- accepts one fixed Gluroo Global Connect hostname per source under `.ns.gluroo.com` and only the `/api/v1/entries.json` path;
- keeps the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET`, and the newly declared G7 `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`, as Cloudflare Secret names only; values remain outside frontend code and Git;
- refreshes on a five-minute scheduled trigger rather than per page view;
- requests at most the last 24 hours of glucose entries;
- stores only `sgv`, measurement time, and an allowlisted direction under separate KV keys: `public:libre-2:v1` and `public:dexcom-g7:v1`;
- replaces the snapshot atomically after a complete, validated response;
- expires KV data after 36 hours and describes data older than 15 minutes as delayed;
- serves `GET /v1/libre` and `GET /v1/dexcom-g7` only while the deployed global and source gates are enabled, with the approved GitHub Pages browser origin;
- has no application logging and has Cloudflare Worker observability disabled;
- has a checked-in global emergency stop, `DEMO_FEED_ENABLED=false`, plus the source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`.

After explicit approval on 2026-08-06, one dedicated `DEMO_FEED_CACHE` KV namespace was created and its non-secret identifier replaced the local placeholder. A second explicit approval created the stopped `glucoscope-demo-feed` Worker as Version `4c8d40de-8877-4d70-800e-1607e1940b96` at `https://glucoscope-demo-feed.afterglow21.workers.dev`, with `DEMO_FEED_ENABLED=false`, the reviewed KV binding, a five-minute no-op Cron Trigger, and observability disabled. A later explicit approval registered exactly the existing Libre Secret values for `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` without exposing them in terminal output, logs, or Git. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`; at that stage, it received 100% of traffic with `DEMO_FEED_ENABLED=false`, the approved-origin endpoint returned `503 demo_feed_paused`, and the namespace remained empty. Cloudflare's route-level subdomain API reports `enabled=true` and `previews_enabled=false`; the version-level `has_preview=true` capability metadata does not mean the public Preview route is enabled.

After another explicit approval, the frontend configuration was set to the stopped `/v1/libre` route and the labelled synthetic fallback was verified locally. PR #14 merged that frontend preparation to `main` in merge commit `7e96648c27ce20fabe2f283c384124e36ce0b2d2`. After the official GitHub Pages deployment-lag incident was mitigated, workflow run `31114013927` attempt 2 published the comparison page on 2026-08-07. The public URL loaded with the clearly labelled `準備中 · 合成データ` fallback and all three device cards.

The multi-source G7 revision declares the two G7 Secret names, a separate `public:dexcom-g7:v1` KV key, the stopped `/v1/dexcom-g7` route, and global plus source-specific gates, all checked in as `false`. After separate explicit approval on 2026-08-07, both G7 Secret values were entered through masked prompts with `wrangler versions secret put`. This created unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. After another separate approval, reviewed multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` inherited exactly the four Libre/G7 Secret names and was deployed to 100% of production traffic with `DEMO_FEED_ENABLED=false`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=false`. Both source routes returned `503 demo_feed_paused`; approved-origin G7 preflight returned `204`, an unapproved Origin returned `403`, and the KV remained empty after the next five-minute Cron boundary. Secret values were not placed in command arguments, captured output, or Git. During that stopped-deployment check, no live Gluroo retrieval, G7 KV write, or frontend G7 activation occurred. Every additional enablement mutation requires a separate explicit confirmation.

After another separate approval on 2026-08-07, temporary G7-only Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100% through deployment `5b7a0099-9425-4ddf-a500-68e2ed834ea5`, with `DEMO_FEED_ENABLED=true`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=true`. One scheduled refresh created `public:dexcom-g7:v1`. The raw KV value was not read directly. Instead, the public `/v1/dexcom-g7` response was structurally validated: exactly 190 entries; only the reviewed top-level fields; entries containing only `sgv`, numeric `date`, and optional allowlisted `direction`; valid types and bounds; strictly increasing measurement times; a recent update marker; exact approved-origin CORS; and no reviewed private markers. The validation output retained only aggregate and schema results. No Secret value, Gluroo URL, glucose value, or measurement timestamp was printed or added to Git. Libre remained paused with `503`, approved-origin G7 preflight returned `204`, and an unapproved Origin returned `403`.

Immediately afterward, deployment `8de64190-7558-43c6-83c1-1e29a2cf80de` restored stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` to 100% traffic with all three gates `false`. At that checkpoint both source routes returned `503`. At 04:46 UTC, after the 04:45 UTC Cron boundary, KV metadata still listed only `public:dexcom-g7:v1` and its expiration was unchanged. This confirmed that the stopped Cron did not refresh the snapshot or extend its lifetime. At that checkpoint the retained key was not served and its expiration remained unchanged. The G7 frontend endpoint was blank and `dexcomRouteVerified=false`; commit `8b0481a` later published the stopped G7 URL with the verification gate still `false`, and its Pages synthetic fallback check passed.

## First Libre-only scheduled acceptance

After another separate explicit approval on 2026-08-07, temporary Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was deployed for one scheduled refresh. The 19:25 JST Cron produced a public `/v1/libre` response containing 523 entries. Aggregate-only validation passed the reviewed top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. G7 remained paused at `503` throughout the check.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored, and both `/v1/libre` and `/v1/dexcom-g7` again returned `503`. The next stopped Cron did not extend the Libre snapshot expiration. This earlier acceptance verified one Libre scheduled retrieval and sanitized public Worker response only; it did not verify simultaneous live three-source comparison, repeated refreshes, stale/natural-expiry behavior, or continuing enablement.

Commit `8b0481a` published the stopped G7 URL with `dexcomRouteVerified=false`. The public GitHub Pages URL returned the new configuration, kept the clearly labelled synthetic fallback, and displayed all three device cards. At that checkpoint, G7 live rendering and the simultaneous three-source end-to-end path were unverified.

## First simultaneous three-source public-page acceptance

After separate operational approval on 2026-08-07, live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` was deployed at 100% through deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST.

The sanitized public responses contained 527 Libre entries and 276 G7 entries. Aggregate-only validation passed the reviewed top-level and entry allowlists, types, ranges, chronological ordering, recency, and exact CORS boundary. No Secret value, Gluroo URL, glucose value, or measurement timestamp was printed or added to Git. GitHub Pages displayed Guardian, Libre, and G7 as live with all three source cards enabled, and Kazuma visually confirmed all three plotted lines.

The visual-review window crossed scheduled triggers, so that historical record did not claim an exact scheduled-refresh count. It verified one public-page acceptance only. Continued operation, repeated browser display refreshes, stale behavior, and natural expiry were still unverified at that checkpoint.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was restored at 100% through deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4` at 21:16:31 JST. Both source routes returned `503`, and a newly opened GitHub Pages view returned to the clearly labelled synthetic dataset. After the 21:25 JST stopped Cron, KV metadata listed only the two expected source keys, carried no metadata payload, and showed unchanged expirations for both keys. This confirms that the stopped Cron did not refresh either snapshot or extend either expiration.

The frontend retains `dexcomRouteVerified=true` as a record of the verified G7 display path. This flag is not a Worker enable switch. The stopped Version remained the production rollback target after this historical acceptance, and the general-user Limited Data Relay remained stopped independently.

## Continuous public operation

Continuous operation began only after safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published by successful Pages run `31181233497`. Deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` assigned 100% of dedicated demo-Worker traffic to reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` at `2026-08-07T13:10:05Z` (22:10:05 JST). The checked-in global, Libre, and G7 gates remain `false`; the reviewed deployed Version alone has the three gates enabled. Application logging remains absent and Worker observability remains disabled.

The first post-activation aggregate-only check, after the 22:15 JST Cron, observed 528 Libre entries and 290 G7 entries. A second scheduled check observed 526 Libre entries and 290 G7 entries. Both checks returned `200` for both routes with `stale=false`, fresh snapshots and latest readings, exact reviewed source identifiers, and passing schema, field-allowlist, type, range, ordering, CORS, cache, and response-size boundaries. No glucose value, exact measurement timestamp, source credential, or Secret value was printed or added to Git.

A new browser session showed `公開デモ · ライブデータ`, three available and selected controls, the three-source chart message, and Guardian, Libre, and G7 cards without a delay state. The same open tab then completed its five-minute automatic refresh: the public-live state, three-source chart message, and all three live controls and cards remained available; the Libre displayed-point aggregate changed from 526 to 525; and no console error was observed. This historical checkpoint verified multiple scheduled aggregate checks and one browser auto-refresh.

At about 01:10 JST on 2026-08-08, a read-only continuation check confirmed that deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` and live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` still received 100% of demo-Worker traffic. Both public source routes returned `200` with aggregate counts of 526 Libre entries and 290 G7 entries. The full reviewed schema, field-allowlist, type, range, chronological-order, freshness, latest-reading, `stale=false`, private-marker, CORS, cache, and response-size checks passed. KV metadata listed exactly the two expected source keys, each with a recent remaining TTL greater than 35 hours and no more than 36 hours 15 minutes. The general-user Limited Data Relay independently remained at `RELAY_ENABLED=false`. No glucose value, exact measurement timestamp, source credential, Gluroo URL, Secret, or token was printed or added to Git.

The existing public browser tab was inspected without reload at about 01:05 JST and again about five minutes later. Both inspections remained in the three-source public-live state; the displayed update age moved from about zero to about one minute rather than aging by about five minutes, and the console remained error-free. Together with the deployment check, this verifies about three hours of continued operation and one further five-minute auto-refresh at a later checkpoint, bringing the total confirmed browser refreshes to two; it must not be described as an overnight observation or as multiple refreshes within this continuation window. Production natural expiry is not expected while operation is healthy because every successful five-minute refresh resets the 36-hour KV TTL. Natural expiry therefore remains a separate, non-blocking stopped/failure-path acceptance rather than a blocker for the current public demo.

This is a public, non-anonymous display of Kazuma's own consented data. GlucoScope is not affiliated with Gluroo, the page is not for medical advice or medical decisions, and Gluroo Global Connect is not marketed as a free alternative to subscription Nightscout services. Pause the affected source or the entire demo immediately if Kazuma withdraws consent, Gluroo objects or materially changes applicable terms, unexpected data or abnormal traffic appears, or a privacy or safety concern is found. From `workers/gluco-demo-feed/`, the reviewed rollback is `$env:WRANGLER_WRITE_LOGS='false'; .\node_modules\.bin\wrangler.cmd versions deploy '9994a142-a4ca-4885-9077-952ec8e7e8d2@100%' --yes --message 'Restore stopped public demo feed'`. The general-user Limited Data Relay remains independently stopped at `RELAY_ENABLED=false`.

## Current route verification

- Guardian 4 through Kazuma's existing Azure Nightscout is live in the continuous public comparison and remained live through two browser auto-refresh checks at separate checkpoints.
- FreeStyle Libre 2 completed its first basic end-to-end check on 2026-08-06 through FreeStyle LibreLink, LibreLinkUp, Gluroo, the temporarily enabled Limited Data Relay, and GlucoScope. Separately, its dedicated public feed is live in the continuous comparison and has passed repeated scheduled aggregate checks, about three hours of continued operation, and two browser auto-refresh checks at separate checkpoints. Natural expiry remains a separate non-blocking stopped/failure-path acceptance.
- Dexcom G7 readings are confirmed in Gluroo. Its dedicated public feed is live in the continuous comparison and has passed repeated scheduled aggregate checks, about three hours of continued operation, and two browser auto-refresh checks at separate checkpoints. The frontend retains `dexcomRouteVerified=true` as a display-path verification record, not as a Worker enable switch. The general-user Limited Data Relay G7 path remains unverified.

## Public comparison behavior

`demos/cgm-comparison/` supports two explicit runtime states:

- `live`: available public readings are shown; the accepted three-source path can show Guardian, Libre, and G7 together, while an unavailable G7 remains `pending` with no readings;
- `synthetic`: the checked-in three-source fallback used while the feed is not configured or cannot be loaded.

The public page:

- shows available series on the same elapsed-time axis;
- allows each available series to be shown or hidden;
- does not interpolate missing points;
- reports only matched-point count, observed display spread, and missing-point count;
- labels those summaries as observations, not accuracy or medical conclusions;
- states the verification and availability status for each route;
- keeps the original CGM and pump applications as the source for alerts and treatment decisions.

## Publication data schema

Schema version 1 contains:

- `status`: `synthetic`, `anonymized`, or `live`;
- duration in elapsed minutes;
- exactly three named CGM sources;
- `dataStatus`: `available` or `pending` for each source;
- a color, public route note, and honest verification label per source;
- ordered `[elapsedMinute, glucoseMgDl]` readings for available sources;
- no readings for a pending source.

The validator rejects URLs, exact calendar dates, private credential or account field names, duplicate or unordered elapsed minutes, implausible values outside the display support boundary, and any dataset that does not contain exactly three sources.

## Static three-source capture remains available

`tools/cgm-comparison-capture/` remains an unlinked, `noindex` browser helper for a later reviewed three-source study snapshot. It uses browser memory only, performs no background polling, loads no analytics, converts exact timestamps to elapsed minutes, and downloads a publication candidate to Kazuma's device. A candidate is not an approved public artifact.

Raw exports, connection details, manufacturer credentials, exact dates, sensor identifiers, treatment information, and unreviewed candidate files must remain out of Git. `private/cgm-comparison/` and `demos/cgm-comparison/data/candidate-*.json` are ignored as an additional accident-prevention layer.

## Activation gates

1. Complete local tests, type generation, configuration validation, and a Wrangler dry run.
2. Completed on 2026-08-06 after explicit approval: create one dedicated, empty KV namespace.
3. Completed: insert only the returned namespace identifier in `wrangler.jsonc`; no Secret value was added.
4. Completed on 2026-08-06 after separate explicit approvals: create and verify the stopped Worker, then register exactly the two required Cloudflare Secrets without exposing their values.
5. Completed after Secret registration: verify the stopped response, two Secret names, bindings, empty KV, and 100% traffic to the stopped Version without retrieving Gluroo data.
6. Completed after explicit approval: verify the normal `workers.dev` route remains enabled and the public Preview route reports `previews_enabled=false`.
7. Completed after explicit approval: configure the local frontend to use the stopped `/v1/libre` route and verify the clearly labelled synthetic fallback in a browser.
8. Completed locally only: prepare the G7 source slot with the new Secret names, separate KV key, `/v1/dexcom-g7`, and all global and per-source gates set to `false`. This step made no Cloudflare change.
9. Completed on 2026-08-07: record separate explicit consent for Kazuma's G7 glucose values and measurement/update timing.
10. Completed after separate explicit approval: register only the two G7 Secret values as unpublished Secret-only Versions without deploying or shifting traffic.
11. Completed after separate explicit approval: deploy reviewed multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` to 100% of production traffic with the global and both source gates still `false`.
12. Completed after deployment: verify stopped Libre and G7 responses, exact CORS and G7 preflight, the four Secret names, bindings, absent G7 KV value, Cron no-op, and 100% traffic without retrieving Gluroo data.
13. Completed after separate explicit approval on 2026-08-07: enable only G7 for one scheduled refresh, verify `public:dexcom-g7:v1`, the sanitized public response, exact CORS, and Libre isolation without printing glucose values or measurement times, then restore stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` at 100%.
14. Completed after the stopped restore: verify both source routes return `503`, the next stopped Cron does not extend the retained G7 key expiry, and, at that checkpoint, the frontend still had `dexcomFeedEndpoint: ""` with `dexcomRouteVerified: false`.
15. Completed after separate explicit approval on 2026-08-07: deploy Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` for the 19:25 JST Cron, verify the aggregate 523-entry sanitized public response, reviewed schema/type/range/order/recency/private-marker/CORS boundaries, and G7 isolation at `503`, then restore stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`.
16. Completed after the Libre restore: verify both source routes return `503` and the next stopped Cron does not extend the Libre snapshot expiration.
17. Completed with commit `8b0481a`: publish the configured stopped G7 endpoint with `dexcomRouteVerified=false` and verify the synthetic fallback on GitHub Pages.
18. Completed after separate operational approval: deploy temporary live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567`, validate the sanitized Libre and G7 public responses without printing values or timestamps, and verify one simultaneous Guardian/Libre/G7 display on GitHub Pages.
19. Completed immediately afterward: restore stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` through deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4`, verify both routes return `503`, and verify a new page returns to the synthetic fallback.
20. Completed after the next stopped Cron: confirm that both source-key expirations remain unchanged and no snapshot is refreshed.
21. Completed: publish frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` through successful Pages run `31181233497` before continuing publication.
22. Completed after separate continuing-publication approval: deploy reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` to 100% through deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8`, then verify the 22:15 JST aggregate-only check and a new three-source browser session.
23. Completed: verify a second scheduled aggregate-only check and one five-minute browser auto-refresh without exposing glucose values, exact measurement timestamps, credentials, or Secrets.
24. Completed: confirm about three hours of continued live operation, one further five-minute browser auto-refresh at a later checkpoint for two confirmed refreshes in total, the same live Version at 100%, both sanitized routes healthy, and exactly two recently refreshed KV keys without exposing glucose values, exact measurement timestamps, credentials, or Secrets.
25. Current project step: complete the general-user Limited Data Relay period, expiry, deletion, and limit acceptance before any Friends & Family continuing-enablement decision. Keep `RELAY_ENABLED=false` outside separately approved temporary test windows.
26. Non-blocking later: exercise demo-snapshot natural expiry during a deliberately stopped/failure-path window. Healthy five-minute refreshes reset the 36-hour TTL, so natural expiry is not expected during normal continuous operation.
27. Return the affected source or the entire Worker to stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` immediately if consent, privacy, traffic, terms, safety, or data-quality conditions require it.

---

Understand today. Improve tomorrow. 🍀
