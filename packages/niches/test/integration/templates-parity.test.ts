/**
 * The parity proof for the defaults tree: every niche's `.email` file, synced into the store,
 * renders byte for byte what the file renders, for the same facts and the same recipient; and a
 * sync run twice changes nothing. Facts are synthetic.
 */
import { factKeys, render, type Template } from "@wren/core/slots";
import { liveTemplates } from "@wren/core/templates";
import { loadDefaults, syncDefaults } from "@wren/core/templates/defaults";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NICHES } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

/** Every fact the template reads, filled; `drop` leaves every nth one empty for the fallbacks. */
function facts(tpl: Template, drop: number): Record<string, string | null> {
  return Object.fromEntries(
    [...factKeys(tpl)]
      .sort()
      .map((k, i) => [k, drop && i % drop === 0 ? null : `Sample ${k} ${i}`]),
  );
}

const outcome = (tpl: Template, f: Record<string, string | null>, seed: string) => {
  try {
    return render(tpl, f, seed);
  } catch (err) {
    return { error: (err as Error).message };
  }
};

describe("email defaults into the store", () => {
  it("renders every template identically, for every niche, seed and fact set", async () => {
    const files = loadDefaults().filter(
      (f) => f.ref.kind === "email" && NICHES.some((n) => n.name === f.ref.system),
    );
    const first = await syncDefaults(pg.db, { only: "all", files });
    const total = NICHES.reduce((n, niche) => n + niche.templates.size, 0);
    expect(first).toEqual({ files: total, written: total, live: total });
    expect(total).toBeGreaterThan(0);
    let compared = 0;
    for (const niche of NICHES) {
      const live = await liveTemplates(pg.db, "email", niche.name);
      expect([...live.keys()].sort()).toEqual([...niche.templates.keys()].sort());
      for (const [name, file] of niche.templates) {
        const stored = live.get(name)?.template as Template;
        expect(stored.version).toBe(file.version);
        for (const drop of [0, 2, 3])
          for (const seed of ["person:1", "person:2", "company:7", "person:31337"]) {
            const f = facts(file, drop);
            expect(outcome(stored, f, seed)).toEqual(outcome(file, f, seed));
            compared++;
          }
      }
    }
    expect(compared).toBe(total * 12);
    expect(await syncDefaults(pg.db, { only: "all", files })).toEqual({
      files: total,
      written: 0,
      live: 0,
    });
  });
});
