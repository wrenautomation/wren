import { afterEach, describe, expect, it, vi } from "vitest";
import { pacedWakes, startWakes, wakeTarget } from "./wake.js";

const h = vi.hoisted(() => ({
  handlers: new Map<string, Record<string, (payload: string) => void>>(),
  told: [] as Array<{ topics: readonly string[]; client: string | null }>,
}));
vi.mock("@wren/db", () => ({
  createDb: () => ({ db: {}, close: async () => {} }),
  listen: async (url: string, on: Record<string, (payload: string) => void>) => {
    h.handlers.set(url, on);
    return { close: async () => {} };
  },
}));
vi.mock("@wren/core/clients", () => ({
  listClients: async () => [{ id: "acme" }],
  clientUrl: () => "pg://acme",
}));
vi.mock("@wren/core/live", () => ({
  tellLive: async (topics: readonly string[], o: { client: string | null }) => {
    h.told.push({ topics, client: o.client });
    return true;
  },
}));

describe("wakeTarget", () => {
  it("keys a notice to its database's owner", () => {
    expect(wakeTarget("SmsSend/fleet", null)).toEqual({ service: "SmsSend", key: "fleet" });
    expect(wakeTarget("ReachSend/fleet", "acme")).toEqual({
      service: "ReachSend",
      key: "acme/fleet",
    });
    expect(wakeTarget("TouchToJourney/all", "acme")).toEqual({
      service: "TouchToJourney",
      key: "all",
    });
  });

  it("refuses anything else", () => {
    for (const p of ["", "SmsSend", "SmsSend/", "/fleet", "Sms Sender/fleet", "A/b/c", "A/b?x"])
      expect(wakeTarget(p, null)).toBeNull();
  });
});

describe("pacedWakes", () => {
  afterEach(() => vi.useRealTimers());

  it("folds a burst into one wake, then spaces the next", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const p = pacedWakes((s, k) => sent.push(`${s}/${k}`), { settleMs: 1000, spaceMs: 15_000 });
    p.wake("SegmentPass", "fleet");
    p.wake("SegmentPass", "fleet");
    p.wake("SmsSend", "fleet");
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["SegmentPass/fleet", "SmsSend/fleet"]);
    // A row a second: the second wake waits out the space, and the notices meanwhile are it.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      p.wake("SegmentPass", "fleet");
    }
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(15_000);
    expect(sent).toEqual(["SegmentPass/fleet", "SmsSend/fleet", "SegmentPass/fleet"]);
    // Quiet past the space: the next notice goes after the settle alone.
    vi.advanceTimersByTime(20_000);
    p.wake("SegmentPass", "fleet");
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(4);
    p.close();
  });
});

describe("startWakes", () => {
  afterEach(() => vi.useRealTimers());

  it("relays aerie writes as live topic aerie, from Wren's database only", async () => {
    vi.useFakeTimers();
    const log = { info: () => {}, warn: () => {} } as unknown as Parameters<
      typeof startWakes
    >[0]["log"];
    const w = await startWakes({ databaseUrl: "pg://wren", ingress: { url: "http://x" }, log });
    expect(Object.keys(h.handlers.get("pg://wren") ?? {})).toContain("aerie");
    expect(Object.keys(h.handlers.get("pg://acme") ?? {})).not.toContain("aerie");
    h.handlers.get("pg://wren")?.aerie?.("task");
    h.handlers.get("pg://wren")?.aerie?.("task_area");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.told).toEqual([{ topics: ["aerie"], client: null }]);
    await w.close();
  });
});
