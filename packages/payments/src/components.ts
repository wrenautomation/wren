/** Text-to-pay as a part (designs/2026-10-07-forms-and-pay.md). */
import { defineComponent } from "@wren/core/components";
import { LINK_RECORD } from "./records.js";

export const PAY_LINKS = "payments.links";

export const PAYMENTS_COMPONENTS = [
  defineComponent({
    id: PAY_LINKS,
    stage: "deliver",
    channels: ["text", "email"],
    name: "Text-to-pay",
    blurb:
      "A Stripe pay link sent by text or email from a thread, on your own Stripe account, marked paid when it is.",
    icon: "money",
    for: "client",
    ready: false,
    missing: ["The worker can't save a client's Stripe key yet"],
    requires: { accounts: ["stripe"] },
    provides: {
      services: ["Payments", "PaymentsConsole"],
      records: [LINK_RECORD],
      apps: ["payments"],
    },
    effects: ["sends"],
    // A pay email waits on the client's sends flag; a pay text on Texts' own gates.
    liveSwitch: true,
    out: [{ id: "paid", label: "payments", kind: "invoice" }],
    hypothesis: {
      from: "The product audit, 2026-10-07",
      guesses: [
        {
          is: "change",
          says: "Amount, what it's for and how many, per link.",
          built: "code, PaymentsConsole.create",
        },
        {
          is: "needs",
          says: "The client's own Stripe key and its webhook.",
          built: "the Stripe setup (setup.stripe)",
        },
        { is: "fixed", says: "Nothing charges anyone: the payer pays on Stripe's page." },
        { is: "fixed", says: "A pay text waits for 8:00 to 20:00 in the contact's zone." },
      ],
    },
  }),
];
