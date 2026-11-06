import type { Setup } from "./setup.js";

/** Short line for every setup: what the page is for, no tool talk. */
const BIRDWATCH_APPEND =
  "You run inside the wren portal's Research page. The person steers; you drive birdwatch per its skill. `birdwatch` is on PATH and BIRDWATCH_AGENT is set: run `birdwatch <command>` as is, from the working directory, with no cd, npx or env prefix. A line `[Attached: <path>]` is a file the person sent: read a video with `birdwatch watch <path>`, a PDF or web page with `birdwatch text <path>`, anything else with Read. A line `[Page: ...]` says which portal page the person has open. When you offer the person choices, ask with AskUserQuestion, not a list. Keep replies short.";

const VIREO_APPEND =
  'You are Vireo, in the wren portal\'s side chat. The person judges samples on the Variants page; you drive the loop per the variants skill. `vireo` is on PATH: where the skill says `./bin/wren variants <command>`, run `vireo <command>` as is, from the working directory, with no cd, npx or env prefix. A line `[Page: ...]` says which portal page the person has open and, on Variants, the subject and batch in view. When he hands you a closed batch: run `vireo show <subject>`, say in a few lines what his calls share and what you would test next, then ask for his guide for the next batch in one question. Save his answer with `vireo close <batch> --note "<his words>"` (it sets the note of a closed batch). Judging is blind: never describe a sample he has not marked. Never judge for him. You make text samples here: write batch.json in the working directory, then `vireo add`. A video, image or page batch is the job of a maker: a setup that builds in the project of the subject. `maker` is on PATH; the skill section "Makers" says how you start and follow its runs. With no maker for the subject (`maker list`), say it needs a Claude Code session. When you offer choices, ask with AskUserQuestion, not a list. Keep replies short.';

export const SETUPS: readonly Setup[] = [
  {
    name: "birdwatch",
    title: "Birdwatch",
    app: "research",
    cwd: "tasks/docs/research",
    model: "sonnet",
    models: ["sonnet", "haiku", "opus", "fable"],
    // AskUserQuestion stays out of allow: it reaches the page as an ask
    tools: ["Bash", "Read", "Skill", "AskUserQuestion"],
    skills: ["birdwatch:birdwatch"],
    plugins: ["@wrenautomation/birdwatch"],
    allow: ["Bash(birdwatch *)", "Skill(birdwatch:birdwatch)"],
    passEnv: ["BIRDWATCH_LEDGER", "BIRDWATCH_ACCOUNTS", "BIRDWATCH_JUDGE"],
    vars: { BIRDWATCH_AGENT: "wren-agent" },
    append: BIRDWATCH_APPEND,
    credentials: ["plan", "key"],
    connection: "sdk",
  },
  {
    name: "vireo",
    title: "Vireo",
    app: "variants",
    // private repo: batch files hold copy, the wren repo is public
    cwd: "tasks/docs/variants",
    model: "sonnet",
    models: ["sonnet", "haiku", "opus", "fable"],
    tools: ["Bash", "Read", "Write", "Skill", "AskUserQuestion"],
    skills: ["vireo:variants"],
    // a path plugin: wren hosts Vireo's commands (packages/variants), under the name `vireo`
    plugins: ["./wren/packages/variants"],
    allow: ["Bash(vireo *)", "Bash(maker *)", "Skill(vireo:variants)"],
    // makers build what this chat cannot (pages, video): one headless run per sample
    runs: true,
    passEnv: ["AWS_PROFILE", "AWS_REGION"],
    // the relay runs on the Mac against prod for now (designs/2026-11-05-variants.md)
    vars: { VIREO_TARGET: "prod" },
    append: VIREO_APPEND,
    credentials: ["plan", "key"],
    connection: "sdk",
  },
];

export function setupNamed(name: string, list: readonly Setup[] = SETUPS): Setup | undefined {
  return list.find((s) => s.name === name);
}
