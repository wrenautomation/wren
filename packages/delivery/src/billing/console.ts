/**
 * BillingConsole: a person's hands on Wise credits (designs/2026-10-15-wise-billing.md). Put one
 * on an invoice (its likeliest by default, the one To approve names) or set it aside. Reading is
 * the console's `console.credit` record. The demo changes nothing.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { invoices, wiseCredits } from "../schema.js";
import { BILLING_CONSOLE_APPS, BILLING_CONSOLE_ROUTES } from "./console-routes.js";
import { dismissCredit, matchByHand } from "./credits.js";

export interface CreditsRequest extends PortalRequest {
  ids?: (string | number)[];
  /** The invoice to put it on, `WREN-1001`; blank = the one the credit names as likely. */
  invoice?: string | null;
}

/** `credit:12` (To approve's id) or `12` (the record's) as 12. */
export const creditIdOf = (v: string | number): number => {
  const n = Number(String(v).replace(/^credit:/, ""));
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal("no such credit", 404);
  return n;
};
export const creditApprovalId = (id: number) => `credit:${id}`;

/** The handlers as plain functions: the service wraps them, tests call them. */
export function billingConsoleApi(db: Db) {
  const who = (req: PortalRequest) => {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    return (req.viewer as SignedViewer).email;
  };
  const picked = (req: CreditsRequest) => {
    const ids = (req.ids ?? []).map(creditIdOf);
    if (!ids.length || ids.length > 50) throw new PortalRefusal("pick a credit (up to 50)", 400);
    return ids;
  };
  return {
    match: async (req: CreditsRequest) => {
      const by = who(req);
      const done: string[] = [];
      for (const id of picked(req)) {
        let number = req.invoice?.trim() || null;
        if (!number) {
          const [c] = await db
            .select({ number: invoices.number })
            .from(wiseCredits)
            .innerJoin(invoices, eq(invoices.id, wiseCredits.invoiceId))
            .where(eq(wiseCredits.id, id));
          if (!c) throw new PortalRefusal(`credit ${id} names no invoice: say which`, 400);
          number = c.number;
        }
        const t = await matchByHand(db, id, number, by);
        done.push(String(t.credit.id));
      }
      return { done };
    },
    dismiss: async (req: CreditsRequest) => {
      const by = who(req);
      const done: string[] = [];
      for (const id of picked(req)) done.push(String((await dismissCredit(db, id, by)).id));
      return { done };
    },
  };
}

export function makeBillingConsole(db: Db) {
  const api = billingConsoleApi(db);
  /** A write: journaled once, so a retry returns the same answer and never writes twice. */
  const write =
    <T>(name: string, fn: (req: CreditsRequest) => Promise<T>) =>
    (ctx: restate.Context, req: CreditsRequest) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  const input = z.looseObject({
    ...PORTAL_FIELDS,
    ids: z
      .array(z.union([z.string().max(40), z.number()]))
      .max(50)
      .optional(),
    invoice: z.string().max(64).nullish(),
  });
  return portalService({
    name: "BillingConsole",
    main: db,
    routes: BILLING_CONSOLE_ROUTES,
    apps: BILLING_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      match: serviceHandler({ input }, write("match", api.match)),
      dismiss: serviceHandler({ input }, write("dismiss", api.dismiss)),
    },
  });
}
