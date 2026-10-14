/** Every page says what it's for: one plain sentence under its title (`about`). */
import { describe, expect, it } from "vitest";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./modules/index.js");

describe("about", () => {
  it("every page has one short sentence", () => {
    const off = MODULES.flatMap((m) =>
      m.pages
        .filter(
          (p) => !/^[A-Z][^.?!]*[^\s.?!]\.$/.test(p.about ?? "") || (p.about ?? "").length > 120,
        )
        .map((p) => `${m.id}/${p.id} (${m.requires?.audience ?? "any"}): ${p.about ?? "none"}`),
    );
    expect(off).toEqual([]);
  });
});
