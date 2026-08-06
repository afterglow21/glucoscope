import { handleDemoFeedRequest, refreshDemoFeeds } from "./demo-feed-core.js";

export default {
  async fetch(request, env) {
    return handleDemoFeedRequest(request, env);
  },

  async scheduled(controller, env) {
    try {
      await refreshDemoFeeds(env);
    } catch {
      controller.noRetry();
    }
  },
};
