#!/usr/bin/env node
/**
 * Every portal read goes through the data layer (designs/2026-10-15-one-write-path.md, "The data
 * layer"): `useCall`/`useLoad` in a component, `readCall`/`readCached` outside one, and a records
 * api from `recordsApi` (apps/portal/web/src/records-api.ts). Those reads have query keys, sit in
 * the local copy and read again on return; a read an effect keeps in its own state goes blank or
 * stale after a page switch, a reload or a tab away.
 *
 * Fails on:
 * - an effect (`useEffect`, `useLayoutEffect`) that awaits something (`.then(`, `await`), or
 *   that itself calls an async function (exported from any portal file, or declared in its own),
 *   unless it says why in a `read-ok: <reason>` comment in it or within the three lines above (a
 *   live feed, a poll for a run's answer, a write that starts on arrival). A call inside a
 *   handler the effect sets up (a key, a timer) runs later, not as the effect: not counted;
 * - a records api built outside `recordsApi` (a `types: () =>` literal), which keeps no copy.
 */
import { excused, lineAt, parenEnd, portalSources } from "./portal-sources.mjs";

const EFFECT = /\buse(?:Layout)?Effect\(/g;
const AWAITS = /\.then\(|\bawait\b/;
const RECORDS_API = /\btypes: \(\) =>/g;
/** Async functions: exported (callable from any file), and any declared in a file (its own). */
const EXPORTED = /\bexport\s+async\s+function\s+(\w+)|\bexport\s+const\s+(\w+)\s*=\s*async\b/g;
const DECLARED = /\basync\s+function\s+(\w+)|\bconst\s+(\w+)\s*=\s*(?:useCallback\(\s*)?async\b/g;
const CALL = /\b(\w+)\(/g;

/**
 * An effect's text without the functions it defines inside: what runs as the effect itself. A
 * nested `=> {...}` or `function () {...}` body goes; a `=> expr` arrow goes to the `,` or `)`
 * that ends it.
 */
function ownBody(body) {
  const first = body.indexOf("=>");
  if (first < 0) return body;
  let out = body.slice(0, first + 2);
  let i = first + 2;
  const NESTED = /=>\s*|function\s*\w*\s*\([^)]*\)\s*/y;
  while (i < body.length) {
    NESTED.lastIndex = i;
    const m = body.startsWith("=>", i) || body.startsWith("function", i) ? NESTED.exec(body) : null;
    if (!m) {
      out += body[i];
      i += 1;
      continue;
    }
    let j = i + m[0].length;
    if (body[j] === "{") {
      for (let depth = 0; j < body.length; j++) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}" && --depth === 0) break;
      }
      i = j + 1;
    } else {
      for (let depth = 0; j < body.length; j++) {
        const c = body[j];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
          if (depth === 0) break;
          depth--;
        } else if ((c === "," || c === ";" || c === "\n") && depth === 0) break;
      }
      i = j;
    }
  }
  return out;
}
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

const sources = portalSources();
const loaders = new Set(
  sources.flatMap(({ text }) => [...text.matchAll(EXPORTED)].map((m) => m[1] ?? m[2])),
);
const bad = [];
for (const { file, text } of sources) {
  if (LATER.has(file)) continue;
  const own = new Set([...text.matchAll(DECLARED)].map((m) => m[1] ?? m[2]));
  const isAsync = (name) => loaders.has(name) || own.has(name);
  for (const m of text.matchAll(EFFECT)) {
    const end = parenEnd(text, m.index + m[0].length - 1);
    const body = text.slice(m.index, end);
    const calls = [...ownBody(body).matchAll(CALL)].some((c) => isAsync(c[1]));
    if (!AWAITS.test(body) && !calls) continue;
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
