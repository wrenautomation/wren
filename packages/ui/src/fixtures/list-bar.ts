/**
 * What a list bar reads besides its rows: the viewer's saved views (`KeepApi`), the rows per
 * state under the other filters (`facets`) and the tab counts. Synthetic data only.
 */
import type { RecordMeta } from "@wren/core/records";
import type { Facets, KeepApi, SavedViewLine } from "../list-bar.js";
import { answer, fails, pending } from "./load.js";
import { LEAD_META } from "./records.js";
import { WORST } from "./worst.js";

/** The rows each of the lead views holds. */
export const LEAD_COUNTS: Record<string, number> = { waiting: 6, approved: 4, all: 14 };

/** Rows per state, as Filter's choices show them. */
export const LEAD_FACETS: Facets = {
  state: { waiting: 6, approved: 4, rejected: 1, closed: 3 },
};

const line = (id: number, name: string, params: string, mine = true): SavedViewLine => ({
  id,
  name,
  params,
  shared: !mine,
  mine,
});

/** Two saved views: one his own, one shared by a teammate. */
export const SAVED: SavedViewLine[] = [
  line(1, "Big and waiting", "state=waiting&sort=-value"),
  line(2, "Team: this week", "view=all&sort=-seen", false),
];

/** Saved views to overfill the bar: long names, a missing name, more than five tabs hold. */
export const WORST_SAVED: SavedViewLine[] = [
  line(11, WORST.longLabel, "state=waiting"),
  line(12, WORST.nonLatin, "state=approved"),
  line(13, WORST.emoji, "state=closed"),
  line(14, WORST.rtl, "state=rejected", false),
  line(15, WORST.shortName, "view=all"),
  line(16, WORST.longName, "view=all&sort=-value", false),
];

/** The lead type with no views, no filter shape and nothing to search: the bar at its barest. */
export const BARE_META: RecordMeta = {
  ...LEAD_META,
  views: [],
  fields: LEAD_META.fields
    .filter((f) => f.key === "name")
    .map((f) => ({ ...f, searchable: false })),
};

export type Read = "ok" | "pending" | "fails";

const one = <T>(how: Read, data: T): (() => Promise<T>) =>
  how === "ok" ? answer(data) : how === "pending" ? pending<T>() : fails<T>();

/**
 * A viewer's saved views kept in memory. `views` is the read the bar waits on; a write answers
 * at once (a story is read-only).
 */
export function fakeKeep(how: Read = "ok", lines: SavedViewLine[] = SAVED): KeepApi {
  return {
    views: one(how, lines),
    save: async (v) => ({ ...line(99, v.name ?? "New view", v.params ?? ""), shared: !!v.shared }),
    remove: async () => ({}),
    move: async () => lines,
    prefs: async () => ({}),
    setPref: async () => ({}),
  };
}

/** Filter's counts read: answers, never answers, or fails. */
export const facetsOf = (how: Read, data: Facets = LEAD_FACETS) => one(how, data);
