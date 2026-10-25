import { describe, expect, it } from "vitest";
import { closed, type Edit, edit, UNDO_MOST } from "./canvas-edit.js";
import type { Draft } from "./wiring.js";

const draft = (n: number): Draft => ({
  wires: [{ from: `a${n}.out`, to: "b.in", via: "events" }],
  steps: [],
});
const open = (): Edit => edit(closed(), { type: "open" });
const tested: Edit["tested"] = { steps: [], from: "in.leads" };

describe("the canvas editor's state", () => {
  it("keeps the draft before each change for Undo, up to UNDO_MOST", () => {
    let s = open();
    for (let i = 0; i < UNDO_MOST + 5; i++) s = edit(s, { type: "changed", was: draft(i) });
    expect(s.undo).toHaveLength(UNDO_MOST);
    expect(s.undo.at(-1)).toEqual(draft(UNDO_MOST + 4));
    expect(s.undo[0]).toEqual(draft(5));
  });

  it("drops the dry run's path when the draft changes or steps back", () => {
    let s = edit(open(), { type: "tested", result: tested });
    s = edit(s, { type: "changed", was: draft(1) });
    expect(s.tested).toBeNull();
    s = edit(edit(s, { type: "tested", result: tested }), { type: "undone" });
    expect(s.tested).toBeNull();
    expect(s.undo).toEqual([]);
  });

  it("does nothing on Undo with nothing to undo", () => {
    const s = open();
    expect(edit(s, { type: "undone" })).toBe(s);
  });

  it("opens one panel at a time: a card's or a wire's", () => {
    let s = edit(open(), { type: "pick", wire: { from: "a.out", to: "b.in" } });
    s = edit(s, { type: "select", id: "a" });
    expect([s.sel, s.picked]).toEqual(["a", null]);
    s = edit(s, { type: "pick", wire: { from: "a.out", to: "b.in" } });
    expect([s.sel, s.picked]).toEqual([null, { from: "a.out", to: "b.in" }]);
  });

  it("shows Claude's answer over a clear canvas and drops the pending ask", () => {
    let s = edit(edit(closed("ask-1"), { type: "open" }), { type: "select", id: "a" });
    s = edit(edit(s, { type: "palette", open: true }), {
      type: "answered",
      reply: "Done.",
      patch: draft(2),
    });
    expect(s).toMatchObject({ pending: null, sel: null, adding: false });
    expect(s.proposal).toEqual({ reply: "Done.", patch: draft(2) });
  });

  it("opens the typed confirm for a publish that asks it, else shows the error", () => {
    const s = open();
    expect(
      edit(s, { type: "failed", message: "it sends email: type wren to confirm" }),
    ).toMatchObject({ confirm: { asks: "it sends email: type wren to confirm" }, error: null });
    expect(edit(s, { type: "failed", message: "no" })).toMatchObject({
      confirm: null,
      error: "no",
    });
  });

  it("clears the last error only when a write asks it", () => {
    const s = edit(open(), { type: "failed", message: "no" });
    expect(edit(s, { type: "busy", on: true }).error).toBe("no");
    expect(edit(s, { type: "busy", on: true, clear: true })).toMatchObject({
      busy: true,
      error: null,
    });
  });

  it("toggles the test panel: closing it drops the path and the panels", () => {
    let s = edit(open(), { type: "test" });
    s = edit(edit(s, { type: "tested", result: tested }), { type: "select", id: "a" });
    s = edit(s, { type: "test" });
    expect(s).toMatchObject({ testing: false, tested: null, sel: null });
  });

  it("closes to nothing but a pending ask", () => {
    let s = edit(closed("ask-1"), { type: "open", testing: true });
    s = edit(edit(s, { type: "changed", was: draft(1) }), { type: "failed", message: "no" });
    expect(edit(s, { type: "close" })).toEqual(closed("ask-1"));
  });
});
