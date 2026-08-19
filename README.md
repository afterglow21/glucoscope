# GlucoScope

Personal Nightscout dashboard for glucose insights and daily reports.

GlucoScope is a gentle blood glucose reflection tool for people living with diabetes.
It is not a medical device and does not provide diagnosis, treatment decisions, insulin dose instructions, or emergency support.

## Current publishing target

The public site is served by GitHub Pages at `https://glucoscope.app/`. The custom domain is verified and HTTPS is enforced. Commit `7836b2f0ec3574890e25e4edc1dd9d128ba670d8` is the accepted source checkpoint for the atomic usage-counter release and produced a successful Pages build before this documentation sync. Commit `64a92932a592dda1b6eb9d6dd7700279b1c7a47a` records the base long-lived-session release; accepted frontend and iPhone Home Screen evidence is recorded through commit `746116043b8d7ad0ad60c8af5eb27ad4d661d94d`.
Cloudflare Pages may be considered later, but GitHub Pages remains the current static-site platform.

The AI letter API continues to run through Cloudflare Worker.
Provider API keys must stay server-side in the Worker environment and must never be committed to GitHub or placed in frontend JavaScript.

The reviewed personal-quota AI Worker target is Version `86fd6a35-4db2-46f4-a745-0cfc036a5dc7`. Its direct behavior rollback is Phase A Version `7af1189b-aaa5-4f18-8a1f-5e447d6d7d8e`, which keeps the atomic counter active while restoring the shared count ceilings and disabling personal quota. Atomic stopped Version `46f44888-002b-4847-8553-5cd12e3d7ac5` remains the emergency AI-off target. Historical Version 29 (`235cdf03-31d7-40fd-ab58-5c1c6aa2d923`) records the earlier personal-user AI boundary release. Personal-user AI remains enabled for the small early-access group under the boundary below.

## Canonical current-state snapshot — 2026-08-17 JST

This is the current operational summary. Dated rollout records below are historical checkpoints unless they explicitly say that they remain current.

