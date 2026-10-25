/**
 * Typed edit ops for a metro body (designs/2026-10-20-design-language.md, proposal G). The CLI,
 * an agent and the Map chat all write the same ops into a draft. An op names ids. `applyOp` and
 * `applyOps` are pure: they never change their input, and they never read the database.
 *
 * A batch is all or nothing. It is refused only when an op is wrong or when the body it makes is
 * not a metro body in structure (`parseMetroBody`). `checkMetro` and `lowerable` are not refusals
 * here: `editMetro` gives them back as warnings, because a draft may be half done.
 *
 * Ops act on lines, stations, tracks and groups, the shape name and attach lists. Frames and
 * flows have no ops yet. A body keeps them as they are.
 */
import { z } from "zod";
import { lowerable } from "./convert.js";
import {
  type Attach,
  COLUMNS,
  type Column,
  checkMetro,
  HUB,
  type MetroBody,
  type MetroGroup,
  type MetroLine,
  type MetroStation,
  type MetroTrack,
} from "./metro.js";
import {
  diffMetro,
  METRO_LISTS,
  metroChangeLine,
  metroChangesOf,
  metroNameOf,
} from "./metro-diff.js";
import { withoutStation } from "./metro-edit.js";
import { parseMetroBody } from "./metro-file.js";
import { DROPPED, type ShapeCheckContext } from "./model.js";
import { Refused } from "./refused.js";
import { metroView, type StoredBody } from "./stored.js";

/** The kinds of thing an op acts on. */
const OP_ONS = ["line", "station", "track", "group"] as const;
type OpOn = (typeof OP_ONS)[number];

export type MetroOp =
  | { op: "add"; on: "line"; item: MetroLine }
  | { op: "add"; on: "station"; item: MetroStation }
  | { op: "add"; on: "track"; item: MetroTrack }
  | { op: "add"; on: "group"; item: MetroGroup }
  | { op: "rename"; on: "line" | "station" | "group"; id: string; label: string }
  | { op: "rename"; on: "shape"; name: string }
  | { op: "move"; on: "station"; id: string; line?: string; column?: Column; group?: string | null }
  | { op: "move"; on: "track"; id: string; from?: string; to?: string }
  | { op: "move"; on: "group"; id: string; line: string }
  | { op: "move"; on: "line"; id: string; before: string | null }
  | { op: "remove"; on: OpOn; id: string }
  | { op: "set"; on: OpOn; id: string; field: string; value: unknown }
  | { op: "attach"; on: "line" | "station" | "group"; id: string; ref: Attach }
  | { op: "detach"; on: "line" | "station" | "group"; id: string; ref: string };

const OP_KINDS = ["add", "rename", "move", "remove", "set", "attach", "detach"] as const;

// --- The envelope -------------------------------------------------------------------------------

const idOf = z.string().min(1).describe("The id of the item.");
const onOf = z.enum(OP_ONS).describe("What the op acts on: line, station, track or group.");
const attachOn = z
  .enum(["line", "station", "group"])
  .describe("The part that holds the attach list.");

const addOp = z
  .strictObject({
    op: z.literal("add"),
    on: onOf,
    item: z
      .record(z.string(), z.unknown())
      .describe("The whole new item, with its id. It goes at the end of its list."),
  })
  .describe("Add a new line, station, track or group.");

const renameOp = z
  .strictObject({
    op: z.literal("rename"),
    on: z
      .enum(["line", "station", "group", "shape"])
      .describe("What to rename: line, station, group or shape."),
    id: idOf.optional().describe("The id of the item. Not used on the shape."),
    label: z.string().optional().describe("The new label, 1 to 80 characters."),
    name: z.string().optional().describe("The new name of the shape, 1 to 80 characters."),
  })
  .superRefine((v, ctx) => {
    const fault = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.on === "shape") {
      if (v.name === undefined) fault("name", "A shape rename needs a name.");
      if (v.id !== undefined) fault("id", "A shape rename does not take an id.");
      if (v.label !== undefined) fault("label", "A shape rename takes name, not label.");
      return;
    }
    if (v.id === undefined) fault("id", `A ${v.on} rename needs an id.`);
    if (v.label === undefined) fault("label", `A ${v.on} rename needs a label.`);
    if (v.name !== undefined) fault("name", `A ${v.on} rename takes label, not name.`);
  })
  .describe("Change the label of a line, station or group, or the name of the shape.");

