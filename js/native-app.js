(function configureNativeApp(root) {
  function createAbortError() {
    if (typeof root.DOMException === "function") {
      return new root.DOMException("The request was stopped.", "AbortError");
    }

    const error = new Error("The request was stopped.");
    error.name = "AbortError";
    return error;
  }

  function waitForNativeRequest(requestPromise, signal) {
    if (!signal) return requestPromise;
    if (signal.aborted) return Promise.reject(createAbortError());

    return new Promise((resolve, reject) => {
      const handleAbort = () => reject(createAbortError());
      signal.addEventListener("abort", handleAbort, { once: true });

      requestPromise.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", handleAbort);
      });
    });
  }

  async function nativeFetch(resource, options = {}) {
    const nativePromise = root.Capacitor?.nativePromise;
    if (typeof nativePromise !== "function") {
      throw new TypeError("The Capacitor native HTTP bridge is unavailable.");
    }
    if (options.signal?.aborted) throw createAbortError();

    const requestUrl = typeof root.Request === "function" && resource instanceof root.Request
      ? resource.url
      : String(resource);
    const requestHeaders = {};
    new root.Headers(options.headers).forEach((value, name) => {
      requestHeaders[name] = value;
    });

    const nativeResponse = await waitForNativeRequest(
      nativePromise.call(root.Capacitor, "CapacitorHttp", "request", {
        url: requestUrl,
        method: String(options.method || "GET").toUpperCase(),
        headers: requestHeaders,
        disableRedirects: true,
        connectTimeout: 18000,
        readTimeout: 18000
      }),
      options.signal
    );

    const responseData = nativeResponse?.data;
    const responseBody = typeof responseData === "string"
      ? responseData
      : JSON.stringify(responseData ?? null);

    return new root.Response(responseBody, {
      status: Number(nativeResponse?.status) || 500,
      headers: nativeResponse?.headers || {}
    });
  }

  root.GlucoScopeNativeApp = Object.freeze({
    isNative: true,
    platform: "ios",
    connectionStrategy: "device-direct",
    securePersistenceReady: false,
    fetch: nativeFetch
  });
})(globalThis);
