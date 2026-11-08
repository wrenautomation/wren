#!/usr/bin/env node
// `folders` for the agent chats: wren's `folders` commands. Prod by default: the tree lives in prod.
// FOLDERS_TARGET=local: this checkout's database. prod-wren.mjs reads prod's URL, so it never enters the agent's env.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = ["folders", ...process.argv.slice(2)];
const r =
  process.env.FOLDERS_TARGET === "local"
    ? spawnSync(join(root, "bin/wren"), args, { stdio: "inherit" })
    : spawnSync(process.execPath, [join(root, "scripts/prod-wren.mjs"), ...args], {
        stdio: "inherit",
      });
process.exit(r.status ?? 1);
