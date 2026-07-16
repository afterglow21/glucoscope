const LOWER_CAMEL_CASE_PATTERN = /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g;
const INTERNAL_DOTTED_KEY_PATTERN = /\b(?:safeSummary|metrics|summary)\.[A-Za-z_$][A-Za-z0-9_$]*/g;
const JSON_KEY_PATTERN = /["'](?:celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|atLeast)["']\s*:/g;

export function getGeneratedLetterQualityIssues(text = "", language = "ja") {
  const normalizedText = String(text ?? "").trim();
  const issues = new Set();

  if (!normalizedText) {
    issues.add("empty_output");
    return [...issues];
  }

  // Style preferences such as Japanese plain-form wording, the exact opening,
  // and heading format remain prompt-level guidance. They should not cause an
  // otherwise readable and safe Gluco letter to be discarded.
  void language;

  if (LOWER_CAMEL_CASE_PATTERN.test(normalizedText)) {
    issues.add("internal_camel_case");
  }
  LOWER_CAMEL_CASE_PATTERN.lastIndex = 0;

  if (INTERNAL_DOTTED_KEY_PATTERN.test(normalizedText)) {
    issues.add("internal_dotted_key");
  }
  INTERNAL_DOTTED_KEY_PATTERN.lastIndex = 0;

  if (JSON_KEY_PATTERN.test(normalizedText)) {
    issues.add("json_key_artifact");
  }
  JSON_KEY_PATTERN.lastIndex = 0;

  return [...issues];
}
