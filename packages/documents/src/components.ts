/** Documents, e-sign and estimates as a part (designs/2026-10-09-documents.md). */
import { defineComponent } from "@wren/core/components";
import { DOC_RECORD, TEMPLATE_RECORD } from "./records.js";

export const DOCUMENTS = "documents.docs";

export const DOCUMENTS_COMPONENTS = [
  defineComponent({
    id: DOCUMENTS,
    stage: "deliver",
    channels: ["text", "email"],
    name: "Documents and e-sign",
    blurb:
      "Contracts, proposals and estimates from your templates, sent by text or email, signed on a page under your name, with a deposit on signing.",
    icon: "note",
    for: "client",
    ready: true,
    provides: {
      services: ["Documents", "DocumentsConsole"],
      records: [DOC_RECORD, TEMPLATE_RECORD],
      apps: ["payments"],
    },
    effects: ["sends"],
    // A document email waits on the client's sends flag; a text on Texts' own gates.
    liveSwitch: true,
    out: [{ id: "signed", label: "documents", kind: "document" }],
    hypothesis: {
      from: "The product audit, 2026-10-07",
      guesses: [
        {
          is: "change",
          says: "Words, line items, deposit and expiry, per template and per document.",
          built: "code, DocumentsConsole.templateSave and update",
        },
        {
          is: "fixed",
          says: "A sent document never changes: its text is frozen with a SHA-256 the signer's post must match.",
        },
        {
          is: "fixed",
          says: "A signature is a typed name, an email and a consent box, with time, IP and browser kept.",
        },
        {
          is: "needs",
          says: "Stripe connected, only for a deposit on signing.",
          built: "the Stripe setup (setup.stripe)",
        },
      ],
    },
  }),
];
