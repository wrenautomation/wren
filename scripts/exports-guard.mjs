#!/usr/bin/env node
/**
 * A module's export list is its interface (designs/2026-10-24-code-quality-handoff.md, round 2).
 * Two findings, over every .ts/.tsx under apps/ and packages/ (tests, stories, mocks and fixtures
 * count as readers, never as sources):
 *   dead     an export no other file names, that its own file does not use either: delete it
 *   private  a value (function, const, class) only its own file uses: drop `export`
 * A name counts as read when any ts/tsx file, or any mjs/js/json/sh/yml/toml under the repo (wrangler names a Durable Object class), holds it as
 * an identifier or string (Restate handlers and consoles are reached by name). Types only read by
 * their own file keep `export`: declaration emit may need the name when another module's exported
 * function returns them by inference. Skipped: default exports (imported under another name),
 * files imported as a namespace, drizzle schema files and `pgView`/`pgTable` declarations (read by
 * drizzle-kit and SQL by path and name), and the @wren/ui files `.engine/entry.ts` serves to pages.
 * Prints each finding; exits 1 when there is one.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const SKIP = /node_modules|\/dist\/|\/drizzle\/|\.d\.ts$/;
const READER = /\.(test|stories|spec)\.[jt]sx?$|\/(test|tests|__tests__|mocks|fixtures)\//;
const SCHEMA = /schema\.ts$/;
const DRIZZLE = /\b(pgView|pgTable|pgMaterializedView)\(|\.(view|table|materializedView)\(/;

const walk = (dir, keep, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(`${p}/`) || /\.git\//.test(`${p}/`)) continue;
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep.test(p)) out.push(p);
  }
  return out;
};
const source = (f) =>
  ts.createSourceFile(
    f,
    fs.readFileSync(f, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
const line = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

/** The @wren/ui modules the artifact engine re-exports whole: pages reach their names at runtime. */
const engine = new Set();
const entry = path.join(root, "packages/ui/.engine/entry.ts");
if (fs.existsSync(entry))
  for (const st of source(entry).statements)
    if (
      ts.isExportDeclaration(st) &&
      !st.exportClause &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    )
      engine.add(path.resolve(path.dirname(entry), st.moduleSpecifier.text).replace(/\.js$/, ""));
const served = (f) =>
  engine.has(f.replace(/\.tsx?$/, "")) || engine.has(f.replace(/\/index\.tsx?$/, ""));

const files = walk(root, /\.(ts|tsx|mts|cts)$/).filter((f) =>
  /^(apps|packages)\//.test(path.relative(root, f)),
);
const readers = new Map(); // name -> files holding it as an identifier or string
const nsImported = new Set();
const exportsOf = new Map(); // source file -> [{ name, line, kind, localUses }]
for (const f of files) {
  const sf = source(f);
  const seen = new Map(); // name -> identifier count in this file
  (function visit(n) {
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      seen.set(n.text, (seen.get(n.text) ?? 0) + 1);
    ts.forEachChild(n, visit);
  })(sf);
  for (const name of seen.keys())
    (readers.get(name) ?? readers.set(name, new Set()).get(name)).add(f);
  for (const st of sf.statements) {
    const ns =
      ts.isImportDeclaration(st) &&
      st.importClause?.namedBindings &&
      ts.isNamespaceImport(st.importClause.namedBindings);
    const spec = ns || (ts.isExportDeclaration(st) && !st.exportClause) ? st.moduleSpecifier : null;
    if (spec && ts.isStringLiteral(spec) && spec.text.startsWith("."))
      nsImported.add(path.resolve(path.dirname(f), spec.text).replace(/\.js$/, ""));
  }
  if (READER.test(f) || SCHEMA.test(f) || served(f)) continue;
  const ex = [];
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [];
    if (
      !mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
      mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    )
      continue;
    const add = (name, node, kind) =>
      ex.push({ name, line: line(sf, node), kind, localUses: (seen.get(name) ?? 0) - 1 });
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st))
      st.name && add(st.name.text, st, "value");
    else if (
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) ||
      ts.isEnumDeclaration(st)
    )
      add(st.name.text, st, "type");
    else if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && !DRIZZLE.test(d.initializer?.getText() ?? ""))
          add(d.name.text, d, "value");
  }
  if (ex.length) exportsOf.set(f, ex);
}
const otherNames = new Set();
for (const f of walk(root, /\.(mjs|cjs|js|json|sh|yml|yaml|toml|jsonc)$/))
  for (const m of fs.readFileSync(f, "utf8").matchAll(/[A-Za-z_$][\w$]*/g)) otherNames.add(m[0]);

const bad = [];
for (const [f, ex] of exportsOf) {
  if (nsImported.has(f.replace(/\.tsx?$/, "")) || nsImported.has(f.replace(/\/index\.tsx?$/, "")))
    continue;
  for (const { name, line, kind, localUses } of ex) {
    if (otherNames.has(name) || [...(readers.get(name) ?? [])].some((r) => r !== f)) continue;
    const at = `${path.relative(root, f)}:${line}`;
    if (localUses === 0) bad.push(`${at}  dead     ${name}: nothing reads it; delete it`);
    else if (kind === "value")
      bad.push(`${at}  private  ${name}: only this file reads it; drop \`export\``);
  }
}
if (bad.length) {
  console.log(
    `${bad.length} export${bad.length === 1 ? "" : "s"} no other file reads (scripts/exports-guard.mjs):\n  ${bad.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`exports: every one is read by another file (${exportsOf.size} modules)`);
