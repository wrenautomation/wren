/**
 * The default shape as the metro body: the stations of `SHAPE` in `journeys.ts`, with two
 * person tracks for Today's tasks. Its labels differ from the graph's on purpose: a story that
 * finds a graph node by name must not find a task row too. Synthetic data only. No imports from other mocks, so
 * `journeys.ts` and `map.ts` can both use it.
 */
import type { MetroBody } from "@wren/pipeline/metro";

export const SHAPE_METRO: MetroBody = {
  model: "metro",
  name: "Sample shape",
  lines: [
    {
      id: "mail",
      label: "Spring list",
      tier: "out",
      entry: { via: "outbound", channel: "email" },
    },
    { id: "ads1", label: "Winter ads", tier: "out", entry: { via: "ads", channel: "ads" } },
    { id: "starter", label: "Direct offer", tier: "front", offer: "starter", colour: 0 },
  ],
  stations: [
    { id: "hub", label: "Hub", kind: "hub", column: "marketing" },
    { id: "engaged", label: "Interested", kind: "att", line: "starter", column: "sales" },
    { id: "booked", label: "Call scheduled", kind: "time", line: "starter", column: "sales" },
    { id: "signed", label: "Won", kind: "cash", line: "starter", column: "money", deal: true },
  ],
  tracks: [
    {
      id: "engaged_to_booked",
      from: "engaged",
      to: "booked",
      line: "starter",
      by: "person",
      owner: "Ada North",
      promise: "4h",
    },
    // A long promise, so no story turns late as the date moves on.
    {
      id: "booked_to_signed",
      from: "booked",
      to: "signed",
      line: "starter",
      by: "person",
      owner: "Cai Moreno",
      promise: "3650d",
    },
    { id: "hub_to_engaged", from: "hub", to: "engaged", line: "starter", by: "system" },
  ],
  groups: [],
  frames: [],
};
