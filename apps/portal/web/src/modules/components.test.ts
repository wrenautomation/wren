/** Every portal app is in exactly one component, or the platform's own; a module names its component. */
import { COMPONENTS, PLATFORM } from "@wren/worker/components";
import { describe, expect, it } from "vitest";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./index.js");

describe("apps and components", () => {
  it("every app is one component's, or the platform's", () => {
    for (const m of MODULES) {
      const owners = COMPONENTS.filter((c) => c.provides.apps.includes(m.id)).map((c) => c.id);
      expect(owners, m.id).toEqual(m.id in PLATFORM.apps ? [] : [m.component]);
    }
  });

  it("every app a component provides is a module", () => {
    const ids = MODULES.map((m) => m.id);
    for (const c of COMPONENTS) for (const a of c.provides.apps) expect(ids, c.id).toContain(a);
  });
});
