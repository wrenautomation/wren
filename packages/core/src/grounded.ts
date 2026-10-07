/**
 * The facts guard: code, after every model draft that writes as William or Wren. It flags a
 * first-person experience claim ("I built", "we paid", "last year we", "my clients") no fact
 * backs, and a number found in neither the source (the post, thread, comment or idea) nor the
 * facts. A flagged draft is asked for once more with what was flagged; flagged again, it is
 * dropped. Every hit is a `runs` row (`guard`), so what it caught can be read back.
 */
import type { Queryable } from "@wren/db";
import { finishRun, openRun } from "./runs.js";

export interface Grounding {
  /** What is true about the writer (`facts.ts`): backs claims, and its numbers may be used. */
  facts: readonly string[];
  /** What the draft answers: a post, thread, comment, the thread so far. Its numbers may be used. */
  sources: readonly string[];
  /** The writer's own words (an idea he wrote, his earlier messages): back claims like facts. */
  own?: readonly string[];
}

export interface GroundingFlag {
  kind: "claim" | "number";
  /** The words flagged: the claim's sentence, or the number as written. */
  text: string;
}

const norm = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

/** Sentences: split at end marks and line breaks. */
const sentences = (s: string) =>
  norm(s)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

// Past tense of doing things: a story about the writer. Reactions to the post ("I liked") pass.
const DID =
  "built|ran|run|paid|made|sold|saw|seen|found|got|did|done|spent|lost|grew|led|took|went|wrote|hit|cut|won|brought|bought|began|kept|left|met|put|set|told|gave|chose|drove|held|taught|spoke|heard|been|had|[a-z]{2,}ed";
const REACTION = new Set([
  "liked",
  "loved",
  "enjoyed",
  "noticed",
  "wondered",
  "appreciated",
  "agreed",
  "needed",
  "wanted",
  "guessed",
  "assumed",
  "expected",
  "imagined",
  "hoped",
  "missed",
]);
const ADVERBS =
  "just|once|also|recently|already|actually|finally|then|still|never|always|first|personally|literally|even|ever|really|only";
const CLAIM_VERB = new RegExp(
  `\\b(?:i|we)(?:'ve|'d|\\s+have|\\s+had)?(?:\\s+(?:${ADVERBS}))*\\s+(${DID})\\b`,
  "gi",
);
const DOING =
  /\b(?:i'm|i am|we're|we are)\s+(?:now\s+|currently\s+|also\s+|still\s+)?(?:building|rebuilding|running|using|testing|seeing|working|hiring|selling|scaling|launching|shipping|automating|doing|paying|placing|booking)\b/i;
const OURS =
  /\b(?:my|our)\s+(?:own\s+|first\s+|last\s+|biggest\s+|best\s+|old\s+)?(?:clients?|customers?|team|agency|company|business|firm|reps?|recruiters?|candidates?|pipeline|revenue|data|numbers|tools?|system|platform|product|users?|campaigns?|results?|experience|sales|hires?|placements?|startup|students?|staff|employees?|graduation)\b/i;
const AT_WREN =
  /\b(?:at|with) wren\b|\bwren (?:has|had|built|did|does|helped|helps|cut|booked|saw)\b/i;
const WHEN =
  /\b(?:last|this) (?:year|month|week|quarter)\b|\b(?:years|months|weeks) ago\b|\bin my experience\b|\bback when\b/i;
const ME = /\b(?:i|me|my|we|us|our)\b/i;

/** Why a sentence is a first-person experience claim, or null. */
export function claimIn(sentence: string): string | null {
  const s = norm(sentence);
  for (const m of s.matchAll(CLAIM_VERB))
    if (!REACTION.has((m[1] ?? "").toLowerCase())) return m[0];
  return (
    DOING.exec(s)?.[0] ??
    OURS.exec(s)?.[0] ??
    AT_WREN.exec(s)?.[0] ??
    (ME.test(s) ? (WHEN.exec(s)?.[0] ?? null) : null)
  );
}

const STOP = new Set(
  (
    "the a an and or but of to in on at for with from by as is are was were be it its this that " +
    "these those there their they them then than so if not no yes do does how what who why when " +
    "which i me my we us our you your he she his her has have had just also very much more most " +
    "one into out up about over after before all any each some such own can could would should " +
    "will may might it's i'm i've we've i'd we'd still now"
  ).split(" "),
);
const VERBS = new RegExp(`^(?:${DID})$`);
/** A crude stem: plurals and verb endings off, so "leads" meets "lead" and "booked" meets "book". */
const stem = (w: string) => w.replace(/'s$/, "").replace(/(?:ing|ed|es|s)$/, "") || w;
const contentWords = (s: string, drop: (w: string) => boolean = () => false) =>
  new Set(
    (
      norm(s)
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9'-]*/g) ?? []
    )
      .filter((w) => !STOP.has(w) && !/^\d/.test(w) && !drop(w))
      .map(stem)
      .filter((w) => w.length >= 2),
  );

/**
 * A claim is backed when one fact or one of his own sentences says the same deed ("built" backs
 * "built", never "booked") and most of the rest of what it says.
 */
function backed(sentence: string, claim: string, backers: readonly string[]): boolean {
  const said = contentWords(sentence, (w) => VERBS.test(w));
  const last = claim.toLowerCase().split(/\s+/).at(-1) ?? "";
  const deed = VERBS.test(last) ? stem(last) : null;
  if (said.size === 0 && !deed) return false;
  return backers.some((b) => {
    const bag = contentWords(b);
    if (deed && !bag.has(deed)) return false;
    const hits = [...said].filter((w) => bag.has(w)).length;
    return said.size === 0 || hits / said.size >= 0.6;
  });
}

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};
// A number standing alone (not inside "B2B", "H1B", "Q4"), with its scale word when it has one.
const NUMBER =
  /(?<![a-z0-9.])(\d[\d,]*(?:\.\d+)?)(?:\s?(k|mm|m|bn|b|thousand|million|billion)\b)?(?:st|nd|rd|th)?(?![a-z])/gi;
