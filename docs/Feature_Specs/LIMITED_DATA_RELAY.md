# Limited Data Relay 0.3 Design

## Status

- The checked-in 0.3 candidate replaces the one-hour browser ticket with a long-lived anonymous device session. It is not deployed or published, and no live Cloudflare route, DNS setting, Worker Version, or traffic allocation has been changed by this candidate.
- The intended production origins are `https://glucoscope.app` for the site and `https://relay.glucoscope.app` for the relay. The relay custom domain must be created and verified before activation; the candidate does not retain a public `workers.dev` route.
- Existing early-access connections use the old ticket system until the coordinated site-and-Worker release. Because backward compatibility is intentionally not required for this small group, each existing person will complete the connection safety check once after the migration.
- A replacement connection is accepted only after the proposed Gluroo URL and credential return at least one valid glucose entry. Invalid input, an empty response, or an upstream failure leaves the existing working device session intact.
- The new session uses a host-only `__Host-glucoscope_relay_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`. JavaScript never receives or stores the raw session token.
- A session expires after 180 days without successful use. Successful use rolls the idle expiry forward, but this is not a promise of permanent access: browser-data removal, a security change, expiry, explicit deletion, or emergency revocation can require the safety check again.
- Guardian, FreeStyle Libre 2, and the general-user Dexcom G7 relay path completed their recorded real-device acceptances under the historical ticket implementation.
- The currently deployed early-access system uses the old `workers.dev` target and ticket Version. Production deployment `5f8d00d9-9d68-4b2a-99cd-c58c26123684` routes active Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` at 100% for the approved small group; stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` remains its rollback target.
- The checked-in candidate frontend points to `https://relay.glucoscope.app`, uses a plain processing explanation without a separate consent checkbox, and cannot connect until the matching Worker and custom domain are deliberately released.
- After the migration, rollback uses a reviewed stopped Version of the same device-session implementation. The historical one-hour ticket Version remains evidence only and is not a compatible rollback target.
- Historical post-enable checks for the old ticket implementation returned `204` for approved-origin preflight, `403` for invalid Turnstile and unapproved origins, and retained `Cache-Control: no-store` and `Vary: Origin`. Those checks do not accept the unpublished 0.3 session candidate.
- The final Trust Pack link, title, privacy, safety, verification-status, desktop, and mobile review is complete.
- The final local and read-only Cloudflare configuration and security review is complete; required Secret names are declared in `wrangler.jsonc` without storing their values.
- After separate explicit approval, commit `98def2e96065f1a801728e060673ea22d4ff9e44` was deployed as stopped Version `1a51631d-1e53-4f88-ac27-2125b43f1ab2`; all post-deployment stop, CORS, Secret-name, and Durable Object checks passed.
- An earlier Guardian candidate-route acceptance temporarily routed Version `84139213-8521-4772-b3f3-47ee0018c5d3`, but stopped before credential submission because the public Pages build did not yet expose the Guardian guide. Stopped Version `89d8166d-a50e-4e94-b3d3-a06f7a0b6fb1` was deployed immediately afterward.
- On 2026-08-06, PR #12 merged the Siteverify request alignment to `main` at `d3051852b6a3b698de67d163cd290bd2b4ad2c3a`. A separately approved temporary enablement then completed the first Guardian path through iPhone Safari, Turnstile, the signed ticket, Gluroo, the relay, and GlucoScope. Current glucose and the graph appeared and appeared again after reload.
- Later on 2026-08-06, a separately approved temporary enablement completed the first basic FreeStyle Libre 2 path through FreeStyle LibreLink, LibreLinkUp, Gluroo, the relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed in Safari Private Browsing. Normal-tab persistence after fully quitting Safari was not retested by user choice.
- Stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` was restored immediately after the historical device-route acceptances. The later separately approved early-access activation superseded that stopped traffic state; the Version remains the reviewed rollback artifact for the old deployment.
- Version-specific Preview URLs are disabled. The earlier temporary connectivity probe remains deleted.
- User Foundation PR #7 was merged before this work began.
- The current implementation is merged to `main`.

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
- iPhone Safari completed the GlucoScope consent and Turnstile flow and received a signed relay ticket;
- GlucoScope displayed the current glucose view and graph through the limited relay;
- the same display returned after a browser reload;
- Guardian Monitor supports only one Nightscout upload destination at a time.

After the earlier upload-only verification, Kazuma restored Guardian Monitor to his personal Nightscout destination. The later end-to-end acceptance is recorded separately below.

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

Version 0.3 does not:

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
  "limit": 12000
}
```

