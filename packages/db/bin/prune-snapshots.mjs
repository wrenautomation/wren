#!/usr/bin/env node
// Keeps drizzle's last few schema snapshots; older ones live in git history.
// generate diffs against the newest only; check reads the rest for recent collisions.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const KEEP = 3;
const dir = join(import.meta.dirname, "../drizzle/meta");
const old = readdirSync(dir)
  .filter((f) => /^\d+_snapshot\.json$/.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) rmSync(join(dir, f));
if (old.length) console.log(`pruned ${old.length} old snapshots (kept ${KEEP})`);
