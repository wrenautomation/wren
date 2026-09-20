/** The profile fetch caches only real profiles and skips cached files without pausing. */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PoliteFetcher } from "@wren/research/fetch";
import { describe, expect, it } from "vitest";
import { downloadProfile } from "./profiles.js";

const REMOTE = {
  dataset: "shopify-partner-profiles",
  fileName: "jadepuma.html",
  url: "https://www.shopify.com/partners/directory/partner/jadepuma",
  period: "",
};
const fetcherAnswering = (body: string) =>
  new PoliteFetcher("t (t@example.com)", {
    minInterval: 0,
    sleep: async () => {},
    fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
  });
const noPause = async () => {};

describe("downloadProfile", () => {
  it("skips a cached file before pausing", async () => {
    const dest = join(mkdtempSync(join(tmpdir(), "prof-")), "jadepuma.html");
    writeFileSync(dest, "<h2>Contact information</h2>");
    let paused = false;
    const result = await downloadProfile(fetcherAnswering(""), REMOTE, dest, async () => {
      paused = true;
    });
    expect(result.downloaded).toBe(false);
    expect(paused).toBe(false);
  });

  it("keeps a real profile", async () => {
    const dest = join(mkdtempSync(join(tmpdir(), "prof-")), "jadepuma.html");
    const result = await downloadProfile(
      fetcherAnswering("<h2>Contact information</h2><h2>Business description</h2>"),
      REMOTE,
      dest,
      noPause,
    );
    expect(result.downloaded).toBe(true);
    expect(existsSync(dest)).toBe(true);
  });

  it("refuses to cache a challenge page, even one echoing the URL", async () => {
    for (const body of [
      "<html>Attention Required! | Cloudflare</html>",
      '<meta http-equiv="refresh" content="0; url=/partners/directory/partner/jadepuma">Checking your browser',
    ]) {
      const dest = join(mkdtempSync(join(tmpdir(), "prof-")), "jadepuma.html");
      await expect(downloadProfile(fetcherAnswering(body), REMOTE, dest, noPause)).rejects.toThrow(
        /not a partner profile/,
      );
      expect(existsSync(dest)).toBe(false);
    }
  });
});
