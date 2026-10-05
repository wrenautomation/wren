/**
 * Fact assembly for rendering.
 *
 * The person_facts row contributes bare keys (first_name, title, company_name, ...); the
 * niche's facts-view row is namespaced as company.<column> so view columns can never shadow
 * person facts. `half` is the company's side of a 50/50 test (`halfOf`). `factsFor` is the
 * merge, in exactly one place; compose and preview both call it, so what you preview IS what
 * composes.
 */
import { createHash } from "node:crypto";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  readableCompany,
  readableCount,
  readableMoney,
  readablePersonName,
  readableTitle,
  shortCompany,
} from "./readable.js";

export type FactRow = Record<string, unknown>;

/**
 * A render-ready facts row. `refused` rides beside `values`: every fact `readable` declined
 * to state, with the value that was filed, so a draft can pin WHY a sentence dropped.
 */
export interface Facts {
  readonly values: Readonly<FactRow>;
  readonly refused: Readonly<FactRow>;
  /** What was stored for every key `readable` rewrote: the input a model fill reads. */
  readonly filed?: Readonly<FactRow>;
}

type Rule = (value: unknown) => string | null;

// Stored form -> sentence-ready form, applied to every facts row on the way out.
const READABLE: readonly (readonly [key: string, rule: Rule])[] = [
  ["first_name", readablePersonName],
  ["last_name", readablePersonName],
  ["full_name", readablePersonName],
  ["title", readableTitle],
  ["company_name", readableCompany],
  ["company.name", readableCompany],
  // Counts refuse zero: (( )) drops a sentence whose facts are missing, and a filed 0 is not.
  ["company.employees", readableCount],
  ["company.ind_clients", readableCount],
  ["company.hnw_clients", readableCount],
  ["company.pooled_clients", readableCount],
];

// Derived keys: `aum_usd` stays a bigint; `aum` is the only form fit to sit in a sentence.
const DERIVED: readonly (readonly [key: string, source: string, rule: Rule])[] = [
  ["company.aum", "company.aum_usd", readableMoney],
  // What a person calls the firm mid-sentence: "Grove", not "Grove Technical Resources".
  ["company_short", "company_name", shortCompany],
];

/** A value the source actually supplied — null and blank are absence, not a refusal. */
const filed = (value: unknown) =>
  value !== null && value !== undefined && String(value).trim() !== "";

/** The facts a person will actually read, rewritten into a new row, never the one handed in. */
export function sentenceReady(facts: Readonly<FactRow>): Facts {
  const out: FactRow = { ...facts };
  const refused: FactRow = {};
  const stored: FactRow = {};
  for (const [key, rule] of READABLE) {
    if (key in out) {
      const value = out[key];
      stored[key] = value;
      out[key] = rule(value);
      if (filed(value) && out[key] === null) refused[key] = value;
    }
  }
  for (const [key, source, rule] of DERIVED) {
    if (source in out) {
      const value = out[source];
      out[key] = rule(value);
      if (filed(value) && out[key] === null) refused[key] = value;
    }
  }
  return { values: out, refused, filed: stored };
}

/**
 * Which half of a 50/50 test a company is in, "a" or "b". Fixed by its id, so every run
 * and every preview puts it in the same half; hashed, so the halves don't follow import order.
 * A plan splits on it with `where: { half: "a" }`.
 */
export function halfOf(companyId: unknown): "a" | "b" {
  const first = createHash("sha256").update(String(companyId)).digest()[0] as number;
  return first % 2 === 0 ? "a" : "b";
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function personFacts(db: Queryable, personId: number): Promise<FactRow> {
  const rows = (await db.execute(
    sql`SELECT * FROM person_facts WHERE person_id = ${personId}`,
  )) as FactRow[];
  const row = rows[0];
  if (row === undefined) throw new Error(`no person_facts row for person ${personId}`);
  return { ...row };
}

/** A company absent from its view contributes nothing — templates decide what that means. */
export async function companyFacts(
  db: Queryable,
  factsView: string | null,
  companyId: number,
): Promise<FactRow> {
  if (factsView === null) return {};
  if (!IDENTIFIER.test(factsView)) {
    throw new Error(`facts view name '${factsView}' is not a bare identifier`);
  }
  const rows = (await db.execute(
    sql`SELECT * FROM ${sql.identifier(factsView)} WHERE company_id = ${companyId}`,
  )) as FactRow[];
  const row = rows[0];
  if (row === undefined) return {};
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [`company.${k}`, v]));
}

/**
 * The full render-ready facts row for one person: person_facts merged with their company's
 * facts view. A testimonial author is refused outright — the invariant's enforcement point.
 */
export async function factsFor(
  db: Queryable,
  personId: number,
  factsView: string | null,
): Promise<Facts> {
  const facts = await personFacts(db, personId);
  if (facts.is_testimonial) {
    throw new Error(`person ${personId} is a testimonial author, not staff`);
  }
  const company = await companyFacts(db, factsView, Number(facts.company_id));
  return sentenceReady({ ...facts, ...company, half: halfOf(facts.company_id) });
}

/**
 * The render-ready facts row for a role-inbox enrollment: the company's own row merged
 * with its facts view. No person keys at all, so `{first_name}` refuses and
 * `{first_name|there}` renders its fallback.
 */
export async function factsForCompany(
  db: Queryable,
  companyId: number,
  factsView: string | null,
): Promise<Facts> {
  const rows = (await db.execute(
    sql`SELECT id AS company_id, name AS company_name, domain AS company_domain,
        niche AS company_niche FROM companies WHERE id = ${companyId}`,
  )) as FactRow[];
  const row = rows[0];
  if (row === undefined) throw new Error(`no company ${companyId}`);
  const company = await companyFacts(db, factsView, companyId);
  return sentenceReady({ ...row, ...company, half: halfOf(companyId) });
}
