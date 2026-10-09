/**
 * The Monitor made per client (designs/2026-10-07-mail-access.md): each client's connected
 * mailboxes read into its own `watch.mail` as the `mail` reader, then triaged along its `mail`
 * workflow by its own rules and name. One client's dead mailbox stops no other. Fakes only.
 */
import type { Mailbox, MailMeta } from "@wren/core/mailbox";
import { pgSpineStore, type Walk, walk } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAIL_FLOW, MAIL_FROM, readClients } from "../../src/clients.js";
import { MAIL_COMPONENTS, WATCH_WORKFLOWS } from "../../src/components.js";
import { clientTriageStep, mail, mailEvent, rules } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`TRUNCATE watch.mail, watch.rules, events RESTART IDENTITY CASCADE`);
}, 240_000);
afterAll(() => pg.stop());

const NOW = new Date("2026-10-07T12:00:00Z");
const msg = (id: string, from: string, subject: string): MailMeta => ({
  id,
  threadId: `t-${id}`,
  fromName: "",
  fromAddress: from,
  subject,
  snippet: `preview of ${id}`,
  at: new Date(NOW.getTime() - 10 * 60_000),
  link: `https://outlook.office365.com/owa/?ItemID=${id}`,
});
const box = (address: string, ms: MailMeta[], dead = false): Mailbox => ({
  address,
  search: async () => {
    if (dead) throw new Error("401: token gone");
    return ms.map((m) => m.id);
  },
  raw: () => Promise.reject(new Error("headers only")),
  meta: async (id) => ms.find((m) => m.id === id) as MailMeta,
});

describe("readClients", () => {
  it("reads each client's mailboxes as the mail reader; a dead one stops nothing", async () => {
    let swept = 0;
    const out = await readClients(
      {
        db: pg.db,
        // One database stands in for both clients' here.
        clientDb: () => pg.db,
        clients: async () => ["acme", "beta"],
        boxesOf: async (c) =>
          c === "acme"
            ? [box("ann@acme.example", [msg("a1", "lee@patient.example", "Quote?")])]
            : [box("bo@beta.example", [], true)],
        sweep: async () => {
          swept++;
        },
      },
      NOW,
    );
    expect(swept).toBe(1);
    expect(out.kept).toEqual({ acme: [1] });
    expect(out.failed).toEqual([
      { client: "beta", mailbox: "bo@beta.example", error: "Error: 401: token gone" },
    ]);
    const [row] = await pg.db.select().from(mail);
    expect(row).toMatchObject({
      reader: "mail",
      mailbox: "ann@acme.example",
      link: "https://outlook.office365.com/owa/?ItemID=a1",
    });
    const [open] = await pg.db.execute(sql`select open from watch.mail_records where id = 1`);
    expect(open?.open).toBe("https://outlook.office365.com/owa/?ItemID=a1");
  });
});

describe("the client's mail workflow", () => {
  const walker = (llm: FakeLlm | null): Walk => ({
    flows: new Map(WATCH_WORKFLOWS.map((f) => [f.id, f])),
    parts: new Map(MAIL_COMPONENTS.map((c) => [c.id, c])),
    steps: {
      "mail.triage": clientTriageStep(async () => ({
        db: pg.db,
        name: "Acme Dental",
        modelFor: async () => llm,
      })),
    },
    store: pgSpineStore(pg.db),
    client: "acme",
    by: "inv-mail",
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => false,
  });

  it("triages by the client's rules, then its model, in its name", async () => {
    await pg.db
      .insert(rules)
      .values([{ words: "Hold newsletters.", sender: "news.example", verdict: "hold" }]);
    const extra = await readClients(
      {
        db: pg.db,
        clientDb: () => pg.db,
        clients: async () => ["acme"],
        boxesOf: async () => [
          box("ann@acme.example", [
            msg("a1", "lee@patient.example", "Quote?"),
            msg("a2", "x@news.example", "October news"),
          ]),
        ],
      },
      NOW,
    );
    const prompts: { p: string; system: string }[] = [];
    const llm = new FakeLlm({
      respond: (p, system) => {
        prompts.push({ p, system: String(system ?? "") });
        return JSON.stringify({
          verdict: "show",
          why: "A patient asks.",
          summary: "Wants a quote",
        });
      },
    });
    const ids = [1, ...(extra.kept.acme ?? [])];
    const tally = await walk(walker(llm), MAIL_FLOW, MAIL_FROM, ids.map(mailEvent));
    expect(tally).toMatchObject({ failed: 0 });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.system).toContain("Acme Dental");
    const rows = await pg.db.select().from(mail).orderBy(mail.id);
    expect(rows.map((r) => [r.subject, r.verdict, r.snippet])).toEqual([
      ["Quote?", "show", null],
      ["October news", "hold", null],
    ]);
  });
});
