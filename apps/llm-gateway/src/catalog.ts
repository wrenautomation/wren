/**
 * What the gateway can call: providers, their models' free-tier limits per key, and the
 * aliases that fall through a chain of models. Limits are keycycle's (its sync_models.py
 * scrapes AI Studio's free tier); a model missing here takes its provider's default.
 * A 429 is the real limit: the ledger cools a key down whatever this table says.
 */

export type Provider = "gemini" | "openrouter" | "cohere";

export interface Limits {
  /** Requests per minute, per key. */
  rpm: number;
  /** Requests per day, per key; the day is the provider's (see `dayKey`). */
  rpd: number;
}

export interface ProviderSpec {
  baseURL: string;
  /** The secret holding this provider's keys, one per line. */
  secret: "GEMINI_KEYS" | "OPENROUTER_KEYS" | "COHERE_KEYS";
  /** The provider's day for RPD: Gemini resets at midnight Pacific, the others at UTC. */
  timeZone: string;
  defaults: Limits;
  models: Record<string, Limits>;
}

export const PROVIDERS: Record<Provider, ProviderSpec> = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    secret: "GEMINI_KEYS",
    timeZone: "America/Los_Angeles",
    defaults: { rpm: 5, rpd: 20 },
    models: {
      "gemini-3.8-flash": { rpm: 5, rpd: 20 },
      "gemini-3.7-flash": { rpm: 5, rpd: 20 },
      "gemini-3.6-flash": { rpm: 5, rpd: 20 },
      "gemini-3.5-flash": { rpm: 5, rpd: 20 },
      "gemini-3-flash-preview": { rpm: 5, rpd: 20 },
      "gemini-2.5-flash": { rpm: 5, rpd: 20 },
      "gemini-3.1-flash-lite": { rpm: 15, rpd: 500 },
      "gemini-3.5-flash-lite": { rpm: 15, rpd: 500 },
      "gemini-2.5-flash-lite": { rpm: 10, rpd: 20 },
      "gemma-4-31b-it": { rpm: 30, rpd: 14400 },
      "gemma-4-26b-a4b-it": { rpm: 30, rpd: 14400 },
    },
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    secret: "OPENROUTER_KEYS",
    timeZone: "UTC",
    // :free models without credits on the account: 20 a minute, 50 a day.
    defaults: { rpm: 20, rpd: 50 },
    models: {},
  },
  cohere: {
    baseURL: "https://api.cohere.ai/compatibility/v1",
    secret: "COHERE_KEYS",
    timeZone: "UTC",
    defaults: { rpm: 20, rpd: 1000 },
    models: {},
  },
};

export interface Target {
  provider: Provider;
  model: string;
}

/** Aliases: best first, then what is left when the best are spent for the day. */
export const ALIASES: Record<string, Target[]> = {
  free: [
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "gemini", model: "gemini-3.7-flash" },
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "gemini", model: "gemini-3.5-flash" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "gemini", model: "gemma-4-31b-it" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  ],
  // Volume over quality: Gemma's 14,400 a day per key first.
  "free-bulk": [
    { provider: "gemini", model: "gemma-4-31b-it" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "gemini", model: "gemma-4-26b-a4b-it" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "openrouter", model: "google/gemma-4-26b-a4b-it:free" },
  ],
};

export function limitsFor(t: Target): Limits {
  const spec = PROVIDERS[t.provider];
  return spec.models[t.model] ?? spec.defaults;
}

/**
 * The chain for a request's `model`: an alias, or "<provider>/<model>" for one model.
 * Null when it names neither.
 */
export function resolve(model: string | undefined): Target[] | null {
  const name = model?.trim() || "free";
  const alias = ALIASES[name];
  if (alias) return alias;
  const slash = name.indexOf("/");
  if (slash < 1) return null;
  const provider = name.slice(0, slash);
  if (!(provider in PROVIDERS)) return null;
  return [{ provider: provider as Provider, model: name.slice(slash + 1) }];
}

/** The provider's calendar day ("2026-10-06") for RPD counts. */
export function dayKey(provider: Provider, now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PROVIDERS[provider].timeZone }).format(
    new Date(now),
  );
}
