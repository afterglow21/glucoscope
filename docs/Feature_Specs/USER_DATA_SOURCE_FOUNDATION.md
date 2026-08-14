# User Data Source Foundation 0.4.0

## Purpose

User Data Source Foundation 0.4.0 is the beginner-facing base for allowing a person other than Kazuma to open GlucoScope and connect their own glucose data without building an Azure environment for GlucoScope. Existing Nightscout remains a direct browser route, while Gluroo Global Connect uses the narrowly scoped Limited Data Relay.

The first supported path is a **Nightscout-compatible data source**. The setup screen names these two routes:

- Gluroo Global Connect
- an existing Nightscout environment

Gluroo support remains an interoperability proof of concept. GlucoScope does not claim that every Gluroo, CGM, pump, operating system, or historical-data combination is supported. Guardian Monitor to Gluroo Global Connect has been verified with Kazuma’s MiniMed / Guardian environment.

## User flow

The simplified flow, repeated-callback guard, robust connection storage, best-effort display-name storage, and bounded profile-create wait were published for supervised re-acceptance. A second iPhone attempt temporarily enabled Usage Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` and relay Version `a398d59e-54c1-4b8d-a9a4-b779af360a54`. The connection test succeeded, but after `GlucoScopeを始める` and a brief Turnstile display, the required data-connection screen returned. D1 remained `0 / 0 / 0`, so no usage profile was created. Usage and relay were immediately returned to stopped Versions `7cb71965-74c3-47f9-b589-75cf6d669edb` and `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a`. The checked-in kill switches remain false.

Reproduction identified a browser handoff issue: an already-user-mode save unnecessarily reloaded the page. If Safari lost or could not access the sessionStorage relay ticket across that reload, initialization had saved connection configuration but no active relay adapter and reopened the required setup screen. This release activates the saved configuration and adapter in place when already in user mode; entry from the public demo keeps full navigation. Local tests and the later supervised device confirmation passed.

The subsequent supervised iPhone acceptance confirmed that fix on the core CGM path. With the same relay and Usage candidate Versions temporarily active, the Gluroo (Libre) connection passed, `GlucoScopeを始める` kept the existing user-mode page, and live glucose was displayed. Usage D1 remained `profiles / usage_daily / event_receipts = 0 / 0 / 0`, so no usage profile was created and the usage lifecycle was still pending at that checkpoint. Immediately afterward, relay deployment `a1962cbf-9f77-48c1-b33a-05bd39323a8c` restored stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` at 100%, and Usage deployment `17de293b-2d38-4b07-aa5f-604c2cc65d43` restored stopped Version `7cb71965-74c3-47f9-b589-75cf6d669edb` at 100%. Approved-origin preflight returned `204` and stopped `POST` returned `503` for both Workers. Checked-in flags remain `false`; the frontend supervised-candidate gate remains `true`, and the general-user relay is paused.

