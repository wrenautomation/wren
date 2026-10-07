/**
 * Stripe for pay links (designs/2026-10-07-forms-and-pay.md, "Setup and vendors"): the client's
 * own key, then the webhook that tells us a link was paid. Both checks read our own rows, never
 * Stripe: the key's mode row, and the endpoint's signing secret kept under its name.
 */
import { defineSetup, type SetupCheck } from "@wren/core/setup";
import { vendorModes } from "@wren/core/vendor-schema";
import type { Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { payAccountOf } from "./store.js";

export const STRIPE_SETUP = defineSetup({
  id: "setup.stripe",
  name: "Stripe for pay links",
  blurb: "Your own Stripe account takes the payments. Wren never sees a card.",
  site: "stripe",
  repeat: "7 days",
  steps: [
    {
      id: "key",
      fact: "stripe.key",
      label: "Stripe key",
      who: "client",
      how: "In Stripe, make a restricted key that can write Prices, Payment Links and Webhook Endpoints. Paste it under Payments, Connect Stripe.",
      forYou: "Make the restricted key in Stripe and send it to Wren's team. They save it for you.",
      check: "stripe.key",
      every: "1 hour",
      within: "14 days",
    },
    {
      id: "webhook",
      fact: "stripe.webhook",
      label: "Paid links reach Wren",
      who: "auto",
      how: "Wren adds its webhook to your Stripe account with that key. If the key can't, add the endpoint in Stripe and paste its signing secret.",
      forYou: "Wren adds its webhook to your Stripe account with that key.",
      check: "stripe.webhook",
      every: "1 hour",
      within: "7 days",
    },
  ],
});

export const PAYMENTS_SETUPS = [STRIPE_SETUP];

/** The two checks: a key saved for the client, and a webhook secret kept under its name. */
export function stripeChecks(main: Queryable): Record<string, SetupCheck> {
  return {
    "stripe.key": async ({ account }) => {
      if (!account.client) return { ok: false, why: "Pay links are for clients" };
      const [m] = await main
        .select({ mode: vendorModes.mode, keyName: vendorModes.keyName })
        .from(vendorModes)
        .where(and(eq(vendorModes.client, account.client), eq(vendorModes.vendor, "stripe")));
      return m?.mode === "own" && m.keyName
        ? { ok: true, why: "Key saved" }
        : { ok: false, why: "No Stripe key saved yet" };
    },
    "stripe.webhook": async ({ account }) => {
      if (!account.client) return { ok: false, why: "Pay links are for clients" };
      const a = await payAccountOf(main, account.client);
      return a?.secretName
        ? { ok: true, why: a.how === "api" ? "Registered by Wren" : "Secret pasted" }
        : { ok: false, why: "No webhook yet" };
    },
  };
}
