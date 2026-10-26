/**
 * `wren [--client <id>] shape …` (designs/2026-10-19-business-map.md): read the shape, change it
 * one version at a time, start from the starter, and move a journey.
 *
 * Every write is a new version with a reason. `add-node`, `connect` and `remove` build the new body
 * from the newest one (`@wren/pipeline/edit`) and `saveShape` checks all of it. A file goes in
 * whole through `import`. `move` is the same handler as `wren journeys move`.
 *
 * History like git: `draft` keeps a body beside the live shape until a person applies it, `blame`
 * reads one node's, edge's, line's, station's or track's history, `undo` reverses one change of a
 * past diff, `tag` names a version, and `mirror` copies each version to the private repo. Every
 * save mirrors and says what the mirror did.
 *
 * A version is a graph or on the metro model (designs/2026-10-20-design-language.md, area C1).
 * `show`, `diff`, `export`, `blame` and `undo` read both. `convert` turns a graph into a metro
 * body; with `--write` it saves that as the next version. `add-node`, `connect` and `remove` edit
 * the graph only: on a metro version they refuse, and the way is export, edit the YAML, import.
 *
 * Edits to a draft are ops (`@wren/pipeline/metro-ops`): `edit` writes them to a draft, which
 * always holds a metro body. `draft show` prints what apply would do: the merge when live moved
 * and the conflicts. The store refuses every graph body (C1 part 4).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { normalEmail } from "@wren/core/clients";
import { TRIGGER_IDS } from "@wren/core/logic";
import { type SavedViewLine, savedViewsOf } from "@wren/core/saved-views";
import type { Db } from "@wren/db";
import {
  type ConvertPlan,
  convertShape,
  planConvert,
  reportLines,
} from "@wren/pipeline/convert-shape";
import { changeKey, changesOf } from "@wren/pipeline/diff";
import {
  applyDraft,
  draftsOf,
  dropDraft,
  editDraft,
  newDraft,
  planApply,
  proposeDraft,
} from "@wren/pipeline/drafts";
import {
  edgeOf,
  editShape,
  ON_METRO,
  openOn,
  withEdge,
  withNode,
  withoutEdge,
  withoutNode,
} from "@wren/pipeline/edit";
import { DRAFT_STATES, type DraftState, OPEN_DRAFT_STATES } from "@wren/pipeline/history";
import { type Attach, isMetro, type MetroBody, placesOf } from "@wren/pipeline/metro";
import { MAP_VIEW_RECORD, partsOf, readPart } from "@wren/pipeline/metro-parts";
import { type MirrorResult, mirrorsOf } from "@wren/pipeline/mirror";
import {
  ACTIONS,
  type Advance,
  RESEARCH_LEVELS,
  type Research,
  type ShapeNode,
  VIAS,
} from "@wren/pipeline/model";
import { openNowOf } from "@wren/pipeline/numbers";
import { exportShape, importShape, parseShape } from "@wren/pipeline/shape-file";
import { startShape } from "@wren/pipeline/starter";
import {
  newestShape,
  Refused,
  type ShapeDiff,
  shapeContext,
  shapeVersionsOf,
} from "@wren/pipeline/store";
import {
  type BlameOn,
  diffStored,
  historyOfStored,
  type StoredBody,
  type StoredDiff,
  storedChangeKey,
  storedChangeLines,
  storedChangesOf,
} from "@wren/pipeline/stored";
import { addTag, tagsOf } from "@wren/pipeline/tags";
import { planUndo, undoShape } from "@wren/pipeline/undo";
import { type Command, InvalidArgumentError } from "commander";
import { addMove, numberArg, type PipelineWrites, plain, who } from "./pipeline.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export interface ShapeDeps {
  /** The command's database: `--client`'s, else main. */
  withDb: WithDb;
  /** The worker's `Journeys` service, for `move`. */
  writes: PipelineWrites | undefined;
  /** Copy this workspace's missing versions to the private repo: `--client`'s, else Wren's. */
  mirror: (db: Db) => Promise<MirrorResult>;
  /** The same for Wren and every client, one result a workspace (`mirror --all`). */
  mirrorAll: () => Promise<Array<{ workspace: string; result: MirrorResult }>>;
  /** The main database and this workspace's id, where the saved views of its Map live. */
  withViews: <T>(fn: (main: Db, workspace: string) => Promise<T>) => Promise<T>;
}

// --- pure helpers ---------------------------------------------------------------------------

const day = (d: Date) => d.toISOString().slice(0, 10);

/** `trigger.touch:kind=reply,channel=email` as an advance entry. Settings stay text. */
export function advanceArg(v: string): Advance {
  const [trigger = "", rest] = v.split(":", 2) as [string, string?];
  if (!trigger) throw new InvalidArgumentError("use trigger.id or trigger.id:key=value,key=value");
  if (!rest) return { trigger };
  const pairs = rest.split(",").map((p) => p.split("=", 2) as [string, string?]);
  if (pairs.some(([k, val]) => !k || val === undefined))
    throw new InvalidArgumentError("settings are key=value, joined with commas");
  return { trigger, with: Object.fromEntries(pairs.map(([k, val]) => [k, val ?? ""])) };
}

