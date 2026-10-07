/**
 * Feature flags (designs/2026-10-06-flags-experiments-surveys-heatmaps.md §2): a flag has
 * variants and ordered rules, and the first rule that holds picks the variant. Killed, it is its
 * fallback for everyone. Type imports only, so the portal's web bundle and the edge read the
 * same code; the lander keeps a copy of `fnv` and the evaluation (functions/_shared/edge.ts).
 */

import type { Who } from "./access.js";

export const SURFACES = ["portal", "site", "both"] as const;
export type Surface = (typeof SURFACES)[number];

/** Every condition given must hold; none given is everyone. */
export interface FlagRule {
  variant: string;
  /** Any of: a team role (`admin`, `operator`, `viewer`), a member role, or `team` / `client`. */
  roles?: string[];
  clients?: string[];
  /** Login emails. */
  people?: string[];
  /**
   * 0 to 100: the share of people (or site visitors), by a hash of the flag key and their id.
   * The bucket is the same for every rule of one flag, so `b: 20%` then `c: 50%` gives c 30%.
   */
  percent?: number;
}

export interface FlagDef {
  key: string;
  variants: readonly string[];
  rules: readonly FlagRule[];
  fallback: string;
  killed: boolean;
}

/** Who a flag is asked about. `id` buckets percent rules: a login's email, a site visitor's id. */
export interface FlagSubject {
  id: string | null;
  roles: readonly string[];
  client: string | null;
  person: string | null;
}

/** What a login is, to a flag: roles `team` + its team role, or `client` + its member role. */
export function subjectOf(who: Who, email: string | null, client: string | null): FlagSubject {
  const roles =
    who && "team" in who
      ? ["team", who.team]
      : who && "member" in who
        ? ["client", who.member]
        : [];
  const person = email?.toLowerCase() ?? null;
  return { id: person, roles, client, person };
}

/** FNV-1a, 32 bits, over UTF-8: the lander's is the same. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

/** 0 to 99.99: where an id falls for a flag. */
export const bucketOf = (key: string, id: string) => (fnv(`${key}:${id}`) % 10000) / 100;

const holds = (r: FlagRule, flag: string, s: FlagSubject) =>
  (!r.roles?.length || r.roles.some((x) => s.roles.includes(x))) &&
  (!r.clients?.length || (s.client !== null && r.clients.includes(s.client))) &&
  (!r.people?.length || (s.person !== null && r.people.includes(s.person.toLowerCase()))) &&
  (r.percent === undefined || (s.id !== null && bucketOf(flag, s.id) < r.percent));

/** The variant `s` gets. */
export function variantOf(flag: FlagDef, s: FlagSubject): string {
  if (flag.killed) return flag.fallback;
  return flag.rules.find((r) => holds(r, flag.key, s))?.variant ?? flag.fallback;
}

/** Every flag's variant for one subject, by key. */
export const evaluateFlags = (flags: readonly FlagDef[], s: FlagSubject): Record<string, string> =>
  Object.fromEntries(flags.map((f) => [f.key, variantOf(f, s)]));

/** A flag that's on/off reads as on when its variant is anything but `off`. */
export const isOn = (variant: string | undefined) => !!variant && variant !== "off";

/*
 * Rules as words, one per line, for the form, History and Ask Claude:
 *
 *   on: roles operator, admin
 *   on: clients acme; 50%
 *   b: 20%
 *   on: everyone
 */
const LIST = /^(roles|clients|people)\s+(.+)$/i;
const PERCENT = /^(\d{1,3}(?:\.\d{1,2})?)\s*%$/;

/** The rules in words, or what's wrong with them. */
export function parseRules(
  text: string,
  variants: readonly string[],
): { rules: FlagRule[] } | { error: string } {
  const rules: FlagRule[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 50) return { error: "At most 50 rules." };
  for (const [i, line] of lines.entries()) {
    const at = `Line ${i + 1}`;
    const colon = line.indexOf(":");
    if (colon < 1) return { error: `${at}: start with the variant, then a colon ("on: 20%").` };
    const variant = line.slice(0, colon).trim();
    if (!variants.includes(variant))
      return { error: `${at}: "${variant}" isn't one of ${variants.join(", ")}.` };
    const rule: FlagRule = { variant };
    for (const part of line
      .slice(colon + 1)
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)) {
      if (/^everyone$/i.test(part)) continue;
      const pct = PERCENT.exec(part);
      if (pct) {
        const n = Number(pct[1]);
        if (n > 100) return { error: `${at}: a share is 0 to 100%.` };
        rule.percent = n;
        continue;
      }
      const list = LIST.exec(part);
      if (!list?.[1] || !list[2])
        return { error: `${at}: "${part}" isn't roles, clients, people, a % or everyone.` };
      const kind = list[1].toLowerCase() as "roles" | "clients" | "people";
      const items = list[2]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => (kind === "people" ? x.toLowerCase() : x));
      rule[kind] = [...(rule[kind] ?? []), ...items].slice(0, 200);
    }
    rules.push(rule);
  }
  return { rules };
}

/** Rules back to words: `parseRules(formatRules(r))` gives `r`. */
export function formatRules(rules: readonly FlagRule[]): string {
  return rules
    .map((r) => {
      const parts = [
        r.roles?.length ? `roles ${r.roles.join(", ")}` : null,
        r.clients?.length ? `clients ${r.clients.join(", ")}` : null,
        r.people?.length ? `people ${r.people.join(", ")}` : null,
        r.percent !== undefined ? `${r.percent}%` : null,
      ].filter(Boolean);
      return `${r.variant}: ${parts.length ? parts.join("; ") : "everyone"}`;
    })
    .join("\n");
}

/*
 * Experiments (§3): a site flag with a goal. While one runs, the edge gets its shares as
 * percent rules in place of the flag's own, so the bandit moves traffic without a lander push.
 */
export const EXPERIMENT_GOALS = ["forms", "calls", "paid"] as const;
export type ExperimentGoal = (typeof EXPERIMENT_GOALS)[number];
/** draft → running → settled (P(best) ≥ 0.95, shares held) → shipped; or stopped. */
export const EXPERIMENT_STATES = ["draft", "running", "settled", "shipped", "stopped"] as const;
export type ExperimentState = (typeof EXPERIMENT_STATES)[number];

/** Shares (0 to 1, by variant) as rules: cumulative percents on the flag's one bucket, the last everyone. */
export function shareRules(
  variants: readonly string[],
  shares: Readonly<Record<string, number>>,
): FlagRule[] {
  const live = variants.filter((v) => (shares[v] ?? 0) > 0);
  const total = live.reduce((t, v) => t + (shares[v] ?? 0), 0);
  if (!total) return [];
  let at = 0;
  return live.map((variant, i) => {
    if (i === live.length - 1) return { variant };
    at += ((shares[variant] ?? 0) / total) * 100;
    return { variant, percent: Math.round(at * 100) / 100 };
  });
}
