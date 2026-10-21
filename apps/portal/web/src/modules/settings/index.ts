/**
 * Admin. Wren's own settings, for the person signed in: layout, look, a guide to the portal, and
 * Systems (every app, and where it sits on the shape).
 */
import type { Module } from "../../module.js";
import { Display } from "./Display.js";
import { Guide } from "./Guide.js";
import { MyLook, Themes } from "./Look.js";
import { Systems } from "./Systems.js";

const SYSTEMS = {
  id: "systems",
  label: "Systems",
  about: "Every app, and where it sits on your shape.",
  Page: Systems,
} as const;

export const settings: Module = {
  id: "settings",
  name: "Settings",
  icon: "sliders",
  blurb: "Your layout, your themes and colors, and a guide to every app and key.",
  requires: { audience: "team" },
  pages: [
    { id: "layout", label: "Layout", about: "How the portal sits on your screen.", Page: Display },
    { id: "themes", label: "Themes", about: "Try a look on Wren's workspace.", Page: Themes },
    { id: "look", label: "Look", about: "Colors and type in Wren's workspace.", Page: MyLook },
    {
      id: "guide",
      label: "Guide",
      about: "Where everything is, and the fastest ways to reach it.",
      Page: Guide,
    },
    SYSTEMS,
  ],
};

/** A client's Admin: Systems alone, for a login that manages the workspace. One address, two apps. */
export const clientSettings: Module = {
  id: "settings",
  name: "Admin",
  icon: "sliders",
  blurb: "Every app in your workspace, and where it sits on your shape.",
  requires: { audience: "client", needs: "manage" },
  pages: [SYSTEMS],
};