On 2026-08-12, the general-user Dexcom G7 relay route also passed supervised iPhone normal-Safari acceptance. Connection testing, current glucose, graph display, today/yesterday/7-day/30-day switching, reload and redisplay, and browser-connection deletion followed by return to setup all passed. The relay was immediately returned to stopped Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a`; Usage remained stopped and the public 3CGM demo Worker was untouched. This verified the G7 basic user route but, at that checkpoint, did not authorize continuing enablement or a broader rollout. Safari full-quit restoration, natural ticket expiry, and live limit exhaustion remained separate gates.

After the later Usage lifecycle and general-user Dexcom G7 acceptances passed, separate explicit approval started continuous 1–3 person early access. Usage deployment `4fbf0e2c-5f5c-4f4f-98a9-ae57d73b4824` routes 100% to Version `5d160aed-7b27-48e6-b0a8-783534f97b6f`, and relay deployment `5f8d00d9-9d68-4b2a-99cd-c58c26123684` routes 100% to Version `a398d59e-54c1-4b8d-a9a4-b779af360a54`. Initial D1 counts remained `0 / 0 / 0`; approved-origin preflights returned `204`, invalid Turnstile and unapproved-origin requests returned `403`, and no-store boundaries passed. Checked-in Worker kill switches remain `false`, and the reviewed stopped Versions remain immediate rollback targets. This is not a broad public rollout.

1. Open `user.html` or `index.html?mode=user`.
2. Choose exactly one numbered route.
3. Tapping Method 1 opens the Gluroo preparation step and screenshot guide; tapping Method 2 opens the Nightscout connection form.
4. Enter a required display name. The display name does not need to be a real name. Directly below it, the form shows the short notice `表示名と基本的な利用回数を、GlucoScopeをよくするために記録します。血糖値や接続情報は記録しません。` with a `詳しく` link.
5. Enter the Nightscout-compatible URL and an API Secret or read token when required, then run the connection test.
6. After a successful test, pressing `GlucoScopeを始める` attempts to create the browser usage profile and saves the connection in browser local storage, or keeps it only for the current browser session. Failure of the usage-only Turnstile or Usage Worker must not block an otherwise verified CGM connection; in that case the connection starts with no usage profile and collection off. Gluroo relay consent, its separate Turnstile and signed ticket, destination validation, and browser-storage success remain fail-closed.
7. When setup already runs in user mode, GlucoScope activates the saved configuration and adapter in place without an unnecessary reload. Entry from the public demo uses full navigation into user mode. Nightscout is read directly by the browser; Gluroo entries are read through Limited Data Relay using a short-lived session ticket.

The existing root `index.html` without `mode=user` remains Kazuma's public demo. Viewing that demo never requires a display name or usage profile. The Gluroo relay notice and confirmation remain a separate boundary because they explain transient processing of connection details; they must not be merged into or replaced by the usage-profile notice.

## Privacy boundary

For User Foundation 0.4.0:

- The data-source URL and credential are stored only in the selected browser storage when the person chooses to save them.
- Existing Nightscout is read directly by the browser and does not use Limited Data Relay.
- Gluroo Global Connect uses Limited Data Relay. Its URL, credential, requested range, and required glucose entries are processed transiently by Cloudflare infrastructure and the relay Worker.
- The relay application does not store, cache, log, send to AI, or share the Gluroo URL, credential, or glucose payload.
- The relay retrieves glucose entries only. Treatments, insulin, carbohydrates, medication, pump settings, and device-status data are outside the relay scope.
- The signed relay ticket is stored only in browser `sessionStorage`, is bound to the approved origin, and expires after about one hour.
- The SQLite Durable Object stores only a UTC date bucket and request count for abuse prevention. It does not store source URLs, credentials, glucose values, entry timestamps, response bodies, IP addresses, or AI content.
- The Cloudflare Web Analytics beacon is not loaded in user mode or on any same-origin page while a user connection remains in local or session browser storage.
- If browser storage cannot be checked safely, analytics stays disabled as the privacy-first fallback.
- Chart.js is served from a reviewed local vendored file instead of a third-party runtime CDN on the page that handles connection details and glucose data.
- The user can delete the saved connection from the setup screen. Deletion also clears the current relay ticket. In the unpublished user-AI candidate, this same saved-connection deletion also clears the browser-local AI-letter cache and the stored first-use AI confirmation; it does not claim to delete OpenAI's abuse-monitoring logs.
- A shared device should use session-only storage or remove the connection after use.
- The usage-profile service receives the display name and allowlisted usage counts only. The data-source URL, credential, glucose values, and relay ticket are never sent to that service.

Browser local storage is not encrypted storage. Anyone who can use the same unlocked browser profile may be able to access locally stored information. JavaScript running on another page of the same GlucoScope origin can also share that browser-storage boundary. The setup screen must explain the shared-device boundary and the Gluroo relay boundary separately in plain language.

## Authentication compatibility

The direct Nightscout adapter can try the following read-authentication forms:

1. no credential for a publicly readable endpoint;
2. SHA-1 `api-secret` header for a regular Nightscout API Secret;
3. raw `api-secret` header for a compatible service that issues a ready-to-use secret;
4. `token` query parameter for a Nightscout read token or compatible token.

The Gluroo relay uses only the verified `token` query authentication when it contacts the allowlisted Gluroo host. The successful direct Nightscout strategy may be saved with the browser connection. Gluroo does not need direct-browser strategy discovery.

A read-only token should be preferred when the data source offers one. GlucoScope must never ask for a CGM manufacturer password, CareLink password, LibreLinkUp password, or Gluroo account password.

## CORS and relay boundary

Existing Nightscout still requires the data source to allow the person’s browser to read its API response.

Gluroo Global Connect was reachable from a Cloudflare Worker but was not readable directly from the verified browser environment because of provider-side CORS. Limited Data Relay is therefore the only Gluroo route prepared by User Foundation 0.4.0.

The relay:

- accepts only the approved Gluroo hostname suffix;
- constructs `/api/v1/entries.json` internally;
- rejects redirects and arbitrary destinations;
- requires server-validated Turnstile and a signed origin-bound ticket;
- enforces date, entry, byte, timeout, session, and Worker-wide limits;
- fails closed when configuration, secrets, counters, or the relay endpoint are unavailable;
- is currently available only to the approved 1–3 person early-access group through its single approved `workers.dev` target. Public wording and consent, final security checks, explicit live-enablement approval, and the accepted Guardian, Libre 2, and Dexcom G7 route checks remain the boundary for use. The checked-in `RELAY_ENABLED=false` safety default and reviewed stopped Version remain the immediate rollback path. The Phase 3C public-policy review and the 2026-08-06 written Gluroo support response are recorded in `LIMITED_DATA_RELAY.md`; the response is conditional on continued compliance with Gluroo's EULA, terms, and other documents.

A direct Gluroo request must not be used as a silent fallback, and a failed relay request must never fall back to Kazuma’s public-demo data.

## Guardian / MiniMed route

The verified iPhone route is:

```text
MiniMed / CareLink
        ↓
