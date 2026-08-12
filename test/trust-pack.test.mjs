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
  assert.match(data, /Kazumaは自分自身のLibreとG7の血糖値・測定更新時刻の公開へ別々に明示同意しました/);
  assert.match(data, /一般利用者の接続情報や血糖データを保存しません/);
  assert.match(data, /現在はGuardian・Libre・G7を継続公開中です/);
  assert.match(data, /停止中のG7接続先は`dexcomRouteVerified=false`のままGitHub Pagesへ反映し、合成データへの切替を確認済みです/);
  assert.match(data, /deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8`で同じ確認済みライブVersionを100%へ反映しました/);
  assert.match(data, /このG7単独確認時点では、G7ライブ表示、3機種同時ライブ比較、ページ全体のライブ経路、複数回の定期更新と一般利用者向け限定中継のG7経路は未確認でした/);
  assert.match(data, /この公開・非匿名の選択はKazuma自身のデモデータだけに適用します/);
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
  assert.match(data, /このG7単独確認時点では[^。]*複数回の定期更新と一般利用者向け限定中継のG7経路は未確認でした/);
  assert.match(data, /Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567`をdeployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57`として20:58:02 JST/);
  assert.match(data, /公開応答はLibre 527件、G7 276件/);
  assert.match(data, /許可した項目、型、範囲、時系列順、更新の新しさ、CORS境界を満たしました/);
  assert.match(data, /GitHub PagesではGuardian・Libre・G7の3つのライブカードを確認し、利用者自身も3本のグラフを目視しました/);
  assert.match(data, /目視確認を待つ間に複数の定期実行が行われ、両KVキーの期限は21:15頃まで進みました/);
  assert.match(data, /21:16:31 JST、deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4`で停止Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`へ100%戻し/);
  assert.match(data, /両経路の`503`と、新しく開いた公開ページが「準備中・合成データ」へ戻ることを確認しました/);
  assert.match(data, /21:25 JSTの停止中Cron後も両KVキーの期限は停止後の基準から変わらず、想定した2キーだけでmetadataもありませんでした/);
  assert.match(data, /`dexcomRouteVerified=true`はフロント側の表示ゲートで、Workerの有効化ではありません/);
  assert.match(data, /今回確認できたのは1回の公開ページ受け入れです。継続運用、複数回のブラウザ表示更新、古いデータ表示・自然失効は未確認/);
  assert.match(data, /一般利用者向け限定中継も停止中です/);
  assert.match(data, /live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` enabled Libre and G7 together in deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST/);
  assert.match(data, /public responses contained 527 Libre entries and 276 G7 entries/);
  assert.match(data, /user visually confirmed three graph lines/);
  assert.match(data, /After the 21:25 JST stopped Cron, both KV expirations were unchanged from the post-stop baseline; only the two expected keys remained and neither had metadata/);
  assert.match(data, /This completes one public-page acceptance; continuing operation, repeated browser-display refreshes, stale display, and natural expiry remain unverified/);
  assert.match(data, /About three hours of continuous operation passed/);
  assert.match(data, /one further five-minute auto-refresh, bringing the total confirmed browser refreshes to two/);
  assert.match(data, /Scheduled aggregate checks observed Libre\/G7 counts of 528\/290 and then 526\/290/);
  assert.match(data, /Natural expiry is a separate, non-blocking stopped\/failure-path check/);
  assert.match(data, /次の3段落は、一時確認後に停止へ戻した過去のチェックポイントです/);
  assert.match(privacy, /限定中継は現在停止中です/);
  assert.match(privacy, /明示的な同意がない限り、限定中継への通信を始めません/);
  assert.match(privacy, /Kazuma自身の公開比較データ/);
  assert.match(privacy, /公開URLから閲覧できる公開・非匿名データ/);
  assert.match(privacy, /一般利用者の接続情報や血糖データをデモ用WorkerやKVへ保存・公開しません/);
  assert.match(privacy, /KVは最長36時間で期限切れ/);
  assert.match(privacy, /残ったキーは停止中の経路から配信せず、既存の最長36時間TTLで失効します/);
  assert.match(privacy, /KVの生データは直接読み出していません/);
  assert.match(privacy, /停止中のG7接続先は`dexcomRouteVerified=false`のままGitHub Pagesへ反映し、合成データへの切替を確認済みです/);
  assert.match(privacy, /G7ライブ表示、3機種同時ライブ比較、ページ全体のライブ経路/);
  assert.match(privacy, /Libreだけを一時有効にしたVersion `2e72847d-5011-47c5-80e6-8cb931a1b141`/);
  assert.match(privacy, /19:25 JSTのCronで公開`\/v1\/libre`応答が合計523件/);
  assert.match(privacy, /次の停止中Cron後もLibreキーの有効期限は延長されませんでした/);
  assert.match(privacy, /このG7単独確認時点では[^。]*複数回の定期更新と一般利用者向け限定中継のG7経路は未確認でした/);
  assert.match(privacy, /Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567`をdeployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57`として20:58:02 JST/);
  assert.match(privacy, /公開応答はLibre 527件、G7 276件/);
  assert.match(privacy, /GitHub PagesではGuardian・Libre・G7の3つのライブカードを確認し、利用者自身も3本のグラフを目視しました/);
  assert.match(privacy, /deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4`で停止Version `9994a142-a4ca-4885-9077-952ec8e7e8d2`へ100%戻し/);
  assert.match(privacy, /21:25 JSTの停止中Cron後も両KVキーの期限は停止後の基準から変わらず、想定した2キーだけでmetadataもありませんでした/);
  assert.match(privacy, /KVの値そのものは直接読み出していません/);
  assert.match(privacy, /今回確認できたのは1回の公開ページ受け入れです。継続運用、複数回のブラウザ表示更新、古いデータ表示・自然失効は未確認/);
  assert.match(privacy, /live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` enabled Libre and G7 together in deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST/);
  assert.match(privacy, /a newly opened page returned to the clearly labelled synthetic dataset/);
  assert.match(privacy, /After the 21:25 JST stopped Cron, both KV expirations were unchanged from the post-stop baseline/);
  assert.match(privacy, /The raw KV values were not read directly/);
  assert.match(privacy, /Two aggregate checks observed Libre\/G7 counts of 528\/290 and then 526\/290/);
  assert.match(privacy, /Natural expiry remains a separate, non-blocking stopped\/failure-path check/);
  assert.match(privacy, /The next three paragraphs are historical checkpoints/);
  assert.match(privacy, /ユーザー版は、前の項目のとおり現在送信しません/);
  assert.match(privacy, /表示名と基本的な利用回数を、GlucoScopeをよくするために記録します。血糖値や接続情報は記録しません。/);
  assert.match(privacy, /ランダムなprofile ID、利用記録の状態、説明版、作成・更新・最終利用日時/);
  assert.match(privacy, /Freeプランでは最長7日、Paidプランでは最長30日/);
  assert.match(privacy, /停止または削除を押した端末では先に新しい送信を止め/);
  assert.match(privacy, /up to 7 days on the Free plan or up to 30 days on a Paid plan/);
  assert.match(privacy, /The 2 known test profiles left at that checkpoint were later deleted/);
  assert.match(privacy, /event_receipts<\/code> at <code>0 \/ 0 \/ 0<\/code>/);
  assert.match(privacy, /7cb71965-74c3-47f9-b589-75cf6d669edb/);
  assert.match(privacy, /25be2258-b72a-4e2c-8bf1-ab47781c48dc/);
  assert.match(privacy, /5d160aed-7b27-48e6-b0a8-783534f97b6f/);
  assert.match(privacy, /USAGE_COLLECTION_ENABLED=true/);
  assert.match(privacy, /403 turnstile_failed/);
  assert.match(privacy, /公開デモを見るだけなら、名前の入力も利用プロフィールの作成もありません/);
  assert.match(safety, /接続失敗は、CGMやポンプが止まったことを意味しません/);
  assert.match(support, /Gluroo、Nightscout、Azure、Cloudflare、OpenAI/);
  assert.match(support, /GlucoScopeや限定中継についての質問・不具合報告は、GlurooではなくGlucoScopeが受けます/);
  assert.match(roadmap, /初回告知はまだ実施していません/);
  assert.match(roadmap, /公開3CGM比較ラボは、安全対応と別の継続公開判断を経てライブ公開を開始しました/);
  assert.match(roadmap, /再コールバック防止と簡素な画面を監督下一時確認で有効にし/);
  assert.match(roadmap, /既知の試験用プロフィール2件は削除し/);
  assert.match(roadmap, /D1は引き続き <code>0 \/ 0 \/ 0<\/code>/);
  assert.match(roadmap, /5d160aed-7b27-48e6-b0a8-783534f97b6f/);
  assert.match(roadmap, /管理者ダッシュボードをつくります/);
  assert.match(roadmap, /Plus 30日パスと、任意の開発支援への分かりやすい導線/);
  assert.match(roadmap, /ユーザー展開を始めた後、横向きグラフだけで本人が選べる常時表示モード/);
  assert.match(roadmap, /現時点の3CGM比較ページは継続公開ライブデモです/);
  assert.match(roadmap, /約3時間の継続稼働を確認/);
  assert.match(roadmap, /これまでの確認は合計2回/);
  assert.match(roadmap, /一般利用者向け限定中継は、別の展開判断まで停止状態を保ちます/);
  assert.match(roadmap, /期間別・期限切れ・削除・上限の残りの受け入れ確認は、再開を判断する場合に別途扱います/);
  assert.match(roadmap, /今回確認できたのは1回の公開ページ受け入れです。継続運用、複数回のブラウザ表示更新、古いデータ表示・自然失効は未確認/);
  assert.match(roadmap, /21:25 JSTの停止中Cron後も両KVキーの期限は停止後の基準から変わらず、想定した2キーだけでmetadataもありませんでした/);
  assert.match(roadmap, /The public 3CGM Comparison Lab began continuous live publication/);
  assert.match(roadmap, /The callback guard and simplified screen are enabled for supervised temporary acceptance/);
  assert.match(roadmap, /After user rollout begins, add an opt-in always-on mode only for the landscape graph/);
  assert.match(roadmap, /After the 21:25 JST stopped Cron, both KV expirations were unchanged from the post-stop baseline/);
  assert.match(roadmap, /Libreだけを一時有効にしたVersion `2e72847d-5011-47c5-80e6-8cb931a1b141`/);
  assert.match(roadmap, /19:25 JSTのCronで公開`\/v1\/libre`応答が合計523件/);
  assert.match(roadmap, /次の停止中Cron後もLibreキーの有効期限は延長されませんでした/);
  assert.match(readme, /Guardian route completed its first iPhone Safari acceptance/);
  assert.match(readme, /Extended period, expiry, deletion, and limit checks remain/);
  assert.match(readme, /approved `workers\.dev` target is fixed in the checked-in frontend/);
  assert.match(readme, /`preview_urls=false`, `observability\.enabled=false`, and the checked-in `RELAY_ENABLED=false`/);
  assert.match(readme, /comparison lab is now a continuous public live demo/);
  assert.match(readme, /public-demo Worker first completed source-specific G7 and Libre checks, then one approved Guardian\/Libre\/G7 public-page acceptance/);
  assert.match(readme, /global `DEMO_FEED_ENABLED=false`, source gates `DEMO_LIBRE_FEED_ENABLED=false` and `DEMO_G7_FEED_ENABLED=false`/);
  assert.match(readme, /stopped `glucoscope-demo-feed` Worker was deployed as Version/);
  assert.match(readme, /approved-origin G7 preflight returned `204`/);
  assert.match(readme, /registered exactly the existing Libre `GLUROO_DEMO_SOURCE_URL` and `GLUROO_DEMO_API_SECRET` as Cloudflare Secrets/);
  assert.match(readme, /deployed to 100% of production traffic with all three gates still `false`/);
  assert.match(readme, /At that checkpoint,[^.]*the dedicated KV remained empty after a Cron boundary/);
  assert.match(readme, /subdomain setting remains `enabled=true` with `previews_enabled=false`/);
  assert.match(readme, /version-level `has_preview` metadata does not mean the public Preview route is enabled/);
  assert.match(readme, /published frontend keeps `dexcomRouteVerified=true` because the G7 display path passed; this frontend flag does not enable either Worker route/);
  assert.match(readme, /live Version `4069bca4-e8cf-474a-9e9d-d7ffa42b7567` was deployed at 100% as deployment `9738343a-fc1d-4f02-aff1-1bae3d7cbe57` at 20:58:02 JST/);
  assert.match(readme, /sanitized public responses contained 527 Libre entries and 276 G7 entries/);
  assert.match(readme, /Kazuma visually confirmed the three plotted lines/);
  assert.match(readme, /G7 Secret names `GLUROO_DEMO_G7_SOURCE_URL` and `GLUROO_DEMO_G7_API_SECRET`/);
  assert.match(readme, /two G7 values were entered through masked prompts with `wrangler versions secret put`/);
  assert.match(readme, /multi-source Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was uploaded and deployed to 100% of production traffic/);
  assert.match(readme, /both source routes returned `503 demo_feed_paused`/i);
  assert.match(readme, /G7-only Version `3b796eb5-11be-466f-83ea-7710279f49c1` was deployed at 100%/);
  assert.match(readme, /One scheduled refresh wrote only `public:dexcom-g7:v1`/);
  assert.match(readme, /public `\/v1\/dexcom-g7` response contained 190 entries/);
  assert.match(readme, /stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was then restored at 100% as deployment `8de64190-7558-43c6-83c1-1e29a2cf80de`/i);
  assert.match(readme, /Libre-only Version `2e72847d-5011-47c5-80e6-8cb931a1b141` was temporarily deployed for one scheduled refresh/);
  assert.match(readme, /19:25 JST Cron produced a public `\/v1\/libre` response containing 523 entries/);
  assert.match(readme, /top-level schema, entry-field allowlist, type, range, chronological-order, recency, private-marker, and CORS checks/);
  assert.match(readme, /G7 remained paused at `503`/);
  assert.match(readme, /next stopped Cron did not extend the Libre snapshot expiration/);
  assert.match(readme, /Stopped Version `9994a142-a4ca-4885-9077-952ec8e7e8d2` was restored at 100% as deployment `e45b6547-33a4-4196-9efe-1fffd412bcd4` at 21:16:31 JST/);
  assert.match(readme, /After the 21:25 JST stopped Cron, metadata showed only the two expected source keys, no metadata payload, and unchanged expirations for both keys/);
  assert.match(readme, /At that checkpoint this was one public-page acceptance; continued operation, repeated browser display refreshes, stale behavior, and natural expiry were still unverified/);
  assert.match(readme, /deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` at 22:10:05 JST/);
  assert.match(readme, /second scheduled aggregate check observed 526 Libre entries and 290 G7 entries/);
  assert.match(readme, /Libre displayed-point aggregate changing from 526 to 525/);
  assert.match(readme, /one further five-minute auto-refresh at a later checkpoint, bringing the total confirmed browser refreshes to two/);
  assert.match(readme, /natural expiry is now a separate, non-blocking stopped\/failure-path test/i);
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
