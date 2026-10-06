/**
 * AI fills (designs/2026-10-05-ai-fills.md): facts a model writes, checked by code before
 * any email can use them. The model proposes, code disposes.
 *
 * - `company`: `company_name` and `company_short` as a person says them.
 * - `person`: `first_name` as a person would greet them.
 * - `slot`: a template's `<<prompt>>`, filled from the prompt with its facts in.
 *
 * A failed check, or a model that says it can't, removes the fact: its `(( ))` group drops,
 * its fallback renders, or the company stays out. Never the rule-based guess. Every answer
 * is cached in `fills`, so a name costs one call ever.
 */
import { createHash } from "node:crypto";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { eq, inArray } from "drizzle-orm";
import { type ZodType, z } from "zod";
import { eachConcurrently } from "../concurrent.js";
import { type FILL_KINDS, fills } from "../schema.js";
import type { FactRow, Facts } from "./facts.js";
import { slots, type Template } from "@wren/core/slots";

export type FillKind = (typeof FILL_KINDS)[number];
type Answer = Record<string, string>;

const CHECK_VERSION = "2";

export const CASUAL_COMPANY = `You turn a company name, as filed in a registry or a listing, into what people call the firm in a casual email.

Answer with JSON only: {"name": "...", "short": "..."}

name: the firm's name as people say it.
- Drop legal forms (Inc, LLC, Ltd, Corp, Co, PLLC, LLP, PC), ® and ™, locations ("Tyler, TX", "of Hartsville", "in Texas"), taglines, branch numbers and parent-company notes ("An Allied Universal Company").
- Fix SHOUTING to normal case. Keep a real acronym in capitals (RN, IT, USA) and a brand's own casing (TEKsystems).

short: what someone calls the firm mid-sentence, as in "I've been following ___ for a while".
- Either the brand alone, when it is a distinctive word ("Grove Technical Resources" is "Grove", "Briggs & Associates" is "Briggs", "Theraco Staffing" is "Theraco"), or the whole name.
- Never stop halfway through a phrase. "Unique System Skills" stays whole, never "Unique System". "Advance Professional Resources" stays whole, never "Advance Professional".
- Keep the whole name when the brand alone is a common word ("Premier Staffing" stays "Premier Staffing") or only a person's first name ("Abel Mendoza Staffing" is "Abel Mendoza").
- Never make initials or abbreviations. Never add a word that is not in the input. Never use commas.

A brand made of plain words is still a company: "JOBWISE", "The Key", "The Hire".
If the input is not a company name (a city, a job title, a person, "Contact 1", a phone number, junk), answer {"name": null}.

Examples:
ASSERTIVE STAFFING SERVICES INC -> {"name": "Assertive Staffing Services", "short": "Assertive Staffing"}
Express Employment Professionals Tyler, TX -> {"name": "Express Employment Professionals", "short": "Express Employment"}
PEOPLEMARK®, An Allied Universal® Company -> {"name": "Peoplemark", "short": "Peoplemark"}
Cma Services Inc Of Hartsville -> {"name": "CMA Services", "short": "CMA Services"}
Grove Technical Resources, LLC -> {"name": "Grove Technical Resources", "short": "Grove"}
Superior Resource Specialists -> {"name": "Superior Resource Specialists", "short": "Superior Resource Specialists"}
Murphy, Wright & Associates -> {"name": "Murphy Wright & Associates", "short": "Murphy Wright & Associates"}
THE HIRE LLC -> {"name": "The Hire", "short": "The Hire"}
Odessa, TX -> {"name": null}`;

export const CASUAL_PERSON = `You read a contact as filed in a lead list and give the first name to greet them by, as in "Hi ___,".

Answer with JSON only: {"first": "..."}

- Their first name in normal case: "JOHN" is "John", "mckenzie" is "McKenzie".
- If the first-name field is junk (a job title, an email address, two words run together), take the first name from the full name.
- If the first name is only an initial and a real name follows it, they go by that one: "E. Ann Guliex" is "Ann".
- Use the name as filed: no nicknames, no expanding initials.
- If there is no real first name (only initials like "Jg" or "R.P.", "FNU" which means unknown, a job title, a company, "Info", "Office"), answer {"first": null}.

Examples:
first_name: Michael.Stenger / full_name: Michael Stenger -> {"first": "Michael"}
first_name: Developmentdouglas / full_name: Business Developmentdouglas Reyes -> {"first": "Douglas"}
first_name: Vp, / full_name: Vp, Sales -> {"first": null}
first_name: R.P. / full_name: R.P. Smith -> {"first": null}
first_name: E. / full_name: E. Ann Guliex -> {"first": "Ann"}
first_name: Fnu / full_name: Fnu Deepak -> {"first": null}`;

