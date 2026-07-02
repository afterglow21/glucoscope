# About Page Structure
# Aboutページ構成案

Status: FIXED  
Version: v0.2  
Last updated: 2026-07-02

---

## Purpose
## 目的

The About page should help first-time visitors understand what GlucoScope is, why it exists, and how it approaches blood glucose data with kindness and safety.

Aboutページは、初めてGlucoScopeを見た人が、GlucoScopeが何であり、なぜ作られていて、血糖データをどのようにやさしく安全に扱うのかを理解できる場所にする。

It should not be only a document link list.  
It should become a readable, reassuring entrance to GlucoScope.

単なるドキュメント一覧ではなく、GlucoScopeを安心して理解できる入口にする。

---

## Design Direction
## デザイン方針

- Keep the current About page design as the base.
- Add readable explanation sections above the document cards.
- Keep the Trust Pack document cards.
- Use both English and Japanese.
- On desktop, use English on the left and Japanese on the right where appropriate.
- On mobile, use a readable single-column layout.
- Use “First Message” instead of “Hero” because it feels gentler and more aligned with GlucoScope.

---

- 現在のAboutページのデザイン土台は活かす。
- ドキュメントカード一覧だけでなく、読める説明セクションを追加する。
- Trust Packとしてドキュメントカードは残す。
- 英語と日本語の両方に対応する。
- PCでは必要に応じて、左側を英語、右側を日本語にする。
- スマホでは読みやすい1カラム表示にする。
- 「Hero」ではなく、GlucoScopeらしくやさしい印象のある「First Message」を使う。

---

## Fixed Section Structure
## FIX済みセクション構成

1. First Message / 最初のメッセージ
2. What is GlucoScope? / GlucoScopeとは
3. Founder’s Note / つくり手の想い
4. Meet gluco / gluco（グルコ）について
5. What You Can See / できること
6. Safety & Medical Boundary / 安心して使うために
7. Data Integration / 血糖データとのつながり方
8. Current Status / 現在の開発状況
9. Trust Pack / ドキュメント一覧

---

## 1. First Message / 最初のメッセージ

This is the first message visitors see.

It should communicate the emotional core of GlucoScope:

- Understand today.
- Improve tomorrow.
- Built by one of us, for all of us.
- For people living with diabetes.
- A gentle blood glucose companion.

---

訪れた人が最初に見るメッセージ。

GlucoScopeの中心にある想いを伝える。

- Understand today.
- Improve tomorrow.
- 今日を理解して、明日を少しだけ良くする。
- 糖尿病とともに生きる一人が、同じように生きる人たちのために作っている。
- やさしい血糖みまもりパートナー。

---

## 2. What is GlucoScope? / GlucoScopeとは

Explain what GlucoScope is.

GlucoScope is not just a dashboard.  
It is a place to look back on blood glucose data without blame, and to turn numbers into small insights.

---

GlucoScopeが何であるかを説明する。

GlucoScopeは、ただのダッシュボードではない。  
血糖データを責めずに振り返り、数字を小さな気づきに変えるための場所。

---

## 3. Founder’s Note / つくり手の想い

Use Kazuma’s Instagram account icon in this section.

This section should explain why GlucoScope was created and show that it was built by someone living with diabetes.

It should feel personal, honest, and warm.

---

このセクションでは、KazumaのInstagramアカウントのアイコンを使う。

GlucoScopeがなぜ生まれたのか、糖尿病とともに生きる一人として作っていることを伝える。

個人的で、正直で、あたたかいセクションにする。

---

## 4. Meet gluco / gluco（グルコ）について

Use the gluco image in this section.

gluco is the official AI companion of GlucoScope.

gluco is not a doctor, judge, or strict coach.  
gluco is a gentle little friend who helps people reflect on blood glucose data without blame.

---

このセクションでは、glucoの画像を使う。

glucoは、GlucoScopeの公式AIパートナー。

医師でも、判定する存在でも、厳しいコーチでもない。  
血糖データを責めずに一緒に振り返る、やさしい小さなともだち。

---

## 5. What You Can See / できること

Explain what users can see in GlucoScope.

Examples:

