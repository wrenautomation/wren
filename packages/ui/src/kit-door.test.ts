/**
 * The kit is the one door to its vendors: no app imports shadcn's parts' libraries directly, and
 * every icon a part or a step names as data is one the kit draws.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isIconName } from "./icons.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const VENDORS = /from "(@base-ui\/react|lucide-react|cmdk|sonner)[/"]/;

/**
 * Sources under apps/ and packages/ (tracked or new, never ignored) that hold one of `words`.
 * One `git grep` over the index picks the few files worth reading; walking and reading all 20 MB
 * of source per test ran past 5 s on a loaded machine.
 */
function holding(...words: string[]): string[] {
  const args = ["grep", "--untracked", "-l", "-F", ...words.flatMap((w) => ["-e", w])];
  const paths = ["apps/*.ts", "apps/*.tsx", "packages/*.ts", "packages/*.tsx"];
  try {
    return execFileSync("git", [...args, "--", ...paths], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    // git grep exits 1 when nothing matches.
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("kit door", () => {
  it("leaves Base UI, Lucide, cmdk and sonner to @wren/ui", () => {
    const outside = holding("@base-ui/react", "lucide-react", "cmdk", "sonner")
      .filter((f) => !f.startsWith("packages/ui/"))
      .filter((f) => VENDORS.test(read(f)));
    expect(outside).toEqual([]);
  });
});

describe("icon names", () => {
  it("draws every icon named as data", () => {
    const named = holding('icon: "')
      .flatMap((f) => [...read(f).matchAll(/\bicon: "([a-z][a-z0-9-]*)"/g)])
      .map((m) => m[1] ?? "")
      // A button's size variant is a class, not an icon.
      .filter((n) => !n.startsWith("size-"));
    expect([...new Set(named.filter((n) => !isIconName(n)))]).toEqual([]);
  });
});
