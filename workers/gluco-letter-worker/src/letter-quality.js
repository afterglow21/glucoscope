import { getShareStudioLetterFitIssues } from "./share-studio-letter-fit.js";

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
const METRIC_OPTIMIZATION_DIRECTIVE_PATTERN = /(?:目標(?:範囲)?(?:で過ごす|にいる|の)?時間|TIR|TAR|TBR|CV|GlucoScore|低めの時間|高めの時間)[^\r\n。！？]{0,48}(?:増やす|増やせる|伸ばす|伸ばせる|減らす|減らせる|抑える|なくす|避ける|維持する|維持できる|保つ|改善する|改善できる|良くする)[^\r\n。！？]{0,56}(?:意識|目指|心がけ|進め|取り組|続け|できるよう|ようにしよう|ようにしていこう)/giu;
const SINGLE_FOCUS_DIRECTIVE_PATTERN = /(?:こと)?だけ(?:を)?意識して(?:進め|過ごし|やって|取り組み|続け)(?:て)?(?:みよう|いこう|よう)?(?:ね|よ)?/gu;
const METRIC_TARGET_INVITATION_PATTERN = /(?:TIR|TAR|TBR|CV|GlucoScore|目標(?:範囲)?(?:の)?時間|低めの時間|高めの時間)[^\r\n。！？]{0,72}(?:目指そう|目指していこう|できるようにしよう|ようにしていこう|改善していこう|維持していこう)/giu;
const GLUCO_SCORE_NAME_PATTERN = /(?:\bGlucoScore\b|グルコスコア)/iu;
const GLUCO_SCORE_NAME_GLOBAL_PATTERN = /(?:\bGlucoScore\b|グルコスコア)/giu;
const GMI_NAME_PATTERN = /\bGMI\b/iu;
const JAPANESE_TERMINAL_PUNCTUATION_PATTERN = /[。！？!?…]$/u;
const JAPANESE_LABEL_ENDING_PATTERN = /(?:全体の流れ|数字の手がかり|見えている手がかり|気になった動き|振り返りの手がかり|小さな見返し|まとめ)$/u;
const TRAILING_EMOJI_SEQUENCE_PATTERN = /\s*((?:(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)(?:\s*))+)[。．.]*$/u;

// These issues are worth rewriting once, but they are not safety, medical,
// factual-accuracy, or internal-data failures. After one quality retry, a
// readable answer with only these issues is safer and kinder to show than a
// generic generation error.
const SOFT_QUALITY_ISSUE_CODES = new Set([
  "unnatural_japanese_suggestion",
  "repeated_together_closing",
  "isolated_metric_exclamation",
  "vague_metric_metaphor",
  "awkward_metric_phrasing",
  "repeated_closing_invitation",
  "repeated_metric_across_sections",
  "missing_compassion_acknowledgment",
  "compassion_after_reflection_invitation",
  "minor_score_difference_overemphasized"
]);

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

export function partitionGeneratedLetterQualityIssues(issues = []) {
  const uniqueIssues = [...new Set(Array.isArray(issues) ? issues : [])];
  const softWarnings = uniqueIssues.filter((issue) => SOFT_QUALITY_ISSUE_CODES.has(issue));
  const blockingIssues = uniqueIssues.filter((issue) => !SOFT_QUALITY_ISSUE_CODES.has(issue));

  return {
    blockingIssues,
    softWarnings
  };
}

function toOptionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "" || value === "--") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getGlucoScoreMentionPolicy(summary = {}) {
  const metrics = summary?.metrics || summary || {};
  const currentScore = toOptionalFiniteNumber(metrics.glucoScore);
  const previousScore = toOptionalFiniteNumber(metrics.previousScore);

  if (currentScore === null || previousScore === null) {
    return {
      mention: false,
      difference: null,
      reason: "comparison_unavailable"
    };
  }

  const difference = currentScore - previousScore;
  if (difference < 0) {
    return { mention: false, difference, reason: "lower" };
  }
  if (difference === 0) {
    return { mention: false, difference, reason: "same" };
  }
  if (difference === 1) {
    return { mention: false, difference, reason: "minor_increase" };
  }

  return { mention: true, difference, reason: "higher_by_at_least_two" };
}

export function filterGeneratedLetterPatternHints(summary = {}, limit = 6) {
  const scorePolicy = getGlucoScoreMentionPolicy(summary);
  const suppressGmi = ["today", "yesterday"].includes(summary?.period);
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 6;

  return (Array.isArray(summary?.patternHints) ? summary.patternHints : [])
    .filter((hint) => typeof hint === "string")
    .map((hint) => hint.trim())
    .filter(Boolean)
    .filter((hint) => scorePolicy.mention || !GLUCO_SCORE_NAME_PATTERN.test(hint))
    .filter((hint) => !suppressGmi || !GMI_NAME_PATTERN.test(hint))
    .slice(0, safeLimit);
}

