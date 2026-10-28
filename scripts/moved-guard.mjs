#!/usr/bin/env node
/**
 * No code links to an address the portal router moves (apps/portal/web/src/moved.ts): a link names
 * the page where it lives now. The router's table keeps old mail, pins and saved views working; new
 * code must not lean on it. An app a client's workspace also holds (CLIENT_HELD) moves only at
 * Wren, so its old address is still right for a client and is not checked here.
 *
 * Reads moved.ts itself (node strips its types), so the guard never keeps a second list.
 */
import { execFileSync } from "node:child_process";
import { CLIENT_HELD, MOVED, MOVED_APPS } from "../apps/portal/web/src/moved.ts";

const appOf = (href) => /^\/([^/?#]+)/.exec(href)?.[1] ?? "";
const old = [
  ...Object.keys(MOVED).filter((k) => !CLIENT_HELD.has(appOf(k))),
  ...Object.keys(MOVED_APPS)
    .filter((a) => !CLIENT_HELD.has(a))
    .map((a) => `/${a}`),
];
const esc = (s) => s.replace(/[/.-]/g, "\\$&");
// The old address in quotes or a template, then its end, a sub-path, a query or a hash.
const re = `["'\`](${old.map(esc).join("|")})([/?#"'\`]|$)`;

let out = "";
try {
  out = execFileSync(
    "git",
    [
      "grep",
      "--untracked",
      "-nE",
      re,
      "--",
      "packages",
      "apps",
      ":!*.test.ts",
      ":!*.test.tsx",
      ":!*/test/*",
      ":!apps/portal/web/src/moved.ts",
    ],
    { encoding: "utf8" },
  );
} catch (err) {
  if (err.status !== 1) throw err;
}
// A comment that names the old address (why a page moved) is history, not a link.
const hits = out
  .split("\n")
  .filter((l) => l && !/^[^:]+:\d+:\s*(\/\/|\/?\*)/.test(l) && !l.includes("/api/"));
if (hits.length) {
  console.error("Links to a moved address; name the new one (apps/portal/web/src/moved.ts):");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`ok: no links to ${old.length} moved addresses`);
