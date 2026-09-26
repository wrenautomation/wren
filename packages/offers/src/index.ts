/**
 * The offer registry. Every offer we pitch anywhere is one entry here; niches name the
 * offer each email arm pitches, the lander renders from an exported snapshot, and every
 * enrollment and deal stores the id. Adding an offer = one `defineOffer` + one entry.
 */
import { opsAudit, opsAutomationBuild } from "./catalog/operations.js";
import {
  recruitingCandidateReactivation,
  recruitingReactivationPilot,
} from "./catalog/recruiting.js";
import type { Offer } from "./offer.js";

export type {
  Answers,
  Application,
  Choice,
  FitRule,
  Measure,
  MeasureUnit,
  Offer,
  OfferStatus,
  Price,
  Question,
  UsdRange,
} from "./offer.js";
export {
  defineOffer,
  fits,
  invalidAnswers,
  MEASURE_UNITS,
  OFFER_ID_MAX,
  OFFER_STATUSES,
  offerFacts,
} from "./offer.js";
export { SNAPSHOT_VERSION, type Snapshot, snapshot } from "./snapshot.js";

/** Check the registry as a whole: unique ids, a ladder that resolves and never loops. */
export function registry(offers: readonly Offer[]): readonly Offer[] {
  const byId = new Map<string, Offer>();
  for (const o of offers) {
    if (byId.has(o.id)) throw new Error(`offer '${o.id}' registered twice`);
    byId.set(o.id, o);
  }
  const pages = new Map<string, string>();
  for (const o of offers) {
    for (const id of o.next) {
      const to = byId.get(id);
      if (to === undefined) throw new Error(`offer '${o.id}' leads to unknown offer '${id}'`);
      if (o.status === "live" && to.status === "retired") {
        throw new Error(`live offer '${o.id}' leads to retired offer '${id}'`);
      }
    }
    if (o.status === "live" && o.page !== null) {
      // A page presents one live offer as its main one; two would argue on the same page.
      const taken = pages.get(o.page);
      if (taken !== undefined) {
        throw new Error(`live offers '${taken}' and '${o.id}' both claim page '${o.page}'`);
      }
      pages.set(o.page, o.id);
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const walk = (id: string, path: readonly string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      throw new Error(`offer ladder loops: ${[...path, id].join(" -> ")}`);
    }
    state.set(id, "visiting");
    for (const next of (byId.get(id) as Offer).next) walk(next, [...path, id]);
    state.set(id, "done");
  };
  for (const o of offers) walk(o.id, []);
  return [...offers];
}

export const OFFERS: readonly Offer[] = registry([
  recruitingReactivationPilot,
  recruitingCandidateReactivation,
  opsAudit,
  opsAutomationBuild,
]);
export const OFFER_IDS: ReadonlySet<string> = new Set(OFFERS.map((o) => o.id));
/** Every page the site serves an offer on. The lander builds exactly these, so a link anywhere else 404s or redirects. */
export const OFFER_PAGES: ReadonlySet<string> = new Set(
  OFFERS.flatMap((o) => (o.status === "live" && o.page !== null ? [o.page] : [])),
);

const byId = new Map(OFFERS.map((o) => [o.id, o] as const));

/** The offer, or a throw naming what is registered. */
export function offerFor(id: string): Offer {
  const found = byId.get(id);
  if (found === undefined) {
    throw new Error(`unknown offer '${id}' — registered: ${[...OFFER_IDS].sort().join(", ")}`);
  }
  return found;
}
