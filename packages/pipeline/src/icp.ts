/**
 * ICP fit (designs/2026-10-18-journeys.md): how well a person matches an offer's `Icp`. Pure.
 *
 * The structured fields (industries, sizes, roles, regions) are checked in code against the traits
 * the light read gathered. `who`, `must` and `not` are plain words, so a model judges them, and
 * only when one is injected and the person has facts to judge. A field with no known trait is
 * `unknown`: it never lowers the score. The score is the share of known checks that pass; a `not`
 * rule that applies rules the person out (0). Nothing is known: 50.
 *
 * Free and never throws: a model that errors, times out or answers badly leaves the code score and
 * one reason. The model answers verdicts only; its words are never stored or shown.
 */
import type { Icp } from "@wren/offers";

/** What the light read knows about a person. A missing field is unknown, never a no. */
export interface FitTraits {
  /** Titles and role words: "Owner", "Head of Operations". */
  roles?: readonly string[];
  /** The firm's industry or niche words: "dental". */
  industries?: readonly string[];
  /** Headcount: a count, a band ("11-50", "200+") or a persona word (solo, small, mid, large). */
  size?: number | string | null;
  /** Country codes, countries, states, cities. */
  regions?: readonly string[];
  /** Plain lines about the person for the model: "Owner at Acme Dental". */
  about?: readonly string[];
}

export interface Fit {
  /** 0 to 100. */
  score: number;
  /** Why, a line per check that settled. */
  reasons: string[];
  /** The checks that had nothing to go on. */
  unknown: string[];
}

/** The part of an `@wren/llm` client the scorer uses. */
export interface FitModel {
  complete(
    prompt: string,
    opts?: { system?: string; maxTokens?: number },
  ): Promise<{ text: string }>;
}

export type Verdict = "yes" | "no" | "unknown";

/** One thing checked: `yes` it holds, `no` it does not, `unknown` there was nothing to go on. */
interface Check {
  /** `unknown` lists this. */
  name: string;
  kind: "match" | "not";
  verdict: Verdict;
  reason: string;
}

// --- structured fields, in code ------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();

/** Do two phrases name the same thing? Equal, or one holds the other as whole words. */
const alike = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
};

const listed = (v: readonly string[] | undefined) =>
  (v ?? []).map((s) => s.trim()).filter((s) => s !== "");

/** Headcount per persona word (people-map-schema.ts: solo 1, small 2-9, mid 10-49, large 50 up). */
const PERSONA: Readonly<Record<string, readonly [number, number]>> = {
  solo: [1, 1],
  small: [2, 9],
  mid: [10, 49],
  large: [50, Number.POSITIVE_INFINITY],
};

/** A count, band or persona word as `[low, high]`; null when it reads as none of them. */
export function bandOf(v: string | number | null | undefined): readonly [number, number] | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? [v, v] : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/,/g, "");
  const named = PERSONA[s];
  if (named) return named;
  const range = /^(\d+)\s*(?:-|–|to)\s*(\d+)$/.exec(s);
  if (range) return [Number(range[1]), Number(range[2])];
  const open = /^(\d+)\s*\+$/.exec(s);
  if (open) return [Number(open[1]), Number.POSITIVE_INFINITY];
  return /^\d+$/.test(s) ? [Number(s), Number(s)] : null;
}

const show = (b: readonly [number, number]) =>
  b[0] === b[1] ? String(b[0]) : b[1] === Number.POSITIVE_INFINITY ? `${b[0]}+` : `${b[0]}-${b[1]}`;

/** A region as the words it goes by: a country code also as its name. */
function regionWords(r: string): string[] {
  const code = r.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return [r];
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code ? [r, name] : [r];
  } catch {
    return [r];
  }
}

