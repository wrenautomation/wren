#!/usr/bin/env node
// Point this Mac's turbo at the shared remote cache (deploy/terraform/turbo-cache.tf): copies
// TURBO_API and TURBO_TOKEN from SSM env-2 into turbo's own user config, never printed. Every
// worktree's gate then reads and writes the cache CI uses. Run again after a token change.
// Undo: delete ~/Library/Application Support/turborepo/config.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { TURBO_API: apiUrl, TURBO_TOKEN: token, HOME } = process.env;
if (!token) {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = fileURLToPath(import.meta.url);
  execFileSync(
    "node",
    [join(here, "secrets.mjs"), "run", "/wren/prod/env-2", "--", "node", script],
    {
      stdio: "inherit",
    },
  );
} else {
  if (!apiUrl) throw new Error("TURBO_API is not in env-2");
  const dir = join(HOME, "Library/Application Support/turborepo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ apiUrl, teamSlug: "wren", token }), {
    mode: 0o600,
  });
  console.log("turbo remote cache set for this Mac");
}
