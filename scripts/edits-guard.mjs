#!/usr/bin/env node
/**
 * Every editable box in the portal keeps its unsaved words in the one edits store
 * (designs/2026-10-15-one-write-path.md, "Unsaved edits"). A text box (`<Input>`, `<input>`,
 * `<Textarea>`, `<textarea>`) that takes a `value` must carry `data-edit` (spread from
 * `useEdit(...).field`, or set by a box on `useSaved` / `useKeptForm`), or say why its words
 * aren't kept: `edit-ok: <reason>` in a comment on the tag or within the three lines above
 * (a search box, a filter, a one-off question). Prints each box that does neither; exits 1.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOTS = ["apps/portal/web/src", "packages/ui/src"];
const SKIP = [/\.test\.tsx?$/, /\/components\/ui\//, /\/stories?\//];
const TAG = /<(Input|input|Textarea|textarea)\b/g;
/** Boxes whose words aren't text the person writes. */
const NOT_TEXT =
  /\btype=["'{](?:checkbox|radio|file|range|color|hidden|submit|button|date|time|datetime-local|month|week|number)["'}]/;

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", ...ROOTS],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .filter((f) => f.endsWith(".tsx") && !SKIP.some((r) => r.test(f)));

/** The opening tag from `at`: to the `>` that closes it, braces and strings balanced. */
function tagAt(text, at) {
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

const bad = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const m of text.matchAll(TAG)) {
    const tag = tagAt(text, m.index);
    if (!/\bvalue=/.test(tag)) continue;
    if (NOT_TEXT.test(tag) || /\breadOnly\b/.test(tag)) continue;
    if (/data-edit\b|\{\.\.\.[\w.]*(?:field|Field|edit|Edit)\b[\w.]*\}/.test(tag)) continue;
    if (/edit-ok:/.test(tag)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    const above = text
      .split("\n")
      .slice(Math.max(0, line - 4), line)
      .join("\n");
    if (/edit-ok:/.test(above)) continue;
    bad.push(`${f}:${line}`);
  }
}

if (bad.length) {
  console.log(
    `${bad.length} text boxes keep no unsaved words: use useEdit (spread .field), or say why with edit-ok: <reason>`,
  );
  for (const b of bad) console.log(`  ${b}`);
  process.exit(1);
}
