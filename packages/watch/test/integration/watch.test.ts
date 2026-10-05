/**
 * The Watch against the migrated schema: mail read once, triaged by rule or model along the
 * `watch` workflow, and moved by the Inbox app's hands. Mail and model are fakes; every address
 * here is made up.
 */
import type { Mailbox, MailMeta } from "@wren/core/mailbox";
import type { PortalRequest } from "@wren/core/portal";
import { pgSpineStore, type Walk, walk } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WATCH_COMPONENTS, WATCH_WORKFLOWS } from "../../src/components.js";
import { watchConsoleApi } from "../../src/console.js";
import {
  mail,
  mailEvent,
  readMail,
  rules,
  sortAgain,
  triage,
  triageStep,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await pg.db.execute(sql`TRUNCATE watch.mail, watch.rules, events RESTART IDENTITY CASCADE`);
});

const NOW = new Date("2026-10-05T12:00:00Z");
const msg = (id: string, from: string, subject: string, mins = 10): MailMeta => ({
  id,
  threadId: `t-${id}`,
  fromName: "",
  fromAddress: from,
  subject,
  snippet: `preview of ${id}`,
  at: new Date(NOW.getTime() - mins * 60_000),
});

function inbox(messages: MailMeta[], down = { now: false }) {
  const queries: string[] = [];
  const box: Mailbox = {
    address: "me@inbox.example",
    async search(q) {
      if (down.now) throw new Error("desk is off");
      queries.push(q);
      return messages.map((m) => m.id);
    },
    raw: () => Promise.reject(new Error("the Watch reads headers only")),
    async meta(id) {
      const m = messages.find((x) => x.id === id);
      if (!m) throw new Error(`no ${id}`);
      return m;
    },
  };
  return { box, queries };
}

const viewer = { viewer: { email: "owner@wren.example" } } as unknown as PortalRequest;
const rows = () => pg.db.select().from(mail).orderBy(mail.id);

describe("readMail", () => {
  it("keeps each new email once, skips promotions in the search, and survives a dead inbox", async () => {
    const { box, queries } = inbox([msg("a", "x@shop.example", "Receipt")]);
    const down = { now: true };
    const dead = { ...inbox([], down).box, address: "other@inbox.example" };
    expect(await readMail(pg.db, [box, dead], NOW)).toEqual({
      kept: [1],
      failed: [{ mailbox: "other@inbox.example", error: "Error: desk is off" }],
    });
    expect(await readMail(pg.db, [box], NOW)).toEqual({ kept: [], failed: [] });
    expect(queries[0]).toContain("-category:promotions -category:social");
    // The second search starts an hour before the newest kept.
    const after = Number(queries[1]?.match(/after:(\d+)/)?.[1]);
    expect(after).toBe(Math.floor((NOW.getTime() - 70 * 60_000) / 1000));
  });
});

