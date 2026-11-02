/** Send-time and spend-time gates shared by resolution, compose and send. */
import { type Suppression, suppressions } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

/**
 * Main's suppressions, for work in a client's database: an opt-out anywhere is an opt-out
 * everywhere, so a client's reads also ask main and its stops also land there, marked `client`.
 * Wren's own work passes none.
 */
export interface SharedSuppressions {
  readonly main: Queryable;
  readonly client: string;
}

/**
 * The unrevoked suppression covering this address (exact address or its whole domain), or null;
 * with `shared`, main's when this database has none.
 */
export async function activeSuppression(
  db: Queryable,
  email: string,
  shared?: SharedSuppressions | null,
): Promise<Suppression | null> {
  return (
    (await localSuppression(db, email)) ??
    (shared ? await localSuppression(shared.main, email) : null)
  );
}

async function localSuppression(db: Queryable, email: string): Promise<Suppression | null> {
  const [address, domain] = addressAndDomain(email);
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

const addressAndDomain = (email: string): [string, string] => {
  const address = email.trim().toLowerCase();
  return [address, address.slice(address.lastIndexOf("@") + 1)];
};

/**
 * `activeSuppression` for many addresses in one query: a walk over every
 * active enrollment asks once, not once per row. Exact address wins over
 * its domain, as a single lookup would find either.
 */
export async function activeSuppressions(
  db: Queryable,
  emails: Iterable<string>,
  shared?: SharedSuppressions | null,
): Promise<(email: string) => Suppression | null> {
  if (!shared) return localSuppressions(db, emails);
  const list = [...emails];
  const [here, main] = [
    await localSuppressions(db, list),
    await localSuppressions(shared.main, list),
  ];
  return (email) => here(email) ?? main(email);
}

async function localSuppressions(
  db: Queryable,
  emails: Iterable<string>,
): Promise<(email: string) => Suppression | null> {
  const values = new Set<string>();
  for (const email of emails) for (const v of addressAndDomain(email)) values.add(v);
  const byKey = new Map<string, Suppression>();
  if (values.size > 0) {
    const rows = await db
      .select()
      .from(suppressions)
      .where(
        and(
          isNull(suppressions.revokedAt),
          inArray(suppressions.kind, ["email", "domain"]),
          inArray(suppressions.value, [...values]),
        ),
      );
    for (const row of rows) byKey.set(`${row.kind} ${row.value}`, row);
  }
  return (email) => {
    const [address, domain] = addressAndDomain(email);
    return byKey.get(`email ${address}`) ?? byKey.get(`domain ${domain}`) ?? null;
  };
}
