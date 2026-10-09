import { describe, expect, it } from "vitest";
import { COMPONENTS } from "./components.js";
import { gallery } from "./gallery.js";
import { WORKFLOWS } from "./workflows.js";

describe("gallery", () => {
  it("lists the client templates, each with its steps and effects, and nothing of Wren's own", () => {
    const g = gallery(WORKFLOWS, COMPONENTS);
    expect(g.templates.map((t) => t.id)).toEqual(
      expect.arrayContaining(["speed-to-lead", "win-back"]),
    );
    for (const t of g.templates) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.steps.length).toBeGreaterThan(0);
      expect(t.steps.every((s) => s.name && s.does)).toBe(true);
    }
    const ids = new Set(g.templates.map((t) => t.id.replace(/-/g, "_")));
    for (const w of WORKFLOWS.filter((w) => w.for === "wren")) expect(ids.has(w.id)).toBe(false);
  });
});
