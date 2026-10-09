/**
 * Claude's first draft of a page's copy from an offer, checked by the facts guard
 * (`@wren/core/grounded`): a first-person claim no fact backs, or a number in neither the offer
 * nor the facts, gets one more try; flagged again, it's dropped and the offer's own fill stays.
 */
import { factsBlock } from "@wren/core/facts";
import { type Guarded, guardParts } from "@wren/core/grounded";
import type { Offer } from "@wren/offers";
import {
  ContentProblem,
  checkContent,
  type Part,
  partsOf,
  priceLine,
  SECTIONS,
  sectionOf,
  sectionsOf,
  wordsOf,
} from "./templates/index.js";
import type { Content, CopyField, SectionValue, Template } from "./templates/types.js";

/** A model: a prompt in, its text out. */
export type Write = (prompt: string) => Promise<string>;

const shape = (f: CopyField): string => {
  if (f.kind === "sections")
    return `- ${f.key} (array of sections): keep every section's id and type, in the same order; rewrite only their words. Each block's fields:\n${blocks()}`;
  const limit =
    f.kind === "lines" || f.kind === "items" ? `at most ${f.max}` : `at most ${f.max} characters`;
  const type =
    f.kind === "lines"
      ? "array of strings"
      : f.kind === "items"
        ? `array of objects {${(f.items ?? []).map((i) => `${i.key}: ${i.label}`).join(", ")}}`
        : "string";
  return `- ${f.key} (${type}, ${limit}${f.optional ? ", may be empty" : ""}): ${f.label}${f.hint ? `. ${f.hint}` : ""}`;
};

/** Every block a sections field may hold, each with its own fields, for the prompt. */
const blocks = (): string =>
  SECTIONS.map(
    (b) =>
      `  ${b.type}: ${b.fields
        .filter((x) => x.kind !== "url")
        .map((x) => shape(x).replace(/^- /, ""))
        .join("; ")}`,
  ).join("\n");

/**
 * The model's answer laid over the start, with what a model never picks put back: every link,
 * and a Sections page's order, ids and blocks. A section it drops keeps its start words.
 */
function keepFrame(t: Template, start: Content, raw: Record<string, unknown>): Content {
  const merged: Record<string, unknown> = { ...start, ...raw };
  for (const f of t.fields) {
    if (f.kind === "url") merged[f.key] = start[f.key] ?? "";
    if (f.kind !== "sections") continue;
    const said = Array.isArray(raw[f.key]) ? (raw[f.key] as Record<string, unknown>[]) : [];
    merged[f.key] = sectionsOf(start).map((s, i) => {
      const got = said.find((x) => x && x.id === s.id) ?? said[i];
      const fromModel = got && got.type === s.type ? got : {};
      const out: Record<string, unknown> = { ...s, ...fromModel, id: s.id, type: s.type };
      for (const x of sectionOf(s.type)?.fields ?? [])
        if (x.kind === "url") out[x.key] = s[x.key] ?? "";
      return out as SectionValue;
    });
  }
  return merged as Content;
}

/** What the offer says, as the source the guard checks numbers against. */
export function offerText(o: Offer): string[] {
  return [
    o.name,
    o.audience,
    o.promise,
    priceLine(o.price),
    ...o.youGet,
    ...o.youGive,
    o.guarantee ?? "",
    o.days ? `${o.days} days` : "",
    o.slots ? `${o.slots} slots` : "",
  ].filter(Boolean);
}

export function draftPrompt(
  t: Template,
  o: Offer,
  a: { angle?: string | null; audience?: string | null; facts: readonly string[]; start: Content },
  fix: string | null,
): string {
  return [
    `Write the copy for a ${t.name.toLowerCase()} page that sells one offer to cold traffic from ads.`,
    "",
    "The offer:",
    ...offerText(o).map((x) => `- ${x}`),
    a.audience ? `\nWho this page is for: ${a.audience}` : "",
    a.angle ? `The angle this page leads with: ${a.angle}` : "",
    "",
    factsBlock(a.facts),
    "",
    "Rules: plain words a person would say out loud. Short sentences. Lead with the outcome.",
    "No em dashes. No hype words. Claim nothing about us that the facts above don't say.",
    "Use no number that isn't in the offer or the facts. Leave proof empty unless a fact backs it.",
    "",
    "Fields:",
    ...t.fields.filter((f) => f.kind !== "url").map(shape),
    "",
    "Start from this draft and make it better:",
    JSON.stringify(a.start),
    fix ? `\nYour last try was flagged. Fix this: ${fix}` : "",
    "",
    "Answer with one JSON object of the fields, nothing else.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** The first JSON object in a model's answer. */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ContentProblem("the model answered no JSON");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ContentProblem("the model's JSON didn't parse");
  }
}

