import { AdminAccessError, verifyAccessRequest } from "./access-auth.js";
import { readAdminUsage } from "./admin-store.js";
import { readAdminPlusSummary } from "./plus-summary.js";
import {
  groupProfilesByDisplayName,
  readInternalProfileDisplayNames,
} from "./profile-groups.js";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store, private, max-age=0",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  Expires: "0",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function respond(html, status = 200, extraHeaders = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", "text/html; charset=utf-8");
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(html, { status, headers });
}

const STYLE = `
  :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif;background:#f6fbf7;color:#20352a}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#eef8f0,#fff 24rem)}
  main{width:min(72rem,calc(100% - 2rem));margin:auto;padding:max(1.5rem,env(safe-area-inset-top)) 0 max(2.5rem,env(safe-area-inset-bottom))}
  .eyebrow{margin:0 0 .45rem;color:#467557;font-size:.82rem;font-weight:750;letter-spacing:.08em}h1{margin:0;font-size:clamp(1.65rem,5vw,2.4rem);line-height:1.25}h2{margin:0 0 .45rem;font-size:1.12rem}p{line-height:1.75}.lead{max-width:48rem;margin:.8rem 0 0;color:#53675b}
  .card{margin-top:1rem;border:1px solid #dbe9df;border-radius:1rem;background:#fff;box-shadow:0 .45rem 1.4rem rgba(31,77,48,.06)}.notice,.message{padding:1rem 1.1rem}.notice p{margin:.25rem 0 0;color:#53675b}
  .header-row{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.refresh{display:inline-flex;min-height:44px;align-items:center;border:1px solid #bfd7c7;border-radius:999px;padding:.55rem .85rem;background:#fff;color:#28643b;font-weight:700;text-decoration:none;white-space:nowrap}.refresh:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.updated{margin:.5rem 0 0;color:#617568;font-size:.85rem}
  .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-top:1rem}.metric{padding:1rem}.metric span{display:block;color:#617568;font-size:.82rem}.metric strong{display:block;margin-top:.2rem;font-size:1.65rem;font-variant-numeric:tabular-nums}.metric-note{display:block;margin-top:.3rem;color:#617568;font-size:.76rem;line-height:1.45}
  .list-card{padding:1rem}.list-head p{margin:.2rem 0 .5rem;color:#617568;font-size:.9rem}.group-section+.group-section{margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid #e4ede6}.group-section h3{margin:0;font-size:1rem}.groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:.75rem;margin-top:.75rem}.profile-group{border:1px solid #e0ebe3;border-radius:.85rem;padding:.9rem;background:#fbfdfb}.internal-group{background:#fffdf6;border-color:#eadcae}.group-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.65rem}.group-head h4{margin:0;font-size:1rem;overflow-wrap:anywhere}.group-meta{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.35rem}.group-count,.internal-label{display:inline-block;border-radius:999px;padding:.25rem .55rem;font-size:.74rem;font-weight:750;white-space:nowrap}.group-count{background:#edf3ef;color:#52675a}.internal-label{background:#fff0bd;color:#72550e}.profile{padding:.2rem 0}.profile+.profile{margin-top:.55rem;padding-top:.7rem;border-top:1px solid #e1eae3}.device-label{margin:0 0 .35rem;color:#617568;font-size:.76rem;font-weight:750}.profile dl{margin:0}.profile dl div{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.42rem 0;border-top:1px solid #e8efe9}.profile dt{color:#5a6d60;font-size:.82rem}.profile dd{margin:0;font-weight:750;font-variant-numeric:tabular-nums}details summary{cursor:pointer;color:#2d6540;font-weight:750;font-size:.85rem}details summary:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.device-list{margin-top:.55rem}
  .badge{display:inline-block;border-radius:999px;padding:.28rem .62rem;font-size:.78rem;font-weight:750;white-space:nowrap}.on{background:#e3f5e8;color:#23653a}.off{background:#f1f3f1;color:#5d6860}.empty{padding:1rem 0;color:#5d6f63}.footnote{margin-top:1rem;color:#5d6f63;font-size:.88rem}
  @media(max-width:42rem){main{width:min(100% - 1rem,72rem)}.summary{grid-template-columns:1fr;gap:.5rem}.metric{display:grid;grid-template-columns:1fr auto;align-items:center;padding:.8rem 1rem}.metric strong{margin:0;font-size:1.35rem}.metric .metric-note{grid-column:1/-1}}
`;

