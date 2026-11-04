import type { Setup } from "./setup.js";

/** Short line for every setup: what the page is for, no tool talk. */
const BIRDWATCH_APPEND =
  "You run inside the wren portal's Research page. The person steers; you drive birdwatch per its skill. `birdwatch` is on PATH and BIRDWATCH_AGENT is set: run `birdwatch <command>` as is, from the working directory, with no cd, npx or env prefix. Keep replies short.";

export const SETUPS: readonly Setup[] = [
  {
    name: "birdwatch",
    title: "Research",
    app: "research",
    cwd: "tasks/docs/research",
    model: "sonnet",
    models: ["sonnet", "haiku", "opus"],
    tools: ["Bash", "Read", "Skill"],
    skills: ["birdwatch:birdwatch"],
    plugins: ["@wrenautomation/birdwatch"],
    allow: ["Bash(birdwatch *)", "Skill(birdwatch:birdwatch)"],
    passEnv: ["BIRDWATCH_LEDGER", "BIRDWATCH_ACCOUNTS", "BIRDWATCH_JUDGE"],
    vars: { BIRDWATCH_AGENT: "wren-agent" },
    append: BIRDWATCH_APPEND,
    credentials: ["plan", "key"],
    connection: "sdk",
  },
];

export function setupNamed(name: string, list: readonly Setup[] = SETUPS): Setup | undefined {
  return list.find((s) => s.name === name);
}
