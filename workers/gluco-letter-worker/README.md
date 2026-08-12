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

Production checkpoint — 2026-08-13:

- deployment `aebf4032-1d00-4946-9d3c-773a2e0bf7d3` routes 100% to Version `1f4d0c91-808c-4600-8d63-e9207d06b7e0`
- Version `1b8a67ca-dc1b-4655-9f09-83e24a249f7b` remains the immediate rollback target
- the release changes only the letter voice, output-quality boundary, and cache schema; Secrets, bindings, migrations, CORS, limits, and storage retention are unchanged
- the public usage endpoint returned `200` and the approved-origin AI preflight returned `204` after deployment

- `AI_PROVIDER=openai`
- OpenAI API key is stored as a Cloudflare secret.
- Turnstile verification is required.
- Daily, time-slot, and monthly budget guards are enabled.
- Usage counters are persisted in a singleton SQLite-backed Durable Object.
- The usage counter stores operational totals only. It does not store glucose values or AI letter text.
- AI letters use a two-layer cache: browser-local cache plus a shared Cloudflare Workers KV cache.
- The browser-local cache uses `glucoscope.aiLetterLocalCache.v12` and keeps at most 30 generated letters. The frontend removes the retired v11 local cache when reading the cache and when a saved connection is deleted.
- The shared key is an opaque SHA-256 hash of page mode, language, period, time slot, analysis mode, and displayed range. Raw glucose values are not part of the key.
- A shared letter younger than one hour is returned without a new OpenAI call or generation-count consumption.
- The KV value contains only the generated letter text and minimal metadata. The glucose summary is not stored in KV.
- Entries remain available for stale fallback for up to 24 hours, then expire automatically.
- If a new generation is blocked or the provider fails after the one-hour window, the older shared letter can be returned gently as a fallback.
- Browser CORS access is restricted to the configured GitHub Pages origin.
- Gentle and detailed modes use separate OpenAI output limits.
- If OpenAI reports `status: incomplete` because `max_output_tokens` was reached, the Worker retries once with a larger mode-specific limit.
- Partial output is never returned or written to browser/KV cache.
- The prompt asks Gluco to welcome the person before focusing on metrics, add one short everyday pause or friendly aside, and close with companionship or reassurance.
- Everyday asides must not claim a health benefit or glucose effect and must not become advice about food, exercise, medication, supplements, or sleep.
- Japanese output is checked for Gluco-style plain wording, and all output is checked for leaked variable names, JSON keys, camelCase implementation terms, and internal writing labels such as `いたわり優先`.
- Every complete first response is checked. Any detected issue triggers one clean rewrite attempt.
- After that retry, safety, medical, factual/data-consistency, privacy, and internal-artifact issues still block the response and prevent caching. Examples include blame-weighted metric phrasing, minimizing TBR, unsupported trend claims, short-range GMI, treatment-like metric targets, and leaked implementation terms.
- Minor stylistic warnings do not turn an otherwise safe rewritten letter into a user-facing failure. Examples include small wording awkwardness, repetition, compassion placement, and overemphasis of a one-point GlucoScore comparison.
- The displayed letter must not turn TIR, TAR, TBR, CV, or GlucoScore into a next-day optimization target. Blocking phrases include `目標の時間を増やす`, `TBRを減らす`, and `これだけ意識して進めよう`.
- Token and estimated-cost totals include both attempts when an automatic retry is needed.

## Companionship around the numbers

Gluco's letter should feel like a small friend checking in, not a report that ends after listing metrics.

- Open with a brief, varied welcome such as `来てくれてうれしいよ`.
- Add at most one simple everyday pause or friendly aside near the beginning or end.
- Do not invent the person's location, weather, season, time of day, symptoms, effort, or circumstances.
- Keep any reflection invitation optional rather than turning it into homework.
- Prefer a warm closing such as `ぼくはここにいるよ` while preserving the medical-safety boundary.

## Positive recognition and Unicorn wording

The Worker deliberately celebrates positive clues instead of only avoiding blame.

Initial copy rules:

- TIR >= 75% receives clear positive recognition.
- TIR >= 90% receives stronger recognition.
- TIR = 100% is celebrated enthusiastically.
- CV < 30% is described as calm and steady.
- CV < 24% receives especially warm recognition for very small variation.
- Unicorn wording is allowed only when today's latest reading is exactly 100mg/dL.
- TIR 100%, average glucose 100mg/dL, and GlucoScore 100 never qualify as a unicorn.
- TIR celebration and unicorn wording must remain separate clues; the letter must never say or imply that TIR 100% caused a unicorn.

These are language and experience rules, not medical grades or treatment targets.
The prompt must praise the observed flow rather than the person's worth or presumed effort, and it must still mention important lower or higher periods gently.

## Compassion-first wording

- TBR of 1% or higher and TIR of 70% or lower are writing cues for extra care, not medical judgments or grades.
- When either cue is present, the letter acknowledges that the period may have felt demanding before offering a next reflection.
- The wording does not assume symptoms, effort, or personal failure. It prefers phrases such as `今日はここまで、おつかれさま` and `大変な時間もあったかもしれないね`.
- Concerning metrics are stated as facts. The letter avoids blame-weighted words such as `も`, `しか`, `まだ`, `残念ながら`, `高すぎる`, `低すぎる`, `悪い`, and `問題` around those values.
- A metric is not left as a standalone exclamation line; the same sentence explains the gentle reflection clue.