function shell(title, body) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)} | GlucoScope</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function renderMessage(title, message) {
  return shell(title, `<header><p class="eyebrow">ADMIN ONLY · GLUCOSCOPE 🍀</p><h1>${escapeHtml(title)}</h1></header><section class="card message"><p>${escapeHtml(message)}</p></section>`);
}

function formatJst(nowMs) {
  const date = new Date(nowMs);
  if (Number.isNaN(date.getTime())) return "--";
  return `${new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date)} JST`;
}

function formatJstDate(timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return "未記録";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function renderProfile(profile, position, total) {
  const deviceLabel = total > 1
    ? `<p class="device-label">端末プロフィール ${escapeHtml(position)} / ${escapeHtml(total)}</p>`
    : "";
  return `<div class="profile">${deviceLabel}<dl>
    <div><dt>利用記録</dt><dd><span class="badge ${profile.collectionEnabled ? "on" : "off"}">${profile.collectionEnabled ? "記録中" : "停止中"}</span></dd></div>
    <div><dt>最終利用日</dt><dd>${escapeHtml(formatJstDate(profile.lastSeenAt))}</dd></div>
    <div><dt>利用した日数</dt><dd>${escapeHtml(profile.activeDays)}日</dd></div>
    <div><dt>新しいAI分析</dt><dd>${escapeHtml(profile.aiGenerationSuccessTotal)}回</dd></div>
    <div><dt>グルコの想い出</dt><dd>${escapeHtml(profile.ordinaryGlucoMemoryCount)} / 50</dd></div>
  </dl></div>`;
}

function renderProfileGroup(group) {
  const profiles = group.profiles;
  const profileHtml = profiles
    .map((profile, index) => renderProfile(profile, index + 1, profiles.length))
    .join("");
  const details = profiles.length > 1
    ? `<details><summary>${escapeHtml(profiles.length)}件の端末プロフィールの内訳</summary><div class="device-list">${profileHtml}</div></details>`
    : profileHtml;
  const internalLabel = group.internal
    ? '<span class="internal-label">内部・テスト</span>'
    : "";
  return `<article class="profile-group ${group.internal ? "internal-group" : "external-group"}">
    <div class="group-head"><h4>${escapeHtml(group.displayName)}</h4><div class="group-meta">${internalLabel}<span class="group-count">端末 ${escapeHtml(profiles.length)}件</span></div></div>
    ${details}
  </article>`;
}

function renderGroupSection(title, description, groups, emptyMessage) {
  const cards = groups.map(renderProfileGroup).join("");
  const content = cards
    ? `<div class="groups">${cards}</div>`
    : `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return `<section class="group-section"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${content}</section>`;
}

function countProfiles(groups) {
  return groups.reduce((total, group) => total + group.profiles.length, 0);
}

function renderDashboard(report, plusSummary = {}, nowMs = Date.now(), internalDisplayNames = []) {
  const profiles = Array.isArray(report?.profiles) ? report.profiles : [];
  const { externalGroups, internalGroups } = groupProfilesByDisplayName(profiles, internalDisplayNames);
  const externalProfileCount = countProfiles(externalGroups);
  const internalProfileCount = countProfiles(internalGroups);
  const plusAvailable = plusSummary?.available === true
    && Number.isSafeInteger(plusSummary.activePlusCount)
    && plusSummary.activePlusCount >= 0;
  const plusCount = plusAvailable ? plusSummary.activePlusCount : "--";
  const plusNote = plusAvailable ? "有効な30日パス（内外の紐付けなし）" : "確認できません";
  const externalSection = renderGroupSection(
    "外部利用",
    "内部・テストとして登録した表示名を除いています。人数ではなく、表示名ごとのまとまりです。",
    externalGroups,
    "まだ外部利用の端末プロフィールはありません。",
  );
  const internalSection = renderGroupSection(
    "内部・テスト利用",
    "運営者が登録した表示名だけをまとめています。複数端末の回数は合算せず、内訳として残します。",
    internalGroups,
    "内部・テスト利用として登録された端末プロフィールはありません。",
  );
  const truncated = report?.truncated
    ? '<p class="footnote">安全のため、最近使われた100件までを表示しています。</p>'
    : "";

  return shell("利用者の利用状況", `
    <header><p class="eyebrow">ADMIN ONLY · GLUCOSCOPE 🍀</p><div class="header-row"><div><h1>利用者の利用状況</h1><p class="updated">取得: ${escapeHtml(formatJst(nowMs))}</p></div><a class="refresh" href="/">更新</a></div><p class="lead">GlucoScopeを安心して続け、少しずつよくするために、説明済みの最小限の回数だけを確認します。</p></header>
    <section class="card notice"><h2>外部利用と内部テストを分けて表示します</h2><p>運営用の設定へ登録した表示名だけを「内部・テスト利用」として分け、それ以外を「外部利用」に表示します。</p><p>同じ表示名の端末プロフィールは読みやすく折りたたみますが、人数だとは断定せず、回数も合算しません。接続先URLや合言葉は保存していないため、同じ接続先かどうかも比較しません。</p></section>
    <section class="summary" aria-label="利用状況の概要">
      <article class="card metric"><span>外部の表示名</span><strong>${externalGroups.length}</strong><small class="metric-note">人数ではなく表示名ベース</small></article>
      <article class="card metric"><span>外部の端末プロフィール</span><strong>${externalProfileCount}</strong></article>
      <article class="card metric"><span>内部・テスト</span><strong>${internalGroups.length}</strong><small class="metric-note">端末 ${internalProfileCount}件</small></article>
      <article class="card metric plus-metric"><span>Plus利用中</span><strong>${escapeHtml(plusCount)}</strong><small class="metric-note">${plusNote}</small></article>
    </section>
    <section class="card list-card"><div class="list-head"><h2>表示名ごとの利用状況</h2><p>利用日数は最大90日分です。AI分析は、新しく正常に完了したものだけを数えます。</p></div>${externalSection}${internalSection}</section>
    ${truncated}
    <p class="footnote">最終利用日は時刻を表示せず、日本時間の日付だけを表示します。血糖値、グラフ、AIお手紙の本文、接続情報、プロフィールID、登録日時、日別の記録は表示しません。</p>
    <p class="footnote">Plusは利用中の合計だけを表示します。購入者ごとの情報、メールアドレス、Stripe ID、購入履歴は表示しません。</p>
  `);
}

export async function handleAdminRequest(request, env = {}, services = {}) {
  const verifyAccess = services.verifyAccess || verifyAccessRequest;
  const loadUsage = services.readAdminUsage || readAdminUsage;
  const loadPlusSummary = services.readAdminPlusSummary || readAdminPlusSummary;
  const loadInternalDisplayNames = services.readInternalProfileDisplayNames
    || (() => readInternalProfileDisplayNames(env.INTERNAL_PROFILE_DISPLAY_NAMES));
  try {
    await verifyAccess(request, env);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return respond(renderMessage("管理者専用ページです", "認証を確認できませんでした。"), 403);
    }
    return respond(renderMessage("管理画面を開けません", "少し時間をおいて、もう一度お試しください。"), 503);
  }

  const url = new URL(request.url);
  if (url.pathname !== "/" || url.search) {
    return respond(renderMessage("ページが見つかりません", "URLをご確認ください。"), 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return respond(renderMessage("この操作は使えません", "管理画面を開き直してください。"), 405, { Allow: "GET, HEAD" });
  }
  if (request.method === "HEAD") return respond("");
  try {
    const nowMs = Number(services.now?.() ?? Date.now());
    const internalDisplayNames = loadInternalDisplayNames();
    const [usageReport, plusSummary] = await Promise.all([
      loadUsage(env.USAGE_DB),
      Promise.resolve()
        .then(() => loadPlusSummary(env.PLUS_ADMIN_SUMMARY))
        .catch(() => ({ available: false, activePlusCount: null })),
    ]);
    return respond(renderDashboard(usageReport, plusSummary, nowMs, internalDisplayNames));
  } catch {
    return respond(renderMessage("利用状況を読み込めません", "少し時間をおいて、もう一度お試しください。"), 503);
  }
}

export default { async fetch(request, env) { return handleAdminRequest(request, env); } };

export const adminWorkerTesting = Object.freeze({ escapeHtml, renderDashboard });