The browser sends this request with credentials enabled. The browser-readable body contains no
relay-session token; the browser attaches the protected cookie automatically. The Worker validates
the fields and constructs the upstream request itself.

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

## Turnstile and anonymous device sessions

Turnstile validation is mandatory server-side.

Turnstile tokens:

- expire after five minutes;
- are single-use;
- must be validated by the Worker using Siteverify;
- require validation of expected hostname and action.

Candidate flow:

1. browser completes Turnstile;
2. Worker validates the Turnstile token;
3. Worker validates the proposed canonical Gluroo URL and credential and requires at least one valid glucose entry before changing the current session;
4. Worker creates and binds a new opaque session, then revokes the previous session only after the new session is ready;
5. Worker sets the new host-only cookie and returns the already verified entries, while browser JavaScript receives no session token;
6. later requests must match the same HMAC source-and-credential fingerprint and are counted atomically for the current UTC day;
7. successful status or glucose checks roll the 180-day idle expiry forward;
8. explicit deletion removes the local URL and credential first, then asks the Worker to revoke the server record and clear the cookie.

The raw session token is never available to JavaScript and is not stored by the Durable Object.
Production accepts credentials only from the exact `https://glucoscope.app` Origin and returns
credentialed CORS responses only to that Origin. `SameSite=Strict` and the exact Origin check are
both required; neither substitutes for the other.

The per-device SQLite Durable Object may store only:

- HMAC-derived session-token ID;
- creation time;
- last successful use time;
- idle-expiry time;
- revocation state;
- HMAC fingerprint derived from the canonical source URL and credential;
- current UTC day bucket and request count.

It must not store the raw session token, raw Gluroo URL, credential, glucose data, display name,
email address, IP address, or User-Agent. The session identifier and source fingerprint are not
joined to the optional Usage profile or Plus identity. No endpoint may expose them for that purpose.

## Rate and cost guardrails

Cloudflare Workers Free currently allows 100,000 requests per account per day. Other GlucoScope Workers share the account allowance, so the relay must remain well below that limit.

Initial Friends & Family guardrails:

```text
Maximum date range: 31 days
Maximum entries: 12,000
Per-device-session daily requests: 3,000
Worker warning threshold: 20,000 requests/day
Worker hard stop threshold: 50,000 requests/day
Upstream timeout: 15 seconds
Maximum upstream response accepted by application: 6 MiB
```

Cloudflare does not enforce a Worker response-body limit, so the relay must enforce its own application-level byte limit.

The per-device object stores only the fields listed in the session section. The separate aggregate
counter stores the UTC bucket, aggregate request count, and allow/deny state. Neither object stores
an exact source hostname, credential, glucose value, entry timestamp, or response body.

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

Version 0.3 uses no shared glucose cache.

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
- `device_session_invalid`;
- `device_session_source_mismatch`;
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
- confirmed authentication strategy.

The protected device-session cookie is browser-managed and cannot be read by GlucoScope JavaScript.
Its 180-day lifetime is an inactivity limit that rolls forward on successful use, not guaranteed
permanent access.

Browser storage is not an encrypted vault. Shared devices should use session-only mode or delete the saved connection after use.

Deleting the connection first removes the locally saved URL and credential, AI cache, and related
connection state, then attempts server revocation and removal of the browser-managed session cookie.
The local deletion must not wait for or depend on that network request. If the device is offline, the server has
no raw URL, credential, or glucose record to delete; the anonymous session record becomes unusable
without the removed browser credentials, becomes invalid at its existing idle expiry, and is eligible
for alarm cleanup afterward. Public wording must not promise an exact physical-deletion time.

