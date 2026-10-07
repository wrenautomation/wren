/** The page templates by id, and the one check every save goes through. */
import { lander } from "./lander.js";
import { listicle } from "./listicle.js";
import { safeHref } from "./parts.js";
import type { Content, CopyField, ItemValue, Template } from "./types.js";

export { priceLine } from "./lander.js";
export { esc, safeHref } from "./parts.js";
export type * from "./types.js";

export const TEMPLATES: Readonly<Record<string, Template>> = { lander, listicle };
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as readonly string[];

/** A content check that failed: the field and why, in words a person reads. */
export class ContentProblem extends Error {}

export function templateOf(id: string | null | undefined): Template {
  const t = id && Object.hasOwn(TEMPLATES, id) ? TEMPLATES[id] : undefined;
  if (!t) throw new ContentProblem(`no such template: ${id ?? "none"}`);
  return t;
}

/** One line of a list field at most this long. */
const LINE_MAX = 300;

const okUrl = (s: string) => s === "#form" || safeHref(s) !== null;

function one(f: CopyField, v: unknown, where: string): string {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new ContentProblem(`${where} takes text`);
  const s = f.kind === "long" ? v.replace(/\r\n?/g, "\n").trim() : v.replace(/\s+/g, " ").trim();
  if (s.length > f.max) throw new ContentProblem(`${where} is over ${f.max} characters`);
  if (f.kind === "url" && s && !okUrl(s)) throw new ContentProblem(`${where} isn't a link`);
  return s;
}

/**
 * The content as stored: every field of the template, each checked against its kind and limit;
 * keys it doesn't have are dropped. Throws `ContentProblem` naming the field.
 */
export function checkContent(t: Template, raw: unknown): Content {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ContentProblem("content takes an object of fields");
  const input = raw as Record<string, unknown>;
  const out: Content = {};
  for (const f of t.fields) {
    const v = input[f.key];
    if (f.kind === "lines") {
      const xs =
        typeof v === "string" ? v.split("\n") : Array.isArray(v) ? v : v == null ? [] : null;
      if (!xs) throw new ContentProblem(`${f.label} takes one item per line`);
      const kept = xs
        .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : ""))
        .filter(Boolean);
      if (kept.length > f.max) throw new ContentProblem(`${f.label} takes at most ${f.max}`);
      if (kept.some((x) => x.length > LINE_MAX))
        throw new ContentProblem(`a line of ${f.label} is over ${LINE_MAX} characters`);
      if (!kept.length && !f.optional) throw new ContentProblem(`${f.label} needs at least one`);
      out[f.key] = kept;
    } else if (f.kind === "items") {
      const xs = Array.isArray(v) ? v : v == null ? [] : null;
      if (!xs) throw new ContentProblem(`${f.label} takes a list`);
      const kept: ItemValue[] = [];
      xs.forEach((x, i) => {
        if (!x || typeof x !== "object") throw new ContentProblem(`${f.label} ${i + 1} is empty`);
        const item: ItemValue = {};
        for (const sub of f.items ?? [])
          item[sub.key] = one(
            sub,
            (x as Record<string, unknown>)[sub.key],
            `${f.label} ${i + 1}: ${sub.label}`,
          );
        if (Object.values(item).some(Boolean)) kept.push(item);
      });
      if (kept.length > f.max) throw new ContentProblem(`${f.label} takes at most ${f.max}`);
      if (!kept.length && !f.optional) throw new ContentProblem(`${f.label} needs at least one`);
      out[f.key] = kept;
    } else {
      const s = one(f, v, f.label);
      if (!s && !f.optional) throw new ContentProblem(`${f.label} is empty`);
      out[f.key] = s;
    }
  }
  return out;
}

/** Every word a page says, one string per field or item: what the facts guard reads. */
export function wordsOf(t: Template, c: Content): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const f of t.fields) {
    const v = c[f.key];
    if (f.kind === "url" || v === undefined) continue;
    if (typeof v === "string") {
      if (v) out.push({ label: f.label, text: v });
    } else
      v.forEach((x, i) => {
        const text =
          typeof x === "string"
            ? x
            : Object.entries(x)
                .filter(([k]) => !/link$/.test(k))
                .map(([, s]) => s)
                .join("\n");
        if (text.trim()) out.push({ label: `${f.label} ${i + 1}`, text });
      });
  }
  return out;
}
