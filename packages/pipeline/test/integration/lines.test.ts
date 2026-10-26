/**
 * A content line on the executor, on a real Postgres (designs/2026-10-25-ingestion-engine.md): the
 * line pass reads Learn rows and tells the executor; the real steps open and move one document
 * instance per document. Launch films: find → read → extract → call. A study line: its read pages
 * enter at extract, its claims step ends extract, his call on every claim ends call. Synthetic
 * data only.
 */
import { randomUUID } from "node:crypto";
import { recordCall } from "@wren/core/decide";
import {
  type Fired,
  heardAs,
  hearersOf,
  pgExecutorStore,
  type Walk,
  walk,
} from "@wren/core/executor";
import { events } from "@wren/core/schema";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shapeWorkflowsOf } from "../../src/journeys.js";
import { linePass } from "../../src/lines.js";
import { instances } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { saveShape } from "../../src/store.js";
import { TRIGGERS, withStudy } from "../fixtures.js";

const NOW = new Date("2026-10-25T12:00:00Z");
let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await saveShape(pg.db, {
    body: withStudy(),
    note: "films and a study",
    by: "t",
    triggers: new Set([...TRIGGERS, "trigger.found", "trigger.station"]),
  });
});
afterAll(() => pg.stop());

const one = async <T>(q: Promise<unknown>) => ((await q) as unknown as T[])[0] as T;

