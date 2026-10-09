/** The page templates by id, and the one check every save goes through. */
import { lander } from "./lander.js";
import { listicle } from "./listicle.js";
import { page, sectionsOf } from "./page.js";
import { safeHref } from "./parts.js";
import { sectionOf } from "./sections.js";
import type { Content, CopyField, ItemValue, SectionValue, Template } from "./types.js";

export { priceLine } from "./lander.js";
export { sectionsOf } from "./page.js";
export { esc, safeHref } from "./parts.js";
export { SECTIONS, SECTIONS_MAX, type SectionType, sectionOf } from "./sections.js";
export type * from "./types.js";

export const TEMPLATES: Readonly<Record<string, Template>> = { lander, listicle, page };
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
export function checkContent(t: Pick<Template, "fields">, raw: unknown): Content {
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
    } else if (f.kind === "sections") {
      out[f.key] = checkSections(f, v);
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

const SECTION_ID = /^[a-z0-9-]{1,40}$/;

/** A Sections page's blocks: each checked by its own fields, ids kept or made, one form at most. */
function checkSections(f: CopyField, v: unknown): SectionValue[] {
  const xs = Array.isArray(v) ? v : v == null ? [] : null;
  if (!xs) throw new ContentProblem(`${f.label} takes a list`);
  if (!xs.length) throw new ContentProblem(`${f.label} needs at least one`);
  if (xs.length > f.max) throw new ContentProblem(`${f.label} takes at most ${f.max}`);
  const seen = new Set<string>();
  const out = xs.map((x, i) => {
    if (!x || typeof x !== "object") throw new ContentProblem(`Section ${i + 1} is empty`);
    const raw = x as Record<string, unknown>;
    const block = sectionOf(raw.type);
    if (!block) throw new ContentProblem(`Section ${i + 1} isn't a block: ${String(raw.type)}`);
    const id =
      typeof raw.id === "string" && SECTION_ID.test(raw.id) && !seen.has(raw.id)
        ? raw.id
        : globalThis.crypto.randomUUID().slice(0, 8);
    seen.add(id);
    try {
      const c = checkContent({ fields: block.fields }, raw);
      return { id, type: block.type, ...c } as SectionValue;
    } catch (err) {
      if (err instanceof ContentProblem)
        throw new ContentProblem(`Section ${i + 1} (${block.name}): ${err.message}`);
      throw err;
    }
  });
  if (out.filter((s) => s.type === "form").length > 1)
    throw new ContentProblem("a page takes one form");
  return out;
}

/** The hosted form a page names: its `form` field, or its form section's. */
export function formKeyOf(c: Content): string {
  if (typeof c.form === "string") return c.form.trim();
  const s = sectionsOf(c).find((x) => x.type === "form");
  return typeof s?.form === "string" ? s.form.trim() : "";
}

/** Every word a page says, one string per field or item: what the facts guard reads. */
export function wordsOf(
  t: Pick<Template, "fields">,
  c: Content,
): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const f of t.fields) {
    const v = c[f.key];
    if (f.kind === "url" || v === undefined) continue;
    if (f.kind === "sections") {
      sectionsOf(c).forEach((s, i) => {
        const block = sectionOf(s.type);
        if (!block) return;
        for (const w of wordsOf({ fields: block.fields }, s as Content))
          out.push({ label: `Section ${i + 1} (${block.name}): ${w.label}`, text: w.text });
      });
      continue;
    }
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

/**
 * A page's parts, as the editor groups them: a lander's or listicle's field groups (Top, Proof...),
 * or a Sections page's own fields then each section. What "Ask Claude on a part" rewrites.
 */
export type Part = { key: string; label: string; fields: CopyField[]; section?: string };

export function partsOf(t: Template, c: Content): Part[] {
  const out: Part[] = [];
  for (const f of t.fields) {
    if (f.kind === "sections") {
      sectionsOf(c).forEach((s, i) => {
        const b = sectionOf(s.type);
        if (b)
          out.push({
            key: `section:${s.id}`,
            label: `${i + 1}. ${b.name}`,
            fields: [...b.fields],
            section: s.id,
          });
      });
      continue;
    }
    const last = out[out.length - 1];
    if (f.group || !last || last.section)
      out.push({ key: `group:${f.group ?? "Copy"}`, label: f.group ?? "Copy", fields: [f] });
    else last.fields.push(f);
  }
  return out;
}
