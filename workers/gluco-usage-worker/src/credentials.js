function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export async function hashBearerToken(token, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(token)),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createProfileCredentials(cryptoImpl = crypto) {
  const tokenBytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(tokenBytes);
  const bearerToken = bytesToBase64Url(tokenBytes);
  return Object.freeze({
    id: cryptoImpl.randomUUID(),
    bearerToken,
    tokenHash: await hashBearerToken(bearerToken, cryptoImpl),
  });
}
