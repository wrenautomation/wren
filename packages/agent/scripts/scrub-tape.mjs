#!/usr/bin/env node
/**
 * A relay tape (`wren agent serve --tape <dir>`) to a story fixture: the repo is public, so home
 * paths, the account, session ids and signatures go; times become offsets from the first frame.
 * Fails if anything private is left. `node packages/agent/scripts/scrub-tape.mjs <in.jsonl> <out.json>`
 * A JSON array in (a stored session, `GET /s/<setup>/sessions/<id>`) comes out as frames, no times.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: scrub-tape.mjs <in.jsonl> <out.json>");
  process.exit(2);
}

const HOME = homedir();
const USER = userInfo().username;
// keys that name the Mac or the account, never the chat
const DROP = new Set([
  "account",
  "pid",
  "messaging_socket_path",
  "user_output_styles_dir",
  "signature",
  "apiKeySource",
  "mcp_servers",
  "plugins",
  "additional_directories",
  // the terminal's /context grid, ~24 KB a reply; no page reads it
  "gridRows",
]);
const ids = new Map();
const fake = (id) => {
  if (!ids.has(id))
    ids.set(id, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`);
  return ids.get(id);
};

const raw = readFileSync(input, "utf8").trim();
const stored = raw.startsWith("[");
const lines = stored
  ? JSON.parse(raw).map((frame) => ({ at: 0, from: "cli", frame }))
  : raw.split("\n").map((l) => JSON.parse(l));
for (const { frame } of lines)
  if (typeof frame.session_id === "string" && frame.session_id) fake(frame.session_id);

const text = (s) => {
  let out = s.split(`${HOME}/Documents/wren_automation`).join("/Users/you/work");
  out = out.split(HOME).join("/Users/you").split(USER).join("you");
  for (const [real, f] of ids) out = out.split(real).join(f);
  // a letter TLD: a pnpm path (`@scope+pkg@0.36.1`) is no address
  return out.replace(/[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi, "you@example.com");
};
// a loaded skill's body rides as a synthetic user turn, ~20 KB; no page draws it
const SKILL_CAP = 2000;
const scrub = (v) => {
  if (typeof v === "string") return text(v);
  if (v?.isSynthetic && Array.isArray(v.message?.content))
    for (const b of v.message.content)
      if (b.type === "text" && b.text.length > SKILL_CAP)
        b.text = `${b.text.slice(0, SKILL_CAP)}\n[cut: the rest of the skill]`;
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !DROP.has(k))
        .map(([k, x]) => [k, scrub(x)]),
    );
  return v;
};

const t0 = lines[0]?.at ?? 0;
const tape = lines.map(({ at, from, frame }) => ({ t: at - t0, from, frame: scrub(frame) }));
const out = JSON.stringify(stored ? tape.map((x) => x.frame) : tape);
const left = [HOME, USER, hostname().split(".")[0], ...ids.keys(), "sk-ant", "Bearer "].filter(
  (w) => w && w.length > 2 && out.includes(w),
);
if (left.length) {
  console.error(`private text left: ${left.join(", ")}`);
  process.exit(1);
}
writeFileSync(output, `${out}\n`);
console.log(
  `${tape.length} frames, ${Math.round(out.length / 1024)} KB, ${ids.size} sessions -> ${output}`,
);
