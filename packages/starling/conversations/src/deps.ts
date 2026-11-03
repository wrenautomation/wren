/**
 * What the turn stores ask of the channel that owns the account (designs/2026-11-02-starling.md,
 * R2): ports, so conversations names no outbound table. Outbound composes `reachTurns`; the
 * worker passes it where a turn function asks for a `Pick` of this.
 */
import type { Queryable } from "@wren/db";
import type { ItemKinds } from "@wren/starling-acts";

export interface TurnDeps {
  /** Every draft item kind the executor settles: the channel's and the turn stores'. */
  kinds: ItemKinds;
  /** The account's comments so far today, against its warmup cap. */
  commentsToday(db: Queryable, accountId: string, now: Date): Promise<number>;
  /** His past comment decisions as a prompt block, closest to `about` first; "" with none. */
  examplesFor(db: Queryable, about: string): Promise<string>;
  /** Handles passed on (no DM) on `platform`, as `passKey` writes them. */
  passedOn(db: Queryable, platform: string): Promise<Set<string>>;
  /** Our answer `ref` was warmup: a reply to it is no touch. */
  warmupAnswer(db: Queryable, ref: string): Promise<boolean>;
  /** One line on who each handle is, from the channel's read of them; null when unread. */
  about(
    db: Queryable,
    platform: string,
    handles: readonly string[],
  ): Promise<Map<string, string | null>>;
}
