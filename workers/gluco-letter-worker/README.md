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
