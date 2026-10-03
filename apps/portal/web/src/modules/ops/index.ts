/** Wren's own tools across every client. Team only: off the launcher for anyone else. */
import type { Module } from "../../module.js";
import { Clients } from "./Clients.js";
import "./ops.css";

export const ops: Module = {
  id: "ops",
  name: "Wren ops",
  icon: "board",
  blurb: "Every client's project on one board, the ones at risk first.",
  requires: { audience: "team" },
  pages: [{ id: "clients", label: "Clients", Page: Clients }],
};
