const INTERNAL_IDENTIFIER_PATTERN = /\b(?:atLeast|celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|safeSummary|analysisMode|currentGlucose)\b/g;
const INTERNAL_DOTTED_KEY_PATTERN = /\b(?:safeSummary|metrics|summary)\.[A-Za-z_$][A-Za-z0-9_$]*/g;
const JSON_KEY_PATTERN = /["'](?:celebrationClues|patternHints|latestGlucoseReading|sevenDayAverageScore|previousScore|modeLabel|slotLabel|rangeLabel|atLeast|safeSummary|analysisMode|currentGlucose)["']\s*:/g;
const UNNATURAL_JAPANESE_SUGGESTION_PATTERN = /(?:一緒に[^\r\n。！？]{0,24})?(?:しよう|していこう|続けていこう|見ていこう|見てみよう|進めていこう|やってみよう|振り返ってみよう|試してみよう)かも(?:ね|よ)?(?:[。．.!！?？]|\r?\n|$)/gu;
const UNICORN_WORDING_PATTERN = /(?:🦄|ユニコーン|\bunicorn\b)/giu;
const TIR_UNICORN_COUPLING_PATTERN = /(?:\bTIR\b[^\r\n。！？]{0,80}(?:🦄|ユニコーン|\bunicorn\b)|(?:🦄|ユニコーン|\bunicorn\b)[^\r\n。！？]{0,80}\bTIR\b)/giu;
const BLAME_WEIGHTED_METRIC_PATTERN = /(?:\bTBR\b|\bTAR\b|\bCV\b)[^\r\n。！？]{0,36}(?:も(?:ある|あった|見える|見えている|残っている)|高すぎる|悪い|問題(?:だ|がある)?)/giu;
const DEFICIT_METRIC_PATTERN = /(?:\bTIR\b|\bGlucoScore\b)[^\r\n。！？]{0,36}(?:しか(?:ない|なかった)|まだ(?:低い|少ない)?|低すぎる|悪い|問題(?:だ|がある)?)/giu;
const JUDGMENTAL_METRIC_PREFIX_PATTERN = /(?:残念ながら|まだ)[^\r\n。！？]{0,28}(?:\bTIR\b|\bTAR\b|\bTBR\b|\bCV\b|\bGlucoScore\b)/giu;
const ISOLATED_METRIC_EXCLAMATION_PATTERN = /^(?:[・-]\s*)?(?:TIR|TAR|TBR|CV|GlucoScore)[^\r\n。！？!?]{0,30}[！!]\s*$/gmu;
const INTERNAL_WRITING_GUIDANCE_PATTERN = /(?:いたわり優先|非公開の書き方指示|文章づくりの注意|Compassion priority|Private writing guidance)/giu;
const VAGUE_METRIC_METAPHOR_PATTERN = /(?:平均(?:血糖)?の雰囲気|戻りの力|後からそっと見る場所|見る場所にしておく|小さくまとまる動き|低め寄りの景色|全体の景色)/gu;
const TBR_MINIMIZING_PATTERN = /\bTBR\b[^\r\n。！？]{0,48}(?:少し|ちょっと|わずか)/giu;
const LOW_TIME_REASSURANCE_PATTERN = /(?:\bTBR\b|低めの時間)[^\r\n。！？]{0,64}安心材料/giu;
const GMI_OVERINTERPRETATION_PATTERN = /\bGMI\b[^\r\n。！？]{0,64}(?:荒れて|荒れ|穏やか|安定|落ち着)/giu;
const UNSUPPORTED_METRIC_CHANGE_PATTERN = /(?:\bTIR\b|\bTAR\b|\bTBR\b|\bCV\b)[^\r\n。！？]{0,48}(?:増えている|増えた|減っている|減った|戻っている|戻った)/giu;
const TBR_CAUSAL_CONNECTOR_PATTERN = /\bTBR\b[^\r\n。！？]{0,40}(?:だから|なので|のため)/giu;
const DELTA_TREND_OVERINTERPRETATION_PATTERN = /(?:前回との差(?:分)?|差分)[^\r\n。！？]{0,72}(?:流れ|動き|急に大きく)/gu;
const AWKWARD_METRIC_PHRASING_PATTERN = /(?:一定ぶん|押さえられる|低め寄りにまとまっている|比較期間より\s*1(?:だけ)?(?:高|低)く|1(?:だけ)?(?:高|低)く見えている)/gu;
const COMPASSION_ACKNOWLEDGMENT_PATTERN = /(?:大変[^\r\n。！？]{0,36}かもしれない|しんど[^\r\n。！？]{0,36}かもしれない|今日はここまで[、,]?\s*おつかれさま|おつかれさま)/u;
const REFLECTION_INVITATION_PATTERN = /(?:見返して|振り返って|見てみよう|見ていこう|眺めてみよう|思い出してみよう|たどってみよう|辿ってみよう)/u;
const PUBLIC_METRIC_NAMES = ["TIR", "TAR", "TBR", "CV", "GMI", "GlucoScore"];

function getJapaneseSentenceSegments(text = "") {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[。！？!?])|\n+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function hasRepeatedTogetherInAdjacentClosingSentences(text = "") {
  const closingSegments = getJapaneseSentenceSegments(text).slice(-3);

  return closingSegments.some((segment, index) => (
    index < closingSegments.length - 1
    && segment.includes("一緒に")
    && closingSegments[index + 1].includes("一緒に")
  ));
}

function hasRepeatedAdjacentClosingInvitations(text = "") {
  const closingSegments = getJapaneseSentenceSegments(text).slice(-3);

  return closingSegments.some((segment, index) => (
    index < closingSegments.length - 1
    && REFLECTION_INVITATION_PATTERN.test(segment)
    && REFLECTION_INVITATION_PATTERN.test(closingSegments[index + 1])
  ));
}

function getMetricsRepeatedAcrossSegments(text = "") {
  const segments = getJapaneseSentenceSegments(text);

  return PUBLIC_METRIC_NAMES.filter((metricName) => (
    segments.filter((segment) => segment.includes(metricName)).length > 1
  ));
}

function getCompassionPlacementIssue(text = "", options = {}) {
  if (options?.compassionRequired !== true) return null;

  const compassionIndex = String(text ?? "").search(COMPASSION_ACKNOWLEDGMENT_PATTERN);
  if (compassionIndex < 0) return "missing_compassion_acknowledgment";

  const invitationIndex = String(text ?? "").search(REFLECTION_INVITATION_PATTERN);
  if (invitationIndex >= 0 && invitationIndex < compassionIndex) {
    return "compassion_after_reflection_invitation";
  }

  return null;
}

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

  if (language === "ja" && hasRepeatedTogetherInAdjacentClosingSentences(normalizedText)) {
    issues.add("repeated_together_closing");
  }

  if (language === "ja" && BLAME_WEIGHTED_METRIC_PATTERN.test(normalizedText)) {
    issues.add("blame_weighted_metric");
  }
  BLAME_WEIGHTED_METRIC_PATTERN.lastIndex = 0;

  if (language === "ja" && DEFICIT_METRIC_PATTERN.test(normalizedText)) {
    issues.add("deficit_weighted_metric");
  }
  DEFICIT_METRIC_PATTERN.lastIndex = 0;

  if (language === "ja" && JUDGMENTAL_METRIC_PREFIX_PATTERN.test(normalizedText)) {
    issues.add("judgmental_metric_prefix");
  }
  JUDGMENTAL_METRIC_PREFIX_PATTERN.lastIndex = 0;

  if (language === "ja" && ISOLATED_METRIC_EXCLAMATION_PATTERN.test(normalizedText)) {
    issues.add("isolated_metric_exclamation");
  }
  ISOLATED_METRIC_EXCLAMATION_PATTERN.lastIndex = 0;

  if (language === "ja" && INTERNAL_WRITING_GUIDANCE_PATTERN.test(normalizedText)) {
    issues.add("internal_writing_guidance");
  }
  INTERNAL_WRITING_GUIDANCE_PATTERN.lastIndex = 0;

  if (language === "ja" && VAGUE_METRIC_METAPHOR_PATTERN.test(normalizedText)) {
    issues.add("vague_metric_metaphor");
  }
  VAGUE_METRIC_METAPHOR_PATTERN.lastIndex = 0;

  if (language === "ja" && TBR_MINIMIZING_PATTERN.test(normalizedText)) {
    issues.add("tbr_minimizing_wording");
  }
  TBR_MINIMIZING_PATTERN.lastIndex = 0;

  if (language === "ja" && LOW_TIME_REASSURANCE_PATTERN.test(normalizedText)) {
    issues.add("low_time_as_reassurance");
  }
  LOW_TIME_REASSURANCE_PATTERN.lastIndex = 0;

  if (language === "ja" && GMI_OVERINTERPRETATION_PATTERN.test(normalizedText)) {
    issues.add("gmi_overinterpretation");
  }
  GMI_OVERINTERPRETATION_PATTERN.lastIndex = 0;

  if (language === "ja" && UNSUPPORTED_METRIC_CHANGE_PATTERN.test(normalizedText)) {
    issues.add("unsupported_metric_change");
  }
  UNSUPPORTED_METRIC_CHANGE_PATTERN.lastIndex = 0;

  if (language === "ja" && TBR_CAUSAL_CONNECTOR_PATTERN.test(normalizedText)) {
    issues.add("tbr_causal_connector");
  }
  TBR_CAUSAL_CONNECTOR_PATTERN.lastIndex = 0;

  if (language === "ja" && DELTA_TREND_OVERINTERPRETATION_PATTERN.test(normalizedText)) {
    issues.add("delta_trend_overinterpretation");
  }
  DELTA_TREND_OVERINTERPRETATION_PATTERN.lastIndex = 0;

  if (language === "ja" && AWKWARD_METRIC_PHRASING_PATTERN.test(normalizedText)) {
    issues.add("awkward_metric_phrasing");
  }
  AWKWARD_METRIC_PHRASING_PATTERN.lastIndex = 0;

  if (language === "ja" && hasRepeatedAdjacentClosingInvitations(normalizedText)) {
    issues.add("repeated_closing_invitation");
  }

  if (language === "ja") {
    const repeatedMetrics = getMetricsRepeatedAcrossSegments(normalizedText);
    if (repeatedMetrics.length) {
      issues.add("repeated_metric_across_sections");
    }

    const compassionPlacementIssue = getCompassionPlacementIssue(normalizedText, options);
    if (compassionPlacementIssue) {
      issues.add(compassionPlacementIssue);
    }

    if (["today", "yesterday"].includes(options?.period) && /\bGMI\b/iu.test(normalizedText)) {
      issues.add("short_range_gmi_mention");
    }

    if (
      options?.analysisMode === "letter"
      && options?.minorScoreDifference === true
      && /\bGlucoScore\b/iu.test(normalizedText)
    ) {
      issues.add("minor_score_difference_overemphasized");
    }
  }

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
