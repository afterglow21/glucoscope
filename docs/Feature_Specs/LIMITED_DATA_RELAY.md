# Limited Data Relay 0.2 Design

## Status

- Paused deployment-verification phase.
- The Worker shell and SQLite Durable Object have been created in Cloudflare, but no public route or target is active.
- The checked-in frontend endpoint remains blank and `RELAY_ENABLED=false`; the relay is not publicly enabled.
- The temporary connectivity probe was deleted after testing.
- User Foundation PR #7 was merged before this work began.
- Development branch: `feature/limited-data-relay`.

## Purpose

Limited Data Relay is a narrowly scoped Cloudflare Worker that allows GlucoScope to read glucose entries from Gluroo Global Connect when browser CORS rules prevent a direct connection.

It is not a general proxy, a Nightscout host, a health-data archive, an AI pipeline, an alert service, or a medical decision system.

## Confirmed supported input routes

The relay has one upstream data source:

```text
Gluroo Global Connect
```

Glucose data can reach Gluroo through the following confirmed or planned input routes.

### Libre route

```text
FreeStyle Libre
        ↓
   LibreLinkUp
        ↓
      Gluroo
        ↓
Gluroo Global Connect
        ↓
Limited Data Relay
        ↓
     GlucoScope
```

### Dexcom route

```text
Dexcom G7
        ↓
  Dexcom Share
        ↓
      Gluroo
        ↓
Gluroo Global Connect
        ↓
Limited Data Relay
        ↓
     GlucoScope
```

### Guardian / MiniMed route — real-device verified

```text
MiniMed / CareLink
        ↓
Guardian Monitor
        ↓ Nightscout upload
Gluroo Global Connect
        ↓
Limited Data Relay
        ↓
     GlucoScope
```

Real-device verification confirmed that:

- Guardian Monitor accepted the Gluroo Global Connect Nightscout URL;
- Guardian Monitor accepted the Gluroo API Secret Token;
- Guardian / MiniMed glucose data appeared in Gluroo;
- multiple readings and a glucose graph appeared after the first upload;
- enabling Guardian Monitor background refresh allowed updates while the app was not open in the foreground;
- Guardian Monitor supports only one Nightscout upload destination at a time.

After verification, Kazuma restored Guardian Monitor to his personal Nightscout destination.

Guardian Monitor is therefore an **input uploader to Gluroo**, not another upstream destination that the relay Worker must support.

## Existing-Nightscout note for Guardian Monitor

Most beginner users are unlikely to already use Guardian Monitor with a personal Nightscout destination. The normal guide should therefore remain simple.

Normal visible guidance:

> Guardian MonitorのNightscout設定に、Gluroo Global ConnectのURLとAPI Secret Tokenを入力します。バックグラウンド更新をONにすると、アプリを開いていない間も更新されやすくなります。

A small conditional note may be shown only when useful:

> すでに別のNightscout URLを設定している場合は、Glurooへ変更すると元の送信先への新しいデータ送信は止まります。

The guide should not lead with this exception or make new users learn what a personal Nightscout environment is.

## Direct Nightscout route

A person who already uses their own Nightscout can continue to connect directly from the browser.

```text
person-managed Nightscout
        ↓ direct browser connection
     GlucoScope
```

This route does not use Limited Data Relay.

## Confirmed Gluroo connectivity proof

A temporary Cloudflare Worker was used to test server-to-server access.

Confirmed result:

- Cloudflare Worker reached Gluroo Global Connect;
- `token-query` authentication succeeded;
- two Nightscout-compatible glucose entries were received;
- result code: `relay_reachable`;
- the temporary Worker was deleted after the test;
- probe code and its access secret were not merged into User Foundation PR #7.

This proves technical reachability only. It does not by itself approve public production use or establish permanent compatibility.

## Privacy-boundary change

User Foundation 0.3.4 states that direct mode reads the data source from the browser and does not send the connection URL or credential to a GlucoScope Worker.

The relay changes that boundary only for the Gluroo route.

When relay mode is used, Cloudflare infrastructure and the relay Worker transiently process:

- the Gluroo Global Connect base URL;
- the Gluroo API Secret Token;
- the requested date range and entry limit;
- the glucose entries required for the selected GlucoScope view;
- minimal anti-abuse and request-limit metadata that does not contain credentials or glucose values.

The relay must not store, cache, log, analyze, or forward those credentials or glucose payloads beyond the immediate response.

Required public explanation:

> Glurooのかんたん接続では、接続に必要な情報と表示する血糖データが、GlucoScopeの中継機能を一時的に通ります。接続情報や血糖データを保存したり、AIへ送ったり、他の利用者と共有したりしません。

