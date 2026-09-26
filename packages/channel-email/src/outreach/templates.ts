/**
 * Email templates as pure data.
 *
 * A template is a tree of three block types — text, field, variants — plus group, the
 * structural absence boundary. Every word a rendered email can contain is human-authored;
 * render() only assembles and records what it chose. No callables live in the tree, so a
 * template is content-hashable: `version` changes exactly when the authored words change.
 *
 * Absence is structural, never stringly:
 * - a bare field with no value refuses the draft (MissingFactError)
 * - field(key, fallback) renders the fallback and records that it did
 * - anything missing inside a group drops the whole group silently
 * - a variants option needing a missing fact is ineligible; no eligible option = missing fact
 */
import { createHash } from "node:crypto";
import { type FactValues, factText, HASH_PICK, type Picker, pickOption } from "./pickers.js";
import { type PyValue, pyRepr, pyReprStr } from "./pyrepr.js";

/** A required fact (or an entire variant point) has no value: the draft is refused. */
export class MissingFactError extends Error {
  override readonly name = "MissingFactError";
}

export interface TextBlock {
  readonly kind: "text";
  readonly text: string;
}
export interface FieldBlock {
  readonly kind: "field";
  readonly key: string;
  readonly fallback: string | null;
}
/** One variant option: a non-empty run of text/field blocks. */
export type Option = readonly (TextBlock | FieldBlock)[];
export interface VariantsBlock {
  readonly kind: "variants";
  readonly name: string;
  readonly options: readonly Option[];
  readonly picker: Picker;
}
export interface GroupBlock {
  readonly kind: "group";
  readonly blocks: readonly (TextBlock | FieldBlock | VariantsBlock)[];
}
export type Block = TextBlock | FieldBlock | VariantsBlock | GroupBlock;

export interface Template {
  readonly name: string;
  /** null marks a follow-up that rides its thread instead of opening a new one. */
  readonly subject: readonly Block[] | null;
  readonly body: readonly Block[];
  /** Content hash: changes iff the authored words or structure change. Python-parity. */
  readonly version: string;
}

export function text(value: string): TextBlock {
  if (!value) throw new Error("a Text block cannot be empty");
  return { kind: "text", text: value };
}

export function field(key: string, fallback: string | null = null): FieldBlock {
  if (!key) throw new Error("a Field block needs a fact key");
  return { kind: "field", key, fallback };
}

/** A variant option given as a bare string is one text block. */
export type OptionInput = string | TextBlock | FieldBlock | Option;

function asOption(option: OptionInput): Option {
  if (typeof option === "string") return [text(option)];
  if (Array.isArray(option)) {
    if (option.length === 0) throw new TypeError("a variant option is a non-empty run of blocks");
    return option as Option;
  }
  return [option as TextBlock | FieldBlock];
}

export function variants(
  name: string,
  options: readonly OptionInput[],
  picker: Picker = HASH_PICK,
): VariantsBlock {
  if (!name) throw new Error("a Variants block needs a name");
  const normalized = options.map(asOption);
  if (normalized.length === 0) throw new Error(`variant ${pyReprStr(name)} has no options`);
  if (picker.kind === "rule") {
    for (const r of picker.rules) {
      if (r.option >= normalized.length) {
        throw new Error(
          `variant ${pyReprStr(name)}: rule targets option ${r.option}` +
            ` but there are only ${normalized.length} options`,
        );
      }
    }
  }
  return { kind: "variants", name, options: normalized, picker };
}

export function group(blocks: readonly (TextBlock | FieldBlock | VariantsBlock)[]): GroupBlock {
  if (blocks.length === 0) throw new Error("a Group cannot be empty");
  if (!blocks.some((b) => b.kind === "field" || b.kind === "variants")) {
    throw new Error("a Group of pure Text can never be absent — inline it");
  }
  return { kind: "group", blocks: [...blocks] };
}

function* variantNames(blocks: readonly Block[]): Generator<string> {
  for (const block of blocks) {
    if (block.kind === "variants") yield block.name;
    else if (block.kind === "group") yield* variantNames(block.blocks);
  }
}

/** Structural projection: tagged AUTHORED content only — never a variant's auto-name. */
function project(block: Block): PyValue {
  switch (block.kind) {
    case "text":
      return ["t", block.text];
    case "field":
      return ["f", block.key, block.fallback];
    case "variants":
      return ["v", block.options.map((option) => option.map(project))];
    case "group":
      return ["g", block.blocks.map(project)];
  }
}

export function templateVersion(subject: readonly Block[] | null, body: readonly Block[]): string {
  const projection: PyValue = [subject === null ? null : subject.map(project), body.map(project)];
  return createHash("sha256").update(pyRepr(projection), "utf8").digest("hex").slice(0, 12);
}

export function template(
  name: string,
  subject: readonly Block[] | null,
  body: readonly Block[],
): Template {
  if (!name) throw new Error("a Template needs a name");
  if (body.length === 0) throw new Error(`template ${pyReprStr(name)} has an empty body`);
  if (subject !== null && subject.length === 0) {
    throw new Error(`template ${pyReprStr(name)}: empty subject — use None to ride the thread`);
  }
  const seen = new Set<string>();
  for (const v of variantNames([...(subject ?? []), ...body])) {
    if (seen.has(v)) {
      throw new Error(`template ${pyReprStr(name)}: variant ${pyReprStr(v)} appears twice`);
    }
    seen.add(v);
  }
  return {
    name,
    subject: subject === null ? null : [...subject],
    body: [...body],
    version: templateVersion(subject, body),
  };
}

export interface RenderProvenance {
  readonly template: string;
  readonly version: string;
  readonly seed: string;
  readonly picks: Readonly<Record<string, number>>;
  readonly fields: readonly string[];
  readonly fallbacks: readonly string[];
}

