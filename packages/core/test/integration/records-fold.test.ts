/**
 * A folded type against a real Postgres (designs/2026-10-15-engage-threads.md): one person's
 * messages in one thread list as one row, counts and views read the folded rows, and a folded-away
 * message's id opens its group.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { date, defineRecord, status, text } from "../../src/records.js";
import { serveRecords } from "../../src/records-serve.js";

const STATE = status({
  waiting: { label: "Waiting", tone: "warn" },
  answered: { label: "Answered", tone: "good" },
});

const reply = defineRecord({
  id: "test.reply",
  app: "work",
  channel: null,
  name: { one: "reply", many: "replies" },
  rows: async () => [
    {
      id: "r1",
      post: "p1",
      who: "replier_a",
      body: "First reply",
      state: "answered",
      at: "2026-10-01T02:00:00Z",
    },
    {
      id: "r2",
      post: "p1",
      who: "Replier_A",
      body: "And a question?",
      state: "waiting",
      at: "2026-10-01T03:00:00Z",
    },
    {
      id: "r3",
      post: "p1",
      who: "replier_b",
      body: "Same question",
      state: "waiting",
      at: "2026-10-01T04:00:00Z",
    },
    {
      id: "r4",
      post: "p2",
      who: "replier_a",
      body: "Elsewhere",
      state: "answered",
      at: "2026-10-01T01:00:00Z",
    },
  ],
  key: "id",
  title: "who",
  subtitle: "body",
  fold: {
    by: (r) => `${r.post}|${String(r.who).toLowerCase()}`,
    at: "at",
    open: (r) => r.state === "waiting",
    text: "body",
    state: "state",
    into: "messages",
  },
  fields: {
    who: text(),
    post: text(),
    body: text(),
    state: STATE,
    at: date(),
    messages: text("Their messages", { listed: false }),
  },
  views: [
    { id: "waiting", label: "Waiting", where: { state: "waiting" }, at: "at" },
    { id: "all", label: "All", at: "at" },
  ],
});

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

describe("a folded type", () => {
  it("lists one row per person per thread, with their messages newest first", async () => {
    const page = await serveRecords([reply], pg.db).list({ record: reply.id, view: "all" });
    expect(page.rows.map((r) => r.id).sort()).toEqual(["r2", "r3", "r4"]);
    const a = page.rows.find((r) => r.id === "r2");
    const msgs = (typeof a?.messages === "string" ? JSON.parse(a.messages) : a?.messages) as {
      id: string;
    }[];
    expect(msgs.map((m) => m.id)).toEqual(["r2", "r1"]);
    expect(page.counts).toEqual({ waiting: 2, all: 3 });
  });

  it("opens the group from any of its messages' ids", async () => {
    const api = serveRecords([reply], pg.db);
    expect((await api.get({ record: reply.id, id: "r1" })).row.id).toBe("r2");
    expect((await api.get({ record: reply.id, id: "r2" })).row.id).toBe("r2");
    expect((await api.get({ record: reply.id, id: "r4" })).row.id).toBe("r4");
    await expect(api.get({ record: reply.id, id: "r9" })).rejects.toThrow(/no such reply/);
  });
});
