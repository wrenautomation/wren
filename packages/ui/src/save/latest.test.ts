import { describe, expect, it } from "vitest";
import { Latest } from "./latest.js";

/** A write the test answers by hand. */
function server() {
  const held: { value: unknown; ok: () => void; fail: (e: unknown) => void }[] = [];
  const stored: unknown[] = [];
  const send = (value: unknown) =>
    new Promise<void>((ok, fail) =>
      held.push({
        value,
        ok: () => {
          stored.push(value);
          ok();
        },
        fail,
      }),
    );
  return { held, stored, send };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Latest: the last value set is the last one written", () => {
  it("sends one at a time and skips values a newer one replaced", async () => {
    const w = new Latest();
    const s = server();
    const a = w.write("rail", "a", s.send);
    const b = w.write("rail", "b", s.send);
    const c = w.write("rail", "c", s.send);
    expect(s.held.map((h) => h.value)).toEqual(["a"]);
    expect(await b).toEqual({ status: "replaced" });
    s.held[0]?.ok();
    expect(await a).toEqual({ status: "saved" });
    await settle();
    expect(s.held.map((h) => h.value)).toEqual(["a", "c"]);
    s.held[1]?.ok();
    expect(await c).toEqual({ status: "saved" });
    expect(s.stored).toEqual(["a", "c"]);
    expect(w.busy("rail")).toBe(false);
  });

  it("a slow first write can't land after a newer one", async () => {
    const w = new Latest();
    const s = server();
    void w.write("pos:7", 30, s.send);
    void w.write("pos:7", 45, s.send);
    // Only the first is out; the newer waits for its answer rather than racing it.
    expect(s.held).toHaveLength(1);
    s.held[0]?.ok();
    await settle();
    s.held[1]?.ok();
    await settle();
    expect(s.stored.at(-1)).toBe(45);
  });

  it("goes on after a failure, and says busy while a newer one is out", async () => {
    const w = new Latest();
    const s = server();
    const a = w.write("k", 1, s.send);
    const b = w.write("k", 2, s.send);
    const c = w.write("k", 3, s.send);
    expect(await b).toEqual({ status: "replaced" });
    s.held[0]?.fail(new Error("no"));
    const ra = await a;
    expect(ra.status).toBe("failed");
    // A newer write is out: the caller doesn't read the old value back over it.
    expect(w.busy("k")).toBe(true);
    s.held[1]?.ok();
    expect(await c).toEqual({ status: "saved" });
    expect(w.busy("k")).toBe(false);
  });

  it("keeps keys apart", async () => {
    const w = new Latest();
    const s = server();
    void w.write("a", 1, s.send);
    void w.write("b", 2, s.send);
    expect(s.held.map((h) => h.value)).toEqual([1, 2]);
  });
});