/** One assembled email plus the record of every choice made. */
export interface Rendered {
  readonly subject: string | null;
  readonly body: string;
  readonly provenance: RenderProvenance;
}

interface State {
  picks: Map<string, number>;
  fields: Set<string>;
  fallbacks: Set<string>;
}
const newState = (): State => ({ picks: new Map(), fields: new Set(), fallbacks: new Set() });
function merge(into: State, from: State): void {
  for (const [k, v] of from.picks) into.picks.set(k, v);
  for (const f of from.fields) into.fields.add(f);
  for (const f of from.fallbacks) into.fallbacks.add(f);
}

/**
 * Assemble one email for one recipient. Pure: the same template, facts and seed always
 * produce the same text, so a stored draft can be re-rendered and diffed instead of trusted.
 */
export function render(tpl: Template, facts: FactValues, seed: string): Rendered {
  if (!seed) throw new Error("render needs a non-empty seed (the recipient identity)");
  // Scoped per template so one recipient's picks across a sequence don't all land on the
  // same option index just because every file's first variant point is auto-named "v1".
  const pickSeed = `${tpl.name}\x00${seed}`;
  const state = newState();
  const body = tidy(renderBlocks(tpl.body, facts, pickSeed, state));
  if (!body) throw new MissingFactError(`template ${pyReprStr(tpl.name)}: the body rendered empty`);
  let subject: string | null = null;
  if (tpl.subject !== null) {
    subject = tidy(renderBlocks(tpl.subject, facts, pickSeed, state).replaceAll("\n", " "));
    if (!subject) {
      throw new MissingFactError(`template ${pyReprStr(tpl.name)}: the subject rendered empty`);
    }
  }
  return {
    subject,
    body,
    provenance: {
      template: tpl.name,
      version: tpl.version,
      seed,
      picks: Object.fromEntries(state.picks),
      fields: [...state.fields].sort(),
      fallbacks: [...state.fallbacks].sort(),
    },
  };
}

function renderBlocks(
  blocks: readonly Block[],
  facts: FactValues,
  pickSeed: string,
  state: State,
): string {
  return blocks.map((b) => renderBlock(b, facts, pickSeed, state)).join("");
}

function renderBlock(block: Block, facts: FactValues, pickSeed: string, state: State): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "field": {
      const value = factText(facts[block.key]);
      if (value !== null) {
        state.fields.add(block.key);
        return value;
      }
      if (block.fallback !== null) {
        state.fallbacks.add(block.key);
        return block.fallback;
      }
      throw new MissingFactError(`no value for required fact ${pyReprStr(block.key)}`);
    }
    case "variants": {
      const eligible = block.options.flatMap((o, i) => (isEligible(o, facts) ? [i] : []));
      if (eligible.length === 0) {
        throw new MissingFactError(
          `variant ${pyReprStr(block.name)}: every option needs a missing fact`,
        );
      }
      const pick = pickOption(block.picker, block.name, eligible, pickSeed, facts);
      if (!eligible.includes(pick)) {
        throw new Error(`variant ${pyReprStr(block.name)}: picker chose ineligible option ${pick}`);
      }
      state.picks.set(block.name, pick);
      return renderBlocks(block.options[pick] as Option, facts, pickSeed, state);
    }
    case "group": {
      const scratch = newState();
      let out: string;
      try {
        out = renderBlocks(block.blocks, facts, pickSeed, scratch);
      } catch (err) {
        if (err instanceof MissingFactError) return "";
        throw err;
      }
      merge(state, scratch);
      return out;
    }
  }
}

export function isEligible(option: Option, facts: FactValues): boolean {
  return option.every(
    (b) => b.kind !== "field" || b.fallback !== null || factText(facts[b.key]) !== null,
  );
}

// Seam repair, in order. Each is a join artifact, never authored copy (see the Python
// original for the measured rationale of each).
const TRAILING_WS = /[ \t]+(?=\n)/g;
const INTERIOR_SPACE_RUN = /(?<=\S)[ \t]{2,}(?=\S)/g;
const LEADING_SEAM_SPACE = /^ (?=\S)/gm;
const PUNCT_GAP = / ([.,!?;:])/g;
const PUNCT_COLLISION = /[,;:]+(?=[.,!?;:])/g;
const DOUBLED_PERIOD = /(?<!\.)\.\.(?!\.)/g;
const LEADING_ORPHAN_PUNCT = /^(?:[,;:]{2,}|[.,;:](?![.,!?;:]))[ \t]?/gm;
const BLANK_STACK = /\n{3,}/g;

/** Seam repair only: trailing space, interior runs, stranded punctuation, blank stacks. */
export function tidy(input: string): string {
  return input
    .replace(TRAILING_WS, "")
    .replace(INTERIOR_SPACE_RUN, " ")
    .replace(LEADING_SEAM_SPACE, "")
    .replace(PUNCT_GAP, "$1")
    .replace(PUNCT_COLLISION, "")
    .replace(DOUBLED_PERIOD, ".")
    .replace(LEADING_ORPHAN_PUNCT, "")
    .replace(BLANK_STACK, "\n\n")
    .trim();
}

/** Every fact key the template quotes, in the subject or body, inside optional runs too. */
export function factKeys(tpl: Template): ReadonlySet<string> {
  const keys = new Set<string>();
  const walk = (blocks: readonly Block[]): void => {
    for (const b of blocks) {
      if (b.kind === "field") keys.add(b.key);
      else if (b.kind === "group") walk(b.blocks);
      else if (b.kind === "variants") for (const o of b.options) walk(o);
    }
  };
  walk(tpl.subject ?? []);
  walk(tpl.body);
  return keys;
}
