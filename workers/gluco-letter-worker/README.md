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

Reviewed personal-quota target — 2026-08-17 JST:

- The reviewed personal-quota target is Version `86fd6a35-4db2-46f4-a745-0cfc036a5dc7`.
- Direct behavior rollback uses Version `7af1189b-aaa5-4f18-8a1f-5e447d6d7d8e`, which keeps `AI_USAGE_ATOMIC_COUNTER_ENABLED=true` and AI available while restoring shared count ceilings. Emergency AI-off recovery uses atomic stopped Version `46f44888-002b-4847-8553-5cd12e3d7ac5`. Old new-origin Version `7ea0cfef-5322-4370-b72d-e2885f129f38` and pre-atomic Versions must not receive rollback traffic.
- Phase A returned the privacy-protected personal aggregate as `suppressed` with no exact totals. A quiet window longer than 130 seconds completed before activation. The zero-percent activation probe used a synthetic non-health summary and an invalid Turnstile token; it returned `403`, wrote the private atomic marker, increased only the failed-Turnstile count by one, and left generation, token, cost, and pending-reservation totals unchanged.
- The atomic live Version's Usage `GET` and the public Dashboard's supervised real-browser visual check passed. One supervised `letter` / `night` generation moved the daily count from `0` to `1`, the monthly count from `15` to `16`, and the daily verified-Turnstile count from `0` to `1` exactly once. Token and estimated-cost totals increased once, with no duplicate, cache hit, rate limit, or budget block.
- It retains the personal-user AI, all-mode browser-local cache, CORS, Turnstile, and no-store boundaries first accepted below.

Historical boundary acceptance — 2026-08-14:

- Commit `e7621d1e3325b4f5305f4bb04355167c39eeef19` was deployed through deployment `a5b57a76-954b-4bb9-bbba-c23bfd0fa516`
- At that checkpoint, 100% of traffic routed to Version 29 (`235cdf03-31d7-40fd-ab58-5c1c6aa2d923`)
- the matching frontend was published through Pages merge `a4497ab1a5d303c8a16b7d0aad999bf0dc1bde5d`
- shared-KV read, write, and stale fallback are disabled for every mode; retained entries are not read and expire naturally within their existing maximum 24-hour lifetime
- approved-origin preflight returned `204`; originless Usage `GET` returned `200`; wrong-origin Usage `GET`, originless generation `POST`, and allowed-origin generation with an invalid Turnstile token returned `403`
- AI JSON responses retain `Cache-Control: no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`

現在の通信先 — 2026-08-16 JST：

- AI Workerの通信100%はatomic-counter Version `c0a31ac7-257c-4225-a8f1-3bf7669f6937`へ向けています。
- atomic有効化後に確認済みの直接rollbackは、未配信のatomic停止Version `46f44888-002b-4847-8553-5cd12e3d7ac5`（`AI_USAGE_ATOMIC_COUNTER_ENABLED=true`、`AI_ENABLED=false`）だけです。schema markerを書いた後は、旧new-origin Version `7ea0cfef-5322-4370-b72d-e2885f129f38`、Phase A、事前quiesce Versionへ戻しません。
- Phase Aでは個人利用集計が `suppressed` となり、実数を返さないことを確認しました。130秒を超える静止時間の後、通信0%の有効化確認で健康情報ではない合成summaryと不正Turnstile tokenを使いました。応答は`403`で、非公開atomic markerを書き、Turnstile失敗数だけを1増やし、生成回数、token、費用、pending予約は変えませんでした。
- atomic live VersionのUsage `GET`と、公開Dashboardの監督下実ブラウザ表示確認は合格しました。実際の`letter` / `night`生成1件で、1日生成回数は`0`から`1`、月間生成回数は`15`から`16`、1日のTurnstile確認成功数は`0`から`1`へ正確に1回だけ増えました。tokenと推定費用も1回分だけ増え、重複、cache hit、回数制限、予算停止はありませんでした。
- 下記のVersion 29で最初に受け入れたユーザー版AI、全mode端末内cache、CORS、Turnstile、no-storeの境界を維持します。

過去の境界受入記録 — 2026-08-14：

