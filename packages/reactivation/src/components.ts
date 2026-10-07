/** Lead reactivation, and the demo video it records per lead. */
import { defineComponent } from "@wren/core/components";
import { PRODUCT, reactivationSettingsSchema } from "./settings.js";

export const REACTIVATION_COMPONENTS = [
  defineComponent({
    id: PRODUCT,
    stage: "reach",
    channels: ["email"],
    name: "Lead reactivation",
    blurb: "Wakes old leads in the client's CRM and books them in.",
    icon: "cycle",
    for: "client",
    ready: true,
    settings: reactivationSettingsSchema,
    priced: ["offer"],
    provides: {
      services: ["Reactivation", "ReactivationPortal"],
      loops: ["Reactivation"],
      records: [
        "reactivation.person",
        "reactivation.email",
        "reactivation.finding",
        "reactivation.reply",
        "reactivation.setting",
      ],
      apps: ["reactivation"],
      templates: ["prompt:reactivation/compose"],
    },
    effects: ["sends", "spends"],
    in: [{ id: "contacts", label: "old leads", kind: "person" }],
    out: [{ id: "booked", label: "booked calls", kind: "call" }],
    hypothesis: {
      from: "The reactivation demo on prod, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Which steps run: research, compose, send, handoff.",
          built: "settings.stages",
        },
        { is: "change", says: "How many a day.", built: "settings.compose" },
        {
          is: "change",
          says: "Whether the client approves the first batch or every one.",
          built: "settings.approval",
        },
        {
          is: "change",
          says: "The senders, each writing as one of the client's people.",
          built: "settings.senders",
        },
        { is: "needs", says: "A way into each client's CRM past the first one.", built: null },
        { is: "fixed", says: "Nothing sends until send is on." },
      ],
    },
  }),
  defineComponent({
    id: "video.demo",
    stage: "reach",
    channels: ["web"],
    name: "Demo videos",
    blurb: "Records a short demo video for one lead's company, with a page to watch it.",
    icon: "play",
    for: "wren",
    ready: false,
    missing: ["Wren's own demos: each is a walk written in code for one product"],
    in: [{ id: "firms", label: "companies", kind: "firm" }],
    out: [{ id: "videos", label: "demo videos", kind: "video" }],
    hypothesis: {
      from: "Wren's own demo, 2026-09",
      guesses: [
        { is: "change", says: "The script and screens, per lead's firm.", built: null },
        {
          is: "change",
          says: "Where the watch page sends them: book a call, or reply.",
          built: null,
        },
        { is: "fixed", says: "Each video has its own page, and the page counts views." },
      ],
    },
  }),
];
