import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AdminQuery,
  boxPort,
  boxUrl,
  isCurrent,
  pinnedTo,
  watchSuperseded,
} from "./box-slot.js";

/** Admin SQL over a fake catalog: which deployment serves each service, and the open calls. */
function admin(serves: Record<string, string>, pinned: Record<string, number> = {}) {
  const seen: string[] = [];
  const query: AdminQuery = async (sql) => {
    seen.push(sql);
    const svc = /FROM sys_service WHERE name = '([\w-]+)'/.exec(sql);
    if (svc) {
      const d = serves[svc[1] as string];
      return d ? [{ deployment_id: d }] : [];
    }
    const pin = /pinned_deployment_id = '([\w-]+)'/.exec(sql);
    if (pin) return [{ n: pinned[pin[1] as string] ?? 0 }];
    throw new Error(`unexpected sql: ${sql}`);
  };
  return { query, seen, serves };
}

afterEach(() => vi.useRealTimers());

describe("boxPort", () => {
  it("is the first slot when unset, as before slots", () => {
    expect(boxPort({})).toBe(9080);
    expect(boxPort({ WREN_BOX_PORT: "" })).toBe(9080);
  });

  it("takes either slot and refuses any other port", () => {
    expect(boxPort({ WREN_BOX_PORT: "9081" })).toBe(9081);
    expect(() => boxPort({ WREN_BOX_PORT: "9082" })).toThrow(/9080, 9081/);
    expect(() => boxPort({ WREN_BOX_PORT: "x" })).toThrow();
  });

  it("gives each slot its own deployment URL", () => {
    expect(boxUrl(9080)).not.toBe(boxUrl(9081));
    expect(boxUrl(9081)).toBe("http://127.0.0.1:9081/");
  });
});

describe("isCurrent and pinnedTo", () => {
  it("is current while the service is on this deployment", async () => {
    const a = admin({ SocialWatch: "dp_old" }, { dp_old: 2 });
    expect(await isCurrent(a.query, "dp_old", "SocialWatch")).toBe(true);
    a.serves.SocialWatch = "dp_new";
    expect(await isCurrent(a.query, "dp_old", "SocialWatch")).toBe(false);
    expect(await pinnedTo(a.query, "dp_old")).toBe(2);
  });

  it("puts only plain ids in the SQL", async () => {
    const a = admin({});
    await expect(isCurrent(a.query, "dp_x", "a' OR '1'='1")).rejects.toThrow(/not an id/);
    await expect(pinnedTo(a.query, "dp'; --")).rejects.toThrow(/not an id/);
    expect(a.seen).toEqual([]);
  });
});

describe("watchSuperseded", () => {
  it("stays quiet while current, then calls once when a later build takes over", async () => {
    vi.useFakeTimers();
    const a = admin({ PoolScheduler: "dp_old" }, { dp_old: 1 });
    const onSuperseded = vi.fn();
    const w = watchSuperseded({
      query: a.query,
      deployment: "dp_old",
      service: "PoolScheduler",
      everyMs: 1000,
      onSuperseded,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(onSuperseded).not.toHaveBeenCalled();

    a.serves.PoolScheduler = "dp_new";
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(onSuperseded).toHaveBeenCalledWith(1);

    const checks = a.seen.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(a.seen.length).toBe(checks);
    expect(await w.check()).toBe(true);
    w.stop();
  });

  it("keeps the build current when a check fails", async () => {
    vi.useFakeTimers();
    let up = false;
    const onSuperseded = vi.fn();
    const onError = vi.fn();
    const base = admin({ Books: "dp_new" });
    const query: AdminQuery = async (sql) => {
      if (!up) throw new Error("admin down");
      return base.query(sql);
    };
    watchSuperseded({
      query,
      deployment: "dp_old",
      service: "Books",
      everyMs: 1000,
      onSuperseded,
      onError,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onSuperseded).not.toHaveBeenCalled();
    up = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSuperseded).toHaveBeenCalledWith(0);
  });

  it("stops looking once stopped", async () => {
    vi.useFakeTimers();
    const a = admin({ Watch: "dp_a" });
    const w = watchSuperseded({
      query: a.query,
      deployment: "dp_a",
      service: "Watch",
      everyMs: 1000,
      onSuperseded: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    w.stop();
    const n = a.seen.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.seen.length).toBe(n);
  });
});
