/** Aerie: the portal's task board and finder (designs: aerie repo, designs/2026-11-12-aerie.md). */
import { makeAerieConsole } from "@wren/aerie/restate";
import type { AnyService, Deps } from "./deps.js";

export function aerieServices(deps: Deps): AnyService[] {
  return [makeAerieConsole(deps.db)];
}
