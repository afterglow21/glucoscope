import {
  SESSION_TOKEN_PATTERN,
  UUID_PATTERN,
} from "./constants.js";
import {
  createEmailLookupHmac,
  createVerificationChallengeCredentials,
  normalizeEmailAddress,
  verifyVerificationCodeHmac,
} from "./account-auth-crypto.js";
import { createD1AccountAuthStore } from "./account-auth-store.js";
import {
  createSessionCredentials,
  hashSessionToken,
} from "./credentials.js";

const VERIFICATION_CODE_PATTERN = /^\d{6}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CONTACT_ROLES = Object.freeze(new Set(["self", "guardian"]));

export class AccountAuthError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.name = "AccountAuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = details.retryAfterSeconds || null;
  }
}

function readBoolean(value, fallback = false) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function readInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function readIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!ISO_DATE_PATTERN.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw
    ? raw
    : null;
}

export function readAccountAuthConfig(env = {}) {
  return Object.freeze({
    httpEnabled: readBoolean(env.PLUS_ACCOUNT_AUTH_HTTP_ENABLED, false),
    allowedOrigin: String(env.ACCOUNT_AUTH_ALLOWED_ORIGIN || "").trim(),
    expectedHostname: String(env.ACCOUNT_AUTH_EXPECTED_HOSTNAME || "").trim()
      .toLowerCase(),
    requestCodeAction: String(
      env.ACCOUNT_AUTH_REQUEST_CODE_ACTION || "glucoscope-plus-request-code",
    ).trim(),
    deleteAction: String(
      env.ACCOUNT_AUTH_DELETE_ACTION || "glucoscope-plus-delete-account",
    ).trim(),
    bodyLimitBytes: readInteger(env.ACCOUNT_AUTH_BODY_LIMIT_BYTES, 8192, 1024, 16384),
    codeTtlMs: readInteger(env.ACCOUNT_AUTH_CODE_TTL_SECONDS, 600, 300, 900) * 1000,
    codeAttempts: readInteger(env.ACCOUNT_AUTH_CODE_ATTEMPTS, 5, 3, 10),
    resendCooldownMs: readInteger(
      env.ACCOUNT_AUTH_RESEND_SECONDS,
      60,
      30,
      10 * 60,
    ) * 1000,
    maximumSendsPerHour: readInteger(
      env.ACCOUNT_AUTH_MAX_SENDS_PER_HOUR,
      5,
      2,
      10,
    ),
    sessionTtlMs: readInteger(
      env.ACCOUNT_AUTH_SESSION_TTL_DAYS,
      90,
      1,
      180,
    ) * 24 * 60 * 60 * 1000,
    emailHmacKeyVersion: readInteger(
      env.ACCOUNT_EMAIL_HMAC_KEY_VERSION,
      1,
      1,
      1_000_000,
    ),
    previousEmailHmacKeyVersion: readInteger(
      env.ACCOUNT_EMAIL_PREVIOUS_HMAC_KEY_VERSION,
      0,
      0,
      999_999,
    ),
    buyerConfirmationVersion: readIsoDate(
      env.PLUS_BUYER_CONFIRMATION_VERSION,
    ),
  });
}

function requireEnabled(config) {
  if (!config.httpEnabled) {
    throw new AccountAuthError("service_unavailable", 503);
  }
}

function requireVerifiedTurnstile(context) {
  if (context?.turnstileVerified !== true) {
    throw new AccountAuthError("turnstile_failed", 403);
  }
}

function requireSafeEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AccountAuthError("service_unavailable", 503);
  }
  return value;
}

function requireEmail(value) {
  const normalized = normalizeEmailAddress(value);
  if (!normalized) throw new AccountAuthError("invalid_request", 400);
  return normalized;
}

function requireCode(value) {
  const code = String(value ?? "").trim();
  if (!VERIFICATION_CODE_PATTERN.test(code)) {
    throw new AccountAuthError("invalid_or_expired_code", 400);
  }
  return code;
}

function requireVerificationGrant(value) {
  const grant = String(value ?? "");
  if (!SESSION_TOKEN_PATTERN.test(grant)) {
    throw new AccountAuthError("invalid_or_expired_code", 400);
  }
  return grant;
}