- commit `e7621d1e3325b4f5305f4bb04355167c39eeef19` をdeployment `a5b57a76-954b-4bb9-bbba-c23bfd0fa516` で反映
- この履歴時点では、通信の100%をVersion 29（`235cdf03-31d7-40fd-ab58-5c1c6aa2d923`）へ向けた
- 対応するフロントをPages merge `a4497ab1a5d303c8a16b7d0aad999bf0dc1bde5d` で公開
- 全modeで共有KVの読み取り、書き込み、stale fallbackを停止。残っているentryは読まず、既存の最長24時間以内に自然失効
- 許可Originのpreflightは `204`、OriginなしUsage `GET` は `200`。不許可OriginのUsage `GET`、Originなし生成 `POST`、許可Originからの不正Turnstile生成は `403`
- AIのJSON応答は `Cache-Control: no-store`、`Pragma: no-cache`、`X-Content-Type-Options: nosniff` を維持

## Production user-mode AI boundary / ユーザー版AIの本番境界

This section describes the personal-user boundary first accepted in Version 29 and retained by the current atomic Version and Pages.

この節は、Version 29で最初に受け入れ、現在のatomic VersionとPagesでも維持する個人ユーザー先行利用の本番境界を記録します。

- In `mode=user`, the first AI request for the current notice version requires a plain, explicit confirmation before Turnstile or any AI `POST`. The confirmation says that the summarized glucose information shown on the page is sent to OpenAI. Display name, connection URL, connection passphrase, and the raw glucose-entry list are not included.
- The confirmation is versioned and stored only in the browser as `glucoscope.aiLetterUserConsent.v1`. Refusing or cancelling it sends nothing and leaves the rule-based Gluco message and CGM display available.
- During personal-user early access, every mode uses only the browser-local `glucoscope.aiLetterLocalCache.v14` cache, with at most 30 entries. Production fixes `SHARED_AI_CACHE_ENABLED=false` in code and `AI_CACHE_ENABLED=false` in Worker configuration, so no mode—including `kazuma-public-demo`—can read, write, or use stale fallback from shared KV.
- The browser-provided `pageMode` is not trusted as authentication or proof that a summary belongs to the public demo. The KV binding is retained for the staged recovery rules below, not as permission to restore Version 28 while user AI is enabled. Existing entries are not read, no new entries are written, and retained entries expire naturally within their existing maximum 24-hour lifetime.
- Deleting the saved data connection clears the current browser AI-letter cache, retired local cache keys, and the stored AI confirmation. It does not claim to delete OpenAI abuse-monitoring logs.
- The Worker calls the OpenAI Responses API with `store: false`. OpenAI states that API data is not used to train its models by default unless the customer opts in. Under the default abuse-monitoring setting, logs may contain prompts and responses and are normally retained for up to 30 days; legal or service-protection exceptions may require longer retention. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- Free personal use is limited to one successfully completed new analysis per JST day for each device profile. Plus is designed for five per verified active account after sales begin. The public demo receives a reviewed fixed sample with no OpenAI call. The former shared 10-per-slot and 30-per-day count ceilings are disabled; the singleton atomic counter remains for aggregate operations, actual token/cost accounting, and the global cost safety stop. Browser-local displays do not consume a personal generation count.
- AI failure affects only the AI panel. It must not stop, clear, or replace an already verified CGM connection or the normal glucose display.
- AI generation `POST /api/gluco-letter` requires an `Origin` header that passes the existing allowlist. Originless `GET /api/gluco-letter/usage` remains available for existing operational checks.
- A successful Turnstile Siteverify response must match both `hostname=glucoscope.app` and `action=glucoscope-ai-letter`. The production variables are `TURNSTILE_EXPECTED_HOSTNAME` and `TURNSTILE_EXPECTED_ACTION`.
- The Worker-first, Pages-second release is complete. After atomic activation, the only direct rollback is the atomic-capable stopped Version named above. Version 28, Version 29, the old new-origin Version, Phase A, and the pre-activation quiesce Version are historical evidence and must not receive rollback traffic. CGM display remains independent.

