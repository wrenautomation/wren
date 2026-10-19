/**
 * `wren [--client <id>] shape …` (designs/2026-10-19-business-map.md): read the shape, change it
 * one version at a time, move a journey, and move the old funnels onto it.
 *
 * Every write is a new version with a reason. `add-node`, `connect` and `remove` build the new body
 * from the newest one (`@wren/pipeline/edit`) and `saveShape` checks all of it. A file goes in
 * whole through `import`. `move` is the same handler as `wren journeys move`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TRIGGER_IDS } from "@wren/core/logic";
import type { Db } from "@wren/db";
import {
  edgeOf,
  editShape,
  openOn,
  withEdge,
  withNode,
  withoutEdge,
  withoutNode,
} from "@wren/pipeline/edit";
import { type MigrateReport, migrateShape } from "@wren/pipeline/migrate";
import {
  ACTIONS,
  type Advance,
  RESEARCH_LEVELS,
  type Research,
  type ShapeBody,
  type ShapeNode,
  VIAS,
} from "@wren/pipeline/model";
import { openNowOf } from "@wren/pipeline/numbers";
import { exportShape, importShape } from "@wren/pipeline/shape-file";
import {
  diffShapes,
  newestShape,
  Refused,
  type ShapeDiff,
  shapeVersionsOf,
} from "@wren/pipeline/store";
import { type Command, InvalidArgumentError } from "commander";
import { addMove, numberArg, type PipelineWrites, plain, who } from "./pipeline.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export interface ShapeDeps {
  /** The command's database: `--client`'s, else main. */
  withDb: WithDb;
  withMainDb: WithDb;
  /** A client database by name, as main's login: migrations and grants are its job. */
  onDatabase: <T>(database: string, fn: (db: Db) => Promise<T>) => Promise<T>;
  /** Every client database name. */
  databases: () => Promise<string[]>;
  /** The database name of a client id. */
  databaseOf: (client: string) => Promise<string>;
  /** `--client`, when given. */
  client: () => string | undefined;
  /** The worker's `Journeys` service, for `move`. */
  writes: PipelineWrites | undefined;
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

/** One line for a node's own fields. */
function detailOf(n: ShapeNode): string {
  switch (n.kind) {
    case "source":
      return [`via ${n.via}`, n.channel, n.campaign, n.source, n.group && `group ${n.group}`]
        .filter(Boolean)
        .join(" ")
        .concat(n.parked ? " (parked)" : "");
    case "step":
      return `action ${n.action}`;
    case "offer":
      return `offer ${n.offer}`;
    case "plan":
      return `terms ${n.terms}`;
  }
}

/**
 * The shape as text: a node a line, shallowest first, with the journeys open on it, then the edges.
 * `open` maps a node id to how many open journeys sit there now.
 */