Required direct-Nightscout explanation:

> 自分のNightscoutへ直接接続する場合は、接続情報と血糖データはGlucoScopeの中継機能を通りません。

The relay must never be enabled silently after direct access fails. A person must know which route is being used before submitting a credential.

## Non-goals

Version 0.2 does not:

- host Nightscout;
- accept arbitrary destination URLs;
- support arbitrary HTTP methods, paths, headers, or request bodies;
- read directly from CareLink, Guardian Monitor, LibreLinkUp, Dexcom Share, or CGM manufacturer APIs;
- store source URLs, tokens, or glucose entries in KV, D1, R2, Durable Objects, Cache API, logs, or AI cache;
- retrieve treatments, insulin, carbohydrates, medication, pump settings, or device-status data;
- enable user-mode AI letters;
- provide emergency monitoring or alerts;
- guarantee support for every device, region, phone, browser, or future Gluroo version.

## Initial data scope

The first production candidate supports glucose entries only.

Approved upstream endpoint:

```text
/api/v1/entries.json
```

The browser sends a semantic request. It does not choose an arbitrary upstream path or query string.

Example request:

```json
{
  "sourceUrl": "https://example.ns.gluroo.com",
  "credential": "user-provided-token",
  "from": "2026-07-01T00:00:00.000Z",
  "to": "2026-07-26T00:00:00.000Z",
  "limit": 12000,
  "relayTicket": "short-lived-signed-ticket"
}
```

The Worker validates the fields and constructs the upstream request itself.

The response contains only fields required by GlucoScope:

```json
{
  "entries": [
    {
      "sgv": 123,
      "date": 1785000000000,
      "dateString": "2026-07-25T00:00:00.000Z",
      "direction": "Flat"
    }
  ]
}
```

Unknown upstream fields are discarded.

## Destination allowlist and SSRF boundary

A request is accepted only when all conditions pass:

- scheme is exactly `https`;
- hostname ends with the verified suffix `.ns.gluroo.com`;
- hostname is not exactly `ns.gluroo.com`;
- no IP literal;
- no URL username or password;
- no non-default port;
- no fragment;
- user-provided path and query are discarded;
- Worker constructs the approved path;
- upstream method is `GET`;
- redirects are disabled and rejected;
- localhost, private, link-local, metadata, and arbitrary external destinations cannot be selected.

A new provider requires a separate reviewed adapter. It must not be added by weakening the allowlist.

## Authentication

### Browser to relay

- HTTPS `POST` only.
- Gluroo token is sent only in the request body.
- Token must not appear in relay URLs, query strings, fragments, Referer, error text, or analytics.
- Production CORS allows only the approved GlucoScope origin.
- No wildcard origin.
- Responses include:

```text
Cache-Control: no-store
Pragma: no-cache
```

### Relay to Gluroo

The confirmed strategy is `token-query`.

The Worker constructs the query in memory immediately before the upstream request.

The token must never appear in:

- logs;
- thrown error messages;
- returned diagnostics;
- Durable Object storage;
- cache keys;
- GitHub commits;
- screenshots;
- support messages.

Authentication failures return a generic classification such as `authentication_failed`.

## Turnstile and relay tickets

Turnstile validation is mandatory server-side.

Turnstile tokens:

- expire after five minutes;
- are single-use;
- must be validated by the Worker using Siteverify;
- require validation of expected hostname and action.

Proposed flow:

1. browser completes Turnstile;
2. Worker validates the Turnstile token;
3. Worker issues a signed short-lived relay ticket;
4. browser keeps it in memory or `sessionStorage`;
5. glucose requests include the ticket;
6. ticket expires automatically.

Ticket claims contain no Gluroo URL, token, or glucose data.

Allowed claims:

- random session identifier;
- issued-at time;
- expiry time;
- relay scope;
- signature version.

## Rate and cost guardrails

Cloudflare Workers Free currently allows 100,000 requests per account per day. Other GlucoScope Workers share the account allowance, so the relay must remain well below that limit.

Initial Friends & Family guardrails:

```text
Maximum date range: 31 days
Maximum entries: 12,000
Per-session daily requests: 250
Worker warning threshold: 20,000 requests/day
Worker hard stop threshold: 50,000 requests/day
Upstream timeout: 15 seconds
Maximum upstream response accepted by application: 6 MiB
```

Cloudflare does not enforce a Worker response-body limit, so the relay must enforce its own application-level byte limit.

Durable Objects may store counters only:

- anonymous relay session ID;
- time bucket;
- request count;
- allow or deny state;
- aggregate Worker request count.

