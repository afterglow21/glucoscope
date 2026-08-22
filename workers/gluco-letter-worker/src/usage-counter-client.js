function unavailable(reason = "usage_counter_unavailable") {
  return Object.freeze({
    ok: false,
    error: "usage_counter_unavailable",
    reason,
    retryable: true
  });
}

export function getUsageCounterStub(namespace, name = "glucoscope-global-usage") {
  if (namespace && typeof namespace.getByName === "function") {
    return namespace.getByName(name);
  }
  if (
    namespace
    && typeof namespace.idFromName === "function"
    && typeof namespace.get === "function"
  ) {
    return namespace.get(namespace.idFromName(name));
  }
  return null;
}

export const ATOMIC_USAGE_GENERATION_TIMEOUT_MS = 120 * 1000;
export const ATOMIC_USAGE_ABORT_GRACE_MS = 5 * 1000;

function generationDeadlineError(code) {
  const error = new Error(code === "generation_timeout"
    ? "AI generation exceeded the atomic usage reservation deadline."
    : "AI generation request was aborted.");
  error.name = "AbortError";
  error.code = code;
  return error;
}

export async function runWithGenerationDeadline({
  run,
  signal,
  timeoutMs = ATOMIC_USAGE_GENERATION_TIMEOUT_MS,
  abortGraceMs = ATOMIC_USAGE_ABORT_GRACE_MS
} = {}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  if (signal?.aborted) throw generationDeadlineError("request_aborted");

  const controller = new AbortController();
  const duration = Math.max(1, Math.floor(Number(timeoutMs) || ATOMIC_USAGE_GENERATION_TIMEOUT_MS));
  const graceDuration = Math.max(0, Math.floor(Number(abortGraceMs) || 0));
  let timeoutId;
  let onParentAbort;
  let operationPromise;
  try {
    operationPromise = Promise.resolve(run(controller.signal));
  } catch (error) {
    operationPromise = Promise.reject(error);
  }
  const operation = operationPromise
    .then(
      (value) => ({ type: "completed", value }),
      (error) => ({ type: "failed", error })
    );
  const deadline = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      const error = generationDeadlineError("generation_timeout");
      controller.abort(error);
      resolve({ type: "deadline", error });
    }, duration);
    if (signal) {
      onParentAbort = () => {
        const error = generationDeadlineError("request_aborted");
        controller.abort(error);
        resolve({ type: "deadline", error });
      };
      signal.addEventListener("abort", onParentAbort, { once: true });
      if (signal.aborted) onParentAbort();
    }
  });

  try {
    const first = await Promise.race([operation, deadline]);
    if (first.type === "completed") return first.value;
    if (first.type === "failed") throw first.error;

    let graceTimeoutId;
    const grace = new Promise((resolve) => {
      graceTimeoutId = setTimeout(() => resolve({ type: "grace_expired" }), graceDuration);
    });
    const afterAbort = await Promise.race([operation, grace]);
    clearTimeout(graceTimeoutId);
    if (afterAbort.type === "failed") throw afterAbort.error;
    if (afterAbort.type === "completed") {
      const usage = afterAbort.value?.result?.usage || afterAbort.value?.usage;
      if (usage && typeof usage === "object") first.error.usage = usage;
    }
    throw first.error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", onParentAbort);
  }
}

export async function runWithAtomicUsageReservation({
  run,
  release,
  signal,
  timeoutMs = ATOMIC_USAGE_GENERATION_TIMEOUT_MS,
  abortGraceMs = ATOMIC_USAGE_ABORT_GRACE_MS
} = {}) {
  if (typeof release !== "function") throw new TypeError("release must be a function");
  try {
    const result = await runWithGenerationDeadline({ run, signal, timeoutMs, abortGraceMs });
    return { ok: true, result };
  } catch (error) {
    try {
      const releaseResult = await release(error);
      return { ok: false, error, releaseResult };
    } catch (releaseError) {
      return { ok: false, error, releaseError };
    }
  }
}

export async function invokeAtomicUsageCounter({
  enabled = false,
  namespace,
  name = "glucoscope-global-usage",
  method,
  input = {},
  config = {}
} = {}) {
  if (!enabled) {
    return Object.freeze({
      ok: false,
      error: "atomic_usage_counter_disabled",
      reason: "feature_disabled",
      retryable: false
    });
  }
  if (!namespace) {
    return unavailable("binding_missing");
  }

  try {
    const stub = getUsageCounterStub(namespace, name);
    if (!stub) return unavailable("binding_missing");
    const rpc = stub?.[method];
    if (typeof rpc !== "function") return unavailable("rpc_missing");
    const result = await stub[method](input, config);
    if (!result || typeof result !== "object" || !result.state || typeof result.state !== "object") {
      return unavailable("invalid_rpc_response");
    }
    return Object.freeze({ ok: true, result });
  } catch (error) {
    console.error("Atomic usage counter RPC invocation failed", {
      method,
      name: error?.name || "Error",
      message: error?.message || "Unknown RPC error"
    });
    return unavailable("rpc_failed");
  }
}

export async function invokeAtomicUsageFinalization(options = {}) {
  if (options.method !== "completeGeneration" && options.method !== "releaseGeneration") {
    throw new TypeError("Atomic usage finalization supports completeGeneration or releaseGeneration only");
  }
  const first = await invokeAtomicUsageCounter(options);
  if (first.ok) return Object.freeze({ ...first, attempts: 1 });
  const second = await invokeAtomicUsageCounter(options);
  return Object.freeze({ ...second, attempts: 2 });
}
