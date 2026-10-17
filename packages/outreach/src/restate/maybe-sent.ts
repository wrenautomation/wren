/**
 * A send that lands at most once, on Restate (designs/2026-10-16-send-verdicts.md). The ledger
 * claim and settle are steps; the send is the caller's journaled site call, never inside a step.
 * The send runs under the ledger row's key, and autobrowse says whether it went out. Unsure ends
 * the invocation terminally, so Restate neither retries nor pauses it.
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
 * The claim was refused: another invocation is sending it, it waits on a person, or a refusal of
 * the claim itself. Terminal (409), and nothing about the send changed.
 */
export class SendTaken extends restate.TerminalError {
  readonly taken = true;
}
export const isSendTaken = (err: unknown): err is SendTaken => err instanceof SendTaken;

/**
 * Autobrowse said nothing went out (the browser was busy, the page never loaded, the read showed
 * it absent). The ledger row is released, so the item sends again on its next pass under a new
 * key. Terminal: this invocation does not send it again.
 */
export class SendNotSent extends restate.TerminalError {
  readonly notSent = true;
  constructor(
    message: string,
    readonly how: "before_submit" | "verified_absent",
  ) {
    super(message, { errorCode: 503 });
  }
}
export const isSendNotSent = (err: unknown): err is SendNotSent => err instanceof SendNotSent;

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
  /** Runs under the ledger row's send key; a desk write inside it carries the key. */
  send: () => Promise<{ ref: string | null }>;
  /**
   * Our words on the site since `since` (ISO). Only for a send autobrowse does not serve (a
   * client's connected account): a desk send has a verdict and reads nothing back.
   */
  look?: ((since: string) => Promise<Seen>) | undefined;
  /** Guards before a first send, not on a take-over (others of ours in the thread). */
  before?: () => Promise<void>;
}

export interface Landed {
  ref: string | null;
  at: string;
  /** Read back (autobrowse's verified read, or a look) rather than answered by the send. */
  found: boolean;
}

export async function sendAtMostOnce(
  ctx: restate.Context,
  db: Queryable,
  o: AtMostOnce,
): Promise<Landed> {
  const now = new Date(await ctx.date.now());
  const { send, look, before, ...claim } = o;
  // A refusal comes back as a value, so it is thrown as `SendTaken` here, not as a step's error.
  const claimed = await ctx.run("claim send", async () => {
    try {
      return await claimSend(db, { ...claim, invocation: ctx.request().id, now });
    } catch (err) {
      if (err instanceof ReachRefusal) return { go: "taken" as const, why: err.message };
      throw err;
    }
  });
  if (claimed.go === "taken") throw new SendTaken(claimed.why, { errorCode: 409 });
  if (claimed.go === "done")
    return { ref: claimed.ref, at: claimed.at ?? now.toISOString(), found: true };
  let out: Awaited<ReturnType<typeof sendOnce<{ ref: string | null }>>>;
  try {
    out = await sendOnce({
      key: claimed.sendKey,
      send,
      look: look && (() => look(claimed.since)),
      tried: claimed.tried,
      ...(o.again ? { again: true } : {}),
      ...(before ? { before } : {}),
      settle: (ms) => ctx.sleep(ms),
    });
  } catch (err) {
    // A refusal, or an error before any write answered: no attempt stands.
    await ctx.run("release send", () => releaseSend(db, o.item));
    throw err;
  }
  if (out.kind === "not_sent") {
    await ctx.run("release send", () => releaseSend(db, o.item));
    throw new SendNotSent(`Nothing went out: ${out.reason}`, out.how);
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
/** Platforms whose content channel reads our reply back another way (`Content.findReply`). */
const FINDS_REPLY: ReadonlySet<string> = new Set(["x"]);

type ContentReads = {
  comments: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; id: string; client?: string | null },
  ) => Promise<CommentRow[]>;
  findReply: (
    ctx: restate.Context,
    req: {
      platform: ContentPlatform;
      on: string;
      to: string | null;
      text: string;
      since: string;
      client?: string | null;
    },
  ) => Promise<Seen>;
};

const sameRef = (a: string, b: string) => a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);

/**
 * Our words under a post, read through `Content`: its comments where they mark ours (found or
 * unclear: one page of comments never proves them absent), else `findReply` where the channel
 * has it. Undefined where nothing reads them back.
 */
export function contentLook(
  ctx: restate.Context,
  q: {
    platform: ContentPlatform;
    post: string;
    /** The comment answered; null = on the post itself. */
    parent: string | null;
    /** Whose `parent` (or the post) is: their handle. */
    to?: string | null;
    text: string;
    /** A client's own channels; none: Wren's. */
    client?: string | null;
  },
): ((since: string) => Promise<Seen>) | undefined {
  const content = () => ctx.serviceClient<ContentReads>({ name: "Content" });
  const client = q.client ? { client: q.client } : {};
  if (FINDS_REPLY.has(q.platform))
    return (since) =>
      content().findReply({
        platform: q.platform,
        on: q.parent ?? q.post,
        to: q.to ?? null,
        text: q.text,
        since,
        ...client,
      });
  if (!MARKS_MINE.has(q.platform)) return undefined;
  return async () => {
    const rows = await content().comments({ platform: q.platform, id: q.post, ...client });
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
