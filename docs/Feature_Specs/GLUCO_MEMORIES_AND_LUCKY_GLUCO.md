# Gluco Memories & Lucky Gluco Spec

Status: Draft  
Related Bible section: `Live UI Follow-up: Gluco Memories & Lucky Gluco`

---

## 1. Purpose

Gluco Memories is a gentle collection feature for GlucoScope.

It lets the user gradually collect gluco illustrations as small memories of visiting GlucoScope.
The goal is to make returning to GlucoScope feel warm, friendly, and a little fun.

This feature must not turn blood glucose data into shame, grading, or competition.

---

## 2. Concept

### JP

グルコとの想い出は、
血糖データを責めずに振り返る時間の中で、
グルコとの小さな出逢いを積み重ねていく機能です。

ラッキーグルコは、
高いスコアへのご褒美ではなく、
その日にそっと届く「小さな幸運」として扱います。

### EN

Gluco Memories is a collection of small encounters with gluco.

Lucky Gluco is not a medical reward.
It is a small lucky moment that may gently appear during everyday reflection.

---

## 3. Image Groups

Initial grouping:

| Range | Type | JP label | EN label |
|---:|---|---|---|
| No. 01–50 | Normal | 通常グルコ | Normal Gluco |
| No. 51–70 | Lucky | 小さな幸運ラッキーグルコ | Lucky Gluco |

Lucky display copy:

```text
No. 58 Lucky Gluco!
🍀 小さな幸運ラッキーグルコと出逢ったよ
```

Detailed reasons should not be shown to the user.

---

## 4. Local Collection Titles

Suggested Japanese titles:

| Collected count | Title |
|---:|---|
| 0 | はじめの一歩 |
| 1+ | グルコのともだち |
| 10+ | グルコと仲良し（10枚達成！） |
| 30+ | グルコと親友（30枚達成！） |
| 50+ | グルコの心の友（50枚達成！） |
| 70+ | グルコの大切な人（70枚達成！） |

Sharing may be supported, but should be opt-in and should not include medical data by default.

---

## 5. Lucky Gluco Probability Policy

Lucky Gluco should be possible on ordinary days,
but should remain rare enough to feel special.

Initial recommended values:

| Condition | Suggested bonus |
|---|---:|
| Base chance | 3% |
| GlucoScore is high, e.g. 90+ | +8% |
| TIR is 70% or higher | +5% |
| Slightly improved compared with yesterday, e.g. +3 or more | +4% |
| Significantly improved compared with yesterday, e.g. +10 or more | +8% total for this improvement condition |
| Consecutive visits | +1% per day, max +7% |
| Collection count after 30 | gradual increase, max +12% |
| Returning after a while | +6% |
| Birthday, anniversary, or seasonal event | +10% |
| Same Normal Gluco appeared on the previous day | +8% |
| Normal Gluco has appeared for several days in a row | +2% per extra day, max +10% |

Recommended cap: 40%.

These values are internal and may be tuned after testing.
They should not be displayed as detailed rules in the UI.

---

## 6. Reset Rules

- Consecutive visit streak resets when the user misses a day.
- Same Normal Gluco bonus resets when Lucky Gluco appears.
- Normal-days-since-Lucky bonus resets when Lucky Gluco appears.
- Collection count does not reset.

---

## 7. Safety and Product Boundaries

Do not add special logic that rewards low GlucoScore.
This avoids creating incentives to intentionally aim for lower scores.

Do not describe Lucky Gluco as proof that the user did well medically.
Use gentle language such as:

- 小さな幸運
- 出逢った
- 今日はちょっと特別なグルコです

Avoid language such as:

- 合格
- ご褒美として与える
- 良い血糖だったから出ました
- 悪い日は出ません

---

## 8. Future Ideas

- Special celebration illustrations for titles
- Seasonal Lucky Gluco
- Birthday or anniversary Gluco
- Share card generation for SNS
- Optional global ranking only after privacy, consent, username, and opt-out design

Global ranking is not part of the initial local-only implementation.
