import { normalizeEmailAddress } from "./account-auth-crypto.js";
import { UUID_PATTERN } from "./constants.js";

const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";
const RESEND_USER_AGENT = "GlucoScope-Plus-Entitlement/0.1";
const RESEND_API_KEY_PATTERN = /^re_[A-Za-z0-9_-]{16,240}$/u;
const VERIFICATION_CODE_PATTERN = /^\d{6}$/u;
const CONTACT_ROLES = Object.freeze(new Set(["self", "guardian"]));
const PURPOSE = "sign_in_or_recover";
const RESPONSE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MINIMUM_TIMEOUT_MS = 100;
const MAXIMUM_TIMEOUT_MS = 30_000;
const MINIMUM_RESPONSE_LIMIT_BYTES = 128;
const MAXIMUM_RESPONSE_LIMIT_BYTES = 16 * 1024;

export const ACCOUNT_CODE_EMAIL_FROM =
  "GlucoScope <no-reply@auth.glucoscope.app>";
export const ACCOUNT_CODE_EMAIL_SUBJECT =
  "GlucoScopeの確認コード / Verification code";

export class ResendEmailAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = "ResendEmailAdapterError";
    this.code = code;
  }
}

function fail(code) {
  throw new ResendEmailAdapterError(code);
}

function requireExactString(value, expected) {
  if (typeof value !== "string" || value !== expected) {
    fail("email_configuration_unavailable");
  }
  return value;
}

function requireInteger(value, minimum, maximum) {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    fail("email_configuration_unavailable");
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    fail("email_configuration_unavailable");
  }
  return parsed;
}

function requireConfig(env) {
  const apiKey = env?.RESEND_API_KEY;
  if (
    typeof apiKey !== "string"
    || apiKey !== apiKey.trim()
    || !RESEND_API_KEY_PATTERN.test(apiKey)
  ) {
    fail("email_configuration_unavailable");
  }
  return Object.freeze({
    apiKey,
    from: requireExactString(env.RESEND_FROM_ADDRESS, ACCOUNT_CODE_EMAIL_FROM),
    timeoutMs: requireInteger(
      env.RESEND_TIMEOUT_MS,
      MINIMUM_TIMEOUT_MS,
      MAXIMUM_TIMEOUT_MS,
    ),
    responseLimitBytes: requireInteger(
      env.RESEND_RESPONSE_LIMIT_BYTES,
      MINIMUM_RESPONSE_LIMIT_BYTES,
      MAXIMUM_RESPONSE_LIMIT_BYTES,
    ),
  });
}

function requireNormalizedEmail(value, code) {
  if (typeof value !== "string" || value !== value.trim()) fail(code);
  const normalized = normalizeEmailAddress(value);
  if (!normalized || normalized !== value) fail(code);
  return normalized;
}

function requireMessageInput(input) {
  const destinationEmail = requireNormalizedEmail(
    input?.destinationEmail,
    "email_destination_invalid",
  );
  const code = input?.code;
  const expiresInMinutes = input?.expiresInMinutes;
  const contactRole = input?.contactRole;
  const requestId = input?.requestId;
  if (
    typeof code !== "string"
    || typeof expiresInMinutes !== "number"
    || typeof contactRole !== "string"
    || typeof requestId !== "string"
    || !VERIFICATION_CODE_PATTERN.test(code)
    || !Number.isSafeInteger(expiresInMinutes)
    || expiresInMinutes < 1
    || expiresInMinutes > 60
    || !CONTACT_ROLES.has(contactRole)
    || input?.purpose !== PURPOSE
    || requestId !== requestId.toLowerCase()
    || !UUID_PATTERN.test(requestId)
  ) {
    fail("email_message_invalid");
  }
  return Object.freeze({
    destinationEmail,
    code,
    expiresInMinutes,
    requestId,
  });
}

