/**
 * A send on the ledger, typed (designs/2026-10-16-send-verdicts.md). A desk write carries the
 * ledger row's send key and autobrowse answers whether it went out: `sent`, `not_sent` or
 * `unknown`. `sendOnce` runs the send under that key and maps the answer. Wren reads no
 * words, and a take-over runs the same key again, so the desk answers its stored verdict and
 * writes nothing.
 *
 * A send that does not go through autobrowse (a client's connected account, on the platform's
 * own API) has no verdict. It keeps `look`: our words read back from the site. After an
 * unknown answer, or a failure that is not the platform's no, the look turns it into `found`;
 * unclear stays `unknown`, for a person.
 *
 * `look` and `send` may hold journaled site calls, so `sendOnce` never wraps them in a step.
 */
import { SiteCallError } from "./content/autobrowse.js";
import type { ContentChannel, Media, PublishedRow } from "./content/index.js";
import { NotSent, type SendTrace, SendUnknown, SentFound, withSendKey } from "./send-verdict.js";

/** What a read of the site says about our words. */
export type Seen =
  | { kind: "found"; ref: string | null; at: string | null; url: string | null }
  /** Provably not there: the read covers the time since the send began. */
  | { kind: "absent" }
  | { kind: "unclear"; why: string };

export const unclear = (why: string): Seen => ({ kind: "unclear", why });

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** How long a site takes to show what was just sent before a read can prove it is absent. */
export const SETTLE_MS = 30_000;

/** What `sendOnce` ended with. A platform's refusal is thrown (`refusalOf`), not returned. */
export type SendOutcome<S> =
  | { kind: "sent"; sent: S }
  | { kind: "found"; seen: Extract<Seen, { kind: "found" }> }
  /** Nothing went out, and the item may be sent again (under a new key). */
  | { kind: "not_sent"; how: "before_submit" | "verified_absent"; reason: string }
  | { kind: "unsure"; why: string };

export interface SendOnce<S> {
  /** The ledger row's send key: the send runs under it. */
  key: string;
  send: () => Promise<S>;
  /** A take-over: an earlier try may have left. Its key answers its stored verdict; `unknown` is asked again. */
  tried?: boolean;
  /**
   * A person said send again on an unsure item. A look reads first: if our words are there it
   * is found, not sent twice. A read that cannot tell does not stop him: he has decided.
   */
  again?: boolean;
  /** Guards that run before a first send (not on a take-over: our own earlier send is there). */
  before?: () => Promise<void>;
  /** Our words on a site autobrowse does not serve; absent for every desk send. */
  look?: (() => Promise<Seen>) | undefined;
  settle?: (ms: number) => Promise<void>;
  settleMs?: number;
}

/** The platform said no to the write: the error `isRefusal` reads, with its status. */
export const refusalOf = (err: NotSent): SiteCallError => {
  const e = new SiteCallError("send", "POST", "write", err.status ?? 400, err.reason);
  e.journaled = true;
  return e;
};

async function seen(look: SendOnce<unknown>["look"]): Promise<Seen> {
  if (!look) return unclear("nothing on this site can read it back");
  try {
    return await look();
  } catch (err) {
    return unclear(`the read failed: ${said(err).slice(0, 200)}`);
  }
}

/**
 * Send once, under its key, and say what became of it. A refusal is thrown as it came. An
 * error after a keyed write answered is `unsure`, never thrown: the item must not be sent
 * again by a caller that releases on a throw. Any other error is thrown (nothing left).
 */
export async function sendOnce<S>(o: SendOnce<S>): Promise<SendOutcome<S>> {
  const found = (s: Extract<Seen, { kind: "found" }>): SendOutcome<S> => ({
    kind: "found",
    seen: s,
  });
  if ((o.tried || o.again) && o.look) {
    // No key can answer for this send: read our words before a second try.
    const s = await seen(o.look);
    if (s.kind === "found") return found(s);
    if (s.kind === "unclear" && !o.again)
      return { kind: "unsure", why: `an earlier try may have gone out; ${s.why}` };
  }
  if (!o.tried) await o.before?.();
  const trace: SendTrace = { wrote: false };
  try {
    return {
      kind: "sent",
      sent: await withSendKey(o.key, o.send, { recheck: o.tried === true, trace }),
    };
  } catch (err) {
    if (err instanceof SentFound)
      return found({ kind: "found", ref: err.id, at: err.at, url: err.url });
    if (err instanceof NotSent) {
      if (err.how === "refused") throw refusalOf(err);
      return { kind: "not_sent", how: err.how, reason: err.reason };
    }
    if (err instanceof SendUnknown) {
      if (o.look) {
        await o.settle?.(o.settleMs ?? SETTLE_MS);
        const s = await seen(o.look);
        if (s.kind === "found") return found(s);
        return {
          kind: "unsure",
          why:
            s.kind === "unclear" ? `${err.reason}; ${s.why}` : `${err.reason}; not on the site yet`,
        };
      }
      return { kind: "unsure", why: err.reason };
    }
    if (trace.wrote)
      return { kind: "unsure", why: `a write answered, then: ${said(err).slice(0, 200)}` };
    // A site we read ourselves has no verdict: a failure that is not the platform's no may
    // have gone out, so its read decides. Absent leaves the failure as it was.
    if (o.look && !platformSaidNo(err)) {
      await o.settle?.(o.settleMs ?? SETTLE_MS);
      const s = await seen(o.look);
      if (s.kind === "found") return found(s);
      if (s.kind === "unclear")
        return { kind: "unsure", why: `${said(err).slice(0, 200)}; ${s.why}` };
    }
    throw err;
  }
}

