# Gluco Letter Worker Prototype

This is the first Cloudflare Worker prototype for GlucoScope AI Letter.

By default, it still does **not** call OpenAI.  
It returns a fixed gentle gluco test letter from the summarized payload.

OpenAI connection is available only when explicitly enabled with Worker environment settings.

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
- Slot generation limit: 1 per morning / afternoon / night letter
- Monthly budget target: 1,000 JPY
- Warning threshold: 800 JPY
- Stop threshold: 950 JPY
- Timezone offset: JST (+9)

Environment variables that can be set later in Cloudflare:

```text
AI_ENABLED=true
AI_DAILY_GENERATION_LIMIT=3
AI_SLOT_GENERATION_LIMIT=1
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


## Slot-based guard

The public demo target is:

```text
morning: 1 new letter
afternoon: 1 new letter
night: 1 new letter
total: 3 new letters per day
```

This keeps the wording flexible while still protecting cost.

For a future user page, the same structure can be expanded by changing:

```text
AI_SLOT_GENERATION_LIMIT=3
AI_DAILY_GENERATION_LIMIT=9
```

The frontend sends the active slot in `summary.slot`, and the Worker counts new generations by slot.

Current prototype slots:

- `morning`
- `afternoon`
- `night`

`cached` responses do not count as new generations.


## OpenAI connection scaffold

The Worker can now call OpenAI only when this is explicitly enabled:

```text
AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.4-nano
OPENAI_MAX_OUTPUT_TOKENS=700
OPENAI_API_KEY=<Cloudflare secret>
```

Default mode remains:

```text
AI_PROVIDER=prototype
```

So local demo testing stays safe and does not create OpenAI API usage unless the provider is changed.

### Production secret

Set the API key as a Cloudflare secret. Do not put it in GitHub, frontend JavaScript, localStorage, or committed config files.

```bash
cd workers/gluco-letter-worker
npx wrangler secret put OPENAI_API_KEY
```

Then set non-secret environment variables in Cloudflare settings or `wrangler.toml` later:

```text
AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.4-nano
OPENAI_MAX_OUTPUT_TOKENS=700
```

### Provider behavior

- `AI_PROVIDER=prototype`: fixed local gluco test letter
- `AI_PROVIDER=openai`: calls OpenAI Responses API from the Worker
- `cached`: does not call OpenAI and does not count as a new generation

### Safety boundaries in the prompt

The OpenAI prompt tells gluco to:

- write a short, gentle letter
- use summarized data only
- avoid diagnosis or treatment decisions
- avoid insulin dose, medication, pump setting, or device setting advice
- avoid blame, fear, judgment, or pressure

The frontend still sends summarized data only.


## Turnstile verification scaffold

Local development stays OFF by default:

```text
TURNSTILE_REQUIRED=false
```

Production can require Cloudflare Turnstile before OpenAI generation:

```text
TURNSTILE_REQUIRED=true
TURNSTILE_SECRET_KEY=<Cloudflare secret>
```

The frontend sends `turnstileToken` when a Turnstile widget is added.  
The Worker verifies that token with Cloudflare Siteverify before cache, usage guard, or OpenAI generation.

OpenAI must not be called when verification fails.


### Frontend site key

The public Turnstile site key is currently embedded in `js/app.js`:

```text
TURNSTILE_SITE_KEY=0x4AAAAAADyftbRcWQW23mEa
```

This value is safe to expose in browser JavaScript.

The secret key must stay in the Worker environment only.


## AI analysis modes

The Worker accepts two public demo modes:

```json
{
  "analysisMode": "letter"
}
```

```json
{
  "analysisMode": "deep"
}
```

Mode meaning:

- `letter`: gentle short letter from gluco
- `deep`: structured, more detailed reflection

For the public demo, the intended guard is:

```text
3 slots × 2 modes = up to 6 new generations per day
```

Set local development to match that behavior:

```text
AI_DAILY_GENERATION_LIMIT="6"
AI_SLOT_GENERATION_LIMIT="1"
```

The slot limit is applied per slot and per mode, so the evening gentle letter and the evening detailed reflection each have their own first-generation allowance.
