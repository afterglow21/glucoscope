# GLUCO_AI_LETTER_WORKER_CONTRACT

Version: 0.1 Draft  
Status: Prototype contract  
Related feature spec: `docs/Feature_Specs/GLUCO_AI_LETTER_API_SPEC.md`

🍀 GlucoScope AI Letter Worker Response Contract

---

## 1. Purpose

This document defines the first response contract between the GlucoScope frontend and the AI Letter Worker.

The contract is intentionally stable before connecting OpenAI API, Turnstile, cache, or budget guard.

The goal is to make the frontend ready for:

- successful AI letters
- cached letters
- daily rate limits
- monthly budget stop
- temporary AI disable
- gentle error display
- usage and cost logging later

---

## 2. Endpoint

```text
POST /api/gluco-letter
```

The frontend must call the Worker, not OpenAI directly.

---

## 3. Request Body

Draft shape:

```json
{
  "summary": {
    "version": "gluco-ai-letter-summary-v0.1",
    "pageMode": "kazuma-public-demo",
    "language": "ja",
    "period": "today",
    "slot": "afternoon",
    "slotLabel": "昼のお手紙",
    "rangeLabel": "2026/07/09 00:00 〜 2026/07/09 23:59",
    "latestMeasuredAt": "2026/07/09 14:52",
    "currentGlucose": 170,
    "direction": "→",
    "delta": "-5",
    "metrics": {
      "tir": "95.7",
      "tar": "2.0",
      "tbr": "2.3",
      "averageGlucose": "125",
      "cv": "26.1",
      "gmi": "6.1",
      "glucoScore": 98,
      "previousScore": 88,
      "sevenDayAverageScore": 89
    },
    "patternHints": [
      "TIRは95.7%で、落ち着いている時間もちゃんと見えているよ。"
    ]
  },
  "client": {
    "app": "GlucoScope",
    "mode": "worker-prototype"
  }
}
```

Future fields may include:

- `turnstileToken`
- `summaryHash`
- `cacheKey`
- `clientId`
- `pageMode`

---

## 4. Success Response

```json
{
  "ok": true,
  "version": "gluco-ai-letter-worker-response-v0.1",
  "status": "success",
  "source": "prototype-worker",
  "clientMode": "worker-prototype",
  "letter": {
    "text": "グルコだよ🍀\n...",
    "language": "ja",
    "generatedAt": "2026-07-09T05:52:00.000Z",
    "provider": "none",
    "model": "prototype-fixed-letter",
    "cached": false,
    "cacheKey": null,
    "slot": {
      "key": "afternoon",
      "label": "昼のお手紙"
    }
  },
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "estimatedCostJpy": 0
  },
  "guard": {
    "turnstileRequired": false,
    "turnstileVerified": false,
    "rateLimited": false,
    "budgetBlocked": false,
    "aiEnabled": true
  }
}
```

---

## 5. Status Values

### `success`

A new AI letter was generated.

Prototype:

- fixed letter
- no AI provider
- no cost

Future:

- OpenAI-generated letter
- usage recorded
- cache may be saved

### `cached`

A cached AI letter is returned.

Frontend should show a gentle success message such as:

```text
前回のグルコAIお手紙を表示しました🍀
```

### `error`

An error occurred.

Frontend should not break the page.

The rule-based comment and ChatGPT copy handoff must remain available.

---

## 6. Error Response

```json
{
  "ok": false,
  "version": "gluco-ai-letter-worker-response-v0.1",
  "status": "error",
  "code": "rate_limited",
  "message": "Daily AI generation limit reached.",
  "userMessage": "今日のAI分析は上限に近づいています。前回のお手紙やChatGPTコピー機能は使えます🍀",
  "retryable": false,
  "details": null
}
```

---

## 7. Error Codes

### `not_found`

Endpoint path is wrong.

### `method_not_allowed`

HTTP method is not POST.

### `invalid_json`

Request body could not be parsed.

### `missing_summary`

Request body does not contain a valid `summary`.

### `rate_limited`

Daily or per-client generation limit reached.

