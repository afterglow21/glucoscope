import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";

const indexUrl = new URL("../index.html", import.meta.url);
const trustPackUrl = new URL("../pages/about/trust-pack.html", import.meta.url);
const usageDashboardUrl = new URL("../pages/about/usage-dashboard.html", import.meta.url);
const trustDirUrl = new URL("../pages/trust/", import.meta.url);
const plusSpecUrl = new URL("../docs/Feature_Specs/PLUS_30_DAY_PASS.md", import.meta.url);
const projectBibleUrl = new URL("../docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md", import.meta.url);

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

test("Usage Dashboard separates AI operations from privacy-protected personal-user totals", async () => {
  const [index, dashboard] = await Promise.all([read(indexUrl), read(usageDashboardUrl)]);
  assert.match(index, /AIお手紙が作られた回数と、開発者が負担するAI利用料の目安/);
  assert.doesNotMatch(index, /ページ閲覧の傾向/);
  assert.match(dashboard, /ユーザー版の合計/);
  assert.match(dashboard, /公開デモとユーザー版から新しく作ったAI分析を分けずに数えます/);
  assert.match(dashboard, /前日まで30日間の端末プロフィール、利用日、新しく成功したAI分析、通常のグルコの想い出/);
  assert.match(dashboard, /10件未満では実数を表示しません/);
  assert.match(dashboard, /personalUserUsage\.status === "suppressed"/);
  assert.match(dashboard, /personalUserUsage\.status === "available"/);
  assert.match(dashboard, /公開デモもユーザー版も、この端末に保存したお手紙だけを再表示します/);
  assert.match(dashboard, /sharedCache\.enabled === false[\s\S]*?停止中（先行体験）/);
});

test("Plus 30-day pass records the approved one-time boundary without claiming sale", async () => {
  const spec = await read(plusSpecUrl);
  assert.match(spec, /not available for purchase/);
  assert.match(spec, /価格 \| 300円/);
  assert.match(spec, /自動更新 \| なし/);
  assert.match(spec, /成功した新規AI分析を1日1回/);
  assert.match(spec, /成功した新規AI分析を1日5回まで/);
  assert.match(spec, /文書・品質チェックで止まった/);
  assert.match(spec, /グラフのカスタム期間/);
  assert.match(spec, /認証済みアカウントごとに1回だけ無料体験/);
  assert.match(spec, /利用記録の端末プロフィール、profile ID、token、表示名を、購入者の本人確認やPlus利用権に流用しない/);
  assert.match(spec, /Stripeへ血糖値、グラフ、TIR\/TAR\/TBR/);
  assert.match(spec, /利用権の付与は、成功ページを開いたことではなく、Stripeの署名付きWebhook/);
  assert.match(spec, /Plusは医療サービスではない/);
  assert.doesNotMatch(spec, /販売中|購入できます|自動更新あり/);
  assert.match(spec, /Subscriptionや自動更新を使わない/);
});

