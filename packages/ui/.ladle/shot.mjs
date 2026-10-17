/**
 * Screenshots of stories from a running Ladle (`pnpm --filter @wren/ui stories`):
 *   pnpm --filter @wren/ui stories:shot [--width 390] [--dark] [--out dir] <story-id>...
 * Writes <out>/<id>[-dark]-<width>.png (default out: <tmp>/wren-ui-shots) and prints each page or console error. Exits 1 on any.
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
const page = await browser.newPage({ viewport: { width: Number(values.width), height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let failed = false;
for (const id of positionals) {
  const theme = values.dark ? "&theme=dark" : "";
  await page.goto(`http://localhost:${values.port}/?story=${id}&mode=preview${theme}`);
  await page.waitForLoadState("networkidle");
  const path = `${values.out}/${id}${values.dark ? "-dark" : ""}-${values.width}.png`;
  await page.screenshot({ path, fullPage: true });
  const said = errors.splice(0);
  failed ||= said.length > 0;
  console.log(path, said.length ? `errors: ${said.join(" | ")}` : "ok");
}
await browser.close();
process.exit(failed ? 1 : 0);
