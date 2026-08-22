const HEADING_EMOJI_PATTERN = /[🌿📊🔎🌙🌱📈💌🫶]/u;
const BULLET_LOOKAHEAD_PATTERN = /(?:[-−–—－*]\s+|[•●・]\s*)/u;
const RENDERER_TOKEN_PATTERN = /[+＋\-−－]?\d+(?:\.\d+)?(?:\s?(?:%|％|mg\/dL|mg\/dl|U))?|[A-Za-z]+(?:[’'\-][A-Za-z]+)*|\s+|./gu;

// Both the public and administrator renderers use an 850 x 640px letter
// area. The public renderer has the larger paragraph gap, so these limits
// deliberately leave more than 10% vertical room at its minimum font size.
export const SHARE_STUDIO_LETTER_FIT_LIMITS = Object.freeze({
  ja: Object.freeze({
    maximumCharacters: 620,
    maximumParagraphs: 9,
    maximumEstimatedLines: 18,
    lineCapacityUnits: 38,
    maximumUnbreakableTokenCharacters: 38,
  }),
  en: Object.freeze({
    maximumCharacters: 900,
    maximumParagraphs: 9,
    maximumEstimatedLines: 18,
    lineCapacityUnits: 46,
    maximumUnbreakableTokenCharacters: 46,
  }),
});

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function normalizeProse(value, language) {
  return String(value || "")
    .replace(/\r/gu, "")
    .split(/\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(language === "en" ? " " : "");
}

function splitSentences(value, language) {
  const normalized = normalizeProse(value, language);
  if (!normalized) return [];
  const decimalMarker = "\uE000";
  const protectedValue = language === "en"
    ? normalized.replace(/(\d)\.(?=\d)/gu, `$1${decimalMarker}`)
    : normalized;
  const pattern = language === "en"
    ? /[^.!?]+(?:[.!?]+|$)/gu
    : /[^。！？!?]+(?:[。！？!?]+|$)/gu;
  return (protectedValue.match(pattern) || [protectedValue])
    .map((part) => part.replaceAll(decimalMarker, ".").trim())
    .filter(Boolean);
}

function splitDisplayParagraphs(value, language) {
  const raw = normalizeText(value);
  if (!raw) return [];
  const structuredRaw = raw
    .replace(new RegExp(`\\s*(?=${HEADING_EMOJI_PATTERN.source})`, "gu"), "\n")
    .replace(new RegExp(`[ \\t]+(?=${BULLET_LOOKAHEAD_PATTERN.source})`, "gu"), "\n")
    .replace(new RegExp(`([。！？!?🍀])(?=${BULLET_LOOKAHEAD_PATTERN.source})`, "gu"), "$1\n")
    .trim();
  const explicit = structuredRaw
    .split(/\n+/u)
    .map((part) => part
      .trim()
      .replace(/^(?:[-−–—－*]\s+|[•●・]\s*)/u, language === "en" ? "• " : "・ "))
    .map((part) => normalizeProse(part, language))
    .filter(Boolean);
  if (explicit.length >= 2) return explicit;

  let normalized = normalizeProse(structuredRaw, language);
  const paragraphs = [];
  const greetingPattern = language === "en"
    ? /^(Gluco(?: is here| here)?[.!]?\s*[🍀🌿]?)/iu
    : /^(グルコだよ[🍀🌿]?)/u;
  const greeting = normalized.match(greetingPattern);
  if (greeting) {
    paragraphs.push(greeting[1].trim());
    normalized = normalized.slice(greeting[0].length).trim();
  }

  const sentences = splitSentences(normalized, language);
  const targetLength = language === "en" ? 155 : 72;
  let buffer = "";
  let sentenceCount = 0;
  for (const sentence of sentences) {
    const separator = language === "en" && buffer ? " " : "";
    const candidate = `${buffer}${separator}${sentence}`;
    if (buffer && (sentenceCount >= 2 || candidate.length > targetLength)) {
      paragraphs.push(buffer);
      buffer = sentence;
      sentenceCount = 1;
    } else {
      buffer = candidate;
      sentenceCount += 1;
    }
  }
  if (buffer) paragraphs.push(buffer);
  return paragraphs;
}

function widthUnits(value) {
  return [...String(value || "")].reduce((total, character) => {
    if (/\p{Extended_Pictographic}/u.test(character)) return total + 2;
    return total + 1;
  }, 0);
}

function tokenizeRendererLine(value) {
  return String(value || "").match(RENDERER_TOKEN_PATTERN) || [];
}

export function getShareStudioLetterFitReport(value, languageValue = "ja") {
  const language = languageValue === "en" ? "en" : "ja";
  const limits = SHARE_STUDIO_LETTER_FIT_LIMITS[language];
  const text = normalizeText(value);
  const paragraphs = splitDisplayParagraphs(text, language);
  const characterCount = [...text].length;
  const estimatedLineCount = paragraphs.reduce(
    (total, paragraph) => total + Math.max(
      1,
      Math.ceil(widthUnits(paragraph) / limits.lineCapacityUnits),
    ),
    0,
  );
  const longestUnbreakableToken = Math.max(
    0,
    ...tokenizeRendererLine(text)
      .filter((token) => !/^\s+$/u.test(token))
      .map((token) => [...token].length),
  );
  const issues = [];
  if (characterCount > limits.maximumCharacters) {
    issues.push("share_studio_character_limit");
  }
  if (paragraphs.length > limits.maximumParagraphs) {
    issues.push("share_studio_paragraph_limit");
  }
  if (estimatedLineCount > limits.maximumEstimatedLines) {
    issues.push("share_studio_line_limit");
  }
  if (longestUnbreakableToken > limits.maximumUnbreakableTokenCharacters) {
    issues.push("share_studio_unbreakable_token");
  }
  return Object.freeze({
    fits: issues.length === 0,
    issues: Object.freeze(issues),
    characterCount,
    paragraphCount: paragraphs.length,
    estimatedLineCount,
    longestUnbreakableToken,
    limits,
  });
}

export function getShareStudioLetterFitIssues(value, language = "ja") {
  return getShareStudioLetterFitReport(value, language).issues;
}
