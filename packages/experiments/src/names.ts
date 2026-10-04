/** The strategies' names. No imports, so the browser takes them without zod. */
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