const MOVE_FIELDS = {
  station: ["line", "column", "group"],
  track: ["from", "to"],
  group: ["line"],
  line: ["before"],
} as const;

const moveOp = z
  .strictObject({
    op: z.literal("move"),
    on: z.enum(["station", "track", "group", "line"]).describe("What to move."),
    id: idOf,
    line: z
      .string()
      .optional()
      .describe("Station or group: the line it moves to. Not used on a line."),
    column: z.enum(COLUMNS).optional().describe("Station: the column it moves to."),
    group: z
      .string()
      .nullable()
      .optional()
      .describe("Station: the group it joins. null: it leaves its group."),
    from: z.string().optional().describe("Track: the station it starts at."),
    to: z.string().optional().describe("Track: the station it ends at."),
    before: z
      .string()
      .nullable()
      .optional()
      .describe("Line: the line it goes before. null: it goes last."),
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = MOVE_FIELDS[v.on];
    for (const k of ["line", "column", "group", "from", "to", "before"] as const) {
      if (v[k] !== undefined && !allowed.includes(k)) {
        ctx.addIssue({ code: "custom", path: [k], message: `A ${v.on} move does not take ${k}.` });
      }
    }
    if (v.on === "line" && v.before === undefined) {
      ctx.addIssue({ code: "custom", path: ["before"], message: "A line move needs before." });
    }
    if (v.on === "group" && v.line === undefined) {
      ctx.addIssue({ code: "custom", path: ["line"], message: "A group move needs a line." });
    }
  })
  .describe(
    "Move where a thing sits: a station's line, column or group; a track's ends; a group's line; a line's place in the stack.",
  );

const removeOp = z
  .strictObject({ op: z.literal("remove"), on: onOf, id: idOf })
  .describe("Remove a line, station, track or group.");

const setOp = z
  .strictObject({
    op: z.literal("set"),
    on: onOf,
    id: idOf,
    field: z.string().min(1).describe("The field to set, such as idleDays."),
    value: z.unknown().describe("The new value. null removes the field."),
  })
  .superRefine((v, ctx) => {
    if (!("value" in v)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "A set needs a value. null removes the field.",
      });
    }
  })
  .describe("Set one field of one item. Not for id, label, attach, or a field that move changes.");

const attachOp = z
  .strictObject({
    op: z.literal("attach"),
    on: attachOn,
    id: idOf,
    ref: z
      .record(z.string(), z.unknown())
      .describe("The attach: kind, ref and an optional label. The ref is an id or an https URL."),
  })
  .describe("Attach a ref to a line, station or group.");

const detachOp = z
  .strictObject({
    op: z.literal("detach"),
    on: attachOn,
    id: idOf,
    ref: z.string().min(1).describe("The ref to remove."),
  })
  .describe("Remove an attach from a line, station or group, by its ref.");

/** One op, as a client writes it. `item`, `value` and `ref` are typed by the body check. */
export const MetroOpSchema = z.discriminatedUnion("op", [
  addOp,
  renameOp,
  moveOp,
  removeOp,
  setOp,
  attachOp,
  detachOp,
]);

/** The JSON schema of the ops a client may send: a map with an `ops` list. For a model's tool. */
export function opsJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(
    z.strictObject({
      ops: z.array(MetroOpSchema).min(1).describe("The edits to make, in order."),
    }),
  ) as Record<string, unknown>;
}

