# GlucoScope Limited Data Relay — paused deployment and activation boundary

This directory contains the paused Gluroo-only relay, including its security, access-control, and request-limit boundaries.

Phase 3A connected the user onboarding flow to the relay client while keeping the checked-in endpoint blank. Phase 3B created the stopped Cloudflare Worker shell and Durable Object, registered the required Worker Secrets, and verified the stopped production response. The checked-in frontend now points only to the stopped target for acceptance testing and requires explicit consent. The relay remains unavailable for live use.

## Implemented through Phase 3B

- `POST /v1/session` verifies a Cloudflare Turnstile token server-side;
- successful verification issues a signed, origin-bound, one-hour relay ticket;
- `POST /v1/entries` requires a valid relay ticket;
- a SQLite-backed Durable Object stores daily counters only;
- per-session and Worker-wide request limits fail closed;
- the checked-in kill switch remains `RELAY_ENABLED=false`;
- Workers Logs remain disabled.

The Durable Object stores only a UTC day bucket and a request count. It does not store Gluroo URLs, credentials, glucose values, entry timestamps, response bodies, IP addresses, or AI content.

## Production Secret bindings

The following names are registered as Cloudflare Worker Secrets. Their values must never be placed in `wrangler.jsonc`, committed `.env` or `.dev.vars` files, screenshots, deployment records, or support messages:

```text
TURNSTILE_SECRET_KEY
RELAY_TICKET_SECRET
```

`TURNSTILE_SECRET_KEY` uses the existing GlucoScope Turnstile configuration. `RELAY_TICKET_SECRET` is a separately generated random value used only by this Worker.

## Local verification

```powershell
cd workers/gluco-data-relay
npm install
npm run verify
npm run deploy:dry
```

The dry-run binding summary must show the `RELAY_USAGE_COUNTER` Durable Object binding and `RELAY_ENABLED=false`. Wrangler does not print routing, Preview URL, or observability settings in that summary, so `workers_dev=true`, `preview_urls=false`, the SQLite `exports` declaration, and `observability.enabled=false` are verified from `wrangler.jsonc` and the automated tests.

## Phase 3B production verification — 2026-08-05

- `RelayUsageCounter` was created with SQLite storage.
- Both required Secret names were present on the final Worker Version.
- An allowed-origin POST returned `503 relay_temporarily_paused`.
- Allowed-origin preflight returned `204`.
- Wrong-origin and missing-origin requests returned `403`.
- Paused responses returned `Cache-Control: no-store` and `Pragma: no-cache`.
- The temporary `workers.dev` smoke-test target was removed immediately after verification.
- The final stopped/no-target Version ID was `89a2e968-96df-49bb-b8f0-ce631c3b4b32`.
- No Gluroo credential or glucose payload was used during the stopped-state test.

## Pre-activation Cloudflare re-audit — 2026-08-05

- Wrangler `4.118.0` completed a local `deploy --dry-run`; no deployment occurred.
- The current declarative `exports` configuration is valid and keeps `RelayUsageCounter` on Cloudflare's recommended SQLite storage backend. It must not be mixed with the legacy `migrations` flow.
- The Worker uses Web Platform APIs only, so `nodejs_compat` is intentionally not enabled.
- At the time of this pre-activation audit, `workers_dev=false` and the absence of a route or Custom Domain left the uploaded Worker without a public target.
- `observability.enabled=false` is an intentional privacy exception to the general recommendation to enable logs. This relay handles a source URL, credential, requested range, and glucose entries transiently; request or invocation logging could widen that boundary. The source also contains no console logging.
- CORS remains an exact-origin allowlist, originless requests remain disabled, and the upstream destination remains restricted to one Gluroo hostname suffix and one internally constructed entries path.
- The request, upstream response, timeout, entry-count, date-range, session, and Worker-wide limits remain explicit and fail closed.
- No Worker source or Wrangler setting change was required by this re-audit.

## Deployment boundary