/** The structured checks: one per ICP field that is set. */
function codeChecks(icp: Icp, traits: FitTraits): Check[] {
  const out: Check[] = [];
  const names = (
    field: string,
    want: readonly string[],
    have: readonly string[],
    label: string,
  ) => {
    if (want.length === 0) return;
    if (have.length === 0) {
      out.push({ name: field, kind: "match", verdict: "unknown", reason: "" });
      return;
    }
    const hit = have.find((h) => want.some((w) => alike(h, w)));
    out.push(
      hit
        ? { name: field, kind: "match", verdict: "yes", reason: `${label} fits: ${hit}.` }
        : {
            name: field,
            kind: "match",
            verdict: "no",
            reason: `${label} does not fit: ${have.join(", ")}.`,
          },
    );
  };
  names("industries", listed(icp.industries), listed(traits.industries), "Industry");
  names("roles", listed(icp.roles), listed(traits.roles), "Role");

  const regions = listed(icp.regions);
  if (regions.length > 0) {
    const have = listed(traits.regions);
    if (have.length === 0)
      out.push({ name: "regions", kind: "match", verdict: "unknown", reason: "" });
    else {
      const hit = have.find((h) =>
        regionWords(h).some((hw) =>
          regions.some((r) => regionWords(r).some((rw) => alike(hw, rw))),
        ),
      );
      out.push(
        hit
          ? { name: "regions", kind: "match", verdict: "yes", reason: `Region fits: ${hit}.` }
          : {
              name: "regions",
              kind: "match",
              verdict: "no",
              reason: `Region does not fit: ${have.join(", ")}.`,
            },
      );
    }
  }

  const sizes = listed(icp.sizes)
    .map(bandOf)
    .filter((b): b is readonly [number, number] => b !== null);
  if (listed(icp.sizes).length > 0) {
    const have = bandOf(traits.size);
    if (!have || sizes.length === 0)
      out.push({ name: "sizes", kind: "match", verdict: "unknown", reason: "" });
    else {
      const fits = sizes.some((s) => have[0] <= s[1] && s[0] <= have[1]);
      out.push({
        name: "sizes",
        kind: "match",
        verdict: fits ? "yes" : "no",
        reason: fits
          ? `Size ${show(have)} fits.`
          : `Size ${show(have)} does not fit ${listed(icp.sizes).join(", ")}.`,
      });
    }
  }
  return out;
}

// --- plain words, by a model ---------------------------------------------------------------

const SYSTEM =
  "You check one person against a customer profile. Use only the facts given. " +
  "Never guess: when the facts do not settle a rule, answer unknown. Answer with JSON only.";

/** The model's ask, and the keys its answer must hold. */
function askOf(icp: Icp, facts: readonly string[]): string {
  const must = listed(icp.must);
  const not = listed(icp.not);
  return [
    "Facts about the person:",
    ...facts.map((f) => `- ${f}`),
    "",
    "Judge each rule with one word: yes, no or unknown.",
    '- "who": yes when the facts show the person is who the profile describes.',
    '- "must": yes when the facts show the person meets the rule.',
    '- "not": yes when the facts show the rule applies to the person.',
    "",
    `who: ${icp.who}`,
    ...must.map((r, i) => `must ${i + 1}: ${r}`),
    ...not.map((r, i) => `not ${i + 1}: ${r}`),
    "",
    `Answer as JSON: {"who": "unknown", "must": [${must.map(() => '"unknown"').join(", ")}], "not": [${not.map(() => '"unknown"').join(", ")}]}`,
  ].join("\n");
}

const verdictOf = (v: unknown): Verdict => (v === "yes" || v === "no" ? v : "unknown");

