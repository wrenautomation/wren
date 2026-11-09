import { describe, expect, it } from "vitest";
import type { Loaded, Writes } from "./turn.js";
import { fromWire, toWire } from "./wire.js";

const bytes = (s: string) => Buffer.from(s);

describe("wire", () => {
  it("keeps bytes, maps with number keys, sets, dates and pg infinity", () => {
    const loaded: Loaded = {
      inv: {
        id: "inv_1",
        service: "S",
        handler: "h",
        key: null,
        input: bytes('{"a":1}'),
        // a header that looks like a tag stays a header
        headers: { __rtw: "x", "x-a": "b" },
        attempt: 2,
        failures: 1,
        cancel: false,
        parent_id: null,
        parent_seq: null,
        caller_waits: true,
      },
      journal: [
        {
          seq: 0,
          kind: "run",
          name: "a",
          done: true,
          value: new Uint8Array([0, 255, 7]),
          error: null,
          wake_at: new Date("2026-11-09T12:00:00.123Z"),
          ref: null,
          tries: 0,
          first_at: null,
        },
        {
          seq: 1,
          kind: "sleep",
          name: "",
          done: false,
          value: null,
          error: { message: "m", code: 409, metadata: { __rtw: "y" } },
          wake_at: new Date(Number.NaN),
          ref: "r",
          tries: 3,
          first_at: new Date(0),
        },
      ],
      state: new Map([["k", bytes("v")]]),
      awakeables: new Map([[4, { value: bytes(""), error: null }]]),
    };
    const back = fromWire<Loaded>(toWire(loaded));
    expect(back.inv).toEqual({ ...loaded.inv, input: bytes('{"a":1}') });
    expect([...(back.journal[0]?.value ?? [])]).toEqual([0, 255, 7]);
    expect(back.journal[0]?.wake_at?.toISOString()).toBe("2026-11-09T12:00:00.123Z");
    expect(Number.isNaN(back.journal[1]?.wake_at?.getTime())).toBe(true);
    expect(back.journal[1]?.first_at?.getTime()).toBe(0);
    expect(back.journal[1]?.error).toEqual(loaded.journal[1]?.error);
    expect(back.state.get("k")?.toString()).toBe("v");
    expect([...back.awakeables.keys()]).toEqual([4]);
    expect(back.awakeables.get(4)?.value?.length).toBe(0);
  });

  it("keeps a slice of a bigger buffer as just the slice", () => {
    const pool = Buffer.from("0123456789");
    const w: Pick<Writes, "sets" | "clears"> = {
      sets: new Map([["s", pool.subarray(2, 5)]]),
      clears: new Set(["a", "b"]),
    };
    const back = fromWire<typeof w>(toWire(w));
    expect(back.sets.get("s")?.toString()).toBe("234");
    expect([...back.clears]).toEqual(["a", "b"]);
  });

  it("refuses an unknown tag", () => {
    expect(() => fromWire('{"__rtw":["q",1]}')).toThrow(/unknown tag/);
  });
});
