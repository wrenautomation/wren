/** Cold outreach on social sites: a person's warmed account, paced. */
import { defineComponent } from "@wren/core/components";

export const OUTREACH_COMPONENTS = [
  defineComponent({
    id: "reach.outreach",
    name: "Social outreach",
    blurb: "Writes to people on social sites from a warmed account, paced.",
    icon: "people",
    for: "client",
    ready: false,
    missing: ["Held: no targeting yet, and it runs on Wren's accounts only"],
    provides: {
      services: ["ReachSender", "ReachWatch", "ReachDesk"],
      loops: ["ReachSender", "ReachWatch"],
    },
    effects: ["sends"],
    in: [{ id: "people", label: "people", kind: "person" }],
    out: [{ id: "replied", label: "DM replies", kind: "reply" }],
    hypothesis: {
      from: "Wren's DM tests, 2026-10",
      guesses: [
        { is: "change", says: "Which sites: LinkedIn, Reddit, X.", built: null },
        { is: "change", says: "Caps and ramp per account.", built: "the caps ledger" },
        { is: "change", says: "Who to write to.", built: null },
        { is: "needs", says: "Warmed accounts the client owns.", built: null },
        { is: "fixed", says: "Each account is paced by its own caps." },
      ],
    },
  }),
];
