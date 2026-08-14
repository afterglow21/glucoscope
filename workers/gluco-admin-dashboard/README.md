# GlucoScope administrator dashboard Worker

Status: production deployed on 2026-08-14 JST / one-administrator browser acceptance completed on 2026-08-15 JST / not linked from the public site

This dedicated Cloudflare Worker renders the first read-only administrator view for the minimal device-profile usage foundation. It is deliberately separate from the public GitHub Pages site, the existing public AI Usage Dashboard, and the public Usage Worker API.

## One-administrator production checkpoint — 2026-08-14 to 2026-08-15

Version `d17e89e9-bc15-40fb-90a0-2e85cb19cf42` was deployed through deployment `392fb7b5-792c-4990-b939-6ab97481beb1` on 2026-08-14 JST. Cloudflare Access protects the dedicated hostname for one exact administrator email, and the Worker independently rechecks the signed Access JWT and the same email held in a Secret before any D1 read. Authenticated browser acceptance completed on 2026-08-15 JST: an unauthenticated request received a `302` to Access, the allowed administrator reached the server-rendered read-only empty state, query strings and unknown paths returned `404`, and the page loaded no scripts, images, or external links. The public site remains unlinked.

## Fixed safety boundary

- Cloudflare Access protects the whole Worker hostname with a deny-by-default policy for one exact administrator email.
- The Worker independently validates the signed `Cf-Access-Jwt-Assertion` header with `jose`, including the Access issuer, application audience, expiry, required issued-at claim, and RS256 signature.
- The signed JWT email must also equal the `ADMIN_ALLOWED_EMAIL` Worker Secret. This second check fails closed if an Access policy is accidentally broadened.
- The HTML is rendered on the server. There is no browser-side data API, script, analytics beacon, export, search, profile action, or write route.
- The only production SQL statement is a fixed `SELECT` from `admin_device_usage`.
- The response includes only display name, collection state, active-day count, new successful AI-generation count, and ordinary Gluco-memory count.
- Profile IDs, bearer tokens and hashes, created/last-seen times, daily rows, glucose data, AI-letter contents, CGM details, and connection information are not selected or rendered.
- Every response is `no-store`, disallows framing and referrers, uses a restrictive Content Security Policy, and sends `X-Robots-Tag: noindex, nofollow, noarchive`.
- Device profiles are presented as responsive cards that remain readable in one column at 320px. The page has a manual refresh link and shows only the server-render time in JST; no profile timestamp is selected or returned.
- Application and invocation logging remain disabled. Do not add display names or production rows to logs, screenshots, fixtures, Git, or support messages.

The D1 binding itself does not expose a read-only permission setting. Least privilege is therefore enforced by using a separate Worker, omitting every mutation route, keeping exactly one fixed `SELECT`, and testing that no write SQL exists. The existing Usage Worker, D1 schema, collection switch, and public frontend do not need to change for this initial dashboard.

## Local verification

```powershell
npm install
npm run verify
npm run types
npm run types:check
npm run deploy:dry
```

The test suite uses a local RSA key and a local JWKS to exercise real `jose` signature, issuer, audience, time, and email checks without contacting Cloudflare.

There is intentionally no `deploy` script.

## Production configuration baseline

The accepted initial deployment uses the following baseline. Keep every item in place unless a separately reviewed replacement provides an equal or stronger boundary.

1. One exact administrator email is registered interactively as the `ADMIN_ALLOWED_EMAIL` Worker Secret. Never put the address in Git or a command argument.
2. The initial single-administrator rollout uses email one-time PIN and a 15-minute Access session. Email one-time PIN is not MFA; keep MFA enabled on the administrator's email account and prefer an MFA-capable identity provider before adding administrators or broadening operational use.
3. A self-hosted Access application protects the entire dedicated Worker hostname. Its deny-by-default Allow policy contains only the same exact email. Do not add `Everyone`, a whole email domain, `Login Methods: One-time PIN`, or a Bypass policy as an Allow selector.
4. The Access issuer and immutable application audience are set in Worker configuration. They are configuration values, not credentials, but their live values and Access identifiers are not copied into documentation or operational records.
5. Keep `preview_urls=false`. The initial deployment uses the protected dedicated Worker production URL; prefer a dedicated custom domain before broader operational use.
6. The existing `glucoscope-usage` D1 database is bound as `USAGE_DB`. Do not create or apply a migration from this Worker.
7. Keep Cloudflare Access enabled. Because the Worker also validates the JWT, an unprotected or misrouted request still receives `403` and no data.

The current Access session duration is 15 minutes. Retain browser-only cookie hardening and consider the optional Access binding cookie only if no incompatible product is enabled on the dedicated hostname.

## Production acceptance checklist

- An unauthenticated browser cannot reach the page and is handled by Access.
- The one allowed administrator can authenticate and see the server-rendered page.
- A different valid Access identity receives `403` from the Worker.
- A missing, expired, wrong-issuer, wrong-audience, or forged assertion receives `403`.
- `GET /` is the only request that reads D1. Authenticated `HEAD /` returns the same headers with an empty body and does not read D1. Query strings, other paths, and write methods do not read it.
- All responses retain `Cache-Control: no-store`, `Pragma: no-cache`, no-referrer, no-frame, `X-Robots-Tag: noindex, nofollow, noarchive`, and the restrictive CSP.
- The page source and network panel contain no JSON endpoint, profile ID, timestamp, daily row, script, analytics request, or external asset.
- Before and after the smoke check, the counts in `profiles`, `usage_daily`, and `event_receipts` are unchanged.
- No Secret value, Access token, email address, display name, profile row, or database content is copied into the deployment record.

The 2026-08-15 browser acceptance directly confirmed the unauthenticated Access redirect, the allowed administrator's read-only empty state, `404` handling for a query string and an unknown path, and the absence of scripts, images, and external links. JWT signature, issuer, audience, expiry, required issued-at claim, email, method, header, escaping, and no-write boundaries remain covered by the local acceptance suite. Record the production D1 check only as “row counts unchanged”; never copy the counts or row contents into Git.

## Rollback

Keep Cloudflare Access enabled while disabling the dedicated administrator Worker route or routing traffic back to the reviewed fail-closed Version `ecdf08e7-84d6-439a-83bd-96f03986f87b`. This must not change the existing Usage Worker or delete D1 data.