They must not store exact source hostnames, credentials, glucose values, entry timestamps, or response bodies.

## Logging and observability

New Cloudflare Workers may have Workers Logs enabled by default. The production Wrangler configuration must explicitly disable observability for the relay unless a separately reviewed privacy-safe configuration is approved.

Required initial configuration intent:

```json
{
  "observability": {
    "enabled": false
  }
}
```

Additionally:

- no `console.log` of request or response data;
- no logging of request bodies;
- no logging of upstream URLs;
- no logging of headers or tokens;
- no logging of glucose entries;
- no traces containing upstream request details;
- only aggregate request metrics and Durable Object counters may be used for initial operation.

Cloudflare infrastructure still processes network requests. Public wording must distinguish transient infrastructure processing from GlucoScope application storage.

## Cache boundary

Version 0.2 uses no shared glucose cache.

The Worker must not use:

- Cache API;
- KV;
- D1;
- R2;
- Durable Object payload cache;
- AI-letter shared cache.

Browser-local reuse may continue under existing user-mode behavior.

## Error classes

Internal classifications:

- `invalid_request`;
- `destination_not_allowed`;
- `turnstile_failed`;
- `relay_ticket_invalid`;
- `rate_limited`;
- `authentication_failed`;
- `upstream_timeout`;
- `upstream_unavailable`;
- `upstream_response_too_large`;
- `unsupported_data_format`;
- `relay_temporarily_paused`.

User-facing copy must remain gentle and must not expose credentials, hostnames, upstream bodies, or technical stack details.

The browser must never fall back to Kazuma's public-demo data.

## Kill switch

The relay requires an immediate configuration-based pause:

```text
RELAY_ENABLED=false
```

When paused:

- relay requests return a gentle maintenance response;
- direct Nightscout continues to work;
- public demo continues to work;
- no server-side credential deletion is needed because credentials are not retained.

A Worker-wide hard stop may also be triggered by aggregate rate counters.

## Browser storage and deletion

Existing choices remain:

- current browser session only; or
- save on this device.

Relay-mode browser storage may contain:

- Gluroo base URL;
- Gluroo token;
- connection type;
- confirmed authentication strategy;
- short-lived relay ticket.

Browser storage is not an encrypted vault. Shared devices should use session-only mode or delete the saved connection after use.

Deleting the connection removes the browser values. There is no corresponding server-side credential record.

## AI boundary

Relay data is not sent to the AI-letter Worker.

User-mode Worker-generated AI letters remain disabled until separate work completes:

- per-user cache isolation;
- per-user rate-limit isolation;
- explicit consent;
- AI budget controls;
- privacy wording;
- deletion behavior.

## Medical and safety boundary

The relay transports data for reflection only.

GlucoScope must continue to explain that:

- data may be delayed, missing, duplicated, incomplete, or wrong;
- the original CGM or pump app remains the source for alerts, treatment decisions, current device state, and urgent situations;
- relay failure does not prove that the CGM stopped;
- GlucoScope does not diagnose, prescribe, recommend insulin doses, or change device settings.

## External-service boundary

Gluroo is operated separately from GlucoScope.

Technical success does not establish permission for public third-party relay use.

Before public release, current Gluroo terms or direct support guidance must be reviewed for:

- third-party server-to-server access;
- credential relay behavior;
- automated request limits;
- caching restrictions;
- attribution or notice requirements;
- public or commercial service restrictions;
- expected shutdown behavior.

If the provider does not permit the relay, it must not be released publicly even if it works technically.

### Phase 3C public-policy review — 2026-08-05

The official Gluroo materials reviewed for this gate were:

