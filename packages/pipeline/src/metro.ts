/**
 * The metro model of the shape (designs/2026-10-20-design-language.md, area C1). Lines carry the
 * offers and the outreach, stations hold people, tracks move them. A body with `model: "metro"`
 * is this model; a body without `model` is the old graph in `model.ts`. Pure: the known triggers,
 * groups and lists come in as arguments, and nothing here imports the database.
 *
 * Ids are identities. A station id is the node id it came from, a track id is the edge id, an out
 * line id is the source id, an offer line id is the offer node id. Ids are unique within each kind
 * (lines, stations, tracks, groups, frames, flows), not across kinds: a line and a station may
 * share one. A flow is a scope of its own: its station and track ids are unique inside the flow
 * only, so a flow's station may share an id with a station of the body.
 *
 * `attach` and `flows` lower to nothing (`graphOf` reads neither): the runtime and the workflow do
 * not see them. `attach` holds refs, never content.
 */
import {
  ACTIONS,
  type Action,
  type Advance,
  checkEntry,
  cycleOf,
  DROPPED,
  EDGE_ID_MAX,
  IDLE_DAYS_MAX,
  NODE_ID_MAX,
  RESEARCH_LEVELS,
  type Research,
  type ShapeCheckContext,
  STAGE_KEY,
  type Via,
} from "./model.js";

/** The one hub station: every out line ends there, every front and core line starts there. */
export const HUB = "hub";

const TIERS = ["out", "front", "core"] as const;
type Tier = (typeof TIERS)[number];

/** Left to right on the map. A track never goes left. */
export const COLUMNS = ["marketing", "sales", "delivery", "money"] as const;
export type Column = (typeof COLUMNS)[number];

export const STATION_KINDS = [
  "att",
  "time",
  "cash",
  "exit",
  "hub",
  "condition",
  "race",
  "split",
  "join",
  "ab",
  "approval",
  "link",
] as const;
export type StationKind = (typeof STATION_KINDS)[number];

export const LOGIC_KINDS = [
  "condition",
  "race",
  "split",
  "join",
  "ab",
  "approval",
  "link",
] as const satisfies readonly StationKind[];
export type LogicKind = (typeof LOGIC_KINDS)[number];

/** A track with none of these is a plain track. */
export const TRACK_KINDS = ["exit", "xfer", "back"] as const;
type TrackKind = (typeof TRACK_KINDS)[number];

const TRACK_BYS = ["system", "person"] as const;
type TrackBy = (typeof TRACK_BYS)[number];

/** The most colour tokens a line takes: `--l0` to `--l7`. */
const COLOUR_MAX = 7;
/** The widest a retry cap goes. */
const RETRIES_MAX = 10;
/** The longest an owner may be, in characters. */
const OWNER_MAX = 40;
/** The most words a branch label (`cond`) may have. */
const COND_WORDS_MAX = 4;
/** A promise or a wait: a whole number and a unit, minutes, hours or days (`30m`, `4h`, `2d`). */
export const DURATION = /^\d+[mhd]$/;

/** What a part can hold a ref to. The ref names it by id, or by an `https://` URL. */
export const ATTACH_KINDS = ["sop", "link", "page", "funnel", "doc", "template", "note"] as const;
type AttachKind = (typeof ATTACH_KINDS)[number];
/** The longest a ref may be, in characters. */
export const ATTACH_REF_MAX = 500;
/** The longest an attach label may be, in characters. */
export const ATTACH_LABEL_MAX = 80;

/** A ref to something that belongs to a part: an id or an `https://` URL. No content is copied. */
export interface Attach {
  kind: AttachKind;
  ref: string;
  label?: string;
}

/** How a line finds people: today's source fields, with `group` now called `segment`. */
interface LineEntry {
  via: Via;
  channel?: string;
  campaign?: string;
  source?: string;
  segment?: string;
  parked?: true;
}

export interface MetroLine {
  id: string;
  label: string;
  tier: Tier;
  /** A registry offer id. Never on an out line. */
  offer?: string;
  /** A line token index, 0 to 7. Never on an out line, which draws grey. */
  colour?: number;
  /** Out lines only, and required there. */
  entry?: LineEntry;
  planned?: true;
  attach?: Attach[];
}

export interface MetroStation {
  id: string;
  label: string;
  kind: StationKind;
  /** Required, except on the hub (never) and on an exit (optional). */
  line?: string;
  column: Column;
  /** Att and time stations only. The kind must equal `kindOfAction(action)`. */
  action?: Action;
  advance?: Advance[];
  research?: Research;
  idleDays?: number;
  /** A deal opens here (today's offer node). Its offer is the line's offer. */
  deal?: true;
  /** Cash: the terms plan slug (today's plan node). */
  terms?: string;
  /** Cash: the offer it points at. None: the line's offer. */
  offer?: string;
  /** Exit: red. */
  failure?: true;
  /** Join: `all`, `any` or `<n> of <m>`. */
  rule?: string;
  /** Link: the shared flow id. */
  flow?: string;
  /** The retry chip: the cap, 1 to 10. */
  retries?: number;
  /**
   * The job, when stations do one job side by side (the same post on five platforms): a slug. The
   * map folds the stations of one template that sit in one column into one station, a mark each.
   * Lowers to nothing.
   */
  template?: string;
  /** The platform of a template station (`x`, `linkedin`): its mark in the fold. Needs a template. */
  platform?: string;
  planned?: true;
  attach?: Attach[];
}

