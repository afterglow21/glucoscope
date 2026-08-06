export const ALLOWED_DATASET_STATUSES = new Set(["synthetic", "anonymized", "live"]);
export const ALLOWED_SOURCE_DATA_STATUSES = new Set(["available", "pending"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateDataset(dataset) {
  assert(dataset && typeof dataset === "object", "Dataset must be an object.");
  assert(dataset.schemaVersion === 1, "Unsupported comparison dataset schema.");
  assert(ALLOWED_DATASET_STATUSES.has(dataset.status), "Dataset status must be synthetic, anonymized, or live.");
  assert(typeof dataset.title === "string" && dataset.title.trim(), "Dataset title is required.");
  assert(Number.isFinite(dataset.durationMinutes) && dataset.durationMinutes > 0, "Dataset duration must be positive.");
  assert(Array.isArray(dataset.sources) && dataset.sources.length === 3, "Exactly three CGM sources are required.");

  if (dataset.status === "live") {
    assert(Number.isSafeInteger(dataset.updatedAt) && dataset.updatedAt > 0, "Live dataset needs a numeric update time.");
  }

  const ids = new Set();
  let availableSourceCount = 0;
  for (const source of dataset.sources) {
    assert(typeof source.id === "string" && /^[a-z0-9-]+$/.test(source.id), "Each source needs a safe id.");
    assert(!ids.has(source.id), "Source ids must be unique.");
    ids.add(source.id);
    assert(typeof source.label === "string" && source.label.trim(), "Each source needs a label.");
    assert(/^#[0-9a-f]{6}$/i.test(source.color), "Each source needs a hex color.");
    assert(ALLOWED_SOURCE_DATA_STATUSES.has(source.dataStatus), "Each source needs an available or pending data status.");
    assert(Array.isArray(source.readings), "Each source needs a readings array.");
    if (source.dataStatus === "available") {
      assert(source.readings.length > 0, "Each available source needs readings.");
      availableSourceCount += 1;
    } else {
      assert(source.readings.length === 0, "A pending source must not contain readings.");
    }

    let previousMinute = -Infinity;
    for (const reading of source.readings) {
      assert(Array.isArray(reading) && reading.length === 2, "Readings must be [elapsedMinute, mg/dL].");
      const [minute, glucose] = reading;
      assert(Number.isFinite(minute) && minute >= 0 && minute <= dataset.durationMinutes, "Reading minute is outside the dataset window.");
      assert(minute > previousMinute, "Readings must be ordered without duplicate minutes.");
      assert(Number.isFinite(glucose) && glucose >= 20 && glucose <= 600, "Reading value is outside the supported display range.");
      previousMinute = minute;
    }
  }
  assert(availableSourceCount > 0, "At least one source must have readings.");

  const serialized = JSON.stringify(dataset);
  assert(!/(?:api[-_ ]?secret|password|access[-_ ]?token|nightscout[-_ ]?url|email|account[-_ ]?id)/i.test(serialized), "Dataset contains a forbidden private field name.");
  assert(!/https?:\/\//i.test(serialized), "Dataset must not contain a URL.");
  assert(!/\b\d{4}-\d{2}-\d{2}\b/.test(serialized), "Dataset must not contain an exact calendar date.");

  return dataset;
}

export function formatElapsedMinute(totalMinutes) {
  const minute = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const day = Math.floor(minute / 1440) + 1;
  const withinDay = minute % 1440;
  const hour = Math.floor(withinDay / 60);
  const rest = withinDay % 60;
  return `Day ${day} ${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function filterSourcesByWindow(sources, startMinute) {
  return sources.map((source) => ({
    ...source,
    readings: source.readings.filter(([minute]) => minute >= startMinute)
  }));
}

export function findNearestReading(readings, minute, toleranceMinutes = 3) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const reading of readings) {
    const distance = Math.abs(reading[0] - minute);
    if (distance < nearestDistance) {
      nearest = reading;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= toleranceMinutes ? nearest : null;
}

export function buildMatchedComparisons(sources, toleranceMinutes = 3) {
  if (!sources.length) return [];
  const anchor = sources.reduce((smallest, source) => (
    source.readings.length < smallest.readings.length ? source : smallest
  ), sources[0]);

  return anchor.readings.flatMap(([minute]) => {
    const matches = sources.map((source) => findNearestReading(source.readings, minute, toleranceMinutes));
    if (matches.some((match) => !match)) return [];
    const values = matches.map((match) => match[1]);
    return [{ minute, values, spread: Math.max(...values) - Math.min(...values) }];
  });
}

export function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function computeObservationSummary(sources, toleranceMinutes = 3) {
  const matched = buildMatchedComparisons(sources, toleranceMinutes);
  const anchor = sources.reduce((smallest, source) => (
    source.readings.length < smallest.readings.length ? source : smallest
  ), sources[0] || { readings: [] });
  const totalPossible = anchor.readings.length * sources.length;
  const totalPresent = anchor.readings.reduce((sum, [minute]) => (
    sum + sources.filter((source) => findNearestReading(source.readings, minute, toleranceMinutes)).length
  ), 0);
  return {
    matchedCount: matched.length,
    medianSpread: median(matched.map((item) => item.spread)),
    missingCount: Math.max(0, totalPossible - totalPresent)
  };
}
