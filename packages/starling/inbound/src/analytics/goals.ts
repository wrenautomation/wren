/**
 * His posting plan as a setting (`marketing.cadence`): the goals Plan, the digest and Today
 * measure against. Unsaved, it's `CADENCE_GOALS`. Each goal's numbers and words are edited in
 * place on Plan (History, Undo); the whole list goes through `wren content goals`.
 */
import { settingsFor } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { CADENCE_GOALS, type CadenceGoal, FORMATS } from "./catalog.js";

export const GOALS_COMPONENT = "marketing.cadence";

const goalSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    platform: z.string().min(1).max(20),
    label: z.string().min(1).max(60),
    name: z.string().min(1).max(80),
    goal: z.number().int().min(0).max(500),
    upTo: z.number().int().min(0).max(500).optional(),
    daily: z.number().int().min(0).max(100).nullable(),
    pace: z.string().max(120),
    how: z.string().max(200),
    piece: z.string().regex(/^[a-z0-9-]{1,30}$/),
    starts: z.enum(["words", "video", "thread"]),
    counts: z.union([
      z.array(z.enum(FORMATS)),
      z.literal("any"),
      z.literal("thread_comment"),
      z.null(),
    ]),
  })
  .strict()
  .refine((g) => g.upTo === undefined || g.upTo >= g.goal, "up to is under the goal");

export const goalsSchema = z
  .object({ goals: z.array(goalSchema).max(60) })
  .strict()
  .refine(
    (s) => new Set(s.goals.map((g) => g.id)).size === s.goals.length,
    "two goals share an id",
  );

/**
 * The saved plan, or the default when none is saved or it no longer reads. A saved "can't post
 * yet" (counts null) is a fact about the code, not his choice: once Wren posts there, the
 * default's counts win.
 */
export async function cadenceGoals(db: Queryable): Promise<readonly CadenceGoal[]> {
  const got = goalsSchema.safeParse((await settingsFor(db, null))[GOALS_COMPONENT]);
  if (!got.success) return CADENCE_GOALS;
  return (got.data.goals as CadenceGoal[]).map((g) => {
    const counts = g.counts ?? CADENCE_GOALS.find((d) => d.id === g.id)?.counts ?? null;
    return counts === g.counts ? g : { ...g, counts };
  });
}