const collect = (v: string, all: string[] = []): string[] => [...all, v];

/** A draft state, or `all`. */
function stateArg(v: string): DraftState | "all" {
  if (v === "all" || (DRAFT_STATES as readonly string[]).includes(v))
    return v as DraftState | "all";
  throw new InvalidArgumentError(`use one of ${DRAFT_STATES.join(", ")} or all`);
}

/** One line for a node's own fields. */
function detailOf(n: ShapeNode): string {
  switch (n.kind) {
    case "source":
      return [
        `via ${n.via}`,
        n.channel,
        n.campaign,
        n.source,
        n.group && `group ${n.group}`,
        n.sop && `sop ${n.sop}`,
      ]
        .filter(Boolean)
        .join(" ")
        .concat(n.parked ? " (parked)" : "");
    case "step":
      return `action ${n.action}`;
    case "offer":
      return `offer ${n.offer}`;
    case "plan":
      return `terms ${n.terms}`;
    case "job":
      return `job ${n.job}`;
  }
}

/**
 * The shape as text: a node a line, shallowest first, with the journeys open on it, then the edges.
 * `open` maps a node id to how many open journeys sit there now.
 */
export function shapeLines(
  v: { number: number; createdAt: Date; createdBy: string; note: string; body: StoredBody },
  depths: Record<string, number>,
  open: ReadonlyMap<string, number>,
): string[] {
  if (isMetro(v.body)) return metroLines({ ...v, body: v.body }, depths, open);
  const lines = [
    `${v.body.name}  v${v.number}  ${day(v.createdAt)}  ${v.createdBy}`,
    v.note,
    "",
    "nodes",
  ];
  const nodes = [...v.body.nodes].sort((a, b) => (depths[a.id] ?? 0) - (depths[b.id] ?? 0));
  for (const n of nodes) {
    const here = open.get(n.id);
    lines.push(
      `  ${depths[n.id] ?? 0}  ${n.id}  ${n.kind}  ${n.name}  ${detailOf(n)}${here ? `  open ${here}` : ""}`,
    );
  }
  lines.push("", "edges");
  for (const e of v.body.edges)
    lines.push(
      `  ${e.id}  ${e.from} -> ${e.to}${e.kind === "loop" ? "  (loop)" : ""}${e.label ? `  "${e.label}"` : ""}`,
    );
  return lines;
}

/** `  attach 2` for a part that has attach items, else nothing. */
const attachMark = (p: { attach?: readonly unknown[] }): string =>
  p.attach?.length ? `  attach ${p.attach.length}` : "";

/**
 * A metro version as text: the lines, then the stations by place with the journeys open on each,
 * then the tracks, then the groups and the flows when the body has any. A line, station or group
 * with attach shows `attach <n>`. `places` is the version's `depths` column, which holds places
 * for a metro body.
 */
export function metroLines(
  v: { number: number; createdAt: Date; createdBy: string; note: string; body: MetroBody },
  places: Record<string, number>,
  open: ReadonlyMap<string, number>,
): string[] {
  const lines = [
    `${v.body.name}  v${v.number}  ${day(v.createdAt)}  ${v.createdBy}`,
    v.note,
    "",
    "lines",
  ];
  for (const l of v.body.lines)
    lines.push(
      `  ${l.id}  ${l.tier}  ${l.label}${l.offer ? `  offer ${l.offer}` : ""}${attachMark(l)}`,
    );
  lines.push("", "stations");
  const stations = [...v.body.stations].sort((a, b) => (places[a.id] ?? 0) - (places[b.id] ?? 0));
  for (const s of stations) {
    const here = open.get(s.id);
    lines.push(
      `  ${places[s.id] ?? 0}  ${s.id}  ${s.kind}  ${s.label}${s.line ? `  line ${s.line}` : ""}${s.action ? `  action ${s.action}` : ""}${s.sop ? `  sop ${s.sop}` : ""}${here ? `  open ${here}` : ""}${attachMark(s)}`,
    );
  }
  lines.push("", "tracks");
  for (const t of v.body.tracks)
    lines.push(
      `  ${t.id}  ${t.from} -> ${t.to}${t.line ? `  line ${t.line}` : ""}${t.kind ? `  (${t.kind})` : ""}${t.by === "person" ? "  by person" : ""}${t.label ? `  "${t.label}"` : ""}`,
    );
  if (v.body.groups.length > 0) {
    lines.push("", "groups");
    for (const g of v.body.groups)
      lines.push(`  ${g.id}  ${g.label}  line ${g.line}${attachMark(g)}`);
  }
  const flows = v.body.flows ?? [];
  if (flows.length > 0) {
    lines.push("", "flows");
    for (const f of flows)
      lines.push(`  ${f.id}  ${f.label}  stations ${f.stations.length}  tracks ${f.tracks.length}`);
  }
  return lines;
}

