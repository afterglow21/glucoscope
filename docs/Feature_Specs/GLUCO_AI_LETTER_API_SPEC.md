# GLUCO_AI_LETTER_API_SPEC

Version: 0.1 Draft  
Status: Draft for discussion  
Related checkpoint: `1e9b1cf`

🍀 GlucoScope AI Letter API Specification

---

## 0. Purpose

This document defines the first safe design for GlucoScope's AI-powered "Letter from Gluco" feature.

The goal is to make AI analysis a visible and meaningful part of GlucoScope, while keeping the experience:

- gentle
- privacy-conscious
- medically safe
- cost-controlled
- sustainable for public demo use

This specification focuses first on Kazuma's public sample page.  
User rollout is intentionally separated because the AI usage rules, privacy model, and cost model are different.

---

## 1. Source of Truth

This feature must follow `PROJECT_BIBLE`.

Especially:

- GlucoScope is not a medical device.
- GlucoScope does not diagnose, treat, or make medical decisions.
- gluco is a gentle AI companion, not a doctor, judge, or strict coach.
- Blood glucose data must be treated as a clue for understanding, not as a score for blame.
- The language must avoid shame, pressure, panic, and unnecessary fear.
- Positive clues should be celebrated clearly instead of being weakened by backhanded wording.
- gluco may support reflection, but must never replace healthcare professionals.

---

## 2. Feature Summary

GlucoScope will show three layers of comments in the "Letter from Gluco" area.

### 2.1 Rule-based comment

Always available.

Purpose:

- provide a basic gentle reflection
- work without AI
- remain available when AI is disabled, blocked, or over budget

Characteristics:

- generated in the browser
- no external API call
- no cost
- safe fallback

### 2.2 AI analysis beta

Main premium-feeling experience.

Purpose:

- generate a more natural, warm, and specific letter from gluco
- display the result directly inside the GlucoScope screen

Characteristics:

- called through a server-side proxy, likely Cloudflare Worker
- uses OpenAI API or another provider behind the proxy
- API key is never exposed to GitHub Pages
- protected by rate limits, shared cache, Turnstile, and budget guard
- sends summarized data only, not raw glucose logs

### 2.3 ChatGPT copy handoff

Cost-free fallback and secondary route.

Purpose:

- allow users to copy an AI-ready summary and paste it into ChatGPT
- keep the AI experience available even when the built-in AI is unavailable
- reduce OpenAI API cost for GlucoScope

Characteristics:

- generates a prompt in the browser
- copies it to clipboard
- optionally opens ChatGPT or a future GlucoScope GPT page
- user sends the prompt manually

---

## 3. Page Types

GlucoScope must distinguish between two page modes.

---

## 3.1 Kazuma Public Sample Page

Purpose:

Show the value of GlucoScope using Kazuma's data.

Main goals:

- make visitors understand the product quickly
- let visitors experience gluco's AI analysis
- keep API cost predictable
- avoid exposing unlimited AI generation

Recommended rules:

- AI button is visible to visitors
- visitors can experience AI analysis
- public demo uses shared cache whenever possible
- new AI generation is limited by time slot and global daily/monthly caps
- Turnstile validation is required before new generation
- if AI is unavailable, show cached AI letter, rule-based comment, and ChatGPT copy handoff

The public sample page should not require visitors to create an account.

---

## 3.2 User Rollout Page

Purpose:

Allow users to connect their own Nightscout data.

This requires a separate specification.

Important differences:

- user uses their own Nightscout URL
- AI use must require clear consent
- privacy explanation must be stronger
- per-user limits must be designed
- future BYOK/self-host options may be considered
- billing/support policy must be decided before wide rollout

Initial development should focus on the Kazuma public sample page, but this distinction must remain documented.

---

## 4. AI Generation Slots

For the public demo, the first AI analysis design should use three daily slots.

### 4.1 Slots

- Morning
- Afternoon
- Night

The exact time ranges can be decided later.

Example draft:

- Morning: 00:00-11:59
- Afternoon: 12:00-17:59
- Night: 18:00-23:59

### 4.2 Why slots matter