- `mode=user`では、現在の案内Versionで初めてAI分析を使う前に、TurnstileやAIへの `POST` より先に、短く明示的な確認を求めます。画面で集計した血糖情報をOpenAIへ送ることを伝えます。表示名、接続先URL、接続用の合言葉、元の血糖データ一覧は送りません。
- 確認はVersion付きで `glucoscope.aiLetterUserConsent.v1` としてブラウザ内だけに保存します。「今はしない」を選んだ場合は何も送らず、ブラウザ内のいつものグルコのお話とCGM表示はそのまま使えます。
- 先行利用中は、すべてのmodeが `glucoscope.aiLetterLocalCache.v14` の端末内キャッシュだけを使い、最大30件です。本番はcode-levelで `SHARED_AI_CACHE_ENABLED=false`、Worker設定で `AI_CACHE_ENABLED=false` とし、`kazuma-public-demo` を含む全modeで共有KVの読み取り、書き込み、stale fallbackを停止します。
- ブラウザから届く `pageMode` は、認証や公開デモ由来であることの証明として信頼しません。KV bindingは下記の段階的な復旧手順のため残しますが、ユーザーAIがONのままVersion 28へ戻す許可ではありません。既存entryは読み込まず、新規entryも書きません。残っているentryは既存の最長24時間以内に自然失効します。
- 保存済みデータ接続の削除時は、現在の端末内AIキャッシュ、退役済みの端末内キャッシュ、保存したAI確認も削除します。OpenAIの不正利用監視ログまで削除できる、とは案内しません。
- WorkerはOpenAI Responses APIへ `store: false` で送信します。OpenAIは、利用者側が明示的にopt-inしない限りAPIデータをmodel学習へ使わないと説明しています。一方、標準の不正利用監視ではpromptやresponseを含み得るログが通常最長30日保持され、法令またはサービス・第三者保護のため、それより長い保持が必要となる例外があります。根拠は [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) です。
- Freeの個人利用は、端末プロフィールごとにJST 1日1回、成功した新しいAI分析を使えます。Plusは販売開始後、確認済みの有効アカウントごとに1日5回の設計です。公開デモは人が内容を確認した固定サンプルを表示し、OpenAIを呼びません。旧来の朝昼夜各10回・1日30回の共有回数上限は無効にし、全体のatomic counterは運用集計、実token・費用、全体費用安全弁のため残します。端末内の保存済み表示は個人の新しい生成回数を使いません。
- AI分析の失敗はAI欄だけで完結させます。確認済みCGM接続や通常の血糖表示を停止、削除、デモデータへ置換しません。
- AI生成の `POST /api/gluco-letter` は、既存allowlistを通る `Origin` headerを必須にします。既存運用確認用のOriginなし `GET /api/gluco-letter/usage` は維持します。
- Turnstile Siteverifyの成功時は、`hostname=glucoscope.app` と `action=glucoscope-ai-letter` の両方の一致を必須にします。本番の変数名は `TURNSTILE_EXPECTED_HOSTNAME` と `TURNSTILE_EXPECTED_ACTION` です。
- 個人別上限の動作rollbackは、上に記録したatomic対応のPhase A Versionを使います。緊急にAIを止める場合だけatomic停止Versionを使います。Version 28、Version 29、旧new-origin Version、事前quiesce Versionは履歴であり、rollback trafficを向けません。CGM表示は継続します。

## Historical Version 28 v14 behavior / 旧Version 28のv14動作

The notes below describe only historical Version 28 behavior. Current production uses the all-mode browser-local-only rule above.

以下は、旧Version 28だけの動作です。現在の本番では、上の全modeを端末内cacheだけにする規則が優先されます。

- `AI_PROVIDER=openai`
- OpenAI API key is stored as a Cloudflare secret.
- Turnstile verification is required.
- Daily, time-slot, and monthly budget guards are enabled.
- Usage counters are persisted in a singleton SQLite-backed Durable Object.
- The usage counter stores operational totals only. It does not store glucose values or AI letter text.
- Historical Version 28 used a two-layer public-demo cache: browser-local cache plus a shared Cloudflare Workers KV cache. Current production uses the browser-local layer only for every mode, including the public demo.
- The browser-local cache uses `glucoscope.aiLetterLocalCache.v14` and keeps at most 30 generated letters. The frontend removes retired v13, v12, and v11 local caches when reading the cache and when a saved connection is deleted.
- In historical Version 28, the public-demo shared key was an opaque SHA-256 hash of page mode, language, period, time slot, analysis mode, and displayed range. Raw glucose values were not part of the key. Current production does not construct or use this shared key for any mode because browser-provided page mode is not an authentication boundary.
- In historical Version 28, a public-demo shared letter younger than one hour was returned without a new OpenAI call or generation-count consumption.
- In historical Version 28, the KV value contained only the generated letter text and minimal metadata. The glucose summary was not stored in KV.
- In Version 28, public-demo entries remained available for stale fallback for up to 24 hours, then expired automatically. Current production does not read them.
- If a new public-demo generation was blocked or the provider failed after the one-hour window, Version 28 could return the older shared letter gently as a fallback. Current production never reads this shared fallback in any mode.
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
- The retained historical Version 28 shared schema was `gluco-ai-letter-cache-v14`. Current production does not read or write any shared schema; retained entries expire under the existing 24-hour retention policy.

