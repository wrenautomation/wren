/**
 * Text-to-pay on Restate (designs/2026-10-07-forms-and-pay.md, "Flow").
 *
 * - `Payments/send`: an approved link becomes a Stripe Payment Link on the client's key, then a
 *   text through `SmsDesk.reply` as kind `pay` (it waits for the window) or an email from the
 *   client's name when its sends flag is on.
 * - `Payments/stripe`: Stripe's webhook as the portal Worker passes it (the raw body and
 *   `Stripe-Signature`), checked with the client's own signing secret, kept once by its event id
 *   and applied in any order (`./states.ts`). Then the thread's paid mark is worked out again
 *   and the spine hears each change (paid, refunded, failed) once ever.
 *
 * Durable at each step: a link's id is made before its insert, Stripe's writes carry
 * idempotency keys, a dropped connection or Stripe's 5xx is retried (never marked failed), and
 * a crash after the event is kept still marks the thread and tells the spine on the retry.
 * The client's key and signing secret are read inside one journaled step each and never
 * returned from it, so neither lands in Restate's journal.
 */
import * as restate from "@restatedev/restate-sdk";
import type { SmsDeskService } from "@wren/channel-sms/restate";
import { type Client, findClient, sendsOn } from "@wren/core/clients";
import type { KeyStore } from "@wren/core/keys";
import { noteClientPayLink } from "@wren/core/profiles-backfill";
import { setUp } from "@wren/core/refusal";
import { serviceHandler } from "@wren/core/restate";
import type { Fired, FireTriggers } from "@wren/core/spine";
import { vendorModes } from "@wren/core/vendor-schema";
import type { Db } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PAY_LINKS } from "./components.js";
import type { PayLink } from "./schema.js";
import type { PayChange } from "./states.js";
import {
  applyEvent,
  claimChanges,
  keepStripeLink,
  linkById,
  markFailed,
  markSent,
  money,
  PayRefusal,
  payAccountOf,
  syncContactPaid,
} from "./store.js";
import { type Fetch, factsOf, StripeError, stripeApi, verifySignature } from "./stripe.js";

/** Mail from the client's name; the worker's is portal@ under that name. */
export type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;

export interface PaymentsDeps {
  /** Main: links, accounts, the client registry. */
  main: Db;
  /** A client's database: its texting threads. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** Where clients' Stripe keys and signing secrets are kept; null: no key store here. */
  keys: KeyStore | null;
  /** Stripe's HTTP; tests pass fixtures. */
  fetch: Fetch;
  /** The portal's origin: Stripe posts to `<portal>/__pay/stripe/<client>`. */
  portal: string;
  /** Mail under a sender's name; null: no pay email here. */
  mailer: ((from: string) => SendMail) | null;
  /** The spine's ear for a link's changes; unset where no Spine runs. */
  fire?: FireTriggers;
  /** Stripe's API base: tests point it at stripe-mock or nothing real. */
  stripeBase?: string;
  /** How long a Stripe step keeps retrying Stripe's own trouble; tests shorten it. */
  stripeRetry?: StripeRetry;
}

/** Retries on a dropped connection or Stripe's 5xx, inside Stripe's 24 h idempotency window. */
export interface StripeRetry {
  maxRetryDuration: number;
  initialRetryInterval: number;
  maxRetryInterval: number;
}
export const STRIPE_RETRY: StripeRetry = {
  maxRetryDuration: 30 * 60_000,
  initialRetryInterval: 2_000,
  maxRetryInterval: 5 * 60_000,
};

/**
 * A Stripe step: Stripe's refusal is the answer (`error`), its trouble is retried with the same
 * idempotency keys, and only when retries run out does the link fail, saying why.
 */
export async function stripeStep<T extends object>(
  ctx: restate.Context,
  name: string,
  retry: StripeRetry,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await ctx.run(
      name,
      async (): Promise<T | { error: string }> => {
        try {
          return await fn();
        } catch (err) {
          if (err instanceof PayRefusal) return { error: `Stripe: ${err.message}` };
          if (err instanceof StripeError && !err.transient)
            return { error: `Stripe: ${err.message}` };
          throw err;
        }
      },
      retry,
    );
  } catch (err) {
    if (!(err instanceof restate.TerminalError)) throw err;
    return { error: `Stripe: ${err.message}` };
  }
}

export const PAYMENTS = { name: "Payments" } as const;
/** The signing secret's name in the key store, beside the client's `STRIPE_SECRET_KEY`. */
export const WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET";
/** Who reads a key when Payments does: the event says so. */
export const PAYMENTS_READER = "wren:payments";
export const webhookUrl = (portal: string, client: string) =>
  `${portal.replace(/\/+$/, "")}/__pay/stripe/${encodeURIComponent(client)}`;

/**
 * The client's Stripe key, from the store, with a read event saying why; refused when none is
 * saved or there's no store. Call it inside a journaled step and never return it.
 */
