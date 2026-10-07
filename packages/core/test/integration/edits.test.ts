/**
 * Edits on a real Postgres (`../../src/edits.ts`): a patch is checked, compare-and-swapped on the
 * version it started from, and leaves a `changes` row; Undo puts the before back once; Claude's
 * patch shows as a diff and lands only through Accept. Synthetic copy throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { settingsFor, wrenSettings } from "../../src/clients/index.js";
import { defineComponent } from "../../src/components.js";
import { settingRecord } from "../../src/console.js";
import {
  ASK_COMMAND,
  askAnswerOf,
  askPrompt,
  askTurns,
  editRecord,
  editState,
  historyOf,
  undoChange,
  versionOf,
} from "../../src/edits.js";
import {
  DEFAULT_FACTS,
  FACTS_COMPONENTS,
  FACTS_ID,
  factsRecord,
  wrenFacts,
} from "../../src/facts.js";
import { PortalRefusal } from "../../src/portal.js";
import { defineRecord, number, prose, text, withEdits } from "../../src/records.js";
import { serveRecords } from "../../src/records-serve.js";
import { finishRun, openRun } from "../../src/runs.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create table edit_fixture (id text primary key, body text, n int)`);
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["changes", "runs", "edit_fixture", "wren_settings"]);
  await pg.db.execute(
    sql`insert into edit_fixture values ('a', 'Hi there, reply STOP to stop.', 1)`,
  );
});

const card = defineRecord({
  id: "test.card",
  app: "work",
  channel: null,
  name: { one: "card", many: "cards" },
  rows: async (db) => (await db.execute(sql`select * from edit_fixture`)) as never,
  key: "id",
  title: "body",
  fields: { body: prose("Words"), n: number("Count"), note: text() },
  views: [{ id: "all", label: "All" }],
  edits: {
    fields: ["body", "n"],
    patch: z
      .object({ body: z.string().max(160), n: z.number().int().min(0) })
      .partial()
      .strict(),
    check: (patch) =>
      patch.body !== undefined && !/STOP/.test(String(patch.body)) ? "it must say STOP" : null,
    read: async (db, id) => {
      const [r] = (await db.execute(
        sql`select body, n from edit_fixture where id = ${id}`,
      )) as unknown as {
        body: string;
        n: number;
      }[];
      return r ? { body: r.body, n: r.n } : null;
    },
    write: async (db, id, patch) => {
      if ("body" in patch)
        await db.execute(
          sql`update edit_fixture set body = ${patch.body as string} where id = ${id}`,
        );
      if ("n" in patch)
        await db.execute(sql`update edit_fixture set n = ${patch.n as number} where id = ${id}`);
    },
    context: async () => "A test card's playbook.",
  },
});
const by = "op@example.com";

const refused = async (p: Promise<unknown>, status: number) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
};

describe("edits", () => {
  it("lands a patch with its change row, and refuses one made over a stale version", async () => {
    const start = (await editState(pg.db, card, "a"))?.version as string;
    const out = await editRecord(pg.db, card, "a", {
      patch: { body: "Hey, text STOP to stop." },
      expect: start,
      by,
    });
    expect(out.change).not.toBeNull();
    expect(out.values.body).toBe("Hey, text STOP to stop.");
    expect(out.version).toBe(versionOf({ body: "Hey, text STOP to stop.", n: 1 }));
    const [line] = await historyOf(pg.db, card, "a");
    expect(line).toMatchObject({
      by,
      via: "person",
      before: { body: "Hi there, reply STOP to stop." },
      after: { body: "Hey, text STOP to stop." },
      undone: false,
    });
    // A second editor still holding the first version is refused, not written over.
    await refused(editRecord(pg.db, card, "a", { patch: { n: 2 }, expect: start, by }), 409);
  });

  it("refuses what the schema or the check won't take, and no-ops an unchanged patch", async () => {
    await refused(editRecord(pg.db, card, "a", { patch: { note: "x" }, by }), 400);
    await refused(editRecord(pg.db, card, "a", { patch: { n: -1 }, by }), 400);
    await refused(editRecord(pg.db, card, "a", { patch: { body: "No opt out here." }, by }), 400);
    await refused(editRecord(pg.db, card, "a", { patch: {}, by }), 400);
    await refused(editRecord(pg.db, card, "zz", { patch: { n: 3 }, by }), 404);
    const same = await editRecord(pg.db, card, "a", { patch: { n: 1 }, by });
    expect(same.change).toBeNull();
    expect(await historyOf(pg.db, card, "a")).toHaveLength(0);
  });

  it("undoes a change once, and not past a newer one", async () => {
    const first = await editRecord(pg.db, card, "a", { patch: { n: 5 }, by });
    const second = await editRecord(pg.db, card, "a", { patch: { n: 6 }, by });
    await refused(undoChange(pg.db, card, "a", first.change as number, by), 409);
    const back = await undoChange(pg.db, card, "a", second.change as number, by);
    expect(back.values.n).toBe(5);
    await refused(undoChange(pg.db, card, "a", second.change as number, by), 409);
    const lines = await historyOf(pg.db, card, "a");
    expect(lines.map((l) => [l.undoes !== null, l.undone])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  it("shows Claude's patch as a checked diff, and Accept lands it with the run", async () => {
    const prompt = await askPrompt(pg.db, card, "a", { body: "Hi" }, "Shorter please", by);
    expect(prompt.question).toContain("Shorter please");
    expect(prompt.question).toContain("A test card's playbook.");
    const run = await openRun(pg.db, {
      command: ASK_COMMAND,
      argv: { record: card.id, id: "a", by, message: "Shorter please", ...prompt },
    });
    const thinking = await askTurns(pg.db, card, "a", prompt.values);
    expect(thinking[0]?.state).toBe("thinking");

    const answer = askAnswerOf(
      'Sure.\n{"reply": "Cut it down.", "patch": {"body": "Reply STOP to stop."}}',
    );
    expect(answer).toEqual({ reply: "Cut it down.", patch: { body: "Reply STOP to stop." } });
    await finishRun(pg.db, run.id, answer);
    const [turn] = await askTurns(pg.db, card, "a", prompt.values);
    expect(turn?.proposal).toEqual({
      patch: { body: "Reply STOP to stop." },
      problem: null,
      diff: [
        { field: "body", before: "Hi there, reply STOP to stop.", after: "Reply STOP to stop." },
      ],
    });

    const done = await editRecord(pg.db, card, "a", {
      patch: turn?.proposal?.patch,
      by,
      via: "claude",
      run: run.id,
    });
    const [after] = await askTurns(pg.db, card, "a", done.values);
    expect(after?.accepted).toBe(done.change);
    expect(after?.proposal).toBeNull();
    expect((await historyOf(pg.db, card, "a"))[0]?.via).toBe("claude");
  });

  it("flags a patch the check refuses, and reads words without JSON as a reply", async () => {
    const run = await openRun(pg.db, {
      command: ASK_COMMAND,
      argv: { record: card.id, id: "a", by, message: "x" },
    });
    await finishRun(pg.db, run.id, { reply: "Here.", patch: { body: "No opt out." } });
    const [turn] = await askTurns(pg.db, card, "a", {
      body: "Hi there, reply STOP to stop.",
      n: 1,
    });
    expect(turn?.proposal?.problem).toBe("it must say STOP");
    expect(askAnswerOf("Just words.")).toEqual({ reply: "Just words.", patch: null });
  });

  it("refuses a declaration that edits a field it doesn't have", () => {
    const { edits, ...plain } = card;
    expect(() =>
      withEdits(plain, { ...(edits as NonNullable<typeof edits>), fields: ["nope"] }),
    ).toThrow(/doesn't have/);
  });

  it("edits one of Wren's settings and keeps the rest of its block, prices too", async () => {
    const books = defineComponent({
      id: "books",
      name: "Books",
      blurb: "Keeps the books.",
      icon: "mail",
      for: "wren",
      stage: "reach",
      ready: true,
      settings: z.object({
        perDay: z.number().int().default(5),
        mode: z.enum(["calm", "busy"]).default("calm"),
        price: z.number().optional(),
      }),
      priced: ["price"],
      effects: [],
      hypothesis: { from: "a test", guesses: [{ is: "fixed", says: "It keeps books." }] },
    });
    await pg.db
      .insert(wrenSettings)
      .values({ component: "books", settings: { perDay: 4, price: 2 } });
    const t = settingRecord([books]);
    const page = await serveRecords([t], pg.db).list({ record: t.id, view: "all" });
    expect(page.rows.map((r) => [r.id, r.value])).toEqual([
      ["books:mode", "calm"],
      ["books:perDay", "4"],
    ]);
    const out = await editRecord(pg.db, t, "books:perDay", { patch: { value: "7" }, by });
    expect(out.values).toEqual({ value: "7" });
    expect((await settingsFor(pg.db, null)).books).toEqual({ perDay: 7, price: 2 });
    await refused(editRecord(pg.db, t, "books:perDay", { patch: { value: "x" }, by }), 400);
    await refused(editRecord(pg.db, t, "books:mode", { patch: { value: "loud" }, by }), 400);
    // Blank puts the default back.
    await editRecord(pg.db, t, "books:perDay", { patch: { value: "" }, by });
    expect((await settingsFor(pg.db, null)).books).toEqual({ price: 2 });
    const [last] = await historyOf(pg.db, t, "books:perDay");
    await undoChange(pg.db, t, "books:perDay", last?.id as number, by);
    expect((await settingsFor(pg.db, null)).books).toEqual({ perDay: 7, price: 2 });
  });

  it("the facts list saves as one record: checked, with who, and Undo", async () => {
    // Its part has its own editor, so Settings leaves it out: one history, not two.
    expect(settingRecord(FACTS_COMPONENTS).id).toBe("console.setting");
    const rows = await serveRecords([settingRecord(FACTS_COMPONENTS)], pg.db).list({
      record: "console.setting",
      view: "all",
    });
    expect(rows.rows).toEqual([]);
    const first = await editState(pg.db, factsRecord, FACTS_ID);
    expect(first?.values).toEqual({ facts: DEFAULT_FACTS.join("\n") });
    const mine = ["I build automations for small firms.", "Our code is public."];
    const out = await editRecord(pg.db, factsRecord, FACTS_ID, {
      patch: { facts: ` ${mine[0]}\n\n${mine[1]} ` },
      expect: first?.version ?? null,
      by,
    });
    expect(await wrenFacts(pg.db)).toEqual(mine);
    const [row] = await pg.db.select().from(wrenSettings);
    expect(row?.updatedBy).toBe(by);
    // The version it opened is gone: a second editor's save is refused, not written over.
    await refused(
      editRecord(pg.db, factsRecord, FACTS_ID, {
        patch: { facts: "Something else." },
        expect: first?.version ?? null,
        by,
      }),
      409,
    );
    await refused(
      editRecord(pg.db, factsRecord, FACTS_ID, { patch: { facts: "x".repeat(301) }, by }),
      400,
    );
    await refused(
      editRecord(pg.db, factsRecord, FACTS_ID, { patch: { facts: "Same.\nsame." }, by }),
      400,
    );
    const [last] = await historyOf(pg.db, factsRecord, FACTS_ID);
    expect(last?.id).toBe(out.change);
    expect(last?.by).toBe(by);
    await undoChange(pg.db, factsRecord, FACTS_ID, last?.id as number, by);
    expect(await wrenFacts(pg.db)).toEqual([...DEFAULT_FACTS]);
    // Empty is allowed: drafts then claim nothing first-person.
    await editRecord(pg.db, factsRecord, FACTS_ID, { patch: { facts: "" }, by });
    expect(await wrenFacts(pg.db)).toEqual([]);
  });
});