本番のv14には、以下の動作を含みます。

- `today` と `yesterday` では、GMIとGMIから作ったヒントを生成前に外します。
- 比較期間のGlucoScoreがない、同じ、低下、または1だけ上昇した場合は、スコア項目とスコア由来のヒントを生成前に外します。
- Workerは検証後に古いクライアントの `patternHints` も整理するため、省略対象のGlucoScoreヒントや、`today`・`yesterday` のGMIヒントが生成入力へ戻ることはありません。
- 比較期間より2以上高い場合だけ、必要なら比較する1文または1つの箇条書きで触れてよいものとします。その1文では現在値と比較値を区別するため `GlucoScore` という語を最大2回まで使えます。スコアの文が2つ以上、または語が3回以上なら重大な出力問題です。「点」、採点、成功・失敗、努力の証明にはしません。
- 通信失敗またはHTTP 408、409、429、5xxでは、OpenAI処理の各段階につきWorker内で短く待って1回だけ再試行できます。それ以外の4xx、Turnstile失敗、途中終了判定、品質判定には使わず、ブラウザからの再送やTurnstile tokenの再利用もしません。
- 通常の日本語本文は自然な `。`、`！`、`？` で終えます。`グルコだよ🍀`、短い見出し、名詞だけのラベルは句点なしでも構いません。通常の文末に絵文字を添える場合は、絵文字を `。` の代わりにして `ぼくはここにいるよ🍀` とします。`ぼくはここにいるよ。🍀` や `ぼくはここにいるよ🍀。` にはしません。意味のある `！` や `？` はこのルールで外しません。
- 軽微な警告だけの初回文は1回書き直します。書き直しが通信エラー、途中終了、または重大な問題になった場合は、安全だった初回文を返します。重大な問題がある初回文はfallbackに使いません。
- 端末内キーは `glucoscope.aiLetterLocalCache.v14` で、退役したv13、v12、v11はキャッシュ読み取り時と保存済み接続の削除時に消します。
- 保持中の旧Version 28共有schemaは `gluco-ai-letter-cache-v14` でした。現在の本番は共有schemaを読み書きせず、保持中のentryは既存の24時間以内の期限で失効します。

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

Version 28 historically used shared-cache schema `gluco-ai-letter-cache-v14`. Current production does not read or write that shared cache. Version 27 and Version 28 are historical checkpoints, not direct rollback targets while user AI remains enabled.

Version 28は共有キャッシュschema `gluco-ai-letter-cache-v14` を使っていました。現在の本番はその共有cacheを読み書きしません。Version 27とVersion 28は履歴であり、ユーザーAIがONの間の直接rollback先ではありません。

## Production CORS policy

Production variables:

```text
CORS_ALLOWED_ORIGINS=https://glucoscope.app
CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN=true
```

Behavior:

- approved browser origins receive their exact origin in `Access-Control-Allow-Origin`,
- responses include `Vary: Origin`,
- valid `OPTIONS` preflight requests receive `204`,
- while quota enforcement is off, preflight keeps the existing `Content-Type`-only
  allowlist; `Authorization` is added only when the AI Worker quota flag is enabled,
- unapproved or malformed browser origins receive `403`,
- AI-generation `POST` requires an approved, present Origin, while originless Usage `GET` remains available for operational checks, and
- `Access-Control-Allow-Origin: *` is not used.

A URL path is not part of an Origin. For example, every page under `https://glucoscope.app/` sends the Origin `https://glucoscope.app`.

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

This setup records the historical Version 28 shared-cache infrastructure. Current production retains the binding but fixes `SHARED_AI_CACHE_ENABLED=false` and `AI_CACHE_ENABLED=false`; it does not read retained entries or write new ones, and existing entries expire within their current maximum 24-hour lifetime.

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

Current production keeps the effective cache boundary for every mode while retaining the binding and lifetime configuration only for staged recovery:

