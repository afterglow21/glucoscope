const EMAIL_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;
const HMAC_MINIMUM_KEY_BYTES = 32;
const VERIFICATION_CODE_RANGE = 1_000_000;
const UINT32_RANGE = 0x1_0000_0000;
const UINT32_UNBIASED_LIMIT = Math.floor(
  UINT32_RANGE / VERIFICATION_CODE_RANGE,
) * VERIFICATION_CODE_RANGE;

const textEncoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const encoded = String(value || "");
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) return null;
  const padded = encoded.replace(/-/gu, "+").replace(/_/gu, "/") + "=";
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function requireHmacSecret(value) {
  const secret = String(value || "");
  if (textEncoder.encode(secret).byteLength < HMAC_MINIMUM_KEY_BYTES) {
    throw new TypeError("account auth secret is unavailable");
  }
  return secret;
}

async function importHmacKey(secret, cryptoImpl) {
  return cryptoImpl.subtle.importKey(
    "raw",
    textEncoder.encode(requireHmacSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signHmac(value, secret, cryptoImpl) {
  const key = await importHmacKey(secret, cryptoImpl);
  const signature = await cryptoImpl.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(String(value)),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function isValidDomain(domain) {
  if (domain.length > 253 || domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length >= 1
    && label.length <= 63
    && !label.startsWith("-")
    && !label.endsWith("-")
    && /^[a-z0-9-]+$/u.test(label));
}

function normalizeEmailDomain(value) {
  const input = String(value ?? "");
  if (!input || input.length > 253) return null;
  try {
    const parsed = new URL(`https://${input}/`);
    if (
      parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    const domain = parsed.hostname.toLowerCase();
    return isValidDomain(domain) ? domain : null;
  } catch {
    return null;
  }
}

export function normalizeEmailAddress(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > EMAIL_MAX_LENGTH || /\s/u.test(raw)) {
    return null;
  }
  const separator = raw.lastIndexOf("@");
  if (separator <= 0 || separator !== raw.indexOf("@")) return null;
  const local = raw.slice(0, separator);
  const domain = normalizeEmailDomain(raw.slice(separator + 1));
  if (
    local.length > LOCAL_PART_MAX_LENGTH
    || local.startsWith(".")
    || local.endsWith(".")
    || local.includes("..")
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)
    || !domain
  ) {
    return null;
  }
  const normalized = `${local}@${domain}`;
  return normalized.length <= EMAIL_MAX_LENGTH ? normalized : null;
}

export async function createEmailLookupHmac(
  normalizedEmail,
  secret,
  cryptoImpl = crypto,
) {
  return signHmac(`email-v1\n${normalizedEmail}`, secret, cryptoImpl);
}

export async function createVerificationCodeHmac(
  challengeId,
  code,
  secret,
  cryptoImpl = crypto,
) {
  return signHmac(`code-v1\n${challengeId}\n${code}`, secret, cryptoImpl);
}

export async function verifyVerificationCodeHmac(
  challengeId,
  code,
  expectedHmac,
  secret,
  cryptoImpl = crypto,
) {
  const signature = base64UrlToBytes(expectedHmac);
  const key = await importHmacKey(secret, cryptoImpl);
  const value = textEncoder.encode(`code-v1\n${challengeId}\n${code}`);
  if (!signature) {
    await cryptoImpl.subtle.verify("HMAC", key, new Uint8Array(32), value);
    return false;
  }
  return cryptoImpl.subtle.verify("HMAC", key, signature, value);
}

export function createNumericVerificationCode(cryptoImpl = crypto) {
  const random = new Uint32Array(1);
  do {
    cryptoImpl.getRandomValues(random);
  } while (random[0] >= UINT32_UNBIASED_LIMIT);
  return String(random[0] % VERIFICATION_CODE_RANGE).padStart(6, "0");
}

export async function createVerificationChallengeCredentials({
  codeHmacSecret,
  cryptoImpl = crypto,
} = {}) {
  const grant = await createSessionCredentials(cryptoImpl);
  const challengeId = grant.id;
  const code = createNumericVerificationCode(cryptoImpl);
  const codeHmac = await createVerificationCodeHmac(
    challengeId,
    code,
    codeHmacSecret,
    cryptoImpl,
  );
  return Object.freeze({
    challengeId,
    code,
    codeHmac,
    verificationGrant: grant.sessionToken,
    verificationGrantHash: grant.tokenHash,
  });
}
import { createSessionCredentials } from "./credentials.js";
