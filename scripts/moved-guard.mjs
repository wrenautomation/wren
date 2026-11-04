#!/usr/bin/env node
/**
 * No code links to an address the portal router moves (apps/portal/web/src/moved.ts): a link names
 * the page where it lives now. The router's table keeps old mail, pins and saved views working; new
 * code must not lean on it.
 *
 * Reads moved.ts itself (node strips its types), so the guard never keeps a second list.
 */
import { execFileSync } from "node:child_process";
import { CLIENT_MOVED, MOVED, MOVED_APPS } from "../apps/portal/web/src/moved.ts";

const old = [
  ...Object.keys(MOVED),
  ...Object.keys(CLIENT_MOVED),
  ...Object.keys(MOVED_APPS).map((a) => `/${a}`),
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
      // Not portal links: migrations and stored views (old links redirect), other hosts' paths.
      ":!packages/db/drizzle/*",
      ":!packages/starling/inbound/src/schema.ts",
      ":!packages/core/src/profiles-schema.ts",
      ":!packages/starling/channels/linkedin/src/content.ts",
      ":!packages/research/src/enrichment/ad-library.ts",
      ":!packages/voice/src/transports/*",
      ":!apps/phone/*",
    ],
    { encoding: "utf8", maxBuffer: 64 << 20 },
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
