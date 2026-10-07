/**
 * One day of the books, unattended: keep new billing mail from every mailbox,
 * read it, post the journal, take in metered spend, then say what changed.
 * A mailbox that cannot be reached is an alert, not a failed day: the others
 * still count, and the next pass searches the whole window again.
 */
import { errorText } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { bookConditions, type Condition, settleAlerts } from "./alerts.js";
import { type Captured, capture } from "./capture.js";
import { seedBooks } from "./chart.js";
import { shiftDay, today } from "./day.js";
import type { Mailbox } from "./mailbox.js";
import { type Posted, post } from "./post.js";
import type { RateFeed } from "./rates.js";
import { type ReadReport, readDocuments } from "./read.js";
import type { AlertKind } from "./schema.js";
import type { DocumentStore } from "./store.js";
import { ingestUsage, type UsageFeed, type UsageIngest, usageSpikes } from "./usage.js";
import { monthOf, writeUsageLines } from "./usage-lines.js";

export interface BooksDayDeps {
  db: Db;
  mailboxes: readonly Mailbox[];
  store: DocumentStore;
  llm: LlmClient;
  rates: RateFeed;
  /** AWS spend; null = not tracked. */
  aws: UsageFeed | null;
  /** The first day of the books: every search covers from here, so a new vendor rule finds old mail too. */
  since: string;
  log?: (line: string) => void;
}

export interface BooksDay {
  captured: Captured[];
  /** Mailboxes that could not be searched this pass, with why. */
  unreachable: Array<{ mailbox: string; error: string }>;
  read: ReadReport;
  posted: Posted;
  aws: UsageIngest | null;
  /** Managed usage's draft lines for this month and last, rewritten. */
  usageLines: { month: string; lines: number; amountCents: number }[];
  /** Newly raised alerts' messages, for the one notice a pass sends. */
  raised: string[];
}

export async function booksDay(
  deps: BooksDayDeps,
  now: Date,
  runId: string | null,
): Promise<BooksDay> {
  const { db, log } = deps;
  const on = today(now);
  await seedBooks(db);
  const captured: BooksDay["captured"] = [];
  const unreachable: BooksDay["unreachable"] = [];
  for (const m of deps.mailboxes) {
    try {
      captured.push(
        await capture(db, m, { since: deps.since, store: deps.store, runId, ...opt(log) }),
      );
    } catch (err) {
      unreachable.push({ mailbox: m.address, error: errorText(err) });
    }
  }
  const read = await readDocuments(db, deps.llm, { runId, ...opt(log) });
  const posted = await post(db, { feed: deps.rates, runId, ...opt(log) });

  const kinds: AlertKind[] = ["held", "unread", "new_subscription", "renewal", "lapsed"];
  const open: Condition[] = await bookConditions(db, on);
  // A mailbox's alert clears only when a pass reaches it again.
  kinds.push("capture");
  for (const u of unreachable)
    open.push({
      key: `capture:${u.mailbox}`,
      kind: "capture",
      message: `could not read ${u.mailbox}: ${u.error}`,
    });

  let aws: UsageIngest | null = null;
  if (deps.aws) {
    aws = await ingestUsage(db, "aws", deps.aws, { since: deps.since, on });
    kinds.push("spike");
    // Yesterday is the newest whole day.
    for (const s of await usageSpikes(db, "aws", shiftDay(on, -1)))
      open.push({
        key: `spike:aws:${s.service}:${s.on}`,
        kind: "spike",
        message: `AWS ${s.service} on ${s.on}: ${s.amount.toFixed(2)} ${s.currency}, usually ${s.usual.toFixed(2)} a day`,
      });
  }
  // Last month's drafts keep updating until a person puts them on an invoice.
  const lastMonth = monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const usageLines = [];
  for (const month of [lastMonth, monthOf(now)]) {
    const r = await writeUsageLines(db, month);
    usageLines.push({ month, lines: r.lines, amountCents: r.amountCents });
  }
  const raised = await settleAlerts(db, kinds, open);
  return {
    captured,
    unreachable,
    read,
    posted,
    aws,
    usageLines,
    raised: raised.map((c) => c.message),
  };
}

const opt = (log: ((line: string) => void) | undefined) => (log ? { log } : {});
