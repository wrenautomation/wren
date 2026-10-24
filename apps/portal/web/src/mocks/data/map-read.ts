/**
 * `pipeline/mapRead` from a story's record answers: the shape's detail, the window's number rows
 * and the open journeys, as the server's `mapAnswerOf` gives them. Every map story keeps its record
 * answers and gets the one-call read for free.
 */
import type { MapAnswer, MapPerson } from "@wren/pipeline/map-read";
import type { NumberRow } from "@wren/pipeline/numbers";

type Ask = (path: string, body: Record<string, unknown>) => unknown;
type Row = Record<string, unknown>;

const rowsOf = (ask: Ask, body: Record<string, unknown>): Row[] =>
  (ask("pipeline/recordsList", { ...body, limit: 200 }) as { rows?: Row[] } | null)?.rows ?? [];

const numberOf = (r: Row, kind: NumberRow["kind"]): NumberRow => {
  const money = (v: unknown) => (v && typeof v === "object" ? (v as { amount: number }) : null);
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    id: String(r.id),
    kind,
    label: String(r.node ?? r.id),
    name: String(r.label ?? r.node ?? r.id),
    position: 0,
    nodeKind: null,
    arrived: n(r.arrived),
    skipped: null,
    left: n(r.left),
    now: n(r.now),
    medianDays: n(r.medianDays),
    reach: null,
    steps: null,
    mark: null,
    crossings: n(r.crossings),
    from: null,
    to: null,
    opened: n(r.opened),
    deals: n(r.deals),
    collected: money(r.collected)?.amount ?? null,
    scheduled: money(r.scheduled)?.amount ?? null,
    cost: null,
    currency:
      ((money(r.collected) ?? money(r.scheduled)) as { currency?: string } | null)?.currency ??
      null,
    last: null,
  };
};

const personOf = (r: Row): MapPerson => ({
  id: String(r.id),
  name: String(r.name ?? r.id),
  node: String(r.node ?? ""),
  nodeName: String(r.nodeName ?? r.node ?? ""),
  movedAt: r.movedAt == null ? null : String(r.movedAt),
  daysAtNode: Number(r.daysAtNode ?? 0),
});

export function mapReadOf(ask: Ask, body: Record<string, unknown>): MapAnswer {
  const at = { client: body.client };
  const got = ask("pipeline/recordsGet", { ...at, record: "pipeline.shape", id: "shape" }) as {
    detail?: MapAnswer["shape"];
  } | null;
  const d = got?.detail;
  if (!d?.body) return { shape: null, numbers: [], people: [], ghosts: [] };
  const per = (kind: "station" | "track" | "line") =>
    rowsOf(ask, { ...at, record: "pipeline.number", where: { kind, window: body.window } }).map(
      (r) => numberOf(r, kind),
    );
  return {
    shape: {
      body: d.body,
      depths: d.depths ?? {},
      metro: d.metro ?? null,
      drawErrors: d.drawErrors ?? [],
      versions: d.versions ?? [],
    },
    numbers: [...per("station"), ...per("track"), ...per("line")],
    people: rowsOf(ask, {
      ...at,
      record: "pipeline.journey",
      where: { status: "open" },
      sort: "-movedAt",
    }).map(personOf),
    ghosts: rowsOf(ask, { ...at, record: "pipeline.journey", view: "ghost" }).map(personOf),
  };
}
