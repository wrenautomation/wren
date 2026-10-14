/**
 * The Library: the words Wren sends and the sequences that send them (Wren's workspace).
 * Templates browse by folder and edit in a browser (TemplatesConsole): a save keeps a numbered
 * version, publishing copy that sends waits in To approve, and nothing sends from here. Snippets are inserted from
 * any draft or reply box; Media, Sections, SOPs and Workflows read only, a workflow opening on the canvas.
 */
import { findAll, findRecords, findTemplates } from "../../find.js";
import type { Module } from "../../module.js";
import { workflowExtras } from "./flows.js";
import { mediaExtras } from "./media.js";
import { Sections } from "./sections.js";
import { sequenceExtras } from "./sequences.js";
import { SNIPPET, SNIPPET_ACTIONS, snippetExtras } from "./snippets.js";
import { Templates } from "./templates.js";

export const library: Module = {
  id: "library",
  name: "Library",
  icon: "stack",
  blurb: "Every template, sequence, snippet, video and SOP, with its numbers and where it's used.",
  find: findAll(
    findTemplates,
    findRecords({ record: "library.workflow", path: "/library/workflows", kind: "Workflow" }),
    findRecords({ record: "templates.sequence", path: "/library/sequences", kind: "Sequence" }),
  ),
  requires: { audience: "team" },
  pages: [
    // A browser: folders, rows, the open one's editor, history and numbers.
    {
      id: "templates",
      label: "Templates",
      about: "Every template and prompt, by folder, with its versions.",
      Page: Templates,
      wide: true,
    },
    {
      id: "sequences",
      label: "Sequences",
      about: "The email sequences our workflows send.",
      template: "list",
      record: "templates.sequence",
      empty: "No workflow sends a sequence.",
      columns: ["name", "channel", "system", "steps", "blurb"],
      extras: sequenceExtras,
    },
    {
      id: "snippets",
      label: "Snippets",
      about: "Replies you send often, ready to drop into any draft.",
      template: "list",
      record: SNIPPET,
      empty: "No snippets yet. Save a reply you send often, then insert it from any draft.",
      actions: SNIPPET_ACTIONS,
      columns: ["title", "channel", "tags", "body", "updatedAt"],
      extras: snippetExtras,
    },
    {
      id: "media",
      label: "Media",
      about: "Every rendered file, and where it went.",
      template: "list",
      record: "library.media",
      empty: "No video is rendered yet.",
      columns: ["name", "kind", "video", "used", "url", "changed"],
      extras: mediaExtras,
    },
    // Read only: the blocks of a Sections page, drawn from sample words.
    {
      id: "sections",
      label: "Sections",
      about: "The blocks a page is built from.",
      Page: Sections,
    },
    {
      id: "sops",
      label: "SOPs",
      about: "The SOPs the content loop follows.",
      template: "list",
      record: "library.sop",
      empty: "No SOP is pushed yet.",
      columns: ["sop", "platform", "versions", "pushed"],
    },
    {
      id: "workflows",
      label: "Workflows",
      about: "Saved workflow templates, and how each one is wired.",
      template: "list",
      record: "library.workflow",
      empty: "No workflow is declared.",
      columns: ["name", "blurb", "for", "from", "steps"],
      extras: workflowExtras,
    },
  ],
};
