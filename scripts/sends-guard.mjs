#!/usr/bin/env node
/**
 * Every handler the portal calls by name whose form says `effect: "sends"` is in `SEND_HANDLERS`
 * (apps/portal/src/services.ts), so the Worker accepts it and the tab tracks it
 * (designs/2026-10-15-one-write-path.md, "Sends: accept, then track"). One left out is a held-open
 * request: a tab switch mid-send loses its state.
 *
 * Matches by handler name: the portal calls no two services' handlers of one name today. When it
 * does, name the pair in OK with why.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** `Service/handler` pairs the portal calls that are not sends though a same-named handler is. */
const OK = new Map([]);

const grep = (args) => {
  try {
    return execFileSync("git", ["grep", "--untracked", ...args], { encoding: "utf8" });
  } catch (err) {
    if (err.status === 1) return "";
    throw err;
  }
};

const files = grep(["-l", 'effect: "sends"', "--", "packages", "apps", ":!*.test.ts"])
  .split("\n")
  .filter(Boolean);
const sends = new Set();
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes('effect: "sends"')) return;
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const m = /(\w+): (?:service|exclusive|shared)Handler\(/.exec(lines[j]);
      if (m) return void sends.add(m[1]);
    }
  });
}

if (!sends.size) {
  console.error('no handler says effect: "sends": the guard is reading the wrong files');
  process.exit(1);
}

const CALL = /handlerCall\(\s*"(\w+)",\s*"(\w+)"/g;
const called = new Set();
for (const f of grep([
  "-l",
  "handlerCall(",
  "--",
  "apps/portal/web/src",
  "packages/ui/src",
  ":!*.test.ts",
  ":!*.test.tsx",
])
  .split("\n")
  .filter(Boolean))
  for (const m of readFileSync(f, "utf8").matchAll(CALL)) called.add(`${m[1]}/${m[2]}`);

const listed = readFileSync("apps/portal/src/services.ts", "utf8");
const block = /SEND_HANDLERS[^=]*= new Set\(\[([\s\S]*?)\]\)/.exec(listed)?.[1] ?? "";
const have = new Set([...block.matchAll(/"([\w/]+)"/g)].map((m) => m[1]));

const missing = [...called].filter(
  (pair) => sends.has(pair.split("/")[1]) && !have.has(pair) && !OK.has(pair),
);
if (missing.length) {
  console.error(
    `effect "sends" handlers the portal calls, missing from SEND_HANDLERS (apps/portal/src/services.ts):\n  ${missing.sort().join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`${called.size} handlers called, ${sends.size} tagged sends, ${have.size} listed`);
