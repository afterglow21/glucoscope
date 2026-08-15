# GlucoScope Plus entitlement Worker

Local-only foundation for the proposed Plus 30-day pass.

## Fixed product boundary

- JPY 300, paid once.
- Thirty consecutive days from the verified payment-success timestamp.
- No subscription, automatic renewal, background charge, or customer portal.
- Usage profiles, display names, CGM data, connection credentials, AI input and output,
  and payment-card data never enter this service.
- Email HMAC identifiers, provider event identifiers, and Checkout Session identifiers
  remain internal and are never returned by RPC methods. Recoverable email is not stored.

## Current safety state

The checked-in configuration deliberately keeps RPC, purchases, Checkout HTTP, Stripe
webhooks, and account HTTP disabled. It has no public `workers.dev` URL, no preview URL,
no D1 binding, no outbound-email binding, no configured sender address, no Stripe
identifier, and no Secret declaration. Every checked-in public route therefore returns
`503 service_unavailable` before reading its request. Worker observability is also
disabled so account and payment operations do not enter the standard Worker logs.

The internal verified-payment function also checks `PLUS_PURCHASES_ENABLED` before it
reads payment identifiers, generates an entitlement ID, or touches D1. Missing or false
always fails closed; only an explicit true value allows processing to begin.

Checkout has a separate commerce-readiness gate. Even when the technical Checkout flag
is enabled, it returns `503 sales_not_ready` before authentication, D1, or Stripe unless
all of the following are explicitly confirmed: JPY 300 as the buyer's final total,
the seller's separately reviewed tax treatment, the reviewed buyer policy, a dated terms
version, and same-site public pages for the commercial disclosure, refund policy, and
support. Checked-in values remain false, undecided, or empty. The gate is defense in
depth, not a substitute for reviewing the actual pages and Stripe screen.

The owner-approved working refund policy is intentionally short: correct duplicate
charges or a paid-but-missing Plus grant, and issue a full refund if the operator cannot
resolve them; also issue a full refund after review when a major GlucoScope-side outage
made the principal Plus benefits mostly unusable and the operator could not resolve it.
There are no partial refunds, and a refunded payment ends its Plus entitlement. Card
statement visibility is described only as an ordinary 5–10-business-day estimate that
depends on the bank or card issuer. This is not a minute-by-minute SLA, and it does not
make every kind of request refundable. A public support contact and an executable refund-support procedure are
still unset sale blockers; the checked-in refund-policy path therefore remains blank.

Do not deploy this directory yet. After a real D1 database exists, add only its real
binding and migration directory to a reviewed environment configuration. Add the
outbound-email binding, sender address, and Secrets only to that reviewed environment
after the email and Stripe boundaries have been accepted. Never commit tester email
addresses, placeholder IDs, API keys, Webhook Secrets, HMAC keys, encryption keys, or
`.dev.vars`.

The current Wrangler dry-run can validate only that the module bundles. Because the
checked-in configuration intentionally has no `PLUS_DB` binding, neither named RPC
entrypoint is operational or ready to deploy. Calls fail closed while RPC is paused and
also fail closed if the D1 binding is absent.

## Passwordless account and recovery boundary

Account HTTP is checked in with `PLUS_ACCOUNT_AUTH_HTTP_ENABLED=false`. While that flag
is false, the five account paths return the same closed `503` response before Origin,
body, email, Turnstile token, or session token is read. No production test bypass exists.

The local foundation defines these future browser routes:

- `POST /v1/auth/request-code` accepts `{ email, turnstileToken }` and returns
  `{ ok: true, status: "code_sent", verificationGrant }`.
- `POST /v1/auth/verify` accepts `{ email, code, verificationGrant }` and returns
  `{ ok: true, status: "verified", sessionToken, session }`, where `session` is the
  same public ready snapshot plus `issuedAt` and `expiresAt`.
