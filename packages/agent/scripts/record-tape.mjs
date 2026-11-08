#!/usr/bin/env node
/**
 * A chat through the running relay, driven as the portal page drives it, so its tape
 * (`wren agent serve --tape <dir>`) holds every frame a page story replays: get_settings at each
 * init and after /model or /effort, get_context_usage after each turn, a task's output once it runs,
 * the first option of each question. Then scrub-tape.mjs makes the fixture.
 *   node packages/agent/scripts/record-tape.mjs [--model haiku] [--stop 1] "<turn>" "<turn>" …
 * --stop <n>: Stop turn n (from 1) once it streams.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const { values: o, positionals: said } = parseArgs({
  allowPositionals: true,
  options: {
    setup: { type: "string", default: "weaver" },
    // the setup's own model by default, as a new chat on the page
    model: { type: "string" },
    stop: { type: "string" },
  },
});
if (!said.length) {
  console.error('usage: record-tape.mjs [--model haiku] [--stop n] "<turn>" …');
  process.exit(2);
}
const root = new URL("../../../", import.meta.url).pathname;
const sdk = createRequire(`${root}apps/portal/web/package.json`).resolve(
  "@anthropic-ai/claude-agent-sdk/browser",
);
const token = execFileSync(`${root}bin/wren`, ["agent", "token"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .at(-1);
globalThis.process ??= {};
const { query } = await import(sdk);

const queue = [];
let wake;
let done = false;
const say = (text) => {
  queue.push({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: "",
  });
  wake?.();
};
const prompt = (async function* () {
  while (!done || queue.length) {
    const n = queue.shift();
    if (n) yield n;
    else await new Promise((r) => (wake = r));
  }
})();
const q = query({
  prompt,
  canUseTool: async (name, input) =>
    name === "AskUserQuestion"
      ? {
          behavior: "allow",
          updatedInput: {
            ...input,
            answers: Object.fromEntries(
              input.questions.map((x) => [x.question, x.options[0].label]),
            ),
          },
        }
      : { behavior: "allow", updatedInput: input },
  websocket: {
    url: `ws://127.0.0.1:4748/s/${o.setup}${o.model ? `?model=${o.model}` : ""}`,
    authMessage: { type: "auth", credential: { type: "oauth", token } },
  },
});

let turn = 0;
let streamed = 0;
const stopAt = o.stop ? Number(o.stop) : 0;
say(said[0]);
const quiet = (p) => p.catch(() => null);
for await (const m of q) {
  if (m.type === "system" && m.subtype === "init") await quiet(q.getSettings());
  if (m.type === "system" && m.subtype === "task_started")
    setTimeout(() => void quiet(q.getTaskOutput(m.task_id)), 3000);
  if (m.type === "stream_event" && m.event?.type === "content_block_delta" && turn + 1 === stopAt)
    if (++streamed === 30) await quiet(q.interrupt());
  if (m.type !== "result") continue;
  console.log(`turn ${turn + 1}: ${m.subtype}`);
  await quiet(q.getContextUsage({ detail: "summary" }));
  if (/^\/(model|effort)\b/.test(said[turn])) await quiet(q.getSettings());
  if (++turn >= said.length) break;
  say(said[turn]);
}
done = true;
wake?.();
process.exit(0);
