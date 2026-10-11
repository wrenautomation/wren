/**
 * The kit is the one door to its vendors: no app imports shadcn's parts' libraries directly, and
 * every icon a part or a step names as data is one the kit draws.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isIconName } from "./icons.js";

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

describe("icon names", () => {
  it("draws every icon named as data", () => {
    const named = ["apps", "packages"]
      .flatMap((d) => [...sources(join(ROOT, d))])
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bicon: "([a-z][a-z0-9-]*)"/g)])
      .map((m) => m[1] ?? "")
      // A button's size variant is a class, not an icon.
      .filter((n) => !n.startsWith("size-"));
    expect([...new Set(named.filter((n) => !isIconName(n)))]).toEqual([]);
  });
});
