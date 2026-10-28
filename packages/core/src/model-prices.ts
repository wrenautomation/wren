/**
 * What a model call costs, in integer micro-dollars, for the meter. The rates live in one table,
 * `@wrenautomation/models/prices`; this file only turns its USD into micros. `tokenCost` is the
 * one place a token count becomes money; the `anthropic` vendor (vendors.ts) meters it per call.
 */
import {
  pricesText as modelPricesText,
  PRICES_AS_OF,
  priceOf,
  priceUsd,
} from "@wrenautomation/models/prices";

export { priceOf };

export const ANTHROPIC_PRICES_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
export const ANTHROPIC_PRICES_AS_OF = PRICES_AS_OF;

/** One request's tokens, as the provider counts them. */
export interface TokenUsage {
  /** Every prompt token, cache reads and writes included. */
  input: number | null;
  output: number | null;
  /** Of `input`: read from the cache. */
  cacheRead?: number | null;
  /** Of `input`: written to the cache (5 minutes unless `cacheWrite1h` says).  */
  cacheWrite?: number | null;
  /** Of `cacheWrite`: the share that lives 1 hour. */
  cacheWrite1h?: number | null;
}

/**
 * Micro-dollars one request cost. An unknown model costs 0 (check `priceOf` to warn); it never
 * throws. Rounded once, on the sum.
 */
export function tokenCost(model: string, u: TokenUsage): number {
  const usd = priceUsd(model, {
    input: u.input ?? 0,
    output: u.output ?? 0,
    cacheRead: u.cacheRead ?? 0,
    cacheWrite: u.cacheWrite ?? 0,
    cacheWrite1h: u.cacheWrite1h ?? 0,
  });
  // USD to micros in float can land a hair under a half; 1e-6 micros puts it back.
  return usd === undefined ? 0 : Math.round(usd * 1_000_000 + 1e-6);
}

/** "Opus 5.5 $4.00 in, $20.00 out; ... per million tokens": Anthropic's models. */
export function pricesText(): string {
  return modelPricesText("anthropic");
}
