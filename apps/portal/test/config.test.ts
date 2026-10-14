/** The Worker's config keeps static files off the request meter (designs/2026-10-14-portal-requests.md). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toml = readFileSync(join(import.meta.dirname, "..", "wrangler.toml"), "utf8");
const headers = readFileSync(join(import.meta.dirname, "..", "web", "public", "_headers"), "utf8");

describe("wrangler.toml", () => {
  it("hashed files skip the Worker; every other path still goes to it", () => {
    expect(toml).toMatch(/^run_worker_first = \["\/\*", "!\/assets\/\*"\]$/m);
  });

  it("logs one request in ten", () => {
    expect(toml).toMatch(/\[observability\]\s+enabled = true\s+head_sampling_rate = 0\.1/);
  });

  it("hashed files are cached for good", () => {
    expect(headers).toMatch(
      /^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m,
    );
  });
});
