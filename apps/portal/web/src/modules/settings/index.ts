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
    { id: "layout", label: "Layout", about: "How the portal sits on your screen.", Page: Display },
    { id: "themes", label: "Themes", about: "Try a look on Wren's workspace.", Page: Themes },
    { id: "look", label: "Look", about: "Colors and type in Wren's workspace.", Page: MyLook },
    {
      id: "guide",
      label: "Guide",
      about: "Where everything is, and the fastest ways to reach it.",
      Page: Guide,
    },
  ],
};