describe("triage on the spine", () => {
  const steps = (llm: FakeLlm | null) => ({ "watch.triage": triageStep(pg.db, llm) });
  const walker = (llm: FakeLlm | null, by = "inv1"): Walk => ({
    flows: new Map(WATCH_WORKFLOWS.map((f) => [f.id, f])),
    parts: new Map(WATCH_COMPONENTS.map((c) => [c.id, c])),
    steps: steps(llm),
    store: pgSpineStore(pg.db),
    client: null,
    by,
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => false,
  });

  it("settles by rule for $0, asks the model the rest, and forgets every preview", async () => {
    await pg.db
      .insert(rules)
      .values([
        { words: "Hold receipts from the shop.", sender: "shop.example", verdict: "hold" },
        { words: "Inbox Insiders: hold invoices and receipts. Show order status changes." },
      ]);
    const prompts: string[] = [];
    const llm = new FakeLlm({
      respond: (p) => {
        prompts.push(p);
        return JSON.stringify({
          verdict: "show",
          why: "A person asks for a call.",
          summary: "Call on Friday?",
        });
      },
    });
    const { box } = inbox([
      msg("a", "x@shop.example", "Receipt"),
      msg("b", "pal@friend.example", "Friday"),
    ]);
    const { kept } = await readMail(pg.db, [box], NOW);

    const tally = await walk(walker(llm), "watch", "read.mail", kept.map(mailEvent));
    expect(tally).toMatchObject({ arrived: 2, out: 2, failed: 0 });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("- Inbox Insiders: hold invoices");
    expect(prompts[0]).toContain("Preview: preview of b");
    expect((await rows()).map((r) => [r.verdict, r.ruleId, r.summary, r.snippet])).toEqual([
      ["hold", 1, null, null],
      ["show", null, "Call on Friday?", null],
    ]);
    const outs = await pg.db.execute(
      sql`SELECT node, port FROM events WHERE node = 'out' ORDER BY port`,
    );
    expect([...outs]).toEqual([
      { node: "out", port: "held" },
      { node: "out", port: "needs_you" },
    ]);
    // Again, from another call: each email entered once.
    expect(
      await walk(walker(llm, "inv2"), "watch", "read.mail", kept.map(mailEvent)),
    ).toMatchObject({
      arrived: 0,
      seen: 2,
    });
  });

  it("shows what it can't settle: no model, or an answer that doesn't read", async () => {
    const { box } = inbox([msg("a", "a@x.example", "One"), msg("b", "b@x.example", "Two")]);
    const { kept } = await readMail(pg.db, [box], NOW);
    expect(await triage(pg.db, null, kept[0] as number)).toBe("show");
    expect(await triage(pg.db, new FakeLlm({ respond: () => "sure!" }), kept[1] as number)).toBe(
      "show",
    );
    expect((await rows()).map((r) => r.why)).toEqual([
      "No model is set, so it shows.",
      "The model's answer didn't read, so it shows.",
    ]);
    // A rule written later re-sorts what's waiting; done mail stays put.
    await pg.db.insert(rules).values({ words: "Hold x.", sender: "x.example", verdict: "hold" });
    await pg.db
      .update(mail)
      .set({ doneAt: NOW })
      .where(eq(mail.id, kept[1] as number));
    expect(await sortAgain(pg.db, null, kept)).toEqual({ hold: 1 });
    expect((await rows()).map((r) => r.verdict)).toEqual(["hold", "show"]);
  });
});

describe("the Inbox app's hands", () => {
  it("hide writes one rule and clears the sender's waiting mail; show and done move rows", async () => {
    const api = watchConsoleApi(pg.db);
    const { box } = inbox([
      msg("a", "deals@shop.example", "Sale", 30),
      msg("b", "deals@shop.example", "Sale again", 20),
      msg("c", "pal@friend.example", "Hi"),
    ]);
    const { kept } = await readMail(pg.db, [box], NOW);
    for (const id of kept) await triage(pg.db, null, id);

    await api.hide({ ...viewer, ids: ["1", "2"] });
    expect(await pg.db.select().from(rules)).toMatchObject([
      {
        words: "Hold mail from deals@shop.example.",
        sender: "deals@shop.example",
        verdict: "hold",
        by: "owner@wren.example",
      },
    ]);
    const view = async () =>
      (await pg.db.execute(
        sql`SELECT id, queue, held, others FROM watch.mail_records ORDER BY id`,
      )) as unknown as Array<{ id: number; queue: string; held: number; others: string | null }>;
    expect((await view()).map((r) => r.queue)).toEqual(["held", "held", "needs_you"]);
    expect((await view())[0]).toMatchObject({
      held: 1,
      others: "/inbox/mail?view=held&fromAddress=~deals@shop.example",
    });
    // A new email from them is held by the rule, in code.
    await pg.db.insert(mail).values({ ...newRow("d"), fromAddress: "deals@shop.example" });
    expect(await triage(pg.db, null, 4)).toBe("hold");

    await api.show({ ...viewer, ids: ["1"], subject: "Sale" });
    await api.done({ ...viewer, ids: ["3"] });
    expect((await view()).map((r) => r.queue)).toEqual(["needs_you", "held", "done", "held"]);
    await api.undone({ ...viewer, ids: ["3"] });
    expect((await view())[2]?.queue).toBe("needs_you");

    const { id } = await api.addRule({
      ...viewer,
      words: "Drop LinkedIn digests.",
      verdict: "DROP",
    });
    await expect(api.addRule({ ...viewer, words: "x", verdict: "maybe" })).rejects.toThrow(
      "it's one of show, hold, drop",
    );
    await api.removeRule({ ...viewer, ids: [id] });
    expect(await pg.db.select().from(rules).where(eq(rules.verdict, "drop"))).toEqual([]);
  });
});

const newRow = (id: string) => ({
  mailbox: "me@inbox.example",
  messageId: id,
  threadId: `t-${id}`,
  fromName: "",
  fromAddress: "",
  subject: "Another sale",
  at: NOW,
});
