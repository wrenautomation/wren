/** Wren's own look, for the person signed in. */
import type { Module } from "../../module.js";
import { Experiments } from "./Experiments.js";
import { MyLook } from "./Look.js";

export const settings: Module = {
  id: "settings",
  name: "Settings",
  icon: "sliders",
  blurb: "Colors and type in Wren's workspace.",
  requires: { audience: "team" },
  pages: [
    { id: "look", label: "Look", about: "Colors and type in Wren's workspace.", Page: MyLook },
    {
      id: "experiments",
      label: "Experiments",
      about: "Layout directions to look at, not live.",
      Page: Experiments,
      wide: true,
    },
  ],
};