```text
SHARED_AI_CACHE_ENABLED=false  # code-level, fail-closed constant
AI_CACHE_ENABLED=false         # Worker configuration
```

Workers KV is eventually consistent across Cloudflare locations. A newly written value is normally visible immediately where it was written, but another location may briefly see an older value while its edge cache expires.

## Personal quota and reviewed public-demo sample

The live AI Worker is wired to the Usage Worker's named `AiQuotaService` entrypoint.
Production enables the personal-quota flag through a reviewed rollout configuration; the
checked-in `AI_PER_USER_QUOTA_ENABLED=false` remains a fail-closed baseline and must not be
used as evidence of the deployed value. The frontend sends one ephemeral profile credential
and an idempotent quota `requestId` only for the personal-user path.

When all quota switches are deliberately enabled later, a new OpenAI call validates
input and Turnstile, finishes the infrastructure-wide guards, reserves through the
service binding, generates and passes every final output check, then completes the
reservation. Provider/network errors, incomplete or rejected output, and request aborts
release the reservation. A completion or release RPC failure fails closed and returns no
generated text. A fresh cache display bypasses reservation. Client `debug` and
`forceStatus` fields are ignored on this path.

The body may add only a UUID `requestId` and allowlisted `quotaCredentialKind`
(`device_profile` or `account`). The kind is only a routing hint: Usage verifies the
Bearer token against the matching trusted source and decides Free/Plus and the 1/5 limit
server-side. The client cannot submit tier, entitlement dates, limits, or counters.

Release in this order: Usage migration and disabled internal services, this Worker with
its flag off, then Pages with its flag off. After end-to-end acceptance, enable Usage
first, this Worker second, and Pages last. Never send the custom header while the Pages
flag is false.

The reviewed replacement does not treat browser-provided `pageMode` as proof of a trusted
data source. When all quota switches are enabled, an exact public-demo request receives a
human-reviewed fixed sample which ignores submitted glucose values and does not call OpenAI
or consume personal quota. Unknown modes fail closed. Exact personal-user mode still requires
the server-authoritative Bearer credential. This removes the demo bypass problem without
creating a reusable uncredentialed OpenAI path.

The matching consent and Privacy copy explains that only the successful day/count is retained
for quota enforcement. `AI_SHARED_COUNT_LIMITS_ENABLED=false` then removes the former shared
10-per-slot and 30-per-day count ceilings, while the anonymous atomic counter and global
monthly cost stop remain. Checked-in defaults deliberately remain fail-closed: personal quota
and the demo sample are off, and shared count limits are on. Production uses the reviewed
aligned rollout values instead.

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

The checked-in staged values are defined in `wrangler.toml`:

```text
AI_PROVIDER=openai
AI_ENABLED=true
AI_USAGE_ATOMIC_COUNTER_ENABLED=false
AI_PER_USER_QUOTA_ENABLED=false
AI_SHARED_COUNT_LIMITS_ENABLED=true
AI_PUBLIC_DEMO_APPROVED_SAMPLE_ENABLED=false
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
CORS_ALLOWED_ORIGINS=https://glucoscope.app
CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN=true
```

The current production Version was built from the reviewed rollout configuration with `AI_USAGE_ATOMIC_COUNTER_ENABLED=true` and `AI_ENABLED=true`. Do not use the checked-in `false` value as a post-activation rollback instruction; the stored schema marker is sticky, and the only reviewed rollback is the atomic stopped Version recorded above.

## Atomic usage-counter rollout runbook

The atomic counter rollout is intentionally staged because Cloudflare may briefly route Worker requests across different deployed code versions while a new Version propagates.

