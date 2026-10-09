/**
 * Outbound webhooks, the pure half (designs/2026-10-07-webhooks-out.md): the events a client's
 * URL may hear and where each comes from on the spine, the URL guard, and the Send webhook node's
 * slots. No Node APIs, so the portal reads it too.
 */
import type { EventKind } from "./components.js";
import type { TriggerFacts } from "./logic.js";

/** What a subscription may hear, in words. */
export const WEBHOOK_EVENTS = {
  "lead.created": "A lead came in through a door",
  "form.submitted": "A form was filled",
  "reply.received": "A lead replied by email, text or DM",
  "booking.made": "A call was booked or moved",
  "booking.cancelled": "A call was cancelled",
  "deal.won": "A call or a deal was marked won",
  "deal.moved": "A deal moved stage, or was lost",
  "payment.received": "A pay link was paid",
  "document.viewed": "A document you sent was opened",
  "document.signed": "A document you sent was signed",
  "document.declined": "A document you sent was declined",
  "app.changed": "A connected app added a contact, got an invoice paid or finished a job",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
/** A test send's event: no subscription hears it, every test delivery says it. */
export const TEST_EVENT = "webhook.test";

export const isWebhookEvent = (v: unknown): v is WebhookEvent =>
  typeof v === "string" && Object.hasOwn(WEBHOOK_EVENTS, v);

/** A reply or a booking the spine fired, as a webhook event; null for what clients don't hear. */
export function webhookEventOfFired(f: TriggerFacts): WebhookEvent | null {
  if (f.trigger === "trigger.reply") return "reply.received";
  if (f.trigger === "trigger.booking")
    return f.change === "booked" ? "booking.made" : "booking.cancelled";
  if (f.trigger === "trigger.payment") return "payment.received";
  if (f.trigger === "trigger.document") return `document.${f.change}`;
  if (f.trigger === "trigger.deal") return f.change === "won" ? "deal.won" : "deal.moved";
  if (f.trigger === "trigger.app") return "app.changed";
  return null;
}

/** A door entry's event, by the kind it entered as. */
export const webhookEventOfDoor = (kind: EventKind): WebhookEvent | null =>
  kind === "lead" ? "lead.created" : kind === "form" ? "form.submitted" : null;

/** Events a part's own code emits that clients hear: `close`'s won outcome. */
const EMITTED: ReadonlyArray<{ workflow: string; from: string; event: WebhookEvent }> = [
  { workflow: "close", from: "outcome.won", event: "deal.won" },
];
export const webhookEventOfEmit = (workflow: string, from: string): WebhookEvent | null =>
  EMITTED.find((e) => e.workflow === workflow && e.from === from)?.event ?? null;

// ---- The URL guard ----

const V4_BLOCKED: ReadonlyArray<[number, number]> = [
  [0x00000000, 8], // this network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link local, cloud metadata
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol
  [0xc0000200, 24], // documentation
  [0xc0586300, 24], // 6to4 relay
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved, broadcast
];

function v4Of(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

const v4Blocked = (n: number) =>
  V4_BLOCKED.some(([base, bits]) => (n & ((~0 << (32 - bits)) >>> 0)) >>> 0 === base);

/** An IPv6 address as its 8 groups; null when it doesn't read. */
function v6Of(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  // A trailing IPv4 ("::ffff:127.0.0.1") as its two groups.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4?.[1]) {
    const n = v4Of(v4[1]);
    if (n === null) return null;
    s = `${s.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const read = (h: string | undefined) =>
    h
      ? h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN))
      : [];
  const head = read(halves[0]);
  const back = read(halves[1]);
  const fill = 8 - head.length - back.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  const all = [...head, ...Array<number>(Math.max(0, fill)).fill(0), ...back];
  return all.length === 8 && all.every((g) => Number.isInteger(g)) ? all : null;
}

/**
 * Not a public address: private, loopback, link local (cloud metadata), multicast, reserved, or
 * one that doesn't read. An IPv6 address that carries an IPv4 one is judged by that.
 */
export function privateIp(ip: string): boolean {
  const n = v4Of(ip);
  if (n !== null) return v4Blocked(n);
  const g = v6Of(ip);
  if (!g) return true;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, x = 0, y = 0] = g;
  const v4 = ((x << 16) | y) >>> 0;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0 || f === 0xffff))
    return f === 0 && x === 0 ? true : v4Blocked(v4); // ::, ::1, IPv4-compatible and -mapped
  if (a === 0x64 && b === 0xff9b) return v4Blocked(v4); // NAT64
  if (a === 0x2002) return v4Blocked(((b << 16) | c) >>> 0); // 6to4
  if ((a & 0xfe00) === 0xfc00) return true; // unique local
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true; // link and site local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && (b === 0x0db8 || b === 0)) return true; // documentation, Teredo
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true; // discard
  return false;
}

const HOST_BLOCKED = /(^|\.)(localhost|local|internal|lan|intranet|home\.arpa|localdomain)$/;

/**
 * Why Wren won't post to this URL, or null: https only, no login in it, a host with a dot that
 * isn't local or a metadata name, and no private address written out. Where the host resolves is
 * checked again on every post (`safePost`).
 */
export function urlProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "a URL is needed";
  if (raw.length > 2000) return "keep the URL under 2,000 characters";
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "that isn't a URL";
  }
  if (u.protocol !== "https:") return "the URL must start with https://";
  if (u.username || u.password) return "put a login in a header, not the URL";
  const host = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const literal = v4Of(host) !== null || host.includes(":");
  if (literal) return privateIp(host) ? "that address is private" : null;
  if (HOST_BLOCKED.test(host) || host === "instance-data") return "that host is local";
  if (!host.includes(".")) return "use a public host name, like hooks.example.com";
  return null;
}

// ---- The Send webhook node: slots, headers, what it keeps ----

/** A value at a dotted path. */
function dig(v: unknown, path: string): unknown {
  for (const k of path.split("."))
    v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

const SLOT = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/;
const asText = (v: unknown) =>
  v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v);

/** `{{path}}` slots in text, each filled from `from` (the event: subject, kind, data). */
export const fillText = (template: string, from: unknown, url = false): string =>
  template.replace(SLOT, (_, path: string) => {
    const t = asText(dig(from, path));
    return url ? encodeURIComponent(t) : t;
  });

/** A JSON template's values filled: a string that is one slot keeps the value's type. */
function fillJson(v: unknown, from: unknown): unknown {
  if (typeof v === "string") {
    const whole = WHOLE.exec(v);
    if (whole?.[1]) return dig(from, whole[1]) ?? null;
    return fillText(v, from);
  }
  if (Array.isArray(v)) return v.map((x) => fillJson(x, from));
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillJson(x, from)]));
  return v;
}

/** Why a body template won't read, or null. Empty sends the whole event. */
export function bodyProblem(template: unknown): string | null {
  const t = String(template ?? "").trim();
  if (!t) return null;
  try {
    JSON.parse(t);
    return null;
  } catch {
    return 'the body must be JSON, with slots in quotes: {"email": "{{data.lead.email}}"}';
  }
}

/** The body as sent: the template filled, or the whole event when there's none. */
export function bodyOf(
  template: unknown,
  e: { subject: string; kind: string; data: unknown },
): unknown {
  const t = String(template ?? "").trim();
  if (!t) return { subject: e.subject, kind: e.kind, data: e.data };
  return fillJson(JSON.parse(t), e);
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
/** Headers Wren sets itself, or that would change what the request is. */
const OWN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
]);

/** "Name: value" per line (or `;` between), slots filled; and what didn't read. */
export function headersOf(
  text: unknown,
  from: unknown,
): { headers: Record<string, string>; problems: string[] } {
  const headers: Record<string, string> = {};
  const problems: string[] = [];
  for (const line of String(text ?? "").split(/\n|;(?=\s*[A-Za-z0-9-]+\s*:)/)) {
    const s = line.trim();
    if (!s) continue;
    const at = s.indexOf(":");
    const name = s.slice(0, Math.max(0, at)).trim();
    if (at < 1 || !HEADER_NAME.test(name)) {
      problems.push(`a header reads "Name: value" (${s.slice(0, 30)})`);
      continue;
    }
    if (OWN_HEADERS.has(name.toLowerCase())) {
      problems.push(`${name} is set by Wren`);
      continue;
    }
    headers[name] = fillText(s.slice(at + 1).trim(), from).replace(/[\r\n]/g, " ");
  }
  return { headers, problems };
}

/** "id=body.id, ok=status": names to keep from the answer, each at a dotted path. */
export function keepOf(text: unknown): { keep: Record<string, string>; problems: string[] } {
  const keep: Record<string, string> = {};
  const problems: string[] = [];
  for (const pair of String(text ?? "").split(/[,\n]/)) {
    const s = pair.trim();
    if (!s) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]{0,39})\s*=\s*((status|ms|body)(\.[A-Za-z0-9_-]+)*)$/.exec(s);
    if (!m?.[1] || !m[2]) {
      problems.push(`keep reads like id=body.id (${s.slice(0, 30)})`);
      continue;
    }
    keep[m[1]] = m[2];
  }
  return { keep, problems };
}

/** What the run keeps from an answer: status, time, the body cut to 4 KB, and the kept names. */
export function answerKept(
  answer: { status: number; ms: number; body: string },
  keep: Readonly<Record<string, string>>,
): Record<string, unknown> {
  let body: unknown = answer.body;
  try {
    body = JSON.parse(answer.body);
  } catch {
    // Not JSON: kept as text.
  }
  const whole = { status: answer.status, ms: answer.ms, body };
  const cut = JSON.stringify(body ?? null).length > 4000 ? answer.body.slice(0, 4000) : body;
  const out: Record<string, unknown> = { status: answer.status, ms: answer.ms, body: cut };
  for (const [name, path] of Object.entries(keep)) out[name] = dig(whole, path) ?? null;
  return out;
}

export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH", "GET", "DELETE"] as const;

// ---- Replay: a failed step, again on its own ----

/** Zapier's autoreplay ladder: after 5 min, 30 min, 1 h, 3 h, 6 h. */
export const RETRY_LADDER_MS = [300_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000] as const;
export const RETRY_MOST = RETRY_LADDER_MS.length;

/** A workflow's auto-retry tries, 0 (off) to 5. */
export const retryTriesOf = (v: unknown): number => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) ? Math.min(RETRY_MOST, Math.max(0, n)) : 0;
};
