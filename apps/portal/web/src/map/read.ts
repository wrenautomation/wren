/**
 * The Map's reads (designs/2026-10-19-business-map.md, "Map page"): the newest shape with its
 * versions, the window's numbers per node, edge and offer, the open journeys, and the ghosts (a
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
import type { MetroBody } from "@wren/pipeline/metro";
import type { ShapeBody } from "@wren/pipeline/model";
import { call } from "../api.js";
import { useCall } from "../load.js";
import { atOf } from "../modules/deals/board.js";
import type { Ghost, MapData, NodeNumbers, Person, Sum, Version, Window } from "./model.js";

const SHAPE = "pipeline.shape";
const NUMBER = "pipeline.number";
const JOURNEY = "pipeline.journey";
const DRAFT = "pipeline.shape_draft";
/** Rows one read takes (the server's cap), and how many reads one list makes at most. */
const PAGE = 200;
const PAGES = 5;

const text = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const count = (v: Cell | undefined): number | null =>
  typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
const sumOf = (v: Cell | undefined): Sum | null => {
  if (v && typeof v === "object" && "amount" in v)
    return { amount: Number(v.amount), currency: String(v.currency) };
  return null;
};

const personOf = (r: Row): Person => ({
  id: String(r.id),
  name: text(r.name) ?? String(r.id),
  node: text(r.node) ?? "",
  nodeName: text(r.nodeName) ?? text(r.node) ?? "",
  movedAt: text(r.movedAt),
  daysAtNode: Number(r.daysAtNode ?? 0),
});

const numbersOf = (r: Row): NodeNumbers => ({
  id: String(r.node ?? r.id),
  now: count(r.now),
  arrived: count(r.arrived),
  left: count(r.left),
  medianDays: count(r.medianDays),
  opened: count(r.opened),
  deals: count(r.deals),
  collected: sumOf(r.collected),
  scheduled: sumOf(r.scheduled),
});

/** Every row of a list, up to the caps. */
export async function listAll(
  at: Record<string, string>,
  ask: Record<string, unknown>,
): Promise<Row[]> {
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
export interface MapRead {
  map: MapData | null;
}

/** The shape, its numbers for `window`, who is where, and the ghosts. */
export async function readMap(client: string, window: Window): Promise<MapRead> {
  const at = atOf(client);
  const got = await call<RecordAnswer>("pipeline/recordsGet", {
    ...at,
    record: SHAPE,
    id: "shape",
  });
  const detail = got.detail as {
    body?: ShapeBody;
    metro?: MetroBody | null;
    /** From the server once D1 lands; read as empty until then. */
    drawErrors?: string[];
    depths?: Record<string, number>;
    versions?: Version[];
  } | null;
  if (!detail?.body) return { map: null };
  const per = (kind: string) => listAll(at, { record: NUMBER, where: { kind, window } });
  const [nodes, edges, open, ghosts] = await Promise.all([
    per("node"),
    per("edge"),
    listAll(at, { record: JOURNEY, where: { status: "open" }, sort: "-movedAt" }),
    listAll(at, { record: JOURNEY, view: "ghost" }),
  ]);
  const people = open.map(personOf);
  const held = new Map<string, Ghost>();
  for (const p of ghosts.map(personOf)) {
    const g = held.get(p.node) ?? { id: p.node, name: p.nodeName, people: [] };
    g.people.push(p);
    held.set(p.node, g);
  }
  return {
    map: {
      body: detail.body,
      metro: detail.metro ?? null,
      drawErrors: detail.drawErrors ?? [],
      depths: detail.depths ?? {},
      versions: detail.versions ?? [],
      nodes: new Map(nodes.map(numbersOf).map((n) => [n.id, n])),
      // A numbers row's `node` is the shape's own id; its row id carries the window too.
      edges: new Map(edges.map((r) => [String(r.node), count(r.crossings) ?? 0])),
      people,
      ghosts: [...held.values()],
    },
  };
}

/** The Map's read: one per workspace and window. */
export function useMap(client: string, window: Window) {
  return useCall(`map:${client}:${window}`, () => readMap(client, window));
}

// --- drafts, blame, differences: one hook per job, every card shares them -----------------------

/** The `pipeline.shape_draft` views a card lists: open (the default), waiting on a decision, all. */
export type DraftView = "open" | "proposed" | "all";

const orNull = (v: Cell | undefined): string | null => (v == null || v === "" ? null : String(v));

/** A `pipeline.shape_draft` row as the contract's `DraftRow`. */
export const draftRowOf = (r: Row): DraftRow => ({
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

/** The versions that touched one node or one line, newest first; none read while `ask` is null. */
export function useBlame(at: Record<string, string>, ask: BlameAsk | null) {
  const which = ask?.node ? `node:${ask.node}` : ask?.edge ? `edge:${ask.edge}` : null;
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
