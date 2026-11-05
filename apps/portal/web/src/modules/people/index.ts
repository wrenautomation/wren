/**
 * People (designs/2026-10-14-customerio-audit.md, B1): one profile per person in the workspace,
 * every address it goes by, its traits and its timeline. B2's sent log, B5's groups, B6's
 * broadcasts live here too.
 * One address, two apps: a client's own people and Wren's.
 */
import type { Module, ModulePage } from "../../module.js";
import { broadcastsPage, recipientsPage } from "./broadcasts.js";
import { importPage } from "./import.js";
import { LEAD_ACTIONS, withLeadCheck } from "./lead-check.js";
import { inlineDecide, researchAction } from "./research.js";
import { addToGroup, groupsPage, membersPage } from "./segments.js";
import { sentPage } from "./sent.js";
import { KIND_ICONS, profileExtras } from "./timeline.js";

/** The pages both apps share; each build adds its own here. */
const PEOPLE_PAGES: ModulePage[] = [
  {
    id: "people",
    label: "People",
    about: "Everyone, once each: where they stand, and whether they ever came toward us.",
    template: "list",
    record: "people.profile",
    empty: {
      all: "People show here once a lead, a text, a form or a booking names them.",
      warm: "Nobody has come toward us yet: no reply, visit, open or sign-up.",
      replied: "Nobody has written back yet.",
      booked: "Nobody has a call booked.",
      leads: "Nobody is called a lead yet. Open a person and press Lead.",
      clients: "No clients here yet.",
      cold: "Everyone here is warm.",
      subscribed: "Nobody has signed up for anything yet.",
      email: "Nobody with an email yet.",
      phone: "Nobody with a phone yet.",
      merged: "No two profiles have turned out to be one person yet.",
    },
    columns: ["name", "stage", "warmth", "warmthLine", "persona", "lastTouchAt"],
    // How long ago, never late: a last touch has no promise.
    late: { field: "lastTouchAt" },
    peek: {
      fields: [
        "stage",
        "warmth",
        "warmthLine",
        "persona",
        "emails",
        "phones",
        "subscriptions",
        "cameFrom",
        "repliedLast",
        "repliedChannel",
        "lastTouchAt",
        "lastChannel",
        "firstChannel",
        "lead",
      ],
    },
    // Research this person and its Keep and Drop are Wren's: the server describes them to Wren alone.
    actions: [addToGroup, researchAction, ...inlineDecide],
    extras: (detail, at) =>
      withLeadCheck(profileExtras(detail, at.act, String(at.row.name ?? "")), detail, at.row.id),
  },
  {
    id: "timeline",
    label: "Timeline",
    about: "Everything that happened with anyone, newest first, each line linked to its source.",
    template: "list",
    record: "people.event",
    empty: "Lines show here once someone gets a message, writes back, books or fills a form.",
    columns: ["at", "who", "kind", "channel", "summary"],
    timeline: {
      at: "at",
      kind: "kind",
      channel: "channel",
      who: "who",
      whoLink: "profileLink",
      link: "link",
      context: "context",
      note: "note",
      icons: KIND_ICONS,
    },
  },
  sentPage,
  groupsPage,
  broadcastsPage,
  recipientsPage,
  membersPage,
];

/** A client's People, in its own workspace. */
export const clientPeople: Module = {
  id: "people",
  name: "People",
  icon: "people",
  blurb: "Everyone you know, by every address they use, with all they did and got.",
  // Import is a client's own: it loads that client's contacts.
  pages: [...PEOPLE_PAGES, importPage],
};

/** Wren's own People, in Wren's workspace. */
export const people: Module = {
  ...clientPeople,
  blurb: "Everyone Wren knows, by every address they use, with all they did and got.",
  // The lead check is Wren's own: Jev's pick and William's call (a client's People has neither).
  pages: [
    ...PEOPLE_PAGES.map((p) =>
      p.id === "people" && "actions" in p
        ? { ...p, actions: [...(p.actions ?? []), ...LEAD_ACTIONS] }
        : p,
    ),
  ],
  requires: { audience: "team" },
};
