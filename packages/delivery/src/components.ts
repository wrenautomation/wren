/** Client delivery: the portal's project, invoices, reviews and contract; and Wren's offers. */
import { defineComponent } from "@wren/core/components";
import { defineWorkflow } from "@wren/core/workflows";

export const DELIVERY_COMPONENTS = [
  defineComponent({
    id: "delivery.portal",
    stage: "deliver",
    channels: ["web"],
    name: "Client portal",
    blurb: "The project's plan, updates, asks and deliverables, in one place with Wren.",
    icon: "board",
    for: "client",
    ready: true,
    provides: {
      services: ["DeliveryPortal", "DeliveryWatch", "Domains"],
      loops: ["DeliveryWatch"],
      records: [
        "delivery.step",
        "delivery.update",
        "delivery.ask",
        "delivery.deliverable",
        "delivery.result",
      ],
      apps: ["work"],
    },
    effects: ["sends"],
    in: [{ id: "clients", label: "clients", kind: "client" }],
    hypothesis: {
      from: "Wren's first delivery, 2026-10",
      guesses: [
        { is: "change", says: "The plan's steps, per offer.", built: null },
        { is: "change", says: "The look, per client.", built: "the client's Look in Account" },
        {
          is: "fixed",
          says: "Plan, updates, asks and deliverables sit in one place both sides see.",
        },
      ],
    },
  }),
  defineComponent({
    id: "delivery.invoices",
    stage: "deliver",
    channels: ["email"],
    name: "Invoices",
    blurb: "Each invoice with a link to pay, and a nudge when one is due.",
    icon: "money",
    for: "client",
    ready: true,
    requires: { components: ["delivery.portal"] },
    provides: { records: ["delivery.invoice"] },
    effects: ["sends"],
    in: [{ id: "clients", label: "clients", kind: "client" }],
    out: [
      {
        id: "invoices",
        label: "invoices sent",
        kind: "invoice",
        count: { record: "delivery.invoice", view: "all" },
      },
    ],
    hypothesis: {
      from: "Wren's first invoice, 2026-10",
      guesses: [
        { is: "change", says: "How a client pays: bank transfer now, cards later.", built: null },
        { is: "change", says: "When the nudge goes.", built: null },
        { is: "fixed", says: "Every invoice carries a link to pay." },
      ],
    },
  }),
  defineComponent({
    id: "delivery.reviews",
    stage: "deliver",
    name: "Reviews",
    blurb: "Asks the client's people how it's going at set moments.",
    icon: "pulse",
    for: "client",
    ready: true,
    requires: { components: ["delivery.portal"] },
    in: [{ id: "clients", label: "clients", kind: "client" }],
    hypothesis: {
      from: "Wren's first delivery, 2026-10",
      guesses: [
        { is: "change", says: "Which moments ask, per offer.", built: null },
        { is: "change", says: "The questions.", built: null },
        { is: "fixed", says: "It asks the client's people, never Wren's." },
      ],
    },
  }),
  defineComponent({
    id: "delivery.contract",
    stage: "deliver",
    channels: ["email"],
    name: "Contract",
    blurb: "The contract to read and sign in the portal, with the signed copy by email.",
    icon: "check",
    for: "client",
    ready: true,
    requires: { components: ["delivery.portal"] },
    provides: { records: ["delivery.paperwork"] },
    effects: ["sends"],
    in: [{ id: "clients", label: "clients", kind: "client" }],
    out: [{ id: "signed", label: "contracts signed", kind: "client" }],
    hypothesis: {
      from: "Wren's first contract, 2026-10",
      guesses: [
        { is: "change", says: "The contract text, per offer.", built: null },
        { is: "fixed", says: "The signed copy goes to both sides by email." },
      ],
    },
  }),
  defineComponent({
    id: "offers",
    stage: "run",
    channels: ["web"],
    name: "Offers",
    blurb: "Every offer Wren pitches, the lander's pages and each deal's terms.",
    icon: "flag",
    for: "wren",
    ready: false,
    missing: ["Wren's own offers; never a client's"],
    hypothesis: {
      from: "Wren's offers, 2026-10",
      guesses: [
        {
          is: "change",
          says: "A client sells its own offers from the same kind of page.",
          built: null,
        },
        { is: "fixed", says: "The lander's offers are a copy of these, never edited by hand." },
      ],
    },
  }),
];

export const DELIVERY_WORKFLOWS = [
  defineWorkflow({
    id: "onboarding",
    stage: "deliver",
    name: "Client onboarding",
    blurb:
      "A won client signs, gets the portal and the first invoice, and is asked how it's going.",
    icon: "check",
    for: "client",
    in: [{ id: "clients", label: "clients won", kind: "client" }],
    nodes: [
      { id: "contract", uses: "delivery.contract" },
      { id: "portal", uses: "delivery.portal" },
      { id: "invoices", uses: "delivery.invoices" },
      { id: "reviews", uses: "delivery.reviews" },
    ],
    wires: [
      { from: "in.clients", to: "contract.clients", via: "events" },
      { from: "contract.signed", to: "portal.clients", via: "events" },
      { from: "contract.signed", to: "invoices.clients", via: "events" },
      { from: "contract.signed", to: "reviews.clients", via: "events" },
    ],
  }),
];
