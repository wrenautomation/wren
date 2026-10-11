/** The kit is the one door to its vendors: no app imports shadcn's parts' libraries directly. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const VENDORS = /from "(@base-ui\/react|lucide-react|cmdk|sonner)[/"]/;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name)) yield path;
  }
}

describe("kit door", () => {
  it("leaves Base UI, Lucide, cmdk and sonner to @wren/ui", () => {
    const outside = ["apps", "packages"]
      .flatMap((d) => [...sources(join(ROOT, d))])
      .filter((f) => !f.startsWith(join(ROOT, "packages", "ui")))
      .filter((f) => VENDORS.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(outside).toEqual([]);
  });
});
