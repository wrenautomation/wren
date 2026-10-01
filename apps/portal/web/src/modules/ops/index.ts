/** Wren's own tools across every client. Team only: off the sidebar for anyone else. */
import type { Module } from "../../module.js";
import { Clients } from "./Clients.js";
import "./ops.css";

export const ops: Module = {
  id: "ops",
  name: "Wren ops",
  team: true,
  pages: [{ id: "clients", label: "Clients", icon: "people", Page: Clients }],
};
