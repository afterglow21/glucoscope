import { handleRelayRequest } from "./relay-core.js";

export { RelayUsageCounter } from "./rate-limit-counter.js";
export { RelayDeviceSession } from "./device-session.js";

export default {
  async fetch(request, env) {
    return handleRelayRequest(request, env);
  },
};
