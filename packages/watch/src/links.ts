/**
 * The link a notification mail is about: the sender's own page for the thing (LinkedIn's message
 * thread, a Reddit reply, a GitHub issue), so "Open" lands there and not in Gmail. Only links on the
 * sender's domain count; account, settings and unsubscribe pages never do. Null when the mail has
 * no such link (a person writing by hand): the Gmail thread stays the place to open it.
 */
import { decodeHtml } from "@wren/core/html";
import type { MimePart } from "@wren/core/mail";

const MAX_URL = 2000;
/** Pages about the account, not the thing. */
const NOT_THE_THING =
  /unsubscribe|opt[-_]?out|settings|preferences|privacy|legal|help\b|support\b|notification[-_]?settings|manage[-_]?(email|notifications)|\/e\/|email[-_]?settings|terms|about\/|download|apps?\.|app[-_]?store|play\.google/i;
/** Hosts that serve pictures and tracking, never a page. */
const NOT_A_PAGE_HOST =
  /^(static|media|cdn|img|images?|pixel|track(ing)?|beacon|open|assets)\d*\./i;
const NOT_A_PAGE_PATH = /\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|$)/i;
/** Anchor text that names the thing. */
const ACTION_WORDS =
  /\b(view|see|reply|respond|answer|accept|open|read|join|message|invitation|post|profile|comment|conversation|thread|details|review)\b/i;
/** Anchor text or paths that are the site's front door. */
const FRONT_DOOR = /^(home|linkedin|facebook|x|twitter|reddit|instagram|youtube|github|logo)$/i;
const FRONT_PATH = /^\/(comm\/)?(feed\/?|home\/?)?$/;

/**
 * The domains a mail's sender owns, as its links would carry them: `linkedin.com` for
 * `x@mail.linkedin.com`; `facebookmail.com` and `facebook.com` for `x@facebookmail.com` (mail
 * domains that end in "mail" belong to the site without it). Empty when the address has no domain.
 */
export function senderDomains(fromAddress: string): string[] {
  const host = fromAddress.split("@")[1]?.toLowerCase().trim();
  if (!host) return [];
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return [];
  // Country second levels (co.uk, com.au): keep three labels.
  const second = labels[labels.length - 2];
  const take = labels.length >= 3 && /^(co|com|org|net|ac|gov|edu)$/.test(second ?? "") ? 3 : 2;
  const own = labels.slice(-take);
  const out = [own.join(".")];
  const brand = own[0] ?? "";
  if (brand.length > 5 && brand.endsWith("mail"))
    out.push([brand.slice(0, -4), ...own.slice(1)].join("."));
  return out;
}

interface Candidate {
  url: string;
  text: string;
  order: number;
}

/** Every `<a href>` in the HTML, with its text, in order. */
function anchors(html: string, from: number): Candidate[] {
  const out: Candidate[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null = re.exec(html);
  while (m) {
    const url = decodeHtml((m[1] ?? m[2] ?? m[3] ?? "").trim());
    const text = decodeHtml((m[4] ?? "").replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    out.push({ url, text, order: from + out.length });
    m = re.exec(html);
  }
  return out;
}

/** Bare URLs in plain text, in order. */
function bareUrls(text: string, from: number): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    out.push({ url: m[0].replace(/[.,;:!?]+$/, ""), text: "", order: from + out.length });
  }
  return out;
}

function hostOf(url: string): URL | null {
  if (url.length > MAX_URL) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/** 0 when it's the front door or not a page, 2 when its text names the thing, 1 otherwise. */
function score(c: Candidate, u: URL): number {
  if (NOT_A_PAGE_HOST.test(u.hostname) || NOT_A_PAGE_PATH.test(u.pathname)) return 0;
  if (NOT_THE_THING.test(u.pathname) || NOT_THE_THING.test(u.search)) return 0;
  if (FRONT_PATH.test(u.pathname)) return 0;
  if (FRONT_DOOR.test(c.text)) return 0;
  if (!c.text) return 1;
  return ACTION_WORDS.test(c.text) ? 2 : 1;
}

/**
 * The first link on the sender's domain whose text names the thing, else the first link there that
 * is a page. HTML parts first (they carry the buttons), then plain text. Null when there is none.
 */
export function primaryLink(msg: MimePart, fromAddress: string): string | null {
  const domains = senderDomains(fromAddress);
  if (!domains.length) return null;
  const found: Candidate[] = [];
  for (const part of msg.walk()) {
    if (part.isAttachment() || part.maintype !== "text") continue;
    const body = part.text();
    if (part.type === "text/html") found.push(...anchors(body, found.length));
    else if (part.type === "text/plain") found.push(...bareUrls(body, found.length + 10_000));
  }
  let best: { url: string; score: number; order: number } | null = null;
  for (const c of found) {
    const u = hostOf(c.url);
    if (!u) continue;
    const host = u.hostname.toLowerCase();
    if (!domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    const s = score(c, u);
    if (s === 0) continue;
    if (!best || s > best.score || (s === best.score && c.order < best.order))
      best = { url: c.url, score: s, order: c.order };
  }
  return best?.url ?? null;
}
