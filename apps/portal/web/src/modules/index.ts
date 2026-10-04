/**
 * The portal's apps, in launcher order: a client's work first, then each product, the
 * Marketplace, then Wren's own (Wren's workspace only). Account is a menu app, never a card.
 */
import type { Module } from "../module.js";
import { account } from "./account/index.js";
import { marketplace } from "./marketplace/index.js";
import { reactivation } from "./reactivation/index.js";
import { work } from "./work/index.js";
import { WREN_APPS } from "./wren/index.js";

export const MODULES: Module[] = [work, reactivation, marketplace, ...WREN_APPS, account];

/**
 * A workspace's apps: Wren's own in Wren's. In a client's, the platform's and those of the
 * components it has installed; Wren's team sees the rest too, marked on their cards.
 */
export const appsIn = (
  modules: readonly Module[],
  at: { wren: boolean; team: boolean; installed: ReadonlySet<string> },
) =>
  modules.filter(
    (m) =>
      (m.requires?.audience === "team") === at.wren &&
      (at.wren || at.team || !m.component || at.installed.has(m.component)),
  );
