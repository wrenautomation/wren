// Node, not the Worker: type-checked by scripts/tsconfig.json.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 60-30-10: the portal takes the accent only through its roles (--ui-primary, -active, -link,
 * -focus, -live), never --ui-accent itself (designs/2026-10-14-customerio-audit.md, B3 item 10).
 */
describe("the accent", () => {
  it("reaches the portal's pages only through its roles", () => {
    const web = new URL("../web/src/", import.meta.url);
    const raw = readdirSync(web, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .flatMap((f) =>
        readFileSync(new URL(f, web), "utf8")
          .split("\n")
          .map((line, i) => [line, i] as const)
          .filter(([line]) => /var\(--ui-accent\)|\(--ui-accent\)/.test(line))
          .map(([line, i]) => `${f}:${i + 1}: ${line.trim().slice(0, 100)}`),
      );
    expect(raw).toEqual([]);
  });
});
