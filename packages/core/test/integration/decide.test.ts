/** Decide: the machine's answers logged, his calls beside them off the draft record, the numbers. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  backfillCommentCalls,
  type DecideBackend,
  type DecideSource,
  DecideStop,
  decide,
  decidePass,
  decideStats,
  decisionRecords,
  setDecideMode,
} from "../../src/decide/index.js";
import { recordDraft } from "../../src/draft-record.js";

let pg: TestPostgres;
let db: TestPostgres["db"];
beforeAll(async () => {
  pg = await startTestPostgres();
  db = pg.db;
});
afterAll(() => pg.stop());

/** Answers the label the state asks for, at 1M input tokens a call. */
function fake(name = "jev", fail?: { status: number } | Error): DecideBackend & { calls: number } {
  const b = {
    name,
    price: { input: 0.042, output: 0 },
    calls: 0,
    async ask(req: { state: unknown }) {
      b.calls++;
      if (fail) throw fail instanceof Error ? fail : Object.assign(new Error("no"), fail);
      const want = (req.state as { want: string }).want;
      const others = ["send", "edit", "drop"].filter((l) => l !== want);
      return {
        model: `${name}-test`,
        answers: {
          pick: {
            type: "choice",
            choice: want,
            confidence: 0.8,
            probabilities: { [want]: 0.9, [others[0] ?? ""]: 0.05, [others[1] ?? ""]: 0.05 },
          },
        },
        usage: { input_tokens: 1_000_000, output_tokens: 3 },
      };
    },
  };
  return b;
}

const ask = (subject: string, want: string, chain: DecideBackend[], mode = "recommend" as const) =>
  decide(db, {
    kind: "comment_quality",
    subject,
    state: { want, draft: "synthetic" },
    mode,
    chain,
  });

const gen = (item: string, text = "a drafted comment") =>
  recordDraft(db, { item, kind: "thread", event: "generated", via: "model", text });

const callsOf = async (subject: string) =>
  (await db.execute(
    sql`select label, keep, source, decision_id, agreed, override from decision_calls where subject = ${subject} order by id`,
  )) as unknown as Record<string, unknown>[];

describe("decide", () => {
  it("logs the answer with its cost, and buys the same question once", async () => {
    const jev = fake();
    const a = await ask("thread:t3_a", "drop", [jev]);
    expect(a).toMatchObject({
      label: "drop",
      backend: "jev",
      inputTokens: 1_000_000,
      mode: "recommend",
    });
    expect(a?.p).toBeCloseTo(0.1);
    expect(a?.costUsd).toBeCloseTo(0.042);
    const again = await ask("thread:t3_a", "drop", [jev]);
    expect(again?.id).toBe(a?.id);
    expect(jev.calls).toBe(1);
  });

  it("keeps a refused input as an error row, stops on a refused key, falls back on an outage", async () => {
    const refused = await ask("thread:t3_r", "send", [fake("jev", { status: 422 })]);
    expect(refused).toMatchObject({ label: null, model: "-" });
    expect(refused?.error).toContain("no");
    await expect(
      ask("thread:t3_k", "send", [fake("jev", { status: 401 }), fake("gateway")]),
    ).rejects.toBeInstanceOf(DecideStop);
    const fell = await ask("thread:t3_f", "send", [
      fake("jev", new Error("timeout")),
      fake("gateway"),
    ]);
    expect(fell).toMatchObject({ backend: "gateway", label: "send" });
    await expect(ask("thread:t3_d", "send", [fake("jev", new Error("down"))])).rejects.toThrow(
      "down",
    );
  });

  it("is off when the mode is", async () => {
    expect(await ask("thread:t3_o", "send", [fake()], "off" as never)).toBeNull();
  });
});

