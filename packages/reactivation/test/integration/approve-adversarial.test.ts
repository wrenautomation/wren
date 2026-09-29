/**
 * Approve and skip in the orders a client can click them: skip then approve,
 * approve then skip, a pair half sent, and another product's enrollment in the
 * same database. A skipped email must never become sendable again.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveDrafts, skipDrafts } from "../../src/approve.js";

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

/** One enrollment and its two steps, in the states given. */
let used = 0;
/** One lead per company: a company holds one active enrollment at a time. */
async function pair(opener: string, followup: string, niche = "reactivation"): Promise<number> {
  used += 1;
  const to = `lead${used}@lead${used}.example`;
  const [c] = await pg.db.execute<{ id: number }>(sql`
    insert into companies (domain, name, niche, raw)
    values (${`lead${used}.example`}, ${`Lead ${used}`}, 'agencies', '{}'::jsonb) returning id`);
  const [p] = await pg.db.execute<{ id: number }>(sql`
    insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw)
      values (${c?.id}, ${`Lead ${used}`}, false, 'website', ${`lead${used}`}, '{}'::jsonb) returning id`);
  const [e] = await pg.db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${p?.id}, ${c?.id}, ${niche}, ${niche}, '{}'::jsonb, ${niche},
      'active', 'person', ${to}, 'sam@acme-talent.example')
    returning id`);
  const id = e?.id ?? 0;
  await pg.db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values
      (${id}, 0, 'opener', 'v1', ${to}, 's', 'b', '{}'::jsonb, ${opener}),
      (${id}, 1, 'followup', 'v1', ${to}, null, 'b', '{}'::jsonb, ${followup})`);
  return id;
}
const states = async (id: number) =>
  (
    await pg.db.execute<{ state: string }>(
      sql`select state from messages where enrollment_id = ${id} order by step`,
    )
  ).map((r) => r.state);
const enrollmentState = async (id: number) =>
  (await pg.db.execute<{ state: string }>(sql`select state from enrollments where id = ${id}`))[0]
    ?.state;

describe("approve and skip", () => {
  it("a skipped pair stays skipped when approved after", async () => {
    const id = await pair("draft", "draft");
    expect((await skipDrafts(pg.db, { enrollmentIds: [id] }, "client")).done).toEqual([id]);
    expect(await approveDrafts(pg.db, { enrollmentIds: [id] }, "operator")).toEqual({
      done: [],
      skipped: [id],
    });
    expect(await states(id)).toEqual(["rejected", "rejected"]);
    expect(await enrollmentState(id)).toBe("stopped");
  });

  it("a skip after an approve strikes the approved steps too", async () => {
    const id = await pair("draft", "draft");
    await approveDrafts(pg.db, { enrollmentIds: [id] }, "client");
    expect(await states(id)).toEqual(["approved", "approved"]);
    // Nothing is waiting any more, so a skip by id finds nothing to stop.
    expect(await skipDrafts(pg.db, { enrollmentIds: [id] }, "client")).toEqual({
      done: [],
      skipped: [id],
    });
    expect(await states(id)).toEqual(["approved", "approved"]);
  });

  it("a pair whose opener went out: skip stops the follow-up and leaves the sent one", async () => {
    const id = await pair("draft", "draft");
    await pg.db.execute(sql`
      update messages set state = 'sent', message_id = ${`<${id}@lead.example>`}, sent_at = now()
      where enrollment_id = ${id} and step = 0`);
    expect((await skipDrafts(pg.db, { enrollmentIds: [id] }, "client")).done).toEqual([id]);
    expect(await states(id)).toEqual(["sent", "rejected"]);
  });

  it("approve all never touches another product's drafts in the same database", async () => {
    const other = await pair("draft", "draft", "agencies");
    const ours = await pair("draft", "draft");
    const out = await approveDrafts(pg.db, { all: true }, "operator");
    expect(out.done).toContain(ours);
    expect(out.done).not.toContain(other);
    expect(await states(other)).toEqual(["draft", "draft"]);
    expect((await skipDrafts(pg.db, { enrollmentIds: [other] }, "client")).done).toEqual([]);
  });

  it("repeated and unsafe ids are one id or none", async () => {
    const id = await pair("draft", "draft");
    const out = await approveDrafts(
      pg.db,
      { enrollmentIds: [id, id, Number.NaN, 2 ** 60, -1] },
      "client",
    );
    expect(out).toEqual({ done: [id], skipped: [-1] });
  });
});
