/**
 * `MetroView`: the map as the store holds it. Plain data, no positions. `layoutMetro` (layout.ts)
 * turns it into a `MetroScene`, which `MetroSvg` draws. A map of any size is a view: the layout
 * never asks for a hand-placed coordinate.
 */
import type { IconName } from "../icons.js";
import type { Mark } from "./types.js";

/** What a line is for: outreach (grey, thin), a front end (medium), the core (thick). */
export type LineTier = "out" | "front" | "core";

export interface ViewLine {
  id: string;
  /** The offer this line sells. An outreach line has none. */
  offer?: string;
  tier: LineTier;
  /** The line token index: `--ui-line-N`. Outreach lines take no colour. */
  colour?: number;
  /** An offer not live yet: it draws dotted. */
  plan?: boolean;
  /** A diff mark. Goes on each of its tracks and stations that have no mark of their own. */
  mark?: Mark;
}

/** The kinds the layout places. A split or join gate is `split` or `join`. */
export type ViewKind =
  | "att"
  | "time"
  | "cash"
  | "exit"
  | "hub"
  | "plan"
  | "dec"
  | "race"
  | "split"
  | "join"
  | "ab"
  | "ok"
  | "link";

export interface ViewStation {
  id: string;
  kind: ViewKind;
  /** The line it sits on. The hub joins every line, so its line is ignored. */
  line: string;
  /** The column it sits in: a name from `columns`. */
  column: string;
  /** Zoom folds a run of stations with the same group into one capsule. */
  group?: string;
  /** The flow (workflow) it belongs to. */
  flow?: string;
  label?: string;
  /** The line under the label: a count, a price. */
  sub?: string;
  /** People in it now: zoom adds them up for a capsule. */
  now?: number;
  /** A failure exit is red. */
  bad?: boolean;
  /** Split and join: "all", "any", "2 of 3". */
  rule?: string;
  /** A chip under it: "monthly", "retry · 1 of 2". */
  repeat?: string;
  repeatIcon?: IconName | null;
  plans?: string;
  bundle?: boolean;
  /** A diff mark. */
  mark?: Mark;
}

export interface ViewTrack {
  /** The track's id in the store. `onPick` answers it. Default: `${from}-${to}`. */
  id?: string;
  from: string;
  to: string;
  /** A system moves the person; a person acts, with an owner and a promise. */
  by: "system" | "person";
  owner?: string;
  promise?: string;
  late?: boolean;
  /** A branch label on the track, or a transfer's name ("upsell"). */
  label?: string;
  /** The task a person track makes on Today. */
  task?: string;
  /** Dots move along it. */
  moving?: boolean;
  /** The track is planned, not live. */
  plan?: boolean;
  /** A diff mark. */
  mark?: Mark;
}

export interface ViewGroup {
  id: string;
  label: string;
}

export interface MetroView {
  title?: string;
  lines: ViewLine[];
  stations: ViewStation[];
  tracks: ViewTrack[];
  groups?: ViewGroup[];
  /** The columns, left to right. Default: Marketing, Sales, Delivery, Money. */
  columns?: string[];
}

export const DEFAULT_COLUMNS = ["Marketing", "Sales", "Delivery", "Money"];