There is intentionally no real `deploy` npm script. The stopped `workers.dev` target was created only after explicit approval. The checked-in frontend endpoint is fixed to that target for paused-state acceptance testing, version-specific Preview URLs are disabled, and `RELAY_ENABLED=false` prevents Turnstile verification, ticket issuance, counter consumption, or upstream access.

The Phase 3C public-policy review and stopped-target deployment are complete. A Gluroo response remains welcome, but its absence is not a blocker for a low-volume Friends & Family rollout. GlucoScope must not claim Gluroo approval, endorsement, affiliation, or partnership. Trust Pack completion, applicable real-device tests, any routing change, and live relay enablement still require separate review and explicit approval.

## Permanent stopped target verification — 2026-08-05

- Target: `https://glucoscope-data-relay.afterglow21.workers.dev`
- Version ID: `ea0b8f59-3e9b-4475-b93a-91855834b3ce`
- `workers_dev=true`, `preview_urls=false`, `RELAY_ENABLED=false`, and `observability.enabled=false`.
- Both required Secret names and the SQLite Durable Object binding remained present after deployment.
- Allowed-origin preflight returned `204`; repeated allowed-origin POST requests returned `503 relay_temporarily_paused`; wrong-origin and missing-origin requests returned `403`.
- One Cloudflare `1042` response occurred immediately after deployment and did not reproduce on the subsequent empty-body or repeated JSON-body stopped checks. Live enablement must stop for investigation if it reappears.
- No Gluroo URL, credential, glucose payload, Turnstile token, relay ticket, or Durable Object counter was used.

## Paused frontend acceptance — 2026-08-05

- The checked-in endpoint is exactly the approved `workers.dev` target above; there is no additional route or Preview URL.
- Gluroo requires an unchecked-by-default consent control before any relay request. Missing consent stops in the browser before the Turnstile or Worker request begins.
- The consent and privacy wording was confirmed in the desktop layout and at a 375 × 667 mobile viewport.
- Nightscout hides the relay consent control and retains its direct-connection wording.
- The public target returned `503 relay_temporarily_paused` with `Cache-Control: no-store` during the acceptance check.
- Only placeholder values were used. No real Gluroo URL, credential, glucose payload, relay ticket, or Secret value was entered or printed.

## Safe activation sequence

Each numbered boundary is independently reviewable. Steps 1 through 6 are complete for the approved stopped `workers.dev` target. Do not combine live enablement with any remaining check in one unreviewed operation.

1. Recheck the current Gluroo public materials for material changes or a known provider objection.
2. Confirm that the intended first device route is described according to its actual verification status. Unverified Libre, Dexcom, or other routes must not be advertised as verified.
3. Run `npm run verify`, `npm run deploy:dry`, `git diff --check`, the frontend checks, and a Secret-pattern scan. Confirm that `RELAY_ENABLED=false`, `workers_dev=true`, `preview_urls=false`, `observability.enabled=false`, the SQLite Durable Object export, and the exact CORS origin remain intact.
4. After explicit approval, add only the agreed permanent Cloudflare target. This phase uses the single `workers.dev` target above. Any future Custom Domain or route change requires a separate review and approval.
5. With `RELAY_ENABLED=false`, deploy only after separate explicit approval. Verify allowed-origin preflight, allowed-origin paused response, wrong-origin rejection, no-cache headers, Durable Object binding, and the presence of the two Secret binding names. Never print or copy Secret values into the repository, terminal record, screenshot, or support message.
6. Keep the reviewed Trust wording and explicit consent UI aligned with the checked-in stopped endpoint. Direct Nightscout and the public demo must still work when the relay is paused.
7. Ask for a separate explicit approval before changing `RELAY_ENABLED` to `true` and deploying that change. The first live check must use the person's Global Connect URL and API Secret only in the browser UI, never in commands, logs, screenshots, or test fixtures.
8. Validate current, today, yesterday, 7-day, and 30-day reads for the first advertised route; credential deletion; ticket expiry; session and global limits; and the emergency pause path. Keep the rollout limited to Friends & Family.
9. Immediately restore `RELAY_ENABLED=false` if Gluroo objects, applicable terms materially change, abnormal traffic is detected, or a privacy or safety concern appears.
