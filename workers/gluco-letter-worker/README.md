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

- Commit `e7621d1e3325b4f5305f4bb04355167c39eeef19` was deployed through deployment `a5b57a76-954b-4bb9-bbba-c23bfd0fa516`
- 100% of traffic routes to Version 29 (`235cdf03-31d7-40fd-ab58-5c1c6aa2d923`)
- the matching frontend was published through Pages merge `a4497ab1a5d303c8a16b7d0aad999bf0dc1bde5d`
- shared-KV read, write, and stale fallback are disabled for every mode; retained entries are not read and expire naturally within their existing maximum 24-hour lifetime
- approved-origin preflight returned `204`; originless Usage `GET` returned `200`; wrong-origin Usage `GET`, originless generation `POST`, and allowed-origin generation with an invalid Turnstile token returned `403`
- AI JSON responses retain `Cache-Control: no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`

本番反映記録 — 2026-08-14：

- commit `e7621d1e3325b4f5305f4bb04355167c39eeef19` をdeployment `a5b57a76-954b-4bb9-bbba-c23bfd0fa516` で反映
- 通信の100%はVersion 29（`235cdf03-31d7-40fd-ab58-5c1c6aa2d923`）へ向ける
- 対応するフロントをPages merge `a4497ab1a5d303c8a16b7d0aad999bf0dc1bde5d` で公開
- 全modeで共有KVの読み取り、書き込み、stale fallbackを停止。残っているentryは読まず、既存の最長24時間以内に自然失効
- 許可Originのpreflightは `204`、OriginなしUsage `GET` は `200`。不許可OriginのUsage `GET`、Originなし生成 `POST`、許可Originからの不正Turnstile生成は `403`
- AIのJSON応答は `Cache-Control: no-store`、`Pragma: no-cache`、`X-Content-Type-Options: nosniff` を維持

## Production user-mode AI boundary / ユーザー版AIの本番境界

This section describes the Version 29 and Pages behavior now used for personal-user early access.

この節は、個人ユーザー先行利用で現在使うVersion 29とPagesの本番境界を記録します。

- In `mode=user`, the first AI request for the current notice version requires a plain, explicit confirmation before Turnstile or any AI `POST`. The confirmation says that the summarized glucose information shown on the page is sent to OpenAI. Display name, connection URL, connection passphrase, and the raw glucose-entry list are not included.
- The confirmation is versioned and stored only in the browser as `glucoscope.aiLetterUserConsent.v1`. Refusing or cancelling it sends nothing and leaves the rule-based Gluco message and CGM display available.
- During personal-user early access, every mode uses only the browser-local `glucoscope.aiLetterLocalCache.v14` cache, with at most 30 entries. Production fixes `SHARED_AI_CACHE_ENABLED=false` in code and `AI_CACHE_ENABLED=false` in Worker configuration, so no mode—including `kazuma-public-demo`—can read, write, or use stale fallback from shared KV.
- The browser-provided `pageMode` is not trusted as authentication or proof that a summary belongs to the public demo. The KV binding is retained for the staged recovery rules below, not as permission to restore Version 28 while user AI is enabled. Existing entries are not read, no new entries are written, and retained entries expire naturally within their existing maximum 24-hour lifetime.
- Deleting the saved data connection clears the current browser AI-letter cache, retired local cache keys, and the stored AI confirmation. It does not claim to delete OpenAI abuse-monitoring logs.
- The Worker calls the OpenAI Responses API with `store: false`. OpenAI states that API data is not used to train its models by default unless the customer opts in. Under the default abuse-monitoring setting, logs may contain prompts and responses and are normally retained for up to 30 days; legal or service-protection exceptions may require longer retention. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- The generation guard is still one singleton, infrastructure-wide guard shared by the public demo and every user. `AI_SLOT_GENERATION_LIMIT=10` and `AI_DAILY_GENERATION_LIMIT=30` are not per-person allowances. Browser-local displays do not consume a new-generation count; current production has no shared-cache display path.
- AI failure affects only the AI panel. It must not stop, clear, or replace an already verified CGM connection or the normal glucose display.
- AI generation `POST /api/gluco-letter` requires an `Origin` header that passes the existing allowlist. Originless `GET /api/gluco-letter/usage` remains available for existing operational checks.
- A successful Turnstile Siteverify response must match both `hostname=afterglow21.github.io` and `action=glucoscope-ai-letter`. The production variables are `TURNSTILE_EXPECTED_HOSTNAME` and `TURNSTILE_EXPECTED_ACTION`.
- The Worker-first, Pages-second release is complete. Version 28 is historical and must never be restored while user AI remains enabled because its spoofable `pageMode` boundary would reopen shared-KV writes. Keep AI fail-closed on Version 29 or later, or first publish and verify Pages with user AI disabled before Worker recovery. CGM display remains independent.

