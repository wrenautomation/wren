/** Sites as a part (designs/2026-10-07-sites.md): landers, listicles and funnel pages, counted. */
import { defineComponent } from "@wren/core/components";
import { ENTRY_RECORD, FORM_RECORD, FUNNEL_RECORD, PAGE_RECORD } from "./records.js";

export const SITES_COMPONENTS = [
  defineComponent({
    id: "sites.pages",
    stage: "reach",
    channels: ["web", "ads"],
    name: "Landing pages",
    blurb:
      "Landers and listicles made from an offer, live at their own URL with a yes, each counting its visits, forms and bookings.",
    icon: "link",
    for: "wren",
    ready: false,
    missing: ["A client's pages are served on its host, but no client page has run yet"],
    effects: ["spends"],
    provides: {
      services: ["Sites", "SitesConsole"],
      records: [PAGE_RECORD, FUNNEL_RECORD],
      apps: ["sites"],
    },
    out: [{ id: "forms", label: "filled forms", kind: "form" }],
    hypothesis: {
      from: "Wren's own ad landers, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Templates: a lander and a listicle.",
          built: "code, one file per template",
        },
        {
          is: "change",
          says: "Copy per offer and angle, drafted by Claude against the facts.",
          built: null,
        },
        { is: "fixed", says: "Nothing goes live without a person's yes." },
      ],
    },
  }),
  defineComponent({
    id: "sites.forms",
    stage: "reach",
    channels: ["web"],
    name: "Hosted forms",
    blurb:
      "Forms built as fields, live at their own URL or framed on any site, each submit checked, its text consent kept word for word, and sent into the door.",
    icon: "list",
    for: "wren",
    ready: false,
    missing: ["No client form has run yet"],
    provides: { records: [FORM_RECORD, ENTRY_RECORD] },
    out: [{ id: "forms", label: "filled forms", kind: "form" }],
    hypothesis: {
      from: "The product audit, 2026-10-07",
      guesses: [
        {
          is: "change",
          says: "Field kinds: text, email, phone, choices, date, consent, hidden.",
          built: "code, FIELD_KINDS in packages/sites/src/forms.ts",
        },
        {
          is: "fixed",
          says: "Every submit passes Turnstile and keeps the consent words it showed.",
        },
      ],
    },
  }),
];
