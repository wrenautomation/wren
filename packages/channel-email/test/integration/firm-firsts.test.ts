/**
 * The firsts on `companies` (0226) stay exactly what the old aggregating view computed: first
 * document, first person, first verified named lead, through inserts, bulk inserts, updates
 * and deletes. Synthetic rows only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
const rows = async <T>(q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as T[];

/** What the trigger-kept columns say against what an aggregate says now. */
async function drift(): Promise<unknown[]> {
  return rows(sql`
    select c.id from companies c
    where (c.crawled_at, c.named_at, c.lead_at) is distinct from (
      (select min(fetched_at) from documents d where d.company_id = c.id),
      (select min(created_at) from people p where p.company_id = c.id),
      (select min(created_at) from leads l where l.company_id = c.id and l.status = 'verified'
        and l.first_name is not null))`);
}

describe("company firsts", () => {
  it("track every change to documents, people and leads", async () => {
    const [firm] = await rows<{ id: number }>(sql`
      insert into companies (domain, name, niche) values ('firsts.example', 'Firsts', 'test')
      returning id`);
    const id = firm?.id;
    const stageOf = async () =>
      (await rows<{ stage: string }>(sql`select stage from email_firm_records where id = ${id}`))[0]
        ?.stage;
    expect(await stageOf()).toBe("domain");

    // A bulk insert: the earlier time wins, whatever the order.
    await pg.db.execute(sql`
      insert into documents (company_id, url, kind, content_hash, text, fetched_at) values
        (${id}, 'https://firsts.example/b', 'webpage', 'b', 'x', ${at(5)}),
        (${id}, 'https://firsts.example/a', 'webpage', 'a', 'x', ${at(3)})`);
    expect(await stageOf()).toBe("crawled");

    const [person] = await rows<{ id: number }>(sql`
      insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw, created_at)
      values (${id}, 'Pat Example', false, 'website', 'test', '{}', ${at(6)}) returning id`);
    expect(await stageOf()).toBe("named");

    const [imp] = await rows<{ id: number }>(sql`
      insert into imports (source_type, source_ref, stats) values ('test', 'test', '{}') returning id`);
    await pg.db.execute(sql`
      insert into leads (company_id, person_id, email, status, raw, import_id, created_at)
      values (${id}, ${person?.id}, 'pat@firsts.example', 'imported', '{}', ${imp?.id}, ${at(7)})`);
    expect(await stageOf()).toBe("named");

    // Verified and named by an update: a lead now; suppressed: back to named.
    await pg.db.execute(sql`update leads set status = 'verified', first_name = 'Pat'`);
    expect(await stageOf()).toBe("lead");
    await pg.db.execute(sql`update leads set status = 'suppressed'`);
    expect(await stageOf()).toBe("named");

    // The first document gone: the next one is first.
    await pg.db.execute(sql`delete from documents where content_hash = 'a'`);
    const [after] = await rows<{ crawled: string }>(
      sql`select crawled::text from email_firm_records where id = ${id}`,
    );
    expect(new Date(after?.crawled ?? "").toISOString()).toBe(at(5));

    expect(await drift()).toEqual([]);
  });
});