- the [Gluroo EULA](https://gluroo.com/eula/);
- the [Gluroo Privacy Policy](https://gluroo.com/privacy-policy/);
- the [Gluroo FAQs](https://gluroo.com/support/faqs/);
- the [Gluroo User Manual](https://gluroo.com/user-manual/);
- Gluroo's official [smartwatch and third-party tool guidance](https://gluroo.com/blog/glucrew/blood-sugar-readings-smartwatch-gluroo/).

These materials describe user-controlled use of Gluroo Global Connect with Nightscout-compatible third-party tools. They do not clearly authorize or prohibit GlucoScope's specific multi-user, server-to-server, transient Cloudflare relay model. Technical interoperability therefore must not be presented as provider approval or partnership.

Before a public route is created or the relay is enabled, obtain written confirmation from Gluroo covering:

- a person submitting their own Global Connect URL and API Secret through the GlucoScope relay;
- read-only access to `/api/v1/entries.json` and the exclusion of treatments, device settings, and other data;
- transient processing without credential or glucose storage, cache, logging, AI use, or sharing;
- expected request limits, attribution or notices, public/commercial-use boundaries, and shutdown contact;
- whether Friends & Family testing is treated differently from later public use.

Do not include a real Global Connect URL, API Secret, glucose payload, or identifying screenshot in the inquiry. Until written confirmation is received, keep `RELAY_ENABLED=false`, keep the frontend endpoint blank, and keep the Worker without an active public target.

## Worker separation

Limited Data Relay must be a separate Worker from the AI-letter Worker.

Reasons:

- different data sensitivity;
- strict destination allowlist;
- separate rate controls;
- no cache;
- no logs;
- independent kill switch;
- smaller failure scope;
- clearer public disclosure.

## Documents that must change before release

- `docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md`
- `docs/Feature_Specs/USER_DATA_SOURCE_FOUNDATION.md`
- `pages/trust/privacy-notes.html`
- `pages/trust/data-integration-principles.html`
- `pages/trust/roadmap.html`
- user-mode connection copy
- Gluroo setup guide
- new Guardian Monitor setup guide
- `SAFETY.md` when relay-specific availability wording is added

The old statement that credentials never pass through a GlucoScope Worker must be scoped to direct Nightscout mode.

## Phase 1 implementation

Phase 1 creates a security skeleton only:

- separate Worker project;
- strict `.ns.gluroo.com` destination validation;
- `entries.json` only;
- `token-query` upstream authentication;
- redirects rejected;
- timeout and byte limits;
- response-field allowlist;
- `no-store` response;
- safe error classifications;
- observability disabled;
- unit tests;
- no production deploy;
- no frontend integration.

Turnstile tickets, Durable Objects, public UI, and production deployment belong to later phases.

## Phase 3B paused deployment record — 2026-08-05

Phase 3B created and verified the stopped production shell without opening the relay for use:

- Worker name: `glucoscope-data-relay`;
- final stopped/no-target Version ID: `89a2e968-96df-49bb-b8f0-ce631c3b4b32`;
- `RelayUsageCounter` was created as a SQLite-backed Durable Object;
- `TURNSTILE_SECRET_KEY` and `RELAY_TICKET_SECRET` were registered as Cloudflare Worker Secrets; their values were not written to the repository or deployment record;
- `RELAY_ENABLED=false`, `workers_dev=false`, and `observability.enabled=false` remain checked in;
- the frontend relay endpoint remains blank;
- Wrangler reported `No targets deployed` after the final deployment.

A temporary `workers.dev` target was enabled only long enough to verify the stopped production response and was disabled immediately afterward. The smoke test confirmed:

- an allowed GlucoScope origin received `503 relay_temporarily_paused`;
- its CORS preflight received `204`;
- an unapproved origin received `403` without an allow-origin header;
- a request without an Origin received `403`;
- stopped responses included `Cache-Control: no-store` and `Pragma: no-cache`.

The temporary URL returned `404` after the target was removed. No Gluroo URL, Gluroo credential, or glucose payload was used during this stopped-state verification. Provider-policy review, permanent routing, Trust Pack completion, real-device acceptance, and a separate explicit enablement approval remain release gates.

## Phase 1 tests

- accept valid Gluroo HTTPS hostname;
- reject non-Gluroo hostnames;
- reject IP literals;
- reject HTTP;
- reject ports, fragments, and URL credentials;
- discard user paths and queries;
- construct only `/api/v1/entries.json`;
- use `token-query`;
- reject redirects;
- enforce timeout;
- enforce maximum date range;
- enforce maximum entry count;
- enforce application byte limit;
- reject invalid JSON;
- reject unsupported entry formats;
- return only approved entry fields;
- never include token or upstream body in errors;
- set `Cache-Control: no-store`;
- honor kill switch;
- ensure Wrangler observability is disabled.

## Release gates

The relay cannot be publicly enabled until:

- Gluroo policy or support boundary is reviewed;
- PROJECT_BIBLE and public Trust Pack wording are updated;
- destination and SSRF tests pass;
- Turnstile and signed ticket flow passes;
- Durable Object rate limits pass;
- global warning and hard-stop limits pass;
- production observability settings are reviewed;
- no secrets are committed;
- frontend discloses relay processing before credential submission;
- direct Nightscout remains available;
- user-mode AI remains isolated;
- Guardian, Libre, and Dexcom routes are documented according to actual verification status;
- real-device current, today, yesterday, 7-day, and 30-day tests pass;
- emergency pause and browser deletion behavior pass;
- `node --check`, Worker tests, and `git diff --check` pass;
- `wrangler deploy` occurs only after explicit approval.

---

Understand today. Improve tomorrow. 🍀
