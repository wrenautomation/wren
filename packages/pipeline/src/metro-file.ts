/**
 * The metro body as a YAML file (designs/2026-10-20-design-language.md, area C1): the twin of
 * `exportShape` and `parseShape`. `exportMetro` writes a body; `parseMetroBody` reads the parsed
 * YAML value back. It checks the structure only (the type of each field): what the values mean is
 * `checkMetro`'s job. Pure: it reads no database and no file.
 */
import { stringify } from "yaml";
import type { MetroBody } from "./metro.js";
import { Refused } from "./refused.js";

/** Keys a reader wants first, in this order. Others follow in the order they were set. */
export const FIRST = ["id", "kind", "name", "from", "to", "label"];

/** The same keys, the wanted ones first. */
export const ordered = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(o).sort(([a], [b]) => {
      const x = FIRST.indexOf(a);
      const y = FIRST.indexOf(b);
      return (x < 0 ? FIRST.length : x) - (y < 0 ? FIRST.length : y);
    }),
  );

/** A metro body as YAML text: model, name, lines, stations, tracks, groups, frames. */
export function exportMetro(body: MetroBody): string {
  const list = (xs: readonly object[]) => xs.map((x) => ordered({ ...x }));
  return stringify({
    model: "metro",
    name: body.name,
    lines: list(body.lines),
    stations: list(body.stations),
    tracks: list(body.tracks),
    groups: list(body.groups),
    frames: list(body.frames),
  });
}

// --- Reading ------------------------------------------------------------------------------------

/** A field is one of these types. A trailing `!` means it is required. */
type Type = "text" | "number" | "true" | "texts" | "map" | "trigger" | "triggers" | "entry";
type Schema = Record<string, Type | `${Type}!`>;

const TRIGGER: Schema = { trigger: "text!", with: "map" };
const ENTRY: Schema = {
  via: "text!",
  channel: "text",
  campaign: "text",
  source: "text",
  segment: "text",
  parked: "true",
};
const LINE: Schema = {
  id: "text!",
  label: "text!",
  tier: "text!",
  offer: "text",
  colour: "number",
  entry: "entry",
  planned: "true",
};
const STATION: Schema = {
  id: "text!",
  label: "text!",
  kind: "text!",
  line: "text",
  column: "text!",
  action: "text",
  advance: "triggers",
  research: "text",
  idleDays: "number",
  deal: "true",
  terms: "text",
  offer: "text",
  failure: "true",
  rule: "text",
  flow: "text",
  retries: "number",
  planned: "true",
};
const TRACK: Schema = {
  id: "text!",
  from: "text!",
  to: "text!",
  line: "text",
  kind: "text",
  by: "text!",
  owner: "text",
  promise: "text",
  entries: "texts",
  cond: "text",
  else: "true",
  wait: "text",
  weight: "number",
  label: "text",
  planned: "true",
};
const GROUP: Schema = { id: "text!", label: "text!", line: "text!", stations: "texts!" };
const FRAME: Schema = {
  id: "text!",
  label: "text",
  stations: "texts!",
  trigger: "trigger!",
  exit: "text!",
};
const TOP = ["model", "name", "lines", "stations", "tracks", "groups", "frames"];

/** What a reader is told a field must be. */
const WORD: Record<Type, string> = {
  text: "text",
  number: "a number",
  true: "true, or left out",
  texts: "a list of text",
  map: "a map of text or number values",
  trigger: "a trigger with a trigger id and optional with",
  triggers: "a list of triggers, each with a trigger id and optional with",
  entry: "a map with via, and optional channel, campaign, source, segment and parked",
};

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Does `v` have type `t`? A nested map reports its own reasons into `errors`. */
function has(t: Type, v: unknown, who: string, errors: string[]): boolean {
  switch (t) {
    case "text":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "true":
      return v === true;
    case "texts":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "map":
      return (
        isMap(v) && Object.values(v).every((x) => typeof x === "string" || typeof x === "number")
      );
    case "trigger":
      if (!isMap(v)) return false;
      checkFields(who, v, TRIGGER, errors);
      return true;
    case "triggers":
      if (!Array.isArray(v)) return false;
      for (const [i, x] of v.entries()) {
        if (!isMap(x)) return false;
        checkFields(`${who} ${i + 1}`, x, TRIGGER, errors);
      }
      return true;
    case "entry":
      if (!isMap(v)) return false;
      checkFields(who, v, ENTRY, errors);
      return true;
  }
}

/** Every reason `v` does not fit `schema`: a missing field, a wrong type, an unknown field. */
function checkFields(
  who: string,
  v: Record<string, unknown>,
  schema: Schema,
  errors: string[],
): void {
  for (const k of Object.keys(v)) if (!(k in schema)) errors.push(`${who}: ${k} is not a field.`);
  for (const [k, spec] of Object.entries(schema)) {
    const need = spec.endsWith("!");
    const type = (need ? spec.slice(0, -1) : spec) as Type;
    const x = v[k];
    if (x === undefined) {
      if (need) errors.push(`${who} has no ${k}.`);
    } else if (!has(type, x, `${who} ${k}`, errors)) errors.push(`${who}: ${k} is ${WORD[type]}.`);
  }
}

/** One list of the file: each item checked against `schema`. Returns the items that are maps. */
function readList(
  doc: Record<string, unknown>,
  key: string,
  word: string,
  schema: Schema,
  required: boolean,
  errors: string[],
): unknown[] {
  const list = doc[key];
  if (list === undefined) {
    if (required) errors.push(`${key} is a list.`);
    return [];
  }
  if (!Array.isArray(list)) {
    errors.push(`${key} is a list.`);
    return [];
  }
  const out: unknown[] = [];
  for (const [i, item] of list.entries()) {
    if (!isMap(item)) {
      errors.push(`${word} ${i + 1} is a map of fields.`);
      continue;
    }
    const who = typeof item.id === "string" ? `${word} "${item.id}"` : `${word} ${i + 1}`;
    checkFields(who, item, schema, errors);
    out.push(item);
  }
  return out;
}

/**
 * A parsed YAML value to a metro body. Refused, with every reason found, when a field has the
 * wrong type, a needed field is missing or the file holds a field the model does not know.
 */
export function parseMetroBody(doc: unknown): MetroBody {
  if (!isMap(doc))
    throw new Refused(["The file needs model, name, lines and stations at the top."]);
  const errors: string[] = [];
  if (doc.model !== "metro") errors.push("model is metro.");
  if (typeof doc.name !== "string") errors.push("The shape needs a name.");
  for (const k of Object.keys(doc))
    if (!TOP.includes(k)) errors.push(`${k} is not a field of the file.`);
  const lines = readList(doc, "lines", "Line", LINE, true, errors);
  const stations = readList(doc, "stations", "Station", STATION, true, errors);
  const tracks = readList(doc, "tracks", "Track", TRACK, false, errors);
  const groups = readList(doc, "groups", "Group", GROUP, false, errors);
  const frames = readList(doc, "frames", "Frame", FRAME, false, errors);
  if (errors.length) throw new Refused(errors);
  return {
    model: "metro",
    name: String(doc.name),
    lines,
    stations,
    tracks,
    groups,
    frames,
  } as MetroBody;
}
