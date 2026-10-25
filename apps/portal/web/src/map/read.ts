/**
 * The Map's reads (designs/2026-10-19-business-map.md, "Map page"): the newest shape with its
 * versions, the window's numbers per station, track and line, the open journeys, and the ghosts (a
 * journey on a node the newest version dropped). One hook; the page draws what it returns (`model.ts`).
 */
import type { Cell } from "@wren/core/records";
import type { RecordAnswer, RecordsPage, Row } from "@wren/core/records/serve";
import type {
  BlameAnswer,
  BlameAsk,
  BlameLine,
  DiffAnswer,
  DraftDetail,
  DraftRow,
  DraftState,
  ShapeRef,
} from "@wren/pipeline/history";
import type { MapAnswer } from "@wren/pipeline/map-read";
import type { NumberRow } from "@wren/pipeline/numbers";
import { call } from "../api.js";
import { readCall, useCall } from "../load.js";
import { atOf } from "../modules/deals/board.js";
import {
  DEFAULT_WINDOW,
  type Ghost,
  type MapData,
  type NodeNumbers,
  type Sum,
  type Version,
  type Window,
} from "./model.js";

const DRAFT = "pipeline.shape_draft";
/** Rows one read takes (the server's cap), and how many reads one list makes at most. */
const PAGE = 200;
const PAGES = 5;

const text = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const count = (v: Cell | undefined): number | null =>
  typeof v === "number" ? v : v == null || v === "" ? null : Number(v);

const sum = (cents: number | null, currency: string | null): Sum | null =>
  cents == null ? null : { amount: cents, currency: currency ?? "USD" };

const rowNumbers = (r: NumberRow): NodeNumbers => ({
  id: r.label,
  now: r.now,
  arrived: r.arrived,
  left: r.left,
  medianDays: r.medianDays,
  opened: r.opened,
  deals: r.deals,
  collected: sum(r.collected, r.currency),
  scheduled: sum(r.scheduled, r.currency),
});

/** The line rows by line id. An offer line has one row for each currency, so a line holds a list. */
function linesOf(rows: NumberRow[]): Map<string, NodeNumbers[]> {
  const by = new Map<string, NodeNumbers[]>();
  for (const r of rows) {
    const n = rowNumbers(r);
    by.set(n.id, [...(by.get(n.id) ?? []), n]);
  }
  return by;
}

/** Every row of a list, up to the caps. */
async function listAll(at: Record<string, string>, ask: Record<string, unknown>): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const page = await call<RecordsPage>("pipeline/recordsList", {
      ...at,
      ...ask,
      limit: PAGE,
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...page.rows);
    if (!page.next) break;
    cursor = page.next;
  }
  return rows;
}

/** What a read gives: the Map, or none when the workspace has no shape yet (a plain answer, not an error). */
interface MapRead {
  map: MapData | null;
}

/**
 * The shape, its numbers for `window`, who is where, and the ghosts, in one call
 * (`pipeline/mapRead`). Six calls at once woke up to five cold Lambdas, about 3.7 s each.
 */
export async function readMap(client: string, window: Window): Promise<MapRead> {
  const got = await call<MapAnswer>("pipeline/mapRead", { ...atOf(client), window });
  if (!got.shape) return { map: null };
  const of = (kind: NumberRow["kind"]) => got.numbers.filter((n) => n.kind === kind);
  const held = new Map<string, Ghost>();
  for (const p of got.ghosts) {
    const g = held.get(p.node) ?? { id: p.node, name: p.nodeName, people: [] };
    g.people.push(p);
    held.set(p.node, g);
  }
  return {
    map: {
      body: got.shape.body,
      metro: got.shape.metro,
      drawErrors: got.shape.drawErrors,
      depths: got.shape.depths,
      versions: got.shape.versions as Version[],
      // A numbers row's `label` is the shape's own id. The hub has a station row: its `now` is the leads.
      stations: new Map(
        of("station")
          .map(rowNumbers)
          .map((n) => [n.id, n]),
      ),
      tracks: new Map(of("track").map((r) => [r.label, r.crossings ?? 0])),
      lines: linesOf(of("line")),
      people: got.people,
      ghosts: [...held.values()],
    },
  };
}

