import { describe, expect, it, vi } from "vitest";
import { createPlayerStore, type PlayerItem } from "./store.js";

const item = (over: Partial<PlayerItem> = {}): PlayerItem => ({
  id: "learn:1",
  kind: "youtube",
  src: "abc",
  title: "One",
  back: "/learn/items/1",
  ...over,
});
const make = () => {
  const go = vi.fn();
  return { go, store: createPlayerStore({ go }) };
};
const slot = () => ({}) as Element;

describe("player store", () => {
  it("starts empty", () => {
    const { store } = make();
    expect(store.getState().mode).toBe("none");
    expect(store.getState().item).toBeNull();
  });

  it("plays in full over a slot, and in the dock without one", () => {
    const a = make();
    a.store.play(item(), { anchor: slot() });
    expect(a.store.getState().mode).toBe("full");
    const b = make();
    b.store.play(item());
    expect(b.store.getState().mode).toBe("mini");
  });

  it("starts at startAt", () => {
    const { store } = make();
    store.play(item({ startAt: 42 }));
    expect(store.getState().time).toBe(42);
  });

  it("docks when the slot goes, and ignores a stale slot", () => {
    const { store } = make();
    const a = slot();
    store.play(item(), { anchor: a });
    store.release(slot());
    expect(store.getState().mode).toBe("full");
    store.release(a);
    expect(store.getState().mode).toBe("mini");
    expect(store.getState().item?.id).toBe("learn:1");
  });

  it("docks by hand, and a slot claims it back", () => {
    const { store } = make();
    const a = slot();
    store.play(item(), { anchor: a });
    store.dock();
    expect(store.getState().mode).toBe("mini");
    store.expand();
    expect(store.getState().mode).toBe("full");
  });

  it("expand without a slot opens the item's page", () => {
    const { store, go } = make();
    store.play(item());
    store.expand();
    expect(go).toHaveBeenCalledWith("/learn/items/1");
  });

  it("expand with a slot stays on the page", () => {
    const { store, go } = make();
    store.play(item(), { anchor: slot() });
    store.dock();
    store.expand();
    expect(go).not.toHaveBeenCalled();
  });

  it("the same id keeps its place, and a new address waits for a pause", () => {
    const { store } = make();
    store.play(item({ kind: "media", src: "a?sig=1" }));
    store.report(30, 100, true);
    store.play(item({ kind: "media", src: "a?sig=2" }), { anchor: slot() });
    expect(store.getState().time).toBe(30);
    expect(store.getState().item?.src).toBe("a?sig=1");
    expect(store.getState().mode).toBe("full");
    store.report(31, 100, false);
    store.play(item({ kind: "media", src: "a?sig=3" }));
    expect(store.getState().item?.src).toBe("a?sig=3");
  });

  it("a new item replaces the old and hands it its last time, paused", () => {
    const { store } = make();
    const onTime = vi.fn();
    store.play(item({ onTime }));
    store.report(12, 60, true);
    onTime.mockClear();
    store.play(item({ id: "learn:2", back: "/learn/items/2" }));
    expect(onTime).toHaveBeenCalledWith(12, 60, false);
    expect(store.getState().item?.id).toBe("learn:2");
    expect(store.getState().time).toBe(0);
    expect(store.getState().heard).toBe(false);
  });

  it("an item never heard keeps no place", () => {
    const { store } = make();
    const onTime = vi.fn();
    store.play(item({ onTime }));
    store.close();
    expect(onTime).not.toHaveBeenCalled();
  });

  it("close flushes where you stopped and empties the player", () => {
    const { store } = make();
    const onTime = vi.fn();
    store.play(item({ onTime }), { anchor: slot() });
    store.report(20, 60, true);
    onTime.mockClear();
    store.close();
    expect(onTime).toHaveBeenCalledWith(20, 60, false);
    expect(store.getState().mode).toBe("none");
    expect(store.getState().item).toBeNull();
  });

  it("report reaches the page's callback after its slot is gone", () => {
    const { store } = make();
    const onTime = vi.fn();
    const a = slot();
    store.play(item({ onTime }), { anchor: a });
    store.release(a);
    store.report(5, 60, true);
    expect(onTime).toHaveBeenCalledWith(5, 60, true);
    expect(store.getState().time).toBe(5);
  });

  it("seek goes to the host's driver", () => {
    const { store } = make();
    const seek = vi.fn();
    store.attach({ seek });
    store.play(item());
    store.seek(90);
    expect(seek).toHaveBeenCalledWith(90);
    expect(store.getState().time).toBe(90);
  });

  it("a seek before the host is there waits, then lands once", () => {
    const { store } = make();
    store.play(item());
    store.seek(33);
    const seek = vi.fn();
    store.attach({ seek });
    expect(seek).toHaveBeenCalledWith(33);
    store.attach({ seek });
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it("seek with nothing playing does nothing", () => {
    const { store } = make();
    const seek = vi.fn();
    store.attach({ seek });
    store.seek(5);
    expect(seek).not.toHaveBeenCalled();
  });

  it("detach stops seeks reaching an old driver", () => {
    const { store } = make();
    const seek = vi.fn();
    const off = store.attach({ seek });
    store.play(item());
    off();
    store.seek(8);
    expect(seek).not.toHaveBeenCalled();
  });

  it("pip wins over full and mini, and returns to mini on close", () => {
    const { store } = make();
    store.play(item(), { anchor: slot() });
    store.setPip(true);
    expect(store.getState().mode).toBe("pip");
    store.setPip(false);
    expect(store.getState().mode).toBe("full");
    store.release(store.getState().slot as Element);
    expect(store.getState().mode).toBe("mini");
  });

  it("tells subscribers, and stops after unsubscribe", () => {
    const { store } = make();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.play(item());
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    store.close();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
