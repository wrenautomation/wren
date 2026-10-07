/**
 * The booked call's parts and their settings (designs/2026-10-07-close-brief-outcome.md). `{}`
 * parses for both: the brief an hour ahead with questions and a ping, the usual not-yet reasons.
 */
import { z } from "zod";

export const CALL_BRIEF = "calls.brief";
export const CALL_OUTCOME = "calls.outcome";

export const briefSettingsSchema = z
  .object({
    leadMinutes: z
      .number()
      .int()
      .min(5)
      .max(1440)
      .default(60)
      .describe("Minutes before the call the brief is rebuilt and the team pinged"),
    questions: z
      .boolean()
      .default(true)
      .describe("Let the model add up to 3 questions, each checked by code"),
    ping: z.boolean().default(true).describe("Ping the team's channel when the brief is ready"),
  })
  .strict();
export type BriefSettings = z.infer<typeof briefSettingsSchema>;

export const NOT_YET_REASONS = [
  "Timing",
  "Budget",
  "Needs a partner's yes",
  "Wants proof",
] as const;

export const outcomeSettingsSchema = z
  .object({
    reasons: z
      .array(z.string().trim().min(1).max(60))
      .max(12)
      .default([...NOT_YET_REASONS])
      .describe("Reasons offered for a not yet; the rep can write their own"),
  })
  .strict();
export type OutcomeSettings = z.infer<typeof outcomeSettingsSchema>;

/** A block as saved, or Wren's defaults when it doesn't parse. */
export const briefSettingsOf = (block: unknown): BriefSettings => {
  const got = briefSettingsSchema.safeParse(block ?? {});
  return got.success ? got.data : briefSettingsSchema.parse({});
};
export const outcomeSettingsOf = (block: unknown): OutcomeSettings => {
  const got = outcomeSettingsSchema.safeParse(block ?? {});
  return got.success ? got.data : outcomeSettingsSchema.parse({});
};
