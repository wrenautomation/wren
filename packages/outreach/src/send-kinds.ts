/**
 * One record of a landed send per item kind (designs/2026-10-16-maybe-sent.md, C1). The send's
 * settle and a person's Mark posted both call it, so the two record the same thing. It reads the
 * words, account and `via` from the ledger row, in the settle's transaction.
 */
import { keepSentEdit } from "@wren/core/ask";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { commentById, markAnswered, privateReplied } from "./comments.js";
import { markCommented } from "./discovery/threads.js";
import { markPostCommented } from "./reach-posts/acts.js";
import { ReachRefusal } from "./refusal.js";
import { reachAccounts, reachPosts, redditThreads } from "./schema.js";
import { sendAttempt } from "./send-attempts.js";

/** The kinds recorded here; `dm`, `sdm` and `draft` keep their own records. */
export const LANDED_KINDS = ["thread", "comment", "onpost", "private"] as const;

export async function recordLanded(
  tx: Queryable,
  item: string,
  o: { ref: string | null; now: Date; by: string },
): Promise<void> {
  const a = await sendAttempt(tx, item);
  if (!a) throw new ReachRefusal(`no send ${item}`);
  const at = item.indexOf(":");
  const kind = item.slice(0, at);
  const id = item.slice(at + 1);
  const body = a.words;
  const via = a.via ?? undefined;
  if (kind === "thread") {
    // CP: no account, no record; a guess would credit the wrong login.
    const [acct] = a.account
      ? await tx
          .select({ id: reachAccounts.id })
          .from(reachAccounts)
          .where(eq(reachAccounts.account, a.account))
      : [];
    if (!acct) throw new ReachRefusal(`no account ${a.account ?? ""} for ${item}`);
    const [t] = await tx
      .select({ draft: redditThreads.draft })
      .from(redditThreads)
      .where(eq(redditThreads.id, id));
    await keepSentEdit(tx, {
      record: "thread",
      id,
      by: o.by,
      before: t?.draft ?? null,
      after: body,
    });
    await markCommented(tx, id, { body, ref: o.ref, accountId: acct.id, now: o.now, by: o.by });
  } else if (kind === "comment") {
    const c = await commentById(tx, Number(id));
    // A rule's words are no person's edit of the draft.
    if (via !== "wren")
      await keepSentEdit(tx, { record: "comment", id, by: o.by, before: c.draft, after: body });
    await markAnswered(tx, c.id, {
      body,
      ref: o.ref,
      now: o.now,
      by: o.by,
      ...(via ? { via } : {}),
    });
  } else if (kind === "onpost") {
    const [post] = await tx
      .select()
      .from(reachPosts)
      .where(eq(reachPosts.id, Number(id)));
    if (!post) throw new ReachRefusal(`no post ${id}`);
    await markPostCommented(tx, post, { body, by: o.by, now: o.now });
  } else if (kind === "private") {
    const c = await commentById(tx, Number(id));
    await privateReplied(tx, c, {
      body,
      ref: o.ref,
      now: o.now,
      by: o.by,
      ...(via ? { via } : {}),
    });
  } else throw new ReachRefusal(`${kind} keeps its own record of a send`);
}
