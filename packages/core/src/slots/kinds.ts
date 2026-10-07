/**
 * One slot syntax for every channel (designs/2026-10-06-edits-claude-templates.md, 3): an email,
 * a text, a DM and a model prompt all parse with `parse.ts`, check here and render with
 * `tree.ts`. A kind only says how its source opens (an email may have a `subject:` line) and how
 * the assembled text is finished.
 */
import { AuthoringError, parseBody, parseTemplate } from "./parse.js";
import type { FactValues } from "./pickers.js";
import {
  type Allocation,
  factKeys,
  type Rendered,
  type RenderStyle,
  render,
  slots,
  type Template,
  tidy,
} from "./tree.js";

export const TEMPLATE_KINDS = ["email", "sms", "dm", "post", "prompt"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Control characters but tab and newline: a fact can't smuggle a carriage return or an escape in. */
export const stripControls = (s: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");

/** A text or a DM: runs of spaces become one, the ends trimmed. What both channels always sent. */
export const squeeze = (assembled: string): string => assembled.replace(/[ \t]+/g, " ").trim();

const STYLE: Record<TemplateKind, RenderStyle> = {
  email: { finish: tidy },
  sms: { finish: (s) => stripControls(squeeze(s)) },
  dm: { finish: (s) => stripControls(squeeze(s)) },
  // A post keeps its paragraphs: an email's seam repair, without control characters.
  post: { finish: (s) => tidy(stripControls(s)) },
  // A prompt goes to the model exactly as written, its facts exactly as given.
  prompt: { finish: (assembled) => assembled, exact: true },
};

/** A template's source as its kind reads it. Throws `AuthoringError` naming the line. */
export function parseKind(kind: TemplateKind, name: string, source: string): Template {
  return kind === "email" ? parseTemplate(name, source) : parseBody(name, source);
}

/** One recipient's copy: the seed is who it is for, so their variant picks never move. */
export function renderKind(
  kind: TemplateKind,
  tpl: Template,
  facts: FactValues,
  seed: string,
  allocation?: Allocation,
): Rendered {
  return render(tpl, facts, seed, allocation, STYLE[kind]);
}

/** What one template may hold, declared by the code that sends it. */
export interface SlotRules {
  /** The facts it may quote; unset = any (an email's facts view answers for the rest). */
  readonly fields?: readonly string[];
  /** Must say how to stop (the first text a stranger gets). */
  readonly mustSayStop?: boolean;
  /** Facts it must quote: a first text names who it's from (`sender`). */
  readonly mustUse?: readonly string[];
  /** Fewest characters (Telnyx refuses a keyword reply under 20). */
  readonly minLength?: number;
  readonly maxLength?: number;
}

/**
 * The source as saved, parsed, or throws `AuthoringError` saying what is wrong: a mark that
 * doesn't parse, a fact the slot doesn't offer, a prompt slot outside an email, a missing STOP,
 * a length. A text and a DM are saved trimmed, an email and a prompt as written; "" is no template.
 */
export function checkSource(
  kind: TemplateKind,
  key: string,
  source: string,
  rules: SlotRules = {},
): { source: string; template: Template } | null {
  const saved = kind === "email" || kind === "prompt" ? source : source.trim();
  if (saved.trim() === "") return null;
  const tpl = parseKind(kind, key, saved);
  if (kind !== "email" && kind !== "prompt" && slots(tpl).size > 0)
    throw new AuthoringError(`${key}: a << >> prompt slot needs a model; only an email has one`);
  if (rules.fields) {
    const offered = new Set(rules.fields);
    for (const k of factKeys(tpl)) {
      if (offered.has(k) || k.startsWith("ai.")) continue;
      throw new AuthoringError(
        rules.fields.length === 0
          ? `${key} takes no fields: {${k}} is not filled in`
          : `${key}: unknown field {${k}} (have: ${rules.fields.map((f) => `{${f}}`).join(", ")})`,
      );
    }
  }
  const used = factKeys(tpl);
  for (const k of rules.mustUse ?? [])
    if (!used.has(k)) throw new AuthoringError(`${key} must say {${k}}`);
  if (rules.mustSayStop && !/\bstop\b/i.test(saved))
    throw new AuthoringError(`${key} is a first text: it must say how to stop (the word STOP)`);
  if (rules.minLength !== undefined && saved.length < rules.minLength)
    throw new AuthoringError(`${key} needs at least ${rules.minLength} characters`);
  if (rules.maxLength !== undefined && saved.length > rules.maxLength)
    throw new AuthoringError(`${key} is ${saved.length} characters; at most ${rules.maxLength}`);
  return { source: saved, template: tpl };
}

/** A sample render for a preview: the subject line over the body, as the reader sees it. */
export function sampleRender(kind: TemplateKind, tpl: Template, facts: FactValues): string {
  const out = renderKind(kind, tpl, facts, "sample");
  return out.subject === null ? out.body : `${out.subject}\n\n${out.body}`;
}
