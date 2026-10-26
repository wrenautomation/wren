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
  decideOne,
  decidePass,
  decideStats,
  decisionRecords,
  LEAD_KIND,
  leadFitDue,
  leadFitSource,
  leadFitState,
  leadFitView,
  leadSubject,
  picksOf,
  setDecideMode,
} from "../../src/decide/index.js";
import { recordDraft } from "../../src/draft-record.js";
import { peopleConsoleApi } from "../../src/people-console.js";
import { resolveProfile } from "../../src/profiles.js";

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
  it("shows picks on lists only in recommend or gate", async () => {
    const subjects = ["thread:t3_a", "thread:t3_r", "thread:none"];
    // Shadow (set above): nothing shows.
    expect((await picksOf(db, "comment_quality", subjects)).size).toBe(0);
    await setDecideMode(db, "comment_quality", "recommend", "test");
    const shown = await picksOf(db, "comment_quality", subjects);
    // t3_r's only decision was refused: no label, no pick.
    expect([...shown.keys()]).toEqual(["thread:t3_a"]);
    expect(shown.get("thread:t3_a")?.label).toBe("drop");
    expect((await picksOf(db, "comment_quality", [])).size).toBe(0);
  });
});

/** Answers `want` among the lead labels, 0.9 for it. */
function fakeLead(want: () => string): DecideBackend & { calls: number } {
  const b = {
    name: "jev",
    price: { input: 0.042, output: 0 },
    calls: 0,
    async ask() {
      b.calls++;
      const w = want();
      const probabilities = { fit: 0.05, unsure: 0.05, not: 0.05, [w]: 0.9 };
      return {
        model: "jev-test",
        answers: { pick: { type: "choice", choice: w, confidence: 0.8, probabilities } },
        usage: { input_tokens: 1000, output_tokens: 3 },
      };
    },
  };
  return b;
}

