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

The frontend never calls OpenAI directly. It calls the production Cloudflare
Worker endpoint:

```text
https://gluco-letter-worker.afterglow21.workers.dev/api/gluco-letter
```

The public GitHub Pages site enables AI letters by default. It does not require
`debugAiWorker`, `aiWorkerEndpoint`, or browser-local configuration.

The following protections remain active:

- Cloudflare Turnstile
- Worker-side time-slot and daily generation limits
- browser-local and shared one-hour cache behavior
- Usage Dashboard and estimated-cost recording
- budget stops and safe error fallbacks
- medical and AI safety wording

For privacy, deployed public pages always use the production Worker endpoint.
The `aiWorkerEndpoint` query parameter and browser-local endpoint override are
accepted only on `localhost` or `127.0.0.1`.

For local development, the default endpoint remains:

```text
http://127.0.0.1:8787/api/gluco-letter
```

Enable the local AI button with either:

```text
?debugAiWorker=1
```

or:

```js
localStorage.setItem("glucoscope.aiLetterWorkerEnabled.v1", "true");
```

On a local host only, `aiWorkerEndpoint` or
`glucoscope.aiLetterWorkerEndpoint.v1` may override the local endpoint.

## Shared AI letter cache

The public demo uses a browser-local cache first and can also use a shared Cloudflare Workers KV cache.

For the same page mode, language, period, morning/afternoon/night slot, analysis mode, and displayed range:

- a letter younger than one hour is reused without a new OpenAI request,
- cache displays do not consume a new-generation count,
- the shared KV value stores only the generated letter and minimal metadata, not the glucose summary,
- entries expire automatically within 24 hours after remaining available as a gentle stale fallback,
- incomplete OpenAI output is rejected; a `max_output_tokens` cutoff is retried once with a larger mode-specific limit, and partial text is never cached, and
- AI output is checked for Gluco-style Japanese wording and leaked internal labels; a failed first draft is rewritten once, and text that still fails is not shown or cached.

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

## Cloudflare Web Analytics

All public HTML pages include the Cloudflare Web Analytics beacon for aggregate page-view and performance monitoring. The archived `backup/` pages are intentionally excluded.

GlucoScope does not add custom analytics events or a custom visitor identifier. Glucose values, GlucoScore, AI letter text, Nightscout URLs, API information, and mobile-tab actions must not be intentionally encoded into analytics event names or additional analytics data. Public-facing details are maintained in:

```text
pages/trust/privacy-notes.html
```

The Web Analytics token is a public site identifier embedded in HTML. It is not an API secret. OpenAI keys, Turnstile secrets, and other credentials must still remain outside the repository.

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

Unicorn Gluco illustrations are also available as a local collection encounter. The browser watches only newly received latest-glucose entries while the page is open; it never searches historical data for 100mg/dL. A fresh new reading of exactly 100mg/dL can unlock one encounter per local day. The Letter-tab illustration stays Unicorn Gluco for that day without a new AI request, while the glucose-tab peek switches to Unicorn Gluco only while the current fresh reading remains 100mg/dL.
