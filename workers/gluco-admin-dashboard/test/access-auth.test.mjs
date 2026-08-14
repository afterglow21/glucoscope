import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { AdminAccessError, verifyAccessRequest } from "../src/access-auth.js";

const TEAM_DOMAIN = "https://glucoscope-test.cloudflareaccess.com";
const POLICY_AUD = "0123456789abcdef0123456789abcdef";
const ALLOWED_EMAIL = "admin@example.com";

let privateKey;
let localJwks;

before(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  localJwks = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "RS256", kid: "test-key", use: "sig" }],
  });
});

async function createToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: overrides.email ?? ALLOWED_EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt(overrides.issuedAt ?? now)
    .setIssuer(overrides.issuer ?? TEAM_DOMAIN)
    .setAudience(overrides.audience ?? POLICY_AUD)
    .setExpirationTime(overrides.expiration ?? now + 300)
    .sign(privateKey);
}

function environment(overrides = {}) {
  return {
    TEAM_DOMAIN,
    POLICY_AUD,
    ADMIN_ALLOWED_EMAIL: ALLOWED_EMAIL,
    ...overrides,
  };
}

function dependencies() {
  return {
    createJwks(url) {
      assert.equal(url.href, `${TEAM_DOMAIN}/cdn-cgi/access/certs`);
      return localJwks;
    },
  };
}

function requestWithToken(token) {
  return new Request("https://admin.example.test/", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

test("accepts a signed Access JWT for the one allowed administrator email", async () => {
  const result = await verifyAccessRequest(
    requestWithToken(await createToken({ email: "ADMIN@example.com" })),
    environment(),
    dependencies(),
  );
  assert.deepEqual(result, { authenticated: true });
});

test("rejects a missing Access assertion", async () => {
  await assert.rejects(
    verifyAccessRequest(new Request("https://admin.example.test/"), environment(), dependencies()),
    (error) => error instanceof AdminAccessError && error.status === 403,
  );
});

test("rejects a valid token for another email", async () => {
  await assert.rejects(
    verifyAccessRequest(
      requestWithToken(await createToken({ email: "other@example.com" })),
      environment(),
      dependencies(),
    ),
    (error) => error instanceof AdminAccessError,
  );
});

test("rejects a token with the wrong audience", async () => {
  await assert.rejects(
    verifyAccessRequest(
      requestWithToken(await createToken({ audience: "another-audience" })),
      environment(),
      dependencies(),
    ),
    (error) => error instanceof AdminAccessError,
  );
});

test("rejects a token with the wrong issuer", async () => {
  await assert.rejects(
    verifyAccessRequest(
      requestWithToken(await createToken({ issuer: "https://other.cloudflareaccess.com" })),
      environment(),
      dependencies(),
    ),
    (error) => error instanceof AdminAccessError,
  );
});

test("rejects an expired token", async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(
    verifyAccessRequest(
      requestWithToken(await createToken({ issuedAt: now - 120, expiration: now - 60 })),
      environment(),
      dependencies(),
    ),
    (error) => error instanceof AdminAccessError,
  );
});

test("rejects a forged token signature", async () => {
  const token = await createToken();
  const parts = token.split(".");
  parts[2] = `${parts[2].startsWith("a") ? "b" : "a"}${parts[2].slice(1)}`;
  const forged = parts.join(".");
  await assert.rejects(
    verifyAccessRequest(requestWithToken(forged), environment(), dependencies()),
    (error) => error instanceof AdminAccessError,
  );
});

test("fails closed while Access configuration still contains placeholders", async () => {
  await assert.rejects(
    verifyAccessRequest(
      requestWithToken(await createToken()),
      environment({ TEAM_DOMAIN: "https://replace-me.cloudflareaccess.com" }),
      dependencies(),
    ),
    (error) => error instanceof AdminAccessError,
  );
});
