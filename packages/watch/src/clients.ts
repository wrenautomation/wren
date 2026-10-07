/**
 * `MailReader/all` (designs/2026-10-07-mail-access.md): the Monitor's reader made per client.
 * Every 15 minutes, each client with a mailbox connected to read: new inbox mail since the newest
 * kept, into the client's own `watch.mail`, then onto its `mail` workflow, where triage settles it
 * by the client's rules and what shows lands in Marketing → Inbox. Headers and the preview only.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Mailbox } from "@wren/core/mailbox";
import { makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { readMail } from "./read.js";
import { mailEvent } from "./triage.js";

export const MAIL_READER_EVERY_MS = 15 * 60_000;
/** The client workflow, and the node the reader is in it. */
export const MAIL_FLOW = "mail";
export const MAIL_FROM = "read.mail";

export interface MailReaderDeps {
  /** Main: the pass's ledger. */
  db: Db;
  clientDb: (client: string) => Db;
  /** Clients with a mailbox connected to read. */
  clients: () => Promise<string[]>;
  /** A client's mailboxes connected to read. */
  boxesOf: (client: string) => Promise<Mailbox[]>;
  /** Housekeeping on each pass: old sign-in grants swept. */
  sweep?: (now: Date) => Promise<void>;
}

export interface ClientReadStats {
  /** Kept ids per client, each onto that client's `mail` workflow. */
  kept: Record<string, number[]>;
  failed: Array<{ client: string; mailbox: string; error: string }>;
}

/** One pass over every client: no client's failure stops another's read. */
export async function readClients(d: MailReaderDeps, now: Date): Promise<ClientReadStats> {
  const out: ClientReadStats = { kept: {}, failed: [] };
  await d.sweep?.(now);
  for (const client of await d.clients()) {
    try {
      const s = await readMail(d.clientDb(client), await d.boxesOf(client), now, "mail");
      if (s.kept.length) out.kept[client] = s.kept;
      for (const f of s.failed) out.failed.push({ client, ...f });
    } catch (err) {
      out.failed.push({ client, mailbox: "*", error: String(err).slice(0, 300) });
    }
  }
  return out;
}

export function makeMailReader(deps: MailReaderDeps) {
  return makeLoopObject("MailReader", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<ClientReadStats>(ctx, deps.db, now, {
      name: "read",
      ledger: { command: "mail read", argv: { daemon: true } },
      body: () => readClients(deps, now),
      delayAfter: () => MAIL_READER_EVERY_MS,
      retryMs: MAIL_READER_EVERY_MS,
    })) as PassOutcome<ClientReadStats>;
    for (const [client, kept] of Object.entries(outcome.stats?.kept ?? {}))
      spineEmit(ctx, { client, workflow: MAIL_FLOW, from: MAIL_FROM, events: kept.map(mailEvent) });
    return outcome;
  });
}
