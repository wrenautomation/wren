/**
 * The Marketplace, in a client's workspace: a shop of every template, part and workflow
 * (`console.component`), each kind in its own section, filtered by stage, channel, status, type
 * and effects, installed or not for this client. Wren's team installs; a client asks. Never on the demo host: what
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
      columns: ["instead", "type", "ready", "installed", "state"],
      // Templates first: a whole workflow in one go is where a client starts.
      sections: {
        field: "type",
        order: ["template", "part", "workflow"],
        names: { template: "Templates", part: "Parts", workflow: "Workflows" },
        blurbs: {
          template: "A whole workflow in one install: its parts, their settings and its copy.",
          part: "One piece at a time.",
          workflow: "How parts connect. Each installs part by part.",
        },
      },
      extras: catalogExtras,
    },
    { id: "map", label: "Map", Page: ComponentMap },
    { id: "mods", label: "Browser mods", Page: Mods },
  ],
};
