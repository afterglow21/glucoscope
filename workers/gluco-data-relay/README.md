# GlucoScope Limited Data Relay — Phase 2

This directory contains the paused Gluroo-only relay security and access-control skeleton.

Phase 2 is intentionally not connected to the GlucoScope frontend and must not be deployed to production yet.

## Added in Phase 2

- `POST /v1/session` verifies a Cloudflare Turnstile token server-side;
- successful verification issues a signed, origin-bound, one-hour relay ticket;
- `POST /v1/entries` requires a valid relay ticket;
- a SQLite-backed Durable Object stores daily counters only;
- per-session and Worker-wide request limits fail closed;
- the checked-in kill switch remains `RELAY_ENABLED=false`;
- Workers Logs remain disabled.

The Durable Object stores only a UTC day bucket and a request count. It does not store Gluroo URLs, credentials, glucose values, entry timestamps, response bodies, IP addresses, or AI content.

## Secrets required later

The following must be Cloudflare Worker Secrets and must never be placed in `wrangler.jsonc`, `.env`, `.dev.vars` committed to Git, screenshots, or support messages:

```text
TURNSTILE_SECRET_KEY
RELAY_TICKET_SECRET
```

`RELAY_TICKET_SECRET` should be a new random value of at least 32 characters used only by this Worker.

## Local verification

```powershell
cd workers/gluco-data-relay
npm install
npm run verify
npm run deploy:dry
```

The dry run must show the `RELAY_USAGE_COUNTER` Durable Object binding, SQLite storage export, `RELAY_ENABLED=false`, `workers_dev=false`, and observability disabled.

## Deployment boundary

There is still no `deploy` npm script. A real deployment requires frontend disclosure, Turnstile widget integration, provider-policy review, Trust Pack updates, real-device tests, and explicit production approval.
