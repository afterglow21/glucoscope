function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export async function hashSessionToken(token, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(token)),
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