- `mode=user`では、現在の案内Versionで初めてAI分析を使う前に、TurnstileやAIへの `POST` より先に、短く明示的な確認を求めます。画面で集計した血糖情報をOpenAIへ送ることを伝えます。表示名、接続先URL、接続用の合言葉、元の血糖データ一覧は送りません。
- 確認はVersion付きで `glucoscope.aiLetterUserConsent.v1` としてブラウザ内だけに保存します。「今はしない」を選んだ場合は何も送らず、ブラウザ内のいつものグルコのお話とCGM表示はそのまま使えます。
- 先行利用中は、すべてのmodeが `glucoscope.aiLetterLocalCache.v14` の端末内キャッシュだけを使い、最大30件です。本番はcode-levelで `SHARED_AI_CACHE_ENABLED=false`、Worker設定で `AI_CACHE_ENABLED=false` とし、`kazuma-public-demo` を含む全modeで共有KVの読み取り、書き込み、stale fallbackを停止します。
- ブラウザから届く `pageMode` は、認証や公開デモ由来であることの証明として信頼しません。KV bindingは下記の段階的な復旧手順のため残しますが、ユーザーAIがONのままVersion 28へ戻す許可ではありません。既存entryは読み込まず、新規entryも書きません。残っているentryは既存の最長24時間以内に自然失効します。
- 保存済みデータ接続の削除時は、現在の端末内AIキャッシュ、退役済みの端末内キャッシュ、保存したAI確認も削除します。OpenAIの不正利用監視ログまで削除できる、とは案内しません。
- WorkerはOpenAI Responses APIへ `store: false` で送信します。OpenAIは、利用者側が明示的にopt-inしない限りAPIデータをmodel学習へ使わないと説明しています。一方、標準の不正利用監視ではpromptやresponseを含み得るログが通常最長30日保持され、法令またはサービス・第三者保護のため、それより長い保持が必要となる例外があります。根拠は [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) です。
- 生成上限は、公開デモとすべての利用者で共用する1つの全体カウンターのままです。`AI_SLOT_GENERATION_LIMIT=10` と `AI_DAILY_GENERATION_LIMIT=30` は個人別の上限ではありません。端末内の保存済み表示は新しい生成回数を使わず、現在の本番には共有キャッシュ表示経路がありません。
- AI分析の失敗はAI欄だけで完結させます。確認済みCGM接続や通常の血糖表示を停止、削除、デモデータへ置換しません。
- AI生成の `POST /api/gluco-letter` は、既存allowlistを通る `Origin` headerを必須にします。既存運用確認用のOriginなし `GET /api/gluco-letter/usage` は維持します。
- Turnstile Siteverifyの成功時は、`hostname=afterglow21.github.io` と `action=glucoscope-ai-letter` の両方の一致を必須にします。本番の変数名は `TURNSTILE_EXPECTED_HOSTNAME` と `TURNSTILE_EXPECTED_ACTION` です。
- Worker先行、Pages後続の公開は完了しました。Version 28は履歴であり、ユーザーAIがONのまま戻してはいけません。偽装できる `pageMode` 境界から共有KV書き込みが再開し得るためです。Version 29以降でAIをfail-closedに保つか、先にPages側のユーザーAIを停止して公開確認してからWorkerを復旧します。CGM表示は継続します。

