# @wren/experiments: interface

Exports: 26. Files: 5.

## packages/experiments/src/engine.ts

- **posteriors** (function) `(arms: readonly Arm[], prior: number): Beta[]`
- **pBest** (function) `(post: readonly Beta[]): number[]`
- **withFloor** (function) `(shares: readonly number[], floor: number): number[]`
- **evaluateLocus** (function) `(input: LocusInput, settings: Settings): LocusResult`
- **stopReason** (function) `(loci: readonly LocusResult[]): Exclude<StopReason, "stopped"> | null`
- **AlleleCounts** (interface) `interface AlleleCounts { readonly exposures: number; readonly replies: number; readonly interested: number; readonly booked: number; readonly opens: number; readonly tracked: number; readonly negatives: number; }`
- **Beta** (interface) `interface Beta { readonly a: number; readonly b: number; }`
- **Weights** (type) `type Weights = Settings["weights"];`
- **FITNESS** (const) `Readonly<Record<FitnessName, Fitness>>`
- **SELECTION** (const) `Readonly<Record<SelectionName, Selection>>`
- **StopReason** (type) `type StopReason = "settled" | "budget" | "stopped";`

## packages/experiments/src/names.ts

- **SELECTION_NAMES** (const) `readonly ["even", "thompson", "epsilon", "ucb1"]`
- **SelectionName** (type) `type SelectionName = (typeof SELECTION_NAMES)[number];`
- **FITNESS_NAMES** (const) `readonly ["replies", "interested", "booked", "opens", "weighted", "lexicographic"]`
- **FitnessName** (type) `type FitnessName = (typeof FITNESS_NAMES)[number];`
- **MUTATION_NAMES** (const) `readonly ["rewrite_loser", "new_angle", "crossover", "retire_only", "manual"]`
- **MutationName** (type) `type MutationName = (typeof MUTATION_NAMES)[number];`
- **SEEDING_NAMES** (const) `readonly ["from_template", "llm_seed", "from_winners"]`
- **SeedingName** (type) `type SeedingName = (typeof SEEDING_NAMES)[number];`

## packages/experiments/src/rng.ts

- **seeded** (function) `(seed: string | number): Rng`
- **betaDraw** (function) `(rng: Rng, a: number, b: number): number`
- **Rng** (type) `type Rng = () => number;`

## packages/experiments/src/settings.ts

- **settingsSchema** (const) `z.ZodObject<{ selection: z.ZodDefault<z.ZodEnum<{ even: "even"; thompson: "thompson"; epsilon: "epsilon"; ucb1: "ucb1"; }>>; fitness: z.ZodDefault<z.ZodEnum<{ booked: "booked"; interested: "interested"; replies: "replies"; opens: "opens"; weighted: "weighted"; lexicographic: "lexicographic"; }>>; fi…`
- **Settings** (type) `type Settings = z.infer<typeof settingsSchema>;`
- **parseSettings** (function) `(raw: unknown): Settings`

## packages/experiments/src/simulate.ts

- **simulate** (function) `(opts: SimulateOptions): SimulateResult[]`
