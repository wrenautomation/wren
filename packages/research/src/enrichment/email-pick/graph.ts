/**
 * The email-pick decision graph: pure state in, pure state out.
 *
 *     START ──route──┬─ nothing scannable ──────→ noContent ────→ END
 *                    ├─ no signals ─────────────→ emptyVerdict ─→ END
 *                    ├─ one on-domain, no people → autoAccept ──→ END
 *                    └─ otherwise ──────────────→ classify ─→ ground ─→ END
 *
 * route/autoAccept/ground are deterministic; classify is the single LLM step.
 * ground: every email in the pick must be a scanned signal, every person_name a
 * known person. Fabrications are dropped and recorded. No LangGraph: typed step
 * functions and one runner. No database: the run module assembles the state, so
 * every step is unit-testable on FakeLlm.
 */
import { isRoleLocalpart, matchKey } from "@wren/core";
import {
  completeAndParse,
  type Envelope,
  type LlmClient,
  parseModel,
  type Tracer,
} from "@wren/llm";
import { z } from "zod";
import type { EmailSignal } from "../email-scan.js";

// v2: verdicts consume SCAN_VERSION v2 signals; bump whenever the prompt OR the
// signal shape feeding it changes. v3: known-people scoped to WEBSITE origin, the
// prompt cap keeps the strongest evidence, all-shell companies get an explicit
// no_scannable_content pick.
export const PICK_VERSION = "v3";
const MAX_SIGNALS = 40; // a page farm of addresses is noise
const MAX_TOKENS = 3000;
// Evidence order for that cap: on-domain first, then source precision.
const SOURCE_RANK: Record<string, number> = { mailto: 0, text: 1, markup: 2, deobfuscated: 3 };

const PROMPT = `You are auditing contact addresses discovered on one company's website.

Company: {company}
Website domain: {domain}
Pages seen: {pages}
Homepage excerpt: {snippet}

Known people at this company (from the same site):
{people}

Discovered email addresses (with where/how each was found):
{signals}

For EVERY address, classify it and pick the single best address for a
first cold email to this company. Return ONLY a JSON object, no prose:
{"emails": [{"email": "...", "classification": "person|role|other_company|noise",
"person_name": "..." or null, "reason": "..."}],
"best_send_to": "..." or null, "notes": "..." or null}

Rules:
- classification: "person" = a specific individual's mailbox; "role" = a
  functional address (info@, hello@, careers@); "other_company" = belongs
  to a different organization (a client, a platform, a vendor they cite);
  "noise" = not a real reachable mailbox.
- person_name: ONLY a name from the known-people list above, and only when
  the address clearly belongs to them. Never invent a person.
- best_send_to: the address a first outreach email should go to — prefer a
  decision-maker's personal address, then a general role address on the
  company's own domain. null if nothing is send-worthy.
- Use ONLY addresses from the list. Never invent or modify an address.
`;

const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const ClassifiedEmail = z.object({
  email: z.string(),
  classification: z.string().default("role"),
  person_name: nullableString,
  reason: nullableString,
});
export type ClassifiedEmail = z.infer<typeof ClassifiedEmail>;

export const PickResult = z.object({
  emails: z.array(ClassifiedEmail).default([]),
  best_send_to: nullableString,
  notes: nullableString,
});
export type PickResult = z.infer<typeof PickResult>;

export function parsePick(text: string): PickResult | string {
  return parseModel(text, PickResult);
}

export type PickMethod = "no_signals" | "no_scannable_content" | "auto_accept" | "classify";
export const FREE_PICK_METHODS: ReadonlySet<string> = new Set([
  "auto_accept",
  "no_signals",
  "no_scannable_content",
]);

export interface Pick {
  method: PickMethod;
  emails: ClassifiedEmail[];
  best_send_to: string | null;
  notes?: string | null;
  /** Filled by ground(): claimed addresses that were not scanned signals. */
  ungrounded?: string[];
  /** Filled by ground(): person_names that matched no known person. */
  ungrounded_names?: string[];
}

export interface PickCompany {
  name: string | null;
  domain: string | null;
  pages: string[];
  snippet: string;
}
export interface PickPerson {
  full_name: string;
  title: string | null;
}

/** Input to the graph. Plain data: the run module assembles it from the database. */
export interface PickState {
  company: PickCompany;
  signals: EmailSignal[];
  /** WEBSITE-origin only. */
  people: PickPerson[];
  /** Every stored page is a shell or tombstone. */
  no_scannable: boolean;
}

/** Output of the graph. Free routes carry no llm envelope. */
export interface PickOutcome {
  pick: Pick;
  llm: Envelope | null;
  parse_error: string | null;
  provider_rejected: string | null;
}

export type Route = "no_content" | "empty_verdict" | "auto_accept" | "classify";

/** Deterministic triage: the LLM only sees ambiguity. */
export function route(state: PickState): Route {
  if (state.no_scannable) return "no_content";
  const signals = state.signals ?? [];
  if (!signals.length) return "empty_verdict";
  const onDomain = signals.some((s) => s.on_domain);
  if (signals.length === 1 && onDomain && !(state.people ?? []).length) return "auto_accept";
  return "classify";
}

const classifyLocal = (email: string): string => (isRoleLocalpart(email) ? "role" : "person");