Safari's Home Screen handoff can copy cookies but does not copy local storage. The beginner route
therefore asks an iPhone user to add GlucoScope to the Home Screen first, open the new icon, and
complete the first data connection inside that icon. Connecting in Safari before adding the icon can
require one additional connection inside the Home Screen app even when the protected session marker
was copied. See [WebKit's Home Screen web app storage note](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

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
- Gluroo's official [Nightscout integration guidance](https://gluroo.com/support/gluroo-nightscout-integration-for-loop/);
- Gluroo's official [smartwatch and third-party tool guidance](https://gluroo.com/blog/glucrew/blood-sugar-readings-smartwatch-gluroo/).

These materials describe user-controlled use of Gluroo Global Connect with Nightscout-compatible third-party tools. The Privacy Policy also contemplates information that a user permits a third-party product or service to access. The reviewed EULA does not state an express prohibition against this narrowly scoped, user-directed relay; it does prohibit security circumvention and off-purpose use, which the relay must never attempt. The materials do not specifically name or approve GlucoScope's transient Cloudflare relay model. This is a product risk decision based on the published boundary, not legal advice or provider approval. Technical interoperability must never be presented as Gluroo affiliation, endorsement, approval, or partnership.

### Written Gluroo support response — 2026-08-06

Gluroo support stated in writing that the proposed use should work and was acceptable to them only to the extent that it does not conflict with the EULA, terms of use, or other Gluroo documents. This is conditional interoperability guidance, not a determination that every use or data-sharing arrangement is lawful and not an unconditional license, endorsement, affiliation, or partnership.

The response adds these continuing boundaries:

- neither Gluroo, GGC, GlucoScope, nor the relay may be presented or used for medical advice or medical decision-making;
- Gluroo did not determine what CGM data re-sharing is lawful or unlawful, so GlucoScope gives no legal assurance and each person remains responsible for having the necessary authority and permissions;
- GGC must not be marketed as a free alternative to subscription Nightscout services;
- public wording may state only that GGC currently has no cost during its testing phase and must disclose that Gluroo is considering a subscription model under which GGC may no longer be free;
- GlucoScope must state that it is not affiliated with Gluroo and must handle questions about GlucoScope and the relay itself rather than directing those questions to Gluroo;
- the current EULA, terms, and other applicable Gluroo documents remain controlling and must be rechecked for material changes.

The rollout may proceed only when all other release gates pass and the following boundaries remain true:

- each person supplies their own Global Connect URL and API Secret and explicitly chooses relay processing;
- the relay performs read-only access to `/api/v1/entries.json` and excludes treatments, device settings, and all other data;
- credentials and glucose payloads are processed transiently without application storage, cache, logging, AI use, or sharing;
- the rollout starts small, stays within strict session and Worker-wide limits, and advertises only routes that have passed their own acceptance checks;
- GlucoScope makes no claim of Gluroo affiliation, endorsement, approval, or partnership, does not sell access to Gluroo, and does not market GGC as a free alternative to a subscription Nightscout service;
- the relay is paused immediately if Gluroo objects, applicable terms materially change, abnormal traffic is detected, or a privacy or safety concern appears.

Any provider inquiry must exclude a real Global Connect URL, API Secret, glucose payload, or identifying screenshot. Before candidate enablement, recheck the current public materials for material changes. Until the remaining release gates pass and a separate rollout decision is recorded, keep `RELAY_ENABLED=false` and `RELAY_DEVICE_SESSIONS_ENABLED=false`, keep the candidate frontend fixed to `https://relay.glucoscope.app`, keep `workers_dev=false`, and add no other target.

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
- `RELAY_ENABLED=false`, `workers_dev=false`, and `observability.enabled=false` were checked in at the end of Phase 3B;
- the frontend relay endpoint was still blank at the end of Phase 3B;
- Wrangler reported `No targets deployed` after the final deployment.

A temporary `workers.dev` target was enabled only long enough to verify the stopped production response and was disabled immediately afterward. The smoke test confirmed:

- an allowed GlucoScope origin received `503 relay_temporarily_paused`;
- its CORS preflight received `204`;
- an unapproved origin received `403` without an allow-origin header;
- a request without an Origin received `403`;
- stopped responses included `Cache-Control: no-store` and `Pragma: no-cache`.

The temporary URL returned `404` after the target was removed. No Gluroo URL, Gluroo credential, or glucose payload was used during this stopped-state verification. The Phase 3C public-policy review is complete.

## Permanent stopped target verification — 2026-08-05

After separate explicit approval:

- `workers_dev=true` created the single permanent target `https://glucoscope-data-relay.afterglow21.workers.dev`;
- `preview_urls=false` prevented version-specific Preview URLs from being created;
- at the time of that Worker deployment, `RELAY_ENABLED=false`, the then-blank frontend endpoint, and `observability.enabled=false` remained unchanged; the later paused-frontend acceptance fixed the endpoint to this approved target and added explicit consent;
- Version `ea0b8f59-3e9b-4475-b93a-91855834b3ce` retained both required Secret bindings and the SQLite Durable Object binding;
- allowed-origin preflight returned `204` with the exact CORS origin;
- repeated allowed-origin POST checks returned `503 relay_temporarily_paused` with no-store headers;
- wrong-origin and missing-origin POST checks returned `403`;
- one `1042` response occurred immediately after deployment and did not reproduce on subsequent empty-body or JSON-body POST checks. Cloudflare documents `1042` as a same-zone Worker subrequest error; no same-zone subrequest exists on the stopped code path, so live enablement remains blocked if it reappears.

No Gluroo URL, credential, glucose payload, Turnstile token, ticket, or counter was used during this verification.

## Guardian candidate-route acceptance pause — 2026-08-05

After separate explicit approval:

- Version `84139213-8521-4772-b3f3-47ee0018c5d3` temporarily received 100% of traffic for the Guardian candidate-route acceptance, with deployment message `temporary Guardian route acceptance`;
- the acceptance stopped before a Gluroo URL, credential, or glucose payload was submitted because the current public Pages build did not yet expose the Guardian guide needed for the test;
- Version `89d8166d-a50e-4e94-b3d3-a06f7a0b6fb1` was deployed immediately with message `pause after Guardian guide deployment gap` and received 100% of traffic with `RELAY_ENABLED=false` until later diagnostic work;
- that stopped Version retained the exact CORS origin, originless-request rejection, both required Secret bindings, and the SQLite `RelayUsageCounter` Durable Object binding;
- version-specific Preview URLs remained disabled, and the end-to-end acceptance through GlucoScope was still incomplete at that time.

No Secret value was printed, stored in Git, or changed during the pause.

## First Guardian end-to-end acceptance — 2026-08-06

After separate explicit approval:

- the initial live attempts reached the relay but returned safe diagnostic `710001`, placing the failure at the Worker-to-Siteverify transport boundary rather than browser CORS or Gluroo;
- increasing only the Siteverify timeout from five to ten seconds reproduced `710001`;
- PR #12 aligned the request with Cloudflare's Worker pattern: form-encoded POST, `AbortSignal.timeout(10_000)`, and no redirect or cache override;
- stopped Version `2ea372de-a7c5-44c8-8852-0c21f5382633` first verified the merged code with `RELAY_ENABLED=false`;
- temporary Version `f1c02561-e92a-4a9b-8b70-b9bab2a89fb2` then received 100% of traffic with `RELAY_ENABLED=true`;
- a dummy invalid token returned expected `403 turnstile_failed` with safe diagnostic `710202` and the exact allowed CORS origin, confirming that Siteverify was reachable without using a real Gluroo URL, credential, or glucose payload in a command;
- on iPhone Safari, the real Guardian route completed Turnstile, ticket issuance, Gluroo entry retrieval, current glucose and graph display, and a successful reload;
- stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` was deployed immediately afterward and receives 100% of traffic with `RELAY_ENABLED=false`;
- the stopped Version retains the exact CORS origin, originless-request rejection, both required Secret bindings, the SQLite Durable Object binding, `preview_urls=false`, and `observability.enabled=false`.

No Secret value, Turnstile token, Gluroo URL, credential, or glucose payload was printed, logged, or committed. This completes the first basic end-to-end acceptance only. Today/yesterday/7-day/30-day coverage, deletion, ticket expiry, limit behavior, and a continuing Friends & Family enablement remain separate gates.

## First FreeStyle Libre 2 end-to-end acceptance — 2026-08-06

After separate explicit approval:

- FreeStyle LibreLink, LibreLinkUp, and live Libre 2 readings in Gluroo were confirmed before relay enablement;
- temporary Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` received 100% of traffic with deployment message `temporary Libre 2 end-to-end acceptance` and `RELAY_ENABLED=true`;
- the exact CORS origin, both required Secret bindings, the SQLite Durable Object binding, request limits, `preview_urls=false`, and `observability.enabled=false` remained unchanged;
- a dummy invalid Turnstile token returned expected `403` with safe diagnostic `710202`;
- iPhone Safari Private Browsing completed consent, Turnstile, ticket issuance, Gluroo entry retrieval, current glucose, graph display, reload, and return from the iOS Home Screen for the Libre 2 route;
- closing Private Browsing removed its browser-stored configuration as expected; normal-tab persistence after fully quitting Safari was not retested by user choice;
- stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` was restored immediately afterward, receives 100% of traffic with `RELAY_ENABLED=false`, and returned the expected paused `503` response;
- no Secret value, Turnstile token, Gluroo URL, credential, glucose payload, or relay ticket was printed, logged, or committed.

This completes the first basic Libre 2 end-to-end acceptance only. Historical comparison capture, extended periods, deletion, ticket expiry, limit behavior, and any continuing enablement remain separate gates.

## General-user Dexcom G7 relay acceptance — 2026-08-12

After separate explicit approval:

- preflight confirmed stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` at 100%, approved-origin `OPTIONS` at `204`, approved-origin stopped `POST` at `503`, and wrong/missing origin at `403`;
- deployment `eb10444c-56ca-46eb-8e6c-0a15d2bd9fdf` routed active Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` to 100%; exact CORS, invalid-Turnstile `403`, `Cache-Control: no-store`, and `Vary: Origin` passed;
- iPhone normal Safari completed the G7 Gluroo connection test, current-glucose and graph display, today/yesterday/7-day/30-day switching, reload and redisplay, and browser-connection deletion followed by return to setup;
- the public 3CGM demo Worker and Usage Worker were untouched, and Usage remained stopped;
- deployment `5c390d07-13ce-4547-b53c-9a7ea9936696` restored the stopped Version to 100%; stopped `POST` again returned `503` with `Cache-Control: no-store` and `Vary: Origin`.

No Gluroo URL, credential, Turnstile token, relay ticket, or glucose value was printed, logged, or committed. The general-user G7 basic route and its period/reload/deletion checks are verified. Continuing enablement or a small rollout remains a separate decision. Safari full-quit restoration, natural ticket expiry, and live limit exhaustion remain separate operational gates.

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

- current Gluroo public materials are rechecked for material changes and no provider objection is known;
- PROJECT_BIBLE and public Trust Pack wording are updated;
- destination and SSRF tests pass;
- Turnstile and anonymous device-session creation, rotation, status, binding, rolling expiry, revocation, and alarm cleanup pass;
- Durable Object rate limits pass;
- global warning and hard-stop limits pass;
- production observability settings are reviewed;
- no secrets are committed;
- frontend discloses relay processing before credential submission;
- direct Nightscout remains available;
- user-mode AI remains isolated;
- Guardian, Libre, and Dexcom routes are documented according to their actual verification status;
- current, today, yesterday, 7-day, and 30-day real-device tests pass for each route before that route is advertised as verified;
- emergency pause and browser deletion behavior pass;
- `node --check`, Worker tests, and `git diff --check` pass;
- `https://relay.glucoscope.app` is verified as the only relay target, `https://glucoscope.app` is the only allowed site Origin, and the old `workers.dev` public route is disabled;
- the one-time reconnect message for existing early-access users and the Home-Screen-first iPhone path are accepted;
- no deployment, DNS change, Pages publication, routing change, or live enablement occurs without a separate recorded rollout step.

---

Understand today. Improve tomorrow. 🍀
