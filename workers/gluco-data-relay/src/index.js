import { handleRelayRequest } from "./relay-core.js";

export default {
  async fetch(request, env) {
    return handleRelayRequest(request, env);
  },
};
