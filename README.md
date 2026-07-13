# GlucoScope

Personal Nightscout dashboard for glucose insights and daily reports.

GlucoScope is a gentle blood glucose reflection tool for people living with diabetes.
It is not a medical device and does not provide diagnosis, treatment decisions, insulin dose instructions, or emergency support.

## Current publishing target

The first public target is GitHub Pages.
Cloudflare Pages may be considered later, but the current priority is to publish the existing static site safely and quickly.

The AI letter API continues to run through Cloudflare Worker.
Provider API keys must stay server-side in the Worker environment and must never be committed to GitHub or placed in frontend JavaScript.

## GitHub Pages setup

Use the repository root as the GitHub Pages source.

1. Push the latest `main` branch to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` → `Pages`.
4. Set `Build and deployment` to `Deploy from a branch`.
5. Select:
   - Branch: `main`
   - Folder: `/ (root)`
6. Save.

Expected URL format:

```text
https://<github-user>.github.io/<repository-name>/
```

For example:

```text
https://<github-user>.github.io/glucoscope/
```

This repository includes `.nojekyll` so GitHub Pages serves the static files directly.

## Pre-publish checklist

Run these from the repository root before publishing:

```bash
git status
git rev-parse HEAD
git ls-files | grep -E '(^|/)(\.env|\.dev\.vars)'
```

The last command should return nothing.

Also check that secrets are not committed:

```bash
git grep -n -E 'sk-[A-Za-z0-9_-]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}' -- .
```

This check looks for common secret value patterns. Documentation may mention secret names as examples, but real secret values must not appear.

## AI letter Worker on GitHub Pages

The frontend does not call OpenAI directly.
It calls the Cloudflare Worker endpoint for AI letters.

For local development, the default endpoint is:

```text
http://127.0.0.1:8787/api/gluco-letter
```

For a GitHub Pages preview, use a URL parameter so the deployed page can call the public Worker without changing source code yet:

```text
https://<github-user>.github.io/<repository-name>/index.html?debugAiWorker=1&aiWorkerEndpoint=https%3A%2F%2F<worker-domain>%2Fapi%2Fgluco-letter#live
```

Replace `<worker-domain>` with the deployed Cloudflare Worker domain.

Alternative browser-local setup for testing:

```js
localStorage.setItem("glucoscope.aiLetterWorkerEnabled.v1", "true");
localStorage.setItem("glucoscope.aiLetterWorkerEndpoint.v1", "https://<worker-domain>/api/gluco-letter");
```

Then reload:

```text
https://<github-user>.github.io/<repository-name>/index.html#live
```

To reset local AI Worker settings:

```js
localStorage.removeItem("glucoscope.aiLetterWorkerEnabled.v1");
localStorage.removeItem("glucoscope.aiLetterWorkerEndpoint.v1");
```

## Shared AI letter cache

The public demo uses a browser-local cache first and can also use a shared Cloudflare Workers KV cache.

For the same page mode, language, period, morning/afternoon/night slot, analysis mode, and displayed range:

- a letter younger than one hour is reused without a new OpenAI request,
- cache displays do not consume a new-generation count,
- the shared KV value stores only the generated letter and minimal metadata, not the glucose summary, and
- entries expire automatically within 24 hours after remaining available as a gentle stale fallback, and
- incomplete OpenAI output is rejected; a `max_output_tokens` cutoff is retried once with a larger mode-specific limit, and partial text is never cached.

Production KV setup is documented in:

```text
workers/gluco-letter-worker/README.md
```

## Worker CORS policy

The production Worker uses an explicit browser-origin allowlist instead of `Access-Control-Allow-Origin: *`.
The current public origin is:

```text
https://afterglow21.github.io
```

A browser `Origin` contains only the scheme, host, and optional port, so the repository path is not included. Allowed browser responses echo the exact approved origin and include `Vary: Origin`. Disallowed browser origins receive `403`, while command-line and operational requests without an `Origin` header remain available for verification.

For local frontend development, add a non-committed Worker variable such as the following to `workers/gluco-letter-worker/.dev.vars`:

```text
CORS_LOCAL_ORIGINS="http://127.0.0.1:5500,http://localhost:5500"
```

CORS limits which browser pages can read the API response. It is not a replacement for Turnstile, usage guards, secrets, or other server-side controls.

## Safe wording boundary

GlucoScope should use:

- 糖尿病とともに生きる人
- 血糖マネジメント
- 振り返り
- 手がかり
- やさしく

GlucoScope should avoid language that makes blood glucose data feel like blame, grading, or failure.
AI letters are supportive reflections, not medical judgment.

Gluco should also celebrate clearly when the summarized data contains a genuinely positive clue. TIR of 75% or higher, CV below 30%, and a latest reading near 100mg/dL may receive specific positive recognition. TIR of 100% should be celebrated enthusiastically. When today's latest reading is exactly 100mg/dL, Gluco may say `🦄 ユニコーンをつかまえた！` as a playful small-luck moment. These are writing rules, not medical grades, treatment targets, or judgments of the person.