function hasRepeatedGlucoScoreMention(text = "") {
  const segments = getJapaneseSentenceSegments(text);
  const scoreSegments = segments.filter((segment) => GLUCO_SCORE_NAME_PATTERN.test(segment));
  const totalMentions = String(text ?? "").match(GLUCO_SCORE_NAME_GLOBAL_PATTERN)?.length || 0;

  return scoreSegments.length > 1 || totalMentions > 2;
}

function isJapaneseLetterLabel(line = "", index = 0) {
  const normalized = String(line ?? "").trim();
  if (!normalized) return true;
  if (index === 0 && /^グルコだよ\s*🍀?$/u.test(normalized)) return true;
  if (/^#{1,6}\s+\S+/u.test(normalized)) return true;

  const withoutBullet = normalized.replace(/^[・*-]\s*/u, "");
  if (JAPANESE_LABEL_ENDING_PATTERN.test(withoutBullet)) return true;

  return /^(?:🍀|📊|🔎|🌱|💌|🫶)\s*[^。、！？!?]{1,24}$/u.test(normalized);
}

function normalizeJapaneseTrailingEmoji(line = "") {
  const normalized = String(line ?? "").trimEnd();
  const emojiMatch = normalized.match(TRAILING_EMOJI_SEQUENCE_PATTERN);
  if (!emojiMatch) return null;

  const body = normalized
    .slice(0, emojiMatch.index)
    .trimEnd()
    .replace(/[。．.]+$/u, "")
    .trimEnd();
  const emoji = emojiMatch[1].trim();

  return `${body}${emoji}`;
}

function shouldAddJapaneseFullStop(line = "", index = 0) {
  if (isJapaneseLetterLabel(line, index)) return false;

  const normalized = String(line ?? "").trim();
  if (!normalized || JAPANESE_TERMINAL_PUNCTUATION_PATTERN.test(normalized)) return false;
  if (/[：:]$/u.test(normalized)) return false;
  if (/\d(?:%|％|mg\/dL)?$/iu.test(normalized)) return false;

  const hasSentenceEnding = /[ぁ-んァ-ヶ一-龠](?:だ|よ|ね|た|る|う|い|ない|たい|よう|そう|かも)(?:ね|よ)?$/u.test(normalized)
    || /[、，]/u.test(normalized);
  if (/^[・*-]\s*/u.test(normalized)) return hasSentenceEnding;

  return hasSentenceEnding || /[ぁ-んァ-ヶ一-龠]/u.test(normalized);
}

export function normalizeGeneratedLetterPunctuation(text = "", language = "ja") {
  const normalizedText = String(text ?? "").trim();
  if (language !== "ja" || !normalizedText) return normalizedText;

  return normalizedText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, index) => {
      const trimmed = line.trimEnd();
      const emojiEnding = normalizeJapaneseTrailingEmoji(trimmed);
      if (emojiEnding !== null) return emojiEnding;
      if (!shouldAddJapaneseFullStop(trimmed, index)) return trimmed;
      return `${trimmed}。`;
    })
    .join("\n")
    .trim();
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

  if (language === "ja" && METRIC_OPTIMIZATION_DIRECTIVE_PATTERN.test(normalizedText)) {
    issues.add("metric_optimization_directive");
  }
  METRIC_OPTIMIZATION_DIRECTIVE_PATTERN.lastIndex = 0;

  if (language === "ja" && SINGLE_FOCUS_DIRECTIVE_PATTERN.test(normalizedText)) {
    issues.add("single_focus_directive");
  }
  SINGLE_FOCUS_DIRECTIVE_PATTERN.lastIndex = 0;

  if (language === "ja" && METRIC_TARGET_INVITATION_PATTERN.test(normalizedText)) {
    issues.add("metric_target_invitation");
  }
  METRIC_TARGET_INVITATION_PATTERN.lastIndex = 0;

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

  if (options?.shareStudio === true) {
    for (const issue of getShareStudioLetterFitIssues(normalizedText, language)) {
      issues.add(issue);
    }
  }

  if (options?.suppressGlucoScore === true && GLUCO_SCORE_NAME_PATTERN.test(normalizedText)) {
    issues.add("suppressed_gluco_score_mention");
  }

  if (options?.suppressGlucoScore !== true && hasRepeatedGlucoScoreMention(normalizedText)) {
    issues.add("repeated_gluco_score_mention");
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