### `budget_stopped`

Monthly budget guard has stopped new AI generation.

### `ai_disabled`

AI generation is temporarily disabled by the operator.

### `turnstile_failed`

Future state. Turnstile validation failed.

### `provider_error`

Future state. AI provider request failed.

---

## 8. Frontend Rules

The frontend should:

- accept both prototype and future contract fields
- read `letter.text` as the primary AI letter
- keep compatibility with older `letter: string` shape during development
- show cached status gently
- show budget/rate-limit status gently
- keep rule-based comment visible
- keep ChatGPT copy handoff available
- never expose provider API keys

---

## 9. Prototype Simulation

During local development, the Worker may accept:

```json
{
  "forceStatus": "cached"
}
```

Supported values:

- `cached`
- `rate_limited`
- `budget_stopped`
- `ai_disabled`

This is only for prototype testing.

---

## 10. Safety Notes

The Worker must not ask the model to make medical decisions.

The Worker must not return advice about:

- insulin dose
- medication changes
- pump/device setting changes
- diagnosis
- treatment decisions

If the AI provider is added later, the safety prompt must follow PROJECT_BIBLE and the AI Letter API spec.

---

## 11. Future Additions

Later versions may add:

- Turnstile validation result
- cache keys
- per-day slot counters
- monthly usage counters
- estimated cost calculation
- provider/model metadata
- admin usage report endpoint
- emergency kill switch state


---

## 11. Usage Guard Prototype

The Worker prototype includes an in-memory usage guard before OpenAI connection.

This is intentionally temporary.

Current prototype behavior:

- counts daily new generations
- counts monthly new generations
- counts cache hits
- estimates input tokens from the summary payload
- estimates output tokens from the returned letter
- estimates cost in JPY
- stops new generation when daily or monthly guard is reached
- exposes a local usage report endpoint

### Usage endpoint

```text
GET /api/gluco-letter/usage
```

Prototype response:

```json
{
  "ok": true,
  "version": "gluco-ai-letter-worker-response-v0.1",
  "status": "usage",
  "report": {
    "today": {
      "aiGenerationCount": 1,
      "cacheHitCount": 0,
      "rateLimitedCount": 0
    },
    "month": {
      "aiGenerationCount": 1,
      "inputTokens": 870,
      "outputTokens": 150,
      "estimatedCostJpy": 0.0578,
      "monthlyBudgetJpy": 1000,
      "budgetUsageRate": 0.01
    }
  }
}
```

### Important limitation

The prototype uses in-memory state only.

It is useful for local testing, but it is not persistent and must be replaced by Cloudflare KV or D1 before public release.

### Future production storage

Production should store counters such as:

- day key
- month key
- generation count
- cache hit count
- input tokens
- output tokens
- estimated cost
- budget blocked count
- Turnstile failure count

No personal health data should be stored in usage counters.


---

## 12. Slot-based Generation Guard

The Worker should treat AI letters as time-based letters rather than a single undifferentiated daily counter.

Public demo target:

```text
morning: 1 new letter
afternoon: 1 new letter
night: 1 new letter
total: 3 new letters per day
```

Future user page target:

```text
morning: up to 3 new letters
afternoon: up to 3 new letters
night: up to 3 new letters
total: up to 9 new letters per day
```

The frontend sends:

```json
{
  "summary": {
    "slot": "afternoon",
    "slotLabel": "昼のお手紙"
  }
}
```

The Worker tracks:

```json
{
  "dailySlotGenerationCounts": {
    "morning": 1,
    "afternoon": 1,
    "night": 0,
    "unknown": 0
  }
}
```

If a slot reaches its limit, the Worker returns:

```json
{
  "ok": false,
  "status": "error",
  "code": "rate_limited",
  "userMessage": "今日の新しい昼のお手紙は上限に達しました。表示中のお手紙はそのまま読めます。ChatGPTコピー機能も使えます🍀",
  "details": {
    "reason": "slot"
  }
}
```

The frontend should prefer `userMessage` when present, because it can include the active slot label.

The visible letter should not disappear when a guard error is returned.
