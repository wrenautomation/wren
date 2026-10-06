/**
 * The LLM tiers (designs/2026-10-04-copy-evolution.md): strategist, writer, checker,
 * judge. Prompts and parsing only; no database. The checker is code, not a model: a
 * candidate that fails it never reaches the judge or William.
 */
import { type CallRecord, completeAndParse, type LlmClient } from "@wren/llm";
import { z } from "zod";
import { AuthoringError, parseTemplate } from "@wren/core/slots";
import { alleleKey, type Option, optionText } from "@wren/core/slots";

export const MODES = ["explore", "exploit", "diversify", "fix"] as const;
export const WRITER_MUTATIONS = ["rewrite_loser", "new_angle", "crossover"] as const;
export const ANGLES = ["curiosity", "pain", "proof", "offer", "personal"] as const;
export type Mode = (typeof MODES)[number];
export type WriterMutation = (typeof WRITER_MUTATIONS)[number];

/** One live allele as the tiers see it. */
export interface AlleleView {
  allele: string;
  text: string;
  exposures: number;
  successes: number;
  pBest: number | null;
  angle: string | null;
}

export interface LocusView {
  locus: string;
  settled: boolean;
  stagnant: boolean;
  alleles: AlleleView[];
}

export interface Plan {
  mode: Mode;
  loci: string[];
  mutation: WriterMutation;
  /** 0: close variations on the winners; 1: new ideas. */
  temperature: number;
  reason: string;
  fallback: boolean;
}

/** Rules every candidate is written to. Voice comes from the email around the point. */
export const COPY_RULES = `- Match the voice, tone and length of the email around the point: one person writing, casual and direct.
- Each option drops into the point as is and reads right in its sentence.
- Plain words. No em dashes or en dashes. No prices, links, email addresses or numbers the email doesn't already have.
- Facts only as {key} placeholders this email already uses. Never invent a fact about the reader.
- No line breaks and none of | [[ ]] (( )).`;

const rate = (a: AlleleView) => (a.exposures > 0 ? a.successes / a.exposures : null);
const pct = (v: number | null) => (v === null ? "no data" : `${(100 * v).toFixed(1)}%`);

function locusLines(l: LocusView): string {
  const flags = [l.settled && "settled", l.stagnant && "stagnant"].filter(Boolean).join(", ");
  const rows = l.alleles.map(
    (a) =>
      `  - ${JSON.stringify(a.text)}: sent ${a.exposures}, rate ${pct(rate(a))}, P(best) ${pct(a.pBest)}${a.angle ? `, angle ${a.angle}` : ""}`,
  );
  return [`#${l.locus}${flags ? ` (${flags})` : ""}`, ...rows].join("\n");
}

// ---- strategist ------------------------------------------------------------------

