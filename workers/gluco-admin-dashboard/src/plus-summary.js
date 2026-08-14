const MAX_ACTIVE_PLUS_COUNT = 1_000_000;

const unavailableSummary = () => Object.freeze({
  available: false,
  activePlusCount: null,
});

function normalizeActivePlusCount(value) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_ACTIVE_PLUS_COUNT
  ) {
    return null;
  }
  return value;
}

// The service binding is optional while the Plus entitlement Worker is being prepared.
// Only the aggregate count is accepted; every other returned field is discarded.
export async function readAdminPlusSummary(service) {
  if (!service || typeof service.getActivePlusSummary !== "function") {
    return unavailableSummary();
  }

  try {
    const response = await service.getActivePlusSummary();
    const activePlusCount = normalizeActivePlusCount(response?.activePlusCount);
    if (activePlusCount === null) return unavailableSummary();
    return Object.freeze({
      available: true,
      activePlusCount,
    });
  } catch {
    return unavailableSummary();
  }
}

export const plusSummaryTesting = Object.freeze({
  MAX_ACTIVE_PLUS_COUNT,
  normalizeActivePlusCount,
});
