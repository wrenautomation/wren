/**
 * The metro map's scene: a drawing with every mark placed. A faithful, typed port of the scene the
 * design language artifact hands its `draw` (designs/2026-10-20-design-language/metro-render.js).
 * `MetroView` (view.ts) is the same map as plain data with no positions; `layoutMetro` makes a scene.
 */
import type { IconName } from "../icons.js";

export type Point = [number, number];

/** A line key: "out" is outreach (`--ui-line-out`, no offer); any other key is an offer's line. */
export type LineKey = string;

/** The job of a line sets its weight: out 3, front 7, core 12. */
export type Weight = "out" | "front" | "core";

export type StationKind =
  | "att" // attention: the person gave a look, a click or a reply
  | "time" // the person gave time on a calendar
  | "cash" // cash comes in
  | "exit" // the person leaves this line
  | "hub" // where all outreach lands
  | "plan" // a step we intend to add
  | "dec" // condition: a hollow diamond
  | "race" // event race: a filled diamond
  | "par" // split or join gate
  | "ab" // A/B split
  | "ok" // approval
  | "link"; // shared flow

export type Side = "up" | "down" | "left" | "right";

/** A diff mark: the part is new, changed or gone since the other side. */
export type Mark = "added" | "changed" | "removed";

/** An ordinary station: a marker with a name and a count under it. */
export interface MarkStation {
  id: string;
  t: StationKind;
  x: number;
  y: number;
  /** Its radius, when bigger than its kind's: a hub that many rows join. */
  r?: number;
  /** Name, and the line under it. */
  n?: string;
  s?: string;
  /** Where the name sits. */
  p?: Side;
  /** A failure exit is red. */
  bad?: boolean;
  /** A bundle is one money station that starts several lines: a stacked card. */
  bundle?: boolean;
  /** Split and join: "all", "any" or "2 of 3". */
  rule?: string;
  /** The chip under it, and its glyph (null: none; default: repeat). */
  rep?: string;
  repGlyph?: IconName | null;
  plans?: string;
  /** Zoom reads these: the line it is on, its group, the people in it now. */
  ln?: string;
  g?: string;
  /** The flow it belongs to (a workflow). Focus on a flow reads this. */
  flow?: string;
  now?: number;
  /** A diff mark: ring and tag. */
  mark?: Mark;
}

/** A run of stations folded into one capsule. */
export interface CapsuleStation {
  id: string;
  cap: [number, number];
  y: number;
  x?: number;
  l: LineKey;
  n: string;
  now: number;
  /** A late person track inside rings it amber. */
  late?: boolean;
  grp?: string;
  /** A diff mark: any mark inside shows on the capsule. */
  mark?: Mark;
  /** The side its name sits on. Default: up. */
  p?: Side;
}

/** A loop folded: one ring in the line colour. */
export interface RingStation {
  id: string;
  ring: true;
  x: number;
  y: number;
  l: LineKey;
  n: string;
  s?: string;
  r?: number;
  grp?: string;
}

/** A whole offer folded: one badge with its name and numbers. */
export interface BadgeStation {
  id: string;
  badge: true;
  x: number;
  y: number;
  l: LineKey;
  n: string;
  s: string;
  w?: number;
  glyph?: IconName;
  grp?: string;
}

export type SceneStation = MarkStation | CapsuleStation | RingStation | BadgeStation;

export const isCapsule = (s: SceneStation): s is CapsuleStation => "cap" in s;
export const isRing = (s: SceneStation): s is RingStation => "ring" in s;
export const isBadge = (s: SceneStation): s is BadgeStation => "badge" in s;
export const isMark = (s: SceneStation): s is MarkStation => "t" in s;

