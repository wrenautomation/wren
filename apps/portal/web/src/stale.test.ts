import { describe, expect, it, vi } from "vitest";
import { isStaleChunk, reloadOnce } from "./stale.js";

describe("isStaleChunk", () => {
  it("knows each browser's words for a gone lazy file", () => {
    for (const m of [
      "Failed to fetch dynamically imported module: https://app.example.com/assets/canvas-OLD.js",
      "error loading dynamically imported module: https://app.example.com/assets/canvas-OLD.js",
      "Importing a module script failed.",
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
      "Unable to preload CSS for /assets/frame-OLD.css",
    ])
      expect(isStaleChunk(new TypeError(m))).toBe(true);
  });

  it("leaves every other error to the page", () => {
    expect(isStaleChunk(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(
      false,
    );
    expect(isStaleChunk(null)).toBe(false);
    expect(isStaleChunk({ message: "Importing a module script failed." })).toBe(true);
  });
});

describe("reloadOnce", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
    };
  };

  it("reloads a stale tab once, then lets a second failure show", () => {
    const s = store();
    const reload = vi.fn();
    expect(reloadOnce(s, 1_000_000, reload)).toBe(true);
    expect(reloadOnce(s, 1_010_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again after the next deploy", () => {
    const s = store();
    const reload = vi.fn();
    reloadOnce(s, 1_000_000, reload);
    expect(reloadOnce(s, 1_000_000 + 31_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("still reloads with no storage", () => {
    const reload = vi.fn();
    expect(reloadOnce(null, 1, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