export function emptyVerdict(_state: PickState): Pick {
  return { method: "no_signals", emails: [], best_send_to: null };
}

/** "Nothing scannable ever existed" is a different fact from "scanned and found nothing". */
export function noContent(_state: PickState): Pick {
  return { method: "no_scannable_content", emails: [], best_send_to: null };
}

/** One on-domain address, nobody to disambiguate: nothing to ask. */
export function autoAccept(state: PickState): Pick {
  const first = state.signals[0];
  if (!first) throw new Error("autoAccept requires one signal");
  const email = first.email;
  return {
    method: "auto_accept",
    emails: [{ email, classification: classifyLocal(email), person_name: null, reason: null }],
    best_send_to: email,
  };
}

const rank = (s: EmailSignal): [number, number] => [
  s.on_domain ? 0 : 1,
  SOURCE_RANK[s.source] ?? 4,
];

export function buildPickPrompt(state: PickState): string {
  const company = state.company;
  const people = state.people ?? [];
  const signals = [...(state.signals ?? [])]
    .sort((a, b) => {
      const [a0, a1] = rank(a);
      const [b0, b1] = rank(b);
      return a0 - b0 || a1 - b1;
    })
    .slice(0, MAX_SIGNALS);
  const peopleLines = people
    .map((p) => `- ${p.full_name}${p.title ? ` (${p.title})` : ""}`)
    .join("\n");
  const signalLines = signals
    .map(
      (s) =>
        `- ${s.email} [${s.source}, ${s.on_domain ? "on" : "off"}-domain, ${s.page_url ?? ""}] context: ${
          s.context || "(none)"
        }`,
    )
    .join("\n");
  return PROMPT.replace("{company}", company.name || "(unknown)")
    .replace("{domain}", company.domain || "(unknown)")
    .replace("{pages}", (company.pages ?? []).join(", ") || "(none)")
    .replace("{snippet}", company.snippet || "(none)")
    .replace("{people}", peopleLines || "(none known)")
    .replace("{signals}", signalLines || "(none)");
}

export interface ClassifyOptions {
  runId?: string | null | undefined;
  tracer?: Tracer | null | undefined;
}

/**
 * The one paid step. LlmError propagates so the owning loop can abort with
 * partial progress; a rejection or a parse failure is this company's recorded outcome.
 */
export async function classify(
  llm: LlmClient,
  state: PickState,
  opts: ClassifyOptions = {},
): Promise<PickOutcome> {
  const outcome = await completeAndParse(llm, buildPickPrompt(state), PickResult, {
    maxTokens: MAX_TOKENS,
    runId: opts.runId ?? null,
    tracer: opts.tracer ?? null,
    name: "email_pick",
    metadata: { company: state.company.name, domain: state.company.domain },
  });
  const pick: Pick = { method: "classify", emails: [], best_send_to: null };
  if (outcome.parsed !== null) Object.assign(pick, outcome.parsed);
  return {
    pick,
    llm: outcome.envelope(),
    parse_error: outcome.parseError,
    provider_rejected: outcome.providerRejected,
  };
}

/** Every claimed email must be a scanned signal; every person_name a known person. */
export function ground(state: PickState, pick: Pick): Pick {
  const knownEmails = new Set((state.signals ?? []).map((s) => s.email.toLowerCase()));
  const knownPeople = new Map<string, string>();
  for (const p of state.people ?? [])
    knownPeople.set(matchKey(null, null, p.full_name), p.full_name);
  const kept: ClassifiedEmail[] = [];
  const dropped: string[] = [];
  const droppedNames: string[] = [];
  for (const entry of pick.emails ?? []) {
    const email = (entry.email ?? "").trim().toLowerCase();
    if (!knownEmails.has(email)) {
      dropped.push(entry.email ?? "");
      continue;
    }
    let personName: string | null = null;
    if (entry.person_name) {
      const canonical = knownPeople.get(matchKey(null, null, entry.person_name));
      // An invented or mangled name gets the same visibility as a fabricated address.
      if (canonical === undefined) droppedNames.push(entry.person_name);
      personName = canonical ?? null;
    }
    kept.push({ ...entry, email, person_name: personName });
  }
  let best = (pick.best_send_to ?? "").trim().toLowerCase() || null;
  if (best && !kept.some((e) => e.email === best)) {
    dropped.push(pick.best_send_to ?? "");
    best = null;
  }
  return {
    ...pick,
    emails: kept,
    best_send_to: best,
    ungrounded: dropped,
    ungrounded_names: droppedNames,
  };
}

/** Walk the graph for one state. */
export async function runPickGraph(
  llm: LlmClient,
  state: PickState,
  opts: ClassifyOptions = {},
): Promise<PickOutcome> {
  const free = (pick: Pick): PickOutcome => ({
    pick,
    llm: null,
    parse_error: null,
    provider_rejected: null,
  });
  switch (route(state)) {
    case "no_content":
      return free(noContent(state));
    case "empty_verdict":
      return free(emptyVerdict(state));
    case "auto_accept":
      return free(autoAccept(state));
    case "classify": {
      const outcome = await classify(llm, state, opts);
      return { ...outcome, pick: ground(state, outcome.pick) };
    }
  }
}