Today is live data.

A "today" analysis at 12:00 and a "today" analysis at 22:00 are not the same because the data snapshot has changed.

Therefore, cache should not be based only on `period = today`.

The correct concept is:

```text
analysis snapshot
```

An analysis snapshot may include:

- page mode
- period
- date
- slot
- latest glucose timestamp
- summary hash

---

## 4.3 Positive Recognition and Unicorn Moment

The AI letter may include explicit positive recognition when supported by the summarized data.

Initial writing thresholds:

- TIR >= 75%: clear positive recognition
- TIR >= 90%: strong recognition
- TIR = 100%: enthusiastic celebration
- CV < 30%: calm and steady flow
- CV < 24%: especially small variation
- Today's latest reading = 100mg/dL: `🦄 ユニコーンをつかまえた！`

These are copy and experience rules, not medical grades or treatment targets.
The letter praises the observed flow, not the person's worth or assumed effort.
Positive recognition must not hide notable lower or higher periods.

The frontend may send optional `celebrationHints` separately from other `patternHints`.
The Worker also derives these clues from the summarized metrics so the safety and tone rules do not depend only on frontend wording.

---

## 5. Caching Policy

### 5.1 Public demo shared cache

For Kazuma's public sample page, AI results are shared across visitors through Cloudflare Workers KV.

Example:

```text
demo / today / 2026-07-06 / morning
demo / today / 2026-07-06 / afternoon
demo / today / 2026-07-06 / night
```

If the morning AI letter already exists and is less than one hour old, visitors receive the cached letter instead of causing a new OpenAI API call.

The production cache identity includes:

- page mode
- language
- period
- morning / afternoon / night slot
- analysis mode
- displayed range key

The identity is SHA-256 hashed before it is used as a KV key. Raw glucose values are not included in the key.

KV stores only:

- generated letter text
- language and analysis mode
- original generation time
- provider/model identifiers
- slot identifier

The glucose summary is not stored in the shared cache. The entry is fresh for one hour, may be used as a stale fallback for up to 24 hours, and is then removed automatically.

### 5.2 Cache display is not the same as new generation

Cache display should be allowed more freely.

New generation should be limited.

Suggested wording:

```text
前回のグルコのお手紙を表示しています🍀
```

### 5.3 One-hour two-layer cache refresh window

The public page uses a browser-local cache first and a shared Workers KV cache when the browser has no fresh local entry.

For the same:

- page mode
- period
- morning / afternoon / night slot
- analysis mode
- displayed range

a saved AI letter that is less than one hour old should be shown without sending a new request to OpenAI.

After one hour, the button allows a new AI generation when the daily, slot, and budget guards still allow it. The older saved letter remains available locally and in KV as a fallback if the new request fails or the limit has been reached.

Suggested button states:

```text
No cache: AI分析を試す
Cache under one hour: 保存済みの分析を表示
Cache one hour or older: もう一度AI分析
```

### 5.4 Past periods

For past periods, cache can be more stable.

Examples:

- yesterday
- 7 days
- 30 days
- past custom range

Cache key should include:

- period type
- start date/time
- end date/time
- summary hash

---

## 6. Rate Limits

### 6.1 Public demo draft limits

Suggested first draft:

- shared cache first
- new AI generation: max 3 slots/day
- public demo global daily cap: small fixed number
- public demo monthly budget guard: enabled
- one browser/IP should not be able to force repeated new generation

Exact values should be set conservatively during beta.

### 6.2 User rollout draft limits

Not finalized.

Possible future options:

- free daily AI quota
- account-based quota
- support plan quota
- BYOK/self-host advanced mode

---

## 7. Turnstile

New AI generation should be protected with Cloudflare Turnstile.

Important:

- Turnstile token must be verified server-side
- client-side widget alone is not enough
- failed verification should block new AI generation
- cached letters and rule-based comments can still be displayed

Friendly failure message:

```text
AI分析の確認がうまくいきませんでした。
少し時間をおいて、もう一度試してみてください🍀
```

---

## 8. AI Proxy

The browser must not call OpenAI API directly.