/** The platform answered with a no (4xx, not a timeout or a wait): nothing went out. */
const platformSaidNo = (err: unknown): boolean =>
  err instanceof SiteCallError &&
  err.status >= 400 &&
  err.status < 500 &&
  err.status !== 408 &&
  err.status !== 429;

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
  const b = wordsOf(ours);
  const whole = wordsOf(theirs);
  if (!whole || !b) return false;
  if (whole === b) return true;
  // A listing's preview ends its cut with an ellipsis: the words before it are the site's.
  const a = whole.replace(/\s*…$/, "");
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

/** One message of a conversation as a read shows it. */
export interface SeenMessage {
  id: string;
  text: string;
  at: string;
  /** Sent by the account that read it. */
  mine: boolean;
}

/**
 * Our words in a conversation, its messages oldest first as a read keeps them: found when one of
 * ours matches; absent when the oldest message read is older than `since` (a newer one could not
 * have been left out); else unclear. Null: no conversation with them was in the read.
 */
export function seenInMessages(
  messages: readonly SeenMessage[] | null,
  o: { text: string; since: string; url?: string | null },
): Seen {
  if (!messages) return unclear("no conversation with them in the read");
  return seenIn([...messages].reverse(), {
    since: o.since,
    full: false,
    match: (m) => m.mine && sameWords(m.text, o.text),
    at: (m) => m.at || null,
    found: (m) => ({ kind: "found", ref: m.id, at: m.at || null, url: o.url ?? null }),
  });
}

/** Our own post looked for after its publish's outcome was lost (designs/2026-10-16-maybe-sent.md). */
export interface PostLook {
  /** Words the post may show: the text as sent, the draft's own text, its title. */
  words: readonly (string | null | undefined)[];
  /** When the publish began, ISO. */
  since: string;
  /** The post's file, when it has one: some sites list a fresh video late. */
  media?: Media["kind"] | null;
}

/** Rows a look reads: within every channel's page, so a short page never reads as more. */
export const POST_LOOK_ROWS = 20;

/**
 * Our post in a newest-first listing of our own posts: found when a row since the send shows
 * our words; absent when the listing reaches back past the send; else unclear. `late` says why
 * this site may not list a fresh post yet, and then absent is unclear: never proof.
 */
export function seenPost(
  rows: readonly PublishedRow[],
  q: PostLook & { late?: string | null },
): Seen {
  const words = q.words.filter((w): w is string => !!w?.trim());
  if (!words.length) return unclear("no words to look for");
  const floor = new Date(q.since).getTime() - CLOCK_SLACK_MS;
  const s = seenIn(rows, {
    since: q.since,
    full: false,
    match: (r) =>
      new Date(r.publishedAt).getTime() >= floor && words.some((w) => sameWords(r.preview, w)),
    at: (r) => r.publishedAt || null,
    found: (r) => ({ kind: "found", ref: r.id, at: r.publishedAt || null, url: r.url || null }),
  });
  return s.kind === "absent" && q.late ? unclear(q.late) : s;
}

/** Our post read back through the channel's own listing. A failed read is unclear. */
export async function findPost(
  ch: Pick<ContentChannel, "list" | "listsLate">,
  q: PostLook,
): Promise<Seen> {
  let rows: PublishedRow[];
  try {
    rows = await ch.list({ limit: POST_LOOK_ROWS });
  } catch (err) {
    return unclear(`the read failed: ${said(err).slice(0, 200)}`);
  }
  return seenPost(rows, { ...q, late: ch.listsLate?.(q.media ?? null) ?? null });
}
