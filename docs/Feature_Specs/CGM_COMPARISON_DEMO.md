# 3CGM Comparison Demo 0.2

## Purpose

The 3CGM Comparison Lab prepares a public observation page for Guardian 4, FreeStyle Libre 2, and Dexcom G7 worn by Kazuma during the same period.

It is not an accuracy study, a clinical evaluation, a device ranking, a reference-CGM experiment, or a treatment-decision tool. No device is treated as the correct value. The page observes display differences, recording cadence, and missing points without deciding which CGM is better.

## Current public-live plan

On 2026-08-06, Kazuma explicitly chose to publish his own Libre glucose values and update timing as part of the public demo. This is a deliberate public-data choice for Kazuma's data only. It does not authorize storing, publishing, or re-sharing data from general users.

```text
Guardian 4 -> Kazuma Azure Nightscout -> comparison page (browser direct)
Libre 2   -> LibreLinkUp -> Gluroo -> dedicated demo-feed Worker -> expiring KV -> comparison page
Dexcom G7 -> prepared source slot; no live route until separately verified
```

The public comparison page uses Guardian and Libre when both live routes are available. Dexcom remains visibly marked as preparing and has no fabricated live series. If live loading is unavailable, the page falls back to the checked-in synthetic dataset and labels that state clearly.

This architecture does not use or enable the general-user Limited Data Relay. That relay remains paused with `RELAY_ENABLED=false`, and its no-storage boundary remains unchanged.

## Dedicated demo-feed Worker

`workers/gluco-demo-feed/` is a separate Worker for Kazuma's intentionally public Libre demo data. Public visitors read only the sanitized KV snapshot; they never cause a direct request to Gluroo.

The Worker:

- accepts only one fixed Gluroo Global Connect hostname under `.ns.gluroo.com` and `/api/v1/entries.json`;
- keeps `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` in Cloudflare Secrets, never frontend code or Git;
- refreshes on a five-minute scheduled trigger rather than per page view;
- requests at most the last 24 hours of glucose entries;
- stores only `sgv`, measurement time, and an allowlisted direction in KV;
- replaces the snapshot atomically after a complete, validated response;
- expires KV data after 36 hours and describes data older than 15 minutes as delayed;
- exposes only `GET /v1/libre` with the approved GitHub Pages browser origin;
- has no application logging and has Cloudflare Worker observability disabled;
- has a checked-in emergency stop, `DEMO_FEED_ENABLED=false`.

After explicit approval on 2026-08-06, one dedicated `DEMO_FEED_CACHE` KV namespace was created and its non-secret identifier replaced the local placeholder. A second explicit approval created the stopped `glucoscope-demo-feed` Worker as Version `4c8d40de-8877-4d70-800e-1607e1940b96` at `https://glucoscope-demo-feed.afterglow21.workers.dev`, with `DEMO_FEED_ENABLED=false`, the reviewed KV binding, a five-minute no-op Cron Trigger, and observability disabled. A later explicit approval registered exactly `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets without exposing their values in terminal output, logs, or Git. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`, which now receives 100% of traffic with `DEMO_FEED_ENABLED=false`. The approved-origin endpoint returns `503 demo_feed_paused`, and the namespace remains empty. Cloudflare's route-level subdomain API reports `enabled=true` and `previews_enabled=false`; the version-level `has_preview=true` capability metadata does not mean the public Preview route is enabled. After another explicit approval, the local frontend configuration was set to the stopped `/v1/libre` route, and the labelled synthetic fallback was verified in a browser. No Gluroo upstream request, KV write, live scheduled retrieval, or live glucose publication is enabled. The frontend change is pushed only to `feature/cgm-comparison-demo` and remains outside the public GitHub Pages site until merge to `main` and publication. Every additional Cloudflare mutation requires a separate explicit confirmation.

## Current route verification

- Guardian 4 through Kazuma's existing Azure Nightscout has completed its basic browser connection check and already powers the public demo.
- FreeStyle Libre 2 completed its first basic end-to-end check on 2026-08-06 through FreeStyle LibreLink, LibreLinkUp, Gluroo, the temporarily enabled Limited Data Relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed. The new dedicated public feed is deployed in its stopped state and has its two required Secrets, but it is not yet enabled or verified with live Gluroo data.
- Dexcom G7 remains unverified and must not be described as supported beyond its prepared source slot.

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
8. Verify that the public response contains only the allowlisted fields and that the page labels Guardian, Libre, and pending Dexcom honestly.
9. Return the Worker to the stopped state immediately if a privacy, traffic, terms, or data-quality concern appears.

---

Understand today. Improve tomorrow. 🍀
