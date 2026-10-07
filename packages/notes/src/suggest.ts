/**
 * Suggestions (designs/2026-10-07-notes.md, batch 2): text added in suggest mode carries a
 * `suggestAdd` mark and text removed stays with a `suggestDel` mark, each naming who and when.
 * A commenter may only suggest: the server takes their change when the body without their own
 * suggestions reads the same before and after. Pure, for the server and the browser.
 */
import { type NoteJson, SUGGEST_ADD, SUGGEST_DEL } from "./types.js";

type Mark = NonNullable<NoteJson["marks"]>[number];

const byOf = (m: Mark) => String(m.attrs?.by ?? "").toLowerCase();

/** The body with `by`'s own suggestions taken back: their added text out, their removals kept. */
export function withoutSuggestionsBy(json: NoteJson, by: string): NoteJson {
  const me = by.toLowerCase();
  const walk = (n: NoteJson): NoteJson | null => {
    if (n.type === "text") {
      const marks = n.marks ?? [];
      if (marks.some((m) => m.type === SUGGEST_ADD && byOf(m) === me)) return null;
      const kept = marks.filter((m) => !(m.type === SUGGEST_DEL && byOf(m) === me));
      const out: NoteJson = { type: "text", text: n.text ?? "" };
      if (kept.length) out.marks = kept;
      return out.text ? out : null;
    }
    const out: NoteJson = { type: n.type };
    if (n.attrs) out.attrs = n.attrs;
    if (n.marks?.length) out.marks = n.marks;
    if (n.content) out.content = merged(n.content.map(walk).filter((k): k is NoteJson => !!k));
    return out;
  };
  return walk(json) ?? { type: "doc", content: [] };
}

const markKey = (marks: readonly Mark[] | undefined) =>
  JSON.stringify(
    [...(marks ?? [])]
      .map((m) => [m.type, m.attrs ?? {}])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

/** Neighbouring text with the same marks as one run, so a split reads as no change. */
function merged(kids: NoteJson[]): NoteJson[] {
  const out: NoteJson[] = [];
  for (const k of kids) {
    const last = out.at(-1);
    if (last?.type === "text" && k.type === "text" && markKey(last.marks) === markKey(k.marks))
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (k.text ?? "") };
    else out.push(k);
  }
  return out;
}

const shape = (json: NoteJson, by: string) => {
  const n = withoutSuggestionsBy(json, by);
  return JSON.stringify(n, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
};

/** Whether going from `before` to `after` only adds or takes back `by`'s own suggestions. */
export const onlySuggests = (before: NoteJson, after: NoteJson, by: string): boolean =>
  shape(before, by) === shape(after, by);
