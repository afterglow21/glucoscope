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
Existing-account and new-account requests return the same `code_sent` result. A wrong,
expired, used, or exhausted code returns the same `invalid_or_expired_code` result.
Challenge rows older than the short abuse-prevention window are opportunistically removed
when another code is requested; a production retention job is still required before launch.
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

The Cloudflare Email Service adapter is checked in but deliberately disconnected.
`index.js` injects it through `serviceDependencies.emailAdapter`; it expects the native
`ACCOUNT_CODE_EMAIL` binding and an exact normalized sender in
`ACCOUNT_EMAIL_FROM_ADDRESS`. Neither is present in `wrangler.jsonc`. There is also no
D1 binding, Turnstile Secret, email-lookup HMAC Secret, or code-HMAC Secret. If account
HTTP were enabled without any one of them, the route fails closed.

The adapter sends one fixed Japanese/English subject and body; only the six-digit code
and expiry minutes vary. It does not include blood-glucose data, AI content, display
names, or other profile data. Missing configuration, a provider throw, or a malformed
`messageId` produces the same generic `503` at the HTTP boundary and invalidates the
challenge. The adapter has no logger or D1 access. The destination and code exist only
in the private in-memory call and Cloudflare's send binding; the returned provider
`messageId` is not stored by account auth. Do not add raw email addresses, codes,
tokens, provider errors, or adapter payloads to Worker logs, D1, analytics, or events.

Before the first closed test, onboard a dedicated Cloudflare Email Sending domain or
subdomain and verify its managed SPF, DKIM, DMARC, and bounce records. Use a binding
restricted to the exact sender and, during the closed test, only approved tester
destinations. Keep the existing per-email HMAC limit and add a reviewed global send cap
before allowing arbitrary recipients. A successful `send()` means only that Cloudflare
accepted the message; bounce, deferral, complaint, suppression, and delayed-delivery
handling still need an operating runbook that does not copy raw recipients into D1 or
application logs.

Cloudflare turns **Email preview on automatically for new sending domains**. Preview can
retain the full HTML, text, headers, and therefore the verification code for about seven
days. **Email preview must be OFF in the real environment before the first real
verification email; this is a live-sales prerequisite.** Confirm the setting again after
domain or environment changes. The relevant primary documentation is Cloudflare's
[Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/),
[domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/),
[send-binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/),
and [email logs](https://developers.cloudflare.com/email-service/observability/logs/).

Suggested simple explanation for the future screen:

> このメールは、ログインと機種変更のときの確認に使います。血糖値やAIのお手紙をメールで送ることはありません。

Guardian or shared-email use remains undecided and unavailable until a safe family rule
exists. The public HTTP request contract accepts only `{ email, turnstileToken }` and
rejects guardian fields. It must not tell a child to use a guardian email, because one
email currently maps to one account and could incorrectly merge siblings' entitlements,
trial use, and AI quota.

## Internal RPC contract

Bind another Worker specifically to the named `PlusEntitlementRpc` entrypoint.

- `resolveAiSubject(sessionToken)` returns only a stable internal subject ID and whether
  Plus is active.
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
