/**
 * The portal's apps, in launcher order: a client's work first, then each product, the
 * Marketplace, then Wren's own (Wren's workspace only). Account is a menu app, never a card.
 */
import type { Module } from "../module.js";
import { account } from "./account/index.js";
import { calendar, clientCalendar } from "./calendar/index.js";
import { calls } from "./calls/index.js";
import { clientLearn, learn } from "./learn/index.js";
import { library } from "./library/index.js";
import { clientMarketing, marketing } from "./marketing/index.js";
import { marketplace } from "./marketplace/index.js";
import { clientNotes, notes } from "./notes/index.js";
import { payments } from "./payments/index.js";
import { reactivation } from "./reactivation/index.js";
import { clientSites, sites } from "./sites/index.js";
import { texts } from "./texts/index.js";
import { voice } from "./voice/index.js";
import { work } from "./work/index.js";
import { leads, WREN_APPS } from "./wren/index.js";

export const MODULES: Module[] = [
  work,
  reactivation,
  leads,
  texts,
  calls,
  payments,
  marketplace,
  // One address, two apps: a client's own (its workspace) and Wren's (Wren's).
  clientMarketing,
  marketing,
  ...WREN_APPS,
  // One address, two apps, as Marketing.
  clientLearn,
  learn,
  // One address, two apps, as Marketing.
  clientSites,
  sites,
  library,
  // One address, two apps, as Marketing.
  clientNotes,
  notes,
  clientCalendar,
  calendar,
  voice,
  account,
];

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
