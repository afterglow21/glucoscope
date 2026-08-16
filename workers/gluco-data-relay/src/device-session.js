import { DurableObject } from "cloudflare:workers";

import {
  authorizeDeviceSessionStorage,
  cleanupDeviceSessionStorageWithRetry,
  createDeviceSessionStorage,
  revokeDeviceSessionStorage,
} from "./device-session-core.js";

export class RelayDeviceSession extends DurableObject {
  async create(input) {
    return createDeviceSessionStorage(this.ctx.storage, input);
  }

  async authorize(input) {
    return authorizeDeviceSessionStorage(this.ctx.storage, input);
  }

  async revoke(input) {
    return revokeDeviceSessionStorage(this.ctx.storage, input);
  }

  async alarm() {
    await cleanupDeviceSessionStorageWithRetry(this.ctx.storage, { nowMs: Date.now() });
  }
}
