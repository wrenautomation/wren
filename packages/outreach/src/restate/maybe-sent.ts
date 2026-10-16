/**
 * A send that lands at most once, on Restate (designs/2026-10-16-maybe-sent.md). The ledger claim
 * and settle are steps; the send and the look are the caller's journaled site calls, never inside
 * a step. Unsure ends the invocation terminally, so Restate neither retries nor pauses it.
 */
import * as restate from "@restatedev/restate-sdk";
import {
  type CommentRow,
  type Platform as ContentPlatform,
  SiteCallError,
} from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import { type Seen, sameWords, sendOnce, unclear } from "@wren/core/maybe-sent";
import type { Queryable } from "@wren/db";
import { ReachRefusal } from "../refusal.js";
import {
  claimSend,
  releaseSend,
  type SendClaim,
  settleSent,
  settleUnsure,
  UNSURE_WAITS,
} from "../send-attempts.js";

/** Parked for a person. Terminal: a scheduled slot leaves the schedule, nothing retries it. */
export class SendUnsure extends restate.TerminalError {
  readonly unsure = true;
}
export const isSendUnsure = (err: unknown): err is SendUnsure => err instanceof SendUnsure;

/**
 * A send's failure as its handler throws it: a refusal, or a journaled answer a retry would only
 * replay, is terminal; anything else is left for Restate to retry.
 */
export function sendError(err: unknown): unknown {
  if (err instanceof restate.TerminalError) return err;
  if (isRefusal(err)) return new restate.TerminalError(err.message, { errorCode: err.status });
  if (err instanceof SiteCallError && err.journaled)
    return new restate.TerminalError(err.message, { errorCode: err.status || 502 });
  return err;
}

export interface AtMostOnce extends Omit<SendClaim, "invocation" | "now"> {
  send: () => Promise<{ ref: string | null }>;
  /** Our words on the site since `since` (ISO). Absent: no read here can tell. */
  look?: ((since: string) => Promise<Seen>) | undefined;
  /** Guards once our words are known not to be there (others of ours in the thread). */
  before?: () => Promise<void>;
}

export interface Landed {
  ref: string | null;
  at: string;
  /** Read back on the site rather than answered by the send. */
  found: boolean;
}

export async function sendAtMostOnce(
  ctx: restate.Context,
  db: Queryable,
  o: AtMostOnce,
): Promise<Landed> {
  const now = new Date(await ctx.date.now());
  const { send, look, before, ...claim } = o;
  const claimed = await ctx.run("claim send", async () => {
    try {
      return await claimSend(db, { ...claim, invocation: ctx.request().id, now });
    } catch (err) {
      if (err instanceof ReachRefusal)
        throw new restate.TerminalError(err.message, { errorCode: 409 });
      throw err;
    }
  });
  if (claimed.go === "done")
    return { ref: claimed.ref, at: claimed.at ?? now.toISOString(), found: true };
  let out: Awaited<ReturnType<typeof sendOnce<{ ref: string | null }>>>;
  try {
    out = await sendOnce({
      send,
      look: look && (() => look(claimed.since)),
      first: !!look,
      tried: claimed.tried,
      ...(before ? { before } : {}),
      settle: (ms) => ctx.sleep(ms),
    });
  } catch (err) {
    await ctx.run("release send", () => releaseSend(db, o.item));
    throw err;
  }
  if (out.kind === "unsure") {
    const why = out.why;
    await ctx.run("unsure", () => settleUnsure(db, o.item, { why, now }));
    throw new SendUnsure(`It ${UNSURE_WAITS}. ${why}`, { errorCode: 409 });
  }
  const ref = out.kind === "sent" ? out.sent.ref : out.seen.ref;
  const at = (out.kind === "found" && out.seen.at) || now.toISOString();
  const by = out.kind;
  await ctx.run("settle send", () => settleSent(db, o.item, { ref, at: new Date(at), by, now }));
  return { ref, at, found: out.kind === "found" };
}

/** Platforms whose `Content.comments` marks our own rows (`mine`). */
const MARKS_MINE: ReadonlySet<string> = new Set([
  "linkedin",
  "reddit",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
]);

type ContentComments = {
  comments: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; id: string },
  ) => Promise<CommentRow[]>;
};

const sameRef = (a: string, b: string) => a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);

/**
 * Our words in a post's comments, read through `Content.comments`: found or unclear (a read of
 * one page of comments never proves them absent). Null where the platform doesn't mark ours.
 */
export function contentLook(
  ctx: restate.Context,
  /** `parent`: the comment answered; null = on the post itself. */
  q: { platform: ContentPlatform; post: string; parent: string | null; text: string },
): ((since: string) => Promise<Seen>) | undefined {
  if (!MARKS_MINE.has(q.platform)) return undefined;
  return async () => {
    const rows = await ctx
      .serviceClient<ContentComments>({ name: "Content" })
      .comments({ platform: q.platform, id: q.post });
    const hit = rows.find(
      (r) =>
        r.mine &&
        sameWords(r.text, q.text) &&
        (!q.parent || !r.parentId || sameRef(r.parentId, q.parent)),
    );
    return hit
      ? { kind: "found", ref: hit.id, at: hit.at, url: hit.url ?? null }
      : unclear("our words are not in the post's comments as read");
  };
}
