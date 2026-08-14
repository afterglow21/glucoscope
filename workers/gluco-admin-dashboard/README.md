# GlucoScope administrator dashboard Worker

Status: a fail-closed bootstrap shell is deployed, but Cloudflare Access and the real administrator identity are not configured. The dashboard remains unavailable and is not linked from the public site.

This dedicated Cloudflare Worker renders the first read-only administrator view for the minimal device-profile usage foundation. It is deliberately separate from the public GitHub Pages site, the existing public AI Usage Dashboard, and the public Usage Worker API.

## Fail-closed bootstrap checkpoint — 2026-08-14

Version `ecdf08e7-84d6-439a-83bd-96f03986f87b` created the dedicated Worker hostname only. The checked-in team-domain and audience placeholders remain in that Version, and its temporary bootstrap identity does not match any real administrator. Every request therefore returns the same generic `403` before D1 is read. The before/after count check remained `0 / 0 / 0` for `profiles`, `usage_daily`, and `event_receipts`, with no rows written. Cloudflare Access is not yet configured, so this Version is not an accepted administrator dashboard and must not be treated as available.

## Fixed safety boundary

- Cloudflare Access must protect the whole Worker hostname with a deny-by-default policy for one exact administrator email.
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

## External configuration required before acceptance

The bootstrap shell above is intentionally unusable. Do not accept or use the dashboard until the administrator has approved and completed every item below.

1. Choose one exact administrator email. Register it interactively as the `ADMIN_ALLOWED_EMAIL` Worker Secret; never put the address in Git or a command argument.
2. Create or select a Cloudflare Access organization and identity method. Prefer an existing identity provider with MFA. Email one-time PIN may be used for the initial single-administrator rollout.
3. Create a self-hosted Access application for the entire dedicated Worker hostname. Use a deny-by-default Allow policy containing only the same exact email. Do not use `Everyone`, a whole email domain, or `Login Methods: One-time PIN` as the Allow selector.
4. Copy the Access team domain into `TEAM_DOMAIN` and the application's immutable Audience tag into `POLICY_AUD`. They are configuration values, not credentials. The checked-in placeholders intentionally fail closed.
5. Keep `preview_urls=false`. A protected `glucoscope-admin-dashboard.<account>.workers.dev` hostname is the smallest first deployment; a dedicated custom domain is preferred before broader operational use.
6. Bind the existing `glucoscope-usage` D1 database as `USAGE_DB`. Do not create or apply a migration from this Worker.
7. Enable Cloudflare Access on the Worker before accepting it. Because the Worker also validates the JWT, an unprotected or misrouted request still receives `403` and no data.

Recommended browser-only hardening for the Access application: short session duration, HttpOnly cookies, and the optional Access binding cookie if no incompatible product is enabled on the dedicated hostname.

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

## Rollback

Disable the dedicated administrator Worker route or route traffic back to its last reviewed stopped/unavailable Version. This must not change the existing Usage Worker or delete D1 data.
