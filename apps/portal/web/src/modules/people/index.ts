/**
 * People (designs/2026-10-14-customerio-audit.md, B1): one profile per person in the workspace,
 * every address it goes by, its traits and its timeline. B2's sent log lives here too.
 * One address, two apps: a client's own people and Wren's.
 */
import type { Module, ModulePage } from "../../module.js";
import { importPage } from "./import.js";
import { sentPage } from "./sent.js";
import { profileExtras } from "./timeline.js";

/** The pages both apps share; each build adds its own here. */
export const PEOPLE_PAGES: ModulePage[] = [
  {
    id: "people",
    label: "People",
    about: "Everyone, once each, however many addresses they use.",
    template: "list",
    record: "people.profile",
    empty: {
      all: "People show here once a lead, a text, a form or a booking names them.",
      email: "Nobody with an email yet.",
      phone: "Nobody with a phone yet.",
      merged: "No two profiles have turned out to be one person yet.",
    },
    columns: ["name", "emails", "phones", "channels", "lastSeen", "consent"],
    extras: (detail) => profileExtras(detail),
  },
  {
    id: "timeline",
    label: "Timeline",
    about: "Everything that happened with anyone, newest first, each line linked to its source.",
    template: "list",
    record: "people.event",
    empty: "Lines show here once someone gets a message, writes back, books or fills a form.",
    columns: ["at", "who", "kind", "channel", "summary"],
  },
  sentPage,
  {
    id: "data",
    label: "Data",
    about: "Every address kind, trait and timeline kind: where it comes from and who has it.",
    template: "list",
    record: "people.datum",
    empty: "Data shows here once the first profile is made.",
    columns: ["what", "name", "sources", "people", "rows", "lastSeen", "usedBy", "list"],
  },
  {
    id: "addresses",
    label: "Addresses",
    about: "Every email, phone, handle and cookie a profile goes by.",
    hidden: true,
    template: "list",
    record: "people.key",
    empty: "No addresses yet.",
  },
  {
    id: "traits",
    label: "Traits",
    about: "What we know about each person, one value per trait, every change kept.",
    hidden: true,
    template: "list",
    record: "people.trait",
    empty: "No traits yet.",
  },
  {
    id: "merges",
    label: "Merges",
    about: "Profiles that turned out to be one person, and what moved.",
    hidden: true,
    template: "list",
    record: "people.merge",
    empty: "No merges yet.",
  },
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
  pages: PEOPLE_PAGES,
  requires: { audience: "team" },
};