export const SLOT = `You write one short phrase that goes inside a sentence of a cold email a person wrote by hand. Follow the instruction.

Answer with JSON only: {"text": "..."}

- Plain words, the way someone would say it out loud. No marketing words, no exclamation marks, no emoji, no quotes, no dashes.
- Use only what the instruction gives you. Never invent facts, numbers, names or claims.
- If you can't do it from what you were given, answer {"text": null}.`;

const SYSTEM: Record<FillKind, string> = {
  company: CASUAL_COMPANY,
  person: CASUAL_PERSON,
  slot: SLOT,
};

const SCHEMA = {
  company: z.object({ name: z.string().nullable(), short: z.string().nullable().optional() }),
  person: z.object({ first: z.string().nullable() }),
  slot: z.object({ text: z.string().nullable() }),
} as const;

/** Changes iff the system prompt or the checks do: a new version is a fresh cache. */
export const promptVersion = (kind: FillKind): string =>
  createHash("sha256")
    .update(`${SYSTEM[kind]}\x00${CHECK_VERSION}`, "utf8")
    .digest("hex")
    .slice(0, 12);

const fillKey = (kind: FillKind, input: string): string =>
  createHash("sha256")
    .update(`${kind}\x00${promptVersion(kind)}\x00${input}`, "utf8")
    .digest("hex");

// ---- checks: what a model's answer must be before an email may carry it -------------

const LEGAL_FORMS = new Set(
  "inc incorporated llc ltd limited corp co pllc llp lp pc plc gmbh lc".split(" "),
);
const ROLE_WORDS = new Set(
  (
    "sales manager vp director info contact admin owner office hr recruiter recruiting team " +
    "support marketing president ceo founder staff hiring careers jobs accounts billing " +
    "regional area mr mrs ms dr the hello hi dear fnu lnu"
  ).split(" "),
);

