/** An experiment's settings: one schema, every field defaulted, so `{}` is valid. */
import { z } from "zod";

import { FITNESS_NAMES, MUTATION_NAMES, SEEDING_NAMES, SELECTION_NAMES } from "./names.js";

export * from "./names.js";

const fitness = z.enum(FITNESS_NAMES);

export const settingsSchema = z
  .object({
    selection: z.enum(SELECTION_NAMES).default("thompson"),
    fitness: fitness.default("interested"),
    fitnessByLocus: z
      .record(z.string(), fitness)
      .default({})
      .describe('Per point, in place of the one above, like {"subject": "opens"}'),
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
        negativeRatio: z
          .number()
          .positive()
          .nullable()
          .default(2)
          .describe("Retire an option whose negative rate is this many times its point's"),
      })
      .strict()
      .prefault({}),
    floor: z.number().min(0).max(0.5).default(0.05).describe("The least share a live option gets"),
    prior: z
      .number()
      .positive()
      .default(50)
      .describe("A new option starts at its point's mean, weighted as this many sends"),
    minSends: z
      .number()
      .int()
      .min(1)
      .default(300)
      .describe("Sends before an option may retire or settle its point"),
    window: z
      .number()
      .int()
      .min(2)
      .default(14)
      .describe("Ticks with the same best before a point counts as stuck"),
    strategistEvery: z
      .number()
      .int()
      .min(1)
      .default(7)
      .describe("Ticks between the model's writing rounds"),
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
    queueSize: z
      .number()
      .int()
      .min(1)
      .default(3)
      .describe("Candidates waiting per point before the model stops writing"),
    maxAlleles: z
      .number()
      .int()
      .min(2)
      .default(12)
      .describe("Options ever tried at one point before it takes no more"),
    autoApprove: z.boolean().default(false).describe("Model copy goes live without your approval"),
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
