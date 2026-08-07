# 3CGM Comparison Demo 0.3

## Purpose

The 3CGM Comparison Lab prepares a public observation page for Guardian 4, FreeStyle Libre 2, and Dexcom G7 worn by Kazuma during the same period.

It is not an accuracy study, a clinical evaluation, a device ranking, a reference-CGM experiment, or a treatment-decision tool. No device is treated as the correct value. The page observes display differences, recording cadence, and missing points without deciding which CGM is better.

## Current public-live plan

On 2026-08-06, Kazuma explicitly chose to publish his own Libre glucose values and update timing as part of the public demo. This is a deliberate public-data choice for Kazuma's data only. It does not authorize storing, publishing, or re-sharing data from general users.

On 2026-08-07, one separately approved Libre-only scheduled public-demo Worker retrieval and sanitized public response were verified. The Worker was returned immediately to its stopped Version. GitHub Pages browser rendering, repeated refreshes, stale/fallback/natural-expiry behavior, continuing enablement, and the simultaneous three-source path remain unverified.

On 2026-08-07, Kazuma confirmed that Dexcom G7 readings appear in Gluroo and that the G7 connection details are prepared. He then separately and explicitly chose to publish his own G7 glucose values and measurement/update timing through the public comparison. One approved G7-only scheduled retrieval, source-specific KV key creation, and sanitized public Worker response have now been verified. The Worker was returned immediately to its stopped Version. Frontend activation, GitHub Pages browser rendering, simultaneous three-source comparison, repeated refreshes, and the full public-page end-to-end path remain unverified. The choice applies only to Kazuma's own G7 demo data and does not authorize any general-user data use.

```text
Guardian 4 -> Kazuma Azure Nightscout -> comparison page (browser direct)
Libre 2   -> LibreLinkUp -> Gluroo -> one verified demo-feed refresh and public Worker response -> currently paused
Dexcom G7 -> Gluroo -> one verified demo-feed refresh and public Worker response -> stopped frontend URL configured with verification gate false; Pages check pending
```

The public comparison page uses Guardian and Libre when both live routes are available. Dexcom remains visibly marked as preparing until its frontend activation and public-page path are separately approved and verified, and it has no fabricated live series. If live loading is unavailable, the page falls back to the checked-in synthetic dataset and labels that state clearly.

This architecture does not use or enable the general-user Limited Data Relay. That relay remains paused with `RELAY_ENABLED=false`, and its no-storage boundary remains unchanged.

## Dedicated demo-feed Worker

`workers/gluco-demo-feed/` is a separate, multi-source Worker prepared for Kazuma's demo data. Publication consent has been recorded separately for Kazuma's Libre and G7 values. Both sources have completed one temporary live Worker check and both source routes are currently returned to the reviewed stopped revision. Public visitors read only sanitized, source-specific KV snapshots from routes that have been separately enabled; they never cause a direct request to Gluroo.

The Worker:

- accepts one fixed Gluroo Global Connect hostname per source under `.ns.gluroo.com` and only the `/api/v1/entries.json` path;
- keeps the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET`, and the newly declared G7 `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`, as Cloudflare Secret names only; values remain outside frontend code and Git;
- refreshes on a five-minute scheduled trigger rather than per page view;
- requests at most the last 24 hours of glucose entries;
- stores only `sgv`, measurement time, and an allowlisted direction under separate KV keys: `public:libre-2:v1` and `public:dexcom-g7:v1`;
- replaces the snapshot atomically after a complete, validated response;
- expires KV data after 36 hours and describes data older than 15 minutes as delayed;
- serves stopped `GET /v1/libre` and `GET /v1/dexcom-g7` routes with the approved GitHub Pages browser origin;
- has no application logging and has Cloudflare Worker observability disabled;
- has a checked-in global emergency stop, `DEMO_FEED_ENABLED=false`, plus the source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`.

After explicit approval on 2026-08-06, one dedicated `DEMO_FEED_CACHE` KV namespace was created and its non-secret identifier replaced the local placeholder. A second explicit approval created the stopped `glucoscope-demo-feed` Worker as Version `4c8d40de-8877-4d70-800e-1607e1940b96` at `https://glucoscope-demo-feed.afterglow21.workers.dev`, with `DEMO_FEED_ENABLED=false`, the reviewed KV binding, a five-minute no-op Cron Trigger, and observability disabled. A later explicit approval registered exactly the existing Libre Secret values for `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` without exposing them in terminal output, logs, or Git. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`; at that stage, it received 100% of traffic with `DEMO_FEED_ENABLED=false`, the approved-origin endpoint returned `503 demo_feed_paused`, and the namespace remained empty. Cloudflare's route-level subdomain API reports `enabled=true` and `previews_enabled=false`; the version-level `has_preview=true` capability metadata does not mean the public Preview route is enabled.

After another explicit approval, the frontend configuration was set to the stopped `/v1/libre` route and the labelled synthetic fallback was verified locally. PR #14 merged that frontend preparation to `main` in merge commit `7e96648c27ce20fabe2f283c384124e36ce0b2d2`. After the official GitHub Pages deployment-lag incident was mitigated, workflow run `31114013927` attempt 2 published the comparison page on 2026-08-07. The public URL loaded with the clearly labelled `準備中 · 合成データ` fallback and all three device cards.

The multi-source G7 revision declares the two G7 Secret names, a separate `public:dexcom-g7:v1` KV key, the stopped `/v1/dexcom-g7` route, and global plus source-specific gates, all checked in as `false`. After separate explicit approval on 2026-08-07, both G7 Secret values were entered through masked prompts with `wrangler versions secret put`. This created unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. After another separate approval, reviewed multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` inherited exactly the four Libre/G7 Secret names and was deployed to 100% of production traffic with `DEMO_FEED_ENABLED=false`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=false`. Both source routes returned `503 demo_feed_paused`; approved-origin G7 preflight returned `204`, an unapproved Origin returned `403`, and the KV remained empty after the next five-minute Cron boundary. Secret values were not placed in command arguments, captured output, or Git. During that stopped-deployment check, no live Gluroo retrieval, G7 KV write, or frontend G7 activation occurred. Every additional enablement mutation requires a separate explicit confirmation.

After another separate approval on 2026-08-07, temporary G7-only Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100% through deployment `5b7a0099-9425-4ddf-a500-68e2ed834ea5`, with `DEMO_FEED_ENABLED=true`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=true`. One scheduled refresh created `public:dexcom-g7:v1`. The raw KV value was not read directly. Instead, the public `/v1/dexcom-g7` response was structurally validated: exactly 190 entries; only the reviewed top-level fields; entries containing only `sgv`, numeric `date`, and optional allowlisted `direction`; valid types and bounds; strictly increasing measurement times; a recent update marker; exact approved-origin CORS; and no reviewed private markers. The validation output retained only aggregate and schema results. No Secret value, Gluroo URL, glucose value, or measurement timestamp was printed or added to Git. Libre remained paused with `503`, approved-origin G7 preflight returned `204`, and an unapproved Origin returned `403`.

