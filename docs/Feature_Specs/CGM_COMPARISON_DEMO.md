# 3CGM Comparison Demo 0.3

## Purpose

The 3CGM Comparison Lab prepares a public observation page for Guardian 4, FreeStyle Libre 2, and Dexcom G7 worn by Kazuma during the same period.

It is not an accuracy study, a clinical evaluation, a device ranking, a reference-CGM experiment, or a treatment-decision tool. No device is treated as the correct value. The page observes display differences, recording cadence, and missing points without deciding which CGM is better.

## Current public-live plan

On 2026-08-06, Kazuma explicitly chose to publish his own Libre glucose values and update timing as part of the public demo. This is a deliberate public-data choice for Kazuma's data only. It does not authorize storing, publishing, or re-sharing data from general users.

On 2026-08-07, Kazuma confirmed that Dexcom G7 readings appear in Gluroo and that the G7 connection details are prepared. He then separately and explicitly chose to publish his own G7 glucose values and measurement/update timing through the public comparison. The stopped public Worker route is now deployed and verified, but scheduled live retrieval, a populated G7 KV snapshot, and frontend activation remain unverified; no G7 glucose value has been written to the demo KV or published by GlucoScope. The choice applies only to Kazuma's own G7 demo data and does not authorize any general-user data use.

```text
Guardian 4 -> Kazuma Azure Nightscout -> comparison page (browser direct)
Libre 2   -> LibreLinkUp -> Gluroo -> dedicated demo-feed Worker -> expiring KV -> comparison page
Dexcom G7 -> Gluroo confirmed -> deployed stopped demo-feed source slot -> no public data
```

The public comparison page uses Guardian and Libre when both live routes are available. Dexcom remains visibly marked as preparing until its scheduled retrieval, KV snapshot, frontend, and live-data path are separately verified, and it has no fabricated live series. If live loading is unavailable, the page falls back to the checked-in synthetic dataset and labels that state clearly.

This architecture does not use or enable the general-user Limited Data Relay. That relay remains paused with `RELAY_ENABLED=false`, and its no-storage boundary remains unchanged.

## Dedicated demo-feed Worker

`workers/gluco-demo-feed/` is a separate, multi-source Worker prepared for Kazuma's demo data. Publication consent has been recorded separately for Kazuma's Libre and G7 values. Both source routes are deployed only in the reviewed stopped revision; neither source is enabled. Public visitors read only sanitized, source-specific KV snapshots from routes that have been separately enabled; they never cause a direct request to Gluroo.

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

The multi-source G7 revision declares the two G7 Secret names, a separate `public:dexcom-g7:v1` KV key, the stopped `/v1/dexcom-g7` route, and global plus source-specific gates, all checked in as `false`. After separate explicit approval on 2026-08-07, both G7 Secret values were entered through masked prompts with `wrangler versions secret put`. This created unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. After another separate approval, reviewed multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` inherited exactly the four Libre/G7 Secret names and was deployed to 100% of production traffic with `DEMO_FEED_ENABLED=false`, `DEMO_LIBRE_FEED_ENABLED=false`, and `DEMO_G7_FEED_ENABLED=false`. Both source routes return `503 demo_feed_paused`; approved-origin G7 preflight returns `204`, an unapproved Origin returns `403`, and the KV remained empty after the next five-minute Cron boundary. Secret values were not placed in command arguments, captured output, or Git. No live Gluroo retrieval, G7 KV write, or frontend G7 activation occurred. Every additional enablement mutation requires a separate explicit confirmation.

## Current route verification

- Guardian 4 through Kazuma's existing Azure Nightscout has completed its basic browser connection check and already powers the public demo.
- FreeStyle Libre 2 completed its first basic end-to-end check on 2026-08-06 through FreeStyle LibreLink, LibreLinkUp, Gluroo, the temporarily enabled Limited Data Relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed. The new dedicated public feed is deployed in its stopped state and has its two required Secrets, but it is not yet enabled or verified with live Gluroo data.
- Dexcom G7 readings are confirmed in Gluroo and its connection details are prepared. Its stopped public Worker route is deployed and verified, but scheduled live retrieval, a populated G7 KV snapshot, and frontend activation remain unverified; G7 must not be described as publicly supported or live.

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
13. After another separate explicit approval, verify that the sanitized public response contains only the allowlisted fields and that the page labels Guardian, Libre, and pending Dexcom honestly before considering a G7 frontend activation.
14. Return the affected source or the entire Worker to the stopped state immediately if a privacy, traffic, terms, or data-quality concern appears.

---

Understand today. Improve tomorrow. 🍀
