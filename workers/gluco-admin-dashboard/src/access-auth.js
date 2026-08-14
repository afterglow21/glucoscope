import { createRemoteJWKSet, jwtVerify } from "jose";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const ACCESS_CERTS_PATH = "/cdn-cgi/access/certs";
const MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
const MAX_AUDIENCE_LENGTH = 256;
const MAX_EMAIL_LENGTH = 254;
const remoteJwksByTeamDomain = new Map();

export class AdminAccessError extends Error {
  constructor() {
    super("access_denied");
    this.name = "AdminAccessError";
    this.code = "access_denied";
    this.status = 403;
  }
}

function deny() {
  throw new AdminAccessError();
}

function normalizeTeamDomain(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("replace-me")) deny();
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || !url.hostname.endsWith(".cloudflareaccess.com")
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || url.origin !== raw
    ) {
      deny();
    }
    return url.origin;
  } catch (error) {
    if (error instanceof AdminAccessError) throw error;
    return deny();
  }
}

function normalizeAudience(value) {
  const audience = String(value || "").trim();
  if (
    !audience
    || audience.includes("replace-me")
    || audience.length > MAX_AUDIENCE_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(audience)
  ) {
    deny();
  }
  return audience;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (
    !email
    || email.length > MAX_EMAIL_LENGTH
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    deny();
  }
  return email;
}

function readAccessConfig(env = {}) {
  return Object.freeze({
    teamDomain: normalizeTeamDomain(env.TEAM_DOMAIN),
    audience: normalizeAudience(env.POLICY_AUD),
    allowedEmail: normalizeEmail(env.ADMIN_ALLOWED_EMAIL),
  });
}

function readAccessToken(request) {
  const token = request.headers.get(ACCESS_ASSERTION_HEADER) || "";
  if (
    !token
    || token.length > MAX_ACCESS_TOKEN_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(token)
  ) {
    deny();
  }
  return token;
}

function getJwks(teamDomain, createJwks) {
  const certsUrl = new URL(ACCESS_CERTS_PATH, `${teamDomain}/`);
  if (createJwks !== createRemoteJWKSet) return createJwks(certsUrl);
  let jwks = remoteJwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(certsUrl);
    remoteJwksByTeamDomain.set(teamDomain, jwks);
  }
  return jwks;
}

export async function verifyAccessRequest(request, env = {}, dependencies = {}) {
  const config = readAccessConfig(env);
  const token = readAccessToken(request);
  const createJwks = dependencies.createJwks || createRemoteJWKSet;
  const verifyJwt = dependencies.verifyJwt || jwtVerify;

  let payload;
  try {
    const jwks = getJwks(config.teamDomain, createJwks);
    ({ payload } = await verifyJwt(token, jwks, {
      algorithms: ["RS256"],
      audience: config.audience,
      issuer: config.teamDomain,
      requiredClaims: ["exp", "iat"],
      clockTolerance: 5,
    }));
  } catch {
    deny();
  }

  const authenticatedEmail = normalizeEmail(payload?.email);
  if (authenticatedEmail !== config.allowedEmail) deny();

  return Object.freeze({ authenticated: true });
}

export const accessAuthTesting = Object.freeze({
  normalizeAudience,
  normalizeEmail,
  normalizeTeamDomain,
});