export interface MetroTrack {
  id: string;
  from: string;
  to: string;
  /** The line it is drawn in. Required on a plain track. On a transfer, the line it joins. */
  line?: string;
  /** None: a plain track. A back track is today's loop: crossing it opens a new journey. */
  kind?: TrackKind;
  by: TrackBy;
  /** Person tracks only. */
  owner?: string;
  /** Person tracks only: a duration. */
  promise?: string;
  /** Tracks out of the hub only: the out lines whose people take it. None: all. */
  entries?: string[];
  /** A branch label, 4 words at most. */
  cond?: string;
  /** The else branch of a condition. */
  else?: true;
  /** Race: the clock branch, a duration. */
  wait?: string;
  /** An A/B arm, a whole percent. */
  weight?: number;
  /** A transfer (upsell, downsell, cross-sell) or a back track ("after 90 days"). */
  label?: string;
  planned?: true;
}

export interface MetroGroup {
  id: string;
  label: string;
  /** The line its stations sit on. A group that only holds groups may span lines and name none. */
  line?: string;
  /** Empty for a group that only holds groups. */
  stations: string[];
  /** The group it sits in: groups nest to any depth, and the map folds them level by level. */
  parent?: string;
  attach?: Attach[];
}

interface MetroFrame {
  id: string;
  label?: string;
  stations: string[];
  trigger: Advance;
  /** The exit station the frame sends people to. */
  exit: string;
}

export interface MetroBody {
  model: "metro";
  name: string;
  lines: MetroLine[];
  stations: MetroStation[];
  tracks: MetroTrack[];
  groups: MetroGroup[];
  frames: MetroFrame[];
  /** Shared flows: a `link` station opens one. None: the key is left out. */
  flows?: MetroFlow[];
}

/**
 * A flow shared by every part that links to it. It is a small map of its own: stations and tracks,
 * checked by the same rules as the body's, with no hub. Its ids are unique inside the flow. A flow
 * has no groups and no frames, and nothing in it is run.
 */
export interface MetroFlow {
  id: string;
  label: string;
  stations: MetroStation[];
  tracks: MetroTrack[];
}

/** Is this stored body on the metro model? A body without `model` is the old graph. */
export const isMetro = (body: unknown): body is MetroBody =>
  !!body && typeof body === "object" && (body as { model?: unknown }).model === "metro";

/** The station kind an action gives: call, book and held take time; the rest need attention. */
export const kindOfAction = (action: Action): "att" | "time" =>
  action === "call" || action === "book" || action === "held" ? "time" : "att";

const columnIndex = (c: string): number => Math.max(0, COLUMNS.indexOf(c as Column));

const isWhole = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

const wordsOf = (s: string): number => s.trim().split(/\s+/).length;

const JOIN_RULE = /^(?:all|any|([1-9][0-9]*) of ([1-9][0-9]*))$/;

/** Does each id in `ids` follow the id rule, stay within `max` characters and appear once? */
function checkIds(what: string, ids: readonly string[], max: number, errors: string[]): void {
  for (const [i, id] of ids.entries()) {
    if (typeof id !== "string" || !STAGE_KEY.test(id)) {
      errors.push(
        `${what} id "${id}" must be lowercase letters, digits and underscores, starting with a letter.`,
      );
    } else if (id.length > max) {
      errors.push(`${what} id "${id}" is longer than ${max} characters.`);
    }
    if (ids.indexOf(id) !== i) errors.push(`${what} id "${id}" is used twice.`);
  }
}

/** Items by id; when an id repeats, the first one wins (the repeat is reported as an error). */
function indexOf<T extends { id: string }>(xs: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of xs) if (!m.has(x.id)) m.set(x.id, x);
  return m;
}

/**
 * Check a metro body. Returns every reason it is wrong, in plain English. Empty means ok. The
 * triggers, groups and lists come from `ctx`, as `checkShape` takes them. A body that passes this
 * may still not run: `lowerable` (convert.ts) says why the runtime cannot take it yet.
 */