- GitHub Pages publishes from `main`. Commit `7836b2f0ec3574890e25e4edc1dd9d128ba670d8` is the accepted atomic-counter source checkpoint; accepted frontend and iPhone Home Screen evidence remains recorded through commit `746116043b8d7ad0ad60c8af5eb27ad4d661d94d`.
- AI Worker personal-quota Version `86fd6a35-4db2-46f4-a745-0cfc036a5dc7` is the reviewed live target. Phase A Version `7af1189b-aaa5-4f18-8a1f-5e447d6d7d8e` is its direct behavior rollback; emergency AI-off recovery uses atomic stopped Version `46f44888-002b-4847-8553-5cd12e3d7ac5`. Version 29, the old `7ea0cfef-5322-4370-b72d-e2885f129f38`, and pre-atomic Versions must not receive rollback traffic.
- Usage Worker quota Version `0fcb9a63-8fbf-47d3-952c-75178881a0d9` receives 100% of Usage traffic for the approved small early-access group. Phase A Version `3ee6fd4a-1f2a-4e49-9fed-b1caa81081da` is the direct quota-off rollback. D1 migration `0002_ai_quota.sql` is applied; it created empty quota tables before enforcement was enabled. The checked-in configuration remains fail-closed.
- The Usage-to-AI service-binding aggregate is live. Because fewer than 10 consenting device profiles contributed in the completed 30-day window, the current response is `suppressed` and contains no exact totals. Backend `GET` and supervised real-browser Dashboard visual acceptance passed. One supervised `letter` / `night` generation moved the daily count from `0` to `1`, the monthly count from `15` to `16`, and the daily verified-Turnstile count from `0` to `1` exactly once; token and estimated-cost totals increased once, with no duplicate, cache hit, rate limit, or budget block.
- Demo-feed new-origin Version `97b14023-f9dd-440a-8b79-e2bb2b471697` receives 100% of continuous public-demo traffic. The earlier Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` records the first continuous three-source acceptance.
- Relay live Version 22 (`b4b2064d-6dd4-4de6-8a68-3d0d39aea2ec`) receives 100% of the approved small-group relay traffic. Unserved stopped Version 23 (`10d0a825-c098-462e-89fd-a69937c47a9b`) is the reviewed direct rollback.
- The Access-protected administrator dashboard is live and accepted for one administrator. Plus remains a stopped, non-public staging foundation with every public account, purchase, quota, and feature switch off.

## Personal-user AI — production early access

- In `mode=user`, the first AI request for the current notice version requires a short, explicit confirmation before Turnstile and before any AI request. Cancelling sends nothing; the browser-only Gluco message, ChatGPT-copy path, and ordinary CGM display remain available.
- The selected-period summary is sent to the GlucoScope Worker and OpenAI. It may include the range, latest reading/time/direction/delta, aggregate TIR/TAR/TBR/average/CV, eligible longer-range metrics, and derived reflection hints. It does not include the display name, connection URL, connection passphrase, relay-session credential or identifier, raw glucose-entry list, treatment list, insulin, food, medication, or device settings.
- The confirmation is versioned in browser storage as `glucoscope.aiLetterUserConsent.v1`. User-mode letters use only `glucoscope.aiLetterLocalCache.v14`, capped at 30 browser entries.
- During personal-user early access, production disables shared Workers KV read, write, and stale fallback for every page mode, including the public demo. `SHARED_AI_CACHE_ENABLED=false` is the code-level fail-closed rule and `AI_CACHE_ENABLED=false` is the Worker configuration. Browser-supplied `pageMode` is routing metadata, not trusted authentication or proof that data belongs to the public demo.
- Free personal use allows one successfully completed new OpenAI analysis per JST day for each device profile. Failed, incomplete, or rejected generations do not consume that allowance. Plus remains unavailable for purchase; after verified-account sales begin it is designed for five successful analyses per JST day. The public demo uses a reviewed fixed sample and does not call OpenAI. The former shared 10-per-slot and 30-per-day count ceilings are disabled, while the global atomic cost warning/stop and kill switch remain.
- The existing KV binding is retained for staged recovery, not as permission to restore Version 28 while user AI is enabled. Current production does not read existing entries or write new ones. Retained entries expire naturally within their existing maximum 24-hour lifetime. Every mode uses only the browser-local v14 cache, capped at 30 entries.
- Deleting the saved data connection clears the current and retired browser AI caches and the saved AI confirmation. Deleting only a Usage profile does not. Browser deletion does not claim to delete OpenAI abuse-monitoring logs.
- The Worker sends `store: false` to the OpenAI Responses API. OpenAI states that API data is not used for model training by default unless the customer opts in. Default abuse-monitoring logs may contain prompts and responses and are normally retained for up to 30 days, with possible longer legal or service-protection exceptions. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- Production early access uses personal quota instead of shared count ceilings: Free is one successful new analysis per JST day for each device profile, Plus is designed for five per verified active account after sales begin, and the public demo returns a human-reviewed fixed sample without calling OpenAI. The live Worker reserves and finalizes each personal allowance atomically; failed, incomplete, or rejected generation does not consume it.
- The singleton remains as an anonymous operations/cost counter, and its global monthly cost stop remains an emergency safety boundary. The checked-in Worker flags stay fail-closed even though the reviewed production rollout enables the personal limits.
- AI, Turnstile, provider, quality, budget, limit, cache, or AI-usage-recording failures affect only the AI panel. They do not stop or delete a verified CGM connection, block ordinary glucose display, or substitute public-demo data.
- AI-generation `POST /api/gluco-letter` requires an approved, present `Origin`. Originless `GET /api/gluco-letter/usage` remains available for existing operational checks.
- AI Turnstile uses `action=glucoscope-ai-letter`; the Worker verifies that action and `hostname=glucoscope.app`. The Worker-first, Pages-second release is complete. After atomic activation, the only direct rollback is the atomic-capable stopped Version named in the canonical snapshot. Version 28, Version 29, the old new-origin Version, Phase A, and the pre-activation quiesce Version are historical evidence and must not receive rollback traffic. CGM display remains independent throughout.

## Administrator dashboard — one-administrator production acceptance

- `workers/gluco-admin-dashboard/` is a dedicated Cloudflare Worker, separate from the public GitHub Pages site and the existing public AI Usage Dashboard. Initial Version `d17e89e9-bc15-40fb-90a0-2e85cb19cf42` was accepted through deployment `392fb7b5-792c-4990-b939-6ab97481beb1` on 2026-08-14 JST. On 2026-08-16, Version `b7c8c8d8-5fdf-4c94-9b9a-817c99f65c9a` was moved to 100% through deployment `29bbaf0f-b118-4792-a8b6-ebc70cdefbae`; the initial Version remains at 0% as the direct rollback. It has no public-site link.
- Cloudflare Access protects the whole dedicated hostname with a deny-by-default policy for one exact administrator email, email one-time PIN, and a 15-minute session. After Access admits the request, the Worker independently verifies the signed Access JWT, issuer, audience, expiry, required issued-at claim, and exact email match against a Worker Secret before any D1 read.
- Authenticated browser acceptance completed on 2026-08-15 JST. An unauthenticated request received a `302` to Access; the allowed administrator reached the server-rendered read-only empty state; query strings and unknown paths returned `404`; and the page loaded no scripts, images, or external links.
- The server renders read-only HTML from one fixed `SELECT` against `admin_device_usage`. There is no write route, arbitrary query, public JSON endpoint, search, export, or browser-side script.
- The page may show only five per-device-profile fields: display name, usage-recording state, active-day count, newly completed AI-analysis count, and ordinary Gluco-memory count No. 1–50.
- It does not select, return, or render profile IDs, tokens or hashes, profile dates or timestamps, daily rows, receipts, glucose values or graphs, AI inputs or letter contents, CGM type, connection details, IP addresses, or raw User-Agent values.
- Preview URLs, application logging, and invocation logging remain disabled. Email one-time PIN is not MFA; keep MFA enabled on the administrator's email account and prefer an MFA-capable identity provider before adding administrators or broadening operational use.

## Plus 30-day pass — guarded production acceptance and non-public staging checkpoint

- The approved initial product is JPY 400 as a one-time payment for 30 consecutive days, with no subscription or automatic renewal. It is not available for purchase yet.
- Free keeps the core glucose experience, the Today and Yesterday graph ranges, one successful gentle AI analysis per JST day, and one successful Share Studio trial per verified account. Active Plus is designed for the 7-day, 30-day, and custom graph ranges; up to five successful gentle or detailed analyses per JST day; every detailed-analysis output; and continued Share Studio use.
- On 2026-08-17, Stripe test mode created one active `GlucoScope Plus 30日パス` Product with one default JPY 400 one-time Price. No recurring Price or subscription exists. The non-secret Product/Price identifiers and encrypted test-only Stripe bindings are retained only in stopped staging; public Checkout and sales remain disabled.
- On 2026-08-19, Stripe live mode created a separate active `GlucoScope Plus 30日パス` Product (`prod_V6ASxKCkGvR0Cs`) with one default JPY 400 one-time Price (`price_1U5y7tQk6xCYKhx8v3S5tn8j`). It is a one-time Price with no recurring interval or subscription. Public Checkout, account, Share trial, cleanup, sales, tax, and receipt gates remain off. Only the signature-verified Stripe webhook and its purchase-state handler are active for the supervised production acceptance described below.
- Quality/document-check failures, provider or network failures, Turnstile failures, aborts, global-limit failures, and browser-local cache hits do not consume an AI use. A short server-side reservation is completed only after a safe final result and is otherwise released.
- `workers/gluco-plus-entitlement/` is a non-public, disabled foundation. It includes short-code email-account and recovery routes, account deletion for accounts without purchase records, an explicitly environment-bound Stripe Checkout/Webhook adapter, and a server-side guard that reuses or blocks an unfinished Checkout instead of creating a second payable session. The matching settings UI is also checked in but hidden.
- Fresh stopped Version `be6a1dbe-c9cf-4002-a997-13d93cf58c36` receives 100% of the non-public `glucoscope-plus-entitlement-staging` Worker. It keeps the four account-HMAC, Resend, and Turnstile Secret binding names encrypted; the corrected current Resend key passed the one-message provider-acceptance check described below without disclosure. `workers_dev=false`, preview URLs are off, there are no routes or Cron triggers, observability is off, and every account, cleanup, RPC, purchase, Checkout, webhook, sales-readiness, and tax-readiness switch is `false`. Earlier stopped and test-candidate Versions, including `acff4e32-ef5c-433a-83df-14958b192d62`, are historical and are not current rollback targets.
- Zero-percent staging candidate `8d206190-da81-4fa3-8e69-ee1277e3c1f5` contains the Share Studio reservation/completion/release contract with account HTTP and entitlement RPC enabled only for private acceptance. Purchases, Checkout, webhook, cleanup, sales readiness, tax readiness, public routes, Cron, preview URLs, and `workers.dev` remain off. The stopped Version remains at 100%.
- Both APAC D1 databases now exist. `glucoscope-plus-staging` and `glucoscope-plus-production` have migrations `0001` through `0008`; migration `0008` failed closed unless the four Checkout/refund state tables were empty, then allowed both test and live Stripe Checkout IDs without changing their other constraints. Current production Version `da51939d-7805-45fe-9ddd-45a3cc8e8ceb` receives 100% and enables only entitlement RPC, purchase-state processing, and the signature-verified Stripe webhook; Checkout HTTP, account HTTP, Share trial HTTP, cleanup, sales readiness, tax readiness, and receipt readiness remain false. Stripe has one enabled live, non-Connect webhook destination at `https://plus.glucoscope.app/v1/stripe/webhook`, pinned to API Version `2026-06-24.dahlia` and limited to the seven reviewed Checkout and refund events. Public Checkout, account, and Share requests return the stopped `503` response with `no-store`, while an unsigned webhook is rejected with `400`. Stopped Version `12857f78-e233-4159-84bc-78c3fa56c76a` is the only reviewed production rollback point. Version `0cbbc227-6da0-41c3-9fd5-f280cd291152`, Version `7e823112-d8c1-4f8d-b563-101641169ce8`, unserved Secret Version `0b4842a9-9a62-4705-8358-612f926ad767`, and every earlier production Version must not receive traffic.
- The local Share Studio browser acceptance used only synthetic glucose data and a synthetic verified-account response. Daily Snapshot PNG creation, the health-information warning, PC entry, successful one-time trial completion, second-use rejection, and an error-free browser console passed. This did not invoke the remote Worker or write D1. A Windows `workerd` crash prevented the localhost remote service-binding bridge from starting, so the candidate-to-real-D1 Share Studio E2E remains pending and must not be claimed from the local result.
- Earlier unserved Version `a0805f46-8585-47c5-b431-dfcb463d2993` first staged the JPY 400 code and two non-secret Stripe test identifiers with every flag false. It is historical and is not a current rollback target.
- A temporary localhost-only remote preview then accepted synthetic old and fresh rows. Cleanup removed only the old rows; request-code returned a safe `503` before reaching `429`, and verify returned `400` before reaching `429`. Invalid placeholder Turnstile and Resend values prevented provider or email calls. The preview was stopped, every known synthetic row was deleted, and all 12 application tables returned to zero. No public route, real email, or Secret was used.
- On 2026-08-16 JST, a second closed acceptance used a dedicated Managed Turnstile widget restricted to `localhost`, with pre-clearance off, and a private localhost harness that reached only a zero-percent candidate through a service-binding Version override. A controlled request-code check returned `400`; the one real request then returned `200 code_sent`, one Resend message arrived in the operator's personal inbox, code verification and the authenticated session check each returned `200`, account deletion returned `200`, and the old session returned `401`. The exact test send-reservation row was removed and all 12 application tables returned to zero. Stopped Version `bbc6c159-ce64-4fbf-a120-a43f9c5ca5d9` was restored to 100%, the public `workers.dev` URL returned `404`, and public account UI, sales, and payment remained off. No email address, code, token, Secret, site key, or candidate Version ID is recorded.
- On 2026-08-18 JST, the same localhost-only boundary accepted a full same-email recovery. The first code created session A; a second code, sent after the enforced 60-second resend wait, created session B. The harness confirmed session A returned `401`, session B returned `200`, and account deletion returned `200`. A mismatched dedicated Turnstile Secret initially failed closed with `403` before D1 or email; after the operator replaced it without exposing its value, the real widget and both inbox deliveries succeeded. The two known send-reservation rows were removed, all 12 application tables returned to zero, the preview stopped, and corrected-secret stopped Version `809ecd8b-8e37-40f9-9f6b-7d006cdd52b6` was deployed alone at 100%. Public account UI, Checkout, sales, routes, and Cron remained off throughout.
- A later resend-safety acceptance attempt on 2026-08-18 stopped at `403 turnstile_failed` before D1 or email. Repeated user clicks did not create an account, challenge, send reservation, session, purchase, or entitlement, and no delivery was accepted as evidence. The localhost remote-development service-binding bridge also failed while forwarding an otherwise valid diagnostic request, so this path remains historical failure evidence only.
- Later that day, after the operator replaced the Resend key without exposing its value, a zero-percent candidate received exactly one request through a temporary Custom Domain and a Version override. It used Resend's official safe test recipient, not a personal address. The Worker returned `200 code_sent`; both the challenge and global send reservation reached `sent`, proving provider acceptance with the corrected key. This does not claim personal-inbox arrival. The two exact test rows were deleted, all 12 application tables returned to zero, the candidate and temporary domain were removed, `workers.dev` returned `404`, and fresh stopped Version `acff4e32-ef5c-433a-83df-14958b192d62` was deployed alone at 100%. Public account UI, Checkout, sales, routes, preview URLs, and Cron remain off.
- The current resend-safety code then passed a separate closed acceptance on 2026-08-18. A synthetic invalid-email preflight used Cloudflare's official test Turnstile pair only on an unserved candidate and returned `400`, proving the request crossed Turnstile without reaching D1 or Resend. The operator then received both the initial and explicitly requested resend in the same personal inbox, verified the latest code, confirmed the authenticated session, and deleted the test account; each accepted operation returned `200`. The official test pair's hostname is not a production identity signal, so this exception existed only in the isolated candidate; production hostname and action checks remain strict. The preview stopped, the candidate was detached, the exact two opaque send-reservation rows were deleted, all 12 application tables returned to zero, and stopped Version `acff4e32-ef5c-433a-83df-14958b192d62` was restored alone at 100%. No email address, code, token, Secret, site key, or candidate Version ID is recorded. Ordinary users receive one code and enter the latest code once; a second message is sent only when they explicitly request a resend.
- A separate safe abnormal-delivery acceptance on 2026-08-18 used only Resend's official test recipients through an unserved candidate. The Dashboard distinguished `Bounced`, `Complained`, and `Suppressed`; the real Suppression List remained empty. Resend provides no deterministic `delivery_delayed` test recipient, so actual delayed-delivery observation and the runbook response remain pending. The three exact anonymous test challenges and reservations were deleted, all 12 application tables returned to zero, the preview stopped, the candidate was detached, and stopped Version `acff4e32-ef5c-433a-83df-14958b192d62` was restored alone at 100%. No real recipient, email address, code, token, Secret, site key, provider identifier, or candidate Version ID is recorded.
- On 2026-08-17 JST, a closed Stripe sandbox drill used one opaque synthetic account through a localhost-only harness and a zero-percent Checkout candidate. Stripe Checkout displayed JPY 400, one-time payment, 30 days, and no automatic renewal. A sandbox card completed payment; the signed `checkout.session.completed` webhook granted exactly one 30-day entitlement. Re-sending the same event kept one payment event and one entitlement. A full JPY 400 Dashboard refund then delivered `refund.created`, `charge.refunded`, and `refund.updated`; the Checkout attempt and entitlement both became `refunded`. The synthetic rows were deleted, all 12 application tables returned to zero, the temporary remote preview stopped, the Stripe webhook destination was disabled, and its temporary Cloudflare Custom Domain was deleted. No real charge, card data, email address, Stripe key, webhook Secret, or health data is recorded.
- A second closed Checkout drill on the same day covered concurrent clicks, pending-Checkout reuse, expiry, recreation, and a declined-card boundary. Two simultaneous requests created exactly one hosted Checkout: one returned `checkout_ready` and the other `409 checkout_creation_in_progress`; a later request reused that Checkout. A correctly signed, manually re-sent `checkout.session.expired` event changed the D1 attempt from `open` to `expired` exactly once. The next request created a different Checkout and a following request reused it. Stripe-hosted Checkout clearly rejected the declined-card test and created no entitlement. The unused full-access standard sandbox Secret was rotated immediately; the integration continues to use only its scoped restricted test key. The final synthetic Session was expired, the exact synthetic account was deleted, all 12 application tables returned to zero, stopped Version `c917affd-74ed-4691-a3c6-b6c8e3149e3c` was restored alone at 100%, the webhook destination was disabled, and the temporary Custom Domain and localhost harness were deleted. No Secret value, hosted Checkout URL, card data, email address, or health data is recorded.
- On 2026-08-18, the Stripe public support contact was changed to `support@glucoscope.app`, the default customer-email language was changed to Japanese, the business website was corrected to `https://glucoscope.app/`, and the previously stale donation-only business description was replaced with the current JPY 400 one-time Plus 30-day-pass description. The hosted sandbox refund receipt then displayed Japanese copy, JPY 400, the public support address, and the current website. Both manually sent refund receipts reached the operator; the second was initially missed because the mailbox placed it in spam, not because Stripe failed to send it. No further resend was attempted. The Japanese refund-receipt delivery and wording are accepted, while an ordinary successful-payment email and receipt remain pending and `PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED` stays `false`.
- On 2026-08-19, a private service-binding Version override reached only a zero-percent live Checkout candidate. A scoped live restricted key with Checkout create/read plus Charge, Refund, Product, and Price read permissions created exactly one JPY 400 one-time Checkout. After explicit operator approval, the real payment completed, the signed webhook granted exactly one 30-day entitlement, and Stripe independently reported a paid JPY 400 payment. A full JPY 400 refund succeeded; `charge.refunded` changed the Checkout attempt and entitlement to `refunded`. The exact synthetic account and its payment/refund rows were deleted, and all 13 production application tables returned to zero. No email, card data, hosted Checkout URL, Secret value, or health data is recorded. Ordinary successful-payment email delivery remains pending, so public Checkout and receipt readiness stay off.
- The disabled cleanup foundation removes verification-code rows after they have been expired for 24 hours and global send-attempt reservations after they are 24 hours old. Staging has no Cron trigger, so cleanup is not scheduled there. If a reviewed environment later runs it hourly, those temporary records remain for about one day (normally no more than about 25 hours past the relevant boundary). Verified-account, purchase, and accounting retention remains a separate unresolved decision.
- `glucoscope.app` was purchased on 2026-08-15 for USD 14.20 per year. Automatic renewal is off. The planned verification sender is `no-reply@auth.glucoscope.app`; renewal and the then-current price must be reviewed before expiry.
- The USD 5/month Cloudflare Email Service / Workers Paid route was not subscribed and has been abandoned for Plus verification mail. Resend Free is the approved candidate: USD 0/month, 3,000 emails/month, 100/day, and one domain as of 2026-08-15. Ordinary sending records and message bodies may remain for up to 30 days. A destination that hard-bounces or reports spam can remain longer on Resend's team-wide Suppression List, where sending is skipped until the operator confirms the cause is resolved and removes it manually. The provider receives the destination address; the message contains a six-digit code that expires after 10 minutes and short fixed input instructions. It contains no glucose, name, connection, AI, or purchase content, and open/click tracking stays off.
- A provider HTTP `200` means acceptance for a delivery attempt, not proof that the intended inbox received the message. The closed test above separately confirmed one real inbox arrival. Before broader sending, the operator must still review bounce and spam-complaint rates daily, keep them below 4% and 0.08%, and pause local sending before those boundaries are reached. No fixed provider requests-per-second value is canonical here; the real Resend Usage page, response rate-limit headers, and `429`/`retry-after` take precedence.
- The checked-in next candidate tells the user that delivery can take several minutes, points to junk/categories/the existing GlucoScope thread, shows a 60-second resend countdown, and requires a fresh Turnstile check for each resend. A successful resend replaces the previous code only after the provider accepts the new message and D1 marks it sent; a clearly failed resend preserves the previously delivered challenge and the browser's in-memory grant. The bounded `Retry-After` handling and the operator procedure for delayed, failed, bounced, complained, and suppressed mail are covered by tests and [`PLUS_EMAIL_DELIVERY_RUNBOOK.md`](docs/Operations/PLUS_EMAIL_DELIVERY_RUNBOOK.md). This candidate is not deployed; additional small-inbox acceptance and real `delivery_delayed` observation remain required.
- `auth.glucoscope.app` is verified for sending in Resend after the required SPF, DKIM, MX, and DMARC records were added manually in Cloudflare DNS and resolved publicly. Receiving is off and open/click tracking is not configured. Closed-test credential values are not recorded here. They remain encrypted on the stopped staging Version, which has no public route or enabled account/email path.
- The Plus D1 binding exists only in the stopped staging environment. The Stripe webhook destination is disabled, its temporary Custom Domain has been deleted, and there is no public account route, Checkout, Cron, or live purchase path. Every public account, purchase, quota, and feature switch remains `false`, so no public email or payment request can start. The checked-in candidate now has a visible final order review instead of a short browser prompt, a non-personal Stripe payment description, a separate fail-closed receipt-email acceptance gate, and the 90-day minimal HMAC retention needed to prevent a completed Share Studio trial from being reacquired after account deletion. A rollout-hidden Share Studio Daily Snapshot now creates its PNG entirely in the browser and sends only the existing opaque account session plus a random request ID to separately gated reserve/complete/release endpoints; connection credentials, glucose values, and the image do not go to Plus D1. The `0007` migration, minimal six-field schema, empty-state boundary, and stopped-environment lifecycle are accepted in staging. Share Studio still needs closed browser/Worker acceptance before any flag is enabled. Public account access and sales remain no-go until additional small-inbox acceptance, real delayed-delivery handling, actual Stripe receipt-email acceptance, professional review, acceptance of any additionally enabled payment method, and production acceptance pass.
- AI quota and Plus feature-gating code are also checked in disabled. Existing AI and custom-range behavior therefore remain unchanged until the remaining identity and recovery work, refunds, tax, support, public-demo anti-bypass handling, payment acceptance, and production acceptance are complete.
- The public Usage Dashboard may show only privacy-protected totals for the 30 completed days through yesterday. Exact totals are omitted until at least 10 consenting device profiles contributed. The Access-protected administrator dashboard may request only the aggregate number of currently active Plus accounts; it never links Plus to a display name or device profile.