export async function stripeKeyOf(
  d: Pick<PaymentsDeps, "main" | "keys">,
  client: string,
  why: string,
) {
  setUp(d.keys, "the key store");
  const [m] = await d.main
    .select({ keyName: vendorModes.keyName, mode: vendorModes.mode })
    .from(vendorModes)
    .where(
      and(
        eq(vendorModes.client, client),
        eq(vendorModes.vendor, "stripe"),
        eq(vendorModes.purpose, "default"),
      ),
    );
  const key =
    m?.mode === "own" && m.keyName
      ? await d.keys.get({ ref: m.keyName, client, by: PAYMENTS_READER, why })
      : null;
  if (!key) throw new PayRefusal("Connect Stripe first", 409);
  return key;
}

/** What it's for, with how many when more than one: "2 x Filter". */
const what = (l: Pick<PayLink, "description" | "quantity">) =>
  l.quantity > 1 ? `${l.quantity} x ${l.description}` : l.description;
const total = (l: Pick<PayLink, "amountCents" | "quantity" | "currency">) =>
  money(l.amountCents * l.quantity, l.currency);

/** The text: who it's from, what for, how much, the link. */
export const payText = (business: string, l: PayLink, url: string) =>
  `${business}: ${what(l)}, ${total(l)}. Pay here: ${url}`;

/** The email: a subject and a few plain lines. */
export function payEmail(business: string, l: PayLink, url: string) {
  const first = l.name?.trim().split(/\s+/)[0];
  return {
    subject: `${what(l)}: ${total(l)}`,
    text: [
      `Hi ${first || "there"},`,
      "",
      `Here's your link to pay ${total(l)} for ${what(l)}:`,
      url,
      "",
      "The payment goes through Stripe.",
      "",
      business,
    ].join("\n"),
  };
}

/**
 * A link's change as the spine hears it: about the payer's email and their thread. Paid keeps
 * its old subject; a refund or a failure is its own, so a flow that took the payment hears it.
 */
export function paymentFired(l: PayLink, change: PayChange = "paid"): Fired {
  return {
    client: l.client,
    facts: { trigger: "trigger.payment", change },
    about: [...(l.email ? [l.email] : []), ...(l.contact ? [`sms:${l.contact}`] : [])],
    event: {
      subject: change === "paid" ? `payment:${l.id}` : `payment:${l.id}:${change}`,
      kind: "invoice",
      data: {
        // Where the money came from and its id there (`pipeline.collect` reads these).
        source: "pay_link",
        id: l.id,
        link: l.id,
        change,
        description: l.description,
        amount_cents: l.paidCents ?? l.amountCents * l.quantity,
        refunded_cents: l.refundedCents ?? 0,
        currency: l.currency,
        email: l.email,
        name: l.name,
        contact: l.contact,
        document: l.document ?? null,
        live: l.live,
      },
    },
  };
}

type Made = { url: string; stripeLink: string } | { error: string };

/** Stripe's answer on a webhook, as the Worker passes it back. */
export interface HookAnswer {
  status: number;
  result: string;
}

/**
 * A link's line on its client's timeline (People, B7), once sent and again when paid: the link
 * lives here on main, the profile in the client's workspace. Never throws.
 */
export async function notePayLink(
  d: Pick<PaymentsDeps, "main" | "open">,
  id: string,
): Promise<number | null> {
  try {
    const l = await linkById(d.main, id);
    const c = l ? await findClient(d.main, l.client) : null;
    return l && c ? await noteClientPayLink(d.open(c), l) : null;
  } catch (err) {
    console.error(`profile event (pay link ${id}): ${(err as Error).message}`);
    return null;
  }
}

/**
 * One webhook, checked and applied: the plain function the service journals, and tests call.
 * `link` is the link it was about, for `settleLink` and the spine, even on a duplicate.
 */
export async function takeWebhook(
  d: Pick<PaymentsDeps, "main" | "open" | "keys">,
  req: { client: string; raw: string; signature?: string | null },
  now: Date,
): Promise<HookAnswer & { link: string | null }> {
  const no = (status: number, result: string) => ({ status, result, link: null });
  const client = await findClient(d.main, req.client);
  if (!client) return no(404, "no such client");
  const acct = await payAccountOf(d.main, client.id);
  if (!acct?.secretName) return no(404, "no webhook set up");
  if (!d.keys) return no(503, "no key store here");
  const secret = await d.keys.get({
    ref: acct.secretName,
    client: client.id,
    by: PAYMENTS_READER,
    why: "check a webhook",
  });
  if (!secret) return no(503, "signing secret missing");
  const v = verifySignature(req.raw, req.signature, secret, now);
  if (!v.ok) return no(400, v.why);
  const facts = factsOf(req.raw);
  if (!facts) return no(400, "not a Stripe event");
  const got = await applyEvent(d.main, client.id, facts, now);
  return { status: 200, result: got.fresh ? got.result : "seen", link: got.link?.id ?? null };
}

/**
 * What follows a link's money, worked out again from main so it is safe twice: the thread's
 * paid mark (net of refunds; cleared when access goes) and the line on the client's timeline.
 */