export function checkMetro(body: MetroBody, ctx: ShapeCheckContext): string[] {
  const errors: string[] = [];
  if (typeof body.name !== "string" || body.name.trim() === "") {
    errors.push("The shape needs a name.");
  }
  const { lines, stations, tracks, groups, frames } = body;
  const lineBy = indexOf(lines);
  const stationBy = indexOf(stations);

  checkIds(
    "Line",
    lines.map((l) => l.id),
    NODE_ID_MAX,
    errors,
  );
  checkIds(
    "Station",
    stations.map((s) => s.id),
    NODE_ID_MAX,
    errors,
  );
  checkIds(
    "Track",
    tracks.map((t) => t.id),
    EDGE_ID_MAX,
    errors,
  );
  checkIds(
    "Group",
    groups.map((g) => g.id),
    NODE_ID_MAX,
    errors,
  );
  checkIds(
    "Frame",
    frames.map((f) => f.id),
    NODE_ID_MAX,
    errors,
  );

  checkHub(stations, errors);
  for (const l of lines) checkLine(l, ctx, errors);
  checkStations(stations, lineBy, ctx, errors);
  checkTracks(tracks, stationBy, lineBy, errors);
  checkLogic(stations, tracks, errors);
  checkOrder(stations, tracks, stationBy, errors);
  checkGroups(groups, lineBy, stationBy, errors);
  checkFrames(frames, stationBy, ctx, errors);

  for (const l of lines) checkAttach(`Line "${l.id}"`, l.attach, errors);
  for (const s of stations) checkAttach(`Station "${s.id}"`, s.attach, errors);
  for (const g of groups) checkAttach(`Group "${g.id}"`, g.attach, errors);
  checkFlows(body, lineBy, ctx, errors);
  return errors;
}

/** Exactly one hub station, with the id `hub`, and no other station with that id. */
function checkHub(stations: readonly MetroStation[], errors: string[]): void {
  const hubs = stations.filter((s) => s.kind === "hub");
  if (hubs.length !== 1) {
    errors.push(`The shape needs exactly one hub station, not ${hubs.length}.`);
  }
  for (const s of hubs) {
    if (s.id !== HUB) errors.push(`The hub station must have the id "${HUB}", not "${s.id}".`);
  }
  checkReserved(stations, errors);
}

/** The ids no station but the hub may take, and the one no station may take. */
function checkReserved(stations: readonly MetroStation[], errors: string[]): void {
  for (const s of stations) {
    if (s.id === HUB && s.kind !== "hub") {
      errors.push(`Station id "${HUB}" is reserved for the hub station.`);
    }
    if (s.id === DROPPED) errors.push(`Station id "${s.id}" is reserved for dropped journeys.`);
  }
}

/** An attach ref: no spaces, and an `https://` URL when it has a scheme at all. */
const REF_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A template or platform name. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The attach list of one part (`who` names it): each item has a known kind, a ref of 1 to
 * `ATTACH_REF_MAX` characters with no spaces, and a label of `ATTACH_LABEL_MAX` characters at most.
 * A ref is an id or an `https://` URL: one that starts with another scheme is refused, and a link
 * is always a URL. Nothing else is checked: what the ref names is not read.
 */
function checkAttach(who: string, attach: readonly Attach[] | undefined, errors: string[]): void {
  if (attach === undefined) return;
  if (!Array.isArray(attach)) {
    errors.push(`${who} needs an attach list.`);
    return;
  }
  for (const [i, a] of attach.entries()) {
    const at = `${who} attach ${i + 1}`;
    if (!a || typeof a !== "object") {
      errors.push(`${at} needs a kind and a ref.`);
      continue;
    }
    if (!ATTACH_KINDS.includes(a.kind)) {
      errors.push(`${at} has kind "${a.kind}". Use ${ATTACH_KINDS.join(", ")}.`);
    }
    if (typeof a.ref !== "string" || a.ref.length === 0 || a.ref.length > ATTACH_REF_MAX) {
      errors.push(`${at} needs a ref of 1 to ${ATTACH_REF_MAX} characters.`);
    } else if (/\s/.test(a.ref)) {
      errors.push(`${at} has a ref with a space in it.`);
    } else if (REF_SCHEME.test(a.ref) && !a.ref.startsWith("https://")) {
      errors.push(`${at} has ref "${a.ref}". Use an id or an https:// URL.`);
    } else if (a.kind === "link" && !a.ref.startsWith("https://")) {
      errors.push(`${at} is a link, so its ref must be an https:// URL.`);
    }
    if (
      a.label !== undefined &&
      (typeof a.label !== "string" || a.label.length > ATTACH_LABEL_MAX)
    ) {
      errors.push(`${at} has a label longer than ${ATTACH_LABEL_MAX} characters.`);
    }
  }
}

/**
 * The shared flows of the body, and every link that names one. A flow is checked on its own by the
 * rules of the body: ids, stations, tracks, branches and order, with the lines of the body, no
 * hub, and its own ids. A station or track in a flow may have no line; one that names a line
 * must name a line of the body. Then each link station (in the body or in a flow) must name a flow
 * that exists, a flow must not link to itself, and the links between flows must not loop.
 */
