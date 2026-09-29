/**
 * Reactivation's block in `clients.products` (R21): what this product does for
 * one client. The registry stores it opaque; this parses it, and the defaults
 * fill what a client never set. Everything off until `on`, sending off until
 * `stages.send`, so adding a client never emails anyone.
 */
import { z } from "zod";

const email = z.string().trim().toLowerCase().email();

/** "2026-02-30" matches the pattern but is no day. */
const isCalendarDay = (d: string) => {
  const at = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(d);
};

export const reactivationSettingsSchema = z
  .object({
    /** The loop works this client at all. */
    on: z.boolean().default(false),
    stages: z
      .object({
        /** Score and briefs. Lookup and signals stay `crm run`: they use a personal account. */
        research: z.boolean().default(true),
        compose: z.boolean().default(true),
        send: z.boolean().default(false),
        handoff: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    compose: z
      .object({ perDay: z.number().int().min(0).max(500).default(20) })
      .strict()
      .prefault({}),
    /** Overrides on Wren's send policy; null keeps Wren's. */
    sending: z
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
      .prefault({}),
    /** `first`: the client approves the first batch, then it flows. `every`: each batch. */
    approval: z.enum(["first", "every"]).default("first"),
    /** The client's mailboxes Wren sends from, each as one recruiter. */
    senders: z
      .array(
        z
          .object({
            address: email,
            /** The From name: the recruiter's. */
            name: z.string().trim().min(1),
            /** Whose contacts this mailbox writes to; null writes for anyone. */
            recruiter: email.nullable().default(null),
            suspended: z.boolean().default(false),
          })
          .strict(),
      )
      .default([])
      .refine(
        (s) => new Set(s.map((x) => x.address)).size === s.length,
        "a sender is listed twice",
      ),
    /** R18: what the client pays. Shown to the operator; never in an email. */
    offer: z
      .object({
        upfront: z.number().int().min(0).default(1000),
        perMeeting: z.number().int().min(0).default(500),
        cap: z.number().int().min(0).default(15000),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type ReactivationSettings = z.infer<typeof reactivationSettingsSchema>;
export type Sender = ReactivationSettings["senders"][number];

/** The key in `clients.products`. */
export const PRODUCT = "reactivation";

/** A client's block, defaults filled. Throws a readable error on a bad block. */
export function parseReactivationSettings(block: unknown): ReactivationSettings {
  const out = reactivationSettingsSchema.safeParse(block ?? {});
  if (out.success) return out.data;
  throw new Error(
    `reactivation settings: ${out.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")}`,
  );
}

/** From a client's `products`: its reactivation settings. */
export const reactivationSettingsOf = (products: Record<string, unknown>): ReactivationSettings =>
  parseReactivationSettings(products[PRODUCT]);
