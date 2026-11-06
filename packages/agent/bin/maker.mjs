#!/usr/bin/env node
// `maker` for a chat whose setup has `runs`: headless runs of this Mac's makers, through the relay.
// The session's own token and the relay's URL are in the env (WREN_AGENT_TOKEN, WREN_AGENT_URL).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const [cmd, ...rest] = process.argv.slice(2);
const to = { list: "makers", start: "run", status: "runs", stop: "stop" }[cmd ?? ""];
if (!to) {
  console.error(
    'maker list | start <maker> "<prompt>" [--model <m>] [--file <path>] | status [run] | stop <run>',
  );
  process.exit(2);
}
const r = spawnSync(join(root, "bin/wren"), ["agent", to, ...rest], { stdio: "inherit" });
process.exit(r.status ?? 1);