function checkFlows(
  body: MetroBody,
  lineBy: ReadonlyMap<string, MetroLine>,
  ctx: ShapeCheckContext,
  errors: string[],
): void {
  const flows = body.flows ?? [];
  if (!Array.isArray(flows)) {
    errors.push("flows is a list of flows.");
    return;
  }
  checkIds(
    "Flow",
    flows.map((f) => f.id),
    NODE_ID_MAX,
    errors,
  );
  const flowBy = indexOf(flows);
  /** Flow to flow, once per link station inside a flow, for the loop check. */
  const links: Array<[string, string]> = [];

  for (const f of flows) {
    const inside: string[] = [];
    if (typeof f.label !== "string" || f.label.trim() === "") inside.push("It needs a label.");
    const { stations, tracks } = f;
    checkIds(
      "Station",
      stations.map((s) => s.id),
      NODE_ID_MAX,
      inside,
    );
    checkIds(
      "Track",
      tracks.map((t) => t.id),
      EDGE_ID_MAX,
      inside,
    );
    for (const s of stations) {
      if (s.kind === "hub") inside.push(`Station "${s.id}" is a hub. A flow holds no hub.`);
    }
    checkReserved(stations, inside);
    const stationBy = indexOf(stations);
    checkStations(stations, lineBy, ctx, inside, true);
    checkTracks(tracks, stationBy, lineBy, inside, true);
    checkLogic(stations, tracks, inside);
    checkOrder(stations, tracks, stationBy, inside);
    for (const s of stations) checkAttach(`Station "${s.id}"`, s.attach, inside);
    for (const s of stations) {
      if (s.kind !== "link" || typeof s.flow !== "string" || s.flow === "") continue;
      if (s.flow === f.id)
        inside.push(`Link "${s.id}" names this flow. A flow does not link to itself.`);
      else if (!flowBy.has(s.flow))
        inside.push(`Link "${s.id}" names flow "${s.flow}", which is not in the shape.`);
      else links.push([f.id, s.flow]);
    }
    for (const e of inside) errors.push(`Flow "${f.id}": ${e}`);
  }

  for (const s of body.stations) {
    if (s.kind !== "link" || typeof s.flow !== "string" || s.flow === "") continue;
    if (!flowBy.has(s.flow)) {
      errors.push(`Link "${s.id}" names flow "${s.flow}", which is not in the shape.`);
    }
  }
  const loop = cycleOf(
    flows.map((f) => f.id),
    links,
  );
  if (loop) errors.push(`Flows link in a loop: ${loop.join(" -> ")}.`);
}

function checkLine(l: MetroLine, ctx: ShapeCheckContext, errors: string[]): void {
  const k = l.id;
  if (typeof l.label !== "string" || l.label.trim() === "")
    errors.push(`Line "${k}" needs a label.`);
  if (!TIERS.includes(l.tier)) {
    errors.push(`Line "${k}" has tier "${l.tier}". Use ${TIERS.join(", ")}.`);
    return;
  }
  if (l.offer !== undefined && (typeof l.offer !== "string" || l.offer === "")) {
    errors.push(`Line "${k}" names no offer.`);
  }
  if (l.tier === "out") {
    if (l.offer !== undefined) errors.push(`Line "${k}" is an out line and cannot have an offer.`);
    if (l.colour !== undefined) errors.push(`Line "${k}" is an out line and cannot have a colour.`);
    if (!l.entry) {
      errors.push(`Line "${k}" is an out line and needs an entry.`);
      return;
    }
    const { via, source, segment } = l.entry;
    checkEntry(`Out line "${k}"`, { via, source, group: segment }, ctx, errors);
    return;
  }
  if (l.entry !== undefined)
    errors.push(`Line "${k}" is not an out line and cannot have an entry.`);
  if (l.colour !== undefined && !isWhole(l.colour, 0, COLOUR_MAX)) {
    errors.push(
      `Line "${k}" has colour ${JSON.stringify(l.colour)}. Use a whole number from 0 to ${COLOUR_MAX}.`,
    );
  }
}