- `GET /v1/session` requires the Bearer session and returns
  `{ ok: true, status: "ready", accountVerified, plusActive, purchasePending,
  startsAt, endsAt, shareStudioTrialAvailable }`.
- `POST /v1/auth/logout` revokes the Bearer session and returns
  `{ ok: true, status: "signed_out" }`.
- `POST /v1/account/delete` requires the Bearer session plus
  `{ turnstileToken, confirmDelete: true }` and returns
  `{ ok: true, status: "account_deleted" }` when deletion is allowed.

They accept only the exact configured HTTPS Origin. Responses use `Cache-Control:
no-store`; approved responses echo only that exact Origin; unapproved origins receive no
CORS allow header. POST JSON is streamed through an 8 KiB limit. Sending a code and
deleting an account require separate Turnstile actions and an exact expected hostname.
Entering the emailed code does not require a second Turnstile interaction. Instead, a
random 256-bit `verificationGrant` binds verification to the successful request-code
call. Only its SHA-256 hash is stored. The browser keeps the grant only in tab memory,
never local storage or public UI state, and requires a new code after a page reload.

There is no password. A six-digit code expires after 10 minutes, permits five attempts,
cannot be resent for 60 seconds, and is limited to five sends per email HMAC per hour.
Cloudflare Rate Limiting bindings add an earlier per-connection boundary: request-code
allows 5 attempts per 60 seconds and verify allows 30 per 60 seconds, keyed only by the
validated `CF-Connecting-IP`. The key is passed to the binding but is not written to D1
or application logs. Rate limiting runs before body parsing, Turnstile, D1, or email.
A missing or invalid connecting address or binding failure fails only the enabled auth
route closed; when account auth is off, these bindings are not read.
Existing-account and new-account requests return the same `code_sent` result. A wrong,
expired, used, or exhausted code returns the same `invalid_or_expired_code` result.
Challenge rows whose code expired more than 24 hours earlier are opportunistically removed
when another code is requested. The checked-in hourly Cron also calls the same private
cleanup, but `ACCOUNT_AUTH_CLEANUP_ENABLED=false` makes it return without touching D1.
Only after the D1 binding and cleanup path are accepted may that flag be enabled. The
enabled job deletes challenge rows where `expires_at < scheduledTime - 24 hours` and
global send reservations where `reserved_at < scheduledTime - 24 hours`. With the hourly
schedule, either kind of temporary row normally remains for about 24 to 25 hours after
its respective boundary. The public explanation rounds this to “about one day.”
Successful verification revokes every older session for that account and issues a new
90-day random session token. This makes the same flow usable after changing or losing a
device. Logout revokes the presented token and is idempotent.

The ready-session response exposes only a boolean `purchasePending`. It is true while a
Checkout reservation is still unexpired, while a hosted Checkout remains open until its
state is reconciled with Stripe, while a received payment event is still being processed,
or during a ten-minute recovery window for a completed Checkout that has not produced an
active entitlement. It is always false while Plus is active. No Checkout identifier or
purchase timestamp is returned.

Account deletion requires a valid session, an explicit confirmation, and its own
Turnstile action. An account with no purchase record is removed together with all of its
sessions, Share Studio trial state, and auth challenges, so the same email may create a
fresh account later. If any entitlement or payment receipt exists, deletion makes no
changes and returns only `account_deletion_requires_support`. Legal, refund, and fraud
retention rules for purchase records must be approved before that support path is enabled.
Because a purchase-free deletion also removes Share Studio trial state, deleting and
recreating an account currently creates a fresh trial. A disclosed retention and abuse
rule must be approved before sale; this foundation deliberately adds no covert tombstone.

The complete normalized email exists only in request memory and in the private email
adapter call. D1 stores an HMAC lookup identifier and HMAC-protected short-lived code;
it cannot recover the email address. Migration `0002_account_auth.sql` replaces the old
reserved ciphertext field with the fixed marker `email-not-stored-v1` and installs
triggers that reject any other value. Session tokens are returned once and only their
SHA-256 hashes are stored. Email normalization preserves the potentially case-sensitive
local part and applies standard IDNA ASCII conversion and lowercasing only to the domain.

