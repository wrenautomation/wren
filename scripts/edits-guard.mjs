#!/usr/bin/env node
/**
 * Every editable box in the portal keeps its unsaved words in the one edits store
 * (designs/2026-10-15-one-write-path.md, "Unsaved edits"). A text box (`<Input>`, `<input>`,
 * `<Textarea>`, `<textarea>`) that takes a `value` must carry `data-edit` (spread from
 * `useEdit(...).field`, or set by a box on `useSaved` / `useKeptForm`), or say why its words
 * aren't kept: `edit-ok: <reason>` in a comment on the tag or within the three lines above
 * (a search box, a filter, a one-off question). Prints each box that does neither; exits 1.
 */
import { excused, lineAt, portalSources, tagAt } from "./portal-sources.mjs";

const TAG = /<(Input|input|Textarea|textarea)\b/g;
/** Boxes whose words aren't text the person writes. */
const NOT_TEXT =
  /\btype=["'{](?:checkbox|radio|file|range|color|hidden|submit|button|date|time|datetime-local|month|week|number)["'}]/;

const bad = [];
for (const { file, text } of portalSources([".tsx"])) {
  for (const m of text.matchAll(TAG)) {
    const tag = tagAt(text, m.index);
    if (!/\bvalue=/.test(tag)) continue;
    if (NOT_TEXT.test(tag) || /\breadOnly\b/.test(tag)) continue;
    if (/data-edit\b|\{\.\.\.[\w.]*(?:field|Field|edit|Edit)\b[\w.]*\}/.test(tag)) continue;
    if (excused(text, "edit-ok:", m.index, m.index + tag.length)) continue;
    bad.push(`${file}:${lineAt(text, m.index)}`);
  }
}

if (bad.length) {
  console.log(
    `${bad.length} text boxes keep no unsaved words: use useEdit (spread .field), or say why with edit-ok: <reason>`,
  );
  for (const b of bad) console.log(`  ${b}`);
  process.exit(1);
}
