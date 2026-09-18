/** Send-time and spend-time gates shared by resolution, compose and send. */
import { type Suppression, suppressions } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, eq, isNull, or } from "drizzle-orm";

/** The unrevoked suppression covering this address (exact address or its whole domain), or null. */
export async function activeSuppression(db: Queryable, email: string): Promise<Suppression | null> {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  const [row] = await db
    .select()
    .from(suppressions)
    .where(
      and(
        isNull(suppressions.revokedAt),
        or(
          and(eq(suppressions.kind, "email"), eq(suppressions.value, address)),
          and(eq(suppressions.kind, "domain"), eq(suppressions.value, domain)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}