## Historical Version 28 v14 behavior / 旧Version 28のv14動作

The notes below describe only historical Version 28 behavior. Current Version 29 uses the all-mode browser-local-only rule above.

以下は、旧Version 28だけの動作です。現在のVersion 29では、上の全modeを端末内cacheだけにする規則が優先されます。

- `AI_PROVIDER=openai`
- OpenAI API key is stored as a Cloudflare secret.
- Turnstile verification is required.
- Daily, time-slot, and monthly budget guards are enabled.
- Usage counters are persisted in a singleton SQLite-backed Durable Object.
- The usage counter stores operational totals only. It does not store glucose values or AI letter text.
- Historical Version 28 used a two-layer public-demo cache: browser-local cache plus a shared Cloudflare Workers KV cache. Current Version 29 uses the browser-local layer only for every mode, including the public demo.
- The browser-local cache uses `glucoscope.aiLetterLocalCache.v14` and keeps at most 30 generated letters. The frontend removes retired v13, v12, and v11 local caches when reading the cache and when a saved connection is deleted.
- In historical Version 28, the public-demo shared key was an opaque SHA-256 hash of page mode, language, period, time slot, analysis mode, and displayed range. Raw glucose values were not part of the key. Current Version 29 does not construct or use this shared key for any mode because browser-provided page mode is not an authentication boundary.
- In historical Version 28, a public-demo shared letter younger than one hour was returned without a new OpenAI call or generation-count consumption.
- In historical Version 28, the KV value contained only the generated letter text and minimal metadata. The glucose summary was not stored in KV.
- In Version 28, public-demo entries remained available for stale fallback for up to 24 hours, then expired automatically. Version 29 does not read them.
- If a new public-demo generation was blocked or the provider failed after the one-hour window, Version 28 could return the older shared letter gently as a fallback. Version 29 never reads this shared fallback in any mode.
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
- The retained historical Version 28 shared schema was `gluco-ai-letter-cache-v14`. Current Version 29 does not read or write any shared schema; retained entries expire under the existing 24-hour retention policy.

本番のv14には、以下の動作を含みます。

- `today` と `yesterday` では、GMIとGMIから作ったヒントを生成前に外します。
- 比較期間のGlucoScoreがない、同じ、低下、または1だけ上昇した場合は、スコア項目とスコア由来のヒントを生成前に外します。
- Workerは検証後に古いクライアントの `patternHints` も整理するため、省略対象のGlucoScoreヒントや、`today`・`yesterday` のGMIヒントが生成入力へ戻ることはありません。
- 比較期間より2以上高い場合だけ、必要なら比較する1文または1つの箇条書きで触れてよいものとします。その1文では現在値と比較値を区別するため `GlucoScore` という語を最大2回まで使えます。スコアの文が2つ以上、または語が3回以上なら重大な出力問題です。「点」、採点、成功・失敗、努力の証明にはしません。
- 通信失敗またはHTTP 408、409、429、5xxでは、OpenAI処理の各段階につきWorker内で短く待って1回だけ再試行できます。それ以外の4xx、Turnstile失敗、途中終了判定、品質判定には使わず、ブラウザからの再送やTurnstile tokenの再利用もしません。
- 通常の日本語本文は自然な `。`、`！`、`？` で終えます。`グルコだよ🍀`、短い見出し、名詞だけのラベルは句点なしでも構いません。通常の文末に絵文字を添える場合は、絵文字を `。` の代わりにして `ぼくはここにいるよ🍀` とします。`ぼくはここにいるよ。🍀` や `ぼくはここにいるよ🍀。` にはしません。意味のある `！` や `？` はこのルールで外しません。
- 軽微な警告だけの初回文は1回書き直します。書き直しが通信エラー、途中終了、または重大な問題になった場合は、安全だった初回文を返します。重大な問題がある初回文はfallbackに使いません。
- 端末内キーは `glucoscope.aiLetterLocalCache.v14` で、退役したv13、v12、v11はキャッシュ読み取り時と保存済み接続の削除時に消します。
- 保持中の旧Version 28共有schemaは `gluco-ai-letter-cache-v14` でした。現在のVersion 29は共有schemaを読み書きせず、保持中のentryは既存の24時間以内の期限で失効します。

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