/** A Learn item on its own document, tagged `tag`. */
async function film(n: number, tag: string | null, client = "wren") {
  const d = await one<{ id: number }>(
    pg.db.execute(sql`insert into documents (url, kind, content_hash, text, title)
      values (${`https://films.example/${n}`}, 'webpage', ${String(n).padStart(64, "0")}, '',
        ${`Film ${n}`}) returning id`),
  );
  const i = await one<{ id: number }>(
    pg.db.execute(sql`insert into learn.items (client, url, title, document_id)
      values (${client}, ${`https://films.example/${n}`}, ${`Film ${n}`}, ${d.id}) returning id`),
  );
  if (tag)
    await pg.db.execute(sql`insert into learn.item_tags (item_id, tag) values (${i.id}, ${tag})`);
  return { document: d.id, item: i.id };
}

const read = (item: number) =>
  pg.db.execute(sql`update learn.items set read_at = now() where id = ${item}`);
const fact = (document: number) =>
  pg.db.execute(sql`insert into findings (kind, fact_key, value, confidence, via, document_id, question)
    values ('fact', ${`doc:${document}/hook`}, '"a hook"'::jsonb, 1, 'test', ${document}, 'hook')`);
const call = (document: number, source: "console" | "star" = "console") =>
  recordCall(pg.db, {
    kind: "document",
    subject: `doc:${document}`,
    label: "keep",
    source,
  });

/** What `LineFeed` does: one pass, then each fire walked as `Executor/fire` would. */
async function feed() {
  const flows: Workflow[] = await shapeWorkflowsOf(pg.db, "wren");
  const pass = await linePass(pg.db, NOW);
  const fired: Fired[] = [];
  const w: Walk = {
    flows: new Map(flows.map((f) => [f.id, f])),
    parts: new Map(),
    steps: journeySteps({ db: () => pg.db }),
    store: pgExecutorStore(pg.db),
    client: null,
    by: "test",
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: (req) => fired.push(req),
  };
  for (const f of pass.fires)
    for (const h of hearersOf(flows, f.facts))
      await walk({ ...w, by: randomUUID() }, h.workflow, h.from, [heardAs(h, f.event)]);
  return pass;
}

const instanceOf = (document: number) =>
  pg.db
    .select()
    .from(instances)
    .where(and(eq(instances.subjectKind, "document"), eq(instances.documentId, document)));

describe("a content line", () => {
  let a: { document: number; item: number };
  let off: { document: number; item: number };
  let theirs: { document: number; item: number };

  it("opens one instance at read for a tagged Wren film, and none for others", async () => {
    a = await film(1, "launch-films");
    off = await film(2, "other-tag");
    theirs = await film(3, "launch-films", "client_a");
    const pass = await feed();
    expect(pass).toMatchObject({ found: 1, done: 0, closed: 0, more: false });
    const [j] = await instanceOf(a.document);
    expect(j).toMatchObject({ node: "read", status: "open", subjectKind: "document" });
    expect(j?.entryRef).toMatchObject({ sop: "launch-films", subject: `doc:${a.document}` });
    expect(await instanceOf(off.document)).toEqual([]);
    expect(await instanceOf(theirs.document)).toEqual([]);
  });

  it("tells a found document once: a second pass opens nothing", async () => {
    const pass = await feed();
    expect(pass).toMatchObject({ found: 0, done: 0 });
    expect(await instanceOf(a.document)).toHaveLength(1);
  });

  it("moves on only when the job at its station ends", async () => {
    await fact(a.document); // the extract job's row, before read ends: no skip ahead
    expect(await feed()).toMatchObject({ done: 0 });
    await read(a.item);
    expect(await feed()).toMatchObject({ done: 1 });
    expect((await instanceOf(a.document))[0]?.node).toBe("extract");
    expect(await feed()).toMatchObject({ done: 1 });
    expect((await instanceOf(a.document))[0]?.node).toBe("call");
  });

  it("stays open at the last station until his call, then closes with no event", async () => {
    expect(await feed()).toMatchObject({ done: 0, closed: 0 });
    expect((await instanceOf(a.document))[0]).toMatchObject({ node: "call", status: "open" });
    await call(a.document, "star"); // a mark is no call
    expect(await feed()).toMatchObject({ done: 0, closed: 0 });
    await call(a.document);
    const before = await pg.db.select().from(events);
    expect(await feed()).toMatchObject({ done: 0, closed: 1 });
    expect((await instanceOf(a.document))[0]).toMatchObject({ node: "call", status: "done" });
    expect(await pg.db.select().from(events)).toHaveLength(before.length);
  });

  it("never takes a document twice: a closed one is not found again", async () => {
    expect(await feed()).toMatchObject({ found: 0, closed: 0 });
    expect(await instanceOf(a.document)).toHaveLength(1);
  });
});

describe("a study line", () => {
  let studyId: number;
  let page: number;
  const key = (document: number, n: number) => `doc:${document}/study:placements/${n}`;

  /** A page the study read, as `runStudy` leaves it. */
  async function readPage(n: number, outcome: "ok" | "refused" = "ok") {
    const d = await one<{ id: number }>(
      pg.db.execute(sql`insert into documents (url, kind, content_hash, text, title)
        values (${`https://pages.example/${n}`}, 'webpage', ${String(n).padStart(64, "1")}, 'x',
          ${`Page ${n}`}) returning id`),
    );
    await pg.db.execute(sql`insert into study_steps (study_id, step, key, outcome, detail, document_id)
      values (${studyId}, 'read', ${`https://pages.example/${n}`}, ${outcome}, '{}'::jsonb,
        ${outcome === "ok" ? d.id : null})`);
    return d.id;
  }
  const claimed = (document: number, url: string) =>
    pg.db.execute(sql`insert into study_steps (study_id, step, key, outcome, detail, document_id)
      values (${studyId}, 'claims', ${url}, 'ok', '{}'::jsonb, ${document})`);
  const claim = (document: number, n: number) =>
    pg.db.execute(sql`insert into findings (kind, fact_key, value, confidence, via, document_id, question)
      values ('fact', ${key(document, n)}, '{"claim":"c","angle":0}'::jsonb, 1, 'study', ${document}, 'angle/0')`);
  const callClaim = (document: number, n: number) =>
    recordCall(pg.db, { kind: "finding", subject: key(document, n), label: "keep", source: "cli" });

  it("opens at extract for a page the study read, and not for a page it could not", async () => {
    studyId = (
      await one<{ id: number }>(
        pg.db.execute(sql`insert into studies (slug, question, angles, drafts)
          values ('placements', 'Why?', '["a"]'::jsonb, '[]'::jsonb) returning id`),
      )
    ).id;
    page = await readPage(1);
    await readPage(2, "refused");
    const pass = await feed();
    expect(pass).toMatchObject({ found: 1, done: 0 });
    const [j] = await instanceOf(page);
    expect(j).toMatchObject({ node: "sextract", status: "open" });
    expect(j?.entryRef).toMatchObject({ study: "placements" });
    expect(await feed()).toMatchObject({ found: 0 });
  });

  it("extract ends with the claims step; call ends when every claim has his call", async () => {
    await claim(page, 1);
    await claim(page, 2);
    expect(await feed()).toMatchObject({ done: 0 }); // findings alone are not the step
    await claimed(page, "https://pages.example/1");
    expect(await feed()).toMatchObject({ done: 1 });
    expect((await instanceOf(page))[0]?.node).toBe("scall");
    await callClaim(page, 1);
    expect(await feed()).toMatchObject({ closed: 0 });
    await callClaim(page, 2);
    expect(await feed()).toMatchObject({ closed: 1 });
    expect((await instanceOf(page))[0]?.status).toBe("done");
  });

  it("a page with no claims closes on his call on the page", async () => {
    const bare = await readPage(3);
    await feed();
    await claimed(bare, "https://pages.example/3");
    expect(await feed()).toMatchObject({ done: 1 });
    expect(await feed()).toMatchObject({ closed: 1 });
  });
});
