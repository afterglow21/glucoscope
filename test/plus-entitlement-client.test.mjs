import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../js/plus-entitlement-client.js", import.meta.url),
  "utf8"
);
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const emailDeliveryRunbook = fs.readFileSync(
  new URL("../docs/Operations/PLUS_EMAIL_DELIVERY_RUNBOOK.md", import.meta.url),
  "utf8"
);

const TOKEN = "A".repeat(43);
const VERIFICATION_GRANT = "G".repeat(43);
const SECOND_VERIFICATION_GRANT = "H".repeat(43);
const CHECKOUT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values
  };
}

function loadClient({ storage = createStorage(), fetchImpl } = {}) {
  const context = {
    AbortController,
    Headers,
    Map,
    Object,
    URL,
    console,
    crypto: { randomUUID: () => CHECKOUT_REQUEST_ID },
    fetch: fetchImpl,
    localStorage: storage,
    setTimeout,
    clearTimeout
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "plus-entitlement-client.js" });
  return { api: context.GlucoScopePlusEntitlement, storage };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}

function confirmedSelfRequest(email, turnstileToken = "turnstile") {
  return {
    email,
    turnstileToken,
    contactRole: "self",
    adultConfirmed: true,
    guardianConfirmed: false
  };
}

test("defaults to unavailable and rejects unsafe endpoints", async () => {
  const { api } = loadClient();
  assert.equal(api.getState().status, "unavailable");
  assert.equal(api._testing.normalizeEndpoint("http://example.com"), "");
  assert.equal(api._testing.normalizeEndpoint("https://example.com/path"), "");
  assert.equal(api._testing.normalizeEndpoint("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  assert.equal(api.getState().reason, "not_signed_in");
});

test("the checked-in account and purchase UI stays hidden and network-inert", () => {
  assert.match(index, /name="glucoscope-plus-account-enabled" content="false"/u);
  assert.match(index, /name="glucoscope-plus-feature-gating-enabled" content="false"/u);
  assert.match(index, /name="glucoscope-plus-purchases-enabled" content="false"/u);
  assert.match(index, /name="glucoscope-plus-entitlement-endpoint" content=""/u);
  assert.match(
    index,
    /name="glucoscope-plus-turnstile-sitekey" content="0x4AAAAAAEUvQ9ymAJlyrxyC"/u
  );
  assert.doesNotMatch(
    index,
    /name="glucoscope-plus-turnstile-sitekey" content="0x4AAAAAADyftbRcWQW23mEa"/u
  );
  assert.match(index, /id="plusAccountCard"[^>]*hidden/u);
  assert.ok(index.indexOf("js/plus-entitlement-client.js") < index.indexOf("js/plus-feature-access.js"));
  assert.match(app, /meta\[name="glucoscope-plus-account-enabled"\]/u);
  assert.match(app, /meta\[name="glucoscope-plus-purchases-enabled"\]/u);
  assert.match(app, /action: "glucoscope-plus-request-code"/u);
  assert.match(app, /action: "glucoscope-plus-delete-account"/u);
  assert.match(app, /sitekey: config\.turnstileSiteKey/gmu);
  assert.match(app, /Boolean\(endpoint\)[\s\S]*Boolean\(turnstileSiteKey\)/u);
  assert.match(index, /id="plusAccountDeleteDetails"/u);
  assert.match(index, /基本の血糖表示は、Plusを買わなくても使えます。/u);
  assert.match(index, /400円で30日間使う（支払い画面へ）/u);
  assert.match(index, /id="plusAccountRoleGuardian"/u);
  assert.match(index, /id="plusAccountAdultConfirmed"[^>]*required/u);
  assert.match(index, /子どもの名前・生年月日・血糖値は入力しません。/u);
  assert.match(index, /id="plusAccountResendCodeButton"[^>]*disabled/u);
  assert.match(index, /以前のGlucoScopeメールと同じ会話/u);
  assert.match(app, /const PLUS_ACCOUNT_RESEND_WAIT_SECONDS = 60;/u);
  assert.match(app, /startPlusAccountResendWait/u);
  assert.match(app, /いちばん新しいメールのコードだけを使ってください。/u);
  assert.match(app, /plusAccountVerificationPending = true;[\s\S]*setPlusAccountControlsDisabled\(false\)/u);
  assert.match(app, /locksBuyerConfirmation = plusAccountVerificationPending/u);
  assert.match(app, /checkoutReturn === "success"/u);
  assert.match(app, /pollPlusCheckoutConfirmation/u);
  assert.match(app, /history\.replaceState/u);
  assert.match(app, /event\.key !== "Enter"[\s\S]*event\.preventDefault\(\)/u);
  assert.match(app, /if \(!config\.accountEnabled\) return;/u);
});

test("email delivery guidance limits resend and keeps support free of codes and health data", () => {
  assert.match(emailDeliveryRunbook, /60秒の表示が終わるまで再送しない/u);
  assert.match(emailDeliveryRunbook, /いちばん新しいメールの6桁コードだけ/u);
  assert.match(emailDeliveryRunbook, /失敗した場合は、先に正常送信済みのコード/u);
  assert.match(emailDeliveryRunbook, /delivery_delayed/u);
  assert.match(emailDeliveryRunbook, /suppressed/u);
  assert.match(emailDeliveryRunbook, /6桁コード、メールのパスワード、カード情報、血糖値/u);
  assert.match(emailDeliveryRunbook, /Freeの基本機能を止めない/u);
});

test("request-code preserves local-part case and keeps its verification grant in memory only", async () => {
  const storage = createStorage();
  let captured;
  const { api } = loadClient({
    storage,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return jsonResponse({
        ok: true,
        status: "code_sent",
        verificationGrant: VERIFICATION_GRANT
      });
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.requestCode({
    ...confirmedSelfRequest("  Friend@Example.COM ")
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://plus.example/v1/auth/request-code");
  assert.deepEqual(JSON.parse(captured.init.body), {
    email: "Friend@example.com",
    turnstileToken: "turnstile",
    contactRole: "self",
    adultConfirmed: true,
    guardianConfirmed: false
  });
  assert.equal(captured.init.headers.has("Authorization"), false);
  assert.equal("verificationGrant" in result, false);
  assert.equal(JSON.stringify(api.getState()).includes(VERIFICATION_GRANT), false);
  assert.equal([...storage.values.values()].join("").includes(VERIFICATION_GRANT), false);
});

test("verification stores only the opaque session token and exposes no credential", async () => {
  const storage = createStorage();
  const calls = [];
  const { api } = loadClient({
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/auth/request-code")) {
        return jsonResponse({
          ok: true,
          status: "code_sent",
          verificationGrant: VERIFICATION_GRANT
        });
      }
      return jsonResponse({
        ok: true,
        status: "verified",
        sessionToken: TOKEN,
        session: {
          status: "ready",
          accountVerified: true,
          plusActive: false,
          purchasePending: false,
          startsAt: null,
          endsAt: null,
          shareStudioTrialAvailable: true
        }
      });
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  assert.equal((await api.requestCode(
    confirmedSelfRequest("A@Example.COM")
  )).ok, true);
  const result = await api.verifyCode({ email: "A@Example.COM", code: "123456" });
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(api.getState()).sort(),
    [
      "accountVerified",
      "endsAt",
      "plusActive",
      "purchasePending",
      "reason",
      "shareStudioTrialAvailable",
      "startsAt",
      "status"
    ]
  );
  assert.equal(JSON.stringify(api.getState()).includes(TOKEN), false);
  assert.equal(api.hasStoredSession(), true);
  const stored = JSON.parse(storage.values.get(api._testing.STORAGE_KEY));
  assert.deepEqual(stored, { schemaVersion: 1, sessionToken: TOKEN });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    email: "A@example.com",
    code: "123456",
    verificationGrant: VERIFICATION_GRANT
  });
  assert.equal(JSON.stringify(result).includes(VERIFICATION_GRANT), false);
  assert.equal(JSON.stringify(api.getState()).includes(VERIFICATION_GRANT), false);
  assert.equal(JSON.stringify(stored).includes(VERIFICATION_GRANT), false);
});

test("Share Studio trial operations send only an opaque session and request ID", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  const calls = [];
  const { api } = loadClient({
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const operation = url.split("/").at(-1);
      return jsonResponse({
        ok: true,
        status: operation === "reserve" ? "reserved" : operation === "complete" ? "completed" : "released",
        grant: "trial",
        requestId: CHECKOUT_REQUEST_ID,
        ...(operation === "complete" ? {} : { reservationExpiresAt: Date.now() + 60_000 })
      });
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const reserved = await api.reserveShareStudio();
  assert.equal(reserved.ok, true);
  assert.equal(reserved.requestId, CHECKOUT_REQUEST_ID);
  assert.deepEqual(JSON.parse(calls[0].init.body), { requestId: CHECKOUT_REQUEST_ID });
  assert.equal(calls[0].init.headers.get("Authorization"), `Bearer ${TOKEN}`);
  assert.equal(JSON.stringify(calls[0]).includes("glucose"), false);

  const completed = await api.completeShareStudio(CHECKOUT_REQUEST_ID);
  assert.equal(completed.ok, true);
  assert.equal(calls[1].url, "https://plus.example/v1/share-trial/complete");
  assert.equal(calls[2].url, "https://plus.example/v1/session");
});

test("Share Studio exposes a rejected trial status as the client error", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  const { api } = loadClient({
    storage,
    fetchImpl: async () => jsonResponse({
      ok: false,
      status: "trial_already_used"
    }, 409)
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.reserveShareStudio();
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.error, "trial_already_used");
});

test("verification fails locally without a request-code grant", async () => {
  let calls = 0;
  const { api } = loadClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ ok: false, error: "unexpected" }, 500);
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.verifyCode({ email: "A@example.com", code: "123456" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "verification_grant_required");
  assert.equal(calls, 0);
});

test("a pending code is bound to the email that requested it", async () => {
  let verificationCalls = 0;
  const { api } = loadClient({
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/auth/request-code")) {
        return jsonResponse({
          ok: true,
          status: "code_sent",
          verificationGrant: VERIFICATION_GRANT
        });
      }
      verificationCalls += 1;
      return jsonResponse({ ok: false, error: "unexpected" }, 500);
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  await api.requestCode(confirmedSelfRequest("first@example.com"));
  const result = await api.verifyCode({
    email: "changed@example.com",
    code: "123456"
  });
  assert.equal(result.error, "verification_grant_required");
  assert.equal(verificationCalls, 0);
});

test("wrong-code retries retain the in-memory verification grant until success", async () => {
  const verifyBodies = [];
  let verifyCalls = 0;
  const { api } = loadClient({
    fetchImpl: async (url, init) => {
      if (url.endsWith("/v1/auth/request-code")) {
        return jsonResponse({
          ok: true,
          status: "code_sent",
          verificationGrant: VERIFICATION_GRANT
        });
      }
      verifyBodies.push(JSON.parse(init.body));
      verifyCalls += 1;
      if (verifyCalls === 1) {
        return jsonResponse({ ok: false, error: "invalid_or_expired_code" }, 400);
      }
      return jsonResponse({
        ok: true,
        status: "verified",
        sessionToken: TOKEN,
        session: {
          status: "ready",
          accountVerified: true,
          plusActive: false,
          purchasePending: false,
          startsAt: null,
          endsAt: null,
          shareStudioTrialAvailable: true
        }
      });
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  await api.requestCode(confirmedSelfRequest("A@example.com"));
  assert.equal((await api.verifyCode({ email: "A@example.com", code: "000000" })).error,
    "invalid_or_expired_code");
  assert.equal((await api.verifyCode({ email: "A@example.com", code: "123456" })).ok, true);
  assert.deepEqual(verifyBodies.map((body) => body.verificationGrant), [
    VERIFICATION_GRANT,
    VERIFICATION_GRANT
  ]);
  assert.equal((await api.verifyCode({ email: "A@example.com", code: "123456" })).error,
    "verification_grant_required");
});

test("a failed resend retains the previous grant and exposes a bounded retry wait", async () => {
  const verifyBodies = [];
  let requestCalls = 0;
  const { api } = loadClient({
    fetchImpl: async (url, init) => {
      if (url.endsWith("/v1/auth/request-code")) {
        requestCalls += 1;
        if (requestCalls === 1) {
          return jsonResponse({
            ok: true,
            status: "code_sent",
            verificationGrant: VERIFICATION_GRANT
          });
        }
        return jsonResponse(
          { ok: false, error: "please_wait" },
          429,
          { "Retry-After": "60" }
        );
      }
      verifyBodies.push(JSON.parse(init.body));
      return jsonResponse({ ok: false, error: "invalid_or_expired_code" }, 400);
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  assert.equal((await api.requestCode(confirmedSelfRequest("A@example.com"))).ok, true);
  const resend = await api.requestCode(confirmedSelfRequest("A@example.com", "fresh-token"));
  assert.equal(resend.ok, false);
  assert.equal(resend.error, "please_wait");
  assert.equal(resend.retryAfterSeconds, 60);
  await api.verifyCode({ email: "A@example.com", code: "123456" });
  assert.equal(verifyBodies[0].verificationGrant, VERIFICATION_GRANT);
});

test("a successful resend replaces the previous in-memory grant", async () => {
  const verifyBodies = [];
  let requestCalls = 0;
  const { api } = loadClient({
    fetchImpl: async (url, init) => {
      if (url.endsWith("/v1/auth/request-code")) {
        requestCalls += 1;
        return jsonResponse({
          ok: true,
          status: "code_sent",
          verificationGrant: requestCalls === 1
            ? VERIFICATION_GRANT
            : SECOND_VERIFICATION_GRANT
        });
      }
      verifyBodies.push(JSON.parse(init.body));
      return jsonResponse({ ok: false, error: "invalid_or_expired_code" }, 400);
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  await api.requestCode(confirmedSelfRequest("A@example.com"));
  await api.requestCode(confirmedSelfRequest("A@example.com", "fresh-token"));
  await api.verifyCode({ email: "A@example.com", code: "234567" });
  assert.equal(verifyBodies[0].verificationGrant, SECOND_VERIFICATION_GRANT);
});

test("configure, clear, logout, and delete discard an in-memory verification grant", async () => {
  for (const clearGrant of [
    async (api) => api.configure({ enabled: true, endpoint: "https://plus.example" }),
    async (api) => api.clear(),
    async (api) => api.logout(),
    async (api) => api.deleteAccount({ turnstileToken: "delete-token" })
  ]) {
    let verificationCalls = 0;
    const { api } = loadClient({
      fetchImpl: async (url) => {
        if (url.endsWith("/v1/auth/request-code")) {
          return jsonResponse({
            ok: true,
            status: "code_sent",
            verificationGrant: VERIFICATION_GRANT
          });
        }
        verificationCalls += 1;
        return jsonResponse({ ok: false, error: "unexpected" }, 500);
      }
    });
    await api.configure({ enabled: true, endpoint: "https://plus.example" });
    await api.requestCode(confirmedSelfRequest("A@example.com"));
    await clearGrant(api);
    const result = await api.verifyCode({ email: "A@example.com", code: "123456" });
    assert.equal(result.error, "verification_grant_required");
    assert.equal(verificationCalls, 0);
  }
});

test("changing the pending email or buyer choices cancels verification without a network request", async () => {
  let verificationCalls = 0;
  const { api } = loadClient({
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/auth/request-code")) {
        return jsonResponse({
          ok: true,
          status: "code_sent",
          verificationGrant: VERIFICATION_GRANT
        });
      }
      verificationCalls += 1;
      return jsonResponse({ ok: false, error: "unexpected" }, 500);
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  assert.equal((await api.requestCode(confirmedSelfRequest("A@example.com"))).ok, true);
  const cancelled = api.cancelVerification();
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.status, "verification_cancelled");
  assert.equal((await api.verifyCode({
    email: "A@example.com",
    code: "123456"
  })).error, "verification_grant_required");
  assert.equal(verificationCalls, 0);
});

test("refresh authenticates from storage and removes stale credentials on 401", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  let authorization = "";
  const { api } = loadClient({
    storage,
    fetchImpl: async (_url, init) => {
      authorization = init.headers.get("Authorization");
      return jsonResponse({ ok: false, error: "invalid_session" }, 401);
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.refresh();
  assert.equal(result.ok, false);
  assert.equal(authorization, `Bearer ${TOKEN}`);
  assert.equal(storage.getItem("glucoscope.plusSession.v1"), null);
  assert.equal(api.getState().reason, "signed_out");
});

test("a server-confirmed pending purchase is exposed only as a boolean", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  const { api } = loadClient({
    storage,
    fetchImpl: async () => jsonResponse({
      ok: true,
      status: "ready",
      accountVerified: true,
      plusActive: false,
      purchasePending: true,
      startsAt: null,
      endsAt: null,
      shareStudioTrialAvailable: true
    })
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.refresh();
  assert.equal(result.ok, true);
  assert.equal(api.getState().purchasePending, true);
  assert.equal(JSON.stringify(api.getState()).includes("checkout"), false);
});

test("logout clears the browser before a failed remote revocation", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  const { api } = loadClient({
    storage,
    fetchImpl: async () => { throw new Error("offline"); }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.logout();
  assert.equal(result.ok, true);
  assert.equal(storage.getItem("glucoscope.plusSession.v1"), null);
});

test("account deletion needs its own safety token and clears only after success", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  let calls = 0;
  const { api } = loadClient({
    storage,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://plus.example/v1/account/delete");
      assert.equal(init.headers.get("Authorization"), `Bearer ${TOKEN}`);
      assert.deepEqual(JSON.parse(init.body), {
        turnstileToken: "delete-safety-token",
        confirmDelete: true
      });
      return jsonResponse({ ok: true, status: "account_deleted" });
    }
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  assert.equal((await api.deleteAccount()).ok, false);
  assert.equal(calls, 0);
  assert.notEqual(storage.getItem("glucoscope.plusSession.v1"), null);
  const result = await api.deleteAccount({ turnstileToken: "delete-safety-token" });
  assert.equal(result.ok, true);
  assert.equal(storage.getItem("glucoscope.plusSession.v1"), null);
});

test("a deletion refusal keeps the session so support remains possible", async () => {
  const storage = createStorage();
  storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
    schemaVersion: 1,
    sessionToken: TOKEN
  }));
  const { api } = loadClient({
    storage,
    fetchImpl: async () => jsonResponse({
      ok: false,
      error: "account_deletion_requires_support"
    }, 409)
  });
  await api.configure({ enabled: true, endpoint: "https://plus.example" });
  const result = await api.deleteAccount({ turnstileToken: "delete-safety-token" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "account_deletion_requires_support");
  assert.notEqual(storage.getItem("glucoscope.plusSession.v1"), null);
});

test("Checkout accepts only Stripe-hosted HTTPS URLs", async () => {
  for (const [url, expected] of [
    ["https://checkout.stripe.com/c/pay/cs_test_example", true],
    ["https://evil.example/checkout", false],
    ["javascript:alert(1)", false]
  ]) {
    const storage = createStorage();
    storage.setItem("glucoscope.plusSession.v1", JSON.stringify({
      schemaVersion: 1,
      sessionToken: TOKEN
    }));
    const { api } = loadClient({
      storage,
      fetchImpl: async (requestUrl, init) => {
        assert.equal(requestUrl, "https://plus.example/v1/plus/checkout");
        assert.deepEqual(JSON.parse(init.body), { requestId: CHECKOUT_REQUEST_ID });
        return jsonResponse({ ok: true, checkoutUrl: url });
      }
    });
    await api.configure({ enabled: true, endpoint: "https://plus.example" });
    const result = await api.createCheckout();
    assert.equal(result.ok, expected);
  }
});
