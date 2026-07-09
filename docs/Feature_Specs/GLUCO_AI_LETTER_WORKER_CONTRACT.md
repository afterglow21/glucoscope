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
