/**
 * What Anthropic charges per token, by model. Prices are integer micro-dollars per million
 * tokens, read from the pricing page on `ANTHROPIC_PRICES_AS_OF`. `tokenCost` is the one place a
 * token count becomes money; the `anthropic` vendor (vendors.ts) meters it per call.
 */

export const ANTHROPIC_PRICES_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
export const ANTHROPIC_PRICES_AS_OF = "2026-10-19";

/** Micro-dollars per million tokens. */
export interface TokenPrice {
  input: number;
  /** A cache write that lives 5 minutes (the default). */
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelPrice {
  /** The model id, without a date suffix. */
  model: string;
  /** Said to a person. */
  name: string;
  /**
   * Prices by prompt length, shortest first. A request is priced on its own prompt: all input
   * tokens, cache reads and writes included. `upTo` is the longest prompt the tier takes
   * (inclusive); null: any.
   */
  tiers: readonly { upTo: number | null; price: TokenPrice }[];
}

export const MODEL_PRICES: readonly ModelPrice[] = [
  {
    model: "claude-sonnet-5-5",
    name: "Sonnet 5.5",
    tiers: [
      {
        upTo: null,
        price: {
          input: 2_000_000,
          cacheWrite5m: 2_500_000,
          cacheWrite1h: 4_000_000,
          cacheRead: 100_000,
          output: 10_000_000,
        },
      },
    ],
  },
  {
    model: "claude-haiku-5-5",
    name: "Haiku 5.5",
    tiers: [
      {
        upTo: 100_000,
        price: {
          input: 100_000,
          cacheWrite5m: 125_000,
          cacheWrite1h: 200_000,
          cacheRead: 10_000,
          output: 500_000,
        },
      },
      {
        upTo: null,
        price: {
          input: 500_000,
          cacheWrite5m: 625_000,
          cacheWrite1h: 1_000_000,
          cacheRead: 50_000,
          output: 2_500_000,
        },
      },
    ],
  },
  {
    // The worker's default Anthropic model (`DEFAULT_ANTHROPIC_MODEL` in @wren/llm).
    model: "claude-haiku-4-5",
    name: "Haiku 4.5",
    tiers: [
      {
        upTo: null,
        price: {
          input: 1_000_000,
          cacheWrite5m: 1_250_000,
          cacheWrite1h: 2_000_000,
          cacheRead: 100_000,
          output: 5_000_000,
        },
      },
    ],
  },
];

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

/** The price list for a model id; a dated id ("claude-haiku-5-5-20261001") takes its base's. */
export function priceOf(model: string): ModelPrice | null {
  return MODEL_PRICES.find((p) => model === p.model || model.startsWith(`${p.model}-`)) ?? null;
}

const n = (v: number | null | undefined) => (v && v > 0 ? v : 0);

/**
 * Micro-dollars one request cost. An unknown model costs 0 (check `priceOf` to warn); it never
 * throws. Rounded once, on the sum.
 */
export function tokenCost(model: string, u: TokenUsage): number {
  const p = priceOf(model);
  if (!p) return 0;
  const input = n(u.input);
  const cacheRead = Math.min(n(u.cacheRead), input);
  const cacheWrite = Math.min(n(u.cacheWrite), input - cacheRead);
  const write1h = Math.min(n(u.cacheWrite1h), cacheWrite);
  const plain = input - cacheRead - cacheWrite;
  const tier = p.tiers.find((t) => t.upTo === null || input <= t.upTo) ?? p.tiers.at(-1);
  if (!tier) return 0;
  const t = tier.price;
  return Math.round(
    (plain * t.input +
      cacheRead * t.cacheRead +
      (cacheWrite - write1h) * t.cacheWrite5m +
      write1h * t.cacheWrite1h +
      n(u.output) * t.output) /
      1_000_000,
  );
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** "Sonnet 5.5 $2.00 in, $10.00 out; Haiku 5.5 $0.10 in, $0.50 out, per million tokens". */
export function pricesText(): string {
  const first = (p: ModelPrice) => p.tiers[0]?.price;
  return `${MODEL_PRICES.flatMap((m) => {
    const t = first(m);
    return t ? [`${m.name} ${usd(t.input)} in, ${usd(t.output)} out`] : [];
  }).join("; ")}, per million tokens`;
}
