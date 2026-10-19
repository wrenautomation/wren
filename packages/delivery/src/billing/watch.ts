/**
 * BillingWatch/fleet (designs/2026-10-15-wise-billing.md): every 15 minutes it makes the month's
 * bills from the 1st, mails each new invoice with its PDF, and reads our Wise balances for money
 * in. A credit naming its invoice, or paying one exactly from a payer named like the client, marks
 * it paid; the rest wait in To approve. Wise's `balances#credit` webhook needs a token that can
 * write subscriptions, and ours is read only: so it polls.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { FireTriggers } from "@wren/core/spine";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import { amount } from "../contract.js";
import { billMonth } from "../index.js";
import type { PortalMail } from "../watch.js";
import { type Taken, takeCredits } from "./credits.js";
import { mailInvoices } from "./mail.js";
import type { ReceiveDetails } from "./receive.js";
import { claimInvoiceChanges } from "./tell.js";
import type { WiseReader } from "./wise.js";

export const BILLING_WATCH = "BillingWatch";
export const BILLING_KEY = "fleet";
export const BILLING_COMMAND = "delivery billing watch";

const MINUTE = 60_000;
const EVERY = 15 * MINUTE;
/** Each pass reads this far back: credits are stored once, so the overlap costs nothing. */
const LOOKBACK_MS = 7 * 24 * 60 * MINUTE;

export interface BillingDeps {
  main: Db;
  /** Our Wise account, read only; null = no credits read (no token here). */
  wise: WiseReader | null;
  /** Mails one client person; null = invoices wait unmailed. */
  send: ((m: PortalMail) => Promise<void>) | null;
  /** Where clients wire us, per currency, from the environment. */
  receive: ReceiveDetails;
  /** Our GST/HST registration (`WREN_TAX_NUMBER`), on every invoice. */
  taxNumber?: string;
  /** The portal, for the Billing link: `https://app.<domain>`. */
  app: string;
  /** The fleet's clock: the 1st's bills. */
  zone: string;
  /** Who's told of a payment in, and of one that waits. */
  notifier?: Notifier;
  /** Tells the spine each invoice change once (`trigger.payment`); unset = none told. */
  fire?: FireTriggers;
}

export interface BillingStats {
  /** Invoices made for the month. */
  billed: number;
  mailed: number;
  /** Credits seen for the first time; of them, matched and waiting. */
  credits: number;
  matched: number;
  waiting: number;
  failed: number;
  lastError: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** One line per credit worth a person's eye. */
export function creditLine(t: Taken): string {
  const c = t.credit;
  const sent = amount(c.cents + c.feeCents, c.currency);
  const from = c.payer ? ` from ${c.payer}` : "";
  const on = t.invoice ? `${t.invoice.clientName}, ${t.invoice.number}` : "no invoice";
  return t.match.status === "matched"
    ? `${on}: ${sent}${from} (${t.match.why})`
    : `credit #${c.id}: ${sent}${from}, ${t.match.why}${t.invoice ? ` (likely ${on})` : ""}`;
}

export async function billingPass(deps: BillingDeps, now: Date): Promise<BillingStats> {
  const w = wallClock(deps.zone, now);
  const today = `${w.year}-${pad(w.month)}-${pad(w.day)}`;
  const stats: BillingStats = {
    billed: (await billMonth(deps.main, today.slice(0, 7), today, "billing-watch")).length,
    mailed: 0,
    credits: 0,
    matched: 0,
    waiting: 0,
    failed: 0,
    lastError: null,
  };
  if (deps.send) {
    const m = await mailInvoices(deps.main, deps.send, deps.receive, deps.app, now, deps.taxNumber);
    stats.mailed = m.mailed;
    stats.failed += m.failed;
    stats.lastError = m.lastError;
    if (m.sent.length)
      await deps.notifier?.notify(
        `Invoices mailed: ${m.sent.length}`,
        m.sent.map((s) => `${s.client}: ${s.number}`).join("\n"),
      );
  }
  if (deps.wise) {
    const taken = await takeCredits(
      deps.main,
      await deps.wise.credits(new Date(now.getTime() - LOOKBACK_MS), now),
    );
    const paid = taken.filter((t) => t.match.status === "matched");
    const waits = taken.filter((t) => t.match.status === "review");
    stats.credits = taken.length;
    stats.matched = paid.length;
    stats.waiting = waits.length;
    if (paid.length)
      await deps.notifier?.notify(
        `Paid by transfer: ${paid.length}`,
        paid.map(creditLine).join("\n"),
      );
    if (waits.length)
      await deps.notifier?.notify(
        `Payments to look at: ${waits.length}`,
        `${waits.map(creditLine).join("\n")}\nThey wait in To approve.`,
      );
  }
  return stats;
}

export function makeBillingWatch(deps: BillingDeps) {
  return makeLoopObject(BILLING_WATCH, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = await runPass<BillingStats>(ctx, deps.main, now, {
      name: "billing watch",
      ledger: { command: BILLING_COMMAND, argv: { daemon: true } },
      body: () => billingPass(deps, now),
      delayAfter: () => EVERY,
      retryMs: EVERY,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    // After the pass, so a paid credit it just marked is heard now. Claimed under a journaled
    // token, then sent: a retry claims the same changes and sends them again (the arrival key
    // keeps a repeat from entering a node twice).
    if (deps.fire && outcome.stats) {
      const token = ctx.rand.uuidv4();
      const w = wallClock(deps.zone, now);
      const today = `${w.year}-${pad(w.month)}-${pad(w.day)}`;
      const fires = await ctx.run("invoice changes", () =>
        claimInvoiceChanges(deps.main, token, today),
      );
      for (const f of fires) deps.fire(ctx, f);
    }
    return outcome;
  });
}

export type BillingWatch = ReturnType<typeof makeBillingWatch>;
