#!/usr/bin/env node
// `vireo` for the Vireo chat: wren's `variants` commands under the product's name.
// VIREO_TARGET=prod: prod's database, read by scripts/prod-wren.mjs, so its URL never enters the agent's env.
// `run`, `runs`, `stop`: headless Vireo runs in a subject's workspace, through the relay (`wren agent`).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const [cmd, ...rest] = process.argv.slice(2);

/** `run <subject> "<prompt>"` → `agent run vireo --subject`; runs and stop as they are. */
function agentArgs() {
  if (cmd === "run") {
    const [subject, ...prompt] = rest;
    if (!subject || !prompt.length) {
      console.error('vireo run <subject> "<prompt>" [--model m] [--file path]');
      process.exit(2);
    }
    return ["agent", "run", "vireo", "--subject", subject, ...prompt];
  }
  if (cmd === "runs") return ["agent", "runs", "--setup", "vireo", ...rest];
  if (cmd === "stop") return ["agent", "stop", ...rest];
  return null;
}

const agent = agentArgs();
const args = agent ?? ["variants", ...process.argv.slice(2)];
const r =
  !agent && process.env.VIREO_TARGET === "prod"
    ? spawnSync(process.execPath, [join(root, "scripts/prod-wren.mjs"), ...args], {
        stdio: "inherit",
      })
    : spawnSync(join(root, "bin/wren"), args, { stdio: "inherit" });
process.exit(r.status ?? 1);
