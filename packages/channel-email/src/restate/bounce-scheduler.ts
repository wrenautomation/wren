/**
 * `BounceScheduler/all`: marketing email bounces, read hourly from every sending mailbox
 * (`../inbox/marketing-bounces.ts`). Wren's own (portal@'s mailbox) into main; each client's,
 * the one it picked in Account → Messaging, into the client's own database. A client's mailbox
 * connected to send only can't be read: it is skipped, and Account → Messaging says so. No
 * workspace's failure stops another's.
 */
import type * as restate from "@restatedev/restate-sdk";
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
  /** Each workspace read: `wren`, or the client's id. */
  read: Record<string, BounceReadStats>;
  skipped: Array<{ client: string; mailbox: string; why: string }>;
  failed: Array<{ client: string; mailbox: string; error: string }>;
}

/** Why a client's sender isn't read, in the words the pass keeps. */
export const SEND_ONLY = "connected to send only: its bounces can't be read";

/** One pass over Wren's mailbox and every client's sender. */
export async function readAllBounces(d: BounceSchedulerDeps, now: Date): Promise<BouncePassStats> {
  const out: BouncePassStats = { read: {}, skipped: [], failed: [] };
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
    let sender = "*";
    try {
      const cdb = d.clientDb(client);
      const picked = (await readMessageSettings(cdb)).sender;
      if (!picked) continue;
      sender = picked.trim().toLowerCase();
      const box = (await d.boxesOf(client)).find((b) => b.address.toLowerCase() === sender);
      if (!box) {
        out.skipped.push({ client, mailbox: sender, why: SEND_ONLY });
        continue;
      }
      out.read[client] = await readBounces(cdb, box, now);
    } catch (err) {
      fail(client, sender, err);
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
