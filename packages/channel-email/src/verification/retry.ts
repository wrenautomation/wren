/**
 * How long a `risky` verdict waits before the same server is asked again, by the
 * prober's reason. Greylisting lifts in minutes. A block on our IP lasts until our
 * reputation changes, and each retry before then feeds it; so does a refusal for our
 * missing reverse DNS, until the PTR exists. A server that requires TLS will still
 * require it, and broken DNS is slow to mend.
 * Any other reason (unreachable, catch_all_unknown, another verifier's rows) takes the
 * caller's default.
 *
 * The wait grows with the address's run of risky verdicts (`riskyBackoff`): some
 * servers greylist a probe forever, and every refused probe costs the prober IPs
 * standing. An answer the prober held back ("held: <fleet> lists our IP") asked no
 * server, so it waits like a block but never counts toward the run.
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

/** A greylisted address waits these after its 1st, 2nd and 3rd risky verdict in a row. */
export const GREYLIST_WAITS = ["1 hour", "1 day", "7 days"] as const;
/** Any other reason: its first wait, doubled after each further risky verdict, up to this. */
export const RISKY_WAIT_MAX = "30 days";
/** Risky verdicts in a row (no valid or invalid between) after which the address rests. */
export const RISKY_STREAK_CAP = 4;
/** How long an address rests at the cap. Also how far back a run of risky verdicts counts. */
export const RISKY_REST = "90 days";

/** The wait for one verdict, as a Postgres interval: `raw` is its `raw` column. */
export function riskyWait(raw: SQL, fallback: SQL): SQL {
  const arms = Object.entries(RISKY_WAIT_BY_REASON).map(
    ([reason, wait]) => sql`WHEN ${reason} THEN ${wait}::interval`,
  );
  return sql`(CASE (${raw})->>'reason' ${sql.join(arms, sql` `)} ELSE ${fallback} END)`;
}

/**
 * The wait after one risky verdict (its `email`, `checkedAt`, `raw`), as a Postgres
 * interval, from the address's run of risky verdicts up to and including it: rows by
 * email, leads and candidates alike, after the newest valid or invalid one and within
 * `RISKY_REST` of it. Each count is one range scan on ix_verifications_email_checked_at_id.
 */
export function riskyBackoff(row: { email: SQL; checkedAt: SQL; raw: SQL }, fallback: SQL): SQL {
  const { email, checkedAt: at, raw } = row;
  const since = sql`${at} - ${RISKY_REST}::interval`;
  const lastVerdict = sql`(SELECT max(rb_v.checked_at) FROM ${verifications} rb_v
    WHERE rb_v.email = ${email} AND rb_v.result IN ('valid', 'invalid')
      AND rb_v.checked_at > ${since} AND rb_v.checked_at <= ${at})`;
  const run = sql`(SELECT greatest(count(*), 1) AS n FROM ${verifications} rb_r
    WHERE rb_r.email = ${email} AND rb_r.result = 'risky'
      AND rb_r.checked_at > ${since} AND rb_r.checked_at <= ${at}
      AND rb_r.checked_at > coalesce(${lastVerdict}, '-infinity')
      AND coalesce(rb_r.raw->'transcript'->-1->>'reply', '') NOT LIKE 'held:%')`;
  const greylist = sql.join(
    GREYLIST_WAITS.map((w) => sql.raw(`'${w}'`)),
    sql`, `,
  );
  return sql`(SELECT CASE
      WHEN rb_k.n >= ${RISKY_STREAK_CAP} THEN ${RISKY_REST}::interval
      WHEN (${raw})->>'reason' = 'greylisted'
        THEN (ARRAY[${greylist}]::interval[])[least(rb_k.n, ${GREYLIST_WAITS.length})]
      ELSE least(${riskyWait(raw, fallback)} * power(2, rb_k.n - 1), ${RISKY_WAIT_MAX}::interval)
    END FROM ${run} rb_k)`;
}

/**
 * True for a risky verdict (verifications alias `v`) still inside its backoff. The
 * RISKY_REST bound first keeps the counts off old rows.
 */
export function riskyHolds(v: string, fallback: SQL): SQL {
  const col = (c: string) => sql.raw(`${v}.${c}`);
  return sql`(${col("result")} = 'risky' AND ${col("checked_at")} > now() - ${RISKY_REST}::interval
    AND ${col("checked_at")} > now() - ${riskyBackoff({ email: col("email"), checkedAt: col("checked_at"), raw: col("raw") }, fallback)})`;
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
