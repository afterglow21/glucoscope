# Gluco Letter Worker Prototype

This is the first Cloudflare Worker prototype for GlucoScope AI Letter.

It does **not** call OpenAI yet.  
It returns a fixed gentle gluco test letter from the summarized payload.

## Local dev

```bash
cd workers/gluco-letter-worker
npm install
npm run dev
```

Then open GlucoScope with:

```text
http://127.0.0.1:5500/index.html?debugAiWorker=1#live
```

The frontend will call:

```text
http://127.0.0.1:8787/api/gluco-letter
```

## Safety notes

- No OpenAI API key is used in this prototype.
- No raw Nightscout logs are expected.
- The request should contain summarized glucose data only.
- Turnstile, cache, usage counters, and budget guard are future phases.

## Response contract

The prototype now uses the draft response contract documented in:

```text
docs/Feature_Specs/GLUCO_AI_LETTER_WORKER_CONTRACT.md
```

Success responses return:

```json
{
  "ok": true,
  "version": "gluco-ai-letter-worker-response-v0.1",
  "status": "success",
  "letter": {
    "text": "..."
  },
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "estimatedCostJpy": 0
  },
  "guard": {
    "rateLimited": false,
    "budgetBlocked": false
  }
}
```

For local UI testing, the prototype can simulate future states by including `forceStatus` in the request body:

```json
{
  "forceStatus": "cached"
}
```

Supported prototype states:

- `success`
- `cached`
- `rate_limited`
- `budget_stopped`
- `ai_disabled`


## Usage guard prototype

This prototype now includes an in-memory usage guard.

It is **not durable** and is only for local verification before KV/D1 is added.

Local usage report:

```text
http://127.0.0.1:8787/api/gluco-letter/usage
```

Default prototype limits:

- AI enabled: true
- Daily new generation limit: 3
- Monthly budget target: 1,000 JPY
- Warning threshold: 800 JPY
- Stop threshold: 950 JPY
- Timezone offset: JST (+9)

Environment variables that can be set later in Cloudflare:

```text
AI_ENABLED=true
AI_DAILY_GENERATION_LIMIT=3
AI_MONTHLY_BUDGET_JPY=1000
AI_WARNING_BUDGET_JPY=800
AI_STOP_BUDGET_JPY=950
AI_TIMEZONE_OFFSET_HOURS=9
AI_INPUT_PRICE_JPY_PER_1M_TOKENS=32
AI_OUTPUT_PRICE_JPY_PER_1M_TOKENS=200
```

Debug examples for local testing:

```json
{
  "debug": {
    "forceStatus": "cached"
  }
}
```

```json
{
  "debug": {
    "mockDailyGenerationCount": 3
  }
}
```

```json
{
  "debug": {
    "mockMonthlyEstimatedCostJpy": 950
  }
}
```

Future production usage should replace the in-memory state with Cloudflare KV or D1.
