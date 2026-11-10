#!/usr/bin/env node
// `shape` for the Map chat: wren's `shape` commands that read, or write to a draft. Nothing here
// changes the live shape: apply, drop, import, undo and tag are a person's, in the portal.
// SHAPE_TARGET=prod: prod's database, read by scripts/prod-wren.mjs, so its URL never enters the agent's env.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const READS = ["show", "versions", "diff", "export", "blame", "tags", "view"];
const DRAFT = ["new", "list", "show", "propose"];

const argv = process.argv.slice(2);
// `shape --client <id> …`: a client's shape, not Wren's
const client = argv[0] === "--client" ? argv.splice(0, 2).slice(1) : [];
const [cmd, sub] = argv;
const ok = READS.includes(cmd) || cmd === "edit" || (cmd === "draft" && DRAFT.includes(sub));
if (!ok) {
  console.error(
    `shape ${argv.slice(0, 2).join(" ")}: not open here. Read with ${READS.join(", ")}. ` +
      `Write with edit <draft> and draft ${DRAFT.join("|")}. A person applies or drops a draft in the portal.`,
  );
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = [...(client.length ? ["--client", ...client] : []), "shape", ...argv];
const r =
  process.env.SHAPE_TARGET === "prod"
    ? spawnSync(process.execPath, [join(root, "scripts/prod-wren.mjs"), ...args], {
        stdio: "inherit",
      })
    : spawnSync(join(root, "bin/wren"), args, { stdio: "inherit" });
process.exit(r.status ?? 1);
