/**
 * `BounceScheduler/all`: marketing email bounces, read hourly from every sending mailbox
 * (`../inbox/marketing-bounces.ts`). Wren's own (portal@'s mailbox) into main; each client's,
 * the one it picked in Account → Messaging, into the client's own database, and the ones it
 * picked before, for as long as late bounces can come. A client's mailbox connected to send only
 * can't be read: it is skipped, and Account → Messaging says so. No workspace's or mailbox's
 * failure stops another's.
 */
import type * as restate from "@restatedev/restate-sdk";
import { bounceMailboxes, noteBounceSender } from "@wren/core/bounces";
import type { Mailbox } from "@wren/core/mailbox";
import { readMessageSettings } from "@wren/core/message-settings";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { type BounceReadStats, readBounces } from "../inbox/marketing-bounces.js";

export const BOUNCES_KEY = "all";
export const BOUNCES_COMMAND = "marketing bounces read";
export const BOUNCES_EVERY_MS = 3_600_000;

export interface BounceSchedulerDeps {
  /** Main: Wren's own records and the pass's ledger. */
  db: Db;
  /** Wren's sending mailbox, read through the service account; null: Wren has none. */
  wren: Mailbox | null;
  clientDb: (client: string) => Db;
  /** Clients with a mailbox connected to read. */
  clients: () => Promise<string[]>;
  /** A client's mailboxes connected to read. */
  boxesOf: (client: string) => Promise<Mailbox[]>;
  /** Between passes (default 1 hour). */
  everyMs?: number;
}

export interface BouncePassStats {
  /** Each workspace's current sender read: `wren`, or the client's id. */
  read: Record<string, BounceReadStats>;
  /** A client's earlier senders, read for their late bounces. */
  earlier: Array<{ client: string } & BounceReadStats>;
  skipped: Array<{ client: string; mailbox: string; why: string }>;
  failed: Array<{ client: string; mailbox: string; error: string }>;
}

/** Why a client's sender isn't read, in the words the pass keeps. */
export const SEND_ONLY = "connected to send only: its bounces can't be read";

/** Why an earlier sender isn't read, in the words the pass keeps. */
export const GONE = "not connected to read: its late bounces can't be read";

/**
 * One pass over Wren's mailbox and every client's senders: the one it picked now, and any it
 * picked within `BOUNCE_LATE_MS` before (a bounce can come back long after the send, to the
 * mailbox that sent it).
 */
export async function readAllBounces(d: BounceSchedulerDeps, now: Date): Promise<BouncePassStats> {
  const out: BouncePassStats = { read: {}, earlier: [], skipped: [], failed: [] };
  const fail = (client: string, mailbox: string, err: unknown) =>
    out.failed.push({ client, mailbox, error: String(err).slice(0, 300) });
  if (d.wren) {
    try {
      out.read.wren = await readBounces(d.db, d.wren, now);
    } catch (err) {
      fail("wren", d.wren.address, err);
    }
  }
  for (const client of await d.clients()) {
    try {
      const cdb = d.clientDb(client);
      const picked = (await readMessageSettings(cdb)).sender?.trim().toLowerCase() ?? null;
      const boxes = await d.boxesOf(client);
      const boxOf = (address: string) => boxes.find((b) => b.address.toLowerCase() === address);
      // Each mailbox on its own, so one that won't read doesn't stop the next.
      if (picked) {
        const box = boxOf(picked);
        if (!box) out.skipped.push({ client, mailbox: picked, why: SEND_ONLY });
        else {
          try {
            await noteBounceSender(cdb, box.address, now);
            out.read[client] = await readBounces(cdb, box, now);
          } catch (err) {
            fail(client, picked, err);
          }
        }
      }
      for (const earlier of await bounceMailboxes(cdb, now)) {
        if (earlier === picked) continue;
        const box = boxOf(earlier);
        if (!box) {
          out.skipped.push({ client, mailbox: earlier, why: GONE });
          continue;
        }
        try {
          out.earlier.push({ client, ...(await readBounces(cdb, box, now)) });
        } catch (err) {
          fail(client, earlier, err);
        }
      }
    } catch (err) {
      fail(client, "*", err);
    }
  }
  return out;
}

export function makeBounceScheduler(deps: BounceSchedulerDeps) {
  const every = deps.everyMs ?? BOUNCES_EVERY_MS;
  return makeLoopObject("BounceScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return runPass<BouncePassStats>(ctx, deps.db, now, {
      name: "bounces read",
      ledger: { command: BOUNCES_COMMAND, argv: { daemon: true } },
      body: () => readAllBounces(deps, now),
      delayAfter: () => every,
      retryMs: every,
    });
  });
}

export type BounceScheduler = ReturnType<typeof makeBounceScheduler>;
