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
  const readme = await read(new URL("../README.md", import.meta.url));

  assert.match(index, /Nightscoutへの直接接続と、Gluroo限定中継の現在地・安全境界/);
  assert.match(data, /Guardianは、iPhoneのGuardian MonitorからGluroo Global Connect、限定中継、GlucoScopeまでの最初の全経路確認を完了しました/);
  assert.match(data, /現在血糖とグラフの表示、再読み込み後の再表示/);
  assert.match(data, /期間別・期限切れ・削除・上限の追加確認は残っており/);
  assert.match(data, /確認が終わっていないLibre・Dexcomなどのルートは、確認済みとは案内しません/);
  assert.match(data, /2026年8月6日、Glurooから/);
  assert.match(data, /医療相談や医療判断には使えません/);
  assert.match(data, /CGMデータ再共有が適法かどうかをGlucoScopeが判断するものではなく/);
  assert.match(data, /有料Nightscoutサービスの「無料代替」/);
  assert.match(data, /将来はサブスクリプション/);
  assert.match(data, /GlucoScopeや限定中継への質問は、GlurooではなくGlucoScopeが受けます/);
  assert.match(privacy, /限定中継は現在停止中です/);
  assert.match(privacy, /明示的な同意がない限り、限定中継への通信を始めません/);
  assert.match(privacy, /ユーザー版は、前の項目のとおり現在送信しません/);
  assert.match(safety, /接続失敗は、CGMやポンプが止まったことを意味しません/);
  assert.match(support, /Gluroo、Nightscout、Azure、Cloudflare、OpenAI/);
  assert.match(support, /GlucoScopeや限定中継についての質問・不具合報告は、GlurooではなくGlucoScopeが受けます/);
  assert.match(readme, /Guardian route completed its first iPhone Safari acceptance/);
  assert.match(readme, /Extended period, expiry, deletion, and limit checks remain/);
  assert.match(readme, /approved `workers\.dev` target is fixed in the checked-in frontend/);
  assert.match(readme, /`preview_urls=false`, `observability\.enabled=false`, and the checked-in `RELAY_ENABLED=false`/);
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