function checkStations(
  stations: readonly MetroStation[],
  lineBy: ReadonlyMap<string, MetroLine>,
  ctx: ShapeCheckContext,
  errors: string[],
  inFlow = false,
): void {
  const dealsOn = new Map<string, string[]>();
  for (const s of stations) {
    const k = s.id;
    if (typeof s.label !== "string" || s.label.trim() === "") {
      errors.push(`Station "${k}" needs a label.`);
    }
    if (!STATION_KINDS.includes(s.kind)) {
      errors.push(`Station "${k}" has kind "${s.kind}". Use ${STATION_KINDS.join(", ")}.`);
    }
    if (!COLUMNS.includes(s.column)) {
      errors.push(`Station "${k}" has column "${s.column}". Use ${COLUMNS.join(", ")}.`);
    }

    // The line: none on the hub, optional on an exit, required on the rest. Optional in a flow:
    // a shared flow serves every line that links to it, so it belongs to none. A line given must exist.
    const line = s.line === undefined ? undefined : lineBy.get(s.line);
    if (s.kind === "hub") {
      if (s.line !== undefined) errors.push(`The hub station "${k}" has no line.`);
    } else if (s.line === undefined) {
      if (s.kind !== "exit" && !inFlow) errors.push(`Station "${k}" needs a line.`);
    } else if (!line) {
      errors.push(`Station "${k}" is on line "${s.line}", which does not exist.`);
    }

    if (s.action !== undefined) {
      if (!ACTIONS.includes(s.action)) {
        errors.push(`Station "${k}" has action "${s.action}". Use ${ACTIONS.join(", ")}.`);
      } else if (s.kind !== "att" && s.kind !== "time") {
        errors.push(
          `Station "${k}" is a ${s.kind} station. Only att and time stations take an action.`,
        );
      } else if (kindOfAction(s.action) !== s.kind) {
        errors.push(
          `Station "${k}" has action "${s.action}", which makes it a ${kindOfAction(s.action)} station, not ${s.kind}.`,
        );
      }
    }
    if (s.advance !== undefined) {
      if (!Array.isArray(s.advance)) errors.push(`Station "${k}" needs an advance list.`);
      else {
        for (const a of s.advance) {
          if (!ctx.triggers.has(a.trigger)) {
            errors.push(`Station "${k}" uses "${a.trigger}", which is not a known trigger.`);
          }
        }
      }
    }
    if (s.research !== undefined && !RESEARCH_LEVELS.includes(s.research)) {
      errors.push(`Station "${k}" has research "${s.research}". Use none, light or full.`);
    }
    if (s.idleDays !== undefined && !isWhole(s.idleDays, 1, IDLE_DAYS_MAX)) {
      errors.push(
        `Station "${k}" has idleDays ${JSON.stringify(s.idleDays)}. Use a whole number of days from 1 to ${IDLE_DAYS_MAX}.`,
      );
    }

    if (s.deal !== undefined) {
      if (s.kind === "cash") errors.push(`Station "${k}" is a cash station and cannot be a deal.`);
      else if (!line) errors.push(`Station "${k}" is a deal but is on no line with an offer.`);
      else if (!line.offer)
        errors.push(`Station "${k}" is a deal, but its line "${line.id}" has no offer.`);
      else dealsOn.set(line.id, [...(dealsOn.get(line.id) ?? []), k]);
    }
    if (s.terms !== undefined) {
      if (s.kind !== "cash") errors.push(`Station "${k}" has terms but is not a cash station.`);
      else if (typeof s.terms !== "string" || s.terms === "") {
        errors.push(`Station "${k}" names no terms plan.`);
      }
    }
    if (s.offer !== undefined && s.kind !== "cash") {
      errors.push(`Station "${k}" has an offer but is not a cash station.`);
    }
    if (s.failure !== undefined && s.kind !== "exit") {
      errors.push(`Station "${k}" is marked failure but is not an exit.`);
    }
    if (s.rule !== undefined && s.kind !== "join") {
      errors.push(`Station "${k}" has a rule but is not a join.`);
    }
    if (s.flow !== undefined && s.kind !== "link") {
      errors.push(`Station "${k}" names a flow but is not a link.`);
    }
    if (s.kind === "link" && (typeof s.flow !== "string" || s.flow === "")) {
      errors.push(`Link "${k}" names no flow.`);
    }
    if (s.retries !== undefined && !isWhole(s.retries, 1, RETRIES_MAX)) {
      errors.push(
        `Station "${k}" has retries ${JSON.stringify(s.retries)}. Use a whole number from 1 to ${RETRIES_MAX}.`,
      );
    }
    if (s.template !== undefined && !(typeof s.template === "string" && SLUG.test(s.template))) {
      errors.push(
        `Station "${k}" has template ${JSON.stringify(s.template)}. Use a slug: a-z, 0-9 and dashes, up to 40.`,
      );
    }
    if (s.platform !== undefined) {
      if (s.template === undefined) errors.push(`Station "${k}" has a platform but no template.`);
      else if (!(typeof s.platform === "string" && SLUG.test(s.platform)))
        errors.push(
          `Station "${k}" has platform ${JSON.stringify(s.platform)}. Use a slug: a-z, 0-9 and dashes, up to 40.`,
        );
    }
  }
  for (const [line, ids] of dealsOn) {
    if (ids.length > 1) {
      errors.push(`Line "${line}" has more than one deal station: ${ids.join(", ")}.`);
    }
  }
}