Expected structure:

```text
GitHub Pages
  -> Cloudflare Worker
  -> OpenAI API
  -> Cloudflare Worker
  -> GlucoScope screen
```

The API key must be stored as a server-side secret.

Never store provider API keys in:

- GitHub Pages JavaScript
- public repository files
- localStorage
- query parameters

---

## 9. Data Sent to AI

### 9.1 Send summarized data only

The first AI version should send summarized data only.

Allowed fields may include:

- language
- page mode
- period type
- date range label
- current glucose
- glucose trend arrow
- delta from previous reading
- TIR
- TAR
- TBR
- average glucose
- CV
- GMI estimate
- GlucoScore
- difference from previous period
- notable high time ranges
- notable low time ranges
- stable time ranges
- short pattern hints

### 9.2 Do not send

Do not send:

- Nightscout URL
- API secret
- user name
- raw 5-minute glucose log
- detailed insulin history
- detailed device identifiers
- location
- unnecessary personal notes
- anything not needed for the letter

### 9.3 Data minimization

The AI prompt should be short and structured.

Goal:

- lower cost
- reduce privacy exposure
- reduce chance of unsafe output

---

## 10. AI Output Rules

gluco may:

- gently describe the visible blood glucose flow
- mention higher/lower/stable periods
- compare with yesterday or recent periods
- mention TIR/TAR/TBR, average, CV, and GlucoScore as reflection clues
- encourage gentle review
- suggest consulting healthcare professionals when needed

gluco must not:

- diagnose
- decide treatment
- tell insulin dose
- suggest medication changes
- suggest pump/device setting changes
- shame the user
- say "bad", "failure", or similar blame-oriented wording
- create panic
- imply that AI replaces healthcare professionals

---

## 11. Prompt Design

The server-side prompt should include a fixed safety system instruction.

Draft direction:

```text
You are gluco, the official AI companion of GlucoScope.
You help people living with diabetes gently reflect on blood glucose data.
You do not diagnose, treat, make medical decisions, or advise insulin doses.
You do not shame or blame.
Write a short, warm letter using simple language.
Use the provided summary only.
```

The model should be instructed to return short output.

Recommended output length:

- Japanese: 3-6 short sentences
- English: 3-6 short sentences

---

## 12. Cost Guard

The AI feature must have cost controls before public release.

Required controls:

- monthly estimated cost counter
- input token counter
- output token counter
- AI generation count
- cache hit count
- budget warning threshold
- budget stop threshold
- emergency kill switch

Draft thresholds:

- warning threshold: before the monthly target is reached
- stop threshold: near the monthly target
- monthly target: initially around 1,000 JPY or lower

Exact thresholds must be decided before implementation and verified against current provider pricing.

---

## 13. Usage Metrics

Track at least:

- today's AI generation count
- today's cache hit count
- today's Turnstile failure count
- this month's AI generation count
- this month's input tokens
- this month's output tokens
- this month's estimated cost
- budget blocked count
- AI enabled/disabled state

These metrics should not contain personal health data.

---

## 14. Daily AI Usage Report

Kazuma should be able to check AI usage daily.

Report contents:

```text
GlucoScope AI Daily Report 🍀

Today:
- AI new generations
- Cache hits
- Turnstile failures
- Budget blocks

This month:
- AI generation count
- Input tokens
- Output tokens
- Estimated cost
- Monthly budget usage rate

Status:
- AI generation ON/OFF
- Budget guard status
```

Possible delivery methods:

1. Email report
2. Admin endpoint
3. Webex/Slack notification
4. GitHub issue/comment later if useful

Initial implementation can start with an admin endpoint, then add email.

---

## 15. Budget Guard UX

When AI generation is stopped by budget guard, the UI should remain gentle.

Example:

```text
今月のAI分析は、利用上限に近づいたため、
新しいお手紙を少しお休みしています。

前回のお手紙や、ChatGPTコピー機能は使えます🍀
```

The rule-based comment must remain visible.

---

## 16. ChatGPT Copy Handoff

The ChatGPT handoff button should remain available even if built-in AI is disabled.

Button examples:

