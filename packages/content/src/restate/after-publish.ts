/**
 * What follows a post that is up: the row marked, the ledger settled, the first comment, the
 * warm-replies hook. One path for the scheduler (`finish`) and the desk (`settlePost` found).
 * The comment is a write of its own with a key of its own (`<sendKey> comment`), so a rerun
 * never posts a second one.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Platform, Published } from "@wren/core/content";
import { errorText, LIMITS, within } from "@wren/core/restate";
import { type Delivery, isDelivery } from "@wren/core/send-verdict";
import type { Db } from "@wren/db";
import { settleSent } from "@wren/outreach";
import { markPublished, noteOnDraft } from "../queue.js";

/** A first comment is a nicety: waited on this long, then noted on the draft. */
const COMMENT_WAIT_MS = LIMITS.read;

/** `Content/reply` as the core serves it: given a send key it answers a `Delivery`. */
export type ReplyService = {
  reply: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      commentId: string;
      text: string;
      client?: string | null;
      account?: string | null;
      sendKey?: string;
    },
  ) => Promise<void | Delivery<void>>;
};

/** The post that went up. */
interface PostedDraft {
  draftId: string;
  platform: Platform;
  /** The funnel link, for the row and the first comment. */
  link: string | null;
  comment: string | null;
  account: string | null;
  /** The ledger row's send key; none: the comment goes unkeyed (an older pass's). */
  sendKey?: string | undefined;
}

/** A client's post, or Wren's at null. */
interface PostedOwner {
  db: Db;
  client: string | null;
  /** The platform now has a post of ours: its replies read warm. */
  posted?:
    | ((ctx: restate.ObjectContext, platform: Platform, client: string | null) => void)
    | undefined;
}

/** What a comment's answer says when it did not go out clean: a note for the draft, or null. */
function notedOf(d: Delivery<unknown>): string | null {
  if (d.kind === "sent" || d.kind === "found") return null;
  return d.kind === "unknown" ? `it may have gone out: ${d.reason}` : d.reason;
}

/**
 * Mark the draft published and settle `draft:<id>`, then the first comment (noted on the draft if
 * it fails, never retried into a second one), then the `posted` hook. `by` is who said the
 * post is up: the publish itself, or autobrowse's read of the site. `recordedBy` is who the row
 * names: the scheduler, or the person whose word it was.
 */
export async function afterPublish(
  ctx: restate.ObjectContext,
  o: PostedOwner,
  content: restate.Client<ReplyService>,
  p: PostedDraft,
  published: Published,
  by: "sent" | "found",
  recordedBy = "scheduler",
): Promise<void> {
  const now = new Date(await ctx.date.now());
  await ctx.run(`published ${p.draftId}`, async () => {
    await markPublished(o.db, p.draftId, published, p.link, recordedBy);
    await settleSent(o.db, `draft:${p.draftId}`, {
      ref: published.id || null,
      at: new Date(published.publishedAt),
      by,
      now,
    });
  });
  if (p.comment && published.id) {
    const commented = await within(
      ctx,
      content.reply({
        platform: p.platform,
        commentId: published.id,
        text: p.comment,
        ...(o.client ? { client: o.client } : {}),
        ...(p.account ? { account: p.account } : {}),
        ...(p.sendKey ? { sendKey: `${p.sendKey} comment` } : {}),
      }),
      // A write: left running past the wait, since it may still land.
      { ms: COMMENT_WAIT_MS, call: "Content/reply", unit: p.draftId, keep: true },
    ).then(
      (got) => (isDelivery(got) ? notedOf(got) : null),
      (err: unknown) => errorText(err),
    );
    if (commented)
      await ctx.run(`comment failed ${p.draftId}`, () =>
        noteOnDraft(o.db, p.draftId, `First comment with the link failed: ${commented}`),
      );
  }
  o.posted?.(ctx, p.platform, o.client);
}
