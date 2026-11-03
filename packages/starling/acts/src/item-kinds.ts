/**
 * What a draft item of one kind is, as the package that owns the kind tells the act base
 * (designs/2026-11-02-starling.md, review 2026-11-03). Acts reads no channel's tables: the
 * account picker asks the kind for the item's platform and default account, the send's settle
 * asks it to record a landed send or to close a dropped one. Outbound owns `thread`, `onpost`,
 * `dm`, `invite`; the comment kinds `comment`, `private` go with the comment store; inbound owns
 * `draft`. A desk passes the kinds it serves (`ItemKinds`); a kind not in the table is refused,
 * never guessed. `sdm` (a client's DM answer) settles in SocialInbox and has no kind here.
 */
import type { Queryable } from "@wren/db";
import { ReachRefusal } from "./refusal.js";
import type { ReachAccount } from "./schema.js";
import { sendAttempt } from "./send-attempts.js";

export const ITEM_KINDS = [
  "thread",
  "comment",
  "onpost",
  "dm",
  "invite",
  "private",
  "sdm",
  "draft",
] as const;
export type ItemKindName = (typeof ITEM_KINDS)[number];

/** Where an item goes out: its platform and, on Reddit, the subreddit whose floor applies. */
export interface ItemPlace {
  platform: string;
  sub: string | null;
}

/** A send that landed, as the ledger row has it; the kind records it on the item. */
export interface Landed {
  body: string;
  /** The login it went out as; null = the platform's default. */
  account: string | null;
  ref: string | null;
  /** `wren` when a rule sent it: no person's edit of the draft to keep. */
  via?: "person" | "wren";
  now: Date;
  by: string;
}

export interface ItemKind {
  /** The item's place; null when there is no such item. */
  place(db: Queryable, id: string): Promise<ItemPlace | null>;
  /** The account it goes out as with no pick: its place's, the one they spoke to; null = default. */
  fallback(db: Queryable, id: string): Promise<string | null>;
  /** The sub's floor read once: a judge of each account, "r/x needs 50 karma, alt has 1"; null = fine. */
  floors?(
    db: Queryable,
    sub: string,
    now: Date,
  ): Promise<(account: ReachAccount, label: string) => string | null>;
  /** The send went out: the item's state, its touch, the draft record. Absent: it settles elsewhere. */
  landed?(tx: Queryable, id: string, o: Landed): Promise<void>;
  /** It did not go out and stays out: close it as a person's skip closes this kind. */
  dropped?(db: Queryable, id: string, o: { by: string; now: Date; note: string }): Promise<void>;
}

/** The kinds a desk serves, by name. */
export type ItemKinds = Partial<Record<ItemKindName, ItemKind>>;

/** `<kind>:<id>` split; refuses a kind no package owns. */
export function itemOf(item: string): { kind: ItemKindName; id: string } {
  const at = item.indexOf(":");
  const kind = item.slice(0, at);
  if (at < 1 || !(ITEM_KINDS as readonly string[]).includes(kind) || at === item.length - 1)
    throw new ReachRefusal(`not a draft item: ${item}`);
  return { kind: kind as ItemKindName, id: item.slice(at + 1) };
}

/**
 * One record of a landed send per item kind (designs/2026-10-16-maybe-sent.md, C1). The send's
 * settle and a person's Mark posted both call it, so the two record the same thing. It reads the
 * words, account and `via` from the ledger row, in the settle's transaction.
 */
export async function recordLanded(
  tx: Queryable,
  item: string,
  kinds: ItemKinds,
  o: { ref: string | null; now: Date; by: string },
): Promise<void> {
  const a = await sendAttempt(tx, item);
  if (!a) throw new ReachRefusal(`no send ${item}`);
  const { kind, id } = itemOf(item);
  const landed = kinds[kind]?.landed;
  if (!landed) throw new ReachRefusal(`${kind} keeps its own record of a send`);
  await landed(tx, id, {
    body: a.words,
    account: a.account,
    ref: o.ref,
    ...(a.via ? { via: a.via } : {}),
    now: o.now,
    by: o.by,
  });
}