1. **Phase A — install the new Durable Object RPCs without using them.** Keep `AI_USAGE_ATOMIC_COUNTER_ENABLED=false`, deploy this code, wait until the Phase A Version is at 100% traffic, and allow propagation to finish. Confirm that the public usage endpoint still returns HTTP 200 with `storage.kind=durable-object-sqlite`. Do not manually invoke an atomic mutation RPC during Phase A.
2. **Prepare the stopped rollback Version before activation.** Save a known-good Version built from the same atomic-capable code and bindings with `AI_USAGE_ATOMIC_COUNTER_ENABLED=true` and `AI_ENABLED=false`. It is the only safe immediate rollback target after activation. Merely changing the Phase A flag back to `false` is not a rollback plan.
3. **Quiesce legacy generation before Phase B.** Deploy the same atomic-capable code with `AI_USAGE_ATOMIC_COUNTER_ENABLED=false` and `AI_ENABLED=false`. Wait for this stopped pre-activation Version to reach 100% traffic and finish propagation, then observe a quiet window of at least 130 additional seconds. In Cloudflare Worker invocation logs, confirm that every `POST /api/gluco-letter` which started before the stop has a terminal outcome and that no new generation POST started after the stopped Version reached 100%. The 130-second quiet window covers the shared 120-second bounded provider deadline plus margin, but invocation logs remain the authoritative evidence; do not rely on elapsed time alone. Do not begin Phase B while a legacy request may still be between `getState` and `saveState`; a late legacy save is safely rejected after activation, but that one provider usage could not be reconstructed.
4. **Phase B — activate atomic mutations while generation remains stopped.** Change only `AI_USAGE_ATOMIC_COUNTER_ENABLED` to `true`, keep `AI_ENABLED=false`, deploy, and confirm 100% traffic on the Phase B Version. The first atomic mutation writes a private schema marker into the Durable Object state. The marker is not included in the public usage report.
5. **Re-enable generation only after Phase B verification.** Confirm that the usage endpoint remains readable and the atomic-capable stopped Version fails closed as expected. Then deploy `AI_USAGE_ATOMIC_COUNTER_ENABLED=true` with `AI_ENABLED=true` and verify one controlled generation before restoring ordinary traffic.
6. **Treat activation as irreversible.** After the marker exists, never roll traffic back to a Worker Version that can perform legacy whole-state saves. This code also treats the stored marker as sticky and keeps using atomic RPCs if the environment flag is accidentally changed back to `false`; that is defense in depth, not authorization to use Phase A as a rollback target.
7. **Failure response after activation.** Route traffic only to the prepared atomic-capable stopped Version (`atomic=true`, `AI_ENABLED=false`). Verify that generation is stopped safely and that the usage endpoint remains readable. Fix forward, then reactivate with another atomic-capable Version.

Atomic generation reservations include a conservative maximum planned cost for both logical OpenAI stages and both permitted HTTP attempts per stage. Completed cost plus all pending reserved cost must stay strictly below the stop budget. The public `estimatedCostJpy` remains actual provider usage only; pending reservation amounts are private operational state.

Provider work has a 120-second overall deadline, including transport retry and rewrite/incomplete retry paths. Pending reservations expire after 15 minutes. Completion and release RPCs retry once with the same `requestId`; their idempotent tombstones prevent a lost RPC response from double-counting tokens, cost, or generations.

The former release gate for provider-usage preservation is complete in the candidate: a
per-user completion failure retains known provider usage for the global atomic release, and
a per-user release failure carries the original provider error and usage into the same
idempotent global release. Both paths return no generated text. The checked-in production
setting remains `false` until migration and remote acceptance are complete.

Before either rollout phase, run:

```text
npm run check
npm run test:quality
npm run deploy:dry
```

The estimated AI cost shown by the Worker is an operational estimate paid by the developer. It is not a charge to visitors.

Current production generation still allows up to 10 new generations in each time slot (morning, afternoon, and night), with a daily maximum of 30. It is one singleton infrastructure-wide guard shared by the public demo and all callers, not a per-person allowance. The disabled personal-quota candidate replaces these count ceilings with Free 1/day and Plus 5/day while retaining the singleton's cost safety stop. Cached displays and the reviewed public-demo sample do not consume an individual new-generation use.

The first OpenAI attempt uses the normal limit for the selected mode. Within the incomplete-output path, only an API response explicitly marked incomplete due to `max_output_tokens` triggers one retry with the larger limit. A successful retry still counts as one user-requested generation, while usage and developer-cost estimates include both OpenAI attempts. If the retry is also incomplete, the partial text is discarded and is not cached.

The wording-quality path distinguishes a blocking first response from a soft-only first response. A soft-only first response gets one clean rewrite; if that rewrite fails at the provider or transport layer, is incomplete, or introduces a blocking issue, the safe first response is returned through the normal success path instead. A first response with any blocking issue is never used as fallback. It may be rewritten once, but if no safe complete rewrite is produced, current production follows the normal failure path because shared stale fallback is disabled. Partial and unsafe retry text is never returned or cached.

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