The shared-cache schema is `gluco-ai-letter-cache-v12`, which prevents older cached wording from overriding the current warm-welcome, companionship, non-directive, safety, language-precision, and quality-retry rules. Shared entries expire within 24 hours.

## Production CORS policy

Production variables:

```text
CORS_ALLOWED_ORIGINS=https://afterglow21.github.io
CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN=true
```

Behavior:

- approved browser origins receive their exact origin in `Access-Control-Allow-Origin`,
- responses include `Vary: Origin`,
- valid `OPTIONS` preflight requests receive `204`,
- unapproved or malformed browser origins receive `403`,
- requests without an `Origin` header remain available for Wrangler, PowerShell, monitoring, and direct operational checks, and
- `Access-Control-Allow-Origin: *` is not used.

The GitHub Pages repository path is not part of an Origin. For example, pages under `https://afterglow21.github.io/glucoscope/` send the Origin `https://afterglow21.github.io`.

For local frontend development, create the ignored file `workers/gluco-letter-worker/.dev.vars` and add only the local origins you need:

```text
CORS_LOCAL_ORIGINS="http://127.0.0.1:5500,http://localhost:5500"
```

Do not add local origins to the production `CORS_ALLOWED_ORIGINS` value. CORS is a browser boundary, not authentication; Turnstile, secrets, rate limits, and budget guards remain required.

After deployment, run:

```powershell
.\test-cors.ps1
```

## Shared Workers KV cache setup

The Worker code treats the KV binding as optional, so the existing API keeps working before setup. To enable the production shared cache on Windows PowerShell:

```powershell
cd workers/gluco-letter-worker
.\setup-kv.ps1
```

The script:

1. installs Worker dependencies,
2. creates a production KV namespace,
3. adds the `AI_LETTER_CACHE` binding to `wrangler.toml`, and
4. runs syntax and dry-deploy checks.

Review the generated `wrangler.toml` diff, then deploy:

```powershell
npx wrangler deploy
```

The binding created by Wrangler has this shape:

```toml
[[kv_namespaces]]
binding = "AI_LETTER_CACHE"
id = "<generated namespace id>"
```

Cache controls are non-secret variables:

```text
AI_CACHE_ENABLED=true
AI_CACHE_FRESH_SECONDS=3600
AI_CACHE_RETENTION_SECONDS=86400
```

Workers KV is eventually consistent across Cloudflare locations. A newly written value is normally visible immediately where it was written, but another location may briefly see an older value while its edge cache expires.

## Local development

```bash
cd workers/gluco-letter-worker
npm install
npm run check
npm run test:quality
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
OPENAI_MAX_OUTPUT_TOKENS_LETTER=700
OPENAI_MAX_OUTPUT_TOKENS_DEEP=1500
OPENAI_RETRY_MAX_OUTPUT_TOKENS_LETTER=1100
OPENAI_RETRY_MAX_OUTPUT_TOKENS_DEEP=2400
AI_MONTHLY_BUDGET_JPY=100
AI_WARNING_BUDGET_JPY=50
AI_STOP_BUDGET_JPY=80
AI_DAILY_GENERATION_LIMIT=30
AI_SLOT_GENERATION_LIMIT=10
TURNSTILE_REQUIRED=true
CORS_ALLOWED_ORIGINS=https://afterglow21.github.io
CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN=true
```

The estimated AI cost shown by the Worker is an operational estimate paid by the developer. It is not a charge to visitors.

The production generation guard allows up to 10 new generations in each time slot (morning, afternoon, and night), with a daily maximum of 30. This is designed so the five periods (today, yesterday, 7 days, 30 days, and custom) can each be tried in both analysis modes within a slot. Cached displays do not consume a new-generation slot.

The first OpenAI attempt uses the normal limit for the selected mode. Within the incomplete-output path, only an API response explicitly marked incomplete due to `max_output_tokens` triggers one retry with the larger limit. A successful retry still counts as one user-requested generation, while usage and developer-cost estimates include both OpenAI attempts. If the retry is also incomplete, the partial text is discarded and is not cached. A separate wording-quality path also performs one rewrite when the complete first response has any detected issue; after that rewrite, only blocking safety, factual/data-consistency, privacy, or internal-artifact issues cause a generation failure.

## Response contract

See:

```text
docs/Feature_Specs/GLUCO_AI_LETTER_WORKER_CONTRACT.md
```

The Worker returns:

- letter text and mode
- shared-cache state (`stored`, `fresh`, `stale-fallback`, or unavailable)
- original generation time and cache freshness/retention timestamps
- request and monthly token usage
- estimated developer cost
- daily and time-slot guard state
- Turnstile status
- usage-counter and cache storage kind

## Safety boundary

- No diagnosis.
- No treatment decisions.
- No insulin-dose recommendations.
- No device-setting instructions.
- No raw Nightscout logs are expected.
- Only a summarized glucose reflection payload should be sent.
- AI output is a supportive reflection, not medical advice or a final conclusion.
