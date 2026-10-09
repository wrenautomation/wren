/**
 * `pnpm templates:export <file> [--check]`: write the gallery snapshot for the lander, or (with
 * --check) exit 1 when the file on disk differs. Like `offers:export`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPONENTS } from "../src/components.js";
import { gallery, galleryText } from "../src/gallery.js";
import { WORKFLOWS } from "../src/workflows.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const file = args.find((a) => !a.startsWith("--"));
if (file === undefined) {
  console.error("usage: pnpm templates:export <file> [--check]");
  process.exit(2);
}
// pnpm --filter runs in the package dir; INIT_CWD is where the person typed the command.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const g = gallery(WORKFLOWS, COMPONENTS);
const want = galleryText(g);
if (check) {
  let have = "";
  try {
    have = readFileSync(path, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (have !== want) {
    console.error(`${path} is stale: run pnpm templates:export ${file}`);
    process.exit(1);
  }
  console.log(`${path} matches the templates (${g.templates.length})`);
} else {
  writeFileSync(path, want);
  console.log(`wrote ${g.templates.length} templates to ${path}`);
}