/**
 * A guarded draft. `text` is null when it was dropped; the content is then the start, so the
 * page still has the offer's own words.
 */
export async function draftCopy(
  write: Write,
  t: Template,
  o: Offer,
  a: { angle?: string | null; audience?: string | null; facts: readonly string[]; start: Content },
): Promise<Guarded<Content>> {
  return guardParts(
    async (fix) => {
      const raw = jsonIn(await write(draftPrompt(t, o, a, fix)));
      // Links stay the offer's: a model never picks where a button goes, nor a page's blocks.
      const content = checkContent(t, keepFrame(t, a.start, raw as Record<string, unknown>));
      return { parts: wordsOf(t, content), result: content };
    },
    { facts: a.facts, sources: offerText(o) },
  );
}

/**
 * Claude rewrites one part of a page (`partsOf`) to a person's ask, through the same facts guard as
 * a first draft. Only that part's words change: links, the other parts and a page's blocks stay.
 * The guard reads only the part; the page as it stands counts as a source, a person wrote it.
 */
export async function rewritePart(
  write: Write,
  t: Template,
  content: Content,
  a: { part: string; ask: string; facts: readonly string[]; offer: Offer | null },
): Promise<Guarded<Content>> {
  const part = partsOf(t, content).find((p) => p.key === a.part);
  if (!part) throw new ContentProblem(`no part ${a.part} on this page`);
  const words = (p: Part) => p.fields.filter((f) => f.kind !== "url");
  const section = part.section ? sectionsOf(content).find((s) => s.id === part.section) : null;
  const now: Record<string, unknown> = {};
  for (const f of words(part)) now[f.key] = (section ?? content)[f.key] ?? "";
  const page = wordsOf(t, content);
  const prompt = (fix: string | null) =>
    [
      `Rewrite one part of a ${t.name.toLowerCase()} page: ${part.label}.`,
      "",
      "What to change:",
      a.ask,
      "",
      "The whole page as it stands, for context:",
      ...page.map((w) => `- ${w.label}: ${w.text.replace(/\n/g, " / ")}`),
      "",
      a.offer
        ? `The offer:\n${offerText(a.offer)
            .map((x) => `- ${x}`)
            .join("\n")}\n`
        : "",
      factsBlock(a.facts),
      "",
      "Rules: plain words a person would say out loud. Short sentences. No em dashes. No hype words.",
      "Claim nothing about us that the facts above don't say. Use no number that isn't already on",
      "the page, in the offer or in the facts.",
      "",
      "This part's fields:",
      ...words(part).map(shape),
      "",
      "Its words now:",
      JSON.stringify(now),
      fix ? `\nYour last try was flagged. Fix this: ${fix}` : "",
      "",
      "Answer with one JSON object of this part's fields, nothing else.",
    ]
      .filter((l) => l !== "")
      .join("\n");
  return guardParts(
    async (fix) => {
      const raw = jsonIn(await write(prompt(fix))) as Record<string, unknown>;
      const got: Record<string, unknown> = {};
      for (const f of words(part)) if (f.key in raw) got[f.key] = raw[f.key];
      const next: Record<string, unknown> = section
        ? {
            ...content,
            sections: sectionsOf(content).map((s) => (s.id === section.id ? { ...s, ...got } : s)),
          }
        : { ...content, ...got };
      const checked = checkContent(t, next);
      const mine = section
        ? (sectionsOf(checked).find((s) => s.id === section.id) as Content | undefined)
        : checked;
      return {
        parts: mine ? wordsOf({ fields: part.fields }, mine) : [],
        result: checked,
      };
    },
    {
      facts: a.facts,
      sources: [...(a.offer ? offerText(a.offer) : []), ...page.map((w) => w.text)],
    },
  );
}
