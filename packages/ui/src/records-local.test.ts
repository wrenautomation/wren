import { describe, expect, it } from "vitest";
import { fakeRecords, LEAD_ACTIONS, LEAD_META } from "./fixtures/records.js";
import { localRecords } from "./records-local.js";

const APPROVE = LEAD_ACTIONS[0] as (typeof LEAD_ACTIONS)[number];
/** A server that never changes: the demo's. */
const server = fakeRecords();
const ids = async (api: ReturnType<typeof localRecords>["api"], view: string) =>
  (await api.list({ record: LEAD_META.id, view })).rows.map((r) => r.id);

describe("localRecords", () => {
  it("moves an approved row between views, and undo moves it back", async () => {
    const { api, callFor } = localRecords(server);
    const call = callFor(LEAD_META.id, [APPROVE]);
    const waiting = await ids(api, "waiting");
    const approved = await ids(api, "approved");
    expect(waiting).toContain(1);

    expect(await call("demo/approve", { ids: [1] })).toEqual({ done: [1], skipped: [] });
    const left = await api.list({ record: LEAD_META.id, view: "waiting" });
    expect(left.rows.map((r) => r.id)).toEqual(waiting.filter((id) => id !== 1));
    expect(left.counts).toEqual({
      waiting: waiting.length - 1,
      approved: approved.length + 1,
      all: 14,
    });
    expect((await ids(api, "approved")).sort()).toEqual([1, ...approved].sort());
    expect((await api.get({ record: LEAD_META.id, id: "1" })).row.state).toBe("approved");

    // Already approved: nothing to do.
    expect(await call("demo/approve", { ids: [1] })).toEqual({ done: [], skipped: [1] });
    expect(await call("demo/unapprove", { ids: [1] })).toEqual({ done: [1], skipped: [] });
    expect(await ids(api, "waiting")).toEqual(waiting);
    const back = await api.list({ record: LEAD_META.id, view: "waiting" });
    expect(back.counts).toEqual({ waiting: waiting.length, approved: approved.length, all: 14 });
  });

  it("refuses a handler the page doesn't declare", async () => {
    const { callFor } = localRecords(server);
    await expect(callFor(LEAD_META.id, [APPROVE])("x/send", { ids: [1] })).rejects.toThrow();
  });
});
