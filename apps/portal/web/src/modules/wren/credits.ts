/**
 * Money → Payments in (designs/2026-10-15-wise-billing.md): every bank transfer into Wren's
 * Wise account, what it paid or why it waits. To approve runs these on the ones that wait.
 */
import type { Action } from "@wren/ui";

const said = (line: string) => () => line;

export const CREDIT_ACTIONS: Action[] = [
  {
    id: "billing.match",
    label: "Put on invoice",
    handler: "billing/match",
    each: true,
    when: { status: ["review", "dismissed"] },
    form: [
      {
        field: "invoice",
        label: "Invoice number",
        optional: true,
        hint: "Leave blank to use the suggested invoice.",
      },
    ],
    done: said("Added to the invoice."),
  },
  {
    id: "billing.dismiss",
    label: "Set aside",
    handler: "billing/dismiss",
    bulk: true,
    when: { status: ["review"] },
    confirm: "Set this payment aside? We keep the record, and no invoice changes.",
    done: said("Set aside."),
  },
];
