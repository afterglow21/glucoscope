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


## Frontend Widget

The AI Letter panel now renders a Cloudflare Turnstile widget using the public site key:

```text
0x4AAAAAADyftbRcWQW23mEa
```

The frontend sends the resulting token as:

```json
{
  "turnstileToken": "..."
}
```

The token is reset after each AI Letter request because Turnstile tokens are intended for one-time server-side verification.

Local development can keep `TURNSTILE_REQUIRED=false` until the Worker secret is configured.
