import type { RecordMeta } from "@wren/core/records";
import type { ListAsk, Row } from "@wren/core/records/serve";
import { describe, expect, it } from "vitest";
import type { Action } from "./action.js";
import type { RecordsApi } from "./records.js";
import { localRecords } from "./records-local.js";

const META = {
  id: "t.email",
  views: [
    { id: "approve", label: "To approve", where: { status: ["awaiting"] } },
    { id: "approved", label: "Approved", where: { status: ["approved"] } },
  ],
} as unknown as RecordMeta;

const ROWS: Row[] = [
  { id: 1, status: "awaiting" },
  { id: 2, status: "awaiting" },
  { id: 3, status: "approved" },
];
const views = META.views as unknown as { id: string; where: { status: string[] } }[];
const inView = (ask: ListAsk) => {
  const w = views.find((v) => v.id === ask.view)?.where.status;
  return ROWS.filter((r) => !w || w.includes(String(r.status)));
};

/** A server that never changes: the demo's. */
const server: RecordsApi = {
  types: async () => [META],
  list: async (ask) => {
    const rows = inView(ask);
    const counts = Object.fromEntries(
      views.map((v) => [v.id, inView({ ...ask, view: v.id }).length]),
    );
    return { rows, counts, total: rows.length, next: null } as never;
  },
  get: async (ask) => ({ row: ROWS.find((r) => String(r.id) === ask.id), related: [] }) as never,
  export: async () => ({ csv: "", rows: 0, capped: false }) as never,
};

const APPROVE: Action = {
  id: "approve",
  label: "Approve",
  handler: "x/approve",
  undo: "x/unapprove",
  when: { status: ["awaiting"] },
  sets: { status: "approved" },
};

describe("localRecords", () => {
  it("moves an approved row between views, and undo moves it back", async () => {
    const { api, callFor } = localRecords(server);
    const call = callFor("t.email", [APPROVE]);
    await api.list({ record: "t.email", view: "approve" });

    expect(await call("x/approve", { ids: [1] })).toEqual({ done: [1], skipped: [] });
    const left = await api.list({ record: "t.email", view: "approve" });
    expect(left.rows.map((r) => r.id)).toEqual([2]);
    expect(left.counts).toEqual({ approve: 1, approved: 2 });
    const there = await api.list({ record: "t.email", view: "approved" });
    expect(there.rows.map((r) => r.id).sort()).toEqual([1, 3]);
    expect((await api.get({ record: "t.email", id: "1" })).row.status).toBe("approved");

    // Already approved: nothing to do.
    expect(await call("x/approve", { ids: [1] })).toEqual({ done: [], skipped: [1] });
    expect(await call("x/unapprove", { ids: [1] })).toEqual({ done: [1], skipped: [] });
    const back = await api.list({ record: "t.email", view: "approve" });
    expect(back.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(back.counts).toEqual({ approve: 2, approved: 1 });
  });

  it("refuses a handler the page doesn't declare", async () => {
    const { callFor } = localRecords(server);
    await expect(callFor("t.email", [APPROVE])("x/send", { ids: [1] })).rejects.toThrow();
  });
});
