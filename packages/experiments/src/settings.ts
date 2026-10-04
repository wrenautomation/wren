/** An experiment's settings: one schema, every field defaulted, so `{}` is valid. */
import { z } from "zod";

export const SELECTION_NAMES = ["even", "thompson", "epsilon", "ucb1"] as const;
export type SelectionName = (typeof SELECTION_NAMES)[number];
export const FITNESS_NAMES = [
  "replies",
  "interested",
  "booked",
  "opens",
  "weighted",
  "lexicographic",
] as const;
export type FitnessName = (typeof FITNESS_NAMES)[number];
/** New alleles. The writer's three need the LLM tiers (E3). */
export const MUTATION_NAMES = [
  "rewrite_loser",
  "new_angle",
  "crossover",
  "retire_only",
  "manual",
] as const;
export type MutationName = (typeof MUTATION_NAMES)[number];
/** Generation 0. Only `from_template` runs without the LLM tiers (E3). */
export const SEEDING_NAMES = ["from_template", "llm_seed", "from_winners"] as const;
export type SeedingName = (typeof SEEDING_NAMES)[number];

const fitness = z.enum(FITNESS_NAMES);

export const settingsSchema = z
  .object({
    selection: z.enum(SELECTION_NAMES).default("thompson"),
    fitness: fitness.default("interested"),
    /** Per locus, overrides `fitness` (a subject locus may use `opens`). */
    fitnessByLocus: z.record(z.string(), fitness).default({}),
    /** For `weighted`: each success counts by its weight. */
    weights: z
      .object({
        replies: z.number().min(0).default(1),
        interested: z.number().min(0).default(2),
        booked: z.number().min(0).default(4),
      })
      .strict()
      .prefault({}),
    guards: z
      .object({
        /** Retire an allele whose negative rate is above this many times its locus's. Null: off. */
        negativeRatio: z.number().positive().nullable().default(2),
      })
      .strict()
      .prefault({}),
    /** The least share a live allele gets. */
    floor: z.number().min(0).max(0.5).default(0.05),
    /** Pooled prior: each allele starts at its locus's mean rate, weighted as this many sends. */
    prior: z.number().positive().default(50),
    /** Exposures before an allele may retire or settle a locus. */
    minSends: z.number().int().min(1).default(300),
    /** Snapshots with the same best before a locus counts as stagnant. */
    window: z.number().int().min(2).default(14),
    strategistEvery: z.number().int().min(1).default(7),
    mutation: z.enum(MUTATION_NAMES).default("rewrite_loser"),
    seeding: z.enum(SEEDING_NAMES).default("from_template"),
    models: z
      .object({
        strategist: z.string().default("cohere:command-a-03-2025"),
        writer: z.string().default("cohere:command-a-03-2025"),
        judge: z.string().default("cohere:command-r7b-12-2024"),
      })
      .strict()
      .prefault({}),
    queueSize: z.number().int().min(1).default(3),
    /** Alleles ever tried at one locus before it takes no more. */
    maxAlleles: z.number().int().min(2).default(12),
    autoApprove: z.boolean().default(false),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

export const parseSettings = (raw: unknown): Settings => settingsSchema.parse(raw ?? {});

/** `settings` with one value changed; a dotted key reaches inside (`guards.negativeRatio`). */
export function withSetting(settings: Settings, key: string, value: unknown): Settings {
  const next = structuredClone(settings) as Record<string, unknown>;
  const path = key.split(".");
  let at = next;
  for (const part of path.slice(0, -1)) {
    if (typeof at[part] !== "object" || at[part] === null) throw new Error(`no setting '${key}'`);
    at = at[part] as Record<string, unknown>;
  }
  at[path.at(-1) as string] = value;
  return settingsSchema.parse(next);
}
