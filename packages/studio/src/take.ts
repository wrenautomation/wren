/**
 * A filmed take (designs/2026-10-24-filmed-takes.md): the folder `autobrowse film` writes. Each
 * pane is an mp4 and a json of every pointer move, click and key on its clock (autobrowse
 * `designs/2026-10-24-film.md`). Here: read and check it, and cut one shot from it, in seconds.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const point = { t: z.number(), x: z.number(), y: z.number() };
const paneEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["move", "down", "up"]), ...point }),
  z.object({ kind: z.literal("key"), t: z.number(), key: z.string() }),
  z.object({ kind: z.literal("scroll"), t: z.number(), dy: z.number() }),
  z.object({
    kind: z.literal("focus"),
    t: z.number(),
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  }),
  z.object({ kind: z.literal("load"), t: z.number(), url: z.string() }),
]);
export type PaneEvent = z.infer<typeof paneEvent>;

/** One pane as autobrowse writes it: `start`, `end` epoch ms; event `t` ms from `start`. */
const takePane = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  kind: z.enum(["web", "term"]),
  start: z.number(),
  end: z.number(),
  /** CSS px of the page; event points are in these. */
  size: z.tuple([z.number().positive(), z.number().positive()]),
  scale: z.number().positive(),
  events: z.array(paneEvent),
});
export type TakePane = z.infer<typeof takePane>;

const takeFile = z.object({
  version: z.literal(1),
  tape: z.string().optional(),
  size: z.tuple([z.number(), z.number()]).optional(),
  panes: z.array(z.string().min(1)).min(1),
});

export interface Take {
  /** The folder, as the script names it (beside the script). */
  dir: string;
  panes: Record<string, TakePane>;
  /** Pane names in the order they opened. */
  order: string[];
}

/** Read the take in `dir` (`root`: the script's folder). Every pane needs its json and mp4. */
export async function readTake(root: string, dir: string): Promise<Take> {
  const at = join(root, dir);
  const raw = await readFile(join(at, "take.json"), "utf8").catch(() => {
    throw new Error(`take ${dir}: no take.json (film it with autobrowse film)`);
  });
  const head = takeFile.parse(JSON.parse(raw));
  const panes: Record<string, TakePane> = {};
  for (const name of head.panes) {
    const pane = takePane.parse(JSON.parse(await readFile(join(at, `${name}.json`), "utf8")));
    if (!existsSync(join(at, pane.file))) throw new Error(`take ${dir}: ${pane.file} is missing`);
    panes[name] = pane;
  }
  return { dir, panes, order: head.panes };
}

/** A pane's length in seconds. */
export const paneSeconds = (p: Pick<TakePane, "start" | "end">) => (p.end - p.start) / 1000;

/**
 * The pane a shot shows: as named, else the first web pane, else the first. A name the take does
 * not have throws, with the names it has.
 */
export function paneOf(take: Take, name?: string): TakePane {
  const pick = name ?? take.order.find((n) => take.panes[n]?.kind === "web") ?? take.order[0];
  const pane = pick ? take.panes[pick] : undefined;
  if (!pane) throw new Error(`take ${take.dir}: no pane ${pick}; it has ${take.order.join(", ")}`);
  return pane;
}

/**
 * A pane's events from `from` to `to` (seconds on it), with `t` in seconds from `from`. `lead`:
 * seconds before `from` kept too, so a cursor or a zoom already under way at the cut carries on.
 */
export function eventsIn(pane: TakePane, from: number, to: number, lead = 0): PaneEvent[] {
  return pane.events
    .map((e) => ({ ...e, t: e.t / 1000 - from }))
    .filter((e) => e.t >= -lead && e.t <= to - from);
}

/** Seconds into `other` at second `from` of `pane`: both are on one epoch clock. Below 0: not open yet. */
export const besideAt = (pane: TakePane, other: TakePane, from: number) =>
  from + (pane.start - other.start) / 1000;
