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

Production checkpoint — 2026-08-14:

- Git commit `66f9b207d65c17130287b555920c115a9a963e1f` was deployed through deployment `5b099641-a818-4d14-ba9d-18aebb7e7ec2`
- 100% of traffic routes to Version 28 (`f2565bc3-1f49-4f3f-b119-6ec2683f0607`)
- Version 27 (`9f93a9df-f423-48c9-adbf-9de80e643712`) is the immediate rollback target
- cache schema v14 is active; production does not read shared v13 keys, and retained v13 entries expire naturally within their existing 24-hour lifetime
- binding and Secret names, the OpenAI model, generation limits, budget settings, CORS policy, and Durable Object migration are unchanged
- the approved-origin Content-Type preflight returned `204`, an unapproved-origin Usage `GET` returned `403`, and an approved-origin Usage `GET` returned `200`

本番反映記録 — 2026-08-14：

- Git commit `66f9b207d65c17130287b555920c115a9a963e1f` をdeployment `5b099641-a818-4d14-ba9d-18aebb7e7ec2` で反映
- 通信の100%はVersion 28（`f2565bc3-1f49-4f3f-b119-6ec2683f0607`）へ向ける
- Version 27（`9f93a9df-f423-48c9-adbf-9de80e643712`）を即時復帰先として保持
- cache schema v14は本番で有効。共有v13は読み込まず、保持中のv13は既存の24時間以内の期限で自然に失効
- bindingとSecretの名前、OpenAI model、生成上限、budget設定、CORS policy、Durable Object migrationは変更なし
- 許可OriginのContent-Type preflightは `204`、不許可OriginのUsage `GET` は `403`、許可OriginのUsage `GET` は `200`

## Current v14 behavior / 現行v14動作

The notes below describe the deployed v14 behavior verified in the production checkpoint above.

以下は、上の本番反映記録で確認した現行v14の動作です。

- `AI_PROVIDER=openai`
- OpenAI API key is stored as a Cloudflare secret.
- Turnstile verification is required.
- Daily, time-slot, and monthly budget guards are enabled.
- Usage counters are persisted in a singleton SQLite-backed Durable Object.
- The usage counter stores operational totals only. It does not store glucose values or AI letter text.
- AI letters use a two-layer cache: browser-local cache plus a shared Cloudflare Workers KV cache.
- The browser-local cache uses `glucoscope.aiLetterLocalCache.v14` and keeps at most 30 generated letters. The frontend removes retired v13, v12, and v11 local caches when reading the cache and when a saved connection is deleted.
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

## v14 production behavior / v14本番動作

Production v14 includes the following behavior.

- `today` and `yesterday` remove GMI and GMI-derived hints before prototype or OpenAI generation.
- GlucoScore fields and score-derived hints are removed before generation when there is no comparison-period value, the score is equal or lower, or the increase is only one.
- The Worker filters legacy-client `patternHints` after validation, so suppressed GlucoScore hints and `today`/`yesterday` GMI hints cannot re-enter the prompt.
- Only a rise of two or more may be mentioned, optionally, in one comparison sentence or bullet. That comparison may use the literal name `GlucoScore` at most twice to label both values. Extra score sentences or a third name occurrence are blocking output issues. The score is never described as points, grading, success or failure, or proof of effort.
- A transport error or HTTP 408, 409, 429, or 5xx may retry once inside the Worker after a short delay for each logical OpenAI step. Other 4xx responses and Turnstile, incomplete-output, or quality decisions do not use this transport retry; the browser does not resend or reuse a Turnstile token.
- Normal Japanese prose ends naturally with `。`, `！`, or `？`. The opening `グルコだよ🍀`, short headings, and noun-only labels may omit punctuation. For a declarative sentence ending with an emoji, the emoji replaces only `。`: use `ぼくはここにいるよ🍀`, not `ぼくはここにいるよ。🍀` or `ぼくはここにいるよ🍀。`. Meaningful `！` and `？` are not removed by this rule.
- A soft-only first response still gets one rewrite attempt. If that rewrite has a provider or transport error, is incomplete, or introduces a blocking issue, the safe first response is returned instead. A first response with any blocking issue is never a fallback candidate.
- The browser-local key is `glucoscope.aiLetterLocalCache.v14`; retired v13, v12, and v11 local entries are removed during cache reading and saved-connection deletion.
- The current shared schema is `gluco-ai-letter-cache-v14`. Production v14 does not read or write v13 shared keys; retained v13 entries expire under the existing 24-hour retention policy.

