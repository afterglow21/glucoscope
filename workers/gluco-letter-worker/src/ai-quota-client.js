const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ANALYSIS_MODES = new Set(["letter", "deep"]);
const CREDENTIAL_KINDS = new Set(["device_profile", "account"]);

function readBoolean(value, fallback = false) {
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function safeQuota(value) {
  if (!value || typeof value !== "object") return null;
  const tier = value.tier === "plus" ? "plus" : value.tier === "free" ? "free" : null;
  const dailyLimit = Number(value.dailyLimit);
  const successful = Number(value.successful);
  const remaining = Number(value.remaining);
  const resetsAt = typeof value.resetsAt === "string" ? value.resetsAt : "";
  if (
    !tier
    || !Number.isSafeInteger(dailyLimit)
    || !Number.isSafeInteger(successful)
    || !Number.isSafeInteger(remaining)
    || dailyLimit < 0
    || successful < 0
    || remaining < 0
    || !resetsAt
  ) {
    return null;
  }
  return Object.freeze({ tier, dailyLimit, successful, remaining, resetsAt });
}

function serviceFailure(stage, result, fallbackError) {
  return {
    ok: false,
    stage,
    error: typeof result?.error === "string" ? result.error : fallbackError,
    retryable: result?.retryable === true,
    quota: safeQuota(result?.quota),
  };
}

function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current?.name === "AbortError" || current?.code === "request_aborted") return true;
    current = current?.cause;
  }
  return false;
}

export function readAiQuotaClientConfig(env = {}) {
  return Object.freeze({
    enabled: readBoolean(env.AI_PER_USER_QUOTA_ENABLED, false),
  });
}

export function readAiQuotaCorsConfig(env = {}) {
  const enabled = readAiQuotaClientConfig(env).enabled;
  return Object.freeze({
    allowedRequestHeaders: Object.freeze(enabled
      ? ["authorization", "content-type"]
      : ["content-type"]),
    allowedRequestHeadersDisplay: enabled
      ? "Authorization, Content-Type"
      : "Content-Type",
  });
}

export function readAiQuotaRequest(request, payload, analysisMode) {
  const authorization = String(request?.headers?.get?.("Authorization") || "");
  const bearerMatch = /^Bearer ([A-Za-z0-9_-]{43})$/iu.exec(authorization);
  const token = bearerMatch?.[1] || "";
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  const credentialKind = typeof payload?.quotaCredentialKind === "string"
    ? payload.quotaCredentialKind
    : "device_profile";
  const normalizedMode = String(analysisMode || "");

  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, error: "authentication_required", status: 401 };
  }
  if (
    !UUID_PATTERN.test(requestId)
    || !ANALYSIS_MODES.has(normalizedMode)
    || !CREDENTIAL_KINDS.has(credentialKind)
  ) {
    return { ok: false, error: "invalid_quota_request", status: 400 };
  }

  return {
    ok: true,
    reserveInput: Object.freeze({
      credential: Object.freeze({ kind: credentialKind, token }),
      requestId,
      analysisMode: normalizedMode,
    }),
  };
}

export function getQuotaReleaseReason(error, signal) {
  if (isAbortError(error, signal)) return "request_aborted";
  if (error?.code === "openai_output_quality_failed") return "quality_failed";
  if (error?.code === "openai_incomplete_output") return "generation_incomplete";
  if (
    error?.code === "openai_transport_error"
    || error?.code === "openai_api_error"
    || error?.code === "missing_openai_api_key"
  ) {
    return "provider_error";
  }
  return "internal_error";
}

export function buildAuthoritativeQuotaPayload(quota, { consumed = false } = {}) {
  const normalized = safeQuota(quota);
  return Object.freeze({
    authoritative: true,
    consumed: consumed === true,
    ...(normalized || {}),
  });
}

export async function runAiQuotaGeneration({
  enabled = false,
  service,
  reserveInput,
  signal,
  generate,
}) {
  if (typeof generate !== "function") {
    throw new TypeError("generate must be a function");
  }
  if (!enabled) {
    return { ok: true, result: await generate(), quota: null, authoritative: false };
  }
  if (signal?.aborted) {
    return {
      ok: false,
      stage: "generation",
      error: "request_aborted",
      retryable: true,
      generationError: Object.assign(new Error("Request aborted."), { code: "request_aborted" }),
    };
  }
  if (
    !service
    || typeof service.reserveAiGeneration !== "function"
    || typeof service.completeAiGeneration !== "function"
    || typeof service.releaseAiGeneration !== "function"
  ) {
    return { ok: false, stage: "reserve", error: "quota_service_unavailable", retryable: true };
  }

  let reservation;
  try {
    reservation = await service.reserveAiGeneration(reserveInput);
  } catch {
    return { ok: false, stage: "reserve", error: "quota_service_unavailable", retryable: true };
  }
  if (!reservation?.ok || reservation.status !== "reserved" || !UUID_PATTERN.test(String(reservation.reservationId || ""))) {
    return serviceFailure("reserve", reservation, "quota_reservation_failed");
  }

  const reservationId = reservation.reservationId;
  let generated;
  try {
    generated = await generate();
    if (typeof generated?.text !== "string" || !generated.text.trim()) {
      const error = new Error("Generated AI response was empty.");
      error.code = "openai_incomplete_output";
      throw error;
    }
    if (signal?.aborted) throw Object.assign(new Error("Request aborted."), {
      name: "AbortError",
      code: "request_aborted",
    });
  } catch (generationError) {
    const reasonCode = getQuotaReleaseReason(generationError, signal);
    let released;
    try {
      released = await service.releaseAiGeneration({ reservationId, reasonCode });
    } catch {
      return {
        ok: false,
        stage: "release",
        error: "quota_service_unavailable",
        retryable: true,
        generationError,
      };
    }
    const releasedQuota = safeQuota(released?.quota);
    if (
      !released?.ok
      || (released.status !== "released" && released.status !== "already_released")
      || !releasedQuota
    ) {
      return {
        ...serviceFailure("release", released, "quota_release_failed"),
        generationError,
      };
    }
    return {
      ok: false,
      stage: "generation",
      error: reasonCode,
      retryable: true,
      generationError,
      quota: releasedQuota,
    };
  }

  let completed;
  try {
    completed = await service.completeAiGeneration({ reservationId });
  } catch {
    return {
      ok: false,
      stage: "complete",
      error: "quota_service_unavailable",
      retryable: true,
      knownUsage: generated?.usage || null,
    };
  }
  const completedQuota = safeQuota(completed?.quota);
  if (
    !completed?.ok
    || (completed.status !== "completed" && completed.status !== "already_succeeded")
    || !completedQuota
  ) {
    return {
      ...serviceFailure("complete", completed, "quota_finalize_failed"),
      knownUsage: generated?.usage || null,
    };
  }

  return {
    ok: true,
    result: generated,
    quota: completedQuota,
    authoritative: true,
  };
}

export const aiQuotaClientTesting = Object.freeze({
  TOKEN_PATTERN,
  UUID_PATTERN,
  safeQuota,
});
