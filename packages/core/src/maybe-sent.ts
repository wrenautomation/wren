/**
 * A send whose outcome is unknown (designs/2026-10-16-maybe-sent.md). A write that failed after
 * it may have reached the site ("may have gone through", "already went through") is never sent
 * again blind: we look on the site for our own words first. Found: it went out, record it with
 * its real ref. Provably absent after a short settle: safe to send once more. Can't tell: unsure,
 * parked for a person, never resent by itself.
 *
 * `look` and `send` may hold journaled site calls, so `sendOnce` never wraps them in a step.
 */
import * as restate from "@restatedev/restate-sdk";
import { browserBusy, mayHavePosted, NOT_SENT, SiteCallError } from "./content/autobrowse.js";
import { isRefusal } from "./content/restate.js";
import { isVendorStop } from "./vendor-stop.js";

/** What a read of the site says about our words. */
export type Seen =
  | { kind: "found"; ref: string | null; at: string | null; url: string | null }
  /** Provably not there: the read covers the time since the send began. */
  | { kind: "absent" }
  | { kind: "unclear"; why: string };

export const unclear = (why: string): Seen => ({ kind: "unclear", why });

/** What a failed send says about itself. */
export type SendFate = "refused" | "not_sent" | "maybe";

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A refusal (the site said no), nothing sent (it never left), or maybe (it may be live). Words
 * that say it may be live win over a status: autobrowse's 502 "already went through" is a maybe.
 */
export function sendFate(err: unknown): SendFate {
  const text = said(err);
  if (mayHavePosted(text)) return "maybe";
  if (isRefusal(err) || isVendorStop(err)) return "refused";
  if (text.includes(NOT_SENT) || browserBusy(err)) return "not_sent";
  // A refusal answered through another service (`Content.reply`): its words carry any maybe.
  if (err instanceof restate.TerminalError) return "refused";
  // A 4xx the site answered (a rate limit too) left nothing; a timeout may have.
  if (err instanceof SiteCallError && err.status >= 400 && err.status < 500 && err.status !== 408)
    return "refused";
  // A site call that failed past its words: it may have left.
  if (err instanceof SiteCallError) return "maybe";
  // Our own code threw before any call went out.
  return "not_sent";
}

/** How long a site takes to show what was just sent before a read can prove it is absent. */
export const SETTLE_MS = 30_000;

/** What `sendOnce` ended with. */
export type SendOutcome<S> =
  | { kind: "sent"; sent: S }
  | { kind: "found"; seen: Extract<Seen, { kind: "found" }> }
  | { kind: "unsure"; why: string };

export interface SendOnce<S> {
  send: () => Promise<S>;
  /** Our words on the site; absent when the site has no read that can find them. */
  look?: (() => Promise<Seen>) | undefined;
  /** Look before the first send: a resend after a crash, or a person's Send again. */
  first?: boolean;
  /** An earlier try may have left: a first look that can't tell sends nothing. */
  tried?: boolean;
  /** Guards that run once our words are known not to be there, before the first send. */
  before?: () => Promise<void>;
  settle: (ms: number) => Promise<void>;
  settleMs?: number;
}

async function seen(look: SendOnce<unknown>["look"]): Promise<Seen> {
  if (!look) return unclear("nothing on this site can read it back");
  try {
    return await look();
  } catch (err) {
    return unclear(`the read failed: ${said(err).slice(0, 200)}`);
  }
}

/**
 * Send at most twice, never blind. A refusal or a never-sent failure is thrown as it came; a
 * maybe is looked for after `settleMs`, then recorded, sent once more, or answered unsure.
 */
export async function sendOnce<S>(o: SendOnce<S>): Promise<SendOutcome<S>> {
  if (o.first || o.tried) {
    const s = await seen(o.look);
    if (s.kind === "found") return { kind: "found", seen: s };
    if (s.kind === "unclear" && o.tried)
      return { kind: "unsure", why: `an earlier try may have gone through; ${s.why}` };
  }
  await o.before?.();
  for (let tries = 1; ; tries++) {
    try {
      return { kind: "sent", sent: await o.send() };
    } catch (err) {
      if (sendFate(err) !== "maybe") throw err;
      await o.settle(o.settleMs ?? SETTLE_MS);
      const s = await seen(o.look);
      if (s.kind === "found") return { kind: "found", seen: s };
      const why = said(err).slice(0, 300);
      if (s.kind === "unclear") return { kind: "unsure", why: `${why}; ${s.why}` };
      // Absent after the settle: it never landed. Once more, and only once.
      if (tries >= 2) return { kind: "unsure", why: `${why}; not on the site after two tries` };
    }
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

/** Words as a site may echo them: entities decoded, Markdown escapes and spacing dropped. */
export const wordsOf = (text: string): string =>
  text
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Long enough that a prefix match is these words, not a common opener. */
const PREFIX_MIN = 40;
const PREFIX_MAX = 120;

/**
 * Are these the words we sent? Equal once normalized, or one a cut of the other (a preview, a
 * site's trim) over enough of it to be ours.
 */
export function sameWords(theirs: string, ours: string): boolean {
  const a = wordsOf(theirs);
  const b = wordsOf(ours);
  if (!a || !b) return false;
  if (a === b) return true;
  const n = Math.min(a.length, b.length, PREFIX_MAX);
  if (n < Math.min(PREFIX_MIN, b.length)) return false;
  return a.slice(0, n) === b.slice(0, n);
}

/** Leeway for a site clock that runs behind ours. */
export const CLOCK_SLACK_MS = 5 * 60_000;

/**
 * A newest-first listing of our own sends: found when an item matches; provably absent when the
 * listing reaches back past `since` (or is the whole list); else unclear.
 */
export function seenIn<T>(
  items: readonly T[],
  o: {
    since: string;
    full: boolean;
    match: (item: T) => boolean;
    at: (item: T) => string | null;
    found: (item: T) => Extract<Seen, { kind: "found" }>;
  },
): Seen {
  const hit = items.find(o.match);
  if (hit) return o.found(hit);
  if (o.full) return { kind: "absent" };
  const floor = new Date(o.since).getTime() - CLOCK_SLACK_MS;
  const oldest = items.at(-1);
  const at = oldest ? o.at(oldest) : null;
  if (at && new Date(at).getTime() < floor) return { kind: "absent" };
  return unclear("the listing does not reach back to the send");
}