Guardian Monitor
        ↓ Nightscout sync
Gluroo Global Connect
        ↓
Limited Data Relay
        ↓
GlucoScope
```

Guardian Monitor is an uploader into Gluroo, not another destination supported by the relay. Its Nightscout destination is limited to one. The normal beginner guide should keep this exception small and show it only to people who already use another Nightscout destination.

## AI boundary

Deployment boundary as of 2026-08-14: production remains AI Worker cache schema v14 on Version 28 (`f2565bc3-1f49-4f3f-b119-6ec2683f0607`). Personal-user AI is implemented as a locally verified candidate but has not been published. Until the coordinated Worker-then-Pages release occurs, the production user route must still be described as not yet enabled.

The unpublished candidate uses the following boundary in `mode=user`:

- Before the first AI request for the current notice version, show a short, explicit confirmation that the summarized glucose information on the page will be sent to OpenAI. Cancelling sends nothing. The rule-based local Gluco message and ChatGPT-copy path remain available.
- Send the selected-period summary only. Do not send the display name, Nightscout or Gluroo URL, connection passphrase, relay ticket, raw glucose-entry list, treatment list, insulin, food, medication, or device settings.
- Store confirmation only in the browser as `glucoscope.aiLetterUserConsent.v1`.
- Keep at most 30 AI letters in the browser-local `glucoscope.aiLetterLocalCache.v14` cache.
- During personal-user early access, `SHARED_AI_CACHE_ENABLED=false` in code and `AI_CACHE_ENABLED=false` in Worker configuration disable shared-KV reads, writes, and stale fallback for every mode, including `kazuma-public-demo`. Browser-provided `pageMode` is routing metadata, not trusted authentication, and cannot authorize shared-cache access. The KV binding remains only for the staged recovery rules below, not for a direct Version 28 restore while user AI is enabled; existing entries are not read, no new entries are written, and retained entries expire naturally within the configured maximum of 24 hours. Every mode uses browser-local cache only, with at most 30 entries.
- The Worker calls OpenAI with `store: false`. OpenAI states that API data is not used for model training by default unless the customer opts in. Its default abuse-monitoring logs may contain prompts and responses and are normally retained for up to 30 days, with possible longer legal or service-protection exceptions. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- The morning, afternoon, and night generation limits of 10 each and the daily maximum of 30 remain one infrastructure-wide counter shared by the public demo and all users. They are not per-person limits.
- AI, Turnstile, provider, budget, or shared-limit failure affects only the AI panel. It must not stop or delete an already verified CGM connection, block ordinary glucose display, or silently fall back to Kazuma's demo data.
- Deleting the saved data connection clears the browser-local AI cache, retired local AI cache keys, and saved AI confirmation. This is separate from deleting only the Usage-profile record.
- AI generation `POST /api/gluco-letter` requires an approved, present `Origin`. Originless Usage `GET` remains available for the existing operational checks.
- Turnstile must use action `glucoscope-ai-letter`, and the Worker must verify both that action and hostname `afterglow21.github.io` before calling OpenAI.

The release order is the committed Worker first and Pages second. A brief AI-only unavailable window is accepted while the old page still sends an incompatible Turnstile token; CGM connection and ordinary glucose display must continue. Version 28 may be restored only before the new Pages is live or if the Pages release fails. Once Pages with user AI enabled is live, do not restore Version 28 while user AI remains enabled because its spoofable `pageMode` boundary would reopen shared-KV writes. Keep AI fail-closed on the new Worker line, or first publish and verify Pages with user AI disabled before Worker recovery. Production cache v14 / Version 28 remains the recorded current state until both deployments and their smoke checks are complete.

## Data scope

The first adapter reads these Nightscout-compatible endpoints when available:

- `/api/v1/entries.json`
- `/api/v1/entries/sgv.json`
- `/api/v1/treatments.json`
- `/api/v1/devicestatus.json`

Treatments and device status are optional. Missing optional endpoints must not prevent glucose display.

## Safety boundary

GlucoScope remains a reflection support tool, not a medical device. The user must continue to check the original CGM or pump application for treatment decisions, alerts, current device state, and urgent situations.

Connection errors, missing data, old data, and unsupported formats should be shown gently and honestly. GlucoScope must not silently present stale or demo data as the user's current data.

## Release acceptance criteria

- The public demo still opens without setup.
- The main public demo always shows a visible `公開デモ` label and says that its displayed data is not the viewer's own data. `?mode=user` and `user.html` never show that label, whether setup is pending or a personal connection is active.
- User mode opens a required setup screen when no connection is stored.
- A new personal-data connection requires a display name, clearly says that a real name is unnecessary, and creates the usage profile only when `GlucoScopeを始める` is pressed.
- A usage-profile-only failure leaves usage unregistered and off but does not block a verified CGM connection; Gluroo relay security and browser-storage failures still block completion.
- The fixed short usage notice and `詳しく` link appear before that start action; the separate Gluroo relay confirmation remains intact.
- A connection cannot be saved until a live glucose entry is validated.
- Changing the provider, connection fields, relay confirmation, or setup step cancels and invalidates the in-flight connection test; an older response cannot re-enable saving for newer fields.
- Each Gluroo Turnstile challenge has its own generation and timeout. Relay preparation is single-flight, so a concurrent caller cannot overwrite a challenge or reuse its token. A render failure, cancellation, timeout, or stale callback is cleaned up without completing or blocking a later attempt.
- HTTPS is required except for localhost development.
- The secret is masked by default.
- The user may choose persistent or session-only browser storage.
- The saved connection can be deleted.
- The regular UI keeps only compact stop, resume, and delete controls for usage recording; allowlisted export is a small secondary link.
- Mobile and desktop display switches preserve `mode=user`.
- The deployed user route keeps AI Worker generation disabled until the unpublished frontend and Worker candidates are released together in the safe order; documentation must not describe the local candidate as already live.
- Before user-mode AI release, accept first-use confirmation before any request, browser-local cache maximum 30, all-mode shared-KV exclusion including stale fallback, untrusted `pageMode`, retained-binding expiry behavior, deletion of local AI cache and confirmation with saved-connection deletion, global-not-personal limit wording, AI-failure independence from CGM, approved-Origin `POST`, Turnstile hostname/action verification, and the Worker-first/Pages-second rollback sequence.
- No third-party runtime chart script is loaded on the user-data page.
- Analytics remains disabled while either user connection storage key exists.
- JavaScript syntax checks and adapter tests pass.
- The repeated-callback guard and simplified lifecycle are enabled only for supervised re-acceptance; any broader rollout waits until Create, Stop, Resume, Delete, and the secondary export path pass.
- Saving from an already-user-mode setup activates the saved config and adapter in place. It must not reopen required setup solely because a reload lost an otherwise valid in-memory relay ticket.
- Entry from the public demo still performs full navigation into user mode.

The frontend keeps the verified connection as the core browser-storage operation, treats display-name-only storage as best effort, and gives usage-profile creation and updates bounded timeouts. Supervised iPhone acceptance confirmed that `GlucoScopeを始める` stays in user mode with an active adapter and can display live Gluroo (Libre) glucose. At that checkpoint, Usage profile creation had not occurred. A later supervised check then accepted stale-credential cleanup, Create, reload deduplication and daily recording, Stop, Resume, allowlisted export, and Delete.

## Beginner-first onboarding rule

User Foundation 0.3.4 assumes that a person may use a smartphone every day while having little or no knowledge of servers, APIs, cloud platforms, browser storage, or which similarly named diabetes app should be opened next.

The visible setup flow therefore:

- starts with a choice between the recommended Gluroo route and the advanced Nightscout route;
- hides internal terms such as `localStorage`, `sessionStorage`, `CORS`, and `Nightscout-compatible adapter` from normal user-facing copy;
- labels the URL as `接続先URL` and the credential as `接続用の合言葉`;
- preserves the Gluroo screen labels `Nightscout URL` and `API Secret Token` only as small matching hints;
- uses a separate, screenshot-based HTML guide beginning with App Store installation;
- gives Nightscout a separate plain-language explanation and identifies it as an advanced route;
- uses one action per screen where practical, with large controls and short paragraphs;
- explains that the connection details are stored only on the selected device, and separates the shared-device warning onto its own line;
- treats each displayed onboarding screen as its own numbered step or explicit screen checkpoint instead of summarizing several screens as “answer what you can”;
- states exactly when an optional `SKIP`, `Not now`, or `Later` action may be used;
- separately identifies screens that must not be skipped, including CGM selection, sign-in, CGM connection, and Global Connect;
- places an `今開くアプリ` card before every app switch;
- shows the exact App Store name and current developer name so a person can verify the app even when its icon changes;
- never assumes that a person can distinguish FreeStyle LibreLink, LibreLinkUp, Gluroo, and Mail by name alone;
- incorporates independent field-test feedback before calling the onboarding complete.

## External-service maintenance boundary

Gluroo is one possible connection provider, not the GlucoScope platform itself.

The public setup and guide must state that:

- Gluroo is operated separately from GlucoScope;
- Gluroo Global Connect currently has no cost during its testing phase;
- Gluroo is considering a subscription model, and GGC may not remain free;
- GGC must not be marketed as a free alternative to subscription Nightscout services;
- price, features, screens, availability, and Nightscout-compatible behavior may change;
- GlucoScope is not affiliated with Gluroo, and questions about GlucoScope or its relay are handled by GlucoScope;
- Gluroo outages or changes may interrupt the GlucoScope connection;
- screenshots are maintained as replaceable guide assets rather than embedded throughout the main dashboard.

The guide shows its last review date and supported test environment. A Gluroo screen change should require updating the guide and its image assets, not redesigning the GlucoScope dashboard.

## Device-route boundary

The beginner Gluroo route is currently documented for FreeStyle Libre 2, Dexcom G7, and Guardian (MiniMed 780G). This is a documentation and verification boundary, not a permanent product lock-in.

Guardian (MiniMed 780G) does not connect to Gluroo by entering a CareLink or Medtronic account password into GlucoScope. The verified iPhone route uses Guardian Monitor as an external uploader and points its single Nightscout destination to Gluroo Global Connect.

The onboarding must present two equally clear device-guide choices inside the Gluroo route:

- Libre / Dexcom: open the Gluroo setup guide;
- Guardian (MiniMed 780G): open the Guardian Monitor setup guide.

The one-destination limitation is shown only as a conditional note for people who already send Guardian Monitor data to another Nightscout destination. The guide must explain that app availability, service behavior, and maintenance requirements can change. It must not promise that this route is permanently available.

## CGM account preparation guides

Dexcom and Libre credentials are entered only into Gluroo, never into GlucoScope.

The Dexcom guide explains:

- enable Dexcom Share and add at least one follower;
- use the Sharer's account, not a Follower account;
- find the account ID in the Dexcom app account screen;
- reset the password when it is unknown rather than attempting to display it.

The Libre guide explains:

- identify `FreeStyle LibreLink – JP` by its exact App Store name and developer before opening it;
- add a LibreLinkUp connection from the Libre app;
- switch to Mail and open the invitation;
- identify `LibreLinkUp` by its exact App Store name and developer;
- create or use the invited LibreLinkUp account;
- confirm that readings are visible in LibreLinkUp;
- switch back to Gluroo and use the LibreLinkUp email and password there;
- reset the password when it is unknown rather than attempting to display it.

On 2026-08-12, the beginner preparation guides were expanded from summary steps into one-screen-per-step walkthroughs using every supplied capture: 27 LibreLink / LibreLinkUp screens and 10 Dexcom Share screens. Personal fields in the supplied assets are masked. Each guide warns that app updates may change wording, layout, or screen order. Both the top return action and the completion action resume the shared Gluroo flow at STEP 22 (`#screen-22`), where the person selects and connects the prepared CGM, rather than skipping ahead to Global Connect at STEP 30.

