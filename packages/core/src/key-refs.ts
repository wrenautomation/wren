/**
 * What a key may be called and look like, and the guard that keeps raw keys out of Restate
 * (designs/2026-10-07-key-store.md). Pure: the portal Worker, the sign-in Lambda and handlers
 * all use it.
 */
import { z } from "zod";

/** A stored key's reference: what handlers and rows carry instead of the key. */
export const KEY_REF = /^ks_[0-9a-f]{32}$/;
export const keyRef = z.string().regex(KEY_REF, "A saved key's reference, ks_…");

/** Names a client's key may be kept under, each with the shape its value has. */
export const KEY_SHAPES: Readonly<Record<string, RegExp>> = {
  STRIPE_SECRET_KEY: /^(sk|rk)_(live|test)_[A-Za-z0-9]{8,240}$/,
  STRIPE_WEBHOOK_SECRET: /^whsec_[A-Za-z0-9+/=]{8,200}$/,
  EXA_API_KEY: /^\S{8,4096}$/,
  YOUTUBE_API_KEY: /^\S{8,4096}$/,
  X_BEARER_TOKEN: /^\S{8,4096}$/,
  MODEL_API_KEY: /^\S{8,4096}$/,
  TELNYX_API_KEY: /^\S{8,4096}$/,
  /** Telnyx's webhook signing key (Account → Public Key): Ed25519, 32 bytes in base64. Public. */
  TELNYX_PUBLIC_KEY: /^[A-Za-z0-9+/]{43}=$/,
};

/** A mailbox's refresh token (designs/2026-10-07-mail-access.md): the address hashed. */
export const MAIL_TOKEN_NAME = /^MAIL_(GOOGLE|MICROSOFT)_[0-9A-F]{16}$/;

/**
 * Names only Wren keeps, never pasted on a page: a mailbox's token as JSON, and Wren's own mail
 * apps (kept under the client `wren`).
 */
function wrenShape(name: string): RegExp | undefined {
  if (MAIL_TOKEN_NAME.test(name)) return /^\{[\s\S]{8,4000}\}$/;
  if (/^MAIL_(GOOGLE|MICROSOFT)_CLIENT_(ID|SECRET)$/.test(name)) return /^\S{8,4096}$/;
  return undefined;
}

/**
 * Why `value` can't be kept as `name`, or null when it can. Never says the value. A person
 * pastes only `KEY_SHAPES` names; the worker and the CLI may also keep Wren's own.
 */
export function keyProblem(
  name: string,
  value: string,
  from: "person" | "wren" = "person",
): string | null {
  const shape = KEY_SHAPES[name] ?? (from === "wren" ? wrenShape(name) : undefined);
  if (!shape) return "Wren doesn't keep a key by that name";
  if (!shape.test(value)) {
    if (name === "STRIPE_SECRET_KEY") return "That isn't a Stripe secret key (sk_ or rk_)";
    if (name === "STRIPE_WEBHOOK_SECRET") return "That isn't a webhook signing secret (whsec_)";
    if (name === "TELNYX_PUBLIC_KEY")
      return "That isn't a Telnyx public key (Account → Public Key, 44 characters)";
    return "That doesn't look like a key";
  }
  return null;
}

/** The last 4 characters, for a page to show. */
export const last4 = (value: string) => value.slice(-4);

const PREFIXED = /^(sk|rk|whsec|xox[abp]|ghp|gho|github_pat|glpat|AKIA|AIza|KEY0)[A-Za-z0-9_-]*/;
const TOKENISH = /^[A-Za-z0-9_\-.+/=]{24,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does this look like a secret? A known key prefix, or a long unbroken token mixing letters and
 * digits. A reference, a uuid, an email or a URL doesn't.
 */
export function looksLikeKey(s: string): boolean {
  const v = s.trim();
  if (v.length < 12 || KEY_REF.test(v) || UUID.test(v)) return false;
  if (PREFIXED.test(v) && /\d/.test(v) && v.length >= 16) return true;
  return TOKENISH.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v);
}

/** Fields that held a raw key before refs: a body with one is refused. */
export const RAW_KEY_FIELDS = ["key", "secret", "value", "token", "apiKey"] as const;

/** Where in `input` a raw key sits (`client`, `key`, `rows.0.note`), or null. */
export function rawKeyAt(input: unknown, path = ""): string | null {
  if (typeof input === "string") return looksLikeKey(input) ? path || "(body)" : null;
  if (Array.isArray(input)) {
    for (const [i, x] of input.entries()) {
      const at = rawKeyAt(x, path ? `${path}.${i}` : String(i));
      if (at) return at;
    }
    return null;
  }
  if (input && typeof input === "object") {
    for (const [k, x] of Object.entries(input)) {
      const at = path ? `${path}.${k}` : k;
      if (!path && (RAW_KEY_FIELDS as readonly string[]).includes(k) && x != null && x !== "")
        return at;
      const found = rawKeyAt(x, at);
      if (found) return found;
    }
  }
  return null;
}

/**
 * A handler's input that must never carry a key: the schema, refusing a raw key anywhere in it.
 * Restate keeps an input before the handler's schema reads it, so the portal Worker's guard is
 * the one that keeps keys out; this one makes sure a handler never runs on one.
 */
export const noRawKeys = <T extends z.ZodType>(schema: T) =>
  schema.superRefine((v, ctx) => {
    const at = rawKeyAt(v);
    if (at)
      ctx.addIssue({
        code: "custom",
        path: at.split("."),
        message: "Send a saved key's reference (ks_…), never the key",
      });
  });

/** Portal routes that take refs: the Worker refuses a raw key on them before Restate sees it. */
export const REF_ROUTES: readonly string[] = ["payments/connect", "accounts/setVendor"];

/** Where the browser posts a key: the portal Worker passes it to the sign-in Lambda. */
export const KEY_STAGE_PATH = "/api/keys/stage";
/** The most a key may be, in characters. */
export const KEY_MAX = 4096;
/** Who the portal Worker says is signed in, on a key it passes to the sign-in Lambda. */
export const KEY_VIEWER_HEADER = "x-wren-viewer";
