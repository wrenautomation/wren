#!/usr/bin/env node
/**
 * Every portal read goes through the data layer (designs/2026-10-15-one-write-path.md, "The data
 * layer"): `useCall`/`useLoad` in a component, `readCall`/`readCached` outside one, and a records
 * api from `recordsApi` (apps/portal/web/src/records-api.ts). Those reads have query keys, sit in
 * the local copy and read again on return; a read an effect keeps in its own state goes blank or
 * stale after a page switch, a reload or a tab away.
 *
 * Fails on:
 * - an effect (`useEffect`, `useLayoutEffect`) that awaits something (`.then(`, `await`), unless
 *   it says why in a `read-ok: <reason>` comment in it or within the three lines above (a live
 *   feed, a poll for a run's answer, a write that starts on arrival);
 * - a records api built outside `recordsApi` (a `types: () =>` literal), which keeps no copy.
 */
import { excused, lineAt, parenEnd, portalSources } from "./portal-sources.mjs";

const EFFECT = /\buse(?:Layout)?Effect\(/g;
const AWAITS = /\.then\(|\bawait\b/;
const RECORDS_API = /\btypes: \(\) =>/g;
/** The one builder of records apis, and the demo's in-browser copy of one. */
const BUILDERS = new Set([
  "apps/portal/web/src/records-api.ts",
  "packages/ui/src/records-local.ts",
]);

/** Files another branch is changing now, each with when it moves; empty this list as they land. */
const LATER = new Map([
  [
    "apps/portal/web/src/modules/marketing/engage.tsx",
    "its invites count moves after engage-threads",
  ],
]);

const bad = [];
for (const { file, text } of portalSources()) {
  if (LATER.has(file)) continue;
  for (const m of text.matchAll(EFFECT)) {
    const end = parenEnd(text, m.index + m[0].length - 1);
    if (!AWAITS.test(text.slice(m.index, end))) continue;
    if (excused(text, "read-ok:", m.index, end)) continue;
    bad.push(
      `${file}:${lineAt(text, m.index)}  an effect reads: use useCall/useLoad, or say read-ok: <reason>`,
    );
  }
  if (BUILDERS.has(file)) continue;
  for (const m of text.matchAll(RECORDS_API))
    bad.push(`${file}:${lineAt(text, m.index)}  a records api: build it with recordsApi`);
}

if (bad.length) {
  console.log(`${bad.length} portal reads sit outside the data layer`);
  for (const b of bad) console.log(`  ${b}`);
  process.exit(1);
}