本番のv14には、以下の動作を含みます。

- `today` と `yesterday` では、GMIとGMIから作ったヒントを生成前に外します。
- 比較期間のGlucoScoreがない、同じ、低下、または1だけ上昇した場合は、スコア項目とスコア由来のヒントを生成前に外します。
- Workerは検証後に古いクライアントの `patternHints` も整理するため、省略対象のGlucoScoreヒントや、`today`・`yesterday` のGMIヒントが生成入力へ戻ることはありません。
- 比較期間より2以上高い場合だけ、必要なら比較する1文または1つの箇条書きで触れてよいものとします。その1文では現在値と比較値を区別するため `GlucoScore` という語を最大2回まで使えます。スコアの文が2つ以上、または語が3回以上なら重大な出力問題です。「点」、採点、成功・失敗、努力の証明にはしません。
- 通信失敗またはHTTP 408、409、429、5xxでは、OpenAI処理の各段階につきWorker内で短く待って1回だけ再試行できます。それ以外の4xx、Turnstile失敗、途中終了判定、品質判定には使わず、ブラウザからの再送やTurnstile tokenの再利用もしません。
- 通常の日本語本文は自然な `。`、`！`、`？` で終えます。`グルコだよ🍀`、短い見出し、名詞だけのラベルは句点なしでも構いません。通常の文末に絵文字を添える場合は、絵文字を `。` の代わりにして `ぼくはここにいるよ🍀` とします。`ぼくはここにいるよ。🍀` や `ぼくはここにいるよ🍀。` にはしません。意味のある `！` や `？` はこのルールで外しません。
- 軽微な警告だけの初回文は1回書き直します。書き直しが通信エラー、途中終了、または重大な問題になった場合は、安全だった初回文を返します。重大な問題がある初回文はfallbackに使いません。
- 端末内キーは `glucoscope.aiLetterLocalCache.v14` で、退役したv13、v12、v11はキャッシュ読み取り時と保存済み接続の削除時に消します。
- 現行の共有schemaは `gluco-ai-letter-cache-v14` です。本番v14は共有v13を読み書きせず、保持中のv13は既存の24時間以内の期限で失効します。

## Companionship around the numbers

Gluco's letter should feel like a small friend checking in, not a report that ends after listing metrics.

- Open with a brief, varied welcome such as `来てくれてうれしいよ`.
- Add at most one simple everyday pause or friendly aside near the beginning or end.
- Do not invent the person's location, weather, season, time of day, symptoms, effort, or circumstances.
- Keep any reflection invitation optional rather than turning it into homework.
- Prefer a warm closing such as `ぼくはここにいるよ` while preserving the medical-safety boundary.
- With a trailing emoji, write the closing as `ぼくはここにいるよ🍀`; the emoji replaces `。`. Do not write `ぼくはここにいるよ。🍀` or `ぼくはここにいるよ🍀。`. Meaningful `！` and `？` are outside this rule.

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

## GlucoScore in generated letters / 生成文でのGlucoScore

- No comparison value, equal score, lower score, and a one-unit increase are all omitted from the generation input and letter.
- Only a score at least two higher than the comparison-period value remains eligible for an optional, single mention.
- When omitted, current, comparison, average-score, and score-derived hint fields are all removed before generation.
- Legacy-client `patternHints` are filtered by the Worker after validation: suppressed GlucoScore hints are removed, and GMI hints are removed for `today` and `yesterday`.
- An eligible score may appear in only one comparison sentence or bullet. The name `GlucoScore` may occur at most twice within the complete response so that the single comparison can label both values. More score sentences or a third occurrence are blocking, not soft warnings.
- Even when eligible, the score is not points, a grade, success or failure, or evidence of the person's effort.

