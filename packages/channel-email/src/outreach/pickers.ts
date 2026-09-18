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
export function pickOption(
  picker: Picker,
  variant: string,
  eligible: readonly number[],
  seed: string,
  facts: FactValues,
): number {
  switch (picker.kind) {
    case "hash":
      return hashPick(variant, eligible, seed);
    case "rule": {
      for (const r of picker.rules) {
        const value = factText(facts[r.fact]);
        if (value === null) continue;
        if (eligible.includes(r.option) && new RegExp(r.pattern, "i").test(value)) {
          return r.option;
        }
      }
      return hashPick(variant, eligible, seed);
    }
    case "fixed": {
      const choice = picker.choices[variant];
      return choice !== undefined && eligible.includes(choice) ? choice : (eligible[0] as number);
    }
  }
}