These captures explain connection setup only. Example glucose values, graphs, and notification selections are not targets, medical advice, or instructions to change treatment, alerts, or device settings. The original CGM app and the person's medical guidance remain the source for treatment decisions, alerts, and current sensor state.

## Screenshot maintenance

Guide screenshots remain separate, replaceable assets. Fixed-position focus boxes are not placed over screenshots because their position can drift across screen sizes or image revisions. Numbered step headings, short captions, and plain-language instructions identify what to look for.

Every source screenshot that represents a distinct screen or user decision should have a corresponding step or screen checkpoint. Optional screens must not disappear into a broad summary. The reviewed iPhone Gluroo 2.0.5 source set contains 34 screens from App Store search through Global Connect URL/token confirmation. The device branches additionally use the complete supplied sets of 27 LibreLink / LibreLinkUp captures and 10 Dexcom Share captures. CGM-specific screens remain alternative branches rather than actions every person must complete. Each guide must display or explain its reviewed environment and clearly warn that app updates, CGM choice, answers, language, and region may change the screen, wording, order, or whether a screen appears. When an exact app-icon image is not available as a reviewed local asset, the guide must not draw a look-alike and present it as official. It should instead show a clearly labeled app-identification card, exact app name, developer name, and official App Store link until the reviewed icon or screenshot is added.

The reviewed LibreLink, LibreLinkUp, and Dexcom G7 icons supplied on 2026-08-12 are maintained as replaceable, metadata-free app-identification assets. The guides use faithful crops of those icons with their exact app identities; they do not redraw or recolor the third-party marks.

## Real-device test gate

Dexcom and Libre sensors should not be activated only to test unfinished onboarding work. Before using limited-life test sensors, the following must be ready:

1. beginner-facing onboarding;
2. screenshot guide;
3. local storage and deletion flow;
4. live connection test;
5. current glucose and graph rendering path;
6. a result checklist that records browser, device, current value, 24-hour, 7-day, and 30-day outcomes without sharing credentials;
7. an independent participant can identify each app, complete optional SKIP screens, and reach the connection test without real-time coaching.

A test participant should perform setup on their own phone and should not send the URL, API Secret, manufacturer credentials, or raw health-data screenshots to the developer.