const OFFERS = [{ name: "Reactivation", audience: "service firms with a list of old customers" }];
const T = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
const rows = async (q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Record<string, unknown>[];

/** A profile that owns one X handle, with `touches` of it (all synthetic). */
async function person(
  handle: string,
  touches: { day: number; dir: "theirs" | "ours"; text: string }[],
) {
  const [h] = await rows(sql`insert into social_handles (platform, handle, name)
    values ('x', ${handle}, 'Avery Quill') returning id`);
  for (const [i, t] of touches.entries())
    await db.execute(sql`insert into touches (handle_id, kind, direction, at, source, ref, text)
      values (${h?.id as number}, 'comment', ${t.dir}, ${T(t.day).toISOString()}, 'test',
        ${`${handle}:${i}`}, ${t.text})`);
  const got = await resolveProfile(
    db,
    [
      { kind: `handle:x`, value: handle },
      { kind: "email", value: `${handle}@example.test` },
    ],
    "test",
    { name: "Avery Quill" },
  );
  return got?.id as number;
}

describe("the lead check", () => {
  it("shows Jev words only: no name, handle, address, phone or link", async () => {
    const id = await person("quill_avery", [
      {
        day: 2,
        dir: "theirs",
        text: "Hi, Avery Quill here. Mail quill_avery@example.test or +1 555 010 0199, see https://example.test/me",
      },
      { day: 3, dir: "ours", text: "Thanks @quill_avery, good to meet you" },
    ]);
    const state = await leadFitState(db, id, OFFERS);
    const text = JSON.stringify(state);
    for (const secret of ["Avery", "Quill", "quill_avery", "example.test", "555", "https"])
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(state).toMatchObject({
      touches: {
        counts: [
          { kind: "comment", direction: "ours", n: 1 },
          { kind: "comment", direction: "theirs", n: 1 },
        ],
        recent: [
          {
            direction: "ours",
            platform: "x",
            on: "2026-10-03",
            text: "Thanks [handle], good to meet you",
          },
          { direction: "theirs", platform: "x", on: "2026-10-02" },
        ],
      },
      found: [],
      offers: [{ name: "Reactivation", forWhom: OFFERS[0]?.audience }],
    });
  });

  it("reads kept and found research, never a dropped one, as employer text and platforms", async () => {
    const id = await person("quill_two", [{ day: 2, dir: "theirs", text: "hello" }]);
    const f = (kind: string, platform: string | null, value: string, state: string, c: number) =>
      db.execute(sql`insert into profile_findings (profile_id, kind, platform, value, url, source, confidence, state, ref)
        values (${id}, ${kind}, ${platform}, ${value}, ${`https://example.test/${value}`}, 'search', ${c}, ${state},
          ${`${kind}:${platform}:${value}`})`);
    await f("employer", null, "Owner at Synthetic Plumbing", "kept", 0.9);
    await f("handle", "linkedin", "someone-else", "found", 0.6);
    await f("handle", "github", "dropped-one", "dropped", 0.9);
    const state = (await leadFitState(db, id, OFFERS)) as { found: Record<string, unknown>[] };
    expect(state.found).toEqual([
      {
        kind: "employer",
        platform: null,
        employer: "Owner at Synthetic Plumbing",
        confidence: 0.9,
      },
      { kind: "handle", platform: "linkedin", confidence: 0.6 },
    ]);
    expect(JSON.stringify(state)).not.toContain("someone-else");
  });

  it("finds a profile with a new touch of theirs, not one decided after it", async () => {
    const fresh = await person("src_fresh", [{ day: 2, dir: "theirs", text: "hi" }]);
    const done = await person("src_done", [{ day: 2, dir: "theirs", text: "hi" }]);
    const quiet = await person("src_quiet", [{ day: 2, dir: "ours", text: "hi" }]);
    const jev = fakeLead(() => "fit");
    const row = await decide(db, {
      kind: LEAD_KIND,
      subject: leadSubject(done),
      state: await leadFitState(db, done, OFFERS),
      mode: "recommend",
      chain: [jev],
    });
    // Decided on day 5, after its day 2 touch.
    await db.execute(
      sql`update decisions set at = ${T(5).toISOString()} where id = ${row?.id as number}`,
    );
    const ours = (due: { id: number }[]) =>
      due.map((d) => d.id).filter((i) => [fresh, done, quiet].includes(i));
    expect(ours(await leadFitDue(db, 50))).toEqual([fresh]);

    const source = leadFitSource(OFFERS);
    const subjects = (await source.due(db, new Date(), 50)).map((x) => x.subject);
    expect(subjects).toContain(leadSubject(fresh));
    expect(subjects).not.toContain(leadSubject(done));
    expect(subjects).not.toContain(leadSubject(quiet));

    // A new touch of theirs on day 6 makes it due again; a merged profile never is.
    await db.execute(sql`insert into touches (handle_id, kind, direction, at, source, ref, text)
      select id, 'comment', 'theirs', ${T(6).toISOString()}, 'test', 'src_done:late', 'again'
      from social_handles where handle = 'src_done'`);
    expect(ours(await leadFitDue(db, 50))).toEqual([fresh, done]);
    await db.execute(sql`update profiles set merged_into = ${fresh} where id = ${done}`);
    expect(ours(await leadFitDue(db, 50))).toEqual([fresh]);
    expect(await source.one?.(db, leadSubject(done))).toBeNull();
    expect(await source.one?.(db, "thread:t3_a")).toBeNull();
  });

  it("asks one profile on demand under the same cap, and says why when it cannot", async () => {
    const id = await person("one_ask", [{ day: 2, dir: "theirs", text: "hi" }]);
    // The pass test above spent past the cap on purpose: start the day clean.
    await db.execute(sql`update decisions set cost_usd = 0`);
    const subject = leadSubject(id);
    const jev = fakeLead(() => "unsure");
    const sources = [leadFitSource(OFFERS)];
    expect(
      await decideOne(db, {
        sources,
        backends: { chain: [], note: "WREN_DECIDE=off" },
        kind: LEAD_KIND,
        subject,
      }),
    ).toEqual({ asked: false, label: null, why: "WREN_DECIDE=off" });
    expect(
      await decideOne(db, {
        sources,
        backends: { chain: [jev], note: null },
        kind: LEAD_KIND,
        subject,
      }),
    ).toEqual({ asked: true, label: "unsure", why: null });
    // The same state is bought once.
    await decideOne(db, {
      sources,
      backends: { chain: [jev], note: null },
      kind: LEAD_KIND,
      subject,
    });
    expect(jev.calls).toBe(1);
    expect(
      await decideOne(db, {
        sources,
        backends: { chain: [jev], note: null },
        kind: "document",
        subject,
      }),
    ).toMatchObject({ asked: false, why: expect.stringContaining("cannot be asked") });
    expect(
      await decideOne(db, {
        sources,
        backends: { chain: [jev], note: null },
        kind: LEAD_KIND,
        subject: "profile:999999",
      }),
    ).toMatchObject({ asked: false, why: "nothing to ask about" });
    await db.execute(sql`update decisions set cost_usd = 99 where subject = ${subject}`);
    expect(
      await decideOne(db, {
        sources,
        backends: { chain: [jev], note: null },
        kind: LEAD_KIND,
        subject,
      }),
    ).toMatchObject({ asked: false, why: expect.stringContaining("daily cap") });
  });

  it("his call is kept with an override against a pick, and a lead trait", async () => {
    const id = await person("call_one", [{ day: 2, dir: "theirs", text: "hi" }]);
    const subject = leadSubject(id);
    const jev = fakeLead(() => "not");
    const pick = await decide(db, {
      kind: LEAD_KIND,
      subject,
      state: await leadFitState(db, id, OFFERS),
      mode: "recommend",
      chain: [jev],
    });
    const before = await leadFitView(db, id);
    expect(before.pick).toMatchObject({ label: "not", name: "Not a lead", percent: 90 });
    expect(before.call).toBeNull();

    const api = peopleConsoleApi({ db, open: () => db });
    const viewer = { email: "owner@example.test", operator: true } as never;
    await expect(api.leadCall({ viewer, ids: [id], label: "maybe" })).rejects.toThrow("fit or not");
    await expect(api.leadCall({ viewer, ids: [999999], label: "fit" })).rejects.toThrow(
      "no such person",
    );
    await expect(
      api.leadCall({ viewer: { demo: true } as never, ids: [id], label: "fit" }),
    ).rejects.toThrow("read-only");
    expect(await api.leadCall({ viewer, ids: [id], label: "fit" })).toEqual({
      done: [id],
      label: "fit",
    });

    const [call] = await callsOf(subject);
    expect(call).toMatchObject({
      label: "fit",
      keep: true,
      source: "profile",
      decision_id: pick?.id,
      agreed: false,
      override: true,
    });
    const [by] = await rows(sql`select by from decision_calls where subject = ${subject}`);
    expect(by?.by).toBe("owner@example.test");
    const [trait] = await rows(
      sql`select value #>> '{}' v from profile_traits where profile_id = ${id} and key = 'lead'`,
    );
    expect(trait?.v).toBe("lead");
    const after = await leadFitView(db, id);
    expect(after.call).toMatchObject({ label: "fit", name: "Lead", overrode: true });

    // He changes his mind: a second click is a second call, the trait follows, and it agrees now.
    await api.leadCall({ viewer, ids: [id], label: "not" });
    expect((await callsOf(subject)).map((c) => c.label)).toEqual(["fit", "not"]);
    const [t2] = await rows(
      sql`select value #>> '{}' v from profile_traits where profile_id = ${id} and key = 'lead'`,
    );
    expect(t2?.v).toBe("not_lead");
    expect((await leadFitView(db, id)).call).toMatchObject({ label: "not", overrode: false });
  });

  it("a call with no pick shown is not an override, and a client's People has no check", async () => {
    const id = await person("call_two", [{ day: 2, dir: "theirs", text: "hi" }]);
    const api = peopleConsoleApi({ db, open: () => db });
    const viewer = { email: "owner@example.test", operator: true } as never;
    await api.leadCall({ viewer, ids: [id], label: "not" });
    expect((await callsOf(leadSubject(id)))[0]).toMatchObject({
      decision_id: null,
      agreed: null,
      override: false,
    });
    expect(await api.leadCheck({ viewer, ids: [id] })).toEqual({
      done: [id],
      subjects: [leadSubject(id)],
    });
    await expect(api.leadCheck({ viewer, ids: [] })).rejects.toThrow("nothing picked");
  });
});
