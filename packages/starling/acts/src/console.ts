/**
 * What every console list of items shares (designs/2026-11-02-starling.md, R3): the state cue a
 * row shows, the newest pick on a drafted comment, and a send that may have gone out standing in
 * for the row it came from. Each channel shapes its own rows; the app's lists lay these over all.
 */
import { pickStates, picksOf } from "@wren/core/decide";
import { status } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import type { SendAttempt } from "./schema.js";

/** One row of a console list; keys are the record's field names in snake case. */
export type ConsoleRow = Record<string, unknown>;

const neutral = (label: string) => ({ label, tone: "neutral" as const });

/** A row's state, as every list says it. */
export const ITEM_STATES = status({
  new: { label: "New", tone: "warn" },
  waiting: { label: "Waiting on you", tone: "warn" },
  scheduled: { label: "Scheduled", tone: "good" },
  answered: { label: "Answered", tone: "good" },
  sent: { label: "Sent", tone: "good" },
  queued: neutral("Queued"),
  held: {
    label: "Held",
    tone: "warn",
    about:
      "The subreddit asks for more karma or an older account than ours has, or removed our last comment without saying why. It stays queued and sends itself once the rule is met.",
  },
  dropped: neutral("Dropped"),
  read: neutral("Read"),
  seen: neutral("Seen"),
  left: neutral("Left"),
});

/**
 * Each drafted comment's newest pick (designs/2026-10-16-decide.md), on rows whose id is the
 * draft's item. Only when comment drafts show their picks (recommend or gate); his call still rules.
 */
const DRAFTED = /^(thread|onpost|comment):/;
export async function withPicks<R extends object>(db: Queryable, rows: R[]): Promise<R[]> {
  const idOf = (r: R) => String((r as { id?: unknown }).id);
  const picks = await picksOf(
    db,
    "comment_quality",
    rows.map(idOf).filter((id) => DRAFTED.test(id)),
  );
  if (!picks.size) return rows;
  return rows.map((r) => {
    const p = picks.get(idOf(r));
    return p ? { ...r, pick: p.label } : r;
  });
}
export const PICK_FIELD = () => status(pickStates("comment_quality"), "Suggests");

/**
 * A send that may have gone out and no read could tell (designs/2026-10-16-maybe-sent.md): its
 * own row, over the queued one it came from (`thread:`, `onpost:`), which nothing sends meanwhile.
 */
export const unsureRow = (u: SendAttempt, from: ConsoleRow | undefined): ConsoleRow => ({
  ...(from ?? {}),
  id: `unsure:${u.item}`,
  type: "unsure",
  who: from?.who ?? u.target,
  platform: u.platform,
  kind: "unsure",
  state: "waiting",
  body: u.words,
  draft: null,
  unsure: u.why,
  account: u.account,
  at: u.updatedAt,
  due: u.updatedAt,
  send_at: null,
  on_site: u.url,
});
/** Rows an unsure send stands in for leave the list; its own row takes their place. */
export const unsureOver = (us: SendAttempt[], rows: ConsoleRow[]): ConsoleRow[] => {
  const by = new Map(rows.map((r) => [String(r.id), r]));
  return us.map((u) => unsureRow(u, by.get(u.item)));
};
export const notParked = (us: SendAttempt[]) => {
  const parked = new Set(us.map((u) => u.item));
  return (r: ConsoleRow) => !parked.has(String(r.id));
};