function requireBuyerConfirmation(input, version) {
  if (!version) throw new AccountAuthError("service_unavailable", 503);
  const role = String(input?.contactRole ?? "");
  if (!CONTACT_ROLES.has(role)) {
    throw new AccountAuthError("invalid_request", 400);
  }
  if (input?.adultConfirmed !== true) {
    throw new AccountAuthError("adult_confirmation_required", 400);
  }
  if (role === "guardian" && input?.guardianConfirmed !== true) {
    throw new AccountAuthError("guardian_confirmation_required", 400);
  }
  if (role === "self" && input?.guardianConfirmed !== false) {
    throw new AccountAuthError("invalid_request", 400);
  }
  return Object.freeze({
    contactRole: role,
    adultConfirmed: true,
    guardianConfirmed: role === "guardian",
    buyerConfirmationVersion: version,
  });
}

function requireSessionToken(value) {
  const token = String(value ?? "");
  return SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

function requireEmailAdapter(value) {
  if (!value || typeof value.sendAccountCode !== "function") {
    throw new AccountAuthError("service_unavailable", 503);
  }
  return value;
}

function publicSessionStatus(snapshot) {
  if (!snapshot) return null;
  return Object.freeze({
    ok: true,
    status: "ready",
    accountVerified: true,
    plusActive: Boolean(snapshot.plusActive),
    purchasePending: !snapshot.plusActive && Boolean(snapshot.purchasePending),
    startsAt: snapshot.plusActive ? snapshot.startsAt : null,
    endsAt: snapshot.plusActive ? snapshot.endsAt : null,
    shareStudioTrialAvailable: Boolean(snapshot.shareStudioTrialAvailable),
  });
}

export function createAccountAuthService(env = {}, dependencies = {}) {
  const config = readAccountAuthConfig(env);
  const now = dependencies.now || Date.now;
  const cryptoImpl = dependencies.crypto || crypto;
  const makeChallenge = dependencies.createVerificationChallengeCredentials
    || createVerificationChallengeCredentials;
  const makeSession = dependencies.createSessionCredentials || createSessionCredentials;
  const makeEmailHmac = dependencies.createEmailLookupHmac || createEmailLookupHmac;
  const verifyCodeHmac = dependencies.verifyVerificationCodeHmac
    || verifyVerificationCodeHmac;
  const hashToken = dependencies.hashSessionToken || hashSessionToken;

  function getStore() {
    return dependencies.store || createD1AccountAuthStore(env.PLUS_DB);
  }

  function getEmailAdapter() {
    return requireEmailAdapter(dependencies.emailAdapter || env.ACCOUNT_EMAIL_ADAPTER);
  }

  function getEmailHmacKeys() {
    const current = Object.freeze({
      version: config.emailHmacKeyVersion,
      secret: String(env.ACCOUNT_EMAIL_LOOKUP_HMAC_KEY || ""),
    });
    const previousSecret = String(
      env.ACCOUNT_EMAIL_LOOKUP_HMAC_PREVIOUS_KEY || "",
    );
    const previousVersion = config.previousEmailHmacKeyVersion;
    const hasPrevious = Boolean(previousSecret) || previousVersion !== 0;
    if (
      (Boolean(previousSecret) !== (previousVersion !== 0))
      || (hasPrevious && previousVersion !== current.version - 1)
      || (!hasPrevious && current.version !== 1)
    ) {
      throw new AccountAuthError("service_unavailable", 503);
    }
    return hasPrevious
      ? Object.freeze([
          current,
          Object.freeze({ version: previousVersion, secret: previousSecret }),
        ])
      : Object.freeze([current]);
  }

  async function getEmailLookupIdentities(normalizedEmail) {
    const keys = getEmailHmacKeys();
    const identities = [];
    for (const key of keys) {
      identities.push(Object.freeze({
        version: key.version,
        hmac: await makeEmailHmac(normalizedEmail, key.secret, cryptoImpl),
      }));
    }
    return Object.freeze(identities);
  }

  function getCodeHmacSecret() {
    return String(env.ACCOUNT_CODE_HMAC_KEY || "");
  }

  return Object.freeze({
    async requestCode(input, context = {}) {
      requireEnabled(config);
      requireVerifiedTurnstile(context);
      const emailAdapter = getEmailAdapter();
      const normalizedEmail = requireEmail(input?.email);
      const buyerConfirmation = requireBuyerConfirmation(
        input,
        config.buyerConfirmationVersion,
      );
      const requestedAt = requireSafeEpoch(now());
      const emailIdentities = await getEmailLookupIdentities(normalizedEmail);
      const currentEmailIdentity = emailIdentities[0];
      const previousEmailIdentity = emailIdentities[1] || currentEmailIdentity;
      const credentials = await makeChallenge({
        codeHmacSecret: getCodeHmacSecret(),
        cryptoImpl,
      });
      if (!UUID_PATTERN.test(String(credentials?.challengeId || ""))) {
        throw new AccountAuthError("service_unavailable", 503);
      }
      if (
        !SESSION_TOKEN_PATTERN.test(String(credentials?.verificationGrant || ""))
        || !SESSION_TOKEN_PATTERN.test(String(credentials?.verificationGrantHash || ""))
      ) {
        throw new AccountAuthError("service_unavailable", 503);
      }
      const store = getStore();
      const issue = await store.issueChallenge({
        id: credentials.challengeId,
        emailLookupHmac: currentEmailIdentity.hmac,
        alternateEmailLookupHmac: previousEmailIdentity.hmac,
        emailHmacKeyVersion: config.emailHmacKeyVersion,
        codeHmac: credentials.codeHmac,
        verificationGrantHash: credentials.verificationGrantHash,
        ...buyerConfirmation,
        attempts: config.codeAttempts,
        createdAt: requestedAt,
        expiresAt: requestedAt + config.codeTtlMs,
        resendAllowedAfter: requestedAt - config.resendCooldownMs,
        windowStartsAt: requestedAt - 60 * 60 * 1000,
        maximumPerWindow: config.maximumSendsPerHour,
        retentionStartsAt: requestedAt - 24 * 60 * 60 * 1000,
        rateWindowMs: 60 * 60 * 1000,
        resendCooldownMs: config.resendCooldownMs,
      });
      if (issue.status === "throttled") {
        throw new AccountAuthError("please_wait", 429, {
          retryAfterSeconds: issue.retryAfterSeconds,
        });
      }
      if (issue.status !== "pending") {
        throw new AccountAuthError("service_unavailable", 503);
      }

      let accepted = false;
      try {
        const delivery = await emailAdapter.sendAccountCode(Object.freeze({
          destinationEmail: normalizedEmail,
          code: credentials.code,
          expiresInMinutes: Math.ceil(config.codeTtlMs / 60_000),
          contactRole: buyerConfirmation.contactRole,
          purpose: "sign_in_or_recover",
        }));
        accepted = delivery?.accepted === true;
      } catch {
        accepted = false;
      }
      if (!accepted) {
        await store.markChallengeSendFailed({
          id: credentials.challengeId,
          failedAt: requireSafeEpoch(now()),
        });
        throw new AccountAuthError("service_unavailable", 503);
      }
      const sent = await store.markChallengeSent({
        id: credentials.challengeId,
        sentAt: requireSafeEpoch(now()),
      });
      if (!sent?.sent) {
        await store.markChallengeSendFailed({
          id: credentials.challengeId,
          failedAt: requireSafeEpoch(now()),
        });
        throw new AccountAuthError("service_unavailable", 503);
      }
      return Object.freeze({
        ok: true,
        status: "code_sent",
        verificationGrant: credentials.verificationGrant,
      });
    },

    async verifyCode(input) {
      requireEnabled(config);
      const normalizedEmail = requireEmail(input?.email);
      const code = requireCode(input?.code);
      const verificationGrant = requireVerificationGrant(input?.verificationGrant);
      const verifiedAt = requireSafeEpoch(now());
      const emailIdentities = await getEmailLookupIdentities(normalizedEmail);
      const currentEmailIdentity = emailIdentities[0];
      const previousEmailIdentity = emailIdentities[1] || currentEmailIdentity;
      const verificationGrantHash = await hashToken(verificationGrant, cryptoImpl);
      const store = getStore();
      const challenge = await store.getActiveChallenge({
        emailLookupHmac: currentEmailIdentity.hmac,
        alternateEmailLookupHmac: previousEmailIdentity.hmac,
        verificationGrantHash,
        now: verifiedAt,
      });
      const challengeId = challenge?.id || "00000000-0000-4000-8000-000000000000";
      const expectedCodeHmac = challenge?.codeHmac || "A".repeat(43);
      const codeMatches = await verifyCodeHmac(
        challengeId,
        code,
        expectedCodeHmac,
        getCodeHmacSecret(),
        cryptoImpl,
      );
      if (!challenge || !codeMatches) {
        if (challenge) {
          await store.recordFailedAttempt({ id: challenge.id, now: verifiedAt });
        }
        throw new AccountAuthError("invalid_or_expired_code", 400);
      }
      const consumption = await store.consumeChallenge({
        id: challenge.id,
        expectedCodeHmac: challenge.codeHmac,
        now: verifiedAt,
      });
      if (!consumption?.consumed) {
        throw new AccountAuthError("invalid_or_expired_code", 400);
      }
      if (
        challenge.adultConfirmed !== true
        || !CONTACT_ROLES.has(challenge.contactRole)
        || (challenge.contactRole === "guardian")
          !== (challenge.guardianConfirmed === true)
        || challenge.buyerConfirmationVersion !== config.buyerConfirmationVersion
      ) {
        throw new AccountAuthError("buyer_confirmation_required", 409);
      }

      const sessionCredentials = await makeSession(cryptoImpl);
      const newAccountId = cryptoImpl.randomUUID();
      const session = await store.rotateSessionForVerifiedEmail({
        emailLookupHmac: currentEmailIdentity.hmac,
        alternateEmailLookupHmac: previousEmailIdentity.hmac,
        emailHmacKeyVersion: config.emailHmacKeyVersion,
        newAccountId,
        newSessionId: sessionCredentials.id,
        newTokenHash: sessionCredentials.tokenHash,
        buyerRole: challenge.contactRole,
        buyerConfirmationVersion: challenge.buyerConfirmationVersion,
        verifiedAt,
        sessionExpiresAt: verifiedAt + config.sessionTtlMs,
      });
      if (session?.status === "buyer_role_conflict") {
        throw new AccountAuthError("buyer_role_conflict", 409);
      }
      if (session?.status !== "ready") {
        throw new AccountAuthError("service_unavailable", 503);
      }
      const sessionSnapshot = await store.getSessionState({
        tokenHash: sessionCredentials.tokenHash,
        now: verifiedAt,
      });
      const ready = publicSessionStatus(sessionSnapshot);
      if (!ready) throw new AccountAuthError("service_unavailable", 503);
      return Object.freeze({
        ok: true,
        status: "verified",
        sessionToken: sessionCredentials.sessionToken,
        session: Object.freeze({
          status: "ready",
          accountVerified: ready.accountVerified,
          plusActive: ready.plusActive,
          purchasePending: ready.purchasePending,
          startsAt: ready.startsAt,
          endsAt: ready.endsAt,
          shareStudioTrialAvailable: ready.shareStudioTrialAvailable,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
        }),
      });
    },

    async getSessionStatus(sessionToken) {
      requireEnabled(config);
      const token = requireSessionToken(sessionToken);
      if (!token) return null;
      const tokenHash = await hashToken(token, cryptoImpl);
      const snapshot = await getStore().getSessionState({
        tokenHash,
        now: requireSafeEpoch(now()),
      });
      return publicSessionStatus(snapshot);
    },

    async logout(sessionToken) {
      requireEnabled(config);
      const token = requireSessionToken(sessionToken);
      if (token) {
        const tokenHash = await hashToken(token, cryptoImpl);
        await getStore().revokeSession({
          tokenHash,
          now: requireSafeEpoch(now()),
        });
      }
      return Object.freeze({ ok: true, status: "signed_out" });
    },

    async deleteAccount(sessionToken, input, context = {}) {
      requireEnabled(config);
      requireVerifiedTurnstile(context);
      if (input?.confirmDelete !== true) {
        throw new AccountAuthError("deletion_confirmation_required", 400);
      }
      const token = requireSessionToken(sessionToken);
      if (!token) throw new AccountAuthError("authentication_required", 401);
      const tokenHash = await hashToken(token, cryptoImpl);
      const result = await getStore().deleteAccountBySession({
        tokenHash,
        now: requireSafeEpoch(now()),
      });
      if (result?.status === "requires_support") {
        throw new AccountAuthError("account_deletion_requires_support", 409);
      }
      if (result?.status === "invalid_session") {
        throw new AccountAuthError("authentication_required", 401);
      }
      if (result?.status !== "deleted") {
        throw new AccountAuthError("service_unavailable", 503);
      }
      return Object.freeze({ ok: true, status: "account_deleted" });
    },
  });
}
