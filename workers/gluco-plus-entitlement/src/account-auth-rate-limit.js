import { AccountAuthError } from "./account-auth-core.js";

function isValidIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => (
    /^(?:0|[1-9]\d{0,2})$/u.test(part)
    && Number(part) <= 255
  ));
}

function isValidIpv6(value) {
  if (!value.includes(":") || /[\[\]%\s]/u.test(value)) return false;
  try {
    const parsed = new URL(`http://[${value}]/`);
    return parsed.username === ""
      && parsed.password === ""
      && parsed.port === ""
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function requireConnectingIp(request) {
  const value = request?.headers?.get("CF-Connecting-IP");
  if (
    typeof value !== "string"
    || !value
    || value.length > 45
    || (!isValidIpv4(value) && !isValidIpv6(value))
  ) {
    throw new AccountAuthError("service_unavailable", 503);
  }
  return value;
}

export async function enforceAccountAuthRateLimit(request, binding) {
  const key = requireConnectingIp(request);
  if (!binding || typeof binding.limit !== "function") {
    throw new AccountAuthError("service_unavailable", 503);
  }
  let result;
  try {
    result = await binding.limit({ key });
  } catch {
    throw new AccountAuthError("service_unavailable", 503);
  }
  if (result?.success === true) return Object.freeze({ allowed: true });
  if (result?.success === false) {
    throw new AccountAuthError("please_wait", 429, {
      retryAfterSeconds: 60,
    });
  }
  throw new AccountAuthError("service_unavailable", 503);
}
