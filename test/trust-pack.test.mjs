import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";

const rootUrl = new URL("../", import.meta.url);
const trustPackUrl = new URL("../pages/about/trust-pack.html", import.meta.url);
const trustDirUrl = new URL("../pages/trust/", import.meta.url);

async function read(url) {
  return readFile(url, "utf8");
}

async function trustPageUrls() {
  const names = await readdir(trustDirUrl);
  return names.filter((name) => name.endsWith(".html")).map((name) => new URL(name, trustDirUrl));
}

function decodeHtmlText(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

test("Trust Pack internal links and local assets resolve", async () => {
  const pages = [trustPackUrl, ...await trustPageUrls()];
  for (const pageUrl of pages) {
    const html = await read(pageUrl);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#|data:)/i.test(target)) continue;
      const resolved = new URL(target, pageUrl);
      resolved.hash = "";
      resolved.search = "";
      await assert.doesNotReject(access(resolved), `${pageUrl.pathname}: ${target}`);
    }
  }
});

test("Trust Pack cards match their destination titles", async () => {
  const index = await read(trustPackUrl);
  const cards = [...index.matchAll(/<h3><span class="about-detail-mini-title-en">([^<]+)<\/span><span class="about-detail-mini-title-jp">([^<]+)<\/span><\/h3>[\s\S]*?<a href="([^"]+)">/g)];
  assert.equal(cards.length, 12);

  for (const [, titleEn, titleJp, href] of cards) {
    const destination = await read(new URL(href, trustPackUrl));
    const destinationEn = destination.match(/about-detail-title-en">([^<]+)</)?.[1];
    const destinationJp = destination.match(/about-detail-title-jp">([^<]+)</)?.[1];
    assert.equal(decodeHtmlText(destinationEn || ""), decodeHtmlText(titleEn));
    assert.equal(decodeHtmlText(destinationJp || ""), decodeHtmlText(titleJp));
  }
});

test("public relay wording preserves the current verification and privacy boundaries", async () => {
  const index = await read(trustPackUrl);
  const data = await read(new URL("data-integration-principles.html", trustDirUrl));
  const privacy = await read(new URL("privacy-notes.html", trustDirUrl));
  const safety = await read(new URL("safety-policy.html", trustDirUrl));
  const support = await read(new URL("support-policy.html", trustDirUrl));
  const roadmap = await read(new URL("roadmap.html", trustDirUrl));
  const readme = await read(new URL("../README.md", import.meta.url));

  assert.match(index, /Nightscoutへの直接接続と、Gluroo限定中継の現在地・安全境界/);
  assert.match(data, /Guardianは、iPhoneのGuardian MonitorからGluroo Global Connect、限定中継、GlucoScopeまでの最初の全経路確認を完了しました/);
  assert.match(data, /Libre 2も、FreeStyle LibreLink、LibreLinkUp、Gluroo、限定中継、GlucoScopeまでの基本経路/);
  assert.match(data, /現在血糖、グラフ、再読み込み、iOSホーム画面からの復帰/);
  assert.match(data, /期間別・期限切れ・削除・上限の追加確認は残っています/);
  assert.match(data, /Dexcom G7はGlurooまで確認済みですが、一般利用者向け限定中継からGlucoScopeまでのライブ経路を確認済みとは案内しません/);
  assert.match(data, /通常タブでSafariを完全終了した後の保存は未確認です/);
  assert.match(data, /2026年8月6日、Glurooから/);
  assert.match(data, /医療相談や医療判断には使えません/);
  assert.match(data, /CGMデータ再共有が適法かどうかをGlucoScopeが判断するものではなく/);
  assert.match(data, /有料Nightscoutサービスの「無料代替」/);
  assert.match(data, /将来はサブスクリプション/);
  assert.match(data, /GlucoScopeや限定中継への質問は、GlurooではなくGlucoScopeが受けます/);
  assert.match(data, /公開比較は一般利用者向け中継と分ける/);
  assert.match(data, /Kazumaは自分自身のLibreの血糖値と測定・更新時刻を公開することを明示的に選びました/);
  assert.match(data, /一般利用者の接続情報や血糖データを保存しません/);
  assert.match(data, /公開デモWorkerによる1回の定期取得、ソース別KVキー作成、安全な公開Worker応答まで確認済み/);
  assert.match(data, /停止中のG7接続先は`dexcomRouteVerified=false`のままフロントへ設定済み/);
  assert.match(data, /GitHub Pagesへの公開反映確認はまだです/);
  assert.match(data, /現在のページは停止中Workerにより「準備中・合成データ」のままです/);
  assert.match(data, /G7ライブ表示、3機種の同時比較、ページ全体のエンドツーエンド経路は未確認です/);
  assert.match(data, /G7の血糖値と測定・更新時刻の公開へも、Libreとは別に明示同意しました/);
  assert.match(data, /G7だけを一時有効にしたVersion `3b796eb5-11be-466f-83ea-7710279f49c1`/);
  assert.match(data, /Libreを停止したまま1回のCronで`public:dexcom-g7:v1`を作成/);
  assert.match(data, /公開応答190件の項目、型、範囲、時系列順、更新の新しさ/);
  assert.match(data, /許可OriginのGETは`200`、preflightは`204`、不許可Originは`403`、Libreは`503`/);
  assert.match(data, /KVの生データは直接読み出しておらず/);
  assert.match(data, /deployment `8de64190-7558-43c6-83c1-1e29a2cf80de`で停止Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`へ100%戻し/);
  assert.match(data, /両経路は再び`503`/);
  assert.match(data, /次の停止中Cron後もG7キーの有効期限は延長されませんでした/);
  assert.match(data, /Libreだけを一時有効にしたVersion `2e72847d-5011-47c5-80e6-8cb931a1b141`/);
  assert.match(data, /19:25 JSTのCronで公開`\/v1\/libre`応答が合計523件/);
  assert.match(data, /上位スキーマ、許可した項目、型、範囲、時系列順、更新の新しさ、確認対象の非公開項目がないこと、CORS境界/);
  assert.match(data, /実際の血糖値、測定時刻、Gluroo URL、Secret、tokenは検査出力やGitへ入れていません/);
  assert.match(data, /G7は`503`のままでした/);
  assert.match(data, /確認後すぐ停止Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`へ戻し、両経路が`503`/);
  assert.match(data, /次の停止中Cron後もLibreキーの有効期限は延長されませんでした/);
  assert.match(data, /複数回の定期更新と一般利用者向け限定中継のG7経路も未確認です/);
  assert.match(privacy, /限定中継は現在停止中です/);
  assert.match(privacy, /明示的な同意がない限り、限定中継への通信を始めません/);
  assert.match(privacy, /Kazuma自身の公開比較データ/);
  assert.match(privacy, /公開URLを知る人は有効化中の値を閲覧できるため、匿名データとは案内しません/);
  assert.match(privacy, /一般利用者の接続情報や血糖データをデモ用WorkerやKVへ保存・公開しません/);
  assert.match(privacy, /KVは最長36時間で期限切れ/);
  assert.match(privacy, /残ったキーは停止中の経路から配信せず、既存の最長36時間TTLで失効します/);
  assert.match(privacy, /KVの生データは直接読み出していません/);
  assert.match(privacy, /停止中のG7接続先は`dexcomRouteVerified=false`のまま設定済みです/);
  assert.match(privacy, /GitHub Pagesへの公開反映、G7ライブ表示、3機種同時比較、ページ全体の経路は未確認です/);
  assert.match(privacy, /Libreだけを一時有効にしたVersion `2e72847d-5011-47c5-80e6-8cb931a1b141`/);
  assert.match(privacy, /19:25 JSTのCronで公開`\/v1\/libre`応答が合計523件/);
  assert.match(privacy, /次の停止中Cron後もLibreキーの有効期限は延長されませんでした/);
  assert.match(privacy, /複数回の定期更新と、一般利用者向け限定中継のG7経路も未確認です/);
  assert.match(privacy, /ユーザー版は、前の項目のとおり現在送信しません/);
  assert.match(safety, /接続失敗は、CGMやポンプが止まったことを意味しません/);
  assert.match(support, /Gluroo、Nightscout、Azure、Cloudflare、OpenAI/);
  assert.match(support, /GlucoScopeや限定中継についての質問・不具合報告は、GlurooではなくGlucoScopeが受けます/);
  assert.match(roadmap, /初回告知はまだ実施していません/);
  assert.match(roadmap, /現在の最優先は、公開3CGM比較ラボを段階的に確認することです/);
  assert.match(roadmap, /完了：Libre公開デモWorkerの取得と安全な公開応答を1回だけ確認し、停止状態へ戻しました/);
  assert.match(roadmap, /現在：停止中のG7接続先を`dexcomRouteVerified=false`のままフロントへ設定済みです/);
  assert.match(roadmap, /GitHub Pagesへの公開反映と、合成データへの安全な切替を確認します/);
  assert.match(roadmap, /現時点の3CGM比較ページは、Libre公開デモ用Workerが停止中のため「準備中・合成データ」を表示しています/);
  assert.match(roadmap, /GuardianのAzure Nightscoutブラウザ直接経路は別途確認済みですが、その事実だけで比較ページ全体をライブ表示済みとは扱いません/);
  assert.match(roadmap, /Libreだけを一時有効にしたVersion `2e72847d-5011-47c5-80e6-8cb931a1b141`/);
  assert.match(roadmap, /19:25 JSTのCronで公開`\/v1\/libre`応答が合計523件/);
  assert.match(roadmap, /次の停止中Cron後もLibreキーの有効期限は延長されませんでした/);
  assert.match(readme, /Guardian route completed its first iPhone Safari acceptance/);
  assert.match(readme, /Extended period, expiry, deletion, and limit checks remain/);
  assert.match(readme, /approved `workers\.dev` target is fixed in the checked-in frontend/);
  assert.match(readme, /`preview_urls=false`, `observability\.enabled=false`, and the checked-in `RELAY_ENABLED=false`/);
  assert.match(readme, /currently falls back to the clearly labelled synthetic dataset because the dedicated Libre public-demo feed is paused/);
  assert.match(readme, /Guardian's separate Azure Nightscout browser route is verified, but that does not make the combined comparison page live by itself/);
  assert.match(readme, /global `DEMO_FEED_ENABLED=false`, source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`/);
  assert.match(readme, /stopped `glucoscope-demo-feed` Worker was deployed as Version/);
  assert.match(readme, /approved-origin G7 preflight returns `204`/);
  assert.match(readme, /registered exactly the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets/);
  assert.match(readme, /deployed to 100% of production traffic with all three gates still `false`/);
  assert.match(readme, /at that stopped-deployment checkpoint, the dedicated KV remained empty after a Cron boundary/i);
  assert.match(readme, /subdomain setting remains `enabled=true` with `previews_enabled=false`/);
  assert.match(readme, /version-level `has_preview` metadata does not mean the public Preview route is enabled/);
  assert.match(readme, /working frontend now configures the stopped G7 endpoint with `dexcomRouteVerified=false`/);
  assert.match(readme, /GitHub Pages verification remains pending until that frontend change is published/);
  assert.match(readme, /PR #14 merged the comparison frontend to `main` in merge commit `7e96648c27ce20fabe2f283c384124e36ce0b2d2`/);
  assert.match(readme, /GitHub Pages publication was verified on 2026-08-07/);
  assert.match(readme, /G7 Secret names `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`/);
  assert.match(readme, /two G7 values were entered through masked prompts with `wrangler versions secret put`/);
  assert.match(readme, /multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was uploaded and deployed to 100% of production traffic/);
  assert.match(readme, /Both `\/v1\/libre` and `\/v1\/dexcom-g7` return `503 demo_feed_paused`/);
  assert.match(readme, /G7-only Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100%/);
  assert.match(readme, /One scheduled refresh wrote only `public:dexcom-g7:v1`/);
  assert.match(readme, /public `\/v1\/dexcom-g7` response contained 190 entries/);
  assert.match(readme, /stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored at 100% as deployment `8de64190-7558-43c6-83c1-1e29a2cf80de`/i);
  assert.match(readme, /Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was temporarily deployed for one scheduled refresh/);
  assert.match(readme, /19:25 JST Cron produced a public `\/v1\/libre` response containing 523 entries/);
  assert.match(readme, /top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks/);
  assert.match(readme, /G7 remained paused at `503`/);
  assert.match(readme, /next stopped Cron did not extend the Libre snapshot expiration/);
  assert.match(readme, /GitHub Pages browser rendering, simultaneous three-source comparison, repeated refreshes, stale\/fallback\/natural-expiry behavior, and continuing enablement remain unverified/);
  assert.doesNotMatch(readme, /frontend endpoint remains intentionally blank/);
});

test("Trust Pack keeps the project language and medical boundaries", async () => {
  const pages = [trustPackUrl, ...await trustPageUrls()];
  const combined = (await Promise.all(pages.map(read))).join("\n");
  assert.doesNotMatch(combined, /患者/);
  assert.doesNotMatch(combined, /糖尿病管理/);
  assert.match(combined, /医療機器ではありません/);
  assert.match(combined, /GlucoScoreも人の価値や努力を表す点数ではありません/);
});
