/**
 * Text-to-pay on Restate (designs/2026-10-07-forms-and-pay.md, "Flow").
 *
 * - `Payments/send`: an approved link becomes a Stripe Payment Link on the client's key, then a
 *   text through `SmsDesk.reply` as kind `pay` (it waits for the window) or an email from the
 *   client's name when its sends flag is on.
 * - `Payments/stripe`: Stripe's webhook as the portal Worker passes it (the raw body and
 *   `Stripe-Signature`), checked with the client's own signing secret, kept once, and on a paid
 *   checkout the link and the thread are marked and the spine hears `payment.received`.
 *
 * The client's key and signing secret are read inside one journaled step each and never
 * returned from it, so neither lands in Restate's journal.
 */
import * as restate from "@restatedev/restate-sdk";
import type { SmsDeskService } from "@wren/channel-sms/restate";
import { type Client, findClient, sendsOn } from "@wren/core/clients";
import type { KeyStore } from "@wren/core/keys";
import { serviceHandler } from "@wren/core/restate";
import type { Fired, FireTriggers } from "@wren/core/spine";
import { vendorModes } from "@wren/core/vendor-schema";
import type { Db } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PAY_LINKS } from "./components.js";
import type { PayLink } from "./schema.js";
import {
  applyEvent,
  keepStripeLink,
  linkById,
  markContactPaid,
  markFailed,
  markSent,
  money,
  PayRefusal,
  payAccountOf,
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
  /** The spine's ear for `payment.received`; unset where no Spine runs. */
  fire?: FireTriggers;
  /** Stripe's API base: tests point it at nothing real. */
  stripeBase?: string;
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
  if (!d.keys) throw new PayRefusal("The key store isn't set up here", 503);
  const [m] = await d.main
    .select({ keyName: vendorModes.keyName, mode: vendorModes.mode })
    .from(vendorModes)
    .where(and(eq(vendorModes.client, client), eq(vendorModes.vendor, "stripe")));
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

/** A paid link as the spine hears it: about the payer's email and their thread. */
export function paymentFired(l: PayLink): Fired {
  return {
    client: l.client,
    facts: { trigger: "trigger.payment", change: "paid" },
    about: [...(l.email ? [l.email] : []), ...(l.contact ? [`sms:${l.contact}`] : [])],
    event: {
      subject: `payment:${l.id}`,
      kind: "invoice",
      data: {
        link: l.id,
        description: l.description,
        amount_cents: l.paidCents ?? l.amountCents * l.quantity,
        currency: l.currency,
        email: l.email,
        name: l.name,
        contact: l.contact,
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
 * One webhook, checked and applied: the plain function the service journals, and tests call.
 * `paid` is the link newly paid, for the spine.
 */
export async function takeWebhook(
  d: Pick<PaymentsDeps, "main" | "open" | "keys">,
  req: { client: string; raw: string; signature?: string | null },
  now: Date,
): Promise<HookAnswer & { paid: PayLink | null }> {
  const no = (status: number, result: string) => ({ status, result, paid: null });
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
  const got = await applyEvent(d.main, client.id, facts);
  if (got.paid?.contact && got.paid.paidCents)
    await markContactPaid(d.open(client), got.paid.contact, got.paid.paidCents, now);
  return { status: 200, result: got.fresh ? got.result : "seen", paid: got.paid };
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
          const made: Made = await ctx.run("stripe", async () => {
            if (l.url && l.stripeLink) return { url: l.url, stripeLink: l.stripeLink };
            try {
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
            } catch (err) {
              if (err instanceof StripeError || err instanceof PayRefusal)
                return { error: `Stripe: ${err.message}` };
              throw err;
            }
          });
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
          const got = await ctx.run("apply", async () => {
            const r = await takeWebhook(deps, req, new Date());
            return { status: r.status, result: r.result, paid: r.paid };
          });
          if (got.paid && deps.fire) {
            const p = got.paid as unknown as PayLink;
            deps.fire(ctx, paymentFired(p));
          }
          return { status: got.status, result: got.result };
        },
      ),
    },
  });
}
export type PaymentsService = ReturnType<typeof makePayments>;