function checkTracks(
  tracks: readonly MetroTrack[],
  stationBy: ReadonlyMap<string, MetroStation>,
  lineBy: ReadonlyMap<string, MetroLine>,
  errors: string[],
  inFlow = false,
): void {
  const tierOf = (s: MetroStation | undefined): Tier | undefined =>
    s?.line === undefined ? undefined : lineBy.get(s.line)?.tier;
  for (const t of tracks) {
    const k = t.id;
    const from = stationBy.get(t.from);
    const to = stationBy.get(t.to);
    for (const [end, s] of [
      [t.from, from],
      [t.to, to],
    ] as const) {
      if (!s) errors.push(`Track "${k}" names station "${end}", which is not in the shape.`);
    }
    if (t.from === t.to) errors.push(`Track "${k}" starts and ends at "${t.from}".`);

    if (t.kind !== undefined && !TRACK_KINDS.includes(t.kind)) {
      errors.push(`Track "${k}" has kind "${t.kind}". Use ${TRACK_KINDS.join(", ")}, or none.`);
    }
    if (!TRACK_BYS.includes(t.by)) {
      errors.push(`Track "${k}" has by "${t.by}". Use ${TRACK_BYS.join(" or ")}.`);
    }
    if (t.by !== "person") {
      if (t.owner !== undefined)
        errors.push(`Track "${k}" has an owner but is moved by the system.`);
      if (t.promise !== undefined)
        errors.push(`Track "${k}" has a promise but is moved by the system.`);
    }
    if (t.owner !== undefined && (typeof t.owner !== "string" || t.owner.trim() === "")) {
      errors.push(`Track "${k}" has an empty owner.`);
    } else if (typeof t.owner === "string" && t.owner.length > OWNER_MAX) {
      errors.push(`Track "${k}" has an owner longer than ${OWNER_MAX} characters.`);
    }
    if (t.promise !== undefined && !DURATION.test(t.promise)) {
      errors.push(
        `Track "${k}" has promise "${t.promise}". Use a number and m, h or d, as 30m, 4h or 2d.`,
      );
    }

    const line = t.line === undefined ? undefined : lineBy.get(t.line);
    if (t.line !== undefined && !line) {
      errors.push(`Track "${k}" is on line "${t.line}", which does not exist.`);
    }
    if (t.kind === undefined && t.line === undefined && !inFlow) {
      errors.push(`Track "${k}" needs a line.`);
    }
    if (t.kind === "exit" && to && to.kind !== "exit") {
      errors.push(`Track "${k}" is an exit track, so it must end at an exit station.`);
    }
    if (t.kind === "xfer" && from && to) {
      if (from.line === undefined || to.line === undefined) {
        errors.push(`Transfer "${k}" must join two stations that are on lines.`);
      } else {
        if (from.line === to.line) {
          errors.push(`Transfer "${k}" must join stations on different lines.`);
        }
        if (t.line !== to.line) {
          errors.push(
            `Transfer "${k}" must be on the line of its end station "${to.id}" ("${to.line}").`,
          );
        }
      }
    }
    if (from?.kind === "exit") {
      errors.push(`Track "${k}" leaves exit "${from.id}". An exit ends the path.`);
    }

    // The hub: out lines end there, front and core lines start there.
    if (to?.kind === "hub" && tierOf(from) !== "out") {
      errors.push(`Track "${k}" enters the hub from "${t.from}", which is not on an out line.`);
    }
    if (from?.kind === "hub") {
      const tier = tierOf(to);
      if (tier !== "front" && tier !== "core") {
        errors.push(
          `Track "${k}" leaves the hub for "${t.to}", which is not on a front or core line.`,
        );
      }
    }
    if (
      from &&
      to &&
      tierOf(from) === "out" &&
      to.kind !== "hub" &&
      to.line !== undefined &&
      to.line !== from.line
    ) {
      errors.push(
        `Track "${k}" leaves out line "${from.line}" for another line. Go through the hub.`,
      );
    }
    if (t.entries !== undefined) {
      if (from?.kind !== "hub") {
        errors.push(`Track "${k}" has entries but does not leave the hub.`);
      } else if (!Array.isArray(t.entries) || t.entries.length === 0) {
        errors.push(`Track "${k}" has an empty entries list. Leave it out to take every out line.`);
      } else {
        for (const e of t.entries) {
          if (lineBy.get(e)?.tier !== "out") {
            errors.push(`Track "${k}" has entry "${e}", which is not an out line.`);
          }
        }
      }
    }
  }
}