describe("his calls off the draft record", () => {
  it("a person's drop agrees with a drop", async () => {
    await gen("thread:t3_a");
    await recordDraft(db, {
      item: "thread:t3_a",
      event: "rejected",
      via: "person",
      by: "owner@example.com",
    });
    const [c] = await callsOf("thread:t3_a");
    expect(c).toMatchObject({
      label: "drop",
      keep: false,
      source: "rejected",
      agreed: true,
      override: false,
    });
    expect(c?.decision_id).not.toBeNull();
  });

  it("a send after his edit is edit; a send of the model's words against a shown drop is an override", async () => {
    await ask("thread:t3_b", "send", [fake()]);
    await gen("thread:t3_b");
    await recordDraft(db, {
      item: "thread:t3_b",
      event: "edited",
      via: "person",
      text: "his words",
    });
    await recordDraft(db, { item: "thread:t3_b", event: "sent", via: "person", text: "his words" });
    expect((await callsOf("thread:t3_b"))[0]).toMatchObject({
      label: "edit",
      keep: true,
      agreed: true,
    });

    await ask("thread:t3_c", "drop", [fake()]);
    await gen("thread:t3_c", "  as drafted ");
    await recordDraft(db, {
      item: "thread:t3_c",
      event: "sent",
      via: "person",
      text: "as drafted",
    });
    expect((await callsOf("thread:t3_c"))[0]).toMatchObject({
      label: "send",
      agreed: false,
      override: true,
    });
    // A replayed send is the same call; a scheduler's send isn't his.
    await recordDraft(db, {
      item: "thread:t3_c",
      event: "sent",
      via: "person",
      text: "as drafted",
    });
    expect(await callsOf("thread:t3_c")).toHaveLength(1);
    await gen("thread:t3_w");
    await recordDraft(db, {
      item: "thread:t3_w",
      event: "sent",
      via: "wren",
      text: "a drafted comment",
    });
    expect(await callsOf("thread:t3_w")).toHaveLength(0);
  });

  it("a call before any decision links none; the backfill adds nothing twice", async () => {
    await gen("thread:t3_n");
    await recordDraft(db, {
      item: "thread:t3_n",
      event: "sent",
      via: "claude",
      text: "a drafted comment",
    });
    expect((await callsOf("thread:t3_n"))[0]).toMatchObject({
      label: "send",
      decision_id: null,
      agreed: null,
    });
    await gen("thread:t3_h");
    await recordDraft(db, {
      item: "thread:t3_h",
      event: "rejected",
      via: "person",
      ref: "bf:thread:t3_h:rejected",
    });
    expect(await callsOf("thread:t3_h")).toHaveLength(0);
    const b = await backfillCommentCalls(db);
    expect(b.items).toBeGreaterThanOrEqual(5);
    expect(await callsOf("thread:t3_h")).toMatchObject([
      { label: "drop", source: "backfill:rejected" },
    ]);
    expect(await callsOf("thread:t3_n")).toHaveLength(1);
  });
});

describe("the pass and the numbers", () => {
  it("asks each due subject once, under the daily cap", async () => {
    const due: DecideSource = {
      kind: "comment_quality",
      due: async (_db, _now, limit) =>
        ["thread:t3_p1", "thread:t3_p2", "thread:t3_p3"]
          .slice(0, limit)
          .map((subject) => ({ subject, state: { want: "send", draft: subject } })),
    };
    const jev = fake();
    const s = await decidePass(db, {
      sources: [due],
      backends: { chain: [jev], note: null },
      max: 2,
    });
    expect(s).toMatchObject({ asked: 2, answered: 2, stopped: null });
    // Spent today is past the default $1 cap after 24 calls at $0.042: hold.
    await db.execute(sql`update decisions set cost_usd = 5 where subject = 'thread:t3_p1'`);
    const held = await decidePass(db, { sources: [due], backends: { chain: [jev], note: null } });
    expect(held.stopped).toContain("daily cap");
    expect(held.asked).toBe(0);
    const off = await decidePass(db, {
      sources: [due],
      backends: { chain: [], note: "WREN_DECIDE=off" },
    });
    expect(off.stopped).toBe("WREN_DECIDE=off");
  });

  it("counts agreement per kind, refuses a gate not built, exports the pairs", async () => {
    const [c] = await decideStats(db);
    expect(c).toMatchObject({ kind: "comment_quality", mode: "recommend", gateReady: false });
    // t3_a drop/drop, t3_b edit/send, t3_c send/drop; t3_n, t3_h have no decision.
    expect(c?.judged).toBe(3);
    expect(c?.agreed).toBe(2);
    expect(c?.overrides).toBe(1);
    expect(c?.usd).toBeGreaterThan(0);
    await expect(setDecideMode(db, "comment_quality", "gate", "test")).rejects.toThrow(
      "no gate filter",
    );
    await setDecideMode(db, "comment_quality", "shadow", "test");
    expect((await decideStats(db))[0]?.mode).toBe("shadow");
    const rows = await decisionRecords(db, { called: true });
    expect(rows.map((r) => r.subject).sort()).toEqual([
      "thread:t3_a",
      "thread:t3_b",
      "thread:t3_c",
    ]);
    expect(rows.find((r) => r.subject === "thread:t3_c")?.call).toMatchObject({
      label: "send",
      keep: true,
    });
  });
});
