#!/usr/bin/env node
/**
 * The portal's routing, tables and forms stay on their libraries (designs/2026-10-16-portal-libs.md):
 * TanStack Router, TanStack Table, React Hook Form through `useEditForm`. Fails on:
 * - the history API outside the router (`history.pushState`/`replaceState`, a `popstate`
 *   listener), unless it says why in a `route-ok: <reason>` comment on it or the three lines above;
 * - a `<table>` outside the shared tables (`packages/ui/src/table.tsx`, and `rows.tsx`, the rows
 *   part every list draws), unless `table-ok: <reason>` (a document's own layout);
 * - a form read off the page (`new FormData(<form>)`), or `useKeptForm`, which `useEditForm`
 *   replaced; `new FormData()` that builds an upload is fine;
 * - a `<form>` in a file with no `useEditForm`/`EditForm`, `useEdit` (one box) or `useSaved` (the
 *   save engine's versioned documents), unless `form-ok: <reason>`.
 * Prints each place; exits 1.
 */
import { excused, lineAt, portalSources } from "./portal-sources.mjs";

/** The router's own files: the address goes through them. */
const ROUTER = new Set(["apps/portal/web/src/route.ts", "apps/portal/web/src/router.tsx"]);
const TABLE = "packages/ui/src/table.tsx";
const ROWS = "packages/ui/src/rows.tsx";

const RULES = [
  {
    re: /\bhistory\.(?:pushState|replaceState)\(|["']popstate["']/g,
    skip: (file) => ROUTER.has(file),
    mark: "route-ok:",
    says: "the history API outside the router: use navigate/href from route.ts",
  },
  {
    re: /<table\b/g,
    skip: (file) => file === TABLE || file === ROWS,
    mark: "table-ok:",
    says: "a hand-drawn table: use Rows, DataTable or FactsTable from @wren/ui",
  },
  {
    re: /\bnew FormData\(\s*[^)\s]|\buseKeptForm\(/g,
    skip: () => false,
    mark: "form-ok:",
    says: "form state read by hand: use useEditForm and its fields from @wren/ui",
  },
];

const FORM = /<form\b/g;
const ON_KIT = /\buseEditForm\b|\bEditForm\b|\buse(?:Edit|Saved)(?:<[^>]*>)?\(/;

const bad = [];
for (const { file, text } of portalSources()) {
  for (const rule of RULES) {
    if (rule.skip(file)) continue;
    for (const m of text.matchAll(rule.re)) {
      if (excused(text, rule.mark, m.index, m.index + m[0].length)) continue;
      bad.push(`${file}:${lineAt(text, m.index)}  ${rule.says}`);
    }
  }
  if (!file.endsWith(".tsx") || ON_KIT.test(text)) continue;
  for (const m of text.matchAll(FORM)) {
    if (excused(text, "form-ok:", m.index, m.index + m[0].length)) continue;
    bad.push(`${file}:${lineAt(text, m.index)}  a form with no useEditForm: use it and its fields`);
  }
}

if (bad.length) {
  console.log(`${bad.length} places skip the portal's router, table or form libraries:`);
  for (const b of bad) console.log(`  ${b}`);
  process.exit(1);
}
