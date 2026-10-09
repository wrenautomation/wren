/**
 * A 1 or 2 star review rings like an `@` mention (designs/2026-10-09-review-replies.md): a note on
 * its Inbox thread `@`s the client's owners, and the mention mail tells them once.
 */
import { clientMembers } from "@wren/core/clients";
import type { Db, Queryable } from "@wren/db";
import { addInboxNote } from "@wren/notes/inbox";
import { comments } from "@wren/outreach";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";

/** At or under this many stars, the owners hear of it. */
export const RING_STARS = 2;

/** The note on a low review's thread, `@`ing each owner. */
export const ringNote = (stars: number, author: string, owners: readonly string[]) =>
  `${stars} star review from ${author}. It needs a reply. ${owners.map((o) => `@${o}`).join(" ")}`;

/** Ring the owners of `client` for each new low review in `ids`. The number rung. */
export async function ringLowReviews(
  main: Queryable,
  db: Db,
  client: string,
  ids: readonly number[],
  now: Date,
): Promise<number> {
  if (!ids.length) return 0;
  const low = await db
    .select({ id: comments.id, stars: comments.stars, author: comments.author })
    .from(comments)
    .where(
      and(
        inArray(comments.id, [...ids]),
        eq(comments.kind, "review"),
        lte(comments.stars, RING_STARS),
        isNull(comments.answeredAt),
      ),
    );
  if (!low.length) return 0;
  const owners = (
    await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, client), eq(clientMembers.role, "owner")))
  ).map((o) => o.email.toLowerCase());
  if (!owners.length) return 0;
  for (const r of low)
    await addInboxNote(db, {
      thread: `comment:${r.id}`,
      personId: null,
      body: ringNote(r.stars ?? RING_STARS, r.author, owners),
      by: "wren",
      team: owners,
      now,
    });
  return low.length;
}