const attachText = (a: Attach) => `${a.kind}  ${a.ref}${a.label ? `  "${a.label}"` : ""}`;

/** A saved view of the Map as one line: `41  Sales desk  shared  line:growth,group:talk`. */
export const viewLine = (v: SavedViewLine): string =>
  [
    v.id,
    v.name,
    v.shared ? "shared" : "own",
    new URLSearchParams(v.params).get("parts") ?? "",
  ].join("  ");

/**
 * A saved view read against a body (designs/2026-10-23-focus-view.md, F2): each part, its
 * attachments, its stations and theirs. A part the body lost says so.
 */
export function viewLines(v: SavedViewLine, body: { number: number; body: MetroBody }): string[] {
  const lines = [`${v.name}  ${v.shared ? "shared" : "own"}  read on v${body.number}`];
  for (const part of partsOf(new URLSearchParams(v.params).get("parts"))) {
    const read = readPart(body.body, part);
    lines.push("", `${part.kind} ${part.id}  ${read ? read.label : "not in this version"}`);
    if (!read) continue;
    for (const a of read.attach ?? []) lines.push(`  attach  ${attachText(a)}`);
    for (const s of read.stations) {
      lines.push(`  ${s.id}  ${s.label}`);
      for (const a of s.attach ?? []) lines.push(`    attach  ${attachText(a)}`);
    }
  }
  return lines;
}

/**
 * A diff as text, one line per change. Empty when nothing differs. With `keys`, each line ends in
 * its change key in brackets, the key `undo` takes.
 */
export function diffLines(d: ShapeDiff, keys = false): string[] {
  const lines: string[] = [];
  if (d.name) lines.push(`name: ${d.name.from} -> ${d.name.to}`);
  for (const id of d.nodes.added) lines.push(`+ node ${id}`);
  for (const id of d.nodes.removed) lines.push(`- node ${id}`);
  for (const r of d.nodes.renamed) lines.push(`~ node ${r.id} renamed: ${r.from} -> ${r.to}`);
  for (const id of d.nodes.changed) lines.push(`~ node ${id} changed`);
  for (const id of d.edges.added) lines.push(`+ edge ${id}`);
  for (const id of d.edges.removed) lines.push(`- edge ${id}`);
  for (const id of d.edges.changed) lines.push(`~ edge ${id} changed`);
  if (!keys) return lines;
  // `changesOf` reads in the order the lines above are pushed.
  const all = changesOf(d);
  return lines.map((line, i) => `${line}  [${all[i] ? changeKey(all[i]) : ""}]`);
}

/**
 * A diff of either model as text, one line per change. `a` is the older body and `b` the newer.
 * A graph diff reads as `diffLines` does. A metro diff reads as sentences. With `keys`, each line
 * ends in its change key in brackets, the key `undo` takes.
 */
export function storedDiffLines(
  a: StoredBody,
  b: StoredBody,
  d: StoredDiff,
  keys = false,
): string[] {
  if (d.model === "graph") return diffLines(d.diff, keys);
  const lines = storedChangeLines(a, b, d);
  if (!keys) return lines;
  return storedChangesOf(d).map((c, i) => `${lines[i]}  [${storedChangeKey(c)}]`);
}

/** What `convert` prints besides the file: the report, or that the shape is on the metro model already. */
export function convertLines(plan: ConvertPlan): string[] {
  return plan.already ? ["The shape is on the metro model already."] : reportLines(plan.report);
}

const BLAME_ON = ["node", "edge", "line", "station", "track", "group", "frame", "flow"] as const;

/** What `blame --on` names. */
export function blameOnArg(v: string): BlameOn {
  if ((BLAME_ON as readonly string[]).includes(v)) return v as BlameOn;
  throw new InvalidArgumentError(`use one of ${BLAME_ON.join(", ")}`);
}

/**
 * The ops `edit` sends: one op as JSON text, or `--ops <file>` (`-` is stdin) holding one op or a
 * list. Exactly one of the two. `read` gives a file's text.
 */
export function opsInput(
  op: string | undefined,
  file: string | undefined,
  read: (file: string) => string,
): unknown {
  if ((op === undefined) === (file === undefined))
    throw new Refused(["Give an op as JSON text, or --ops <file>. Not both, not neither."]);
  const text = op ?? read(file as string);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Refused([`The ops are not valid JSON: ${(e as Error).message}`]);
  }
}

const readText = (file: string): string => readFileSync(file === "-" ? 0 : file, "utf8");

/** What the mirror did, as lines: `mirrored v<n> <sha7>`, `mirror off`, `mirror failed: <why>`. */
export function mirrorLines(r: MirrorResult): string[] {
  if (r.off) return ["mirror off"];
  return [
    ...r.committed.map((c) => `mirrored v${c.version} ${c.sha.slice(0, 7)}`),
    ...(r.failed ? [`mirror failed: ${r.failed}`] : []),
  ];
}