Email-HMAC rotation supports exactly a current and immediately previous key. The current
Secret is `ACCOUNT_EMAIL_LOOKUP_HMAC_KEY` with
`ACCOUNT_EMAIL_HMAC_KEY_VERSION`. During rotation, configure the prior Secret as
`ACCOUNT_EMAIL_LOOKUP_HMAC_PREVIOUS_KEY` with
`ACCOUNT_EMAIL_PREVIOUS_HMAC_KEY_VERSION`. A successful email-code verification finds
either HMAC and atomically rekeys the same account to the current HMAC while preserving
its account ID, entitlement, and trial state. A half-configured key pair, a version gap,
current version above 1 without its previous key, or simultaneous current-and-previous
accounts fails closed. A reviewed procedure for eventually retiring old keys is still a
production prerequisite.

The earlier disconnected Cloudflare Email Service prototype has been removed and
replaced locally by a Resend REST API adapter. Cloudflare Email Service / Workers Paid
was not subscribed, so there is no USD 5 monthly email-service charge. The Resend adapter
cannot send without the `RESEND_API_KEY` Worker Secret. There is also no D1 binding,
Turnstile Secret, email-lookup HMAC Secret, or code-HMAC Secret. Account HTTP remains
disabled, and a missing dependency still fails closed.

On 2026-08-15, the operator purchased `glucoscope.app` for USD 14.20 per year and turned
automatic renewal off. The planned dedicated sending subdomain is
`auth.glucoscope.app`, with `no-reply@auth.glucoscope.app` as the exact sender. Domain
continuation and the then-current renewal price must be reviewed before expiry.

Resend Free is the approved verification-email candidate. Its published limits on
2026-08-15 are USD 0/month, 3,000 emails/month, 100 emails/day, one custom domain, and
30-day ordinary sending-record and message-content retention. This is not a complete
recipient-retention limit: a hard bounce or spam complaint places the destination on
Resend's team-wide Suppression List, and sends from every team domain are skipped until
it is removed. The operator must confirm and resolve the cause before manually removing
the address through the Dashboard or API; another hard bounce or complaint suppresses
it again. The verification code itself expires after 10 minutes and is one-use;
provider retention never extends that validity. Resend's DPA separately describes
processing during the agreement and deletion of customer and user data within 90 days
after account termination; do not describe that as an automatic per-message or
Suppression List expiry while the account remains active.

The provider receives the destination address. The message has one fixed
Japanese/English subject and a short fixed explanation of how to enter the code; only
the six-digit code and 10-minute expiry vary. It contains no glucose data, AI content,
display name, profile data, connection detail, or purchase content. Open and click
tracking must remain disabled. Do not create a tracking subdomain. Do not add raw email
addresses, codes, tokens, provider errors, or payloads to Worker logs, D1, analytics, or
events. The provider message ID must not be stored by account auth.