function buildText({ code, expiresInMinutes }) {
  return [
    "GlucoScopeの確認コードです。",
    "",
    `確認コード: ${code}`,
    `このコードは${expiresInMinutes}分で使えなくなります。`,
    "コードを送ったGlucoScopeの画面へ戻って入力してください。",
    "このコードをほかの人に教えないでください。",
    "心当たりがない場合は、何もしなくて大丈夫です。",
    "",
    "This is your GlucoScope verification code.",
    "",
    `Verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    "Return to the GlucoScope screen where you requested the code and enter it there.",
    "Do not share this code with anyone.",
    "If you did not request it, you can safely ignore this email.",
  ].join("\n");
}

function readContentLength(headers) {
  if (!headers || typeof headers.get !== "function") {
    fail("email_response_invalid");
  }
  const raw = headers.get("content-length");
  if (raw === null) return null;
  if (!/^\d+$/u.test(raw)) fail("email_response_invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail("email_response_invalid");
  return value;
}

function requireJsonContentType(headers) {
  if (!headers || typeof headers.get !== "function") {
    fail("email_response_invalid");
  }
  const raw = headers.get("content-type");
  if (typeof raw !== "string") fail("email_response_invalid");
  const mediaType = raw.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") fail("email_response_invalid");
}

async function readBoundedResponseBytes(response, maximumBytes) {
  const contentLength = readContentLength(response.headers);
  if (contentLength !== null && contentLength > maximumBytes) {
    fail("email_response_invalid");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    fail("email_response_invalid");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail("email_response_invalid");
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        fail("email_response_invalid");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ResendEmailAdapterError) throw error;
    fail("email_response_invalid");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readResendId(response, maximumBytes) {
  if (
    !response
    || response.ok !== true
    || response.status !== 200
  ) {
    fail("email_response_invalid");
  }
  requireJsonContentType(response.headers);
  const bytes = await readBoundedResponseBytes(response, maximumBytes);
  let result;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    result = JSON.parse(text);
  } catch {
    fail("email_response_invalid");
  }
  const messageId = result?.id;
  if (
    typeof messageId !== "string"
    || !RESPONSE_ID_PATTERN.test(messageId)
  ) {
    fail("email_response_invalid");
  }
  return messageId;
}

function isRetryableStatus(status) {
  return status === 408
    || status === 409
    || status >= 500;
}

async function isRetryablePerSecondRateLimit(response, maximumBytes) {
  if (response?.status !== 429) return false;
  try {
    requireJsonContentType(response.headers);
    const bytes = await readBoundedResponseBytes(response, maximumBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const result = JSON.parse(text);
    return result?.name === "rate_limit_exceeded";
  } catch {
    return false;
  }
}

async function cancelResponseBody(response) {
  if (response?.body && typeof response.body.cancel === "function") {
    await response.body.cancel().catch(() => {});
  }
}

export function createResendEmailAdapter(env = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  return Object.freeze({
    async sendAccountCode(input) {
      if (typeof fetchImpl !== "function") {
        fail("email_configuration_unavailable");
      }
      const config = requireConfig(env);
      const message = requireMessageInput(input);
      const body = JSON.stringify({
        from: config.from,
        to: [message.destinationEmail],
        subject: ACCOUNT_CODE_EMAIL_SUBJECT,
        text: buildText(message),
      });
      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json;charset=UTF-8",
        "Idempotency-Key": `glucoscope-account-code:${message.requestId}`,
        "User-Agent": RESEND_USER_AGENT,
      });

      let response;
      const startedAt = now();
      if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
        fail("email_configuration_unavailable");
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const observedAt = now();
        if (!Number.isSafeInteger(observedAt) || observedAt < startedAt) {
          fail("email_configuration_unavailable");
        }
        const remainingMs = config.timeoutMs - (observedAt - startedAt);
        if (remainingMs <= 0) break;
        const attemptTimeoutMs = Math.max(
          1,
          Math.floor(remainingMs / (2 - attempt)),
        );
        try {
          response = await fetchImpl(RESEND_EMAIL_API_URL, {
            method: "POST",
            headers,
            body,
            redirect: "error",
            signal: AbortSignal.timeout(attemptTimeoutMs),
          });
        } catch {
          response = null;
          if (attempt === 0) continue;
          break;
        }
        if (response?.ok === true) break;
        let retryable = false;
        try {
          retryable = Number.isSafeInteger(response?.status)
            && (
              isRetryableStatus(response.status)
              || await isRetryablePerSecondRateLimit(
                response,
                config.responseLimitBytes,
              )
            );
        } catch {
          retryable = false;
        }
        await cancelResponseBody(response);
        response = null;
        if (!retryable || attempt === 1) break;
      }
      if (!response || response.ok !== true) {
        fail("email_delivery_unavailable");
      }
      const messageId = await readResendId(response, config.responseLimitBytes);
      return Object.freeze({
        accepted: true,
        provider: "resend",
        messageId,
      });
    },
  });
}