/** One draft as a list line. */
export function draftLine(d: {
  id: string;
  state: string;
  base: number;
  updatedAt: Date;
  createdBy: string;
  name: string;
}): string {
  return `${d.id}  ${d.state}  v${d.base}  ${day(d.updatedAt)}  ${d.createdBy}  ${d.name}`;
}

/** A node's or edge's `blame` lines, as given: `v<n>  <day>  <by>  <how>  <note>`. */
export function blameLines(
  lines: Array<{ version: number; at: string; by: string; how: string; note: string }>,
): string[] {
  return lines.map((l) => `v${l.version}  ${l.at.slice(0, 10)}  ${l.by}  ${l.how}  ${l.note}`);
}

/** The fields `add-node` takes. */
interface NodeOptions {
  kind: string;
  name: string;
  via?: string;
  channel?: string;
  campaign?: string;
  source?: string;
  group?: string;
  parked?: boolean;
  action?: string;
  offer?: string;
  terms?: string;
  research?: string;
  idleDays?: number;
  advance?: Advance[];
}

/** The node `o` describes. Refused when a field its kind needs is missing or not allowed. */
export function nodeFrom(id: string, o: NodeOptions): ShapeNode {
  const need = (field: string, value: unknown, list?: readonly string[]) => {
    if (value === undefined || value === "")
      throw new Refused([`A ${o.kind} node needs --${field}.`]);
    if (list && !list.includes(String(value)))
      throw new Refused([`--${field} "${String(value)}" is not one of ${list.join(", ")}.`]);
  };
  const advance = o.advance ?? [];
  const research = o.research as Research | undefined;
  if (research) need("research", research, RESEARCH_LEVELS);
  const idle = o.idleDays !== undefined ? { idleDays: o.idleDays } : {};
  const common = { id, name: o.name, ...(research ? { research } : {}), ...idle };
  if (o.kind === "source") {
    need("via", o.via, VIAS);
    return {
      id,
      name: o.name,
      kind: "source",
      via: o.via as (typeof VIAS)[number],
      ...(o.channel ? { channel: o.channel } : {}),
      ...(o.campaign ? { campaign: o.campaign } : {}),
      ...(o.source ? { source: o.source } : {}),
      ...(o.group ? { group: o.group } : {}),
      ...(o.parked ? { parked: true as const } : {}),
    };
  }
  if (o.kind === "step") {
    need("action", o.action, ACTIONS);
    return { ...common, kind: "step", action: o.action as (typeof ACTIONS)[number], advance };
  }
  if (o.kind === "offer") {
    need("offer", o.offer);
    return { ...common, kind: "offer", offer: o.offer as string, advance };
  }
  if (o.kind === "plan") {
    need("terms", o.terms);
    return { id, name: o.name, ...idle, kind: "plan", terms: o.terms as string, advance };
  }
  throw new Refused([`--kind "${o.kind}" is not one of source, step, offer, plan.`]);
}

// --- the commands ---------------------------------------------------------------------------