export function shapeLines(
  v: { number: number; createdAt: Date; createdBy: string; note: string; body: ShapeBody },
  depths: Record<string, number>,
  open: ReadonlyMap<string, number>,
): string[] {
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

/** A diff as text, one line per change. Empty when nothing differs. */
export function diffLines(d: ShapeDiff): string[] {
  const lines: string[] = [];
  if (d.name) lines.push(`name: ${d.name.from} -> ${d.name.to}`);
  for (const id of d.nodes.added) lines.push(`+ node ${id}`);
  for (const id of d.nodes.removed) lines.push(`- node ${id}`);
  for (const r of d.nodes.renamed) lines.push(`~ node ${r.id} renamed: ${r.from} -> ${r.to}`);
  for (const id of d.nodes.changed) lines.push(`~ node ${id} changed`);
  for (const id of d.edges.added) lines.push(`+ edge ${id}`);
  for (const id of d.edges.removed) lines.push(`- edge ${id}`);
  for (const id of d.edges.changed) lines.push(`~ edge ${id} changed`);
  return lines;
}

/** A migrate report as text lines. */
export function reportLines(r: MigrateReport): string[] {
  const j = r.journeys;
  return [
    `funnels: ${r.funnels.length ? r.funnels.join(", ") : "none"}`,
    `shape: ${r.shape}`,
    `journeys: ${j.moved} placed, ${j.unplaced} left, ${j.duplicates} duplicates dropped (open ${j.open}, done ${j.done}, dropped ${j.dropped})`,
    `deals: ${r.deals} set on an offer node`,
    ...r.notes.map((n) => `note: ${n}`),
  ];
}

/** The fields `add-node` takes. */
export interface NodeOptions {
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
  const { withDb, withMainDb, onDatabase } = deps;
  const shape = program
    .command("shape")
    .description("the business shape: sources, steps, offers and plans, and the edges between");

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
        return shapeLines(v, v.depths, await openNowOf(db));
      });
      if (!out) {
        console.log(o.version ? `no version ${o.version}` : "no shape yet");
        return;
      }
      for (const line of out) console.log(line);
    });

  shape
    .command("versions")
    .description("Every version: number, day, who and why")
    .action(async () => {
      const all = await withDb((db) => shapeVersionsOf(db));
      for (const v of all)
        console.log(`v${v.number}  ${day(v.createdAt)}  ${v.createdBy}  ${v.note}`);
      if (!all.length) console.log("no shape yet");
    });

  shape
    .command("diff <a> <b>")
    .description("What changed from version a to version b")
    .action(async (a: string, b: string) => {
      const [na, nb] = [versionArg(a), versionArg(b)];
      const all = await withDb((db) => shapeVersionsOf(db));
      const [va, vb] = [all.find((v) => v.number === na), all.find((v) => v.number === nb)];
      if (!va || !vb) throw new Error(`no version ${!va ? na : nb}`);
      const lines = diffLines(diffShapes(va.body, vb.body));
      for (const line of lines.length ? lines : ["no difference"]) console.log(line);
    });

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
    .command("import <file>")
    .description("Save a shape file as the next version, with the terms it lists")
    .option("--note <why>", "why, when the file has no note")
    .action((file: string, o: { note?: string }) =>
      plain(async () => {
        const text = readFileSync(file, "utf8");
        const r = await withDb((db) =>
          importShape(db, text, {
            by: who(),
            triggers: TRIGGER_IDS,
            ...(o.note ? { note: o.note } : {}),
          }),
        );
        for (const t of r.terms) console.log(`terms ${t.offer} ${t.plan} from ${t.effectiveFrom}`);
        console.log(r.shape ? `v${r.shape.number} saved` : "no change");
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
          const v = await withDb((db) =>
            editShape(db, {
              change: (body) => withNode(body, node, edges),
              note: o.note,
              by: who(),
              triggers: TRIGGER_IDS,
            }),
          );
          console.log(`v${v.number} saved`);
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
          const v = await withDb((db) =>
            editShape(db, {
              change: (body) => withEdge(body, edge),
              note: o.note,
              by: who(),
              triggers: TRIGGER_IDS,
            }),
          );
          console.log(`v${v.number} saved`);
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
        const v = await withDb(async (db) => {
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
      }),
    );

  addMove(shape, deps.writes);

  shape
    .command("migrate")
    .description(
      "Build shape v1 from the old funnels and place every journey on it. Safe to repeat. Runs on deploy",
    )
    .option("--dry", "write nothing; print the plan")
    .option("--all", "main and every client database")
    .action(async (o: { dry?: boolean; all?: boolean }) => {
      const client = deps.client();
      if (o.all && client) throw new Error("--all or --client, not both");
      const run = (db: Db) =>
        migrateShape(db, { triggers: TRIGGER_IDS, ...(o.dry ? { dry: true } : {}) });
      const targets: Array<[string, () => Promise<MigrateReport>]> = [];
      if (o.all) {
        targets.push(["main", () => withMainDb(run)]);
        for (const database of await deps.databases())
          targets.push([database, () => onDatabase(database, run)]);
      } else if (client) {
        const database = await deps.databaseOf(client);
        targets.push([client, () => onDatabase(database, run)]);
      } else targets.push(["main", () => withMainDb(run)]);
      for (const [name, go] of targets) {
        const report = await go();
        console.log(`${name}${o.dry ? " (dry run)" : ""}`);
        for (const line of reportLines(report)) console.log(`  ${line}`);
      }
    });
}
