/**
 * The copy test: words a client reads never apologize for the demo, never say "none yet",
 * never hand them a `wren` command and never show a snake_case name. Comments don't count.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = new URL(".", import.meta.url).pathname;
const BANNED: [string, RegExp][] = [
  ["on the demo", /on the demo/i],
  ["none yet", /none yet/i],
  ["a wren command", /\bwren [a-z]/],
];
/** A snake_case word, in text that reads as words (it has a space). */
const SNAKE = /\b[a-z]+_[a-z_]+\b/;
/** Attributes that never reach a reader as text. */
const QUIET_ATTRS = new Set([
  "className",
  "id",
  "key",
  "name",
  "href",
  "src",
  "type",
  "data-widget",
]);

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

/** Every piece of text in a file a reader could see: JSX text and string literals. */
function texts(path: string): { text: string; line: number; jsx: boolean }[] {
  const src = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const out: { text: string; line: number; jsx: boolean }[] = [];
  const at = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isJsxAttribute(n) && QUIET_ATTRS.has(n.name.getText(src))) return;
    if (ts.isJsxText(n)) out.push({ text: n.text, line: at(n), jsx: true });
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      out.push({ text: n.text, line: at(n), jsx: false });
    else if (ts.isTemplateExpression(n))
      out.push({
        text: [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" "),
        line: at(n),
        jsx: false,
      });
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

describe("copy", () => {
  const all = files(ROOT).flatMap((f) =>
    texts(f).map((t) => ({ ...t, where: `${relative(ROOT, f)}:${t.line}` })),
  );

  for (const [what, re] of BANNED)
    it(`never says ${what}`, () => {
      expect(all.filter((t) => re.test(t.text)).map((t) => t.where)).toEqual([]);
    });

  it("never shows a snake_case label", () => {
    const hits = all.filter(
      (t) => (t.jsx || /\s/.test(t.text.trim())) && SNAKE.test(t.text) && !/[{}();=]/.test(t.text),
    );
    expect(hits.map((t) => `${t.where} ${t.text.trim()}`)).toEqual([]);
  });
});