export function registerShape(program: Command, deps: ShapeDeps): void {
  const { withDb } = deps;
  const shape = program
    .command("shape")
    .description("the business shape: sources, steps, offers and plans, and the edges between");

  /** The mirror, as a result. A throw from the dependency reads as a failure, never as a crash. */
  const mirrorSafe = async (db: Db): Promise<MirrorResult> => {
    try {
      return await deps.mirror(db);
    } catch (e) {
      return { committed: [], failed: e instanceof Error ? e.message : String(e) };
    }
  };
  const printMirror = (r: MirrorResult | null): void => {
    if (r) for (const line of mirrorLines(r)) console.log(line);
  };
  /** A write, then the mirror in the same database. The mirror never fails the write. */
  const writeAndMirror = <T>(fn: (db: Db) => Promise<T>, saved: (r: T) => boolean = () => true) =>
    withDb(async (db) => {
      const result = await fn(db);
      return { result, mirror: saved(result) ? await mirrorSafe(db) : null };
    });

  const versionArg = (v: string) => numberArg(v);

  shape
    .command("show")
    .description("The shape as an outline, with the journeys open on each node")
    .option("--version <n>", "a version number; the newest when left out", versionArg)
    .action(async (o: { version?: number }) => {
      const out = await withDb(async (db) => {
        const all = await shapeVersionsOf(db);
        const v = o.version ? all.find((x) => x.number === o.version) : all[all.length - 1];
        if (!v) return null;
        // The column holds graph depth; a metro version is drawn by place, worked out here.
        const depths = isMetro(v.body) ? placesOf(v.body) : v.depths;
        return shapeLines(v, depths, await openNowOf(db));
      });
      if (!out) {
        console.log(o.version ? `no version ${o.version}` : "no shape yet");
        return;
      }
      for (const line of out) console.log(line);
    });

  shape
    .command("versions")
    .description("Every version: number, day, who and why, then its tags and mirror commit")
    .action(async () => {
      const { all, tags, mirrors } = await withDb(async (db) => ({
        all: await shapeVersionsOf(db),
        tags: await tagsOf(db),
        mirrors: await mirrorsOf(db),
      }));
      for (const v of all) {
        const names = tags.filter((t) => t.version === v.number).map((t) => t.name);
        const sha = mirrors.find((m) => m.version === v.number)?.sha;
        console.log(
          [
            `v${v.number}  ${day(v.createdAt)}  ${v.createdBy}  ${v.note}`,
            names.length ? `[${names.join(", ")}]` : "",
            sha ? sha.slice(0, 7) : "",
          ]
            .filter(Boolean)
            .join("  "),
        );
      }
      if (!all.length) console.log("no shape yet");
    });

  shape
    .command("diff <a> <b>")
    .description("What changed from version a to version b. Each line ends in its change key")
    .action((a: string, b: string) =>
      plain(async () => {
        const [na, nb] = [versionArg(a), versionArg(b)];
        const all = await withDb((db) => shapeVersionsOf(db));
        const [va, vb] = [all.find((v) => v.number === na), all.find((v) => v.number === nb)];
        if (!va || !vb) throw new Error(`no version ${!va ? na : nb}`);
        const lines = storedDiffLines(va.body, vb.body, diffStored(va.body, vb.body), true);
        for (const line of lines.length ? lines : ["no difference"]) console.log(line);
      }),
    );

  shape
    .command("export")
    .description("A version as a shape file (YAML)")
    .option("--version <n>", "a version number; the newest when left out", versionArg)
    .option("--out <file>", "write here instead of printing")
    .action(async (o: { version?: number; out?: string }) => {
      const body = await withDb(async (db) => {
        if (!o.version) return (await newestShape(db))?.body;
        return (await shapeVersionsOf(db)).find((v) => v.number === o.version)?.body;
      });
      if (!body) throw new Error(o.version ? `no version ${o.version}` : "no shape yet");
      const text = exportShape(body);
      if (o.out) writeFileSync(o.out, text);
      else process.stdout.write(text);
    });

  shape
    .command("convert")
    .description(
      "A version on the metro model, as a shape file (YAML), and a report of what the convert keeps. With --write, save it as the next version if every proof holds",
    )
    .option("--version <n>", "a version number; the newest when left out", versionArg)
    .option("--out <file>", "write the file here instead of printing it")
    .option("--write", "save the metro model as the next version (the newest only)")
    .option("--note <text>", "why, with --write", "Move the shape to the metro model.")
    .action((o: { version?: number; out?: string; write?: boolean; note: string }) =>
      plain(async () => {
        // The file goes to stdout unless `--out`; the report then goes to stderr, so a pipe stays a file.
        const say = (lines: string[]) => {
          for (const line of lines) (o.out || o.write ? console.log : console.error)(line);
        };
        if (!o.write) {
          // Read what the proofs need in one go, then prove with no database.
          const read = await withDb(async (db) => ({
            all: await shapeVersionsOf(db),
            ctx: await shapeContext(db, TRIGGER_IDS),
            open: await openNowOf(db),
          }));
          const v = o.version
            ? read.all.find((x) => x.number === o.version)
            : read.all[read.all.length - 1];
          if (!v) throw new Refused([o.version ? `no version ${o.version}` : "no shape yet"]);
          const got = planConvert(v.body, v.number, read.ctx, read.open);
          const text = exportShape(got.body);
          if (o.out) {
            writeFileSync(o.out, text);
            console.log(`wrote ${o.out}`);
          } else process.stdout.write(text);
          say(convertLines(got));
          return;
        }
        const { result: r, mirror } = await writeAndMirror(async (db) => {
          const newest = await newestShape(db);
          if (!newest) throw new Refused(["The workspace has no shape yet."]);
          if (o.version && o.version !== newest.number)
            throw new Refused([
              `Only the newest version can be written. v${o.version} is not the newest (v${newest.number}).`,
            ]);
          return convertShape(db, { note: o.note, by: who(), triggers: TRIGGER_IDS });
        });
        say(reportLines(r.report));
        console.log(`v${r.version.number} saved`);
        printMirror(mirror);
      }),
    );

  shape
    .command("import <file>")
    .description("Save a shape file as the next version, with the terms it lists")
    .option("--note <why>", "why, when the file has no note")
    .action((file: string, o: { note?: string }) =>
      plain(async () => {
        const text = readFileSync(file, "utf8");
        const { result: r, mirror } = await writeAndMirror(
          (db) =>
            importShape(db, text, {
              by: who(),
              triggers: TRIGGER_IDS,
              ...(o.note ? { note: o.note } : {}),
            }),
          (r) => !!r.shape,
        );
        for (const t of r.terms) console.log(`terms ${t.offer} ${t.plan} from ${t.effectiveFrom}`);
        console.log(r.shape ? `v${r.shape.number} saved` : "no change");
        printMirror(mirror);
      }),
    );

  shape
    .command("start")
    .description(
      "Save the starter shape as version 1, with the note Starter. Does nothing when a shape exists",
    )
    .action(() =>
      plain(async () => {
        const { result: v, mirror } = await writeAndMirror(
          (db) => startShape(db, { by: who(), triggers: TRIGGER_IDS }),
          (v) => !!v,
        );
        console.log(v ? `v${v.number} saved` : "a shape exists; nothing changed");
        printMirror(mirror);
      }),
    );

  shape
    .command("add-node <id>")
    .description("Add a node as the next version. A node that holds journeys needs --from")
    .requiredOption("--kind <kind>", "source, step, offer or plan")
    .requiredOption("--name <text>", "the name people read")
    .requiredOption("--note <why>", "why the shape changes")
    .option("--from <node>", "a flow edge from this node into the new one", collect, [])
    .option("--to <node>", "a flow edge from the new node to this one", collect, [])
    .option("--via <via>", `source: ${VIAS.join(", ")}`)
    .option("--channel <channel>", "source: the platform the cause must come from")
    .option("--campaign <id>", "source: an ads campaign or /go/ campaign")
    .option("--source <id>", "source via sourced: the list, import:<batch id>")
    .option("--group <id>", "source via group: the saved group's number")
    .option("--parked", "source: opens nothing, keeps its numbers")
    .option("--action <action>", `step: ${ACTIONS.join(", ")}`)
    .option("--offer <id>", "offer: the registry offer id")
    .option("--terms <plan>", "plan: the terms plan slug")
    .option("--research <level>", `research on arrival: ${RESEARCH_LEVELS.join(", ")}`)
    .option("--idle-days <n>", "days an open journey may sit here before it reads stale", numberArg)
    .option(
      "--advance <spec>",
      "what moves a journey here: trigger.id or trigger.id:key=value,key=value (repeat)",
      (v: string, all: Advance[] = []) => [...all, advanceArg(v)],
    )
    .action(
      (
        id: string,
        o: NodeOptions & { note: string; from: string[]; to: string[]; idleDays?: number },
      ) =>
        plain(async () => {
          const node = nodeFrom(id, o);
          const edges = [...o.from.map((f) => edgeOf(f, id)), ...o.to.map((t) => edgeOf(id, t))];
          const { result: v, mirror } = await writeAndMirror((db) =>
            editShape(db, {
              change: (body) => withNode(body, node, edges),
              note: o.note,
              by: who(),
              triggers: TRIGGER_IDS,
            }),
          );
          console.log(`v${v.number} saved`);
          printMirror(mirror);
        }),
    );

  shape
    .command("connect <from> <to>")
    .description("Add an edge as the next version: flow by default, or a loop back")
    .requiredOption("--note <why>", "why the shape changes")
    .option("--loop", "a loop edge: sends a journey back as a new journey")
    .option("--label <text>", "a short label for the edge")
    .option("--id <id>", "the edge id; from_to_to when left out")
    .action(
      (
        from: string,
        to: string,
        o: { note: string; loop?: boolean; label?: string; id?: string },
      ) =>
        plain(async () => {
          const edge = edgeOf(from, to, {
            ...(o.loop ? { loop: true } : {}),
            ...(o.label ? { label: o.label } : {}),
            ...(o.id ? { id: o.id } : {}),
          });
          const { result: v, mirror } = await writeAndMirror((db) =>
            editShape(db, {
              change: (body) => withEdge(body, edge),
              note: o.note,
              by: who(),
              triggers: TRIGGER_IDS,
            }),
          );
          console.log(`v${v.number} saved`);
          printMirror(mirror);
        }),
    );

  shape
    .command("remove <id>")
    .description(
      "Remove a node (and its edges) or, with --edge, one edge, as the next version. Refused while journeys are open on the node",
    )
    .requiredOption("--note <why>", "why the shape changes")
    .option("--edge", "the id names an edge, not a node")
    .option("--move-to <node>", "send the open journeys on the node here")
    .option("--ghost", "leave the open journeys where they are, on their own version")
    .action((id: string, o: { note: string; edge?: boolean; moveTo?: string; ghost?: boolean }) =>
      plain(async () => {
        if (o.moveTo && o.ghost) throw new Refused(["Use --move-to or --ghost, not both."]);
        const { result: v, mirror } = await writeAndMirror(async (db) => {
          // The graph edits refuse on a metro version. Say so before the open-journeys advice.
          const newest = await newestShape(db);
          if (newest && isMetro(newest.body)) throw new Refused([ON_METRO]);
          if (!o.edge) {
            const open = await openOn(db, id);
            if (open > 0 && !o.moveTo && !o.ghost)
              throw new Refused([
                `${open} open ${open === 1 ? "journey sits" : "journeys sit"} on ${id}. Use --move-to <node> to send them on, or --ghost to leave them.`,
              ]);
          }
          return editShape(db, {
            change: (body) => (o.edge ? withoutEdge(body, id) : withoutNode(body, id)),
            note: o.note,
            by: who(),
            triggers: TRIGGER_IDS,
            ...(o.moveTo && !o.edge ? { moves: { [id]: o.moveTo } } : {}),
          });
        });
        console.log(`v${v.number} saved`);
        printMirror(mirror);
      }),
    );

  // --- drafts, blame, undo, tags and the mirror -------------------------------------------

  shape
    .command("edit <draft> [op]")
    .description(
      'Edit a draft with ops. [op] is one op as JSON text, like \'{"op":"rename","on":"station","id":"book","label":"Book a call"}\'. Or --ops <file> (- for stdin) with one op or a list. All or nothing',
    )
    .option("--ops <file>", "a JSON file with one op or a list of ops; - reads stdin")
    .action((id: string, op: string | undefined, o: { ops?: string }) =>
      plain(async () => {
        const ops = opsInput(op, o.ops, readText);
        const { done, plan } = await withDb(async (db) => ({
          done: await editDraft(db, { id, ops, by: who(), triggers: TRIGGER_IDS }),
          plan: await planApply(db, id),
        }));
        for (const line of done.lines) console.log(line);
        for (const w of done.warnings) console.log(`warning: ${w}`);
        console.log(`draft ${id}: ${plan.lines.length} changes from v${plan.live}`);
      }),
    );

  const draft = shape
    .command("draft")
    .description("A shape saved beside the live one, until a person applies or drops it");

  draft
    .command("new [file]")
    .description(
      "Save a draft. With a shape file it holds that file, its moves and note. Without one it forks the newest version, or --base",
    )
    .requiredOption("--name <name>", "the draft's name; its id is made from it")
    .option("--note <why>", "why, when the file has no note")
    .option("--base <n>", "the version to fork; the newest when left out", versionArg)
    .action((file: string | undefined, o: { name: string; note?: string; base?: number }) =>
      plain(async () => {
        const parsed = file ? parseShape(readFileSync(file, "utf8")) : undefined;
        const note = parsed?.note ?? o.note;
        const d = await withDb((db) =>
          newDraft(db, {
            name: o.name,
            ...(parsed ? { body: parsed.body } : {}),
            ...(parsed?.moves ? { moves: parsed.moves } : {}),
            ...(o.base !== undefined ? { base: o.base } : {}),
            ...(note ? { note } : {}),
            by: who(),
          }),
        );
        console.log(`draft ${d.id} saved on v${d.base}`);
        if (parsed?.terms?.length)
          console.log("the file's terms are not part of a draft; import the file to add them");
      }),
    );

  draft
    .command("list")
    .description(
      "Drafts, newest change first. The open ones (draft and proposed) unless --state says",
    )
    .option("--state <state>", `${DRAFT_STATES.join(", ")} or all`, stateArg)
    .action((o: { state?: DraftState | "all" }) =>
      plain(async () => {
        const states = o.state === "all" ? undefined : o.state ? [o.state] : OPEN_DRAFT_STATES;
        const all = await withDb((db) => draftsOf(db, states ? { states } : {}));
        for (const d of all) console.log(draftLine(d));
        if (!all.length) console.log("no drafts");
      }),
    );

  draft
    .command("show <id>")
    .description(
      "A draft, who wrote it, and what applying it would do: the merge, the conflicts, and the changes a line each",
    )
    .action((id: string) =>
      plain(async () => {
        const plan = await withDb((db) => planApply(db, id));
        const d = plan.draft;
        console.log(draftLine(d));
        console.log(`by ${d.createdBy}`);
        if (d.note) console.log(d.note);
        if (d.state === "applied") console.log(`applied as v${d.appliedVersion} by ${d.decidedBy}`);
        if (d.state === "dropped") console.log(`dropped by ${d.decidedBy}: ${d.dropReason}`);
        if (plan.moved) console.log(`live moved since v${plan.base} (now v${plan.live})`);
        for (const c of plan.conflictLines) console.log(`conflict: ${c}`);
        for (const line of plan.lines.length
          ? plan.lines
          : ["no difference from the newest version"])
          console.log(line);
      }),
    );

  draft
    .command("propose <id>")
    .description("Ask a person to apply the draft")
    .action((id: string) =>
      plain(async () => {
        const d = await withDb((db) => proposeDraft(db, { id, by: who() }));
        console.log(`draft ${d.id} proposed`);
      }),
    );

  draft
    .command("apply <id>")
    .description("Save the draft as the next version. It meets the checks of any version")
    .action((id: string) =>
      plain(async () => {
        const { result: r, mirror } = await writeAndMirror((db) =>
          applyDraft(db, { id, by: who(), triggers: TRIGGER_IDS }),
        );
        console.log(`v${r.version.number} saved from draft ${r.draft.id}`);
        printMirror(mirror);
      }),
    );

  draft
    .command("drop <id>")
    .description("Close the draft without a version")
    .requiredOption("--reason <why>", "why it is dropped")
    .action((id: string, o: { reason: string }) =>
      plain(async () => {
        const d = await withDb((db) => dropDraft(db, { id, by: who(), reason: o.reason }));
        console.log(`draft ${d.id} dropped`);
      }),
    );

  shape
    .command("blame <id>")
    .description(
      "Every version that touched a node, or with --edge an edge, or with --on a line, station, track, group, frame or flow: v<n>  day  who  how  why, newest first",
    )
    .option("--edge", "the id names an edge, not a node")
    .option("--on <kind>", `what the id names: ${BLAME_ON.join(", ")}`, blameOnArg)
    .action((id: string, o: { edge?: boolean; on?: BlameOn }) =>
      plain(async () => {
        if (o.edge && o.on) throw new Refused(["Use --edge or --on, not both."]);
        const all = await withDb((db) => shapeVersionsOf(db));
        const lines = blameLines(historyOfStored(all, id, o.on ?? (o.edge ? "edge" : "node")));
        for (const line of lines.length ? lines : [`no history for ${id}`]) console.log(line);
      }),
    );

  shape
    .command("undo <a> <b> <change>")
    .description(
      "Reverse one change of the diff from version a to b, as the next version. <change> is a key from `shape diff`, like node:<id>:added or station:<id>:added",
    )
    .option("--preview", "show what the undo would do and save nothing")
    .action((a: string, b: string, change: string, o: { preview?: boolean }) =>
      plain(async () => {
        const ask = { a: versionArg(a), b: versionArg(b), change };
        if (o.preview) {
          const p = await withDb((db) => planUndo(db, { ...ask, triggers: TRIGGER_IDS }));
          console.log(`undo: ${p.line}`);
          console.log(`note: ${p.note}`);
          console.log(`applies to v${p.newest.number}`);
          for (const line of storedDiffLines(p.newest.body, p.result, p.diff)) console.log(line);
          return;
        }
        const { result: v, mirror } = await writeAndMirror((db) =>
          undoShape(db, { ...ask, by: who(), triggers: TRIGGER_IDS }),
        );
        console.log(`v${v.number} saved`);
        printMirror(mirror);
      }),
    );

  shape
    .command("tag <name> <version>")
    .description("Name one version, like a git tag. A tag is never moved or removed")
    .option("--note <why>", "why the version has this name")
    .action((name: string, version: string, o: { note?: string }) =>
      plain(async () => {
        const n = versionArg(version);
        const t = await withDb((db) =>
          addTag(db, {
            name,
            version: n,
            ...(o.note ? { note: o.note } : {}),
            by: who(),
          }),
        );
        console.log(`tag ${t.name} on v${t.version}`);
      }),
    );

  shape
    .command("tags")
    .description("Every tag: name, version, day, who and why")
    .action(async () => {
      const all = await withDb((db) => tagsOf(db));
      for (const t of all)
        console.log(
          [`${t.name}  v${t.version}  ${day(t.createdAt)}  ${t.createdBy}`, t.note]
            .filter(Boolean)
            .join("  "),
        );
      if (!all.length) console.log("no tags");
    });

  shape
    .command("mirror")
    .description(
      "Copy the versions the private repo lacks, oldest first. --all does Wren and every client",
    )
    .option("--all", "Wren's workspace and every client's")
    .action((o: { all?: boolean }) =>
      plain(async () => {
        const runs = o.all
          ? await deps.mirrorAll()
          : [{ workspace: "this workspace", result: await withDb(mirrorSafe) }];
        for (const { workspace, result } of runs) {
          const lines = mirrorLines(result);
          for (const line of lines.length ? lines : ["up to date"])
            console.log(o.all ? `${workspace}: ${line}` : line);
        }
      }),
    );

  const view = shape
    .command("view")
    .description(
      "Saved views of the Map: named sets of lines, groups, stations and flows (a team's slice)",
    );
  /** The views a viewer sees: the shared ones, and their own when --viewer names them. */
  const viewsFor = (viewer?: string) =>
    deps.withViews((main, workspace) =>
      savedViewsOf(main, { workspace, viewer: viewer ? normalEmail(viewer) : "" }, MAP_VIEW_RECORD),
    );
  const viewerOpt = "--viewer <email>";
  const viewerHelp = "add this person's own views to the shared ones";

  view
    .command("list")
    .description("The shared views of the Map: id  name  shared|own  parts")
    .option(viewerOpt, viewerHelp)
    .action((o: { viewer?: string }) =>
      plain(async () => {
        const all = await viewsFor(o.viewer);
        for (const v of all) console.log(viewLine(v));
        if (!all.length) console.log("no saved views");
      }),
    );

  view
    .command("show")
    .description("A view's parts on the newest version: each part's stations and their attachments")
    .argument("<id>", "the view's id, from view list", numberArg)
    .option(viewerOpt, viewerHelp)
    .action((n: number, o: { viewer?: string }) =>
      plain(async () => {
        const v = (await viewsFor(o.viewer)).find((x) => x.id === n);
        if (!v)
          throw new Refused([
            `There is no saved view ${n} here. A view its owner did not share needs --viewer.`,
          ]);
        const newest = await withDb(newestShape);
        if (!newest || !isMetro(newest.body))
          throw new Refused(["The newest version is not on the metro model."]);
        for (const line of viewLines(v, { ...newest, body: newest.body })) console.log(line);
      }),
    );

  addMove(shape, deps.writes);
}