const planSchema = z.object({
  mode: z.enum(MODES),
  loci: z.array(z.string()).min(1),
  mutation: z.enum(WRITER_MUTATIONS),
  temperature: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export function strategistPrompt(input: {
  genome: string;
  loci: LocusView[];
  writable: string[];
  journal: string[];
}): string {
  return `You run a copy experiment on one cold email. Each [[#name a | b]] point is a locus; its options are alleles. Sends shift toward the alleles that win.

The email (genome):
${input.genome}

Each locus now:
${input.loci.map(locusLines).join("\n")}

Recent journal:
${input.journal.join("\n") || "(empty)"}

Pick what the writer works on next. Loci that can take new alleles: ${input.writable.join(", ")}.
- mode: explore (try new ideas), exploit (refine the winners), diversify (an angle no live allele takes), fix (replace what is losing).
- mutation: rewrite_loser (rewrite the worst live allele), new_angle, or crossover (merge the two best).
- temperature: 0 keeps close to the winners, 1 strays far.

Answer with one JSON object only:
{"mode": "explore", "loci": ["v2"], "mutation": "rewrite_loser", "temperature": 0.5, "reason": "one short sentence"}`;
}

/**
 * The stagnant locus with the widest spread of rates, else any writable one with the
 * widest spread: what the strategist falls back to when the model fails.
 */
export function fallbackPlan(loci: LocusView[], writable: string[], why: string): Plan | null {
  const open = loci.filter((l) => writable.includes(l.locus));
  if (open.length === 0) return null;
  const spread = (l: LocusView) => {
    const rates = l.alleles.map(rate).filter((r): r is number => r !== null);
    return rates.length ? Math.max(...rates) - Math.min(...rates) : 0;
  };
  const pool = open.some((l) => l.stagnant) ? open.filter((l) => l.stagnant) : open;
  const pick = pool.reduce((a, b) => (spread(b) > spread(a) ? b : a));
  return {
    mode: "fix",
    loci: [pick.locus],
    mutation: "rewrite_loser",
    temperature: 0.5,
    reason: `fallback (${why}): widest spread${pick.stagnant ? ", stagnant" : ""}`,
    fallback: true,
  };
}

export async function runStrategist(
  llm: LlmClient,
  input: Parameters<typeof strategistPrompt>[0] & { loci: LocusView[] },
): Promise<{ plan: Plan | null; call: CallRecord | null }> {
  let why: string;
  let call: CallRecord | null = null;
  try {
    const out = await completeAndParse(llm, strategistPrompt(input), planSchema, {
      maxTokens: 400,
      name: "evolve_strategist",
    });
    call = out.call;
    const plan = out.parsed;
    const loci = (plan?.loci ?? []).filter((l) => input.writable.includes(l));
    if (plan && loci.length > 0) return { plan: { ...plan, loci, fallback: false }, call };
    why = plan
      ? "no writable locus picked"
      : (out.parseError ?? out.providerRejected ?? "no answer");
  } catch (err) {
    why = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  return { plan: fallbackPlan(input.loci, input.writable, why), call };
}

// ---- writer ----------------------------------------------------------------------

const writerSchema = z.object({ options: z.array(z.string()).min(1) });

const MUTATION_ASK: Record<WriterMutation, string> = {
  rewrite_loser:
    "Rewrite the worst live allele so it can beat the best ones. Keep what the best ones do well.",
  new_angle: "Take an angle no live allele takes.",
  crossover: "Merge the ideas of the two best live alleles into one.",
};

export function writerPrompt(input: {
  genome: string;
  locus: LocusView;
  mutation: WriterMutation;
  mode: Mode;
  temperature: number;
  journal: string[];
  facts: string[];
  count: number;
}): string {
  const angles = [...new Set(input.locus.alleles.map((a) => a.angle).filter(Boolean))];
  return `You write copy for one point of a cold email. The email, with every point as [[#name option | option]]:
${input.genome}

The point to write for:
${locusLines(input.locus)}

What happened at this point before (newest last):
${input.journal.join("\n") || "(nothing yet)"}

Task: ${MUTATION_ASK[input.mutation]}${input.mode === "diversify" ? ` Use an angle the live alleles don't (taken: ${angles.join(", ") || "none tagged"}; angles: ${ANGLES.join(", ")}).` : ""}
How far to stray from the winners, 0 to 1: ${input.temperature}.
Facts you may use: ${input.facts.map((f) => `{${f}}`).join(", ") || "none"}.

Rules:
${COPY_RULES}

Write ${input.count} different options. Answer with one JSON object only:
{"options": ["...", "..."]}`;
}

export async function runWriter(
  llm: LlmClient,
  input: Parameters<typeof writerPrompt>[0],
): Promise<{ options: string[]; error: string | null; call: CallRecord | null }> {
  try {
    const out = await completeAndParse(llm, writerPrompt(input), writerSchema, {
      maxTokens: 1500,
      name: "evolve_writer",
    });
    return {
      // Models like curly quotes; the templates use straight ones.
      options: (out.parsed?.options ?? []).map((o) =>
        o.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"'),
      ),
      error: out.parsed ? null : (out.parseError ?? out.providerRejected),
      call: out.call,
    };
  } catch (err) {
    return {
      options: [],
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      call: null,
    };
  }
}

// ---- checker ---------------------------------------------------------------------

/** A scheme, `www.`, or any `name.tld`. */
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b/i;

/** Candidate text as one option: the same parser the template files go through. */
export function parseOption(text: string): Option {
  if (/[\r\n]/.test(text)) throw new AuthoringError("a line break");
  const tpl = parseTemplate("candidate", `[[#c ${text.trim()}]]\n`);
  const [only, ...rest] = tpl.body.filter((b) => !(b.kind === "text" && !b.text.trim()));
  if (rest.length > 0 || only?.kind !== "variants" || only.options.length !== 1) {
    throw new AuthoringError("not one option (a | or a mark)");
  }
  return only.options[0] as Option;
}

export interface CheckContext {
  /** Fact keys the template already uses. */
  facts: ReadonlySet<string>;
  /** The live alleles' texts at the locus: the length band. */
  siblings: readonly string[];
  /** Every allele key ever tried at the locus, candidates and rejects too. */
  tried: ReadonlySet<string>;
}

export type Checked = { ok: true; option: Option; key: string } | { ok: false; why: string[] };

/** Why a candidate can't be queued; parsed when it can. No LLM. */
export function checkCandidate(text: string, ctx: CheckContext): Checked {
  let option: Option;
  try {
    option = parseOption(text);
  } catch (err) {
    return { ok: false, why: [`does not parse: ${err instanceof Error ? err.message : err}`] };
  }
  const why: string[] = [];
  const words = option.map((b) => (b.kind === "text" ? b.text : " ")).join("");
  for (const b of option) {
    if (b.kind === "field" && !ctx.facts.has(b.key)) why.push(`unknown fact {${b.key}}`);
  }
  if (/[—–]/.test(words)) why.push("a dash");
  if (/[$€£¥]/.test(words)) why.push("a price");
  if (LINK.test(words)) why.push("a link");
  if (words.includes("@")) why.push("an address");
  const len = optionText(option).length;
  if (ctx.siblings.length > 0) {
    const mean = ctx.siblings.reduce((t, s) => t + s.length, 0) / ctx.siblings.length;
    if (len > mean * 1.5 || len < mean / 1.5)
      why.push(`length ${len} outside 1.5x of ${Math.round(mean)}`);
  }
  const key = alleleKey(option);
  if (ctx.tried.has(key)) why.push("already tried here");
  return why.length ? { ok: false, why } : { ok: true, option, key };
}

// ---- judge -----------------------------------------------------------------------

const judgeSchema = z.object({
  scores: z.array(
    z.object({
      n: z.number().int().min(1),
      score: z.number().min(1).max(10),
      angle: z.enum(ANGLES),
    }),
  ),
});

export interface Judged {
  text: string;
  score: number | null;
  angle: string | null;
}

export function judgePrompt(input: { locus: LocusView; candidates: string[] }): string {
  const winners = [...input.locus.alleles]
    .sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))
    .slice(0, 3)
    .map((a) => `- ${JSON.stringify(a.text)}`);
  return `Score new options for one point of a cold email against the current best ones.

Current best:
${winners.join("\n")}

New options:
${input.candidates.map((c, i) => `${i + 1}. ${JSON.stringify(c)}`).join("\n")}

For each new option: a score from 1 to 10 (10: more likely than the best ones to get a reply from a busy owner) and its angle, one of ${ANGLES.join(", ")}.
Answer with one JSON object only:
{"scores": [{"n": 1, "score": 7, "angle": "curiosity"}]}`;
}

/**
 * Scores and tags, best first. A model failure keeps the writer's order unscored.
 * `diversify` puts angles no live allele has ahead of the rest.
 */
export async function runJudge(
  llm: LlmClient,
  input: { locus: LocusView; candidates: string[]; mode: Mode },
): Promise<{ ranked: Judged[]; error: string | null; call: CallRecord | null }> {
  let scores: Map<number, { score: number; angle: string }> = new Map();
  let error: string | null = null;
  let call: CallRecord | null = null;
  try {
    const out = await completeAndParse(llm, judgePrompt(input), judgeSchema, {
      maxTokens: 400,
      name: "evolve_judge",
    });
    call = out.call;
    if (out.parsed) scores = new Map(out.parsed.scores.map((s) => [s.n, s]));
    else error = out.parseError ?? out.providerRejected;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  const taken = new Set(input.locus.alleles.map((a) => a.angle));
  const judged = input.candidates.map((text, i) => ({
    text,
    score: scores.get(i + 1)?.score ?? null,
    angle: scores.get(i + 1)?.angle ?? null,
  }));
  const fresh = (j: Judged) => (input.mode === "diversify" && !taken.has(j.angle) ? 1 : 0);
  const ranked = judged
    .map((j, i) => ({ j, i }))
    .sort((a, b) => fresh(b.j) - fresh(a.j) || (b.j.score ?? 0) - (a.j.score ?? 0) || a.i - b.i)
    .map(({ j }) => j);
  return { ranked, error, call };
}