- Live blood glucose flow
- GlucoScore
- Trends over time
- gluco comments
- Daily reflections

GlucoScore should remain as a name and numerical indicator, but avoid explicit score-like wording such as 「点」.

Example display:

```text
GlucoScore
78
↗ 昨日より +4・過去7日平均: 84
```

---

GlucoScopeで見られる内容を説明する。

例：

- 現在の血糖の流れ
- GlucoScore
- 過去の傾向
- glucoコメント
- 日々の振り返り

GlucoScoreという名称と数値指標は残す。  
ただし、「点」のような採点に見える表現は避ける。

表示例：

```text
GlucoScore
78
↗ 昨日より +4・過去7日平均: 84
```

---

## 6. Safety & Medical Boundary / 安心して使うために

Briefly explain the safety boundary.

GlucoScope is not a medical device.  
It does not diagnose, treat, or provide medical decisions.  
gluco comments are AI-generated reflections.

Link to:

- Medical & AI Principles
- SAFETY.md

---

安全上の境界を短く説明する。

GlucoScopeは医療機器ではない。  
診断、治療、医療判断を行うものではない。  
glucoのコメントは、血糖データを振り返るためのAIによる参考コメント。

リンク先：

- Medical & AI Principles
- SAFETY.md

---

## 7. Data Integration / 血糖データとのつながり方

Briefly explain the data connection approach.

GlucoScope currently starts with Nightscout-format data, but should not be limited to Nightscout forever.

Future data paths may include MiniMed, Dexcom, Libre, CSV, or manual input depending on feasibility, safety, and sustainability.

Link to:

- Data Integration Principles

---

血糖データとのつながり方を短く説明する。

GlucoScopeは、まずNightscout形式のデータから始める。  
ただし、Nightscoutだけに固定するものではない。

将来的には、MiniMed、Dexcom、Libre、CSV、手入力など、実現性・安全性・継続性を見ながら広げていく。

リンク先：

- Data Integration Principles

---

## 8. Current Status / 現在の開発状況

Explain that GlucoScope is still under development.

The first goal is to prepare a public demo page using Kazuma’s own blood glucose data in a safe, honest, and understandable way.

---

GlucoScopeが現在開発中であることを説明する。

最初の目標は、Kazuma自身の血糖データを使った公開サンプルページを、安全で、正直で、分かりやすい形に整えること。

---

## 9. Trust Pack / ドキュメント一覧

Keep the document card section.

Cards should include:

- Project Bible
- Founder’s Note
- Philosophy
- Mission / Vision / Values
- Brand Identity
- gluco Bible
- Data Integration Principles
- Medical & AI Principles
- SAFETY.md
- Roadmap
- Privacy Notes
- Support Policy

Some items may be marked as “planned” if not created yet.

---

ドキュメントカード一覧は残す。

カードに含めるもの：

- Project Bible
- Founder’s Note
- Philosophy
- Mission / Vision / Values
- Brand Identity
- gluco Bible
- Data Integration Principles
- Medical & AI Principles
- SAFETY.md
- Roadmap
- Privacy Notes
- Support Policy

未作成のものは「準備中」として扱ってよい。

---

## Notes for Implementation
## 実装メモ

- Do not rewrite the About page from scratch unless necessary.
- Use the current About page as the base.
- Add readable sections above the document cards.
- Use Kazuma’s Instagram icon for Founder’s Note.
- Use the gluco image for Meet gluco.
- Keep the visual tone calm, warm, and trustworthy.
- Avoid medical-device-like coldness.
- Avoid language that blames, scares, or judges people by their blood glucose data.

---

- 必要がない限り、Aboutページをゼロから作り直さない。
- 現在のAboutページを土台として使う。
- ドキュメントカード一覧の上に、読める説明セクションを追加する。
- Founder’s NoteではKazumaのInstagramアイコンを使う。
- Meet glucoではglucoの画像を使う。
- 見た目は、落ち着いていて、あたたかく、信頼できる雰囲気にする。
- 医療機器っぽく冷たい印象に寄せすぎない。
- 血糖データによって人を責めたり、怖がらせたり、評価したりする言葉を避ける。