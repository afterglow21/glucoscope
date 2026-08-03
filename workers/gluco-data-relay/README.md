# GlucoScope Limited Data Relay — Phase 1

This directory contains the security skeleton for the Gluroo-only limited data relay.

Phase 1 is intentionally not connected to the GlucoScope frontend and must not be deployed to production yet.

## Scope

- accepts `POST /v1/entries` only;
- allows HTTPS hosts ending in `.ns.gluroo.com` only;
- constructs `/api/v1/entries.json` internally;
- uses the confirmed Gluroo `token` query authentication;
- rejects redirects;
- limits date range, entry count, request size, response size, and upstream time;
- returns only `sgv`, normalized `date`, normalized `dateString`, and an approved `direction`;
- uses no KV, D1, R2, Durable Objects, Cache API, or AI binding;
- keeps `RELAY_ENABLED=false` and Workers Logs disabled in the checked-in configuration.

## Local verification

```powershell
cd workers/gluco-data-relay
npm install
npm run verify
npm run deploy:dry
```

Do not add Gluroo URLs, tokens, `.dev.vars`, `.env`, screenshots containing credentials, or real glucose payloads to Git.

## Deployment boundary

Phase 1 has no `deploy` npm script. A real deployment requires later phases for Turnstile, signed relay tickets, rate limits, public privacy wording, provider-policy review, and explicit production approval.
