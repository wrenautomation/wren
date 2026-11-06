#!/usr/bin/env node
// `vireo` for the Vireo chat: wren's `variants` commands under the product's name.
// VIREO_TARGET=prod: prod's database, read by scripts/prod-wren.mjs, so its URL never enters the agent's env.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = ["variants", ...process.argv.slice(2)];
const r =
  process.env.VIREO_TARGET === "prod"
    ? spawnSync(process.execPath, [join(root, "scripts/prod-wren.mjs"), ...args], {
        stdio: "inherit",
      })
    : spawnSync(join(root, "bin/wren"), args, { stdio: "inherit" });
process.exit(r.status ?? 1);