## Long-lived Gluroo device session — live early access

- On 2026-08-16, the one-hour JavaScript-readable relay ticket was replaced in the 1–3 person early-access path by an anonymous device session at `https://relay.glucoscope.app`, called only from `https://glucoscope.app`. Both production endpoints use HTTPS, the relay custom domain is active, and the old public `workers.dev` target is disabled.
- The relay sets a host-only `__Host-glucoscope_relay_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`. JavaScript never receives or stores the raw session token. The released implementation has no legacy ticket endpoint or acceptance path.
- Real-device acceptance used relay Version 21 (`91a36e38-1fa4-4fe2-80cf-a74327ccef90`) at 100%. Version 20 (`7e356782-976a-4e46-9692-70ea1689462a`) was the reviewed stopped rollback at that checkpoint. After obsolete Secret cleanup, current live Version 22 is `b4b2064d-6dd4-4de6-8a68-3d0d39aea2ec` at 100%, and unserved stopped rollback Version 23 is `10d0a825-c098-462e-89fd-a69937c47a9b` with both activation flags `false`. Versions 20 and earlier must never be used as direct rollback targets for the current frontend.
- The session expires after 180 days without successful use. Successful use rolls the idle expiry forward, but permanent access is not promised. Browser-data removal, expiry, a security change, explicit deletion, or emergency revocation can require one new safety check.
- The per-device SQLite Durable Object stores only an HMAC-derived session-token ID, creation time, last successful use, idle expiry, revocation state, an HMAC fingerprint derived from the canonical Gluroo URL and credential, and a UTC day bucket/count. It does not store the raw token, raw URL, credential, glucose data, display name, email address, IP address, or User-Agent. The relay identity is not joined to the optional Usage profile or Plus identity.
- Deleting a connection removes the locally saved URL and credential first, then attempts to revoke the server session and clear its cookie. Local deletion never waits for or depends on the network. The anonymous server session becomes invalid at its existing idle deadline, cannot retrieve glucose without the browser-held URL and credential, and is eligible for alarm cleanup afterward; an exact physical-deletion time is not promised.
- The existing early-access connection completed one new safety check after migration. On the tested iPhone, Dexcom G7 remained connected when GlucoScope was opened again from the Home Screen icon. The beginner guide still asks the person to add GlucoScope to the Home Screen first, open the icon, and make the initial connection there: WebKit can copy cookies into the Home Screen app but does not copy local storage. See [WebKit's Home Screen web app storage note](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).
- The same iPhone fully closed the existing Home Screen app from the app switcher and reopened the same icon after the iOS safe-area correction was published. G7 remained available without reconnecting, and the system status bar no longer overlapped the GlucoScope header. This completes the Home Screen relaunch and top-layout acceptance. The existing icon was kept throughout; deleting or re-adding it was not required.

## User Foundation 0.4 / 1–3 person early access

The root page remains Kazuma's public demo. The user-data route is:

```text
user.html
```

or:

```text
index.html?mode=user
```

Two connection routes are kept separate:

- an existing Nightscout environment is read directly by the browser;
- Gluroo Global Connect uses the Gluroo-only Limited Data Relay because direct browser access is blocked by provider-side CORS in the verified environment.

The Gluroo relay accepts glucose entries only. It does not retrieve treatments, insulin, carbohydrates, medication, pump settings, or device-status data. The Gluroo URL, token, and glucose response pass transiently through Cloudflare infrastructure and the relay Worker, but the application does not store, cache, log, send to AI, or share those raw values. The live early-access Version uses the anonymous per-device record described above. A replacement connection must return at least one valid glucose entry before the new device session replaces the existing one, so a typo, an empty source, or an upstream failure does not discard a working connection. Rollback uses a reviewed stopped Version of the same device-session code; the old ticket Versions are retained only as historical evidence.

The first end-to-end acceptance used this path:

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

Historical ticket acceptance record: on 2026-08-06, the Guardian route completed its first iPhone Safari acceptance through Turnstile, the signed relay ticket, Gluroo, and GlucoScope. Later the same day, the FreeStyle Libre 2 route completed its first basic end-to-end acceptance from FreeStyle LibreLink through LibreLinkUp, Gluroo, the limited relay, and GlucoScope. Current glucose, graph display, reload, and return from the iOS Home Screen passed in Safari Private Browsing. Closing Private Browsing removed its browser-stored configuration as expected; normal-tab persistence after fully quitting Safari was not retested by user choice. On 2026-08-12, the general-user Dexcom G7 route completed a supervised iPhone Safari acceptance through Gluroo and the limited relay: connection, current glucose, the graph periods today, yesterday, 7 days, and 30 days, display after reload, and connection deletion returning to setup all passed. Natural ticket expiry, persistence after fully quitting Safari, and live request-limit exhaustion were not part of that acceptance. The relay was returned immediately to `RELAY_ENABLED=false` after that check. Later on 2026-08-12, after a separate explicit approval, the accepted Usage and relay Versions were enabled continuously for a 1–3 person early-access group. This is not a broad public rollout. Separately, the public-demo Worker first completed source-specific G7 and Libre checks, then one approved Guardian/Libre/G7 public-page acceptance. After frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published by Pages run `31181233497`, the dedicated demo Worker began continuous public operation at 22:10:05 JST. This public-demo decision applies only to Kazuma's explicitly consented, public and non-anonymous Libre and G7 demo data.

Historical ticket checkpoint: Phase 3A connected the user onboarding flow to the paused relay client. Phase 3B created the paused Worker shell and SQLite Durable Object in Cloudflare, registered the required Worker Secrets, and passed stopped-response/CORS smoke tests. Ticket deployment `5f8d00d9-9d68-4b2a-99cd-c58c26123684` later routed accepted ticket Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` for the 1–3 person early-access group; stopped ticket Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` was its rollback artifact. Those Versions and the old `workers.dev` target are historical evidence only.

Current device-session checkpoint: the frontend uses only `relay.glucoscope.app`, the separate consent checkbox has been replaced by a plain processing explanation, and the live Worker has no ticket compatibility path. The checked-in fail-closed baseline remains `RELAY_ENABLED=false`, `RELAY_DEVICE_SESSIONS_ENABLED=false`, `workers_dev=false`, Preview URLs off, and observability off; the accepted live Version used reviewed runtime overrides. Usage Version `e7b2a895-c418-4cb2-b565-d2a37bef8e1b` receives 100% of Usage traffic. Direct Nightscout and the separately consented public demo remain independent.

## 3CGM Comparison Lab

The comparison lab is now a continuous public live demo. Current new-origin Version `97b14023-f9dd-440a-8b79-e2bb2b471697` receives 100% of traffic. Existing reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` and deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` record the earlier three-source acceptance at 22:10:05 JST. After the 22:15 Cron, the sanitized public responses contained 528 Libre entries and 290 G7 entries; a second scheduled aggregate check observed 526 Libre entries and 290 G7 entries. Both checks returned `200` for both routes with `stale=false`, fresh snapshots and latest readings, exact source IDs, and the reviewed schema, field allowlists, types, ranges, ordering, CORS, cache, and size boundaries. No glucose value, exact measurement timestamp, source credential, or Secret value entered validation output or Git. A new browser session showed `公開デモ · ライブデータ`, three available and selected source controls, the three-source chart message, and Guardian, Libre, and G7 cards without an update-delay state. The same open tab then completed one five-minute automatic refresh with all three sources still live, the Libre displayed-point aggregate changing from 526 to 525, and no console error. At about 01:10 JST on 2026-08-08, a read-only continuation check confirmed that deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` and live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` still received 100% of traffic. Both routes returned `200` with 526 Libre and 290 G7 entries, `stale=false`, fresh snapshots and latest readings, and passing reviewed schema, freshness, private-marker, CORS, cache, response-size, field, type, range, and ordering checks. KV contained exactly the two expected keys, each with a recent remaining TTL greater than 35 hours and no more than 36 hours 15 minutes. The existing public browser tab was inspected without reload at about 01:05 JST and again about five minutes later; both views remained three-source live, the displayed update age moved from about zero to about one minute instead of aging by five minutes, and the console stayed error-free. This verifies about three hours of continued operation and one further five-minute auto-refresh at a later checkpoint, bringing the total confirmed browser refreshes to two; it is not an overnight observation. Natural expiry is not expected during healthy operation because each successful five-minute refresh resets the 36-hour snapshot TTL, so natural expiry is now a separate, non-blocking stopped/failure-path test. The lab does not rank devices, claim accuracy, select a reference CGM, or support treatment decisions.

Historical 3CGM delivery sequence and current follow-up:

1. Completed after separate explicit approval: verify one Libre public-demo scheduled retrieval and sanitized public response, then restore the stopped Worker and confirm that the next stopped Cron does not extend the Libre snapshot expiration.
2. Completed: publish the configured stopped G7 frontend endpoint with `dexcomRouteVerified=false` and verify the synthetic fallback on GitHub Pages.
3. Completed after separate operational approval: briefly enable the required demo feeds and verify Guardian, Libre, and G7 together on GitHub Pages once.
4. Completed after the live check: restore the stopped Worker, verify both routes return `503`, verify a new page returns to the synthetic fallback, and confirm that the next stopped Cron does not extend either source snapshot expiration.
5. Completed after the frontend safety release and continuing-publication decision: start the continuous public 3CGM demo with the reviewed live Version, verify two fresh scheduled aggregate checks, and verify one new browser session plus its first five-minute automatic refresh.
6. Completed: confirm about three hours of continued live operation, one further five-minute auto-refresh at a later checkpoint for two confirmed browser refreshes in total, and healthy two-key KV refresh lifetimes without exposing glucose values, exact measurement timestamps, credentials, or Secrets.
7. Completed on 2026-08-12: verify the general-user Dexcom G7 connection, current glucose, today/yesterday/7-day/30-day graph periods, reload, and connection deletion in iPhone Safari, then return the relay to `RELAY_ENABLED=false`.
8. Completed on 2026-08-16: migrate the approved small group from the historical ticket relay to the long-lived device-session Worker, custom domain, and new-origin site; accept the one-time safety check and G7 Home Screen relaunch without reconnecting.
9. Current relay state: route 100% to Secret-clean live Version 22 (`b4b2064d-6dd4-4de6-8a68-3d0d39aea2ec`) and keep unserved stopped Version 23 (`10d0a825-c098-462e-89fd-a69937c47a9b`) as the direct rollback. Never roll the new frontend back to Version 20 or earlier.
10. Non-blocking later: exercise demo-snapshot natural expiry in a deliberately stopped/failure-path window; healthy five-minute refreshes reset the 36-hour TTL, so expiry is not expected during normal continuous operation.
11. Completed on 2026-08-16: accept the atomic Worker usage counter and privacy-protected Usage Dashboard in production, apply the Friends & Family connection and device-specific manual improvements, and complete the site-wide Trust/About wording review. The migrated public Guardian demo was restored by adding only `https://glucoscope.app` to the existing Azure App Service CORS allowlist; the existing localhost and old Pages origins were retained. Both approved-origin preflights returned `200`, Nightscout status returned `200`, and a fresh public browser session showed `LIVE` / connected again without recording glucose values or exact measurement times. Current follow-up: finish Plus sales blockers before any first announcement or sale.

Guardian is read directly from Kazuma's existing public Azure Nightscout. Libre uses the separate `workers/gluco-demo-feed/` Worker design: scheduled Gluroo fetches update an expiring sanitized KV snapshot, and public visitors read only that snapshot. The same Worker includes a separately gated G7 route. Kazuma explicitly chose to make his own Libre glucose values and measurement/update timing public for this demo. On 2026-08-07, he separately and explicitly chose to publish his own G7 glucose values and measurement/update timing through the same public comparison. These choices apply only to Kazuma's consented demo data; they do not authorize storing or publishing any general user's data. The public demo now continuously serves the reviewed Libre and G7 snapshots while the source gates remain enabled in the deployed Version. GlucoScope is not affiliated with Gluroo, the demo is not for medical decisions, and Gluroo Global Connect is not marketed as a free alternative to subscription Nightscout services. The general-user Limited Data Relay is separately enabled only for the 1–3 person early-access group and keeps its no-glucose-storage boundary.

The demo Worker remains checked in with the global `DEMO_FEED_ENABLED=false`, source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`, no application logging, and Worker observability disabled. Those safe defaults have not changed. Current production routes 100% to new-origin Version `97b14023-f9dd-440a-8b79-e2bb2b471697`. Cloudflare's normal `workers.dev` route remains enabled and versioned Preview routing remains disabled. The published frontend keeps `dexcomRouteVerified=true` because the G7 display path passed; this frontend flag does not enable either Worker route. Earlier live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` and stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` are preserved as historical old-origin acceptance and rollback evidence, not asserted here as the current direct rollback pair.

Historical stopped-deployment checkpoint: after separate explicit approvals on 2026-08-06, one dedicated KV namespace was created and the stopped `glucoscope-demo-feed` Worker was deployed as Version `4c8d40de-8877-4d70-800e-1607e1940b96`. A later explicit approval registered exactly the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets; their values were not printed, logged, or added to Git. Another explicit approval reapplied the stopped configuration as Version `f8801d58-67bd-4cf9-8cb1-dd227c879446`. On 2026-08-07, after separate stopped-deployment approval and review, multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was uploaded and deployed to 100% of production traffic with all three gates still `false`. At that checkpoint, both source routes returned `503 demo_feed_paused`, approved-origin G7 preflight returned `204`, an unapproved browser origin returned `403`, the five-minute Cron exited before Secret access, Gluroo fetch, or KV write, and the dedicated KV remained empty after a Cron boundary. The Cloudflare subdomain setting remains `enabled=true` with `previews_enabled=false`; version-level `has_preview` metadata does not mean the public Preview route is enabled. This paragraph records the earlier stopped checkpoint; the current production state is the continuous live Version described above.

The deployed multi-source revision declares the G7 Secret names `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`, the separate `public:dexcom-g7:v1` KV key, and the stopped `/v1/dexcom-g7` route. After separate explicit approval on 2026-08-07, the two G7 values were entered through masked prompts with `wrangler versions secret put`, creating unpublished Secret-only Versions `0e095e0a-63de-4b01-8c0f-2dd8f1e169a1` and `834019da-0cd1-41d8-8cff-41eab1062a00`. The deployed Version inherited exactly the four Libre/G7 Secret names; Secret values were not placed in command arguments, captured output, or Git, and temporary registration logs were removed after verification. After another explicit approval, G7-only Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100% as deployment `5b7a0099-9425-4ddf-a500-68e2ed834ea5`, with the global and G7 gates `true` and the Libre gate still `false`. One scheduled refresh wrote only `public:dexcom-g7:v1`. The public `/v1/dexcom-g7` response contained 190 entries and passed the reviewed field, type, range, ordering, recency, CORS, and private-marker checks without printing glucose values or measurement times. Libre remained paused. Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored at 100% as deployment `8de64190-7558-43c6-83c1-1e29a2cf80de`; both source routes again returned `503`, and the next stopped Cron did not extend the G7 snapshot expiry. At that historical checkpoint, the published frontend configured the stopped G7 URL with `dexcomRouteVerified=false`, and GitHub Pages synthetic fallback verification passed. The later simultaneous live acceptance is recorded below. Raw exports, credentials, and unreviewed candidate files remain out of Git.

After another separate explicit approval on 2026-08-07, Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was temporarily deployed for one scheduled refresh. The 19:25 JST Cron produced a public `/v1/libre` response containing 523 entries. Aggregate-only validation passed the reviewed top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. G7 remained paused at `503`. Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored; both source routes again returned `503`, and the next stopped Cron did not extend the Libre snapshot expiration. This earlier checkpoint verified one Libre scheduled retrieval and sanitized public Worker response only; the later simultaneous live acceptance is recorded next.

After separate operational approval, live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` was deployed at 100% as deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST. The sanitized public responses contained 527 Libre entries and 276 G7 entries, and aggregate-only checks passed for the reviewed fields, types, ranges, ordering, recency, and exact CORS. No glucose value, measurement timestamp, Gluroo URL, Secret, or token was printed or added to Git. GitHub Pages showed Guardian, Libre, and G7 as live with all three cards enabled, and Kazuma visually confirmed the three plotted lines. At that checkpoint this was one public-page acceptance; continued operation, repeated browser display refreshes, stale behavior, and natural expiry were still unverified. The review window crossed scheduled triggers, so no exact scheduled-refresh count was claimed.

Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was restored at 100% as deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4` at 21:16:31 JST. Both public routes returned `503`, and a newly opened GitHub Pages view returned to the clearly labelled synthetic dataset. After the 21:25 JST stopped Cron, metadata showed only the two expected source keys, no metadata payload, and unchanged expirations for both keys. This confirms that the stopped Cron did not refresh either snapshot or extend either expiration. `dexcomRouteVerified=true` remains in the frontend as a display-path verification record; it is not a Worker enable switch. At that historical checkpoint, the general-user Limited Data Relay remained stopped.

Historical continuous-publication acceptance started after frontend safety commit `6f13ed8c9c4b4b5cda1bdaddc7b90a02bbff1265` was published successfully by Pages run `31181233497`. Deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` assigned 100% of demo-Worker traffic to reviewed live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` at 22:10:05 JST. Repeated scheduled aggregate checks, about three hours of continued live operation, and two browser auto-refresh checks at separate checkpoints passed. This was not an overnight observation. Natural expiry remains a separate, non-blocking stopped/failure-path acceptance because healthy five-minute refreshes reset the 36-hour snapshot TTL. The frontend derives each source's freshness from the latest reading or upstream stale state with a 15-minute boundary. A previously live view is preserved for at most 15 minutes during transient failures and then falls back to labelled synthetic data. Pause immediately if Kazuma withdraws consent, Gluroo objects or materially changes applicable terms, unexpected data or abnormal traffic appears, or a privacy or safety concern is found. At that old-origin checkpoint, the reviewed emergency rollback command used stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`; it is historical evidence, not the current rollback instruction for the new-origin Version.

The unlinked `tools/cgm-comparison-capture/` helper remains available for a later reviewed three-source static snapshot. It uses browser memory only, does not load analytics, and does not persist connection details.

Design and safety details are documented in:

```text
docs/Feature_Specs/CGM_COMPARISON_DEMO.md
```

Run the frontend tests with:

```bash
node --check js/data-source.js
node --check js/data-relay-client.js
node --check js/local-profile.js
node --check js/app.js
node --test test/data-source.test.mjs test/data-relay-client.test.mjs test/local-profile.test.mjs test/user-onboarding.test.mjs test/privacy-boundary.test.mjs test/trust-pack.test.mjs
```

The design and safety boundaries are documented in:

```text
docs/Feature_Specs/USER_DATA_SOURCE_FOUNDATION.md
docs/Feature_Specs/USER_ANALYTICS_FOUNDATION.md
docs/Feature_Specs/LIMITED_DATA_RELAY.md
```

## GitHub Pages setup

Use the repository root as the GitHub Pages source.

1. Push the latest `main` branch to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` → `Pages`.
4. Set `Build and deployment` to `Deploy from a branch`.
5. Select:
   - Branch: `main`
   - Folder: `/ (root)`
6. Save.

The repository-root `CNAME` makes the expected public URL:

```text
https://glucoscope.app/
```

Configure and verify the same custom domain in GitHub Pages before publishing. The old
project-site URL is not an approved production Origin after this migration. This repository
includes `.nojekyll` so GitHub Pages serves the static files directly.

## Pre-publish checklist

Run these from the repository root before publishing:

```bash
git status
git rev-parse HEAD
git ls-files | grep -E '(^|/)(\.env|\.dev\.vars)'
```

The last command should return nothing.

Also check that secrets are not committed:

```bash
git grep -n -E 'sk-[A-Za-z0-9_-]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}' -- .
```

This check looks for common secret value patterns. Documentation may mention secret names as examples, but real secret values must not appear.

## AI letter Worker on GitHub Pages

The frontend never calls OpenAI directly. It calls the production Cloudflare
Worker endpoint:

```text
https://gluco-letter-worker.afterglow21.workers.dev/api/gluco-letter
```

The currently published public demo enables AI letters by default. It does not require
`debugAiWorker`, `aiWorkerEndpoint`, or browser-local configuration. The published
personal-user route also enables AI after its first-use confirmation.

The following protections remain active:

- Cloudflare Turnstile
- Worker-side time-slot and daily generation limits
- browser-local cache behavior only; shared KV is disabled for every mode during early access
- Usage Dashboard and estimated-cost recording
- budget stops and safe error fallbacks
- medical and AI safety wording

For privacy, deployed public pages always use the production Worker endpoint.
The `aiWorkerEndpoint` query parameter and browser-local endpoint override are
accepted only on `localhost` or `127.0.0.1`.

For local development, the default endpoint remains:

```text
http://127.0.0.1:8787/api/gluco-letter
```

Enable the local AI button with either:

```text
?debugAiWorker=1
```

or:

```js
localStorage.setItem("glucoscope.aiLetterWorkerEnabled.v1", "true");
```

On a local host only, `aiWorkerEndpoint` or
`glucoscope.aiLetterWorkerEndpoint.v1` may override the local endpoint.

## Shared AI letter cache: Version 28 history and current production

Historical Version 28 let the public demo use a browser-local cache first and a shared Cloudflare Workers KV cache. The boundary first accepted in Version 29 and retained by the current atomic Version disables shared-KV read, write, and stale fallback for every mode, including the public demo. It keeps the KV binding only for staged recovery, not for a direct Version 28 restore while user AI is enabled. It does not read retained entries and lets them expire naturally within their existing maximum 24-hour lifetime. All modes use only the browser-local v14 cache, capped at 30 entries. A browser-provided `pageMode` is not an authentication boundary.

The historical Version 28 public-demo shared cache used the same page mode, language, period, morning/afternoon/night slot, analysis mode, and displayed range for the behavior below:

- a letter younger than one hour is reused without a new OpenAI request,
- cache displays do not consume a new-generation count,
- the shared KV value stores only the generated letter and minimal metadata, not the glucose summary,
- entries expire automatically within 24 hours after remaining available as a gentle stale fallback,
- incomplete OpenAI output is rejected; a `max_output_tokens` cutoff is retried once with a larger mode-specific limit, and partial text is never cached, and
- AI output is checked for Gluco-style Japanese wording and leaked internal labels; a failed first draft is rewritten once, and text that still fails is not shown or cached.

Production KV setup is documented in:

```text
workers/gluco-letter-worker/README.md
```

Current production fixes both `SHARED_AI_CACHE_ENABLED=false` and `AI_CACHE_ENABLED=false`. None of the Version 28 shared-cache bullets above describe current production. Do not interpret the retained binding or old KV entries as an active cache.

## Worker CORS policy

The production Worker uses an explicit browser-origin allowlist instead of `Access-Control-Allow-Origin: *`.
The current public origin is:

```text
https://glucoscope.app
```

A browser `Origin` contains only the scheme, host, and optional port, so the repository path is not included. Allowed browser responses echo the exact approved origin and include `Vary: Origin`. Disallowed browser origins receive `403`. Current production requires a present, approved Origin for AI-generation `POST`; originless Usage `GET` remains available for operational checks.

For local frontend development, add a non-committed Worker variable such as the following to `workers/gluco-letter-worker/.dev.vars`:

```text
CORS_LOCAL_ORIGINS="http://127.0.0.1:5500,http://localhost:5500"
```

CORS limits which browser pages can read the API response. It is not a replacement for Turnstile, usage guards, secrets, or other server-side controls.

## Cloudflare Web Analytics

Public-demo HTML pages use a local privacy-gated loader for Cloudflare Web Analytics aggregate page-view and performance monitoring. The loader does not fetch the analytics beacon when `mode=user` is active, when either GlucoScope user-connection storage key exists, when the usage browser-profile key containing a bearer credential exists, when the main page is configured to offer usage-profile enrollment, or when browser storage cannot be checked. Saving or removing the optional local display name alone does not disable or enable Cloudflare Web Analytics. This applies across the same-origin About and Trust pages as well as the main page. The archived `backup/` pages and setup guides are excluded.

Chart.js 4.5.1 is vendored under `vendor/chart.js/` with its MIT license. The user-data page therefore does not execute the chart runtime from a third-party CDN in the same origin context as browser-stored connection details.

GlucoScope does not add custom analytics events or a custom visitor identifier. Glucose values, GlucoScore, AI letter text, Nightscout URLs, API information, and mobile-tab actions must not be intentionally encoded into analytics event names or additional analytics data. Public-facing details are maintained in:

```text
pages/trust/privacy-notes.html
```

The Web Analytics token is a public site identifier embedded in HTML. It is not an API secret. OpenAI keys, Turnstile secrets, and other credentials must still remain outside the repository.

## Safe wording boundary

GlucoScope should use:

- 糖尿病とともに生きる人
- 血糖マネジメント
- 振り返り
- 手がかり
- やさしく

GlucoScope should avoid language that makes blood glucose data feel like blame, grading, or failure.
AI letters are supportive reflections, not medical judgment.

Gluco should also celebrate clearly when the summarized data contains a genuinely positive clue. TIR of 75% or higher, CV below 30%, and a latest reading near 100mg/dL may receive specific positive recognition. TIR of 100% should be celebrated enthusiastically. When today's latest reading is exactly 100mg/dL, Gluco may say `🦄 ユニコーンをつかまえた！` as a playful small-luck moment. These are writing rules, not medical grades, treatment targets, or judgments of the person.

Unicorn Gluco illustrations are also available as a local collection encounter. The browser watches only newly received latest-glucose entries while the page is open; it never searches historical data for 100mg/dL. A fresh new reading of exactly 100mg/dL can unlock one encounter per local day. The Letter-tab illustration stays Unicorn Gluco for that day without a new AI request, while the glucose-tab peek switches to Unicorn Gluco only while the current fresh reading remains 100mg/dL.


## User Foundation 0.4 onboarding details

The user-mode onboarding is designed for people with little technical knowledge, including older smartphone users.

- `index.html?mode=user` presents two clearly numbered routes and states that only one is needed.
- Tapping a route card advances immediately; there is no separate “select, then continue” button.
- Method 1 is the Gluroo route for FreeStyle Libre 2, Dexcom G7, and the verified Guardian Monitor input path.
- Method 2 is for people who already use their own Nightscout environment or can build and maintain one.
- Guardian (MiniMed 780G) uses the dedicated `guides/guardian-monitor/` path from Guardian Monitor to Gluroo Global Connect.
- The main setup uses `接続先URL` and `接続用の合言葉`; internal terms stay in implementation and developer diagnostics.
- The screenshot guide is maintained separately at `guides/gluroo-setup/` so Gluroo screen changes can be updated without redesigning the dashboard.
- Guide screenshots are displayed without fixed-position overlays. Numbered steps and captions identify what to look for without risking marker drift across devices.
- Separate preparation pages explain Dexcom Share, LibreLinkUp, and Guardian Monitor.
- The beginner guides now incorporate all 27 supplied LibreLink / LibreLinkUp captures and all 10 supplied Dexcom Share captures as one-screen-per-step walkthroughs. Personal fields in the supplied captures are masked, each guide warns that app updates may change screens, and both the return and completion actions resume the common Gluroo guide at STEP 22 (`#screen-22`).
- The screenshots and instructions are connection guidance only. Example glucose values or graph settings are not targets or medical advice; treatment decisions, alerts, and current sensor state remain with the original CGM app and the person's medical guidance.
- General-user Gluroo connection details may stay in the selected browser and pass transiently through the limited relay. The raw URL, connection passphrase, relay-session credential or identifier, and raw relay glucose response are not stored in Azure, KV, relay logs, shared AI cache, or sent to AI. The live per-device Durable Object keeps only the limited HMAC/timestamp/revocation/day-count fields described above. Only after separate first-use confirmation, the published user-AI route may send the derived selected-period summary described above; this does not send the connection details or raw entry list. The separate public demo feed now continuously publishes only Kazuma's explicitly consented Libre and G7 demo values and never receives a general user's connection details or glucose data. The frontend keeps `dexcomRouteVerified=true` as a record of the verified G7 display path, while the deployed demo-Worker Version independently controls publication. The general-user relay is currently enabled only for the approved small group.
- Existing Nightscout remains a direct browser route and does not use the limited relay.