Immediately afterward, deployment `8de64190-7558-43c6-83c1-1e29a2cf80de` restored stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` to 100% traffic with all three gates `false`. Both source routes again return `503`. At 04:46 UTC, after the 04:45 UTC Cron boundary, KV metadata still listed only `public:dexcom-g7:v1` and its expiration was unchanged. This confirms that the stopped Cron did not refresh the snapshot or extend its lifetime. The retained key is not served while the route is paused and will expire under its existing 36-hour TTL. At that checkpoint the G7 frontend endpoint was blank and `dexcomRouteVerified=false`; the working frontend now configures the stopped G7 URL with the verification gate still `false`, and its Pages fallback check remains pending until publication.

## First Libre-only scheduled acceptance

After another separate explicit approval on 2026-08-07, temporary Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was deployed for one scheduled refresh. The 19:25 JST Cron produced a public `/v1/libre` response containing 523 entries. Aggregate-only validation passed the reviewed top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. G7 remained paused at `503` throughout the check.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored, and both `/v1/libre` and `/v1/dexcom-g7` again returned `503`. The next stopped Cron did not extend the Libre snapshot expiration. This verifies one Libre scheduled retrieval and sanitized public Worker response only. It does not verify GitHub Pages browser rendering, simultaneous three-source comparison, repeated refreshes, stale/fallback/natural-expiry behavior, or continuing enablement.

The working frontend now configures the stopped G7 URL with `dexcomRouteVerified=false`. GitHub Pages verification of that stopped configuration remains pending until the frontend change is published.

## Current route verification

- Guardian 4 through Kazuma's existing Azure Nightscout has completed its basic browser connection check and supplies the separately verified Guardian route. The combined comparison page remains synthetic while the required public-demo feeds are paused.
- FreeStyle Libre 2 completed its first basic end-to-end check on 2026-08-06 through FreeStyle LibreLink, LibreLinkUp, Gluroo, the temporarily enabled Limited Data Relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed. Separately, the dedicated public feed completed one scheduled Worker retrieval and sanitized public-response check and was returned to the stopped Version. GitHub Pages browser rendering and continuing enablement remain unverified.
- Dexcom G7 readings are confirmed in Gluroo, and one scheduled public-demo Worker retrieval, source-specific KV key creation, and sanitized Worker response have passed. The route is currently paused. The working frontend configures its stopped URL with `dexcomRouteVerified=false`, but the Pages fallback check remains pending until publication. G7 must not yet be described as live in the public comparison page or generally supported through the limited relay.

## Public comparison behavior

`demos/cgm-comparison/` supports two explicit runtime states:

- `live`: Guardian and Libre contain current public readings; Dexcom may be `pending` with no readings;
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
14. Completed after the stopped restore: verify both source routes return `503`, the next stopped Cron does not extend the retained G7 key expiry, and, at that checkpoint, the frontend still had `dexcomFeedEndpoint: ""` with `dexcomRouteVerified: false`. The working frontend now configures the stopped G7 URL while keeping the verification gate `false`; its Pages fallback check is gate 17.
15. Completed after separate explicit approval on 2026-08-07: deploy Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` for the 19:25 JST Cron, verify the aggregate 523-entry sanitized public response, reviewed schema/type/range/order/recency/private-marker/CORS boundaries, and G7 isolation at `503`, then restore stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`.
16. Completed after the Libre restore: verify both source routes return `503` and the next stopped Cron does not extend the Libre snapshot expiration.
17. Current: publish the configured stopped G7 endpoint with `dexcomRouteVerified=false`, then verify the synthetic fallback on GitHub Pages. Full G7 frontend activation, simultaneous three-source display, repeated refreshes, stale/fallback/natural-expiry behavior, and continuing enablement remain separate checks.
18. Return the affected source or the entire Worker to the stopped state immediately if a privacy, traffic, terms, or data-quality concern appears.

---

Understand today. Improve tomorrow. 🍀