const mapKey = (client: string, window: Window) => `map:${client}:${window}`;

/** The Map's read: one per workspace and window. */
export function useMap(client: string, window: Window) {
  return useCall(mapKey(client, window), () => readMap(client, window));
}

/**
 * Read the Map in the background when the portal opens, under the key the Map page reads by:
 * the page then finds it ready, and a cold Lambda starts while the viewer is on another page.
 */
export const prefetchMap = (client: string, window: Window = DEFAULT_WINDOW): Promise<unknown> =>
  readCall(mapKey(client, window), () => readMap(client, window)).catch(() => undefined);

// --- drafts, blame, differences: one hook per job, every card shares them -----------------------

/** The `pipeline.shape_draft` views a card lists: open (the default), waiting on a decision, all. */
export type DraftView = "open" | "proposed" | "all";

const orNull = (v: Cell | undefined): string | null => (v == null || v === "" ? null : String(v));

/** A `pipeline.shape_draft` row as the contract's `DraftRow`. */
const draftRowOf = (r: Row): DraftRow => ({
  id: String(r.id),
  name: text(r.name) ?? String(r.id),
  state: String(r.state) as DraftState,
  base: Number(r.base ?? 0),
  note: text(r.note) ?? "",
  createdBy: text(r.createdBy) ?? "",
  createdAt: text(r.createdAt) ?? "",
  updatedAt: text(r.updatedAt) ?? "",
  appliedVersion: count(r.appliedVersion),
  decidedBy: orNull(r.decidedBy),
  decidedAt: orNull(r.decidedAt),
  dropReason: orNull(r.dropReason),
});

const keyOf = (at: Record<string, string>, ...rest: (string | number)[]) =>
  [JSON.stringify(at), ...rest].join(":");

/** The workspace's drafts in `view`, newest first; none read while `on` is false. */
export function useDrafts(at: Record<string, string>, view: DraftView, on = true) {
  return useCall<DraftRow[]>(on ? `map-drafts:${keyOf(at, view)}` : null, async () =>
    (await listAll(at, { record: DRAFT, view })).map(draftRowOf),
  );
}

/** One draft: its row and its body and moves; none read while `id` is null. */
export function useDraftDetail(at: Record<string, string>, id: string | null) {
  return useCall<{ row: DraftRow; detail: DraftDetail }>(
    id ? `map-draft:${keyOf(at, id)}` : null,
    async () => {
      const got = await call<RecordAnswer>("pipeline/recordsGet", { ...at, record: DRAFT, id });
      return { row: draftRowOf(got.row), detail: got.detail as unknown as DraftDetail };
    },
  );
}

/** How many shape proposals wait on a decision (Today's line); a count only, one row asked for. */
export function useProposals(at: Record<string, string>, on = true) {
  return useCall<number>(on ? `map-proposals:${keyOf(at)}` : null, async () => {
    const page = await call<RecordsPage>("pipeline/recordsList", {
      ...at,
      record: DRAFT,
      view: "proposed",
      limit: 1,
    });
    return page.total;
  });
}

/** The kinds a blame ask names: exactly one is set. */
const BLAME_KINDS = ["station", "track", "line", "group", "node", "edge"] as const;

/** The versions that touched one station, track, line or group, newest first; none read while `ask` is null. */
export function useBlame(at: Record<string, string>, ask: BlameAsk | null) {
  const kind = ask ? BLAME_KINDS.find((k) => ask[k]) : undefined;
  const which = ask && kind ? `${kind}:${ask[kind]}` : null;
  return useCall<BlameLine[]>(which ? `map-blame:${keyOf(at, which)}` : null, async () => {
    const got = await call<BlameAnswer>("pipeline/shapeBlame", { ...at, ...ask });
    return got.lines;
  });
}

/** The difference of two sides (versions or drafts), read when both are named. */
export function useDiffOf(at: Record<string, string>, a: ShapeRef | null, b: ShapeRef | null) {
  return useCall<DiffAnswer>(a !== null && b !== null ? `map-diff:${keyOf(at, a, b)}` : null, () =>
    call<DiffAnswer>("pipeline/shapeDiff", { ...at, a, b }),
  );
}
