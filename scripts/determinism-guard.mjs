#!/usr/bin/env node
/**
 * Handler code replays (designs/2026-11-09-own-runtime.md, "Tests and lints first"): a value read
 * outside `ctx.run` must come out the same on every replay. Inside a function that takes a durable
 * context, these fail outside a `ctx.run` callback: clock reads, random values, `fetch`.
 * Use `ctx.date.now()`, `ctx.rand`, or wrap the call in `ctx.run`.
 *
 * Syntax only (no type checker: memory). A handler = a function with a parameter typed `*Context`
 * from the runtime. Helpers that take no context are not seen; pass them the context or a value.
 * A call run later inside a ctx.run (a callback a helper wraps) takes `// replay-safe: <why>` on its
 * line or the line above.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const CTX_TYPE = /^(?:restate\.|rt\.)?(?:Object|ObjectShared|Workflow|WorkflowShared)?Context\b/;

const files = execFileSync(
  "git",
  ["grep", "-l", "--untracked", "Context", "--", "packages", "apps"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(
    (f) => f.endsWith(".ts") && !/\.test\.ts$|\.d\.ts$|\/dist\/|\/test\/|\.stories\./.test(f),
  );

const isFn = (n) =>
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n);

/** Name of the durable-context parameter, if this function takes one. */
const ctxParam = (fn, sf) => {
  for (const p of fn.parameters ?? []) {
    if (p.type && CTX_TYPE.test(p.type.getText(sf)) && ts.isIdentifier(p.name)) return p.name.text;
  }
  return undefined;
};

/** `ctx.run(name, fn)` / `ctx.run(fn)`: is `fn` (a function node) a run callback? */
const isRunCallback = (fn) => {
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(fn)) return false;
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "run";
};

const kindOf = (node, sf) => {
  if (ts.isCallExpression(node)) {
    const t = node.expression.getText(sf);
    if (t === "Date.now") return "Date.now";
    if (t === "Date") return "Date()";
    if (t === "Math.random") return "Math.random";
    if (t === "crypto.randomUUID" || t === "randomUUID") return "randomUUID";
    if (t === "performance.now") return "performance.now";
    if (t === "fetch" || t === "globalThis.fetch") return "fetch";
  }
  if (ts.isNewExpression(node) && node.expression.getText(sf) === "Date") {
    if (!node.arguments || node.arguments.length === 0) return "new Date()";
  }
  return undefined;
};

const found = new Map(); // `file:kind` → [line...]
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/@restatedev\/restate-sdk|@wren\/runtime/.test(text)) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split("\n");
  const safe = (node) => {
    const l = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    return /replay-safe:/.test(lines[l]) || /replay-safe:/.test(lines[l - 1] ?? "");
  };
  /** inHandler: inside a context-taking function, and not inside one of its run callbacks. */
  const walk = (node, inHandler) => {
    let next = inHandler;
    if (isFn(node)) {
      if (ctxParam(node, sf)) next = true;
      else if (inHandler && isRunCallback(node)) next = false;
    }
    if (next) {
      const kind = kindOf(node, sf);
      if (kind && !safe(node)) {
        const key = `${file}:${kind}`;
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        found.set(key, [...(found.get(key) ?? []), line]);
      }
    }
    ts.forEachChild(node, (c) => walk(c, next));
  };
  walk(sf, false);
}

let bad = 0;
for (const [key, lines] of found) {
  bad += lines.length;
  const i = key.lastIndexOf(":");
  console.error(
    `${key.slice(0, i)}:${lines.join(",")} ${key.slice(i + 1)} in a handler outside ctx.run: use ctx.date / ctx.rand, wrap it in ctx.run, or mark the line "// replay-safe: <why>"`,
  );
}
if (bad) process.exit(1);
console.log(`determinism: ${files.length} files clean`);
