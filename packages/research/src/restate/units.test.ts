import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { unitBatches } from "./units.js";

/** A ctx whose `run` just runs: a lone unit throwing a TerminalError fails at once, as Restate would. */
function fakeCtx() {
  const steps: string[] = [];
  const ctx = {
    run: async (name: string, fn: () => Promise<unknown>) => {
      steps.push(name);
      return fn();
    },
  } as unknown as Pick<restate.Context, "run">;
  return { ctx, steps };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const r of gen) out.push(r);
  return out;
}

describe("unitBatches", () => {
  it("journals 45 units as 3 steps, in order", async () => {
    const { ctx, steps } = fakeCtx();
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    const out = await collect(unitBatches(ctx, "crawl company", ids, async (id) => id * 2));
    expect(steps).toEqual(["crawl company 1 +19", "crawl company 21 +19", "crawl company 41 +4"]);
    expect(out.map((r) => (r.ok ? r.value : null))).toEqual(ids.map((id) => id * 2));
  });

  it("keeps the units before a failure, runs the failing one alone, then goes on", async () => {
    const { ctx, steps } = fakeCtx();
    let tries = 0;
    const out = await collect(
      unitBatches(ctx, "u", [1, 2, 3, 4], async (id) => {
        if (id === 2 && tries++ === 0) throw new Error("flaky");
        return id;
      }),
    );
    expect(steps).toEqual(["u 1 +3", "u 2", "u 3 +1"]);
    expect(out).toEqual([
      { id: 1, ok: true, value: 1 },
      { id: 2, ok: true, value: 2 },
      { id: 3, ok: true, value: 3 },
      { id: 4, ok: true, value: 4 },
    ]);
  });

  it("yields a unit out of retries as not ok, and a consumer may stop there", async () => {
    const { ctx, steps } = fakeCtx();
    const seen: number[] = [];
    for await (const r of unitBatches(ctx, "u", [1, 2, 3], async (id) => {
      if (id === 2) throw new restate.TerminalError("gone");
      return id;
    })) {
      if (!r.ok) {
        expect(r.reason).toBe("gone");
        break;
      }
      seen.push(r.value);
    }
    expect(seen).toEqual([1]);
    expect(steps).toEqual(["u 1 +2", "u 2"]);
  });

  it("perRun 1 is one step per unit, named as before", async () => {
    const { ctx, steps } = fakeCtx();
    await collect(unitBatches(ctx, "pick company", [7, 8], async (id) => id, { perRun: 1 }));
    expect(steps).toEqual(["pick company 7", "pick company 8"]);
  });
});
