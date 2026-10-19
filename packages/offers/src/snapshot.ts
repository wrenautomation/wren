/**
 * The registry as JSON, for readers outside this repo (the lander builds from it). A
 * snapshot is generated, never edited: `pnpm offers:export <file>` writes it, and
 * `--check` fails when the file no longer matches the registry. A draft offer is not exported:
 * it is being written, and nothing outside this repo may read it yet.
 */
import type { Offer } from "./offer.js";

/** Bumped when the snapshot's shape changes, so a reader can refuse one it doesn't know. */
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  readonly version: number;
  readonly note: string;
  readonly offers: readonly Offer[];
}

export function snapshot(offers: readonly Offer[]): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    note: "Generated from wren packages/offers by `pnpm offers:export`. Edit the offer there, not here.",
    // The plan, access, review moments, upsell, add-on, target and icp are the portal's, not the site's.
    offers: offers
      .filter((o) => o.status !== "draft")
      .map(
        ({
          plan: _,
          access: __,
          reviewAfterFirst: ___,
          upsell: ____,
          app: _____,
          perUnitMeasure: ______,
          addOn: _______,
          target: ________,
          icp: _________,
          ...o
        }) => o,
      ),
  };
}

/** The file's exact text: stable key order (the registry's own), two-space indent, newline. */
export function snapshotText(offers: readonly Offer[]): string {
  return `${JSON.stringify(snapshot(offers), null, 2)}\n`;
}
