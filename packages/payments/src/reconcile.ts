/**
 * `PayReconcile/all`: once a day, every connected client's recent links held against Stripe
 * (designs/2026-10-07-forms-and-pay.md, "Durable payments"). Webhooks are the fast path; this
 * is the floor under them. A missed or dropped event heals as reconcile's own event (a
 * deterministic `recon:` id, applied by the same steps); what no event explains is kept as
 * drift and said on the link for a person. It reads Stripe only, and makes nothing there except
 * adding events an endpoint is missing: one Wren registered, or one the client pasted (found by
 * its URL). Where the key can't, the client gets a note in their payments settings.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import type { PayAccount, PayLink } from "./schema.js";
import { type PaymentsDeps, settleLink, stripeKeyOf, tellChanges, webhookUrl } from "./service.js";
import { step } from "./states.js";
import {
  applyEvent,
  keepWebhookNote,
  linksToCheck,
  markChecked,
  moneyOf,
  noteDrift,
  PayRefusal,
  payClients,
} from "./store.js";
import {
  kindOf,
  READ_ACCESS,
  STRIPE_EVENTS,
  type StripeApi,
  StripeError,
  type StripeFact,
  stripeApi,
} from "./stripe.js";

const PAY_RECONCILE = "PayReconcile";
const PAY_RECONCILE_COMMAND = "payments reconcile";
const DAY_MS = 86_400_000;
/** Links checked per client per pass: three reads each, well under Stripe's rate limit. */
const PER_CLIENT = 50;

interface LinkCheck {
  /** Facts applied: each one fixed what a dropped webhook would have. */
  healed: number;
  /** A disagreement kept for a person. */
  drift: string | null;
}

/** A fact as reconcile makes it: the same shape a webhook gives, with a `recon:` id. */
const fact = (l: PayLink, key: string, o: Partial<StripeFact> & Pick<StripeFact, "type">) =>
  ({
    event: `recon:${l.id}:${key}`.slice(0, 80),
    kind: kindOf(o.type),
    created: null,
    session: null,
    link: l.stripeLink,
    intent: null,
    wren: l.id,
    status: null,
    cents: null,
    currency: l.currency,
    email: null,
    refunded: null,
    live: l.live ?? false,
    ...o,
  }) as StripeFact;

/**
 * One link held against Stripe: its checkouts, its payment, refunds and disputes. Each fact
 * Stripe has that the link lacks is applied; what is already true writes nothing.
 */
async function checkLink(
  main: PaymentsDeps["main"],
  api: StripeApi,
  l: PayLink,
  now: Date,
): Promise<LinkCheck> {
  if (!l.stripeLink) return { healed: 0, drift: null };
  const facts: StripeFact[] = [];
  const sessions = await api.sessionsOf(l.stripeLink);
  const paid = sessions.find((x) => x.paymentStatus === "paid");
  const pending = sessions.find((x) => x.status === "complete" && x.paymentStatus === "unpaid");
  const intent = paid?.intent ?? pending?.intent ?? l.intent;
  const pay = intent ? await api.paymentOf(intent) : null;
  if (paid || pay?.status === "succeeded")
    facts.push(
      fact(l, "paid", {
        type: "checkout.session.completed",
        session: paid?.id ?? pending?.id ?? l.session,
        intent,
        status: "paid",
        cents: paid?.cents ?? pay?.received ?? null,
        live: (paid ?? pending)?.live ?? l.live ?? false,
      }),
    );
  else if (pending && pay && /requires_payment_method|canceled/.test(pay.status))
    facts.push(
      fact(l, "failed", {
        type: "checkout.session.async_payment_failed",
        session: pending.id,
        intent,
        status: "unpaid",
      }),
    );
  else if (pending)
    facts.push(
      fact(l, "processing", {
        type: "checkout.session.completed",
        session: pending.id,
        intent,
        status: "unpaid",
      }),
    );
  if (intent && pay?.refunded)
    facts.push(
      fact(l, `refund:${pay.refunded}`, {
        type: "charge.refunded",
        intent,
        refunded: pay.refunded,
      }),
    );
  if (intent && (pay?.disputed || l.dispute)) {
    const [d] = (await api.disputesOf(intent)).sort((a, b) => b.created - a.created);
    if (d)
      facts.push(
        fact(l, `dispute:${d.id}:${d.status}`, {
          type: "charge.dispute.updated",
          intent,
          status: d.status,
          created: Math.floor(now.getTime() / 1000),
        }),
      );
  }
  let healed = 0;
  let cur = l;
  for (const f of facts) {
    if (!step(moneyOf(cur), f, now).changed) continue;
    const got = await applyEvent(main, l.client, f, now);
    if (got.fresh && got.link) {
      healed += 1;
      cur = got.link;
    }
  }
  let drift: string | null = null;
  if (l.paidCents !== null && !paid && pay?.status !== "succeeded") {
    drift = "Marked paid here, but Stripe has no payment for this link. Look before acting on it.";
    await noteDrift(main, l, "unpaid", drift, now);
  }
  await markChecked(main, l.id, now);
  return { healed, drift };
}

