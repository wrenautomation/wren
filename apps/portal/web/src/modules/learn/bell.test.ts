import { describe, expect, it } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });

const { BellReads } = await import("./bell.js");

const read = (unseen: number) =>
  ({
    unseen,
    alerts: [{ id: 1, seen: unseen === 0 }],
  }) as never;

describe("BellReads: a cleared badge stays clear", () => {
  it("a read that left before seen answered counts nothing new", () => {
    const r = new BellReads();
    const before = r.leave();
    const answered = r.seen();
    // It lands while seen is out, then after it answered: both count 0.
    expect(r.land(before, read(3))).toMatchObject({ unseen: 0, alerts: [{ seen: true }] });
    answered(true);
    expect(r.land(before, read(3))).toMatchObject({ unseen: 0 });
    const after = r.leave();
    expect(r.land(after, read(1))).toMatchObject({ unseen: 1 });
  });

  it("an older read that lands after a newer one is dropped", () => {
    const r = new BellReads();
    const a = r.leave();
    const b = r.leave();
    expect(r.land(b, read(2))).toMatchObject({ unseen: 2 });
    expect(r.land(a, read(5))).toBeNull();
  });

  it("a seen that failed lets the next read count again", () => {
    const r = new BellReads();
    const answered = r.seen();
    answered(false);
    expect(r.land(r.leave(), read(4))).toMatchObject({ unseen: 4 });
  });
});
