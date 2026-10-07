/**
 * Preview surfaces for the authoring loop: see the copy before anything composes.
 *
 * Placeholder facts render «first_name»-style tokens so structure reviews without a
 * database; enumeration walks every variant combination — the QA pass that replaces
 * proofreading hundreds of composed drafts.
 */
import type { FactValues } from "./pickers.js";
import { type Block, type Rendered, render, type Template, templateVersion } from "./tree.js";

function* walk(tpl: Template): Generator<Block> {
  function* visit(blocks: readonly Block[]): Generator<Block> {
    for (const block of blocks) {
      yield block;
      if (block.kind === "group") yield* visit(block.blocks);
      else if (block.kind === "variants") for (const option of block.options) yield* visit(option);
    }
  }
  yield* visit([...(tpl.subject ?? []), ...tpl.body]);
}

/** Every fact key the template can reference, in document order. */
export function fieldKeys(tpl: Template): string[] {
  const keys: string[] = [];
  for (const block of walk(tpl)) {
    if (block.kind === "field" && !keys.includes(block.key)) keys.push(block.key);
  }
  return keys;
}

/**
 * What a model fill reads as before it runs: its prompt's first clause, without the length rule.
 * "The topic of this video in 3 to 8 words, written ..." reads "topic of this video".
 */
export function promptLabel(prompt: string): string {
  const clause = (prompt.split(/[.,;:\n(]/)[0] ?? "")
    .replace(/\s+in\s+\d+(\s*(to|-)\s*\d+)?\s+words?\b.*$/i, "")
    .replace(/^(write|give|name|say)\s+/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .trim();
  const words = clause.split(/\s+/).filter(Boolean);
  const short = words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
  return short ? short.charAt(0).toLowerCase() + short.slice(1) : "a line";
}

/** «key» for each fact, and «AI: what it writes» for a model fill, so nothing reads as a hash. */
export function placeholderFacts(tpl: Template): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of walk(tpl))
    if (block.kind === "field" && !(block.key in out))
      out[block.key] = block.prompt ? `«AI: ${promptLabel(block.prompt)}»` : `«${block.key}»`;
  return out;
}

/** Variant-point name -> option count, in document order. */
export function variantCounts(tpl: Template): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const block of walk(tpl))
    if (block.kind === "variants") counts[block.name] = block.options.length;
  return counts;
}

function refit(block: Block, choices: Record<string, number>): Block {
  if (block.kind === "variants") return { ...block, picker: { kind: "fixed", choices } };
  if (block.kind === "group") {
    return {
      ...block,
      blocks: block.blocks.map((b) => refit(b, choices) as typeof b),
    };
  }
  return block;
}

/**
 * Render every variant combination (one render when there are none). Provenance on these
 * renders reflects the forced picks; the version stamp stays the authored template's.
 */
export function* enumerateRenders(
  tpl: Template,
  facts: FactValues,
): Generator<[choices: Record<string, number>, rendered: Rendered]> {
  const sizes = variantCounts(tpl);
  const names = Object.keys(sizes);
  const combos: number[][] = [[]];
  for (const name of names) {
    const size = sizes[name] as number;
    const next: number[][] = [];
    for (const combo of combos) for (let i = 0; i < size; i++) next.push([...combo, i]);
    combos.length = 0;
    combos.push(...next);
  }
  for (const combo of combos) {
    const choices = Object.fromEntries(names.map((n, i) => [n, combo[i] as number]));
    const subject = tpl.subject === null ? null : tpl.subject.map((b) => refit(b, choices));
    const body = tpl.body.map((b) => refit(b, choices));
    const fixed: Template = {
      name: tpl.name,
      subject,
      body,
      version: templateVersion(subject, body),
    };
    yield [choices, render(fixed, facts, "enumerate")];
  }
}