/** The answer's JSON, from the first `{` to the last `}`; null when it is not an object. */
function answerOf(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v: unknown = JSON.parse(text.slice(a, b + 1));
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** How long the model has. The light read must not wait on a slow one. */
export const FIT_MODEL_MS = 20_000;

/** True when the ICP has a rule only a model can judge. */
export const needsModel = (icp: Icp) =>
  icp.who.trim() !== "" || listed(icp.must).length > 0 || listed(icp.not).length > 0;

/** Checks for `who`, `must` and `not`. Throws when the model fails or answers badly. */
async function modelChecks(
  icp: Icp,
  facts: readonly string[],
  model: FitModel,
  ms: number,
): Promise<Check[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  let text: string;
  try {
    ({ text } = await Promise.race([model.complete(askOf(icp, facts), { system: SYSTEM }), late]));
  } finally {
    clearTimeout(timer);
  }
  const answer = answerOf(text);
  if (!answer) throw new Error("the answer was not JSON");
  const must = Array.isArray(answer.must) ? answer.must : [];
  const not = Array.isArray(answer.not) ? answer.not : [];
  const out: Check[] = [];
  if (icp.who.trim() !== "") {
    const v = verdictOf(answer.who);
    out.push({
      name: "who",
      kind: "match",
      verdict: v,
      reason:
        v === "yes"
          ? "Matches who the profile describes."
          : "Does not match who the profile describes.",
    });
  }
  listed(icp.must).forEach((rule, i) => {
    const v = verdictOf(must[i]);
    out.push({
      name: `must: ${rule}`,
      kind: "match",
      verdict: v,
      reason: v === "yes" ? `Meets: ${rule}.` : `Does not meet: ${rule}.`,
    });
  });
  listed(icp.not).forEach((rule, i) => {
    const v = verdictOf(not[i]);
    out.push({
      name: `not: ${rule}`,
      kind: "not",
      verdict: v,
      reason: v === "yes" ? `Ruled out: ${rule}.` : `Clear of: ${rule}.`,
    });
  });
  return out;
}

// --- the score -----------------------------------------------------------------------------

const unsettled = (icp: Icp): Check[] => [
  ...(icp.who.trim() !== ""
    ? [{ name: "who", kind: "match" as const, verdict: "unknown" as const, reason: "" }]
    : []),
  ...listed(icp.must).map((r) => ({
    name: `must: ${r}`,
    kind: "match" as const,
    verdict: "unknown" as const,
    reason: "",
  })),
  ...listed(icp.not).map((r) => ({
    name: `not: ${r}`,
    kind: "not" as const,
    verdict: "unknown" as const,
    reason: "",
  })),
];

function fitOf(checks: readonly Check[], notes: readonly string[]): Fit {
  const reasons = [...notes];
  const unknown: string[] = [];
  let met = 0;
  let missed = 0;
  let ruledOut = false;
  for (const c of checks) {
    if (c.verdict === "unknown") {
      unknown.push(c.name);
      continue;
    }
    // A `not` that does not apply is not a point for the person: it only clears them.
    if (c.kind === "not") ruledOut ||= c.verdict === "yes";
    else if (c.verdict === "yes") met += 1;
    else missed += 1;
    reasons.push(c.reason);
  }
  const known = met + missed;
  if (known === 0 && !ruledOut) reasons.push("Nothing is known yet to check against the profile.");
  const score = ruledOut ? 0 : known === 0 ? 50 : Math.round((100 * met) / known);
  return { score, reasons, unknown };
}

/**
 * The person's fit to the ICP. Without `model`, `who`, `must` and `not` stay unknown. Never throws.
 * `ms` is how long the model has.
 */
export async function scoreFit(
  icp: Icp,
  traits: FitTraits,
  model?: FitModel | null,
  ms = FIT_MODEL_MS,
): Promise<Fit> {
  const checks = codeChecks(icp, traits);
  const facts = listed(traits.about);
  if (!model || !needsModel(icp) || facts.length === 0)
    return fitOf([...checks, ...unsettled(icp)], []);
  try {
    return fitOf([...checks, ...(await modelChecks(icp, facts, model, ms))], []);
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 800) : "an error";
    return fitOf(
      [...checks, ...unsettled(icp)],
      [`The model check failed (${why}); the score uses the fields checked in code.`],
    );
  }
}