/** A track between two stations (a, b), or between two points (pa, pc), or along `pts`. */
export interface MetroTrack {
  id?: string;
  a?: string;
  b?: string;
  l?: LineKey;
  w?: Weight;
  /** plan: dotted. ab: an A/B arm. exit: a dotted spur out. xfer: a 45 degree transfer to another line. */
  k?: "plan" | "ab" | "exit" | "xfer";
  pts?: Point[];
  /** Corner radius. */
  r?: number;
  pa?: Point;
  pc?: Point;
  /** Offsets from the ends' y: both, the start, the end. */
  o?: number;
  oa?: number;
  ob?: number;
  /** Where its 45 degree part sits: at the start or the end. Default: the middle. */
  bend?: "a" | "b";
  /** A person track: "WJ · 4h" is owner and promise. */
  who?: string;
  late?: boolean;
  /** Where its pill sits, and a nudge down. `layoutMetro` sets the place in the free part of the track. */
  at?: Point;
  bdy?: number;
  /** The pill folded to a dot at `at` that says this many tasks: the track has no room for it. */
  dot?: number;
  /** A branch label on the track, its glyph, its place. */
  cond?: string;
  condGlyph?: IconName | null;
  cat?: Point;
  /** A track back along its own row runs on a rail this far under the row (`layoutMetro` sets it). */
  back?: number;
  /** Tracks on one rail with one branch label show it once: this one draws no chip. */
  condShared?: boolean;
  /** Dots move along it: how many, how many seconds a lap. */
  mv?: boolean;
  dots?: number;
  dur?: number;
  /** A transfer's label, and how far along it sits. */
  lab?: string;
  f?: number;
  /** The task a person track makes on Today. */
  task?: string;
  med?: string;
  /** A diff mark: stroke and tag. */
  mark?: Mark;
  /** A stub: this track leaves the focused part. It draws faded, with a label, and is a button. */
  stub?: StubSpec;
}

/** A part of the map that focus can single out. */
export interface MetroPart {
  kind: "line" | "group" | "station" | "flow";
  id: string;
}

/** The far side of a stub track: where it comes from (`in`) or goes to (`out`). */
export interface StubSpec {
  part: MetroPart;
  side: "in" | "out";
  /** "from Reddit", "to Call booked". */
  label: string;
}

/** [x from, x to, name] */
export type Zone = [number, number, string];

/** A free chip: a loop's cycle, a rewarm count, a stop word. `icon` null: none; omitted: repeat. */
export interface ChipSpec {
  x: number;
  y: number;
  t: string;
  icon?: IconName | null;
}

/** The dashed red frame of an interrupt: from any step inside, an event takes the person out. */
export interface FrameSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A group opened by hand: where its capsule was, and its name. */
export interface OpenedSpec {
  grp: string;
  t: string;
  cap: [number, number];
  y: number;
  l: LineKey;
  /** The top of its stations and their names: the fold tab sits above it. */
  top?: number;
}

/** The tab of an open group. Click it to fold the group back. */
export interface FoldSpec {
  x: number;
  y: number;
  t: string;
  grp: string;
}

export interface MetroScene {
  title?: string;
  /** The left edge of what shows and its width. A focused scene crops to its part. */
  x0?: number;
  w?: number;
  h: number;
  zones?: Zone[];
  st: SceneStation[];
  tr: MetroTrack[];
  /** Zoom reads these: the lines by key, the named groups. */
  lines?: Record<string, { n: string; l: LineKey }>;
  groups?: Record<string, string>;
  /** Line key to colour index (`--ui-line-N`). -1 is the outreach colour. The artifact's keys web, ob, gp, lm are 0 to 3. */
  colours?: Record<string, number>;
  /** Stations and tracks take focus and clicks. */
  click?: boolean;
  /** No dots move. */
  still?: boolean;
  /** Under the stations: chips, interrupt frames, fold tabs. */
  chips?: ChipSpec[];
  frames?: FrameSpec[];
  folds?: FoldSpec[];
  /** Groups the viewer opened by hand that this level folds: the capsule's outline stays, with a fold knob. */
  opened?: OpenedSpec[];
}

/** The artifact's four line keys, so its scenes draw unchanged. */
export const DEFAULT_COLOURS: Record<string, number> = { web: 0, ob: 1, gp: 2, lm: 3 };

/** The CSS colour of a line: outreach is ink 3, an offer is its line token. */
export function lineColour(scene: Pick<MetroScene, "colours">, l: LineKey): string {
  if (l === "out") return "var(--ui-line-out)";
  const i = scene.colours?.[l] ?? DEFAULT_COLOURS[l] ?? 0;
  return i < 0 ? "var(--ui-line-out)" : `var(--ui-line-${i})`;
}

/** Line weight in px. */
export const WEIGHT: Record<Weight, number> = { out: 3, front: 7, core: 12 };