/** The branch rules of the logic stations, and where `cond`, `else`, `wait` and `weight` may sit. */
function checkLogic(
  stations: readonly MetroStation[],
  tracks: readonly MetroTrack[],
  errors: string[],
): void {
  const out = new Map<string, MetroTrack[]>();
  const into = new Map<string, MetroTrack[]>();
  for (const t of tracks) {
    out.set(t.from, [...(out.get(t.from) ?? []), t]);
    into.set(t.to, [...(into.get(t.to) ?? []), t]);
  }
  const kindOf = new Map(stations.map((s) => [s.id, s.kind] as const));

  const needCond = (what: string, s: MetroStation, t: MetroTrack): void => {
    if (typeof t.cond !== "string" || t.cond.trim() === "" || wordsOf(t.cond) > COND_WORDS_MAX) {
      errors.push(
        `Branch "${t.id}" of ${what} "${s.id}" needs a cond of ${COND_WORDS_MAX} words or fewer.`,
      );
    }
  };

  for (const s of stations) {
    const outs = out.get(s.id) ?? [];
    if (s.kind === "condition") {
      if (outs.length < 2 || outs.length > 3) {
        errors.push(`Condition "${s.id}" needs 2 or 3 branches, not ${outs.length}.`);
      }
      if (outs.filter((t) => t.else !== undefined).length !== 1) {
        errors.push(`Condition "${s.id}" needs exactly one else branch.`);
      }
      for (const t of outs) if (t.else === undefined) needCond("condition", s, t);
    } else if (s.kind === "race") {
      if (outs.length < 2)
        errors.push(`Race "${s.id}" needs 2 or more branches, not ${outs.length}.`);
      if (outs.filter((t) => t.wait !== undefined).length !== 1) {
        errors.push(`Race "${s.id}" needs exactly one branch with a wait.`);
      }
      for (const t of outs) if (t.wait === undefined) needCond("race", s, t);
    } else if (s.kind === "split") {
      if (outs.length < 2)
        errors.push(`Split "${s.id}" needs 2 or more branches, not ${outs.length}.`);
    } else if (s.kind === "join") {
      const ins = into.get(s.id) ?? [];
      if (ins.length < 2) {
        errors.push(`Join "${s.id}" needs 2 or more tracks into it, not ${ins.length}.`);
      }
      const m = typeof s.rule === "string" ? JOIN_RULE.exec(s.rule) : null;
      if (!m) {
        errors.push(`Join "${s.id}" needs a rule: all, any, or "<n> of <m>" as "2 of 3".`);
      } else if (m[1] !== undefined) {
        const n = Number(m[1]);
        const of = Number(m[2]);
        if (of !== ins.length || n < 1 || n > of) {
          errors.push(
            `Join "${s.id}" has rule "${s.rule}". It needs m to equal its ${ins.length} tracks in, and n from 1 to m.`,
          );
        }
      }
    } else if (s.kind === "ab") {
      if (outs.length < 2) errors.push(`A/B "${s.id}" needs 2 or more arms, not ${outs.length}.`);
      for (const t of outs) {
        if (!isWhole(t.weight, 1, 99)) {
          errors.push(
            `Arm "${t.id}" of A/B "${s.id}" needs a weight, a whole percent from 1 to 99.`,
          );
        }
      }
      const total = outs.reduce((n, t) => n + (typeof t.weight === "number" ? t.weight : 0), 0);
      if (outs.length > 0 && total !== 100) {
        errors.push(`The arms of A/B "${s.id}" add up to ${total}. They must add up to 100.`);
      }
    }
  }

  for (const t of tracks) {
    const kind = kindOf.get(t.from);
    if (t.cond !== undefined && kind !== "condition" && kind !== "race") {
      errors.push(`Track "${t.id}" has a cond, but "${t.from}" is not a condition or a race.`);
    }
    if (t.else !== undefined && kind !== "condition") {
      errors.push(`Track "${t.id}" is an else branch, but "${t.from}" is not a condition.`);
    }
    if (t.wait !== undefined) {
      if (kind !== "race")
        errors.push(`Track "${t.id}" has a wait, but "${t.from}" is not a race.`);
      else if (!DURATION.test(t.wait)) {
        errors.push(
          `Track "${t.id}" has wait "${t.wait}". Use a number and m, h or d, as 30m, 4h or 2d.`,
        );
      }
    }
    if (t.weight !== undefined && kind !== "ab") {
      errors.push(`Track "${t.id}" has a weight, but "${t.from}" is not an A/B.`);
    }
  }
}

/** Plain and xfer tracks: no loop, and never leftwards across the columns. */
function checkOrder(
  stations: readonly MetroStation[],
  tracks: readonly MetroTrack[],
  stationBy: ReadonlyMap<string, MetroStation>,
  errors: string[],
): void {
  const forward = tracks.filter((t) => {
    if (t.kind !== undefined && t.kind !== "xfer") return false;
    return stationBy.has(t.from) && stationBy.has(t.to) && t.from !== t.to;
  });
  const cycle = cycleOf(
    stations.map((s) => s.id),
    forward.map((t) => [t.from, t.to]),
  );
  if (cycle) {
    errors.push(`Tracks form a loop: ${cycle.join(" -> ")}. Make one of them a back track.`);
  }
  for (const t of forward) {
    const from = stationBy.get(t.from);
    const to = stationBy.get(t.to);
    if (!from || !to || !COLUMNS.includes(from.column) || !COLUMNS.includes(to.column)) continue;
    if (columnIndex(to.column) < columnIndex(from.column)) {
      errors.push(
        `Track "${t.id}" goes from ${from.column} to ${to.column}. A track never goes left.`,
      );
    }
  }
}

