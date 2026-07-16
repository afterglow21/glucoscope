const INTERNAL_IDENTIFIER_PATTERN = /\b(?:atLeast|celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|safeSummary|analysisMode|currentGlucose)\b/g;
const INTERNAL_DOTTED_KEY_PATTERN = /\b(?:safeSummary|metrics|summary)\.[A-Za-z_$][A-Za-z0-9_$]*/g;
const JSON_KEY_PATTERN = /["'](?:celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|atLeast|safeSummary|analysisMode|currentGlucose)["']\s*:/g;
const UNNATURAL_JAPANESE_SUGGESTION_PATTERN = /(?:一緒に[^\r\n。！？]{0,24})?(?:しよう|していこう|続けていこう|見ていこう|見てみよう|進めていこう|やってみよう|振り返ってみよう|試してみよう)かも(?:ね|よ)?(?:[。．.!！?？]|\r?\n|$)/gu;

export function getGeneratedLetterQualityIssues(text = "", language = "ja") {
  const normalizedText = String(text ?? "").trim();
  const issues = new Set();

  if (!normalizedText) {
    issues.add("empty_output");
    return [...issues];
  }

  // Voice and layout remain prompt-level guidance. Blocking validation is
  // limited to known implementation artifacts and a narrowly defined
  // unnatural suggestion ending. Public units such as mg/dL and ordinary
  // uncertainty wording such as "続くかも" remain accepted.

  if (INTERNAL_IDENTIFIER_PATTERN.test(normalizedText)) {
    issues.add("internal_identifier");
  }
  INTERNAL_IDENTIFIER_PATTERN.lastIndex = 0;

  if (INTERNAL_DOTTED_KEY_PATTERN.test(normalizedText)) {
    issues.add("internal_dotted_key");
  }
  INTERNAL_DOTTED_KEY_PATTERN.lastIndex = 0;

  if (JSON_KEY_PATTERN.test(normalizedText)) {
    issues.add("json_key_artifact");
  }
  JSON_KEY_PATTERN.lastIndex = 0;

  if (language === "ja" && UNNATURAL_JAPANESE_SUGGESTION_PATTERN.test(normalizedText)) {
    issues.add("unnatural_japanese_suggestion");
  }
  UNNATURAL_JAPANESE_SUGGESTION_PATTERN.lastIndex = 0;

  return [...issues];
}
