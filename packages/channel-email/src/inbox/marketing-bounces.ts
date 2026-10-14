/**
 * Marketing bounce reading: one workspace's sending mailbox, read for delivery reports since its
 * last check. Each candidate is looked at by sender and subject first (`mayBeBounce`), then read
 * whole and classified by the same reader the cold inbox uses (`classify`, `./inbound.ts`), then
 * handed to core's `recordBounce`, which matches it to a broadcast or a workflow send and acts.
 *
 * Gmail is asked for reports only, Spam and Trash too (it spam-files reports from unusual
 * servers). Graph's reader honours the time alone, so every inbox message since then gets the
 * cheap look. A re-read skips what was kept before; a report that matched nothing is looked at
 * again only inside the overlap.
 */
import {
  type BounceVerdict,
  bouncesReadAt,
  keptBounces,
  markBouncesRead,
  recordBounce,
} from "@wren/core/bounces";
import type { Mailbox } from "@wren/core/mailbox";
import type { Queryable } from "@wren/db";
import { classify, mayBeBounce } from "./inbound.js";

/** Gmail's search for delivery reports; Graph reads only its `after:`. */
export const BOUNCE_QUERY =
  "in:anywhere -in:sent -in:draft (from:mailer-daemon OR from:postmaster" +
  ' OR subject:undeliverable OR subject:"delivery status notification"' +
  ' OR subject:"undelivered mail" OR subject:"mail delivery failed"' +
  ' OR subject:"delivery has failed" OR subject:"returned mail")';
/** A mailbox's first check reaches back this far: mail servers give up within five days. */
export const BOUNCE_FIRST_MS = 7 * 86_400_000;
/** Each later check re-lists this much, for reports that land late in the listing. */
export const BOUNCE_OVERLAP_MS = 15 * 60_000;

export interface BounceReadStats {
  mailbox: string;
  listed: number;
  /** Kept on an earlier check. */
  kept: number;
  /** Not a delivery failure: other mail, a delivery receipt. */
  other: number;
  /** A report for none of our marketing sends. */
  unmatched: number;
  soft: number;
  /** Hard: the address went on do-not-contact. */
  suppressed: number;
  /** Hard, but for another address than the one we mailed: kept only. */
  mismatch: number;
  errors: number;
}

const VERDICT_COUNT: Record<Exclude<BounceVerdict, "seen">, keyof BounceReadStats> = {
  unmatched: "unmatched",
  soft: "soft",
  suppressed: "suppressed",
  mismatch: "mismatch",
};

/**
 * Read one sending mailbox from its last check to `now` and act on each report, in `db` (the
 * workspace's own). A failed listing throws and leaves the last check where it was; a failed read
 * of one message is counted and the rest go on.
 */
export async function readBounces(
  db: Queryable,
  box: Mailbox,
  now: Date,
  onError?: (id: string, err: unknown) => void,
): Promise<BounceReadStats> {
  const s: BounceReadStats = {
    mailbox: box.address,
    listed: 0,
    kept: 0,
    other: 0,
    unmatched: 0,
    soft: 0,
    suppressed: 0,
    mismatch: 0,
    errors: 0,
  };
  const last = await bouncesReadAt(db, box.address);
  const since = last ? last.getTime() - BOUNCE_OVERLAP_MS : now.getTime() - BOUNCE_FIRST_MS;
  const ids = await box.search(`after:${Math.floor(since / 1000)} ${BOUNCE_QUERY}`);
  s.listed = ids.length;
  const kept = await keptBounces(db, box.address, ids);
  for (const id of ids) {
    if (kept.has(id)) {
      s.kept += 1;
      continue;
    }
    try {
      const meta = await box.meta(id);
      if (!mayBeBounce(meta)) {
        s.other += 1;
        continue;
      }
      const inbound = classify(await box.raw(id));
      if (inbound.kind !== "bounce" || !inbound.bounceClass) {
        s.other += 1;
        continue;
      }
      const verdict = await recordBounce(db, {
        mailbox: box.address,
        providerId: id,
        messageIds: [
          ...(inbound.originalMessageId ? [inbound.originalMessageId] : []),
          ...inbound.references,
          ...(inbound.inReplyTo ? [inbound.inReplyTo] : []),
        ],
        address: inbound.bouncedAddress,
        class: inbound.bounceClass,
        status: inbound.bounceStatus,
        diagnostic: inbound.diagnostic,
        receivedAt: meta.at.getTime() > 0 ? meta.at : (inbound.date ?? now),
      });
      if (verdict === "seen") s.kept += 1;
      else (s[VERDICT_COUNT[verdict]] as number) += 1;
    } catch (err) {
      s.errors += 1;
      onError?.(id, err);
    }
  }
  await markBouncesRead(db, box.address, now, { ...s });
  return s;
}
