/**
 * The firm's profile (R11): who they are, how they write, which recruiter owns
 * which contacts. Set from a JSON file with `crm profile set`; the composer
 * and the handoff read it.
 */
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { type ClientProfile, clientProfile } from "./schema.js";

const email = z.string().trim().toLowerCase().email();

export const clientProfileSchema = z
  .object({
    firm: z.string().trim().min(1),
    sells: z.string().trim().min(1),
    feeAvg: z.number().int().min(0).nullable().default(null),
    voice: z.string().trim().min(1),
    recruiters: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            email,
            owners: z.array(z.string().trim().min(1)).default([]),
          })
          .strict(),
      )
      .default([]),
    defaultRecruiter: email.nullable().default(null),
    signature: z.string().trim().min(1),
  })
  .strict()
  .refine((p) => !p.defaultRecruiter || p.recruiters.some((r) => r.email === p.defaultRecruiter), {
    message: "defaultRecruiter must be one of the recruiters",
    path: ["defaultRecruiter"],
  })
  .refine((p) => new Set(p.recruiters.map((r) => r.email)).size === p.recruiters.length, {
    message: "a recruiter is listed twice",
    path: ["recruiters"],
  });

export type ClientProfileInput = z.input<typeof clientProfileSchema>;

/** Throws a readable error on a bad profile. */
export function parseClientProfile(input: unknown): z.output<typeof clientProfileSchema> {
  const out = clientProfileSchema.safeParse(input);
  if (out.success) return out.data;
  throw new Error(
    `client profile: ${out.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
  );
}

export async function readClientProfile(db: Queryable): Promise<ClientProfile | null> {
  const [row] = await db.select().from(clientProfile).limit(1);
  return row ?? null;
}

/** Replaces the profile whole. */
export async function setClientProfile(db: Queryable, input: unknown): Promise<ClientProfile> {
  const p = parseClientProfile(input);
  const [row] = await db
    .insert(clientProfile)
    .values({ one: true, ...p })
    .onConflictDoUpdate({ target: clientProfile.one, set: { ...p, updatedAt: new Date() } })
    .returning();
  return row as ClientProfile;
}
