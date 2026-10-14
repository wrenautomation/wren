import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 60-30-10: parts take the accent only through its roles (primary, active, link, focus, live),
 * never --ui-accent itself, so the accent stays on the few things it marks
 * (designs/2026-10-14-customerio-audit.md, B3 item 10).
 */
const RAW = /var\(--ui-accent\)|\(--ui-accent\)/;

/** Files that make looks: they set the accent, they don't paint with it. */
const MAKERS = new Set(["theme.tsx", "palette-brand.ts", "contrast.ts"]);

function rawAccents(dir: URL, skip: ReadonlySet<string> = new Set()): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !skip.has(f))
    .flatMap((f) =>
      readFileSync(new URL(f, dir), "utf8")
        .split("\n")
        .map((line, i) => [line, i] as const)
        // A token's own definition may read the accent: `--ui-link: var(--ui-accent);`.
        .filter(([line]) => RAW.test(line) && !/^\s*--ui-[a-z0-9-]+:/.test(line))
        .map(([line, i]) => `${f}:${i + 1}: ${line.trim().slice(0, 100)}`),
    );
}

describe("the accent", () => {
  it("reaches the kit's parts only through its roles", () => {
    expect(rawAccents(new URL("./", import.meta.url), MAKERS)).toEqual([]);
  });
});
