import test from "node:test";
import assert from "node:assert/strict";

import { getGeneratedLetterQualityIssues } from "../src/letter-quality.js";

test("accepts Gluco-style Japanese wording", () => {
  const text = "グルコだよ🍀\nTIRは82％で、落ち着いた時間がしっかり見えているよ。\n明日も流れをやさしく見てみよう。";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "ja"), []);
});

test("rejects polite Japanese sentence endings", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nTIRは82％です。", "ja");
  assert.ok(issues.includes("japanese_polite_ending"));
});

test("rejects internal lower camel case tokens", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\natLeast 1つの手がかりがあるよ。", "ja");
  assert.ok(issues.includes("internal_camel_case"));
});

test("allows public metric names such as GlucoScore", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\nGlucoScoreにも振り返りの手がかりが見えているよ。", "ja");
  assert.deepEqual(issues, []);
});

test("rejects Markdown heading artifacts", () => {
  const issues = getGeneratedLetterQualityIssues("グルコだよ🍀\n## 全体の流れ\n落ち着いた時間が見えているよ。", "ja");
  assert.ok(issues.includes("markdown_heading"));
});

test("does not apply Japanese voice checks to ordinary English output", () => {
  const text = "Gluco is here 🍀\nThis is a gentle reflection.";
  assert.deepEqual(getGeneratedLetterQualityIssues(text, "en"), []);
});

test("rejects internal lower camel case tokens in English output too", () => {
  const issues = getGeneratedLetterQualityIssues("Gluco is here 🍀\natLeast one clue is visible.", "en");
  assert.ok(issues.includes("internal_camel_case"));
});