test("Plus buyer policy stays complete internally while public pages remain simple", async () => {
  const [spec, privacy, roadmap, bible] = await Promise.all([
    read(plusSpecUrl),
    read(new URL("privacy-notes.html", trustDirUrl)),
    read(new URL("roadmap.html", trustDirUrl)),
    read(projectBibleUrl),
  ]);

  assert.match(spec, /購入とメールを管理する18歳以上の本人/);
  assert.match(spec, /子どもの氏名、生年月日、血糖値、表示名、CGMの種類を保護者確認で集めない/);
  assert.match(spec, /体験を成功した日から90日間だけ/);
  assert.match(spec, /販売前の保持候補は7年/);
  assert.match(bible, /子どものPlusを18歳以上の保護者が管理できる方針/);
  assert.match(bible, /子どもの氏名、生年月日、血糖値、表示名、CGMの種類は集めず/);
  assert.match(bible, /最後の支払いまたは最終解決の遅い方から180日以内/);

  for (const publicPage of [privacy, roadmap]) {
    assert.doesNotMatch(publicPage, /最小会計記録は7年|会計記録の候補は7年/u);
    assert.doesNotMatch(publicPage, /最後の支払いまたは解決から180日/u);
    assert.doesNotMatch(publicPage, /体験した日から90日間だけ/u);
  }
  assert.match(privacy, /Plus 30日パス（まだ販売していません）/);
  assert.match(privacy, /本人利用か保護者管理かを確認した日/);
  assert.match(privacy, /二重決済やPlusが始まらない問題/);
  assert.match(privacy, /GlucoScope側の大きな障害/);
  assert.match(privacy, /If GlucoScope cannot correct a duplicate charge/);
  assert.match(roadmap, /18歳以上の保護者が購入・復旧・問い合わせを管理/);
  assert.match(roadmap, /the approved policy is a full refund after review/);
  assert.match(roadmap, /まだ販売していません/);
});


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
  const developerStatus = await read(new URL("../pages/about/developer-status.html", import.meta.url));
  const readme = await read(new URL("../README.md", import.meta.url));

  assert.match(index, /Nightscoutへの直接接続と、Gluroo限定中継の現在地・安全境界/);
  assert.match(data, /Guardianは、iPhoneのGuardian MonitorからGluroo Global Connect、限定中継、GlucoScopeまでの最初の全経路確認を完了しました/);
  assert.match(data, /Libre 2も、FreeStyle LibreLink、LibreLinkUp、Gluroo、限定中継、GlucoScopeまでの基本経路/);
  assert.match(data, /現在血糖、グラフ、再読み込み、iOSホーム画面からの復帰/);
  assert.match(data, /一般利用者向け限定中継のDexcom G7経路をiPhoneのSafariで確認し、接続、現在血糖、グラフの今日・昨日・7日・30日切替、再読み込み、接続削除後に設定画面へ戻ることまで合格しました/);
  assert.match(data, /Dexcom G7の一般利用者向け限定中継の受け入れは完了しました/);
  assert.match(data, /チケットの自然失効、通常タブでSafariを完全終了した後の保存、実通信での上限到達は運用確認として残します/);
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
  assert.match(privacy, /公開デモには、Kazuma本人が公開に同意した血糖値、更新時刻、矢印だけを使います/);
  assert.match(privacy, /ここに一般利用者のデータは混ざりません/);
  assert.match(privacy, /更新が止まったデータは、最長36時間で消えます/);
  assert.match(privacy, /Nightscoutは、この端末から直接読みます/);
  assert.match(privacy, /GlucoScopeは接続情報や血糖データを保存、記録、AI送信、共有しません/);
  assert.match(privacy, /ログインパスワードを、GlucoScopeへ入力することはありません/);
  assert.match(privacy, /公開デモを見るだけなら、名前は必要ありません/);
  assert.match(privacy, /表示名、使った日、AI分析を使った回数、通常のグルコの想い出の数を記録します/);
  assert.match(privacy, /血糖値、接続情報、AIお手紙の本文は記録しません/);
  assert.match(privacy, /この端末を見分けるランダムな番号、記録のオン・オフ、記録を始めた日と最後に使った日/);
  assert.match(privacy, /画面にまとめた血糖情報をOpenAIへ送ります/);
  assert.match(privacy, /氏名、接続先URL、合言葉、元の血糖データ一覧は送りません/);
  assert.match(privacy, /最初のAI分析の前に、送る内容を画面で確認できます/);
  assert.match(privacy, /AI分析を使わなくても、血糖表示や「いつものグルコのお話」は変わりません/);
  assert.match(privacy, /公開デモもユーザー版も、ほかの人と共有する一時保存には入れません/);
  assert.match(privacy, /安全のための確認記録に、入力と出力が最大30日残る場合があります/);
  assert.match(privacy, /利用状況の記録は、設定からいつでも停止・再開・削除できます/);
  assert.match(privacy, /使った日の記録は90日分まで保存し、90日使われていない端末の記録は削除します/);
  assert.match(privacy, /前日までの30日間に活動した端末プロフィールが10件以上になった時だけ、全体の数を表示します/);
  assert.match(privacy, /overall totals appear only after at least 10 device profiles were active during the 30 completed days through yesterday/);
  assert.match(privacy, /無料プランでは最大7日、有料プランでは最大30日/);
  assert.match(privacy, /up to 7 days on the Free plan or up to 30 days on a Paid plan/);
  assert.match(privacy, /血糖値、接続情報、GlucoScore、AIお手紙の本文はアクセス分析へ送りません/);
  assert.match(privacy, /GlucoScopeは医療機器ではなく、診断や治療、インスリン量の判断はしません/);
  assert.match(privacy, /neither public-demo nor personal-user letters are placed in a shared temporary cache/);
  assert.match(privacy, /abuse-monitoring logs for up to 30 days/);
  assert.doesNotMatch(privacy, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(privacy, /<code>|\b(?:D1|deployment|Version|CORS|Cron|sessionStorage|adapter|RELAY_ENABLED)\b|\b(?:200|204|401|403|503)\b/i);
  assert.match(safety, /接続失敗は、CGMやポンプが止まったことを意味しません/);
  assert.match(support, /Gluroo、Nightscout、Azure、Cloudflare、OpenAI/);
  assert.match(support, /GlucoScopeや限定中継についての質問・不具合報告は、GlurooではなくGlucoScopeが受けます/);
  assert.match(roadmap, /初回告知はまだ実施していません/);
  assert.match(roadmap, /公開3CGM比較ラボは、安全対応と別の継続公開判断を経てライブ公開を開始しました/);
  assert.match(roadmap, /2回の監督下確認ではどちらも接続確認まで成功しましたが/);
  assert.match(roadmap, /既知の試験用プロフィール2件も削除しました/);
  assert.match(roadmap, /D1は <code>0 \/ 0 \/ 0<\/code> のままで利用プロフィールは作成されていません/);
  assert.match(roadmap, /5d160aed-7b27-48e6-b0a8-783534f97b6f/);
  assert.match(roadmap, /a398d59e-54c1-4b8d-a9a4-b779af360a54/);
  assert.match(roadmap, /635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a/);
  assert.match(roadmap, /利用プロフィールの作成・停止・再開・書き出し・削除、一般利用者向け限定中継のG7基本経路、小さなUX修正は完了し、1〜3人の先行体験を開始しました/);
  assert.match(roadmap, /Gluroo（Libre）の接続に成功し、「GlucoScopeを始める」の後も同じ画面にとどまってライブ血糖を表示できました/);
  assert.match(roadmap, /D1は <code>profiles \/ usage_daily \/ event_receipts = 0 \/ 0 \/ 0<\/code> のまま/);
  assert.match(developerStatus, /今使えることと、これから直していくことだけを簡単にお知らせします/);
  assert.match(developerStatus, /公開デモは、登録せずに見ることができます/);
  assert.match(developerStatus, /グルコは、あなたを責めたり、数字で評価したりしません/);
  assert.match(developerStatus, /GlucoScopeは医療機器ではなく、診断や治療、インスリン量の判断はしません/);
  assert.match(developerStatus, /AI分析の失敗を減らし、むずかしい言葉を見直し/);
  assert.doesNotMatch(developerStatus, /href="\.\.\/trust\/roadmap\.html"/);
  assert.doesNotMatch(developerStatus, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(developerStatus, /<code>|\b(?:D1|deployment|Version|CORS|Cron|sessionStorage|adapter|RELAY_ENABLED)\b|\b(?:200|204|401|403|503)\b/i);
  assert.match(roadmap, /管理者ダッシュボードは、管理者1名だけが使える認証付きの読取専用画面として受け入れを完了しました/);
  assert.match(roadmap, /300円の1回払い・30日間・自動更新なし/);
  assert.match(roadmap, /FreeのAIは成功時だけ1日1回、Plusは1日5回まで/);
  assert.match(roadmap, /まだ販売していません/);
  assert.match(roadmap, /機能特典を付けない1回ごとの任意の開発支援とは別/);
  assert.doesNotMatch(roadmap, /管理者ダッシュボードをつくります|今後の利用者別管理者ダッシュボード/);
  assert.match(roadmap, /ユーザー展開を始めた後、横向きグラフだけで本人が選べる常時表示モード/);
  assert.match(roadmap, /現時点の3CGM比較ページは継続公開ライブデモです/);
  assert.match(roadmap, /約3時間の継続稼働を確認/);
  assert.match(roadmap, /これまでの確認は合計2回/);
  assert.match(roadmap, /一般利用者向け限定中継は現在、1〜3人の先行体験に限って有効です/);
  assert.match(roadmap, /1〜3人の先行体験を開始しました。利用状況と安全境界の観察は、次の設計と並行して続けます/);
  assert.match(roadmap, /Safari完全終了後の復元、約1時間後の自然失効、上限到達時の挙動は運用確認として残します/);
  assert.match(roadmap, /今回確認できたのは1回の公開ページ受け入れです。継続運用、複数回のブラウザ表示更新、古いデータ表示・自然失効は未確認/);
  assert.match(roadmap, /21:25 JSTの停止中Cron後も両KVキーの期限は停止後の基準から変わらず、想定した2キーだけでmetadataもありませんでした/);
  assert.match(roadmap, /The public 3CGM Comparison Lab began continuous live publication/);
  assert.match(roadmap, /Live CGM handoff, the usage-profile lifecycle, the general-user G7 basic route, and the small pre-rollout UX corrections are complete/);
  assert.match(roadmap, /The administrator dashboard has completed one-administrator acceptance as an authenticated read-only view/);
  assert.match(roadmap, /JPY 300 as a one-time payment for 30 days, with no automatic renewal/);
  assert.match(roadmap, /Free receives one successful new AI analysis per day/);
  assert.match(roadmap, /Plus is not yet available for purchase/);
  assert.match(roadmap, /Observation of real usage and safety boundaries continues in parallel with the next design task/);
  assert.doesNotMatch(roadmap, /Build the administrator dashboard|future person-level administrator dashboard/);
  assert.match(roadmap, /After user rollout begins, add an opt-in always-on mode only for the landscape graph/);
  assert.match(roadmap, /After the 21:25 JST stopped Cron, both KV expirations were unchanged from the post-stop baseline/);
  assert.match(roadmap, /Libreだけを一時有効にしたVersion `2e72847d-5011-47c5-80e6-8cb931a1b141`/);
  assert.match(roadmap, /19:25 JSTのCronで公開`\/v1\/libre`応答が合計523件/);
  assert.match(roadmap, /次の停止中Cron後もLibreキーの有効期限は延長されませんでした/);
  assert.match(readme, /Guardian route completed its first iPhone Safari acceptance/);
  assert.match(readme, /general-user Dexcom G7 route completed a supervised iPhone Safari acceptance/);
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
