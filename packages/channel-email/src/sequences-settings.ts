/**
 * A client's `email.sequences` and `email.replies` blocks (designs/2026-10-04-outbound-per-client.md,
 * O2/O3). `{}` is valid and sends nothing: no niche composes nothing, no senders send nothing.
 * Caps left null keep Wren's.
 */
import { z } from "zod";

export const SEQUENCES = "email.sequences";
export const REPLIES = "email.replies";

const email = z.string().trim().toLowerCase().email();

/** "2026-02-30" matches the pattern but is no day. */
const isCalendarDay = (d: string) => {
  const at = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(d);
};

/** Overrides on Wren's send policy; null keeps Wren's. Shared with reactivation's block. */
export const sendingOverridesSchema = z
  .object({
    perInboxPerDay: z.number().int().min(1).max(100).nullable().default(null),
    openersPerDay: z.number().int().min(0).max(1000).nullable().default(null),
    /** YYYY-MM-DD: day one of this client's ramp. */
    rampStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isCalendarDay, "not a calendar day")
      .nullable()
      .default(null),
  })
  .strict()
  .prefault({});

export const sequencesSettingsSchema = z
  .object({
    /** Which of Wren's niches' plan and copy compose uses; null composes nothing. */
    niche: z.string().trim().min(1).nullable().default(null),
    /** The client's mailboxes; each login is in `clients.accounts.gmail`. */
    senders: z
      .array(
        z
          .object({
            address: email,
            /** The From name. */
            name: z.string().trim().min(1),
            /** Plain sign-off under every body; null signs nothing. */
            signature: z.string().trim().min(1).nullable().default(null),
            /** Read and measured, never sending. */
            suspended: z.boolean().default(false),
          })
          .strict(),
      )
      .default([])
      .refine(
        (s) => new Set(s.map((x) => x.address)).size === s.length,
        "a sender is listed twice",
      ),
    /** Openers may go to a role inbox (info@); null keeps the niche's rule. */
    mailsRoleInboxes: z.boolean().nullable().default(null),
    sending: sendingOverridesSchema,
  })
  .strict();

export type SequencesSettings = z.infer<typeof sequencesSettingsSchema>;

/** Replies takes no settings yet: answers wait on Wren's approve. */
export const repliesSettingsSchema = z.object({}).strict();
