/**
 * What the portal guards read (`edits-guard.mjs`, `reads-guard.mjs`): the portal web's and
 * @wren/ui's .ts/.tsx sources, tracked or new, without tests, stories or the generated ui kit.
 * `repoFiles` lists any folder the same way (`map/_meta/scorecard.mjs`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOTS = ["apps/portal/web/src", "packages/ui/src"];
const SKIP = [/\.test\.tsx?$/, /\/components\/ui\//, /\/stories?\//];

/** Every file under `roots`, tracked or new, ignored ones left out; paths from the repo root. */
export function repoFiles(roots) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...roots], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** Each source as `{ file, text }`; `exts` picks the endings (".tsx" alone for markup). */
export function portalSources(exts = [".ts", ".tsx"]) {
  return repoFiles(ROOTS)
    .filter((f) => exts.some((e) => f.endsWith(e)) && !SKIP.some((r) => r.test(f)))
    .flatMap((file) => {
      try {
        return [{ file, text: readFileSync(file, "utf8") }];
      } catch {
        return [];
      }
    });
}

/** The 1-based line of offset `at` in `text`. */
export const lineAt = (text, at) => text.slice(0, at).split("\n").length;

/** Does `text` say `mark` (an `edit-ok:` reason) inside `[from, to)` or in the three lines above? */
export function excused(text, mark, from, to) {
  if (text.slice(from, to).includes(mark)) return true;
  const line = lineAt(text, from);
  return text
    .split("\n")
    .slice(Math.max(0, line - 4), line)
    .join("\n")
    .includes(mark);
}

/** The opening tag from `at`: to the `>` that closes it, braces and strings balanced. */
export function tagAt(text, at) {
  let depth = 0;
  let quote = null;
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (depth > 0 && (c === '"' || c === "'" || c === "`")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return text.slice(at, i + 1);
  }
  return text.slice(at);
}

/** The offset just past the `)` that closes the `(` at `at`; strings and comments skipped. */
export function parenEnd(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/")
      i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 1 || text.length;
    else if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}
