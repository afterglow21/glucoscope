import test from "node:test";
import assert from "node:assert/strict";

import { getGeneratedLetterQualityIssues } from "../src/letter-quality.js";

test("accepts Gluco-style Japanese wording", () => {
  const text = "グルコだよ🍀\nTIRは82％で、落ち着いた時間がしっかり見えているよ。\n明日も流れをやさしく見てみよう。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
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

test("rejects leaked internal lower camel case tokens", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\natLeast 1つの手がかりがあるよ。", "ja");
  assert.ok(issues.includes("internal_camel_case"));
});

test("rejects leaked dotted implementation keys", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nsummary.metrics.tir を確認したよ。", "ja");
  assert.ok(issues.includes("internal_dotted_key"));
});

test("allows public metric names such as GlucoScore", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nGlucoScoreにも振り返りの手がかりが見えているよ。", "ja");
  assert.deepEqual(issues, []);
});

test("rejects empty output", () => {
  assert.deepEqual(getGeneratedLetterQualityIssues("   ", "ja"), ["empty_output"]);
});

test("does not apply Japanese style rejection to ordinary English output", () => {
  const text = "Gluco is here 🍀\nThis is a gentle reflection.";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "en"), []);
});

test("rejects internal lower camel case tokens in English output too", () => {
  const issues = getGeneratedLetterQualityIssues("Gluco is here 🍀\natLeast one clue is visible.", "en");
  assert.ok(issues.includes("internal_camel_case"));
});
