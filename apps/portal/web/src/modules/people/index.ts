/**
 * People (designs/2026-10-14-customerio-audit.md, B1): one profile per person in the workspace,
 * every address it goes by, its traits and its timeline. B2's sent log lives here too.
 * One address, two apps: a client's own people and Wren's.
 */
import type { Module, ModulePage } from "../../module.js";
import { sentPage } from "./sent.js";

/** The pages both apps share; each build adds its own here. */
export const PEOPLE_PAGES: ModulePage[] = [sentPage];

/** A client's People, in its own workspace. */
export const clientPeople: Module = {
  id: "people",
  name: "People",
  icon: "people",
  blurb: "Everyone you know, by every address they use, with all they did and got.",
  pages: PEOPLE_PAGES,
};

/** Wren's own People, in Wren's workspace. */
export const people: Module = {
  ...clientPeople,
  blurb: "Everyone Wren knows, by every address they use, with all they did and got.",
  requires: { audience: "team" },
};
