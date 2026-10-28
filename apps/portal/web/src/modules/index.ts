/**
 * The portal's apps, in this order within each sidebar area (areas.ts): a client's work first, then each product, the
 * Marketplace, then Wren's own (Wren's workspace only). Account is a menu app, never a card.
 */

import type { Module } from "../module.js";
import { account } from "./account/index.js";
import { analytics } from "./analytics/index.js";
import { calendar, clientCalendar } from "./calendar/index.js";
import { calls } from "./calls/index.js";
import { clientDeals, pipelines } from "./deals/index.js";
import { documents } from "./documents/index.js";
import { clientLearn, learn } from "./learn/index.js";
import { library } from "./library/index.js";
import { ads, clientMarketing, content } from "./marketing/index.js";
import { marketplace, wrenMarketplace } from "./marketplace/index.js";
import { clientNotes, notes } from "./notes/index.js";
import { numbers } from "./numbers/index.js";
import { offers } from "./offers/index.js";
import { engage } from "./outreach/index.js";
import { payments } from "./payments/index.js";
import { clientPeople, people } from "./people/index.js";
import { reactivation } from "./reactivation/index.js";
import { research } from "./research/index.js";
import { clientSettings, settings } from "./settings/index.js";
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
  documents,
  // One address, two apps: a client's journeys in its own, Wren's pipelines in Wren's.
  clientDeals,
  pipelines,
  offers,
  numbers,
  // One address, two apps, as Pipelines: a client's people in its own, Wren's in Wren's.
  clientPeople,
  people,
  // One address, two apps, as Pipelines.
  marketplace,
  wrenMarketplace,
  // A client's Marketing, in its own workspace. Wren's is Content, Engage, Outbound, Ads, Analytics.
  clientMarketing,
  content,
  engage,
  ads,
  analytics,
  ...WREN_APPS,
  research,
  // One address, two apps, as Sites.
  clientLearn,
  learn,
  // One address, two apps, as Sites.
  clientSites,
  sites,
  library,
  // One address, two apps, as Sites.
  clientNotes,
  notes,
  clientCalendar,
  calendar,
  voice,
  // One address, two apps, as People: a client's Admin in its own, Wren's Settings in Wren's.
  clientSettings,
  settings,
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
