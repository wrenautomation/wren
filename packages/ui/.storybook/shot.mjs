#!/usr/bin/env node
/**
 * Screenshots of stories from a running Storybook (`pnpm --filter @wren/ui storybook`), for a look
 * while you edit. The tests compare no screenshots; these are for reading.
 *   pnpm --filter @wren/ui stories:shot [--width 390] [--dark] [--out dir] <story-id>...
 * Writes <out>/<id>[-dark]-<width>.png (default out: <tmp>/wren-ui-shots) and prints each page or
 * console error, and a failed `play`. Exits 1 on any.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: "string", default: "1280" },
    dark: { type: "boolean", default: false },
    out: { type: "string", default: `${tmpdir()}/wren-ui-shots` },
    port: { type: "string", default: "61000" },
  },
});
if (!positionals.length) {
  console.error("usage: stories:shot [--width 390] [--dark] [--out dir] <story-id>...");
  process.exit(2);
}
mkdirSync(values.out, { recursive: true });
const browser = await chromium.launch();
// Closed on any exit, so no Chromium outlives the script.
process.on("SIGINT", () => void browser.close().then(() => process.exit(130)));
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: Number(values.width), height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const id of positionals) {
    const theme = values.dark ? "&globals=theme:dark" : "";
    await page.goto(`http://localhost:${values.port}/iframe.html?id=${id}&viewMode=story${theme}`);
    // The story is drawn and its `play`, if any, has ended (or failed).
    const end = await page
      .waitForFunction(
        () => {
          const root = document.getElementById("storybook-root");
          const err = document.body.classList.contains("sb-show-errordisplay");
          return err ? "error" : root?.childElementCount ? "ok" : false;
        },
        null,
        { timeout: 15_000 },
      )
      .then((h) => h.jsonValue());
    await page.waitForLoadState("networkidle");
    const path = `${values.out}/${id}${values.dark ? "-dark" : ""}-${values.width}.png`;
    await page.screenshot({ path, fullPage: true });
    const said = errors.splice(0);
    if (end === "error") said.push("the story threw: see Storybook");
    failed ||= said.length > 0;
    console.log(path, said.length ? `errors: ${said.join(" | ")}` : "ok");
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
