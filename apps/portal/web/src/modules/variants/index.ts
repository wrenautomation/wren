/** Variants: Campaigns' review page for the agent's batches (designs/2026-11-05-variants.md). */
import type { HandPage } from "../../module.js";
import { toPick, VariantsPage } from "./page.js";

export const variantsPage: HandPage = {
  id: "variants",
  label: "Variants",
  about:
    "Batches the agent made: mark what's good or bad and say where; it makes the next from that.",
  group: "Variants",
  Page: VariantsPage,
  wide: true,
  badge: (_client, team) => (team ? toPick() : Promise.resolve(0)),
};
