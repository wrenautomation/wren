import { describe, expect, it } from "vitest";
import {
  changedOnly,
  KNOWN_MAX,
  knownIn,
  knownOf,
  mergeChanged,
  rowHash,
} from "./records-delta.js";
import type { RecordsPage, Row } from "./records-serve.js";

const page = (rows: Row[]): RecordsPage =>
  ({
    record: "deals",
    view: null,
    rows,
    total: rows.length,
    counts: {},
    next: null,
    totals: {},
  }) as unknown as RecordsPage;

const a = { id: 1, name: "Acme", stage: "new" } as unknown as Row;
const b = { id: 2, name: "Bolt", stage: "won" } as unknown as Row;

describe("rowHash", () => {
  it("is the same for the same row whatever its key order, and moves with any value", () => {
    const flipped = { stage: "new", name: "Acme", id: 1 } as unknown as Row;
    expect(rowHash(flipped)).toBe(rowHash(a));
    expect(rowHash({ ...a, stage: "won" } as Row)).not.toBe(rowHash(a));
    expect(rowHash(a)).toMatch(/^[0-9a-z]{6,32}$/);
  });
});

describe("knownIn", () => {
  it("takes hashes only, and nothing past the cap", () => {
    expect(knownIn(undefined)).toBeNull();
    expect(knownIn("x")).toBeNull();
    expect(knownIn(Array(KNOWN_MAX + 1).fill("abcdef12"))).toBeNull();
    expect([...(knownIn(["abcdef12", "DROP TABLE", 4]) ?? [])]).toEqual(["abcdef12"]);
  });
});

describe("change-only reads", () => {
  it("sends every row the first time, with its hash", () => {
    const got = changedOnly(page([a, b]), null);
    expect(got.rows).toEqual([a, b]);
    expect(got.hashes).toEqual([rowHash(a), rowHash(b)]);
    expect(got.same).toBeUndefined();
  });

  it("stubs the rows the tab holds and sends the changed one in full; the tab makes it whole", () => {
    const before = changedOnly(page([a, b]), null);
    const moved = { ...b, stage: "lost" } as Row;
    const got = changedOnly(page([a, moved]), knownIn(knownOf(before)));
    expect(got.same).toEqual([0]);
    expect(got.rows[0]).toEqual({ id: 1 });
    expect(got.rows[1]).toEqual(moved);
    const whole = mergeChanged(got, before);
    expect(whole?.rows).toEqual([a, moved]);
    expect(whole && "same" in whole).toBe(false);
  });

  it("asks for a full read when a stub names a row the tab no longer has", () => {
    const before = changedOnly(page([a, b]), null);
    const got = changedOnly(page([a]), knownIn(knownOf(before)));
    expect(mergeChanged(got, undefined)).toBeNull();
  });
});
