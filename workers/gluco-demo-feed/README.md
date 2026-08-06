# GlucoScope Public Demo Feed

This Worker is a public-demo-only feed for glucose data that Kazuma has explicitly chosen to publish. It is separate from the general-user Limited Data Relay.

The initial route is FreeStyle Libre 2 through Gluroo Global Connect:

```text
FreeStyle LibreLink
        -> LibreLinkUp
        -> Gluroo Global Connect
        -> scheduled demo-feed Worker
        -> expiring KV snapshot
        -> public 3CGM Comparison Lab
```

## Checked-in safety state

- `DEMO_FEED_ENABLED=false`.
- The dedicated `DEMO_FEED_CACHE` KV namespace was created after explicit approval on 2026-08-06, and its non-secret namespace id is recorded in `wrangler.jsonc`. The namespace remains empty.
- After a second explicit approval, stopped Version `4c8d40de-8877-4d70-800e-1607e1940b96` was deployed to `https://glucoscope-demo-feed.afterglow21.workers.dev`. A later explicit approval registered exactly `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`, which now receives 100% of traffic. The five-minute Cron is present but exits while disabled, before Secret access, upstream fetch, or KV write.
- The two Secret values remain Cloudflare-only. They must never enter Git, terminal arguments, screenshots, logs, fixtures, or support messages.
- Observability is disabled to reduce health-data logging. Cloudflare's route-level subdomain API reports `enabled=true` and `previews_enabled=false`; version-level `has_preview` metadata does not mean the public Preview route is enabled.
- There is intentionally no real `deploy` npm script.

## Runtime boundary

- A Cron Trigger asks the Worker to refresh every five minutes.
- A disabled Worker returns before reading Secrets, calling Gluroo, or writing KV.
- An enabled scheduled refresh constructs only the approved Gluroo `/api/v1/entries.json` request in memory.
- Redirects are not followed, upstream time and response size are bounded, and only glucose value, numeric timestamp, and an allowlisted direction are retained.
- The rolling public snapshot covers at most 24 hours and expires from KV after 36 hours without a successful refresh.
- Public visitors read only the KV snapshot. They never cause a Gluroo request and never receive the Gluroo URL or API Secret.
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
6. Completed after explicit approval: set the comparison frontend to the stopped Worker endpoint and verify the labelled synthetic fallback in a browser. The change is pushed only to `feature/cgm-comparison-demo` and remains outside the public GitHub Pages site until merge to `main` and publication.
7. Completed after explicit approval: verify the normal `workers.dev` route is enabled and Preview routing is disabled with `previews_enabled=false`.
8. After a separate explicit approval, deploy a version with `DEMO_FEED_ENABLED=true`.
9. Confirm one scheduled refresh, inspect only the sanitized public response, and verify that the Gluroo URL and API Secret are absent.
10. Keep the general-user Limited Data Relay paused unless it receives its own separate approval.

If Gluroo objects, terms materially change, unexpected data appears, abnormal traffic is detected, or Kazuma no longer wants the data public, restore `DEMO_FEED_ENABLED=false` immediately and remove the KV snapshot.
