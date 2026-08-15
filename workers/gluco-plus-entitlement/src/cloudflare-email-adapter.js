import { normalizeEmailAddress } from "./account-auth-crypto.js";

const VERIFICATION_CODE_PATTERN = /^\d{6}$/u;
const CONTACT_ROLES = Object.freeze(new Set(["self", "guardian"]));
const PURPOSE = "sign_in_or_recover";
const MESSAGE_ID_MAX_LENGTH = 512;

export const ACCOUNT_CODE_EMAIL_SUBJECT =
  "GlucoScopeの確認コード / Verification code";

export class CloudflareEmailAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = "CloudflareEmailAdapterError";
    this.code = code;
  }
}

function fail(code) {
  throw new CloudflareEmailAdapterError(code);
}

function requireBinding(binding) {
  if (!binding || typeof binding.send !== "function") {
    fail("email_binding_unavailable");
  }
  return binding;
}

function requireNormalizedEmail(value, code) {
  if (typeof value !== "string" || value !== value.trim()) fail(code);
  const raw = value;
  const normalized = normalizeEmailAddress(raw);
  if (!normalized || normalized !== raw) fail(code);
  return normalized;
}

function requireMessageInput(input) {
  const destinationEmail = requireNormalizedEmail(
    input?.destinationEmail,
    "email_destination_invalid",
  );
  const code = input?.code;
  const expiresInMinutes = input?.expiresInMinutes;
  const contactRole = input?.contactRole;
  if (
    typeof code !== "string"
    || typeof expiresInMinutes !== "number"
    || typeof contactRole !== "string"
    || !VERIFICATION_CODE_PATTERN.test(code)
    || !Number.isSafeInteger(expiresInMinutes)
    || expiresInMinutes < 1
    || expiresInMinutes > 60
    || !CONTACT_ROLES.has(contactRole)
    || input?.purpose !== PURPOSE
  ) {
    fail("email_message_invalid");
  }
  return Object.freeze({
    destinationEmail,
    code,
    expiresInMinutes,
  });
}

function buildMessage({ destinationEmail, code, expiresInMinutes }, fromAddress) {
  const text = [
    "GlucoScopeの確認コードです。",
    "",
    `確認コード: ${code}`,
    `このコードは${expiresInMinutes}分で使えなくなります。`,
    "このコードをほかの人に教えないでください。",
    "心当たりがない場合は、何もしなくて大丈夫です。",
    "",
    "This is your GlucoScope verification code.",
    "",
    `Verification code: ${code}`,
    `This code expires in ${expiresInMinutes} minutes.`,
    "Do not share this code with anyone.",
    "If you did not request it, you can safely ignore this email.",
  ].join("\n");
  const html = [
    '<div lang="ja">',
    "<p>GlucoScopeの確認コードです。</p>",
    `<p><strong>確認コード: ${code}</strong></p>`,
    `<p>このコードは${expiresInMinutes}分で使えなくなります。<br>`,
    "このコードをほかの人に教えないでください。<br>",
    "心当たりがない場合は、何もしなくて大丈夫です。</p>",
    "</div>",
    '<div lang="en">',
    "<p>This is your GlucoScope verification code.</p>",
    `<p><strong>Verification code: ${code}</strong></p>`,
    `<p>This code expires in ${expiresInMinutes} minutes.<br>`,
    "Do not share this code with anyone.<br>",
    "If you did not request it, you can safely ignore this email.</p>",
    "</div>",
  ].join("");
  return Object.freeze({
    to: destinationEmail,
    from: Object.freeze({ email: fromAddress, name: "GlucoScope" }),
    subject: ACCOUNT_CODE_EMAIL_SUBJECT,
    text,
    html,
  });
}

function requireMessageId(result) {
  const messageId = result?.messageId;
  if (
    typeof messageId !== "string"
    || !messageId
    || messageId.length > MESSAGE_ID_MAX_LENGTH
    || messageId.trim() !== messageId
    || /[\u0000-\u001f\u007f]/u.test(messageId)
  ) {
    fail("email_response_invalid");
  }
  return messageId;
}

export function createCloudflareEmailAdapter({
  binding,
  fromAddress,
} = {}) {
  return Object.freeze({
    async sendAccountCode(input) {
      const email = requireBinding(binding);
      const sender = requireNormalizedEmail(
        fromAddress,
        "email_sender_unavailable",
      );
      const message = buildMessage(requireMessageInput(input), sender);
      let result;
      try {
        result = await email.send(message);
      } catch {
        fail("email_delivery_unavailable");
      }
      const messageId = requireMessageId(result);
      return Object.freeze({
        accepted: true,
        provider: "cloudflare_email_service",
        messageId,
      });
    },
  });
}
