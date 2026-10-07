/**
 * Claude's first draft of a page's copy from an offer, checked by the facts guard
 * (`@wren/core/grounded`): a first-person claim no fact backs, or a number in neither the offer
 * nor the facts, gets one more try; flagged again, it's dropped and the offer's own fill stays.
 */
import { factsBlock } from "@wren/core/facts";
import { type Guarded, guardParts } from "@wren/core/grounded";
import type { Offer } from "@wren/offers";
import { ContentProblem, checkContent, priceLine, wordsOf } from "./templates/index.js";
import type { Content, CopyField, Template } from "./templates/types.js";

/** A model: a prompt in, its text out. */
export type Write = (prompt: string) => Promise<string>;

const shape = (f: CopyField): string => {
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
      const merged = { ...a.start, ...(raw as Record<string, unknown>) };
      // Links stay the offer's: a model never picks where a button goes.
      for (const f of t.fields) if (f.kind === "url") merged[f.key] = a.start[f.key] ?? "";
      const content = checkContent(t, merged);
      return { parts: wordsOf(t, content), result: content };
    },
    { facts: a.facts, sources: offerText(o) },
  );
}