const IDIOMS = /\b24\/7\b|\b1:1\b|\b9-to-5\b|\b9 to 5\b/gi;

/** Every number in the words, as a value: "$30M" and "30 million" both read 30000000. */
export function numbersIn(text: string): { text: string; value: number }[] {
  const out: { text: string; value: number }[] = [];
  for (const m of norm(text).replace(IDIOMS, " ").matchAll(NUMBER)) {
    const n = Number((m[1] ?? "").replace(/,/g, ""));
    if (Number.isNaN(n)) continue;
    out.push({ text: m[0].trim(), value: n * (SCALE[(m[2] ?? "").toLowerCase()] ?? 1) });
  }
  return out;
}

/**
 * What the guard flags in a draft: each first-person claim no fact (or his own words) backs, and
 * each number found in neither the sources nor the facts. Empty: it may go to his yes.
 */
export function groundingFlags(draft: string, g: Grounding): GroundingFlag[] {
  const flags: GroundingFlag[] = [];
  const backers = [...g.facts, ...(g.own ?? []).flatMap(sentences)];
  for (const s of sentences(draft)) {
    const claim = claimIn(s);
    if (claim && !backed(s, claim, backers)) flags.push({ kind: "claim", text: s });
  }
  const known = new Set(
    [...g.facts, ...g.sources, ...(g.own ?? [])].flatMap((t) => numbersIn(t).map((n) => n.value)),
  );
  const seen = new Set<number>();
  for (const n of numbersIn(draft))
    if (!known.has(n.value) && !seen.has(n.value)) {
      seen.add(n.value);
      flags.push({ kind: "number", text: n.text });
    }
  return flags;
}

/** What the model is told on its one more try. */
export function fixNote(flags: readonly GroundingFlag[]): string {
  return `Your last draft said things that are not in the facts or the source:
${flags.map((f) => (f.kind === "claim" ? `- a made-up experience: "${f.text}"` : `- a number from nowhere: ${f.text}`)).join("\n")}
Write it again without them. Claim only what the facts say, and use only numbers the source or the facts give. With nothing true that fits, add an insight or ask a question.`;
}

export type GuardOutcome = "clean" | "redrafted" | "dropped";

export interface Guarded<T> {
  outcome: GuardOutcome;
  /** The words that may go to his yes; null when dropped. "" when the model chose to say nothing. */
  text: string | null;
  /** The attempt the words came from (the last one when dropped). */
  result: T;
  /** What the first attempt was flagged for; empty when clean. */
  flags: GroundingFlag[];
  /** The first attempt's words, when it was flagged. */
  first: string | null;
  /** What the second attempt was still flagged for, when dropped. */
  still: GroundingFlag[];
}

/**
 * Draft, check, and on a flag draft once more with the flags as a note. `attempt(null)` is the
 * first draft; `attempt(note)` the retry. An empty draft is never flagged: saying nothing is fine.
 */
export async function guardDraft<T>(
  attempt: (fix: string | null) => Promise<{ text: string; result: T }>,
  g: Grounding,
): Promise<Guarded<T>> {
  const a = await attempt(null);
  const flags = a.text.trim() ? groundingFlags(a.text, g) : [];
  if (!flags.length)
    return { outcome: "clean", text: a.text, result: a.result, flags, first: null, still: [] };
  const b = await attempt(fixNote(flags));
  const still = b.text.trim() ? groundingFlags(b.text, g) : [];
  return {
    outcome: still.length ? "dropped" : "redrafted",
    text: still.length ? null : b.text,
    result: b.result,
    flags,
    first: a.text,
    still,
  };
}

/** One sentence for a dropped draft's reason. */
export const droppedWhy = (g: Pick<Guarded<unknown>, "still" | "flags">) =>
  `made things up: ${(g.still.length ? g.still : g.flags)
    .map((f) => (f.kind === "claim" ? `"${f.text.slice(0, 80)}"` : f.text))
    .join("; ")}`.slice(0, 300);

/**
 * The run ledger's row for a guard hit (redrafted or dropped): the stage, the item, both
 * attempts and what each was flagged for. A clean draft writes nothing.
 */
export async function recordGuard(
  db: Queryable,
  stage: string,
  item: string,
  g: Guarded<unknown>,
): Promise<void> {
  if (g.outcome === "clean") return;
  const run = await openRun(db, { command: "guard", argv: { stage, item } });
  await finishRun(db, run.id, {
    outcome: g.outcome,
    flags: g.flags,
    first: g.first,
    still: g.still,
    final: g.text,
  });
}
