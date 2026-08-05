# GlucoScope Limited Data Relay — Phase 3B paused deployment

This directory contains the paused Gluroo-only relay, including its security, access-control, and request-limit boundaries.

Phase 3A connected the user onboarding flow to the relay client while keeping the checked-in endpoint blank. Phase 3B created the stopped Cloudflare Worker shell and Durable Object, registered the required Worker Secrets, and verified the stopped production response. The relay remains unavailable to the frontend and public users.

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

The dry-run binding summary must show the `RELAY_USAGE_COUNTER` Durable Object binding and `RELAY_ENABLED=false`. Wrangler does not print `workers_dev` or observability in that summary, so `workers_dev=false`, the SQLite `exports` declaration, and `observability.enabled=false` are verified from `wrangler.jsonc` and the automated tests.

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

## Deployment boundary

There is intentionally no real `deploy` npm script. The paused shell was uploaded only after explicit approval. The checked-in frontend endpoint remains blank, `workers_dev=false` leaves no active public target, and `RELAY_ENABLED=false` prevents Turnstile verification, ticket issuance, counter consumption, or upstream access.

Permanent routing, frontend endpoint configuration, provider-policy review, Trust Pack completion, real-device tests, and relay enablement require separate review and explicit approval.