/** One op, or a list of ops, from outside. Refused with every reason, each led by `Op <n>: `. */
export function parseOps(v: unknown): MetroOp[] {
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0) throw new Refused(["Send at least one op."]);
  const errors: string[] = [];
  const ops: MetroOp[] = [];
  for (const [i, raw] of list.entries()) {
    const at = `Op ${i + 1}: `;
    const kind = (raw as { op?: unknown } | null)?.op;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${at}needs a map with op and on.`);
    } else if (!(OP_KINDS as readonly unknown[]).includes(kind)) {
      errors.push(`${at}op must be one of ${OP_KINDS.join(", ")}.`);
    } else {
      const r = MetroOpSchema.safeParse(raw);
      if (r.success) ops.push(r.data as unknown as MetroOp);
      else {
        for (const issue of r.error.issues) {
          const path = issue.path.join(".");
          errors.push(`${at}${path ? `${path}: ` : ""}${issue.message}`);
        }
      }
    }
  }
  if (errors.length > 0) throw new Refused(errors);
  return ops;
}

// --- Applying ops -------------------------------------------------------------------------------

type Row = { id: string; label?: string };
type Op<K extends MetroOp["op"]> = Extract<MetroOp, { op: K }>;

const rowsOf = (body: MetroBody, on: OpOn): Row[] => body[METRO_LISTS[on]];

const withRows = (body: MetroBody, on: OpOn, next: readonly unknown[]): MetroBody =>
  ({ ...body, [METRO_LISTS[on]]: next }) as MetroBody;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const refuse = (...reasons: string[]): never => {
  throw new Refused(reasons);
};

const noItem = (on: OpOn, id: string): string => `There is no ${on} "${id}".`;

/** The item `id` of kind `on`; refused when there is none. */
function find(body: MetroBody, on: OpOn, id: string): Row {
  return rowsOf(body, on).find((r) => r.id === id) ?? refuse(noItem(on, id));
}

/** The body with item `id` of kind `on` replaced by `f` of it. */
function update(body: MetroBody, on: OpOn, id: string, f: (r: Row) => Row): MetroBody {
  find(body, on, id);
  return withRows(
    body,
    on,
    rowsOf(body, on).map((r) => (r.id === id ? f(r) : r)),
  );
}

/** A label or a name: 1 to 80 characters after trim. Returns the trimmed text. */
function textOf(what: string, v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length < 1 || t.length > 80) refuse(`The ${what} needs 1 to 80 characters.`);
  return t;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function add(body: MetroBody, op: Op<"add">): MetroBody {
  const item: unknown = op.item;
  const id = isObject(item) ? item.id : undefined;
  if (typeof id !== "string" || id === "") return refuse(`The new ${op.on} needs an id.`);
  if (op.on === "station" && id === HUB)
    refuse(`Station id "${HUB}" is reserved for the hub station.`);
  if (op.on === "station" && id === DROPPED)
    refuse(`Station id "${id}" is reserved for dropped journeys.`);
  if (rowsOf(body, op.on).some((r) => r.id === id)) refuse(`There is already a ${op.on} "${id}".`);
  return withRows(body, op.on, [...rowsOf(body, op.on), structuredClone(item)]);
}

function rename(body: MetroBody, op: Op<"rename">): MetroBody {
  if (op.on === "shape") return { ...body, name: textOf("name", op.name) };
  const label = textOf("label", op.label);
  return update(body, op.on, op.id, (r) => ({ ...r, label }));
}

function moveStation(body: MetroBody, op: Op<"move"> & { on: "station" }): MetroBody {
  const s = find(body, "station", op.id) as MetroStation;
  if (s.id === HUB || s.kind === "hub") refuse("The hub does not move.");
  if (op.line === undefined && op.column === undefined && op.group === undefined)
    refuse(`Move station "${op.id}" needs line, column or group.`);
  const errors: string[] = [];
  if (op.line !== undefined && !body.lines.some((l) => l.id === op.line))
    errors.push(noItem("line", op.line));
  if (op.column !== undefined && !(COLUMNS as readonly string[]).includes(op.column))
    errors.push(`Column "${op.column}" must be one of ${COLUMNS.join(", ")}.`);
  if (typeof op.group === "string" && !body.groups.some((g) => g.id === op.group))
    errors.push(noItem("group", op.group));
  if (errors.length > 0) throw new Refused(errors);

  const moved: MetroStation = {
    ...s,
    ...(op.line !== undefined ? { line: op.line } : {}),
    ...(op.column !== undefined ? { column: op.column } : {}),
  };
  const stations = body.stations.map((x) => (x.id === op.id ? moved : x));
  if (op.group === undefined) return { ...body, stations };
  const groups = body.groups.map((g) => {
    if (g.id === op.group)
      return g.stations.includes(op.id) ? g : { ...g, stations: [...g.stations, op.id] };
    return g.stations.includes(op.id)
      ? { ...g, stations: g.stations.filter((x) => x !== op.id) }
      : g;
  });
  return { ...body, stations, groups };
}

function moveTrack(body: MetroBody, op: Op<"move"> & { on: "track" }): MetroBody {
  find(body, "track", op.id);
  if (op.from === undefined && op.to === undefined)
    refuse(`Move track "${op.id}" needs from or to.`);
  const errors = [op.from, op.to].flatMap((s) =>
    s !== undefined && !body.stations.some((x) => x.id === s) ? [noItem("station", s)] : [],
  );
  if (errors.length > 0) throw new Refused(errors);
  return update(body, "track", op.id, (t) => ({
    ...t,
    ...(op.from !== undefined ? { from: op.from } : {}),
    ...(op.to !== undefined ? { to: op.to } : {}),
  }));
}

function moveLine(body: MetroBody, op: Op<"move"> & { on: "line" }): MetroBody {
  const line = find(body, "line", op.id) as MetroLine;
  const rest = body.lines.filter((l) => l.id !== op.id);
  if (op.before === null) return { ...body, lines: [...rest, line] };
  if (op.before === op.id) return refuse(`Line "${op.id}" cannot go before itself.`);
  const at = rest.findIndex((l) => l.id === op.before);
  if (at < 0) return refuse(noItem("line", op.before));
  return { ...body, lines: [...rest.slice(0, at), line, ...rest.slice(at)] };
}

function move(body: MetroBody, op: Op<"move">): MetroBody {
  switch (op.on) {
    case "station":
      return moveStation(body, op);
    case "track":
      return moveTrack(body, op);
    case "line":
      return moveLine(body, op);
    case "group":
      find(body, "group", op.id);
      if (!body.lines.some((l) => l.id === op.line)) return refuse(noItem("line", op.line));
      return update(body, "group", op.id, (g) => ({ ...g, line: op.line }));
  }
}

/** Why a line cannot go: what it still holds, one reason each. Empty: it holds nothing. */
function holdsOf(body: MetroBody, id: string, who: string): string[] {
  const names = [body];
  const holds = [
    ...body.stations.filter((s) => s.line === id).map((s) => `station ${s.label}`),
    ...body.tracks
      .filter((t) => t.line === id)
      .map((t) => `track ${metroNameOf(names, "track", t.id)}`),
    ...body.tracks
      .filter((t) => t.entries?.includes(id))
      .map((t) => `track ${metroNameOf(names, "track", t.id)}, which names it in entries`),
    ...body.groups.filter((g) => g.line === id).map((g) => `group ${g.label}`),
    ...(body.flows ?? []).flatMap((f) => [
      ...f.stations
        .filter((s) => s.line === id)
        .map((s) => `station ${s.label} of flow ${f.label}`),
      ...f.tracks.filter((t) => t.line === id).map((t) => `track ${t.id} of flow ${f.label}`),
    ]),
  ];
  return holds.map((h) => `${who} still holds ${h}.`);
}

function remove(body: MetroBody, op: Op<"remove">): MetroBody {
  const item = find(body, op.on, op.id);
  if (op.on === "station") {
    if (op.id === HUB || (item as MetroStation).kind === "hub")
      refuse("The hub cannot be removed.");
    return withoutStation(body, op.id);
  }
  if (op.on === "line") {
    const holds = holdsOf(body, op.id, `Line ${item.label}`);
    if (holds.length > 0) throw new Refused(holds);
  }
  return withRows(
    body,
    op.on,
    rowsOf(body, op.on).filter((r) => r.id !== op.id),
  );
}

/** The fields each kind keeps for another op. Everything else is open to `set`. */
const OWN_OP: Record<OpOn, Record<string, string>> = {
  line: { label: "rename", attach: "attach and detach" },
  station: { label: "rename", attach: "attach and detach", line: "move", column: "move" },
  track: { from: "move", to: "move" },
  group: { label: "rename", attach: "attach and detach", line: "move", stations: "move" },
};

function set(body: MetroBody, op: Op<"set">): MetroBody {
  find(body, op.on, op.id);
  if (op.field === "id") return refuse("The id cannot be set.");
  const own = OWN_OP[op.on][op.field];
  if (own) return refuse(`Field "${op.field}" of a ${op.on} has its own op: ${own}.`);
  return update(body, op.on, op.id, (r) => {
    const { [op.field]: _, ...rest } = r as Record<string, unknown>;
    return (op.value == null ? rest : { ...rest, [op.field]: structuredClone(op.value) }) as Row;
  });
}

type Holder = { attach?: Attach[] };

function attach(body: MetroBody, op: Op<"attach">): MetroBody {
  const ref: unknown = op.ref;
  if (!isObject(ref) || typeof ref.kind !== "string" || typeof ref.ref !== "string")
    return refuse("The attach needs a kind and a ref.");
  const item = find(body, op.on, op.id) as Row & Holder;
  if (item.attach?.some((a) => a.kind === ref.kind && a.ref === ref.ref))
    return refuse(`${cap(op.on)} ${item.label} already has attach ${ref.kind} "${ref.ref}".`);
  return update(body, op.on, op.id, (r) => ({
    ...r,
    attach: [...((r as Holder).attach ?? []), structuredClone(op.ref)],
  }));
}

function detach(body: MetroBody, op: Op<"detach">): MetroBody {
  const item = find(body, op.on, op.id) as Row & Holder;
  if (!item.attach?.some((a) => a.ref === op.ref))
    return refuse(`${cap(op.on)} ${item.label} has no attach with ref "${op.ref}".`);
  return update(body, op.on, op.id, (r) => {
    const { attach: held, ...rest } = r as Row & Holder;
    const left = (held ?? []).filter((a) => a.ref !== op.ref);
    return (left.length > 0 ? { ...rest, attach: left } : rest) as Row;
  });
}

/** One op, without the check of the whole body. */
function step(body: MetroBody, op: MetroOp): MetroBody {
  switch (op.op) {
    case "add":
      return add(body, op);
    case "rename":
      return rename(body, op);
    case "move":
      return move(body, op);
    case "remove":
      return remove(body, op);
    case "set":
      return set(body, op);
    case "attach":
      return attach(body, op);
    case "detach":
      return detach(body, op);
  }
}

/** Refuse a body that is not a metro body in structure. The reasons come from the parser. */
const mustParse = (body: MetroBody): MetroBody => {
  parseMetroBody(body);
  return body;
};

/** The body after one op. Pure. Refused with every reason when the op or the result is wrong. */
export function applyOp(body: MetroBody, op: MetroOp): MetroBody {
  return mustParse(step(body, op));
}

/**
 * The body after the ops, in order. Pure and all or nothing. Every reason found starts with
 * `Op <n>: `. The body is checked in structure at the end, not op by op: a join station may come
 * before its tracks.
 */
export function applyOps(body: MetroBody, ops: readonly MetroOp[]): MetroBody {
  let now = body;
  const errors: string[] = [];
  for (const [i, op] of ops.entries()) {
    try {
      now = step(now, op);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      errors.push(...e.errors.map((r) => `Op ${i + 1}: ${r}`));
    }
  }
  if (errors.length > 0) throw new Refused(errors);
  return mustParse(now);
}

/**
 * Edit a stored body with ops from outside (one op or a list). The body is drawn with `metroView`
 * first, so a graph comes back as a metro body. `lines` say what changed, as the diff says it;
 * `warnings` are what `checkMetro` (when `ctx` is given) and `lowerable` find in the result.
 * Refused when an op is wrong or the result is not a metro body in structure.
 */
export function editMetro(
  body: StoredBody,
  ops: unknown,
  ctx?: ShapeCheckContext,
): { body: MetroBody; lines: string[]; warnings: string[] } {
  const before = metroView(body);
  const result = applyOps(before, parseOps(ops));
  const lines = metroChangesOf(diffMetro(before, result)).map((c) =>
    metroChangeLine(before, result, c),
  );
  const warnings = [...new Set([...(ctx ? checkMetro(result, ctx) : []), ...lowerable(result)])];
  return { body: result, lines, warnings };
}
