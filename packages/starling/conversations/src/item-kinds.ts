/**
 * The turn stores' draft item kinds for the act base (`@wren/starling-acts` ItemKinds): where
 * each goes out, its default account, and what a landed or dropped send does to it. `comment`
 * carries no floors here: the channel that owns the account overlays its own (outbound's Reddit
 * floors in `reachKinds`). `dm` has no `landed`: a DM's settle moves its sequence on, outbound's
 * `markDmPosted`.
 */
import { keepSentEdit } from "@wren/core/ask";
import type { Queryable } from "@wren/db";
import { type ItemKind, type ItemKinds, ReachRefusal } from "@wren/starling-acts";
import { and, eq, sql } from "drizzle-orm";
import { commentById, dropComment, markAnswered, privateReplied } from "./comments.js";
import { setContactState } from "./contacts.js";
import { reachMessages } from "./schema.js";

type Place = { platform: string; sub: string | null };
const one = async <T>(db: Queryable, q: ReturnType<typeof sql>): Promise<T | null> =>
  ((await db.execute(q)) as unknown as T[])[0] ?? null;
const num = (id: string) => (/^\d+$/.test(id) ? Number(id) : null);

const contactPlace = (db: Queryable, id: string) => {
  const n = num(id);
  return n === null
    ? Promise.resolve(null)
    : one<Place>(db, sql`select platform, null sub from reach_contacts where id = ${n}`);
};
const contactFallback = async (db: Queryable, id: string) => {
  const n = num(id);
  if (n === null) return null;
  const r = await one<{ account: string | null }>(
    db,
    sql`select a.account from reach_contacts c join reach_accounts a on a.id = c.account_id
      where c.id = ${n}`,
  );
  return r?.account ?? null;
};

const comment: ItemKind = {
  place: (db, id) =>
    num(id) === null
      ? Promise.resolve(null)
      : one<Place>(
          db,
          sql`select platform, case when platform = 'reddit' then lower(regexp_replace(place, '^r/', '')) end sub
            from comments where id = ${Number(id)}`,
        ),
  fallback: async (db, id) => {
    const n = num(id);
    if (n === null) return null;
    const r = await one<{ account: string | null }>(
      db,
      sql`select a.account from comments c join reach_accounts a on a.id = c.account_id where c.id = ${n}`,
    );
    return r?.account ?? null;
  },
  async landed(tx, id, o) {
    const c = await commentById(tx, Number(id));
    // A rule's words are no person's edit of the draft.
    if (o.via !== "wren")
      await keepSentEdit(tx, { record: "comment", id, by: o.by, before: c.draft, after: o.body });
    await markAnswered(tx, c.id, {
      body: o.body,
      ref: o.ref,
      now: o.now,
      by: o.by,
      ...(o.via ? { via: o.via } : {}),
    });
  },
  dropped: (db, id, o) => dropComment(db, Number(id), { by: o.by, note: o.note }),
};

/** A DM from a comment on our own post. Dropped: only the ledger row goes; the comment stays. */
const privateKind: ItemKind = {
  place: comment.place,
  fallback: comment.fallback,
  async landed(tx, id, o) {
    const c = await commentById(tx, Number(id));
    await privateReplied(tx, c, {
      body: o.body,
      ref: o.ref,
      now: o.now,
      by: o.by,
      ...(o.via ? { via: o.via } : {}),
    });
  },
  dropped: async () => {},
};

/** A DM: skipped and the contact finished, as a skipped invite does. Its "posted" is `markDmPosted`. */
const dm: ItemKind = {
  place: contactPlace,
  fallback: contactFallback,
  async dropped(db, id, o) {
    const [m] = await db
      .update(reachMessages)
      .set({ state: "skipped", stateReason: o.note })
      .where(and(eq(reachMessages.id, Number(id)), eq(reachMessages.state, "unknown")))
      .returning({ contactId: reachMessages.contactId });
    if (!m) throw new ReachRefusal("that message is no longer waiting");
    await setContactState(db, m.contactId, "finished", { reason: o.note, now: o.now });
  },
};

const invite: ItemKind = { place: contactPlace, fallback: contactFallback };

/** The turn stores' kinds; a channel spreads them into its own. */
export const turnKinds = { comment, private: privateKind, dm, invite } satisfies ItemKinds;