/** The words of a name, for comparing: lowercased, punctuation off, `and` for `&`. */
const words = (s: string): string[] =>
  s
    .split(/[\s,/]+/)
    .map((w) =>
      w
        .toLowerCase()
        .replace(/^&$|^\+$/, "and")
        .replace(/[^\p{L}\p{N}'&+-]/gu, "")
        .replace(/^['-]+|['-]+$/g, ""),
    )
    .filter(Boolean);

const raw = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const shouts = (w: string) => /\p{L}{2}/u.test(w) && w === w.toUpperCase();
const isShouting = (s: string) =>
  raw(s)
    .filter((w) => /\p{L}{4}/u.test(w))
    .every(shouts);

/** A casual company name, or why it refused. Only cuts and recases: no word the input lacks. */
export function checkCompanyName(input: string, out: string, maxWords: number): string | null {
  const text = out.trim();
  if (!text) return "empty";
  if (/[,()[\]{}"®™|]/.test(text)) return "punctuation";
  const have = new Set(words(input));
  const said = words(text);
  if (said.length === 0) return "empty";
  if (said.length > maxWords) return `over ${maxWords} words`;
  for (const w of said) {
    if (!have.has(w)) return `"${w}" is not in the filed name`;
    if (LEGAL_FORMS.has(w.replace(/\./g, ""))) return `legal form "${w}"`;
  }
  // An acronym ("Cma" -> "CMA") is short; a longer word in capitals is the input's shouting.
  const bare = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "");
  const inputCaps = new Set(raw(input).filter(shouts).map(bare));
  const shouting = isShouting(input);
  for (const w of raw(text).filter(shouts)) {
    if (bare(w).length <= 4) continue;
    if (shouting || !inputCaps.has(bare(w))) return `"${w}" shouts`;
  }
  return null;
}

/** A first name fit for "Hi ___,", or why it refused. */
export function checkFirstName(input: string, out: string): string | null {
  const text = out.trim();
  if (!/^\p{L}[\p{L}'-]{1,19}$/u.test(text)) return "not one name";
  if (text === text.toUpperCase()) return "shouts";
  if (text[0] !== text[0]?.toUpperCase()) return "not capitalized";
  if (ROLE_WORDS.has(text.toLowerCase())) return `"${text}" is a role or placeholder, not a name`;
  if (/^[a-z'-]+$/i.test(text) && !/[aeiouy]/i.test(text)) return "initials, not a name";
  if (!input.toLowerCase().includes(text.toLowerCase())) return "not in the filed name";
  return null;
}

export const SLOT_MAX_WORDS = 25;

/** A slot's phrase, or why it refused. */
export function checkSlot(prompt: string, out: string): string | null {
  const text = out.trim();
  if (!text) return "empty";
  if (/^none\.?$/i.test(text)) return "none";
  if (/\n/.test(text)) return "more than one line";
  if (raw(text).length > SLOT_MAX_WORDS) return `over ${SLOT_MAX_WORDS} words`;
  if (/https?:|www\.|@/.test(text)) return "a link or address";
  if (/[—–]|\s-\s|--/.test(text)) return "a dash";
  if (/[()[\]{}<>"“”!]/.test(text)) return "brackets, quotes or an exclamation";
  for (const d of text.match(/\d+/g) ?? [])
    if (!prompt.includes(d)) return `the number ${d} is not in the prompt`;
  return null;
}

/** The answer an email may carry, or why not. */
function judge(kind: FillKind, input: string, parsed: unknown): Answer | string {
  if (kind === "company") {
    const p = parsed as z.infer<(typeof SCHEMA)["company"]>;
    if (p.name === null) return "model: not a company name";
    const bad = checkCompanyName(input, p.name, 6);
    if (bad) return `name: ${bad}`;
    const name = p.name.trim();
    // A short that fails its check is not worth losing the firm over: the name stands in.
    const short = p.short?.trim() ?? "";
    return { name, short: short && !checkCompanyName(input, short, 4) ? short : name };
  }
  if (kind === "person") {
    const p = parsed as z.infer<(typeof SCHEMA)["person"]>;
    if (p.first === null) return "model: no first name";
    const bad = checkFirstName(input, p.first);
    return bad ? `first: ${bad}` : { first: p.first.trim() };
  }
  const p = parsed as z.infer<(typeof SCHEMA)["slot"]>;
  if (p.text === null) return "model: can't from what it was given";
  const bad = checkSlot(input, p.text);
  return bad ? `text: ${bad}` : { text: p.text.trim().replace(/\.$/, "") };
}

// ---- the filler -------------------------------------------------------------------

export interface FillRequest {
  readonly kind: FillKind;
  readonly input: string;
}

/** What `fill` would ask about one facts row: the casual names and every slot it can fill. */
export function requestsFor(facts: Facts, templates: Iterable<Template>): FillRequest[] {
  const out: FillRequest[] = [];
  const company = companyInput(facts);
  if (company) out.push({ kind: "company", input: company });
  const person = personInput(facts);
  if (person) out.push({ kind: "person", input: person });
  for (const [, prompt] of allSlots(templates)) {
    const input = resolvePrompt(prompt, facts.values);
    if (input !== null) out.push({ kind: "slot", input });
  }
  return out;
}

/** The text as stored, before `readable` cut or refused it: the model sees what was filed. */
const filed = (facts: Facts, key: string): string | null => {
  const v = facts.filed?.[key] ?? facts.values[key] ?? facts.refused[key];
  return v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim();
};

const companyInput = (facts: Facts) => filed(facts, "company_name");

function personInput(facts: Facts): string | null {
  const first = filed(facts, "first_name");
  const full = filed(facts, "full_name");
  if (first === null && full === null) return null;
  return `first_name: ${first ?? ""} / full_name: ${full ?? ""}`;
}

function allSlots(templates: Iterable<Template>): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of templates) for (const [k, p] of slots(t)) out.set(k, p);
  return out;
}

/** The prompt with its `{key}` facts in, or null when one is missing (the slot is too). */
export function resolvePrompt(prompt: string, values: Readonly<FactRow>): string | null {
  let missing = false;
  const text = prompt.replace(/\{([A-Za-z0-9_.]+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v === null || v === undefined || String(v).trim() === "") missing = true;
    return String(v ?? "");
  });
  return missing ? null : text;
}

export interface Filler {
  /** Facts with the casual names in and every slot of `templates` filled (or missing). */
  fill(facts: Facts, templates: Iterable<Template>): Promise<Facts>;
  /** Ask everything `rows` will need, `FILL_WIDTH` at a time: one pass's calls up front. */
  warm(rows: readonly Facts[], templates: Iterable<Template>): Promise<void>;
}

/** Calls in flight. Cohere allows 500 a minute; 8 ran near 450. */
export const FILL_WIDTH = 4;

/** A filler over `llm`, caching every answer in `fills`. Provider failures throw (LlmError). */
export function makeFiller(db: Queryable, llm: LlmClient): Filler {
  const memo = new Map<string, Answer | null>();

  async function load(keys: string[]): Promise<void> {
    const want = keys.filter((k) => !memo.has(k));
    if (want.length === 0) return;
    for (let i = 0; i < want.length; i += 500) {
      const rows = await db
        .select({ key: fills.key, value: fills.value })
        .from(fills)
        .where(inArray(fills.key, want.slice(i, i + 500)));
      for (const r of rows) memo.set(r.key, r.value ?? null);
    }
  }

  async function ask(req: FillRequest): Promise<Answer | null> {
    const key = fillKey(req.kind, req.input);
    await load([key]);
    if (memo.has(key)) return memo.get(key) ?? null;
    const outcome = await completeAndParse(llm, req.input, SCHEMA[req.kind] as ZodType<unknown>, {
      maxTokens: 120,
      system: SYSTEM[req.kind],
      name: `fill:${req.kind}`,
    });
    // A garbled answer is the call's fault, not the name's: missing this pass, asked again next.
    if (outcome.parsed === null) {
      memo.set(key, null);
      return null;
    }
    const verdict = judge(req.kind, req.input, outcome.parsed);
    const value = typeof verdict === "string" ? null : verdict;
    await db
      .insert(fills)
      .values({
        kind: req.kind,
        promptVersion: promptVersion(req.kind),
        input: req.input,
        key,
        value,
        refused: typeof verdict === "string" ? verdict : null,
        model: llm.name,
        envelope: outcome.envelope(),
      })
      .onConflictDoNothing();
    // A racing pass may have stored first: its row is the answer, for every pass alike.
    const [row] = await db.select({ value: fills.value }).from(fills).where(eq(fills.key, key));
    const stored = row ? (row.value ?? null) : value;
    memo.set(key, stored);
    return stored;
  }

  async function fill(facts: Facts, templates: Iterable<Template>): Promise<Facts> {
    const list = [...templates];
    const values: FactRow = { ...facts.values };
    const refused: FactRow = { ...facts.refused };
    const drop = (key: string) => {
      const was = filed(facts, key);
      delete values[key];
      if (was !== null) refused[key] = was;
    };

    const company = companyInput(facts);
    if (company !== null) {
      const a = await ask({ kind: "company", input: company });
      if (a?.name) {
        values.company_name = a.name;
        values.company_short = a.short ?? a.name;
        if ("company.name" in values) values["company.name"] = a.name;
        delete refused.company_name;
        delete refused.company_short;
      } else {
        drop("company_name");
        delete values.company_short;
        if ("company.name" in values) delete values["company.name"];
      }
    }
    const person = personInput(facts);
    if (person !== null) {
      const a = await ask({ kind: "person", input: person });
      if (a?.first) {
        values.first_name = a.first;
        delete refused.first_name;
      } else drop("first_name");
    }
    // Slots read the casual names: "{company_short}" in a prompt means what the email says.
    for (const [key, prompt] of allSlots(list)) {
      const input = resolvePrompt(prompt, values);
      const a = input === null ? null : await ask({ kind: "slot", input });
      if (a?.text) values[key] = a.text;
      else delete values[key];
    }
    return { values, refused, ...(facts.filed ? { filed: facts.filed } : {}) };
  }

  async function warm(rows: readonly Facts[], templates: Iterable<Template>): Promise<void> {
    const list = [...templates];
    const seen = new Map<string, FillRequest>();
    for (const r of rows)
      for (const q of requestsFor(r, list)) {
        // Slots resolve against filled names, so only the name calls are known up front.
        if (q.kind !== "slot") seen.set(fillKey(q.kind, q.input), q);
      }
    await load([...seen.keys()]);
    const todo = [...seen.entries()].filter(([k]) => !memo.has(k)).map(([, q]) => q);
    await eachConcurrently(todo, FILL_WIDTH, async (q) => {
      await ask(q);
    });
  }

  return { fill, warm };
}
