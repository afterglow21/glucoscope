const JAPANESE_POLITE_ENDING_PATTERN = /(?:です|ます|でした|ました|あります|ありません|ございます|ください|ましょう|でしょう)(?:ね|よ|か)?(?:[。．.!！?？]|\r?\n|$)/gu;
const LOWER_CAMEL_CASE_PATTERN = /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g;
const INTERNAL_DOTTED_KEY_PATTERN = /\b(?:safeSummary|metrics|summary)\.[A-Za-z_$][A-Za-z0-9_$]*/g;
const JSON_KEY_PATTERN = /["'](?:celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|atLeast)["']\s*:/g;
const MARKDOWN_HEADING_PATTERN = /^\s*#{1,6}\s+/m;

export function getGeneratedLetterQualityIssues(text = "", language = "ja") {
  const normalizedText = String(text ?? "").trim();
  const issues = new Set();

  if (!normalizedText) {
    issues.add("empty_output");
    return [...issues];
  }

  if (language === "ja") {
    if (!normalizedText.startsWith("グルコだよ🍀")) {
      issues.add("missing_gluco_opening");
    }

    if (JAPANESE_POLITE_ENDING_PATTERN.test(normalizedText)) {
      issues.add("japanese_polite_ending");
    }
    JAPANESE_POLITE_ENDING_PATTERN.lastIndex = 0;
  }

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

  if (MARKDOWN_HEADING_PATTERN.test(normalizedText)) {
    issues.add("markdown_heading");
  }

  return [...issues];
}
