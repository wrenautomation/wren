import { expect, test } from "vitest";
import { sourceOf } from "./cite.js";

test("a cited file links to its repo on GitHub", () => {
  const gh = "https://github.com/wrenautomation";
  expect(sourceOf("packages/core/src/ask.ts:12")).toBe(
    `${gh}/wren/blob/main/packages/core/src/ask.ts#L12`,
  );
  expect(sourceOf("../autobrowse/src/claude/service.ts")).toBe(
    `${gh}/autobrowse/blob/main/src/claude/service.ts`,
  );
  expect(sourceOf("lander/src/pages/index.astro:3")).toBe(
    `${gh}/lander/blob/main/src/pages/index.astro#L3`,
  );
  expect(sourceOf("lead_checks")).toBeNull();
  expect(sourceOf("schema.ts")).toBeNull();
});
