/**
 * Aerie: one task system for all work (aerie repo, designs/2026-11-12-aerie.md D16). Wren's team only until
 * tenants (phase 6). Every route is Aerie's own (`@wrenautomation/aerie/http`), served by AerieConsole.
 */
import type { Module } from "../../module.js";
import { TasksPage } from "./tasks.js";

export const aerie: Module = {
  id: "aerie",
  name: "Aerie",
  icon: "board",
  blurb: "Every task of every kind: who does it, who manages it, and what it waits on.",
  product: "Aerie",
  requires: { audience: "team" },
  // off the sidebar until a row opens its task (DetailSheet); the address still reaches it
  parked: true,
  pages: [
    {
      id: "tasks",
      label: "Tasks",
      about: "Every task, filtered and grouped as the address says. Open one to read it whole.",
      Page: TasksPage,
      wide: true,
    },
  ],
};
