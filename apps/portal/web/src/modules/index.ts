/**
 * The portal's apps: the product shell for a client and for Wren (`./places.ts`), Research and
 * Variants, Canon and Aerie.
 */

import type { Module } from "../module.js";
import { aerie } from "./aerie/index.js";
import { canon } from "./canon/index.js";
import { explorer } from "./explorer/index.js";
import { CLIENT_PLACES, TEAM_PLACES } from "./places.js";
import { research } from "./research/index.js";
import { variants } from "./variants/index.js";

export const MODULES: Module[] = [
  // One address, two apps: a client's place in its own workspace, Wren's in Wren's.
  ...CLIENT_PLACES,
  ...TEAM_PLACES,
  research,
  canon,
  aerie,
  variants,
  explorer,
];

/**
 * A workspace's apps: Wren's own in Wren's. In a client's, each app with the pages of the
 * components it has installed; Wren's team sees every page, the missing ones marked off.
 */
export const appsIn = (
  modules: readonly Module[],
  at: { wren: boolean; team: boolean; installed: ReadonlySet<string> },
): Module[] =>
  modules.flatMap((m) => {
    if ((m.requires?.audience === "team") !== at.wren) return [];
    const has = (c: string | undefined) => at.wren || at.team || !c || at.installed.has(c);
    if (!has(m.component)) return [];
    const pages = m.pages.filter((p) => has(p.component));
    // a place with no pages by design (the Map) stays
    if (!pages.length && m.pages.length) return [];
    return pages.length === m.pages.length ? [m] : [{ ...m, pages }];
  });
