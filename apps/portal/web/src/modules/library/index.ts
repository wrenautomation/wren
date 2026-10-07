/**
 * The Library: the words Wren sends and the sequences that send them (Wren's workspace).
 * Templates edit in place through the records layer: a save keeps a draft, Publish makes it
 * live, History and Undo cover both, and nothing sends from here.
 */
import type { Module } from "../../module.js";
import { sequenceExtras } from "./sequences.js";
import { RECORD, TEMPLATE_ACTIONS, templateExtras } from "./templates.js";

export const library: Module = {
  id: "library",
  name: "Library",
  icon: "board",
  blurb: "Every template and prompt, its versions and numbers, and the sequences that use it.",
  requires: { audience: "team" },
  pages: [
    {
      id: "templates",
      label: "Templates",
      template: "list",
      record: RECORD,
      empty: {
        all: "No template is stored yet.",
        drafts: "No draft waits to be published.",
        prompts: "No prompt is stored yet.",
      },
      actions: TEMPLATE_ACTIONS,
      columns: ["name", "kind", "system", "state", "liveVersion", "sends", "replyRate"],
      extras: templateExtras,
      count: { state: ["draft"] },
    },
    {
      id: "sequences",
      label: "Sequences",
      template: "list",
      record: "templates.sequence",
      empty: "No workflow sends a sequence.",
      columns: ["name", "channel", "system", "steps", "blurb"],
      extras: sequenceExtras,
    },
  ],
};
