# GLUCO_AI_LETTER_WORKER_CONTRACT

Version: 0.2 Draft
Status: Production beta contract
Related feature spec: `docs/Feature_Specs/GLUCO_AI_LETTER_API_SPEC.md`

🍀 GlucoScope AI Letter Worker Response Contract

---

## 1. Purpose

This document defines the first response contract between the GlucoScope frontend and the AI Letter Worker.

The contract covers the production-beta OpenAI, Turnstile, Durable Object usage counter, and Workers KV shared-cache flow.

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
      "glucoScore": 98,
      "previousScore": 88,
      "sevenDayAverageScore": 89
    },
    "celebrationHints": [
      "TIRは95.7％！ 表示中のほとんどの時間が目標範囲の中だね。とてもきれいな流れだよ🍀",
      "CVは26.1％で、血糖の流れがかなり穏やかだよ。うれしい安定感が見えているね🍀"
    ],
    "patternHints": [
      "平均血糖は125mg/dLで、表示中の期間にも振り返りの手がかりがあるよ。"
    ]
  },
  "client": {
    "app": "GlucoScope",
    "mode": "worker-prototype"
  }
}
```

`celebrationHints` is optional and contains positive observations that should be acknowledged early and clearly.
The Worker independently derives celebration clues from TIR, CV, and today's latest reading, so prompt tone does not rely only on frontend-provided text.

Special wording:

- If today's latest reading is exactly 100mg/dL, the Japanese letter may say `🦄 ユニコーンをつかまえた！` once.
- This is a playful small-luck expression, not a medical judgment or reward.

### Generation-input shaping / 生成入力の整理

The request validator may accept a summary that contains more display metrics than the letter is allowed to discuss. Before either prototype or OpenAI generation, the Worker builds a reduced generation input:

- `today` and `yesterday` omit GMI and every GMI-derived hint.
- GlucoScore is omitted when there is no comparison-period score, when it is equal or lower, or when it is only one higher.
- When GlucoScore is omitted, current, comparison, average-score, and score-derived hint fields are all removed from the generation input.
- After request validation, the Worker also filters legacy-client `patternHints`: a GlucoScore hint is removed whenever GlucoScore is omitted, and a GMI hint is removed for `today` and `yesterday`.
- Only a GlucoScore at least two higher than its comparison-period value remains eligible. The generated letter may mention that change optionally and at most once.
- An eligible score may occupy only one comparison sentence or bullet. Within that one comparison, the literal name `GlucoScore` may appear at most twice so the current and comparison-period values can both be identified. More than one score sentence or more than two name occurrences is a blocking output issue.
- GlucoScore must never be presented as points, grading, success or failure, or evidence of the person's effort.

These omissions apply to the generation input, even if the frontend still uses the values for its own non-AI display. They reduce avoidable contradictions and rejected generations without weakening the medical-safety or factual checks.

リクエスト検証では、AIお手紙で扱う範囲より多い表示用指標を含むsummaryを受け取ることがあります。prototypeまたはOpenAIで文章を作る前に、Workerは生成用入力を次のように整理します。

- `today` と `yesterday` では、GMIとGMIから作ったヒントをすべて外します。
- 比較期間のGlucoScoreがない、同じ、低下、または1だけ上昇した場合は、GlucoScoreを外します。
- GlucoScoreを省く場合は、現在値、比較値、平均値、スコア由来のヒントを生成入力からすべて外します。
- リクエスト検証後、Workerは古いクライアントの `patternHints` も整理します。GlucoScore省略時はGlucoScoreを含むヒントを、`today` と `yesterday` ではGMIを含むヒントを外します。
- 比較期間より2以上高い場合だけ候補として残し、お手紙では必要なら1回まで触れてよいものとします。
- 条件を満たす場合も、スコアを扱えるのは比較する1文または1つの箇条書きだけです。その1文では、現在値と比較値を区別するため `GlucoScore` という語を最大2回まで使えます。スコアの文が2つ以上、または語が3回以上なら重大な出力問題です。
- 「点」、採点、成功・失敗、その人の努力の証明として表現してはいけません。

これらは生成入力に対する省略です。画面内のAI以外の表示に同じ値を使うことまでは妨げません。医療安全や事実確認の境界を弱めずに、不要な矛盾と生成失敗を減らします。

Future fields may include:

- `turnstileToken`
- `summaryHash`
- `clientId`
- `pageMode`

---

## 4. Success Response

```json
{
  "ok": true,
  "version": "gluco-ai-letter-worker-response-v0.2",
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
  "generation": {
    "complete": true,
    "attempts": 0,
    "retriedAfterIncomplete": false,
    "initialIncompleteReason": null,
    "maxOutputTokens": null
  },
  "cache": {
    "status": "stored",
    "storage": "cloudflare-workers-kv",
    "bindingAvailable": true,
    "key": "gluco-letter:gluco-ai-letter-cache-v13:<sha256>",
    "fresh": true,
    "ageSeconds": 0,
    "generatedAt": "2026-07-09T05:52:00.000Z",
    "freshUntil": "2026-07-09T06:52:00.000Z",
    "expiresAt": "2026-07-10T05:52:00.000Z",
    "freshSeconds": 3600,
    "retentionSeconds": 86400,
    "fallbackReason": null
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

A cached AI letter is returned. `cache.status` explains why:

- `fresh`: shared KV entry is under one hour old; no new OpenAI generation occurred.
- `stale-fallback`: the entry is older than one hour but still within retention, and a new generation was blocked or failed.

Cache hits use zero request tokens and do not consume a new-generation slot. Turnstile verification is still required before the Worker serves shared cache content.

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
  "version": "gluco-ai-letter-worker-response-v0.2",
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
  "version": "gluco-ai-letter-worker-response-v0.2",
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


---

## 13. OpenAI Provider Scaffold

The Worker can optionally use OpenAI as the AI letter provider.

Default mode remains the prototype provider.

```text
AI_PROVIDER=prototype
```

OpenAI mode must be explicitly enabled on the Worker side:

```text
AI_PROVIDER=openai
OPENAI_MODEL=gpt-5.4-nano
OPENAI_MAX_OUTPUT_TOKENS_LETTER=700
OPENAI_MAX_OUTPUT_TOKENS_DEEP=1500
OPENAI_RETRY_MAX_OUTPUT_TOKENS_LETTER=1100
OPENAI_RETRY_MAX_OUTPUT_TOKENS_DEEP=2400
OPENAI_API_KEY=<secret>
```

The API key must be stored as a Cloudflare secret.

It must never be exposed in:

- GitHub Pages JavaScript
- localStorage
- committed repository files
- browser-visible configuration

### Provider response

When OpenAI generation succeeds:

```json
{
  "letter": {
    "provider": "openai",
    "model": "gpt-5.4-nano"
  },
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 321,
    "estimatedCostJpy": 0.08
  }
}
```

When OpenAI generation fails:

```json
{
  "ok": false,
  "code": "provider_error",
  "userMessage": "AIお手紙の生成中に小さなエラーが起きました。表示中のお手紙やChatGPTコピー機能はそのまま使えます🍀"
}
```

If the Responses API returns `status: incomplete`, partial output is not accepted. When the reason is `max_output_tokens`, the Worker retries once with the larger limit for the selected mode. If the retry is also incomplete, the Worker returns:

```json
{
  "ok": false,
  "code": "generation_incomplete",
  "userMessage": "AI分析を最後までまとめきれませんでした。途中の文章は保存していないよ。少し時間をおいて、もう一度試してみてね🍀",
  "details": {
    "incompleteReason": "max_output_tokens",
    "attempts": 2
  }
}
```

Provider errors and incomplete responses should not erase the visible letter. Partial text must never be stored in browser cache or Workers KV. Usage and estimated developer cost include any incomplete attempt and the automatic retry.

### Transient OpenAI request retry / OpenAI一時通信エラーの再試行

Each logical generation, incomplete-output retry, or quality rewrite step may make one internal HTTP retry after a short delay when its OpenAI call fails because of:

- a transport or connection error
- HTTP `408`
- HTTP `409`
- HTTP `429`
- any HTTP `5xx`

The Worker makes at most one such retry for that step. Other HTTP `4xx` responses, Turnstile failures, incomplete-output decisions, and output-quality decisions do not trigger this transport retry. The browser does not resend the request and does not reuse the Turnstile token for the internal retry.

Any token usage and estimated developer cost made available by the provider across both HTTP calls is aggregated. Only the final complete response that passes the applicable blocking checks may be returned or cached.

OpenAIで文章を作る各段階、途中終了後の再生成、品質上の書き直しでは、次の場合だけ、短く待ってからWorker内で同じHTTP呼び出しを1回再試行できます。

- 通信または接続そのものの失敗
- HTTP `408`
- HTTP `409`
- HTTP `429`
- HTTP `5xx`

その段階での通信再試行は最大1回です。それ以外のHTTP `4xx`、Turnstile失敗、途中終了の判定、出力品質の判定では、この通信再試行を行いません。ブラウザからリクエストを再送せず、内部再試行のためにTurnstile tokenを再利用することもありません。

2回のHTTP通信について提供されたtoken使用量と開発者負担の推定費用は合算します。最終的に完成し、該当する重大問題の確認を通った文章だけを表示・保存できます。

### Output-quality retry boundary

Every complete first response is checked before it can be returned or cached. Issues are divided into two groups:

- **Blocking issues:** safety or medical-boundary violations, unsupported or contradictory data claims, short-range GMI use, privacy leaks, implementation artifacts, and language that turns reflection metrics into treatment-like optimization targets.
- **Soft warnings:** minor style, repetition, phrasing, compassion-placement, punctuation, or small-emphasis problems that do not create a safety, factual, privacy, or internal-data failure.

Retry and fallback behavior:

1. A clean first response is returned normally.
2. A first response with soft warnings only receives one clean rewrite attempt.
3. If that rewrite is safe and complete, it is returned; soft-only warnings after the rewrite may still be accepted.
4. If that rewrite has a provider or transport error, is incomplete, or contains a blocking issue, the safe first response is returned through the normal success path instead. Partial or unsafe retry text is never returned or cached.
5. A first response with any blocking issue is never eligible as fallback. It may receive one clean rewrite attempt, but if no safe complete rewrite is produced, the request follows the normal failure or retained-stale-cache fallback path.

Unknown future issue codes default to blocking unless explicitly classified as soft. This avoids turning a harmless wording imperfection into a user-facing failure while never rescuing an unsafe first response.

GlucoScore volume is also enforced as blocking output validation. When score omission is required, any `GlucoScore` mention blocks the response. When a score is eligible, more than one sentence or bullet containing the score, or more than two occurrences of the literal name `GlucoScore` across the response, blocks it. The two-name allowance exists only so a single comparison sentence can label both values; it does not permit a second score discussion elsewhere.

最初の完成した文章は、表示や保存の前に確認し、問題を次の2種類に分けます。

- **重大な問題:** 安全や医療の境界、データに裏付けのない断定や矛盾、短期間のGMI、プライバシー上の漏れ、内部の実装名、振り返り指標を治療目標のように扱う表現。
- **軽微な警告:** 安全性・事実性・プライバシーを損なわない、小さな不自然さ、繰り返し、言い回し、いたわりの位置、句読点、指標の強調しすぎ。

軽微な警告だけの最初の文章には、1回だけ書き直しを試します。書き直しが安全で最後まで完成していれば、その文章を使います。書き直しが通信エラー、途中終了、または重大な問題になった場合は、安全だった最初の文章を通常の成功結果として返します。途中の文章や安全でない書き直しは、表示も保存もしません。

最初の文章に重大な問題がある場合は、その文章をfallbackに使いません。1回の書き直しでも安全で完成した文章を得られなければ、通常の失敗処理または保持中の古い共有キャッシュへのfallbackに進みます。未知の判定コードは、明示的に軽微と分類されない限り重大として扱います。

GlucoScoreの量も重大な出力判定として確認します。省略対象なのに `GlucoScore` が1回でも出た文章は表示しません。条件を満たす場合でも、GlucoScoreを含む文または箇条書きが2つ以上、あるいは文章全体で `GlucoScore` という語が3回以上なら表示しません。語を2回まで許すのは、1つの比較文で現在値と比較値の両方に名前を付けるためだけであり、別の場所でもう一度スコアを説明するためではありません。

### Prompt safety

The OpenAI prompt must preserve GlucoScope safety boundaries:

- no diagnosis
- no treatment decisions
- no insulin dose advice
- no medication advice
- no pump or device setting advice
- no blame, fear, pressure, scoring, or judgment
- summarized data only
- one short welcome or companionship line near the beginning
- one short everyday pause or friendly aside near the beginning or end
- no claimed health benefit or glucose effect from that aside
- no food, exercise, medication, supplement, or sleep advice in the aside
- a closing based on companionship or reassurance; any reflection invitation remains optional
- omit GlucoScore unless it is at least two higher than a comparison-period value; mention an eligible rise optionally and at most once
- never frame GlucoScore as points, grading, success or failure, or proof of effort
- normal Japanese prose ends naturally in `。`, `！`, or `？`
- `グルコだよ🍀`, short headings, and noun-only labels may omit terminal punctuation
- sentence-ending emoji follows punctuation, for example `ぼくはここにいるよ。🍀`

日本語出力では、次の表現ルールも守ります。

- 比較期間より2以上高い場合を除きGlucoScoreを省き、条件を満たしても必要なら1回までにする
- GlucoScoreを「点」、採点、成功・失敗、努力の証明にしない
- 通常の本文は自然な `。`、`！`、`？` で終える
- `グルコだよ🍀`、短い見出し、名詞だけのラベルは句点なしでもよい
- 絵文字を文末に添える場合は、`ぼくはここにいるよ。🍀` のように句読点を先に置く


---

## 14. Turnstile Verification Scaffold

The Worker supports optional Cloudflare Turnstile verification.

Default local mode:

```text
TURNSTILE_REQUIRED=false
```

Production mode:

```text
TURNSTILE_REQUIRED=true
TURNSTILE_SECRET_KEY=<secret>
```

Request field:

```json
{
  "turnstileToken": "..."
}
```

If Turnstile is required and verification fails, the Worker returns `turnstile_failed` and must not call OpenAI.

The frontend should show a gentle retry message.


## Analysis Modes

The frontend may send `analysisMode` with the AI Letter request.

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

Supported modes:

- `letter`: a short, gentle gluco letter
- `deep`: a structured, more detailed reflection

The public demo guard treats slot and mode together:

```text
morning × letter: 1 new generation
morning × deep: 1 new generation
afternoon × letter: 1 new generation
afternoon × deep: 1 new generation
night × letter: 1 new generation
night × deep: 1 new generation
```

That means the intended public demo maximum is 6 new generations per day before shared cache is introduced.

Safety boundaries are identical for both modes: no diagnosis, no treatment decisions, no insulin dose suggestions, no medication or device-setting changes, and no blame or fear.

## 16. Frontend Mode Switcher

The frontend exposes two reflection modes outside the three panels:

- `letter`: gentle letter
- `deep`: detailed reflection

The selected mode is shared by:

- the browser-only Gluco story panel
- the AI analysis Worker request
- the ChatGPT handoff text

The AI execution button remains a single action button; mode buttons only switch the selected mode.

## 17. Letter Page Layout

The Gluco letter area is intentionally arranged as two large columns on desktop:

```text
[ Gluco image only ] [ Mode switcher ]
                     [ Browser Gluco story ]
                     [ AI analysis ]
                     [ ChatGPT handoff ]
```

The mode switcher is outside the three panels and applies to all of them. The right column stacks the three panels vertically to avoid narrow cards and horizontal overflow.

## 18. Compact Panel Picker and Lazy Turnstile

The letter area now uses two independent controls:

- Analysis mode: `letter` / `deep`
- Visible panel: browser Gluco story / AI analysis / ChatGPT handoff

Only the selected panel is shown, which keeps the right column shorter.

Turnstile is lazy-rendered only after the user presses the AI analysis button. This avoids running Turnstile browser checks during routine glucose data refreshes.

## 19. Letter Controls Debug Fix

The `gluco message` badge is replaced by compact controls:

- analysis mode: gentle / detailed
- visible panel: Gluco / AI / ChatGPT

Panel visibility is now enforced with both a CSS class and direct `hidden` / `display` updates. This avoids cases where all three panels remain visible after the picker is initialized.

## 20. Letter Controls Safety Patch

The compact letter controls are now positioned on the Gluco letter card itself instead of inside the former `gluco message` badge wrapper, because the badge wrapper can be too narrow.

Panel selection uses the direct children of `.letter-action-grid` when available, making AI/ChatGPT panel hiding more reliable.

All letter-control setup and update calls are guarded so control bugs do not interrupt Nightscout data loading.

## 21. Title Row Letter Controls

The compact analysis/view controls are placed in the same row as the `グルコからのお手紙` title, matching the relationship between the glucose chart title and its date-range buttons.

Panel selection now finds panel roots by their title text as well as by existing classes, so AI/ChatGPT panels can be hidden even when class names or nesting differ.

## 22. Panel Visibility Stabilization

Panel selection no longer depends on title-text matching alone.

The frontend now finds the visible panel root by walking from each known control/summary element until it reaches the nearest ancestor that does not contain the sibling panel probes. Hidden panels are suppressed with `display: none !important` through inline styles to avoid CSS cascade conflicts.

The title-row controls keep compact labels: `AI` and `GPT`.

## 23. Fast Panel Picker

The panel picker no longer searches large text blocks on each click.

Panel roots are cached from stable probes:

- browser panel: `.rule-letter-section`
- AI panel: the direct child of `.letter-action-grid` that contains `#aiLetterButton`
- ChatGPT panel: the direct child of `.letter-action-grid` that contains `#chatGptCopyButton` or `#chatGptOpenLink`

The controls use event delegation and default button labels are present in the initial HTML string, preventing blank pill buttons before the first update cycle.

## 24. CSS State Panel Picker

The letter panel picker now uses a root CSS state class:

- `.letter-panel-browser`
- `.letter-panel-ai`
- `.letter-panel-chat`

Clicking a view button changes only the root class and active button state. Visibility is handled by CSS selectors, avoiding repeated DOM walking and stale cached element references.

A document-level capture click handler is used so the controls continue to work after they are moved into the title row.

## 25. Static Letter Panel Markers

The letter panel picker now uses explicit HTML markers:

```html
data-letter-panel="browser"
data-letter-panel="ai"
data-letter-panel="chat"
```

The active panel is stored on `.gluco-comment-body` as:

```html
data-active-letter-panel="browser|ai|chat"
```

This removes the fragile DOM guessing that previously made panel switching update only after another button was pressed.

## 26. Inline Fallback for Letter Controls

The panel controls now have inline fallback handlers in `index.html`:

```html
onclick="window.glucoSetLetterPanel?.('ai')"
```

The JavaScript also exposes:

- `window.glucoSetLetterPanel(panel)`
- `window.glucoSetAiLetterMode(mode)`

`setLetterPanel()` now immediately updates `data-active-letter-panel`, active button state, and inline `display` styles, then re-applies once on the next animation frame and short timers. This avoids the previous case where the panel changed only after pressing an analysis-mode button.

## 27. Removed Letter View Picker

The `View` / 表示 picker was removed because switching panels was unreliable across the current DOM structure.

The letter area keeps only the analysis-mode control:

- gentle / やさしい
- detailed / しっかり

The browser Gluco story, AI analysis, and ChatGPT handoff panels are always visible again.

## 28. Letter Copy and Control Polish

Polish after removing the view picker:

- Renamed `やさしいお手紙` to `やさしい分析`
- AI panel lead copy now says the selected mode shows AI-generated analysis
- Browser/ChatGPT panel badges are hidden
- Empty ready/help status text is removed
- The browser-only detailed comment now starts with `グルコだよ🍀`
- Restored styled pill buttons for the analysis-mode control

## 29. Empty Status Keys and Chart Data Gaps

Translation lookup now allows empty-string values. This prevents empty status keys such as `aiLetterStatusReady`, `aiLetterStatusLocalOnly`, and `chatGptCopyReady` from falling back to the key name.

The glucose chart now inserts null gap points when CGM readings are separated by a longer interval. For today/yesterday views, gaps over 45 minutes are not connected by a solid line. This avoids drawing a misleading continuous line across CGM replacement or sensor downtime.

## 30. Letter Header Labels and Spacing Polish

Polish:

- Header control title changed from `分析` to `分析モード`
- Detailed mode button label changed to `しっかり分析`
- ChatGPT handoff lead/button spacing tightened
- Gluco image size is allowed to grow within the left panel

## 31. AI Result Container and Retry Button

The AI analysis result is now created by JavaScript if the current HTML does not contain `#aiLetterResult`.

This prevents successful Worker responses from showing only the status line while the generated text is missing.

The AI analysis button is also re-enabled after cached responses and after request completion, so users can press it again to show cached results or try another mode.

## 32. Cached Button and Gluco Deep Tone

UI:
- When the current slot/mode already has a saved AI result, the button label becomes `保存済みの分析を表示`.
- The button is still enabled so users can re-display the cached result.

Worker prompt:
- `letter` is now labeled `やさしい分析`.
- Japanese deep analysis must start with `グルコだよ🍀`.
- Japanese deep analysis avoids 丁寧語 (`です`, `ます`, `あります`, `ください`).
- Deep analysis uses emoji section labels instead of Markdown heading marks such as `###`.

## 33. AI Letter Status Wording

Japanese AI status wording now uses `お手紙` instead of `ふりかえり` for user-facing generated-letter status messages:

- `グルコがお手紙を書いてるよ...`
- `グルコのお手紙を表示しました🍀`
- saved/cache/limit messages also use `お手紙`

## 34. Gluco Story Font and Score Message Break

Polish:

- The browser-only `いつものグルコのお話` body now matches the AI analysis result font size/line-height.
- The GlucoScore message breaks after the first sentence for readability.

---

## 35. Shared Workers KV Cache

Browser-local layer:

- current production storage key: `glucoscope.aiLetterLocalCache.v13`
- maximum saved entries: 30 generated letters
- retired `glucoscope.aiLetterLocalCache.v12` and v11 data is removed when cache reading begins and when a saved data connection is deleted
- deleting a saved data connection also clears the current local letter cache

Production binding:

```toml
[[kv_namespaces]]
binding = "AI_LETTER_CACHE"
id = "<Cloudflare namespace id>"
```

Cache configuration:

```text
AI_CACHE_ENABLED=true
AI_CACHE_FRESH_SECONDS=3600
AI_CACHE_RETENTION_SECONDS=86400
```

The current production shared-cache key schema is `gluco-ai-letter-cache-v13`. It prevents v12 letters from overriding the GlucoScore omission, Japanese punctuation, reduced generation-input, and safe-first-response fallback rules. Production v13 neither reads nor writes v12 shared keys; retained v12 entries expire naturally under the configured 24-hour retention period. Browser-local v12 and v11 entries are removed when cache reading begins and when a saved data connection is deleted.

現在の本番では、端末内キーを `glucoscope.aiLetterLocalCache.v13`、共有キーschemaを `gluco-ai-letter-cache-v13` として稼働しています。v12のお手紙が、GlucoScore省略、自然な句読点、生成入力の整理、安全な初回文へのfallbackという新しいルールを上書きしないためです。

本番v13は共有v12キーを読み書きしません。保持中の共有v12は24時間以内の既存期限で自然に失効し、端末内v12とv11はキャッシュ読み取り時と保存済み接続の削除時に消します。

### v13 production verification — 2026-08-13 / v13本番確認 — 2026-08-13

Git commit `5ce79dc16f122def5bfd8ce40a15c0870a072b4c` was deployed as deployment `f2fbfb68-c87f-4f74-9ebf-231c8da029ee`. It routes 100% of traffic to Version 27 (`9f93a9df-f423-48c9-adbf-9de80e643712`). Version 26 (`1f4d0c91-808c-4600-8d63-e9207d06b7e0`) remains the immediate rollback target.

Cache v13 is active and shared v12 is not read. Binding and Secret names, the OpenAI model, generation limits, budget settings, CORS policy, and Durable Object migration are unchanged. The approved-origin Content-Type preflight returned `204`; an unapproved-origin Usage `GET` returned `403`; an approved-origin Usage `GET` returned `200`.

Git commit `5ce79dc16f122def5bfd8ce40a15c0870a072b4c` を、deployment `f2fbfb68-c87f-4f74-9ebf-231c8da029ee` で本番へ反映しました。通信の100%はVersion 27（`9f93a9df-f423-48c9-adbf-9de80e643712`）へ向いています。Version 26（`1f4d0c91-808c-4600-8d63-e9207d06b7e0`）を即時復帰先として保持しています。

cache v13は本番で有効で、共有v12は読み込みません。bindingとSecretの名前、OpenAI model、生成上限、budget設定、CORS policy、Durable Object migrationは変更していません。許可OriginのContent-Type preflightは `204`、不許可OriginのUsage `GET` は `403`、許可OriginのUsage `GET` は `200` を返しました。

Request order:

1. Validate JSON and summary.
2. Verify Turnstile.
3. Build an opaque SHA-256 cache key from page mode, language, period, slot, analysis mode, and displayed range.
4. Return a fresh KV letter before applying generation limits.
5. After one hour, apply daily, slot, and budget guards and try a new generation.
6. If generation is blocked or the provider fails, return a retained stale entry when available.
7. Store a successful new letter in KV and count it as a generation.

The KV value stores generated letter text and minimal metadata only. It does not store the submitted glucose summary. Entries expire automatically after the configured retention period.

Workers KV is eventually consistent across Cloudflare locations, so a newly written value can take a short time to become visible in another location.
---

## 36. Production CORS Contract

Production browser origin:

```text
https://afterglow21.github.io
```

Normal allowed browser response:

```text
Access-Control-Allow-Origin: https://afterglow21.github.io
Vary: Origin
```

Allowed preflight response:

```text
HTTP 204
Access-Control-Allow-Origin: https://afterglow21.github.io
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

Unapproved or malformed browser origins receive HTTP `403` and do not receive an `Access-Control-Allow-Origin` header. Requests without an `Origin` header remain available for Wrangler, PowerShell, uptime checks, and other non-browser operational access.

Optional local browser origins are supplied only through the ignored `CORS_LOCAL_ORIGINS` development variable. CORS is not authentication and remains layered with Turnstile, secrets, usage limits, budget controls, and the shared cache.
