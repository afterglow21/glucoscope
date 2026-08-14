function boundedInteger(value, maximum = 1_000_000) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) return null;
  return parsed;
}

function normalizePeriod(value) {
  const fromDay = String(value?.fromDay || "");
  const throughDay = String(value?.throughDay || "");
  const windowDays = boundedInteger(value?.windowDays, 90);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(fromDay)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(throughDay)
    || !windowDays
  ) return null;
  return Object.freeze({ fromDay, throughDay, windowDays, timezone: "Asia/Tokyo" });
}

function unavailable() {
  return Object.freeze({ status: "unavailable" });
}

export function normalizePublicUsageAggregate(value) {
  const period = normalizePeriod(value?.period);
  const minimumContributors = boundedInteger(value?.minimumContributors, 1_000);
  if (!period || !minimumContributors) return unavailable();

  if (value?.status === "suppressed") {
    return Object.freeze({ status: "suppressed", period, minimumContributors });
  }

  if (value?.status !== "available") return unavailable();
  const totals = {
    contributingDeviceProfiles: boundedInteger(value?.totals?.contributingDeviceProfiles),
    activeDays: boundedInteger(value?.totals?.activeDays),
    successfulAiAnalyses: boundedInteger(value?.totals?.successfulAiAnalyses),
    ordinaryGlucoMemories: boundedInteger(value?.totals?.ordinaryGlucoMemories),
  };
  if (Object.values(totals).some((item) => item === null)) return unavailable();

  return Object.freeze({
    status: "available",
    period,
    minimumContributors,
    totals: Object.freeze(totals),
  });
}

export async function loadPublicUsageAggregate(binding) {
  if (!binding || typeof binding.getPublicUsageAggregate !== "function") return unavailable();
  try {
    return normalizePublicUsageAggregate(await binding.getPublicUsageAggregate());
  } catch {
    return unavailable();
  }
}
