# User Data Source Foundation 0.3.4

## Purpose

User Data Source Foundation 0.3.4 is the beginner-facing base for allowing a person other than Kazuma to open GlucoScope and connect their own glucose data without building an Azure environment for GlucoScope.

The first supported path is a **Nightscout-compatible data source**. The setup screen names these two routes:

- Gluroo Global Connect
- an existing Nightscout environment

Gluroo support is an interoperability proof of concept. GlucoScope does not claim that every Gluroo, CGM, pump, operating system, or historical-data combination is supported.

## User flow

1. Open `user.html` or `index.html?mode=user`.
2. Choose exactly one numbered route.
3. Tapping Method 1 opens the Gluroo preparation step and screenshot guide; tapping Method 2 opens the Nightscout connection form.
4. Enter the Nightscout-compatible URL and an API Secret or read token when required.
5. Run the connection test.
6. Save the connection in browser local storage, or keep it only for the current browser session.
7. After a successful test, GlucoScope reloads in user mode and reads the user's data directly from that data source.

The existing root `index.html` without `mode=user` remains Kazuma's public demo.

## Privacy boundary

For User Foundation 0.3.4:

- The data-source URL and credential are stored only in the selected browser storage.
- They are not sent to the GlucoScope AI Worker.
- The Cloudflare Web Analytics beacon is not loaded in user mode or on any same-origin page while a user connection remains in local or session browser storage.
- If browser storage cannot be checked safely, analytics stays disabled as the privacy-first fallback.
- Chart.js is served from a reviewed local vendored file instead of a third-party runtime CDN on the page that handles connection details and glucose data.
- They are not stored in Kazuma's Azure account, Cloudflare KV, or Durable Objects.
- The browser reads the Nightscout-compatible API directly.
- Credential-bearing API requests reject redirects so the browser does not intentionally follow a compatible endpoint to another destination with the same credential.
- The user can delete the saved connection from the setup screen.
- A shared device should use session-only storage or remove the connection after use.

Browser local storage is not encrypted storage. Anyone who can use the same unlocked browser profile may be able to access locally stored information. JavaScript running on another page of the same GlucoScope origin can also share that browser-storage boundary. The setup screen must explain the shared-device boundary in plain language, and GlucoScope must avoid loading unnecessary third-party runtime scripts while a user connection is stored.

## Authentication compatibility

The adapter can try the following read-authentication forms:

1. no credential for a publicly readable endpoint;
2. SHA-1 `api-secret` header for a regular Nightscout API Secret;
3. raw `api-secret` header for a compatible service that issues a ready-to-use secret;
4. `token` query parameter for a Nightscout read token or compatible token.

The successful strategy is saved with the local connection so normal requests do not need to rediscover it first.

A read-only token should be preferred when the data source offers one. GlucoScope must never ask for a CGM manufacturer password, CareLink password, LibreLinkUp password, or Gluroo account password.

## CORS boundary

The browser must be allowed by the data source to read its API response.

A failed direct request may mean:

- the URL or credential is incorrect;
- the data source is unavailable;
- browser CORS rules do not allow direct access;
- the response format is not compatible yet.

User Foundation 0.3.4 does not introduce a credential-bearing Cloudflare proxy. A proxy may be considered later only after destination restrictions, secret handling, abuse prevention, request limits, logging boundaries, and deletion behavior are designed.

## AI boundary

The current AI Worker uses a shared cache designed for Kazuma's public demo. Its existing cache identity is not yet sufficient for independent user data.

Therefore, in `mode=user`:

- Worker-generated AI letters are disabled;
- the rule-based local Gluco message remains available;
- the user may copy the generated summary prompt for their own ChatGPT use;
- no user glucose summary is sent to the GlucoScope AI Worker.

AI letters may be enabled later only after per-user cache isolation, usage-limit isolation, privacy wording, budget controls, and deletion behavior are complete.

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
- User mode opens a required setup screen when no connection is stored.
- A connection cannot be saved until a live glucose entry is validated.
- HTTPS is required except for localhost development.
- The secret is masked by default.
- The user may choose persistent or session-only browser storage.
- The saved connection can be deleted.
- Mobile and desktop display switches preserve `mode=user`.
- AI Worker generation remains disabled in user mode.
- No third-party runtime chart script is loaded on the user-data page.
- Analytics remains disabled while either user connection storage key exists.
- JavaScript syntax checks and adapter tests pass.
- No Worker deployment is required for this phase.

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
- Gluroo is currently available for testing at no cost according to its current public announcement;
- price, features, screens, availability, and Nightscout-compatible behavior may change;
- Gluroo outages or changes may interrupt the GlucoScope connection;
- screenshots are maintained as replaceable guide assets rather than embedded throughout the main dashboard.

The guide shows its last review date and supported test environment. A Gluroo screen change should require updating the guide and its image assets, not redesigning the GlucoScope dashboard.

## Device-route boundary

The beginner Gluroo route is currently documented for FreeStyle Libre 2 and Dexcom G7. This is a documentation and verification boundary, not a permanent product lock-in.

Guardian / MiniMed 780G must not be described as a simple iPhone Gluroo route. Gluroo documents an Android-only experimental notification integration with alpha support for Medtronic apps, but User Foundation 0.3 does not recommend or support that as the standard onboarding route.

kazuma's current iPhone example uses:

- MiniMed / CareLink;
- Guardian Monitor as an external app with Nightscout synchronization;
- a self-managed Nightscout web app;
- Azure App Service Free tier and MongoDB Atlas Free cluster as the current hosting example.

The guide must explain that app purchases, free-tier limits, service availability, and maintenance requirements can change. It must not promise that this route is free, simple, or permanently available.

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

## Screenshot maintenance

Guide screenshots remain separate, replaceable assets. Fixed-position focus boxes are not placed over screenshots because their position can drift across screen sizes or image revisions. Numbered step headings, short captions, and plain-language instructions identify what to look for.

Every source screenshot that represents a distinct screen or user decision should have a corresponding step or screen checkpoint. Optional screens must not disappear into a broad summary. The reviewed iPhone Gluroo 2.0.5 source set contains 34 screens from App Store search through Global Connect URL/token confirmation; CGM-specific Dexcom and Libre screens are documented as alternative branches rather than actions every person must complete. The guide must display the reviewed date/version and clearly warn that Gluroo updates, CGM choice, answers, language, and region may change the screen, wording, order, or whether a screen appears. When an exact app-icon image is not available as a reviewed local asset, the guide must not draw a look-alike and present it as official. It should instead show a clearly labeled app-identification card, exact app name, developer name, and official App Store link until the reviewed icon or screenshot is added.

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