function checkGroups(
  groups: readonly MetroGroup[],
  lineBy: ReadonlyMap<string, MetroLine>,
  stationBy: ReadonlyMap<string, MetroStation>,
  errors: string[],
): void {
  const taken = new Map<string, string>();
  const groupBy = new Map(groups.map((g) => [g.id, g]));
  const parents = new Set(groups.map((g) => g.parent));
  for (const g of groups) {
    const k = g.id;
    if (typeof g.label !== "string" || g.label.trim() === "")
      errors.push(`Group "${k}" needs a label.`);
    if (g.parent !== undefined) {
      if (!groupBy.has(g.parent))
        errors.push(`Group "${k}" sits in group "${g.parent}", which does not exist.`);
      // Walk up: a group that reaches itself is in a loop.
      const seen = new Set([k]);
      for (let up = groupBy.get(g.parent); up; up = groupBy.get(up.parent ?? "")) {
        if (seen.has(up.id)) {
          errors.push(`Group "${k}" sits inside itself through "${g.parent}".`);
          break;
        }
        seen.add(up.id);
      }
    }
    const empty = !Array.isArray(g.stations) || g.stations.length === 0;
    // The hub joins every line, so it puts no line on its group.
    const lined = !empty && g.stations.some((id) => stationBy.get(id)?.kind !== "hub");
    // A group that only holds groups, or the hub, needs no line.
    if (!lined && (parents.has(k) || !empty)) {
      for (const id of g.stations) {
        if (!stationBy.has(id))
          errors.push(`Group "${k}" names station "${id}", which is not in the shape.`);
        const other = taken.get(id);
        if (other !== undefined && other !== k)
          errors.push(`Station "${id}" is in two groups: "${other}" and "${k}".`);
        else taken.set(id, k);
      }
      if (g.line !== undefined && !lineBy.has(g.line))
        errors.push(`Group "${k}" is on line "${g.line}", which does not exist.`);
      continue;
    }
    if (g.line === undefined || !lineBy.has(g.line))
      errors.push(`Group "${k}" is on line "${g.line}", which does not exist.`);
    if (empty) {
      errors.push(`Group "${k}" needs at least one station or a group inside it.`);
      continue;
    }
    for (const id of g.stations) {
      const s = stationBy.get(id);
      if (!s) errors.push(`Group "${k}" names station "${id}", which is not in the shape.`);
      else if (s.kind === "exit") {
        errors.push(`Group "${k}" holds exit "${id}". An exit folds with its source.`);
      } else if (s.kind !== "hub" && s.line !== g.line) {
        errors.push(`Group "${k}" holds station "${id}", which is not on line "${g.line}".`);
      }
      const other = taken.get(id);
      if (other !== undefined && other !== k) {
        errors.push(`Station "${id}" is in two groups: "${other}" and "${k}".`);
      } else taken.set(id, k);
    }
  }
}

function checkFrames(
  frames: readonly MetroFrame[],
  stationBy: ReadonlyMap<string, MetroStation>,
  ctx: ShapeCheckContext,
  errors: string[],
): void {
  for (const f of frames) {
    const k = f.id;
    if (!Array.isArray(f.stations) || f.stations.length === 0) {
      errors.push(`Frame "${k}" needs at least one station.`);
    } else {
      for (const id of f.stations) {
        if (!stationBy.has(id))
          errors.push(`Frame "${k}" names station "${id}", which is not in the shape.`);
      }
    }
    if (!f.trigger || !ctx.triggers.has(f.trigger.trigger)) {
      errors.push(`Frame "${k}" uses "${f.trigger?.trigger}", which is not a known trigger.`);
    }
    if (stationBy.get(f.exit)?.kind !== "exit") {
      errors.push(`Frame "${k}" sends people to "${f.exit}", which is not an exit station.`);
    }
  }
}

/**
 * Each station's place, left to right: the successor of `depthOf`. Stations go in column order,
 * then by their tracks. A station's place is the larger of one more than the largest place of the
 * stations its plain and transfer tracks come from, and one more than the largest place in every
 * earlier column; a station with neither is 0. Pure, and safe on a body that has not been checked:
 * an unknown id is skipped, a loop does not run for ever, and a track that runs left is ignored.
 */
export function placesOf(body: MetroBody): Record<string, number> {
  const columnOf = new Map(body.stations.map((s) => [s.id, columnIndex(s.column)] as const));
  const into = new Map<string, string[]>();
  for (const t of body.tracks) {
    if (t.kind !== undefined && t.kind !== "xfer") continue;
    if (t.from === t.to || !columnOf.has(t.from) || !columnOf.has(t.to)) continue;
    into.set(t.to, [...(into.get(t.to) ?? []), t.from]);
  }
  const place: Record<string, number> = {};
  const open = new Set<string>();
  let floor = 0;
  for (let c = 0; c < COLUMNS.length; c++) {
    const here = body.stations.filter((s) => columnIndex(s.column) === c);
    const visit = (id: string): number => {
      const known = place[id];
      if (known !== undefined) return known;
      if (open.has(id)) return 0;
      open.add(id);
      let p = floor;
      for (const from of into.get(id) ?? []) {
        if ((columnOf.get(from) ?? 0) > c) continue;
        p = Math.max(p, visit(from) + 1);
      }
      open.delete(id);
      place[id] = p;
      return p;
    };
    for (const s of here) visit(s.id);
    if (here.length > 0) floor = Math.max(...here.map((s) => place[s.id] ?? 0)) + 1;
  }
  return place;
}
