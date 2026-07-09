# GLUCO_TURNSTILE_SCAFFOLD

Version: 0.1 Draft  
Status: Scaffold  
Related: `GLUCO_AI_LETTER_WORKER_CONTRACT.md`

## Purpose

This document defines the first bot-protection scaffold for GlucoScope AI Letter.

The goal is to prevent automated requests from directly increasing OpenAI usage.

## Current behavior

Local development remains OFF by default:

```text
TURNSTILE_REQUIRED=false
```

When enabled:

```text
TURNSTILE_REQUIRED=true
TURNSTILE_SECRET_KEY=<Cloudflare secret>
```

The frontend may send:

```json
{
  "turnstileToken": "<token from Cloudflare Turnstile widget>"
}
```

The Worker verifies the token server-side before cache, usage guard, or OpenAI generation.

## Safety rule

The Turnstile widget token is not enough by itself.

The Worker must call Cloudflare Siteverify server-side.

```text
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
```

If verification fails, the Worker returns:

```json
{
  "ok": false,
  "code": "turnstile_failed",
  "userMessage": "AI分析の安全確認がうまくいきませんでした。少し時間をおいて、もう一度試してください🍀"
}
```

OpenAI must not be called when Turnstile verification fails.

## Secrets

`TURNSTILE_SECRET_KEY` must never be stored in:

- GitHub Pages JavaScript
- localStorage
- committed files
- browser-visible configuration

The public Turnstile site key may be used in the frontend later.

## Future steps

- Add the visible or invisible Turnstile widget to the AI Letter panel.
- Add production Cloudflare secret.
- Enable `TURNSTILE_REQUIRED=true` only after the widget is working.
- Combine with KV cache, slot guard, and budget guard.


## Usage Report Note

`GET /api/gluco-letter/usage` does not verify a Turnstile token by itself.

For that endpoint, the report uses:

```json
{
  "turnstileVerified": null,
  "turnstileStatus": "not_applicable_for_usage_report"
}
```

Successful and failed POST verifications are counted separately:

```json
{
  "turnstileVerifiedCount": 1,
  "turnstileFailedCount": 0
}
```

This avoids confusing the usage page with the actual AI letter POST verification result.
