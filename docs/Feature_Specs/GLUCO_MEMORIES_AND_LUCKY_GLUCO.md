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

## 8. Special Encounter: Unicorn Gluco

Unicorn Gluco is implemented as a local-only special encounter.

Trigger rules:

- Evaluate the latest Nightscout entry on the first successful response and whenever a different latest measurement arrives while the page remains open.
- Use only the current latest Nightscout entry; never scan today's history or another period.
- The entry must be fresh under the LIVE rule (`< 30 minutes`).
- The value must be exactly `100 mg/dL`.
- A page opened at another value may still unlock an encounter when a new latest measurement later becomes exactly 100mg/dL.
- Do not evaluate the same measurement repeatedly, including across the minute refresh loop.
- At most one illustration is selected per local calendar day.

Display and storage:

- Select an uncollected illustration first; after all ten are collected, select from the full set.
- Keep the selected illustration fixed for the rest of that local day.
- Replace the large Letter-tab Gluco illustration for the rest of that day; do not regenerate an AI letter.
- Replace the glucose-tab peek illustration only while the current fresh latest reading is exactly 100mg/dL; return to the normal peek immediately after the value changes.
- Save the encounter and first-seen date in `localStorage`.
- Show a separate 10-item Unicorn Gluco collection inside Gluco Memories.

Wording:

```text
🦄 ユニコーンをつかまえた！
最新の測定はぴったり100mg/dL。
小さな幸運に出会えたね🍀
```

Design boundaries:

- This is a playful community-inspired moment, not a medical reward.
- It does not prove good or bad glucose management.
- It must not pressure people to chase 100mg/dL.
- Do not add rankings, streak pressure, or optimization mechanics around it.
- Do not sync this health-related encounter across devices until account, consent, and privacy design are reviewed.

---

## 9. Collection Page Discoverability

The Memories page must clearly explain that it is a collection experience.

Minimum presentation:

- A short introduction above the grid explaining that Gluco expressions are gradually collected.
- A visible collected-count indicator.
- Friendly guidance on locked items so they are understood as encounters not yet found.
- A clear distinction between everyday Gluco, Lucky Gluco, and special encounters.
- A collapsible explanation of how Unicorn Gluco can be encountered.
- A visible same-day notice when a newly collected illustration has been added.

Safety wording must remain visible:

- The collection is not a judgment of good or bad glucose.
- Lucky or Unicorn Gluco is not a medical reward.
- The feature should feel like a small companion experience, not a target, ranking, or pressure mechanic.

---

## 10. Future Ideas

- Special celebration illustrations for titles
- Seasonal Lucky Gluco
- Birthday or anniversary Gluco
- Share card generation for SNS
- Optional global ranking only after privacy, consent, username, and opt-out design

Global ranking is not part of the initial local-only implementation.
