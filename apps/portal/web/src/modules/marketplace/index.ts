/**
 * The Marketplace, in a client's workspace: a shop of every part and workflow
 * (`console.component`), filtered by stage, channel, status, type and effects, installed or not
 * for this client. Wren's team installs; a client asks. Never on the demo host: what
 * a sample firm could install says nothing about it. The Map draws what builds on
 * what. Browser mods list autobrowse's on npm.
 */
import type { Module } from "../../module.js";
import { catalogExtras } from "./Catalog.js";
import { ComponentMap } from "./Map.js";
import { Mods } from "./Mods.js";

export const marketplace: Module = {
  id: "marketplace",
  name: "Marketplace",
  icon: "apps",
  blurb: "Everything Wren can run for you, and what each part needs.",
  requires: { audience: "client" },
  pages: [
    {
      id: "catalog",
      label: "Catalog",
      template: "shop",
      record: "console.component",
      empty: { installed: "Nothing installed yet." },
      columns: ["instead", "type", "ready", "installed"],
      extras: catalogExtras,
    },
    { id: "map", label: "Map", Page: ComponentMap },
    { id: "mods", label: "Browser mods", Page: Mods },
  ],
};