Version 28 historically used shared-cache schema `gluco-ai-letter-cache-v14`. Current Version 29 does not read or write that shared cache. Version 27 and Version 28 are historical checkpoints, not direct rollback targets while user AI remains enabled.

Version 28は共有キャッシュschema `gluco-ai-letter-cache-v14` を使っていました。現在のVersion 29はその共有cacheを読み書きしません。Version 27とVersion 28は履歴であり、ユーザーAIがONの間の直接rollback先ではありません。

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
- AI-generation `POST` requires an approved, present Origin, while originless Usage `GET` remains available for operational checks, and
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

This setup records the historical Version 28 shared-cache infrastructure. Current Version 29 retains the binding but fixes `SHARED_AI_CACHE_ENABLED=false` and `AI_CACHE_ENABLED=false`; it does not read retained entries or write new ones, and existing entries expire within their current maximum 24-hour lifetime.

The Worker code treats the KV binding as optional. The command below is retained only as Version 28 history and must not be used to re-enable shared cache while personal-user AI is enabled:

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

Historical Version 28 cache controls were:

```text
AI_CACHE_ENABLED=true
AI_CACHE_FRESH_SECONDS=3600
AI_CACHE_RETENTION_SECONDS=86400
```

Current Version 29 changes the effective cache boundary for every mode while retaining the binding and lifetime configuration only for staged recovery:

```text
SHARED_AI_CACHE_ENABLED=false  # code-level, fail-closed constant
AI_CACHE_ENABLED=false         # Worker configuration
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

The production generation guard allows up to 10 new generations in each time slot (morning, afternoon, and night), with a daily maximum of 30. It is one singleton infrastructure-wide guard shared by the public demo and all callers, not a per-person allowance. This is designed so the five periods (today, yesterday, 7 days, 30 days, and custom) can each be tried in both analysis modes within a slot when the shared capacity is available. Cached displays do not consume a new-generation slot.

The first OpenAI attempt uses the normal limit for the selected mode. Within the incomplete-output path, only an API response explicitly marked incomplete due to `max_output_tokens` triggers one retry with the larger limit. A successful retry still counts as one user-requested generation, while usage and developer-cost estimates include both OpenAI attempts. If the retry is also incomplete, the partial text is discarded and is not cached.

The wording-quality path distinguishes a blocking first response from a soft-only first response. A soft-only first response gets one clean rewrite; if that rewrite fails at the provider or transport layer, is incomplete, or introduces a blocking issue, the safe first response is returned through the normal success path instead. A first response with any blocking issue is never used as fallback. It may be rewritten once, but if no safe complete rewrite is produced, current Version 29 follows the normal failure path because shared stale fallback is disabled. Partial and unsafe retry text is never returned or cached.

Each logical OpenAI step may internally retry its HTTP call once after a short delay only for a transport failure or HTTP 408, 409, 429, or 5xx. Other HTTP 4xx responses do not retry. Turnstile verification has already completed before this call and is neither repeated nor bypassed; the browser does not resend the request or reuse its Turnstile token. Any provider-reported token usage and estimated developer cost from the two HTTP calls is aggregated, and the ordinary final safety/cache boundary still applies.

## Response contract

See:

```text
docs/Feature_Specs/GLUCO_AI_LETTER_WORKER_CONTRACT.md
```

The Worker returns:

- letter text and mode
- cache state (`browser-local-only` for every mode in current production, with no shared stale fallback; historical Version 28 also returned `stored`, `fresh`, or `stale-fallback`)
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
