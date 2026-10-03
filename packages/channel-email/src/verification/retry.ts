/**
 * How long a `risky` verdict waits before the same server is asked again, by the
 * prober's reason. Greylisting lifts in minutes. A block on our IP lasts until our
 * reputation changes, and each retry before then feeds it; so does a refusal for our
 * missing reverse DNS, until the PTR exists. A server that requires TLS will still
 * require it, and broken DNS is slow to mend.
 * Any other reason (unreachable, catch_all_unknown, another verifier's rows) takes the
 * caller's default.
 */
import { type SQL, sql } from "drizzle-orm";
import { verifications } from "../schema.js";

export const RISKY_WAIT_BY_REASON: Readonly<Record<string, string>> = {
  greylisted: "1 hour",
  blocked: "7 days",
  dns_error: "7 days",
  no_ptr: "7 days",
  tls_required: "7 days",
};

/** The wait for one verdict, as a Postgres interval: `raw` is its `raw` column. */
export function riskyWait(raw: SQL, fallback: SQL): SQL {
  const arms = Object.entries(RISKY_WAIT_BY_REASON).map(
    ([reason, wait]) => sql`WHEN ${reason} THEN ${wait}::interval`,
  );
  return sql`(CASE (${raw})->>'reason' ${sql.join(arms, sql` `)} ELSE ${fallback} END)`;
}

/** Reasons that mean the server itself is turning us away, not just this address. */
export const SERVER_HOLD_REASONS: ReadonlySet<string> = new Set(Object.keys(RISKY_WAIT_BY_REASON));

/**
 * Domains whose server turned us away (a `SERVER_HOLD_REASONS` verdict) within that
 * reason's wait, from leads and candidates alike: a server that blocked one address
 * must not be asked about another.
 */
export function waitingDomains(): SQL {
  const reasons = sql.join(
    [...SERVER_HOLD_REASONS].map((r) => sql`${r}`),
    sql`, `,
  );
  const wait = riskyWait(sql`${verifications.raw}`, sql`interval '0'`);
  return sql`(select split_part(${verifications.email}, '@', 2) from ${verifications}
    where ${verifications.result} = 'risky' and ${verifications.email} is not null
      and ${verifications.raw}->>'reason' in (${reasons})
      and ${verifications.checkedAt} > now() - ${wait})`;
}
