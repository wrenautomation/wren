/**
 * Documents (designs/2026-10-09-documents.md): contracts, proposals and estimates from the
 * client's templates, sent by text or email, signed on a page under its name, a deposit on signing.
 */
import type { Module } from "../../module.js";
import {
  DOC_ACTIONS,
  docExtras,
  documentsHead,
  TEMPLATE_ACTIONS,
  templateExtras,
  templatesHead,
} from "./documents.js";

export const documents: Module = {
  id: "documents",
  name: "Documents",
  component: "documents.docs",
  icon: "doc",
  blurb: "Send an estimate or a contract to sign. See who signed and who paid the deposit.",
  pages: [
    {
      id: "all",
      label: "Documents",
      template: "list",
      record: "documents.document",
      columns: ["number", "title", "kind", "who", "total", "status", "createdAt", "signedAt"],
      count: { status: ["waiting"] },
      empty: {
        open: "No document out. Make one with New document, or Send estimate from a texting thread.",
        waiting: "Nothing to approve.",
        signed: "Nothing signed yet.",
        all: "No documents yet. Make one with New document.",
      },
      actions: DOC_ACTIONS,
      head: documentsHead,
      extras: docExtras,
    },
    {
      id: "templates",
      label: "Templates",
      template: "list",
      record: "documents.template",
      columns: ["name", "kind", "lines", "depositPct", "expiresDays", "starter"],
      empty: "No templates. Add one, or start a document blank.",
      actions: TEMPLATE_ACTIONS,
      head: templatesHead,
      extras: templateExtras,
    },
  ],
};