`auth.glucoscope.app` has reached final `verified` status in Resend after the required
SPF, DKIM, MX, and DMARC records were added manually in Cloudflare DNS and resolved publicly.
Receiving is off, and no tracking subdomain or open/click tracking is configured. No API
key, Worker Secret, real email, or deployment has been used. Before the first closed
test, create a send-only API key scoped to this domain and keep it only as a Worker
Secret. Restrict the test to approved destinations, keep the existing per-email HMAC
limit, and keep the implemented D1-backed global cap at 80 accepted reservations per
rolling 24 hours, below the provider limits. Pending, sent, and failed attempts all
consume the cap, and reservation is atomic so concurrent requests cannot overshoot it.
Accept bounce, deferral, complaint, suppression, and delayed-delivery procedures
without copying raw recipients into D1 or application logs.
A provider HTTP `200` or `email.sent` event means that Resend accepted the request and
will attempt delivery; it does not prove arrival in the intended inbox. Confirm actual
receipt during the closed test. Review the Metrics dashboard daily and keep bounce below
4% and spam complaints below 0.08%; pause GlucoScope sends before either threshold is
reached and investigate the cause. Resend may pause or terminate accounts that exceed
these limits. Do not make a per-second provider number canonical because official pages
have shown different values. Check the real team Usage page and obey `ratelimit-*`,
`retry-after`, and `429` responses in addition to GlucoScope's own limits.
Recheck [Resend pricing](https://resend.com/pricing),
[message-content storage](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend),
[email suppressions](https://resend.com/docs/dashboard/emails/email-suppressions),
[the Resend DPA](https://resend.com/legal/dpa), and
[open/click tracking](https://resend.com/docs/dashboard/domains/tracking). Also recheck
[Resend Usage Limits](https://resend.com/docs/api-reference/rate-limit),
[event meanings](https://resend.com/docs/webhooks/event-types),
[delivered versus inbox arrival](https://resend.com/docs/knowledge-base/what-if-an-email-says-delivered-but-the-recipient-has-not-received-it), and the
[acceptable-use sending thresholds](https://resend.com/legal/acceptable-use) immediately
before the real test. Account and sales flags remain off until the real closed test and
the ordinary 30-day retention plus longer Suppression List exception are explicitly
accepted.

Suggested simple explanation for the future screen:

> このメールは、ログインと機種変更のときの確認に使います。血糖値やAIのお手紙をメールで送ることはありません。

The public request-code contract has a strict allowlist:
`{ email, turnstileToken, contactRole, adultConfirmed, guardianConfirmed }`.
The adult managing the purchase must explicitly confirm that they are 18 or older.
`contactRole=self` requires `guardianConfirmed=false`; `contactRole=guardian` requires a
second explicit confirmation that the guardian will manage the child's purchase,
recovery, and support. Migration `0004_guardian_buyer_confirmation.sql` stores only the
verified buyer role, confirmation version, and confirmation timestamps on the account.
It stores no child name, birth date, display name, glucose value, or CGM information.

One email still maps to one Plus account. A guardian can manage a child's single account,
but one mailbox cannot represent separate sibling accounts until a family feature splits
entitlements, AI quotas, recovery, and Share Studio trials per child. A later code with a
different buyer role fails closed and does not change the existing account. Checkout
rechecks the role, adult/guardian confirmation, and current confirmation version from D1;
browser fields are never authoritative. All account, purchase, and sales flags remain
false in checked-in configuration.

## Internal RPC contract

Bind another Worker specifically to the named `PlusEntitlementRpc` entrypoint.

- `resolveAiSubject(sessionToken)` returns only a stable internal subject ID and whether
  Plus is active.
- `resolveCheckoutBuyer(sessionToken, confirmationVersion)` is private to Checkout. It
  returns an eligible opaque account only when the stored adult/self-or-guardian
  confirmation matches the required current version.
- `getActivePlusSummary(sessionToken)` returns feature booleans, the active time window,
  and Share Studio trial state.
- `reserveShareTrial`, `completeShareTrial`, and `releaseShareTrial` implement a short
  reservation. Only `complete` consumes the one successful trial.

The separate `AdminPlusAggregateEntrypoint.getActivePlusSummary()` method takes no
arguments and returns only `{ activePlusCount }`. Bind that named entrypoint only from
the admin Worker protected by Cloudflare Access. It counts distinct accounts with a
currently active entitlement inside D1 and never returns an account row or identifier.

No RPC response includes an email address, encrypted email, provider event identifier,
payment reference, or health data.

## Stripe test-mode adapter boundary

The local adapter defines two future routes. Both remain disabled:

- `POST /v1/plus/checkout` accepts a UUID request ID only after an exact HTTPS Origin
  check and an authenticated Plus session. It creates a Stripe-hosted Checkout Session
  with `mode=payment`, one fixed Price, quantity one, and a random-suffixed
  `integration_identifier`. It never sends `payment_method_types`, `automatic_tax`, or
  subscription parameters. The browser receives only the hosted Checkout URL. The
  checked-in return paths are
  `/glucoscope/?mode=user&checkout=success#settings` and
  `/glucoscope/?mode=user&checkout=cancelled#settings`; both only return to the user settings UI.
  The Worker accepts only those two configured path/query/hash combinations. Neither
  path can grant an entitlement.
- `POST /v1/stripe/webhook` is independent of browser Origin. It reads at most 256 KiB
  of raw bytes, verifies the timestamped `Stripe-Signature` HMAC before JSON parsing,
  and returns no CORS header. Opening a Checkout success page never grants Plus.

The adapter is hard-limited to test mode: it accepts only a test-mode restricted API
key, test Checkout Session IDs, `livemode=false`, and Stripe API version
`2026-06-24.dahlia`. For `checkout.session.completed` and
`checkout.session.async_payment_succeeded`, it retrieves the Checkout Session again and
validates `payment_status=paid`, `mode=payment`, the exact Price and Product, JPY 300,
one-time pricing, and the server-created account metadata before calling
`applyVerifiedPlusPayment()`. Provider event IDs and validated Checkout Session IDs are
deduplicated, and every grant is exactly 2,592,000,000 milliseconds.

For `checkout.session.async_payment_failed`, the signed payload is likewise only a
pointer: the Session is re-fetched and the same test mode, account, request, product,
and amount facts are validated. The exact open attempt then moves to `failed` in one D1
transaction so the account may try again. Duplicate or out-of-order events are
idempotent; `completed` and `refunded` attempts never move backward to `failed`, and an
ambiguous mismatch remains blocked as payment confirmation pending.

`checkout.session.expired` also triggers a fresh Session retrieval and the same exact
fact checks. Only the matching open attempt moves to `expired`, which clears the public
`purchasePending` boolean and permits a new request. Duplicate expiry events are
idempotent, and completed, refunded, or already-failed attempts are preserved.

Migration `0003_stripe_checkout_state.sql` adds one server-authoritative Checkout
attempt per account. Its atomic D1 reservation prevents a second request ID from
creating another Session while creation is in progress. An unexpired open Session is
re-fetched from Stripe and its original hosted URL is reused; a complete Session stays
blocked while payment confirmation is pending. Only a Session re-fetched with Stripe's
explicit `status=expired` can be replaced; the locally elapsed `expires_at` timestamp
alone is never sufficient. Ambiguous Stripe or D1 failures retain a ten-minute reservation
instead of attempting another charge. The webhook changes that same attempt to
`completed`, `failed`, `expired`, or `refunded` inside the corresponding transaction.

Successful `refund.created`, `refund.updated`, and `charge.refunded` events are also
re-retrieved through Stripe. Any successful partial or full refund changes the linked
entitlement to `refunded`; repeated refund notifications are idempotent. The browser and
administrator aggregate never receive Stripe IDs or payment details.

Future test setup requires a separately scoped test restricted key with only Checkout
Session create/read and Charge and Refund read access, a webhook signing Secret, and the
exact test Price and Product IDs. Add another permission only if test-mode Workbench
request logs show that the adapter actually needs it. Set all values with
Cloudflare's secret or dashboard configuration facilities; never put their values in
Git or `.dev.vars`.

Live sales remain blocked. Stripe-hosted test acceptance, real D1 binding and migration,
email delivery, user-facing terms, tax and receipt decisions, support and refund policy,
and multi-tab acceptance of the per-account pending-Checkout guard are still required.
The three payment switches must not be enabled merely because this local adapter bundles.

## Local verification

```text
npm run verify
```

The tests use Node's built-in SQLite implementation to execute the real migration and
exercise the D1 store without provisioning a Cloudflare database.