- 比較値なし、同値、低下、1だけの上昇は、生成入力とお手紙の両方から省きます。
- 比較期間より2以上高い場合だけ、必要なら1回まで触れてよいものとします。
- 省く場合は、現在値、比較値、平均値、スコア由来のヒントを生成前にすべて外します。
- 古いクライアントの `patternHints` もWorkerが検証後に整理し、省略対象のGlucoScoreヒントと、`today`・`yesterday` のGMIヒントを外します。
- 条件を満たしても、扱えるのは比較する1文または1つの箇条書きだけです。1つの比較で両方の値に名前を付けられるよう、文章全体で `GlucoScore` という語を最大2回まで許します。文が2つ以上、または語が3回以上なら軽微ではなく重大な問題です。
- 条件を満たしても、「点」、採点、成功・失敗、努力の証明にはしません。

## Compassion-first wording

- TBR of 1% or higher and TIR of 70% or lower are writing cues for extra care, not medical judgments or grades.
- When either cue is present, the letter acknowledges that the period may have felt demanding before offering a next reflection.
- The wording does not assume symptoms, effort, or personal failure. It prefers phrases such as `今日はここまで、おつかれさま` and `大変な時間もあったかもしれないね`.
- Concerning metrics are stated as facts. The letter avoids blame-weighted words such as `も`, `しか`, `まだ`, `残念ながら`, `高すぎる`, `低すぎる`, `悪い`, and `問題` around those values.
- A metric is not left as a standalone exclamation line; the same sentence explains the gentle reflection clue.

Production v14 uses shared-cache schema `gluco-ai-letter-cache-v14`, which prevents v13 cached wording from overriding the emoji-ending punctuation rule and the other current letter rules. It does not read shared v13 keys; retained v13 entries and new v14 entries expire within 24 hours. The previous v13 deployment `f2fbfb68-c87f-4f74-9ebf-231c8da029ee`, Version 27 (`9f93a9df-f423-48c9-adbf-9de80e643712`), is retained as the immediate rollback checkpoint.

本番v14では、共有キャッシュschemaを `gluco-ai-letter-cache-v14` とします。v13の保存文が、絵文字で終わる文の句点ルールや、現在のお手紙ルールを上書きしないためです。本番v14は共有v13を読み込まず、保持中のv13と新しいv14はいずれも24時間以内に失効します。直前のv13 deployment `f2fbfb68-c87f-4f74-9ebf-231c8da029ee`、Version 27（`9f93a9df-f423-48c9-adbf-9de80e643712`）は即時復帰先として保持します。

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

The first OpenAI attempt uses the normal limit for the selected mode. Within the incomplete-output path, only an API response explicitly marked incomplete due to `max_output_tokens` triggers one retry with the larger limit. A successful retry still counts as one user-requested generation, while usage and developer-cost estimates include both OpenAI attempts. If the retry is also incomplete, the partial text is discarded and is not cached.

The wording-quality path distinguishes a blocking first response from a soft-only first response. A soft-only first response gets one clean rewrite; if that rewrite fails at the provider or transport layer, is incomplete, or introduces a blocking issue, the safe first response is returned through the normal success path instead. A first response with any blocking issue is never used as fallback. It may be rewritten once, but if no safe complete rewrite is produced, the normal generation failure or retained shared-cache fallback applies. Partial and unsafe retry text is never returned or cached.

Each logical OpenAI step may internally retry its HTTP call once after a short delay only for a transport failure or HTTP 408, 409, 429, or 5xx. Other HTTP 4xx responses do not retry. Turnstile verification has already completed before this call and is neither repeated nor bypassed; the browser does not resend the request or reuse its Turnstile token. Any provider-reported token usage and estimated developer cost from the two HTTP calls is aggregated, and the ordinary final safety/cache boundary still applies.

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
