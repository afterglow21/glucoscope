import { DurableObject } from "cloudflare:workers";

import { consumeCounterStorage } from "./rate-limit-core.js";

export class RelayUsageCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/consume") {
        return Response.json({ allowed: false, error: "invalid_request" }, { status: 404 });
      }
      const payload = await request.json();
      const result = await consumeCounterStorage(this.ctx.storage, payload);
      return Response.json(result, {
        status: result.allowed ? 200 : 429,
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return Response.json(
        { allowed: false, error: "invalid_request" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
}
