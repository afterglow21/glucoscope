const INTERNAL_IDENTIFIER_PATTERN = /\b(?:atLeast|celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|safeSummary|analysisMode|currentGlucose)\b/g;
const INTERNAL_DOTTED_KEY_PATTERN = /\b(?:safeSummary|metrics|summary)\.[A-Za-z_$][A-Za-z0-9_$]*/g;
const JSON_KEY_PATTERN = /["'](?:celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|atLeast|safeSummary|analysisMode|currentGlucose)["']\s*:/g;
const UNNATURAL_JAPANESE_SUGGESTION_PATTERN = /(?:一緒に[^\r\n。！？]{0,24})?(?:しよう|していこう|続けていこう|見ていこう|見てみよう|進めていこう|やってみよう|振り返ってみよう|試してみよう)かも(?:ね|よ)?(?:[。．.!！?？]|\r?\n|$)/gu;
const UNICORN_WORDING_PATTERN = /(?:🦄|ユニコーン|\bunicorn\b)/giu;
const TIR_UNICORN_COUPLING_PATTERN = /(?:\bTIR\b[^\r\n。！？]{0,80}(?:🦄|ユニコーン|\bunicorn\b)|(?:🦄|ユニコーン|\bunicorn\b)[^\r\n。！？]{0,80}\bTIR\b)/giu;

export function isUnicornEligibleSummary(summary = {}) {
  const latestGlucose = Number(summary.currentGlucose ?? summary.latestGlucoseReading);

  return (
    summary.period === "today"
    && Number.isFinite(latestGlucose)
    && latestGlucose === 100
  );
}

export function getGeneratedLetterQualityIssues(
  text = "",
  language = "ja",
  options = {}
) {
  const normalizedText = String(text ?? "").trim();
  const issues = new Set();

  if (!normalizedText) {
    issues.add("empty_output");
    return [...issues];
  }

  // Voice and layout remain prompt-level guidance. Blocking validation is
  // limited to known implementation artifacts and narrowly defined wording
  // mistakes. Public units such as mg/dL and ordinary uncertainty wording
  // such as "続くかも" remain accepted.

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

  const containsUnicornWording = UNICORN_WORDING_PATTERN.test(normalizedText);
  UNICORN_WORDING_PATTERN.lastIndex = 0;

  if (containsUnicornWording && options?.allowUnicorn !== true) {
    issues.add("unqualified_unicorn");
  }

  if (TIR_UNICORN_COUPLING_PATTERN.test(normalizedText)) {
    issues.add("tir_unicorn_coupling");
  }
  TIR_UNICORN_COUPLING_PATTERN.lastIndex = 0;

  return [...issues];
}
