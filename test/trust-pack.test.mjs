import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";

const indexUrl = new URL("../index.html", import.meta.url);
const trustPackUrl = new URL("../pages/about/trust-pack.html", import.meta.url);
const usageDashboardUrl = new URL("../pages/about/usage-dashboard.html", import.meta.url);
const trustDirUrl = new URL("../pages/trust/", import.meta.url);
const plusSpecUrl = new URL("../docs/Feature_Specs/PLUS_30_DAY_PASS.md", import.meta.url);
const projectBibleUrl = new URL("../docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md", import.meta.url);
const relaySpecUrl = new URL("../docs/Feature_Specs/LIMITED_DATA_RELAY.md", import.meta.url);
const dataSourceSpecUrl = new URL("../docs/Feature_Specs/USER_DATA_SOURCE_FOUNDATION.md", import.meta.url);
const relayReadmeUrl = new URL("../workers/gluco-data-relay/README.md", import.meta.url);

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
  assert.match(dashboard, /公開デモは内容を確認した固定サンプルを表示するため、新しいAI生成には含まれません/);
  assert.match(dashboard, /Freeでは端末プロフィールごとに1日1回、Plusでは確認済みアカウントごとに1日5回まで/);
  assert.match(dashboard, /全員で共有する朝・昼・夜10回、1日30回の回数上限は使いません/);
  assert.match(dashboard, /sharedCountLimitsEnabled = guard\.sharedCountLimitsEnabled !== false/);
  assert.match(dashboard, /前日まで30日間の端末プロフィール、利用日、新しく成功したAI分析、通常のグルコの想い出/);
  assert.match(dashboard, /10件未満では実数を表示しません/);
  assert.match(dashboard, /personalUserUsage\.status === "suppressed"/);
  assert.match(dashboard, /personalUserUsage\.status === "available"/);
  assert.match(dashboard, /公開デモもユーザー版も、この端末に保存したお手紙だけを再表示します/);
  assert.match(dashboard, /sharedCache\.enabled === false[\s\S]*?停止中（先行体験）/);
});

test("Plus 30-day pass records the approved one-time boundary and live release", async () => {
  const spec = await read(plusSpecUrl);
  assert.match(spec, /Status: live small public release/);
  assert.match(spec, /販売開始 \| 2026年8月20日。小規模な一般提供として開始/);
  assert.match(spec, /価格 \| 400円/);
  assert.match(spec, /自動更新 \| なし/);
  assert.match(spec, /成功した「やさしい分析」を1日1回/);
  assert.match(spec, /やさしい分析としっかり分析を合わせて成功した新規分析を1日5回まで/);
  assert.match(spec, /文書・品質チェックで止まった/);
  assert.match(spec, /グラフの7日・30日・カスタム期間/);
  assert.match(spec, /認証済みアカウントごとに1回だけ無料体験/);
  assert.match(spec, /2026年8月20日に本番の毎時cleanupを `0 \* \* \* \*` で有効化した/);
  assert.match(spec, /The small public release is live/);
  assert.match(spec, /利用記録の端末プロフィール、profile ID、token、表示名を、購入者の本人確認やPlus利用権に流用しない/);
  assert.match(spec, /Stripeへ血糖値、グラフ、TIR\/TAR\/TBR/);
  assert.match(spec, /利用権の付与は、成功ページを開いたことではなく、Stripeの署名付きWebhook/);
  assert.match(spec, /Plusは医療サービスではない/);
  assert.doesNotMatch(spec, /自動更新あり/);
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
  assert.match(spec, /取引または最終返金から7年保持する/);
  assert.match(spec, /確認メールの送信候補はResend Free/);
  assert.match(spec, /通常の送信記録とメール本文は最長30日保持される/);
  assert.match(spec, /運営者が手動で削除するまで、30日を超えて残る場合がある/);
  assert.match(spec, /毎時cleanupで削除する/);
  assert.match(spec, /request-codeは5回\/60秒、verifyは30回\/60秒/);
  assert.match(bible, /子どものPlusを18歳以上の保護者が管理できる方針/);
  assert.match(bible, /子どもの氏名、生年月日、血糖値、表示名、CGMの種類は集めず/);
  assert.match(bible, /取引または最終返金から7年保持します/);
  assert.match(bible, /解決済みの通常サポートメールは解決後180日を目安に削除し/);
  assert.match(bible, /原因を確認・解決した後に運営者が手動で削除するまで、30日を超えて残る場合があります/);

  assert.match(privacy, /最小会計記録だけを、取引または最終返金から7年残します/);
  assert.match(privacy, /解決済みの通常問い合わせは解決後180日を目安に削除します/);
  assert.doesNotMatch(roadmap, /最小会計記録は7年|会計記録の候補は7年/u);
  assert.match(privacy, /<h2>Plus 30日パス<\/h2>/);
  assert.match(privacy, /本人利用か保護者管理かを確認した日/);
  assert.match(privacy, /二重決済やPlusが始まらない問題/);
  assert.match(privacy, /GlucoScope側の大きな障害/);
  assert.match(privacy, /Resendというメール送信サービス/);
  assert.match(privacy, /10分で使えなくなる6桁の確認コード、コードの入力方法を伝える短い案内/);
  assert.match(privacy, /通常の送信記録とメール本文が最長30日保存されます/);
  assert.match(privacy, /それより長く送信停止リストに残ることがあります/);
  assert.match(privacy, /ordinary sending records and the message body for up to 30 days/);
  assert.match(privacy, /may remain longer on a send-block list/);
  assert.match(privacy, /コードが使えなくなってからおおむね1日で削除します/);
  assert.match(privacy, /メールを送ろうとした回数の記録も、おおむね1日で削除します/);
  assert.match(privacy, /この確認に使うIPアドレスを、GlucoScopeのデータベースやログへ保存しません/);
  assert.match(privacy, /temporary verification-code records are deleted about one day/);
  assert.match(privacy, /does not save the IP address used for this check in its database or logs/);
  assert.match(privacy, /無料体験を最後まで使った後に削除した時だけ[\s\S]*体験成功日から90日間残します/);
  assert.match(privacy, /メールアドレス、血糖値、表示名、CGM情報、AI本文、作成画像、購入情報はこの記録へ入れません/);
  assert.match(privacy, /Only after a completed trial[\s\S]*for 90 days from completion/);
  assert.match(privacy, /contains no email address, glucose value, display name, CGM detail, AI content, generated image, or purchase information/);
  assert.match(privacy, /通常の画面からは消えますが、Cloudflareの復旧用バックアップには、無料プランで最大7日、有料プランで最大30日/);
  assert.match(privacy, /They disappear from normal screens, but Cloudflare recovery backups may retain them for up to 7 days on the Free plan or up to 30 days on a Paid plan/);
  assert.doesNotMatch(privacy, /宛先と内容が最長30日保存されます|keep the destination and message content for up to 30 days/u);
  assert.match(privacy, /メールを開いたか、リンクを押したかを調べる追跡は使いません/);
  assert.match(privacy, /If GlucoScope cannot correct a duplicate charge/);
  assert.match(roadmap, /18歳以上の保護者が、購入、別の端末で使うための確認、問い合わせを管理/);
  assert.match(roadmap, /This is not a refund-for-any-reason policy/);
  assert.doesNotMatch(roadmap, /まだ販売していません/);
});

