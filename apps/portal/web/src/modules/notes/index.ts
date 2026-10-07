/**
 * Notes (designs/2026-10-07-notes.md): Docs in the portal. Rough thoughts to full docs, each with
 * its versions and sharing, and links to the records it names. One address, two apps, as
 * Marketing: Wren's team's in Wren's workspace, a client's people's in theirs.
 */
import { lazy } from "react";
import type { Module } from "../../module.js";
import { NotesHome } from "./home.js";
import { NoteMentions, unseenMentions } from "./mentions.js";

// The editor (Tiptap, Yjs) loads with the first note opened, not with the portal.
const NoteDoc = lazy(() => import("./doc.js").then((m) => ({ default: m.NoteDoc })));

const pages: Module["pages"] = [
  { id: "home", label: "Notes", Page: NotesHome, wide: true },
  { id: "mentions", label: "Mentions", Page: NoteMentions, badge: unseenMentions },
  { id: "doc", label: "Note", Page: NoteDoc, wide: true, hidden: true },
];

export const notes: Module = {
  id: "notes",
  name: "Notes",
  icon: "note",
  blurb: "Rough thoughts, plans and docs, with versions and sharing.",
  requires: { audience: "team" },
  pages,
};

export const clientNotes: Module = {
  id: "notes",
  name: "Notes",
  icon: "note",
  blurb: "Your team's notes and docs, with versions and sharing.",
  requires: { audience: "client", needs: "read", at: { app: "notes" } },
  pages,
};
