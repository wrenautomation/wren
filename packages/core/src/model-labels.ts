/**
 * Model names as people read them: an id ("cohere:command-a-03-2025", "gateway:free",
 * "claude-haiku-4-5:agent") becomes a label ("Command A", "Free models", "Claude Haiku 4.5").
 * Every list or picker of models labels through here; the id stays in a tooltip or the detail.
 */
import { reasonLabel } from "./reason-labels.js";
import { codeLabel } from "./template-labels.js";

/** Whole ids and aliases with a label of their own. */
const KNOWN: Readonly<Record<string, string>> = {
  free: "Free models",
  "free-bulk": "Free models, bulk",
  cohere: "Cohere",
  gateway: "Free models",
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
  haiku: "Claude Haiku",
  deterministic: "Rules, no model",
  smtp: "Mail server check",
  fake: "Test stand-in",
  "ppp-foia": "PPP loan records",
};

/** Words spelled their own way. */
const WORDS: Readonly<Record<string, string>> = {
  gpt: "GPT",
  oss: "OSS",
  it: "",
  lite: "Lite",
  free: "",
};

/** Where it ran, when the id says: "cohere:command-a" ran on Cohere. */
const VIA: Readonly<Record<string, string>> = {
  gateway: "gateway",
  "claude-code": "Claude Code",
  anthropic: "Anthropic",
  cohere: "Cohere",
  gemini: "Gemini",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  groq: "Groq",
};

/** One model name as words: "command-a-03-2025" to "Command A", "gpt-oss-120b" to "GPT OSS 120B". */
function nameOf(model: string): string {
  const known = KNOWN[model];
  if (known) return known;
  const parts = model
    .replace(/:free$/, "")
    .replace(/^[a-z-]+\//, "") // "google/gemma-4-31b-it": the maker is in the name
    .replace(/-(\d{2}-\d{4}|\d{8})$/, "") // a release date
    .split("-")
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    const prev = out.at(-1);
    // "4", "5" after a name are one version: "Haiku 4.5".
    if (/^\d$/.test(p) && prev && /^\d+$/.test(prev)) out[out.length - 1] = `${prev}.${p}`;
    else if (low in WORDS) {
      if (WORDS[low]) out.push(WORDS[low] as string);
    } else if (/^\d+(\.\d+)?[bm]$/i.test(p)) out.push(p.toUpperCase());
    else if (/^[a-z]\d+[bm]$/i.test(p)) out.push(p.toUpperCase());
    else out.push(p.charAt(0).toUpperCase() + p.slice(1));
  }
  return out.join(" ") || model;
}

/**
 * A model id as a label. "<runner>:<model>" names the model; a gateway alias names its chain;
 * "<model>:<use>" ("claude-haiku-4-5:agent") names the model.
 */
export function modelLabel(id: string): string {
  const raw = id.trim();
  if (!raw) return id;
  if (KNOWN[raw]) return KNOWN[raw];
  const at = raw.indexOf(":");
  if (at < 0) return nameOf(raw);
  const head = raw.slice(0, at);
  const rest = raw.slice(at + 1);
  if (head in VIA) return rest ? nameOf(rest) : (KNOWN[head] ?? VIA[head] ?? head);
  return nameOf(head);
}

/** Where a model id ran, in words ("Cohere"), or null when the id doesn't say. */
export function modelVia(id: string): string | null {
  const head = id.trim().split(":")[0] ?? "";
  return id.includes(":") ? (VIA[head] ?? null) : null;
}

/**
 * How a field names something from code: `true` as words ("AdsWatch" to "Ads watch"), a model,
 * or a failure's reason ("web GET /exa/companies: 502" to "Exa search failed (502)").
 */
export type Words = true | "model" | "reason";

/** A name from code as its field reads it. */
export const wordsOf = (words: Words, s: string): string =>
  words === "model" ? modelLabel(s) : words === "reason" ? reasonLabel(s) : codeLabel(s);
