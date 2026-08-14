export const PLUS_PRODUCT_CODE = "plus_30d";
export const PLUS_PRICE_JPY = 300;
export const PLUS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const FREE_AI_DAILY_SUCCESS_LIMIT = 1;
export const PLUS_AI_DAILY_SUCCESS_LIMIT = 5;
export const DEFAULT_SHARE_TRIAL_RESERVATION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_CHECKOUT_RESERVATION_TTL_MS = 10 * 60 * 1000;

export const VERIFIED_PAYMENT_EVENT_TYPES = Object.freeze(new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]));

export const FAILED_PAYMENT_EVENT_TYPES = Object.freeze(new Set([
  "checkout.session.async_payment_failed",
]));

export const EXPIRED_CHECKOUT_EVENT_TYPES = Object.freeze(new Set([
  "checkout.session.expired",
]));

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9]{8,247}$/u;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const STRIPE_API_VERSION = "2026-06-24.dahlia";
export const STRIPE_CHECKOUT_ROUTE = "/v1/plus/checkout";
export const STRIPE_WEBHOOK_ROUTE = "/v1/stripe/webhook";
export const STRIPE_CHECKOUT_BODY_LIMIT_BYTES = 1024;
export const STRIPE_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export const STRIPE_REFUND_EVENT_TYPES = Object.freeze(new Set([
  "refund.created",
  "refund.updated",
  "charge.refunded",
]));

export const STRIPE_RELEVANT_EVENT_TYPES = Object.freeze(new Set([
  ...VERIFIED_PAYMENT_EVENT_TYPES,
  ...FAILED_PAYMENT_EVENT_TYPES,
  ...EXPIRED_CHECKOUT_EVENT_TYPES,
  ...STRIPE_REFUND_EVENT_TYPES,
]));
