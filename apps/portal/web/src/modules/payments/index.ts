/**
 * Payments (designs/2026-10-07-forms-and-pay.md, "Text-to-pay"): a client's Stripe pay links,
 * made here or from a texting thread, sent by text or email, marked paid when Stripe says so.
 * The head connects the client's own Stripe account. Nothing here charges anyone.
 */
import type { Action } from "@wren/ui";
import { createElement } from "react";
import type { Module } from "../../module.js";
import { StripePanel } from "./stripe.js";

const said = (line: string) => () => line;
const WAITING = { status: ["waiting"] };

/** A yes or no on a link someone without the yes made. To approve runs these too. */
export const PAY_ACTIONS: Action[] = [
  {
    id: "payments.approve",
    label: "Approve",
    handler: "payments/approve",
    confirm:
      "Send this pay link? It goes out by text in the 8:00 to 20:00 window, or by email now.",
    when: WAITING,
    sets: { status: "sending" },
    key: "a",
    bulk: true,
    done: said("Approved. It's on its way."),
  },
  {
    id: "payments.decline",
    label: "Decline",
    handler: "payments/decline",
    when: WAITING,
    sets: { status: "declined" },
    key: "x",
    bulk: true,
    done: said("Declined. Nothing was sent."),
  },
];

/** The amount, what it's for and how many: a new link's and a thread's form alike. */
const MONEY = [
  { field: "amount", label: "Amount", hint: "In dollars, as 49.00" },
  { field: "description", label: "What it's for", hint: "The payer sees this" },
  { field: "quantity", label: "How many", type: "number", optional: true },
] as const;

const sentLine = (a: unknown) => {
  const links = (a as { links?: { status: string }[] } | null)?.links ?? [];
  if (!links.length) return "Nothing made.";
  return links.every((l) => l.status === "waiting")
    ? "Made. It waits in To approve."
    : "Made. It's on its way.";
};

const CREATE: Action = {
  id: "payments.create",
  label: "New pay link",
  handler: "payments/create",
  form: [
    {
      field: "channel",
      label: "Send by",
      type: "select",
      options: ["sms", "email"],
      labels: { sms: "Text", email: "Email" },
    },
    { field: "phone", label: "Mobile", optional: true, hint: "For a text: a number you've texted" },
    { field: "email", label: "Email", optional: true, hint: "For an email" },
    { field: "name", label: "Name", optional: true },
    ...MONEY,
  ],
  done: sentLine,
};

/** On a texting thread (Texts): a pay link to that number. */
export const THREAD_PAY: Action = {
  id: "payments.fromThread",
  label: "Send a pay link",
  handler: "payments/fromThread",
  each: true,
  form: MONEY,
  key: "p",
  done: sentLine,
};

export const payments: Module = {
  id: "payments",
  name: "Payments",
  component: "payments.links",
  icon: "money",
  blurb: "Send a pay link by text or email. See who paid and how much.",
  pages: [
    {
      id: "links",
      label: "Pay links",
      template: "list",
      record: "payments.link",
      columns: ["who", "description", "amount", "status", "channel", "paid", "createdAt", "paidAt"],
      empty: {
        all: "No pay links yet. Make one with New pay link, or from a texting thread.",
        waiting: "Nothing waits for a yes.",
        sent: "No link is out yet.",
        paid: "No link is paid yet.",
      },
      actions: [CREATE, ...PAY_ACTIONS],
      head: (_meta, reload, at) =>
        at.demo ? null : createElement(StripePanel, { client: at.client, reload }),
    },
  ],
};
