/**
 * Pickers: HOW one option is chosen at a variant point.
 *
 * The options are always human-authored; a picker only returns an index into the currently
 * eligible ones, and the choice is recorded in provenance whichever picker made it. Pickers
 * are plain data, so a template containing them stays content-hashable. Nothing behind this
 * interface may emit text of its own.
 */
import { createHash } from "node:crypto";
import { pyReprStr } from "./pyrepr.js";

/** The facts row as the renderer sees it: any value, absence is null/undefined. */
export type FactValues = Readonly<Record<string, unknown>>;

/**
 * One fact by its key, from the facts' own properties only: `{constructor}` or `{__proto__}` is
 * a fact nobody gave, never something inherited.
 */
export const fact = (facts: FactValues, key: string): unknown =>
  Object.hasOwn(facts, key) ? facts[key] : undefined;

/** Deterministic spread: one recipient always gets the same option. */
export interface HashPick {
  readonly kind: "hash";
}

/** First rule whose regex matches the named fact wins its option. */
export interface Rule {
  readonly fact: string;
  readonly pattern: string;
  readonly option: number;
}

/** Route on facts, fall back to the hash spread. */
export interface RulePick {
  readonly kind: "rule";
  readonly rules: readonly Rule[];
}

/** Preview only: forces each variant point to one option (first eligible when forced one is not). */
export interface FixedPick {
  readonly kind: "fixed";
  readonly choices: Readonly<Record<string, number>>;
}

export type Picker = HashPick | RulePick | FixedPick;

export const HASH_PICK: HashPick = { kind: "hash" };

export function rule(fact: string, pattern: string, option: number): Rule {
  if (!fact) throw new Error("a Rule needs a fact key");
  if (option < 0) throw new Error("a Rule option index cannot be negative");
  try {
    new RegExp(pattern, "i");
  } catch (err) {
    throw new Error(`bad Rule pattern ${pyReprStr(pattern)}: ${String(err)}`);
  }
  return { fact, pattern, option };
}

export function rulePick(rules: readonly Rule[]): RulePick {
  if (rules.length === 0) throw new Error("RulePick with no rules is just HashPick — use that");
  return { kind: "rule", rules: [...rules] };
}

/** A fact's sentence text: `str(value).strip()` or null when absent/blank. */
export function factText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = (value instanceof Date ? value.toISOString() : String(value)).trim();
  return text || null;
}

/** sha256 of `${seed}\x00${variant}`, as a big integer mod the eligible count. */
export function hashPick(variant: string, eligible: readonly number[], seed: string): number {
  const digest = createHash("sha256").update(`${seed}\x00${variant}`, "utf8").digest("hex");
  const index = Number(BigInt(`0x${digest}`) % BigInt(eligible.length));
  return eligible[index] as number;
}

/** Choose one of `eligible` (indices into the variant's options). */
/**
 * A draw along an experiment's shares: u from the same digest as hashPick, over 2^256,
 * walked along the eligible options' cumulative shares. The same seed and shares always
 * give the same option. No share on any eligible option: the hash spread.
 */
export function sharePick(
  variant: string,
  eligible: readonly number[],
  seed: string,
  shares: readonly number[],
): number {
  const weights = eligible.map((i) => shares[i] ?? 0);
  const total = weights.reduce((t, w) => t + w, 0);
  if (!(total > 0)) return hashPick(variant, eligible, seed);
  const digest = createHash("sha256").update(`${seed}\x00${variant}`, "utf8").digest("hex");
  const u = (Number(BigInt(`0x${digest}`)) / 2 ** 256) * total;
  let run = 0;
  for (const [k, w] of weights.entries()) {
    run += w;
    if (u < run) return eligible[k] as number;
  }
  return eligible.at(-1) as number;
}

export function pickOption(
  picker: Picker,
  variant: string,
  eligible: readonly number[],
  seed: string,
  facts: FactValues,
  shares?: readonly number[],
): number {
  const spread = () =>
    shares ? sharePick(variant, eligible, seed, shares) : hashPick(variant, eligible, seed);
  switch (picker.kind) {
    case "hash":
      return spread();
    case "rule": {
      for (const r of picker.rules) {
        const value = factText(fact(facts, r.fact));
        if (value === null) continue;
        if (eligible.includes(r.option) && new RegExp(r.pattern, "i").test(value)) {
          return r.option;
        }
      }
      return spread();
    }
    case "fixed": {
      const choice = picker.choices[variant];
      return choice !== undefined && eligible.includes(choice) ? choice : (eligible[0] as number);
    }
  }
}