export async function settleLink(d: Pick<PaymentsDeps, "main" | "open">, id: string) {
  const l = await linkById(d.main, id);
  if (!l) return;
  if (l.contact) {
    const c = await findClient(d.main, l.client);
    if (c) await syncContactPaid(d.main, d.open(c), l.client, l.contact);
  }
  await notePayLink(d, id);
}

/** The spine hears each change of the link once ever: claimed under a journaled token. */
export async function tellChanges(ctx: restate.Context, d: PaymentsDeps, id: string) {
  if (!d.fire) return [];
  const token = ctx.rand.uuidv4();
  const got = await ctx.run("claim", async () => {
    const c = await claimChanges(d.main, id, token);
    return { link: c.link, changes: c.changes };
  });
  if (!got.link) return [];
  const l = got.link as unknown as PayLink;
  for (const change of got.changes) d.fire(ctx, paymentFired(l, change));
  return got.changes;
}

export function makePayments(deps: PaymentsDeps) {
  return restate.service({
    name: PAYMENTS.name,
    handlers: {
      /** Make the link on Stripe and send it; a link not `sending` is left as it is. */
      send: serviceHandler(
        {
          input: z.looseObject({ id: z.string().describe("The pay link's id") }),
          effect: "sends",
        },
        async (ctx: restate.Context, req: { id: string }) => {
          const got = await ctx.run("load", async () => {
            const l = await linkById(deps.main, req.id);
            if (l?.status !== "sending") return null;
            const c = await findClient(deps.main, l.client);
            if (!c) return null;
            return { link: l, business: c.name, sends: sendsOn(c, PAY_LINKS) };
          });
          if (!got) return { sent: false };
          const l = { ...got.link, createdAt: new Date(got.link.createdAt) } as PayLink;
          const made: Made = await stripeStep(
            ctx,
            "stripe",
            deps.stripeRetry ?? STRIPE_RETRY,
            async () => {
              // Read again: a run cut short after Stripe answered kept the link.
              const now = await linkById(deps.main, l.id);
              if (now?.url && now.stripeLink) return { url: now.url, stripeLink: now.stripeLink };
              const key = await stripeKeyOf(deps, l.client, `make pay link ${l.id}`);
              const api = stripeApi(key, deps.fetch, deps.stripeBase);
              const price = await api.createPrice({
                id: l.id,
                cents: l.amountCents,
                currency: l.currency,
                description: l.description,
              });
              const link = await api.createPaymentLink({
                id: l.id,
                client: l.client,
                price: price.id,
                quantity: l.quantity,
              });
              await keepStripeLink(deps.main, l.id, {
                stripeLink: link.id,
                url: link.url,
                live: link.livemode,
              });
              return { url: link.url, stripeLink: link.id };
            },
          );
          if ("error" in made) {
            await ctx.run("failed", () => markFailed(deps.main, l.id, made.error));
            return { sent: false, why: made.error };
          }
          let message: number | null = null;
          let why: string | null = null;
          if (l.channel === "sms" && l.contact) {
            try {
              const r = await ctx.serviceClient<SmsDeskService>({ name: "SmsDesk" }).reply({
                contactId: l.contact,
                body: payText(got.business, l, made.url),
                client: l.client,
                kind: "pay",
              });
              message = r.messageId;
            } catch (err) {
              if (!(err instanceof restate.TerminalError)) throw err;
              why = `Text: ${err.message}`;
            }
          } else if (l.channel === "email" && l.email) {
            if (!got.sends) why = "Email sends are off for this client. An admin turns them on.";
            else if (!deps.mailer) why = "No mailer here";
            else {
              const mail = payEmail(got.business, l, made.url);
              const send = deps.mailer(got.business);
              const to = l.email;
              await ctx.run("email", () => send({ to, ...mail }));
            }
          } else why = "Nowhere to send it";
          const now = new Date(await ctx.date.now());
          if (why) {
            const said = why;
            await ctx.run("failed", () => markFailed(deps.main, l.id, said));
            return { sent: false, why };
          }
          await ctx.run("sent", () => markSent(deps.main, l.id, { message, now }));
          await ctx.run("profile", () => notePayLink(deps, l.id));
          return { sent: true };
        },
      ),
      /** Stripe's webhook, from the portal Worker. Answers the status the Worker gives Stripe. */
      stripe: serviceHandler(
        {
          input: z.looseObject({
            client: z.string().max(40).describe("Whose Stripe account sent it"),
            raw: z.string().max(256_000).describe("The body exactly as Stripe sent it"),
            signature: z.string().max(2000).nullish().describe("The Stripe-Signature header"),
          }),
        },
        async (
          ctx: restate.Context,
          req: { client: string; raw: string; signature?: string | null },
        ): Promise<HookAnswer> => {
          const got = await ctx.run("apply", () => takeWebhook(deps, req, new Date()));
          // On a duplicate too: a run cut short after "apply" finishes here when Stripe resends.
          if (got.link) {
            const id = got.link;
            await ctx.run("settle", () => settleLink(deps, id));
            await tellChanges(ctx, deps, id);
          }
          return { status: got.status, result: got.result };
        },
      ),
    },
  });
}
export type PaymentsService = ReturnType<typeof makePayments>;