export interface ReconcileStats {
  clients: number;
  checked: number;
  healed: number;
  drift: number;
  /** Endpoints, Wren's or a client's, that now hear refunds and disputes too. */
  endpoints: number;
  /** Clients whose endpoint we couldn't widen or read: each has a note in its settings. */
  noted: number;
  /** Clients skipped: no key, or Stripe refused it (`why`). */
  skipped: { client: string; why: string }[];
  /** Links a fix touched: their thread mark and the executor follow after the pass. */
  touched: string[];
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** In a client's words: what their endpoint lacks, and what a restricted key needs to read. */
const lacks = (url: string, events: readonly string[]) =>
  `Your Stripe webhook at ${url} doesn't send ${events.join(", ")}, so refunds and disputes can reach Wren late. In Stripe, open that endpoint and add them. A restricted key also needs read access to ${READ_ACCESS}.`;
const unread = (url: string) =>
  `Wren can't read which events your Stripe webhook at ${url} sends with this key. Make sure it sends ${STRIPE_EVENTS.join(", ")}. A restricted key needs read access to Webhook Endpoints and to ${READ_ACCESS}.`;

/**
 * Holds the client's endpoint to every event we read. Wren's own is known by its id; a pasted
 * one is found in the account by its URL. Widens it (never drops an event the client chose);
 * a key that can't read or write endpoints leaves a note for the client instead, cleared when
 * the endpoint is fine. An endpoint we can't find says nothing.
 */
async function holdEndpoint(
  d: Pick<PaymentsDeps, "main" | "portal">,
  api: StripeApi,
  acct: PayAccount,
): Promise<{ widened: boolean; noted: boolean }> {
  const url = webhookUrl(d.portal, acct.client);
  let missing: string[] | null = null;
  let widened = false;
  let note: string | null = null;
  try {
    const mine =
      acct.how === "api" && acct.endpoint
        ? { id: acct.endpoint, events: await api.webhookEvents(acct.endpoint) }
        : (await api.webhookEndpoints()).find((e) => sameUrl(e.url, url));
    if (!mine) return { widened: false, noted: false };
    missing = STRIPE_EVENTS.filter((e) => !mine.events.includes(e) && !mine.events.includes("*"));
    if (missing.length) {
      await api.setWebhookEvents(mine.id, [...new Set([...mine.events, ...STRIPE_EVENTS])]);
      widened = true;
    }
  } catch (err) {
    if (!(err instanceof StripeError && err.denied)) throw err;
    note = missing?.length ? lacks(url, missing) : unread(url);
  }
  if (note !== acct.note) await keepWebhookNote(d.main, acct.client, note);
  return { widened, noted: note !== null };
}

/** One pass over every connected client. A client's trouble is its line; the rest go on. */
export async function reconcileAll(
  d: Pick<PaymentsDeps, "main" | "open" | "keys" | "fetch" | "stripeBase" | "portal">,
  now: Date,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    clients: 0,
    checked: 0,
    healed: 0,
    drift: 0,
    endpoints: 0,
    noted: 0,
    skipped: [],
    touched: [],
  };
  for (const acct of await payClients(d.main)) {
    stats.clients += 1;
    try {
      const key = await stripeKeyOf(d, acct.client, "reconcile pay links");
      const api = stripeApi(key, d.fetch, d.stripeBase);
      const hold = await holdEndpoint(d, api, acct);
      if (hold.widened) stats.endpoints += 1;
      if (hold.noted) stats.noted += 1;
      for (const l of await linksToCheck(d.main, acct.client, now, PER_CLIENT)) {
        const r = await checkLink(d.main, api, l, now);
        stats.checked += 1;
        stats.healed += r.healed;
        if (r.drift) stats.drift += 1;
        if (r.healed) {
          stats.touched.push(l.id);
          await settleLink(d, l.id);
        }
      }
    } catch (err) {
      if (!(err instanceof PayRefusal || err instanceof StripeError)) throw err;
      stats.skipped.push({ client: acct.client, why: err.message.slice(0, 2000) });
    }
  }
  return stats;
}

interface PayReconcileDeps extends PaymentsDeps {
  notifier?: Notifier;
}

export function makePayReconcile(deps: PayReconcileDeps) {
  return makeLoopObject(PAY_RECONCILE, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const out = (await runPass<ReconcileStats>(ctx, deps.main, now, {
      name: "reconcile",
      ledger: { command: PAY_RECONCILE_COMMAND, argv: { daemon: true } },
      body: () => reconcileAll(deps, now),
      delayAfter: () => DAY_MS,
      retryMs: DAY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<ReconcileStats>;
    for (const id of out.stats?.touched ?? []) await tellChanges(ctx, deps, id);
    return out;
  });
}
export type PayReconcile = ReturnType<typeof makePayReconcile>;
