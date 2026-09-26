/**
 * `pnpm offers:export <file> [--check]`: write the registry snapshot, or (with --check)
 * exit 1 when the file on disk differs. The gates run the check against the lander.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OFFERS } from "./index.js";
import { snapshotText } from "./snapshot.js";

const args = process.argv.slice(2);
const check = args.includes("--check");
const file = args.find((a) => !a.startsWith("--"));
if (file === undefined) {
  console.error("usage: pnpm offers:export <file> [--check]");
  process.exit(2);
}
// pnpm --filter runs in the package dir; INIT_CWD is where the person typed the command.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const want = snapshotText(OFFERS);
if (check) {
  let have = "";
  try {
    have = readFileSync(path, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (have !== want) {
    console.error(`${path} is stale: run pnpm offers:export ${file}`);
    process.exit(1);
  }
  console.log(`${path} matches the registry (${OFFERS.length} offers)`);
} else {
  writeFileSync(path, want);
  console.log(`wrote ${OFFERS.length} offers to ${path}`);
}
