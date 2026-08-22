function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

const OPAQUE_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHARE_TRIAL_AI_QUOTA_CONTEXT = "glucoscope-share-trial-ai-quota:v1";

export async function hashSessionToken(token, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(token)),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function deriveShareTrialQuotaSubject(
  emailLookupHmac,
  cryptoImpl = crypto,
) {
  const reuseIdentity = String(emailLookupHmac ?? "");
  if (!OPAQUE_SHA256_PATTERN.test(reuseIdentity)) {
    throw new TypeError("share trial quota identity is unavailable");
  }
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${SHARE_TRIAL_AI_QUOTA_CONTEXT}:${reuseIdentity}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createSessionCredentials(cryptoImpl = crypto) {
  const tokenBytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(tokenBytes);
  const sessionToken = bytesToBase64Url(tokenBytes);
  return Object.freeze({
    id: cryptoImpl.randomUUID(),
    sessionToken,
    tokenHash: await hashSessionToken(sessionToken, cryptoImpl),
  });
}

export function createDetachedIdentityMarker(cryptoImpl = crypto) {
  const markerBytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(markerBytes);
  return bytesToBase64Url(markerBytes);
}