```text
ChatGPTにコピーして分析
ChatGPTでグルコのお手紙を作る
```

Behavior:

- generate AI-ready prompt in browser
- copy to clipboard
- show a gentle success message
- optionally open ChatGPT / future official GPT page

The prompt should include:

- summarized glucose data
- gluco tone instruction
- safety boundaries
- request for short letter

---

## 17. Advanced Options for the Future

These are not first-phase requirements.

### 17.1 BYOK

Bring Your Own Key may be considered for advanced users, but should not be the main path.

Risks:

- high friction
- privacy/security concerns
- API key handling risk in browser

Safer advanced direction:

- user self-hosts their own proxy
- GlucoScope stores only the proxy URL

### 17.2 Provider fallback

Possible future fallback providers:

- Gemini
- other low-cost or free-tier models
- local AI models

This should not block first implementation.

### 17.3 WebLLM / local AI

Interesting for privacy-first future mode, but not recommended for initial public demo because of:

- model download size
- device performance differences
- mobile experience concerns
- complexity

---

## 18. Production CORS Boundary

The production Worker does not use wildcard CORS. Browser access is restricted to explicitly configured origins.

Current production configuration:

```text
CORS_ALLOWED_ORIGINS=https://afterglow21.github.io
CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN=true
```

Rules:

- Compare the browser `Origin` by exact scheme, host, and port.
- Do not include a path such as `/glucoscope/` in an allowed Origin.
- Echo the exact approved Origin in `Access-Control-Allow-Origin`.
- Add `Vary: Origin` to API responses.
- Accept preflight methods only for `GET` and `POST`, with `Content-Type` as the allowed request header.
- Return `403` for unapproved browser origins.
- Permit requests without an `Origin` header for operational tools and direct server-side checks.
- Configure local-only origins through ignored development variables, not the production allowlist.

CORS does not authenticate a caller and does not replace Turnstile, secrets, generation limits, or budget controls.

---

## 19. Implementation Phases

### Phase 0: Specification

- Write this spec
- Review with PROJECT_BIBLE
- Decide public demo first
- Decide exact budget thresholds later

### Phase 1: UI preparation

- Keep rule-based comment visible
- Add AI analysis beta area
- Add ChatGPT copy handoff button
- Add gentle loading/error states
- Do not call OpenAI yet

### Phase 2: Worker prototype

- Create Cloudflare Worker endpoint
- Add OpenAI API secret
- Add fixed test prompt
- Return sample AI letter
- Confirm exact-origin CORS and basic security

### Phase 3: Summary payload

- Generate summary JSON in GlucoScope
- Send summary only
- Do not send raw glucose logs
- Add summary hash

### Phase 4: Safety and cost controls

- Add Turnstile validation
- Add shared cache (implemented with Workers KV and verified across devices)
- Add usage counters
- Add monthly budget guard
- Add emergency kill switch

### Phase 5: Public demo beta

- Enable for Kazuma public sample page
- Shared morning/afternoon/night cache
- Monitor daily usage
- Keep ChatGPT handoff and rule-based fallback

### Phase 6: User rollout design

- Write separate user rollout spec
- Define consent, limits, privacy, and support model
- Decide whether official AI, BYOK, or self-host options are offered

---

## 20. Open Questions

- Exact morning/afternoon/night time ranges
- Which AI provider/model to use first
- Exact monthly budget threshold
- How to identify public demo mode
- Whether to start with admin endpoint or email report
- Whether custom ranges should support AI in the first version
- Whether AI analysis should be available to all visitors or only public demo visitors at first

---

## 21. Decision Summary

Current direction:

```text
AI analysis is an important selling point of GlucoScope.
Start with Kazuma's public sample page.
Show AI analysis inside the screen.
Use Cloudflare Worker as the AI proxy.
Use summarized data only.
Protect new generation with Turnstile and rate limits.
Use shared cache for public demo.
Keep rule-based comment always visible.
Keep ChatGPT copy handoff as fallback.
Track daily/monthly usage.
Keep monthly AI API cost around a small controlled budget.
Design user rollout separately.
```
