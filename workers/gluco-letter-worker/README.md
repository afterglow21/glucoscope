# Gluco Letter Worker

Cloudflare Worker for GlucoScope AI Letter.

Production flow:

```text
GitHub Pages
  → Cloudflare Turnstile verification
  → Cloudflare Worker
  → OpenAI Responses API
  → gentle AI letter response
```

## Current production behavior

- `AI_PROVIDER=openai`
- OpenAI API key is stored as a Cloudflare secret.
- Turnstile verification is required.
- Daily, mode/slot, and monthly budget guards are enabled.
- Usage counters are persisted in a singleton SQLite-backed Durable Object.
- The usage counter stores operational totals only. It does not store glucose values or AI letter text.
- AI letter cache is still browser-local. A shared Workers KV cache is a separate future step.

## Local development

```bash
cd workers/gluco-letter-worker
npm install
npm run dev
```

Local endpoint:

```text
http://127.0.0.1:8787/api/gluco-letter
```

Usage report:

```text
http://127.0.0.1:8787/api/gluco-letter/usage
```

## Secrets

Do not put secrets in GitHub, frontend JavaScript, URLs, or committed configuration files.

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

## Durable Object usage counter

`wrangler.toml` binds a singleton Durable Object:

```toml
[[durable_objects.bindings]]
name = "USAGE_COUNTER"
class_name = "GlucoUsageCounter"

[[migrations]]
tag = "v1"
new_sqlite_classes = [ "GlucoUsageCounter" ]
```

The first deployment after adding this configuration creates the SQLite-backed Durable Object namespace:

```bash
npx wrangler deploy
```

After deployment, confirm:

```text
https://gluco-letter-worker.afterglow21.workers.dev/api/gluco-letter/usage
```

Expected storage value:

```json
{
  "kind": "durable-object-sqlite"
}
```

## Production variables

Non-secret values are defined in `wrangler.toml`:

```text
AI_PROVIDER=openai
AI_ENABLED=true
OPENAI_MODEL=gpt-5.4-nano
OPENAI_MAX_OUTPUT_TOKENS=500
AI_MONTHLY_BUDGET_JPY=100
AI_WARNING_BUDGET_JPY=50
AI_STOP_BUDGET_JPY=80
AI_DAILY_GENERATION_LIMIT=6
AI_SLOT_GENERATION_LIMIT=1
TURNSTILE_REQUIRED=true
```

The estimated AI cost shown by the Worker is an operational estimate paid by the developer. It is not a charge to visitors.

## Response contract

See:

```text
docs/Feature_Specs/GLUCO_AI_LETTER_WORKER_CONTRACT.md
```

The Worker returns:

- letter text and mode
- request and monthly token usage
- estimated developer cost
- daily and slot guard state
- Turnstile status
- storage kind

## Safety boundary

- No diagnosis.
- No treatment decisions.
- No insulin-dose recommendations.
- No device-setting instructions.
- No raw Nightscout logs are expected.
- Only a summarized glucose reflection payload should be sent.
- AI output is a supportive reflection, not medical advice or a final conclusion.
