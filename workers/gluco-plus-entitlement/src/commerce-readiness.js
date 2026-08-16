const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function readIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!ISO_DATE_PATTERN.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    return null;
  }
  return raw;
}

function readExactBoolean(value) {
  return value === true || value === "true";
}

function readSameSitePublicUrl(origin, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin
      || url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || !url.pathname.startsWith("/pages/trust/")
      || url.pathname.endsWith("/")) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function readCommerceReadiness(env = {}, allowedOrigin = "") {
  const commercialDisclosureUrl = readSameSitePublicUrl(
    allowedOrigin,
    env.PLUS_COMMERCIAL_DISCLOSURE_PATH,
  );
  const refundPolicyUrl = readSameSitePublicUrl(
    allowedOrigin,
    env.PLUS_REFUND_POLICY_PATH,
  );
  const supportUrl = readSameSitePublicUrl(
    allowedOrigin,
    env.PLUS_SUPPORT_PATH,
  );
  const termsVersion = readIsoDate(env.PLUS_TERMS_VERSION);
  const buyerConfirmationVersion = readIsoDate(
    env.PLUS_BUYER_CONFIRMATION_VERSION,
  );

  return Object.freeze({
    ready: readExactBoolean(env.PLUS_SALES_READINESS_CONFIRMED)
      && String(env.PLUS_FINAL_PRICE_DISPLAY ?? "") === "total_300_confirmed"
      && readExactBoolean(env.PLUS_TAX_TREATMENT_CONFIRMED)
      && String(env.PLUS_BUYER_POLICY ?? "")
        === "adult_self_or_confirmed_guardian"
      && Boolean(termsVersion)
      && Boolean(buyerConfirmationVersion)
      && Boolean(commercialDisclosureUrl)
      && Boolean(refundPolicyUrl)
      && Boolean(supportUrl),
    commercialDisclosureUrl,
    refundPolicyUrl,
    supportUrl,
    termsVersion,
    buyerConfirmationVersion,
  });
}