test("Roadmap stays simple for users while technical evidence stays internal", async () => {
  const roadmap = await read(new URL("roadmap.html", trustDirUrl));

  assert.match(roadmap, /これからどんな順番で育っていくかを、やさしい言葉でお知らせします/);
  assert.match(roadmap, /今できること/);
  assert.match(roadmap, /いま良くしていること/);
  assert.match(roadmap, /これから/);
  assert.match(roadmap, /<h2>Plus 30日パス<\/h2>/);
  assert.match(roadmap, /変わらない約束/);
  assert.match(roadmap, /登録せずに公開デモと3種類の血糖測定機器（CGM）を見比べるページを開けます/);
  assert.match(roadmap, /利用記録やAI分析で問題が起きても、血糖値やグラフの表示は続けられる/);
  assert.match(roadmap, /400円の1回払いで30日間使えます。自動更新はありません/);
  assert.match(roadmap, /Freeでは、成功した新しい「やさしい分析」を端末プロフィールごとに1日1回/);
  assert.match(roadmap, /公開デモは内容を確認した固定サンプルを表示し、新しいAI生成を使いません/);
  assert.match(roadmap, /文書の確認などで失敗した回は数えません/);
  assert.match(roadmap, /グラフの7日・30日・カスタム期間とShare StudioはPlus特典/);
  assert.match(roadmap, /確認済みの利用者ごとに1回だけ無料で試せます/);
  assert.match(roadmap, /この保護者確認のために、子どもの名前や血糖値は集めません/);
  assert.match(roadmap, /確認メールにはResendというメール送信サービスを使います/);
  assert.match(roadmap, /10分で使えなくなる6桁の確認コード、コードの入力方法を伝える短い案内/);
  assert.match(roadmap, /本番環境で、受信、同じメールでの復旧、古い端末の確認を無効にすること、新しい端末で使えること、アカウント削除まで確認しました/);
  assert.match(roadmap, /60秒待ってからの安全な再送、最新メールだけを使う案内、失敗した再送で先のコードを失わない仕組み/);
  assert.match(roadmap, /GlucoScopeをよくするため、表示名、利用した日/);
  assert.match(roadmap, /血糖値、接続情報、AIお手紙の内容は記録しません/);
  assert.match(roadmap, /GlucoScopeは医療機器ではなく、診断、治療、インスリン量の判断をしません/);

  assert.match(roadmap, /Available now/);
  assert.match(roadmap, /Improving now/);
  assert.match(roadmap, /Coming next/);
  assert.match(roadmap, /<h2>Plus 30-day pass<\/h2>/);
  assert.match(roadmap, /What will not change/);
  assert.match(roadmap, /Free includes one successful gentle analysis per day for each device profile/);
  assert.match(roadmap, /The 7-day, 30-day, and custom graph ranges and continued Share Studio use are Plus benefits/);
  assert.match(roadmap, /public demo displays a reviewed fixed sample without a new AI generation/);
  assert.match(roadmap, /an adult guardian age 18 or older/);
  assert.match(roadmap, /Plus is a one-time JPY 400 payment for 30 days, with no automatic renewal/);
  assert.match(roadmap, /Production acceptance confirmed inbox delivery, same-email recovery, rejection of the old session, continued access through the new session, and account deletion/);
  assert.match(roadmap, /To improve GlucoScope, we record a display name/);
  assert.doesNotMatch(roadmap, /Usage records contain only/);

  assert.doesNotMatch(roadmap, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(roadmap, /<code>|\b(?:D1|deployment|Version|CORS|Cron|sessionStorage|adapter|RELAY_ENABLED|KV)\b|\b(?:200|204|401|403|503)\b/i);
  assert.doesNotMatch(roadmap, /Phase [A-E]|現在の技術課題|historical checkpoint|過去のチェックポイント/i);
});

test("long-lived relay session is documented consistently without exposing technical copy to users", async () => {
  const [privacy, roadmap, relaySpec, dataSourceSpec, relayReadme, bible] = await Promise.all([
    read(new URL("privacy-notes.html", trustDirUrl)),
    read(new URL("roadmap.html", trustDirUrl)),
    read(relaySpecUrl),
    read(dataSourceSpecUrl),
    read(relayReadmeUrl),
    read(projectBibleUrl),
  ]);

  for (const internal of [relaySpec, dataSourceSpec, relayReadme, bible]) {
    assert.match(internal, /__Host-glucoscope_relay_session/);
    assert.match(internal, /Secure/);
    assert.match(internal, /HttpOnly/);
    assert.match(internal, /SameSite=Strict/);
    assert.match(internal, /180 days|180日/);
    assert.match(internal, /HMAC/);
    assert.match(internal, /https:\/\/glucoscope\.app/);
    assert.match(internal, /https:\/\/relay\.glucoscope\.app/);
  }

  assert.match(relaySpec, /current live Version 22 is `b4b2064d-6dd4-4de6-8a68-3d0d39aea2ec` at 100%/);
  assert.match(relaySpec, /stopped rollback Version 23 is `10d0a825-c098-462e-89fd-a69937c47a9b`/);
  assert.match(relaySpec, /Versions 20 and earlier are prohibited direct rollback targets/);
  assert.match(relaySpec, /raw session token, raw Gluroo URL, credential, glucose data, display name,[\s\S]*email address, IP address, or User-Agent/);
  assert.match(relaySpec, /not[\s\S]*joined to the optional Usage profile or Plus identity/);
  assert.match(relaySpec, /first removes the locally saved[\s\S]*The local deletion must not wait for or depend on that network request/);
  assert.match(relayReadme, /no legacy `\/v1\/session` endpoint/);
  assert.match(relayReadme, /historical ticket Version is not a compatible rollback target/);
  assert.match(relayReadme, /A failed replacement leaves the existing working session intact/);
  assert.doesNotMatch(relayReadme.match(/## Required Secret bindings[\s\S]*?## Local verification/)?.[0] || "", /RELAY_TICKET_SECRET/);

  assert.match(privacy, /次からもつながるための安全確認/);
  assert.match(privacy, /少人数の先行体験で使っています/);
  assert.match(privacy, /Dexcom G7では、最初の安全確認後にiPhoneのホーム画面のアイコンから開き直しても、接続し直さず表示できることを確認しました/);
  assert.match(privacy, /180日使わなければ、その印は使えなくなります/);
  assert.match(privacy, /元の接続先URL、合言葉、血糖データ、氏名、メールアドレス、IPアドレス、端末やブラウザの名前は保存しません/);
  assert.match(privacy, /利用状況の記録やPlusの本人確認とも結びつけません/);
  assert.match(privacy, /接続先URLと合言葉を先に消し/);
  assert.match(privacy, /削除が終わる正確な時刻は約束しません/);
  assert.match(privacy, /まずSafariでGlucoScopeを開いて「ホーム画面に追加」し、追加したアイコンから開いて初回接続/);
  assert.match(privacy, /This design is live for the small early-access group/);
  assert.match(privacy, /The relay keeps only a one-way form of the device marker/);
  assert.match(privacy, /not joined to optional usage recording or Plus identity/);
  assert.match(privacy, /removes the URL and passphrase from the device first/);
  assert.match(privacy, /does not promise an exact physical-deletion time/);
  assert.match(privacy, /first open GlucoScope in Safari and choose Add to Home Screen/);
  assert.doesNotMatch(privacy, /180日後までに消えます|disappears no later than 180 days/);
  assert.doesNotMatch(privacy, /__Host-glucoscope|HttpOnly|SameSite|HMAC|Durable Object/);

  assert.match(roadmap, /少人数の先行体験で使っています/);
  assert.match(roadmap, /180日使わなければ接続は切れ/);
  assert.match(roadmap, /まずSafariからホーム画面に追加し、そのアイコンを開いてから初回接続/);
  assert.match(roadmap, /is now live for the small early-access group/);
  assert.match(roadmap, /add GlucoScope to the Home Screen from Safari, open the new icon, and then make the first connection/);
  assert.doesNotMatch(privacy, /準備中|not been published to the live site yet/);
  assert.doesNotMatch(roadmap, /この変更はまだ公開していません|This change is not live yet/);
  assert.doesNotMatch(roadmap, /__Host-glucoscope|HttpOnly|SameSite|HMAC|Durable Object/);
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
  const developerStatus = await read(new URL("../pages/about/developer-status.html", import.meta.url));
  const readme = await read(new URL("../README.md", import.meta.url));

  assert.match(index, /Nightscoutへの直接接続と、Gluroo限定中継の現在地・安全境界/);
  assert.match(data, /GuardianとLibre 2は、アプリからGluroo、限定中継、GlucoScopeまでの基本経路を実機で確認しました/);
  assert.match(data, /Dexcom G7は、接続、現在血糖、今日・昨日・7日・30日のグラフ、再読み込み、接続削除/);
  assert.match(data, /現在の端末セッション方式でiPhoneのホーム画面から開き直しても再接続せず表示できることを確認しています/);
  assert.match(data, /現在は、最初に1回安全確認をした後、ふだんは同じ端末でつながり続ける方式を少人数の先行体験で使っています/);
  assert.match(data, /入力ミスや一時的な障害では今までの接続を壊さない設計です/);
  assert.match(data, /Dexcom G7で最初の安全確認を行い、その後iPhoneのホーム画面のアイコンから開き直しても、接続し直さず表示できることを実機で確認しました/);
  assert.match(data, /The small early-access group now uses a replacement that performs one safety check and then normally keeps the same device connected/);
  assert.match(data, /Connection deletion and reconnection after deletion were not tested in that run/);
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
  assert.match(developerStatus, /今使えることと、これから直していくことだけを簡単にお知らせします/);
  assert.match(developerStatus, /公開デモは、登録せずに見ることができます/);
  assert.match(developerStatus, /グルコは、あなたを責めたり、数字で評価したりしません/);
  assert.match(developerStatus, /GlucoScopeは医療機器ではなく、診断や治療、インスリン量の判断はしません/);
  assert.match(developerStatus, /AI分析の失敗を減らし、むずかしい言葉を見直し/);
  assert.doesNotMatch(developerStatus, /href="\.\.\/trust\/roadmap\.html"/);
  assert.doesNotMatch(developerStatus, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(developerStatus, /<code>|\b(?:D1|deployment|Version|CORS|Cron|sessionStorage|adapter|RELAY_ENABLED)\b|\b(?:200|204|401|403|503)\b/i);
  assert.match(readme, /Guardian route completed its first iPhone Safari acceptance/);
  assert.match(readme, /general-user Dexcom G7 route completed a supervised iPhone Safari acceptance/);
  assert.match(readme, /Current device-session checkpoint: the frontend uses only `relay\.glucoscope\.app`/);
  assert.match(readme, /current live Version 22 is `b4b2064d-6dd4-4de6-8a68-3d0d39aea2ec` at 100%/);
  assert.match(readme, /stopped rollback Version 23 is `10d0a825-c098-462e-89fd-a69937c47a9b`/);
  assert.match(readme, /`RELAY_ENABLED=false`, `RELAY_DEVICE_SESSIONS_ENABLED=false`, `workers_dev=false`, Preview URLs off, and observability off/);
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
  assert.match(readme, /Current new-origin Version `97b14023-f9dd-440a-8b79-e2bb2b471697` receives 100% of traffic/);
  assert.match(readme, /deployment `e96fb11c-a2e0-4097-b54c-a1d638bbffc8` record the earlier three-source acceptance at 22:10:05 JST/);
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
