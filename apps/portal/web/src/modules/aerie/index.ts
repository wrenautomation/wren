/**
 * Aerie: one task system for all work (aerie repo, designs/2026-11-12-aerie.md D16). Wren's team only until
 * tenants (phase 6). Every route is Aerie's own (`@wrenautomation/aerie/http`), served by AerieConsole.
 */
import type { Module } from "../../module.js";
import { DecisionsPage } from "./decisions.js";
import { HistoryPage } from "./history.js";
import { TasksPage } from "./tasks.js";

export const aerie: Module = {
  id: "aerie",
  name: "Aerie",
  icon: "board",
  blurb: "Every task of every kind: who does it, who manages it, and what it waits on.",
  product: "Aerie",
  requires: { audience: "team" },
  pages: [
    {
      id: "tasks",
      label: "Tasks",
      about: "Every task, filtered and grouped as the address says.",
      Page: TasksPage,
      wide: true,
    },
    {
      id: "decisions",
      label: "Decisions",
      about: "What only a person decides: each with its brief, its options and the tasks it holds.",
      Page: DecisionsPage,
    },
    {
      id: "history",
      label: "History",
      about: "Every change to every task, newest first: who did what, and why.",
      Page: HistoryPage,
    },
  ],
};
