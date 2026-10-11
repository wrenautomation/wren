/**
 * The portal's previews (a site's page, a section, a slide) are srcdoc frames, which keep the
 * app's CSP. Their one stylesheet each is allowed by its hash, so a changed stylesheet must
 * change the hash in web/public/_headers too, or the preview draws unstyled.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SLIDES_CSS } from "@wren/core/content/slides";
import { PAGE_CSS } from "@wren/sites/render";
import { describe, expect, it } from "vitest";

const HEADERS = readFileSync(join(import.meta.dirname, "..", "web", "public", "_headers"), "utf8");
const policy =
  HEADERS.split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:")) ?? "";
const styleSrc = policy.match(/style-src ([^;]+);/)?.[1] ?? "";
const hashOf = (css: string) => `'sha256-${createHash("sha256").update(css).digest("base64")}'`;

describe("preview styles", () => {
  it.each([
    ["a site's page", PAGE_CSS],
    ["the slides", SLIDES_CSS],
  ])("allows %s by hash", (_, css) => {
    expect(styleSrc.split(" ")).toContain(hashOf(css));
  });
});
