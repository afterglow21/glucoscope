import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

test("Plus checkout requires a visible final order review instead of a browser confirm", () => {
  assert.match(html, /id="plusPurchaseReview"[^>]*hidden/u);
  assert.match(html, /id="plusPurchaseReviewTitle"[^>]*tabindex="-1"/u);
  assert.match(html, /お申し込み内容の最終確認/u);
  assert.match(html, /GlucoScope Plus 30日パス/u);
  assert.match(html, /お支払い総額[\s\S]*400円/u);
  assert.match(html, /1回だけ支払います/u);
  assert.match(html, /連続30日間/u);
  assert.match(html, /自動で料金は発生しません/u);
  assert.match(html, /id="plusPurchaseReviewConfirmButton"[\s\S]*400円を1回支払う/u);
  assert.match(html, /id="plusPurchaseReviewCancelButton"[\s\S]*今は購入しない/u);

  const purchaseHandlerStart = app.indexOf(
    'document.getElementById("plusAccountPurchaseButton")?.addEventListener',
  );
  const purchaseHandlerEnd = app.indexOf(
    'document.getElementById("plusPurchaseReviewCancelButton")?.addEventListener',
    purchaseHandlerStart,
  );
  const purchaseHandler = app.slice(purchaseHandlerStart, purchaseHandlerEnd);
  assert.ok(purchaseHandlerStart >= 0 && purchaseHandlerEnd > purchaseHandlerStart);
  assert.match(purchaseHandler, /plusPurchaseReviewOpen = true/u);
  assert.doesNotMatch(purchaseHandler, /window\.confirm/u);

  const paymentHandler = app.match(
    /document\.getElementById\("plusPurchaseReviewConfirmButton"\)[\s\S]*?window\.location\.assign\(result\.url\)/u,
  )?.[0] || "";
  assert.match(paymentHandler, /plusPurchaseReviewOpen/u);
  assert.match(paymentHandler, /createCheckout/u);
  assert.match(app, /!accountState\.purchasePending \|\| plusCheckoutCancelledReturn/u);
});

test("final review keeps refund, eligibility, receipt, medical, and correction boundaries visible", () => {
  assert.match(html, /日本国内に住む/u);
  assert.match(html, /18歳以上/u);
  assert.match(html, /全額返金/u);
  assert.match(html, /部分返金は行わず/u);
  assert.match(html, /通常の領収書/u);
  assert.match(html, /適格請求書（インボイス）ではありません/u);
  assert.match(html, /医療サービスではなく/u);
  assert.match(html, /メールが違う時は/u);
  assert.match(html, /Plusアカウントを削除して確認し直せます/u);
});

test("final review links to all same-site purchase documents", () => {
  for (const path of [
    "pages/trust/commercial-transactions.html",
    "pages/trust/plus-terms.html",
    "pages/trust/privacy-notes.html",
    "pages/trust/plus-support.html",
  ]) {
    assert.match(html, new RegExp(`href="${path.replaceAll("/", "\\/")}"`, "u"));
  }
  assert.equal((html.match(/class="plus-purchase-review-links"/gu) || []).length, 1);
});

test("English final review preserves the same commercial meaning", () => {
  for (const expected of [
    "Final order review",
    "JPY 400",
    "Pay JPY 400 once",
    "No automatic charge",
    "full refund after review",
    "not a Japanese qualified invoice",
    "not a medical service",
  ]) assert.match(app, new RegExp(expected, "u"));
});
