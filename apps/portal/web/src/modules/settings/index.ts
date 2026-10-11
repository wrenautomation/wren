/** Wren's own settings, for the person signed in: layout, look, and a guide to the portal. */
import type { Module } from "../../module.js";
import { Display } from "./Display.js";
import { Guide } from "./Guide.js";
import { MyLook, Themes } from "./Look.js";

export const settings: Module = {
  id: "settings",
  name: "Settings",
  icon: "sliders",
  blurb: "Your layout, your themes and colors, and a guide to every app and key.",
  requires: { audience: "team" },
  pages: [
    { id: "layout", label: "Layout", Page: Display },
    { id: "themes", label: "Themes", Page: Themes },
    { id: "look", label: "Look", Page: MyLook },
    { id: "guide", label: "Guide", Page: Guide },
  ],
};
