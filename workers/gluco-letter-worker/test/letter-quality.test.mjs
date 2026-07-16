import test from "node:test";
import assert from "node:assert/strict";

import { getGeneratedLetterQualityIssues } from "../src/letter-quality.js";

test("accepts Gluco-style Japanese wording", () => {
  const text = "グルコだよ🍀\nTIRは82％で、落ち着いた時間がしっかり見えているよ。\n明日も流れをやさしく見てみよう。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts the public glucose unit mg/dL in Japanese output", () => {
  const text = "グルコだよ🍀\n平均血糖は132mg/dLで、表示中の流れをやさしく見返せるよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts the public glucose unit mg/dL in English output", () => {
  const text = "Gluco is here 🍀\nAverage glucose was 132mg/dL in the selected range.";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "en"), []);
});

test("does not discard readable Japanese because one polite ending appears", () => {
  const text = "グルコだよ🍀\nTIRは82％です。\n落ち着いた時間も見えているよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("does not require an exact opening string to display a safe letter", () => {
  const text = "グルコだよ 🍀\n表示中の流れをやさしく見てみたよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("does not discard a safe letter only because it contains a Markdown heading", () => {
  const text = "グルコだよ🍀\n## 全体の流れ\n落ち着いた時間が見えているよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects the observed unnatural suggestion ending", () => {
  const text = "グルコだよ🍀\n一緒にゆるく続けていこうかも。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("unnatural_japanese_suggestion"));
});

test("rejects another suggestion plus kamo combination", () => {
  const text = "グルコだよ🍀\n明日も一緒に見てみようかもね。";
  const issues = getGeneratedLetterQualityIssues(text, "ja");
  assert.ok(issues.includes("unnatural_japanese_suggestion"));
});

test("accepts a natural uncertain observation ending in kamo", () => {
  const text = "グルコだよ🍀\n午後は高めの時間が少し続くかもしれないね。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("accepts a natural invitation without kamo", () => {
  const text = "グルコだよ🍀\n明日も一緒にやさしく見ていこうね🍀";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects leaked internal identifier atLeast", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\natLeast 1つの手がかりがあるよ。", "ja");
  assert.ok(issues.includes("internal_identifier"));
});

test("rejects another known internal identifier", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\npatternHintsを見たよ。", "ja");
  assert.ok(issues.includes("internal_identifier"));
});

test("rejects leaked dotted implementation keys", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nsummary.metrics.tir を確認したよ。", "ja");
  assert.ok(issues.includes("internal_dotted_key"));
});

test("allows public metric names such as GlucoScore", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nGlucoScoreにも振り返りの手がかりが見えているよ。", "ja");
  assert.deepEqual(issues, []);
});

test("allows other public mixed-case health terms", () => {
  const text = "グルコだよ🍀\neGFRやHbA1cのような公開用語を内部変数とは扱わないよ。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects empty output", () => {
  assert.deepEqual(getGeneratedLetterQualityIssues("   ", "ja"), ["empty_output"]);
});

test("rejects internal identifier in English output too", () => {
  const issues = getGeneratedLetterQualityIssues("Gluco is here 🍀\natLeast one clue is visible.", "en");
  assert.ok(issues.includes("internal_identifier"));
});
