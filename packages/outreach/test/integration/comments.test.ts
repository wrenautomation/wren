/**
 * Comments on Postgres with fake channels: kept once, ours closed, sorted (words, then the model),
 * answered under the comment as the account that read it, refused when our other account is in
 * the thread or the rung's cap is spent, one DM per person, and a manual DM leaves while the live
 * gate is off.
 */
import { type CommentIn, fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import {
  answerComment,
  commentById,
  dmCommenter,
  keepComments,
  sortComment,
} from "../../src/comments.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { commentRecord } from "../../src/records.js";
import { ReachRefusal } from "../../src/refusal.js";
import { comments, type ReachAccount, reachMessages } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";
import { tick } from "../../src/tick.js";

const TABLES = ["comments", "reach_messages", "reach_contacts", "reach_accounts"];
// Thursday 14:00 New York.
const NOW = new Date("2026-10-01T18:00:00Z");
const DAY = 86_400_000;

let pg: TestPostgres;
const db = () => pg.db;
type Fake = ReturnType<typeof fakeOutreachChannel>;
let fakes: Map<string, Fake>;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  fakes = new Map();
});

const channelFor = (a: Pick<ReachAccount, "account" | "platform">) => {
  let f = fakes.get(a.account);
  if (!f) {
    f = fakeOutreachChannel(a.platform, { account: a.account, now: () => NOW });
    fakes.set(a.account, f);
  }
  return f;
};

/** A warming Reddit account `days` old with `karma`, its health read. */
async function account(key: string, handle: string, days: number, karma: number) {
  const a = await addAccount(db(), { platform: "reddit", account: key, now: NOW });
  channelFor(a).setHealth({
    handle,
    createdAt: new Date(NOW.getTime() - days * DAY).toISOString(),
    karma,
  });
  await refreshHealth(db(), [a], channelFor, NOW);
  return setAccountState(db(), a.id, "warming", { reason: null, now: NOW });
}

const comment = (n: number, over: Partial<CommentIn> = {}): CommentIn => ({
  ref: `t1_c${n}`,
  post: "t3_p1",
  parent: "t3_p1",
  kind: "post_reply",
  place: "smallbusiness",
  postTitle: "How we cut invoice chasing to zero",
  handle: `reader${n}`,
  text: "Nice write-up",
  url: `https://www.reddit.com/r/smallbusiness/comments/p1/x/c${n}/`,
  at: new Date(NOW.getTime() - n * 60_000).toISOString(),
  raw: {},
  ...over,
});

describe("comments", () => {
  it("kept once; ours closed; the rest returned oldest first", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 10, 5);
    const items = [comment(1), comment(2), comment(3, { handle: "Ok_Crow" })];
    const kept = await keepComments(db(), a, items, ["ok_crow", "WrenAutomation"]);
    expect(kept.map((k) => k.author)).toEqual(["reader2", "reader1"]);
    expect(await keepComments(db(), a, items, [])).toEqual([]);
    const [ours] = await db().select().from(comments).where(eq(comments.author, "Ok_Crow"));
    expect(ours).toMatchObject({ sort: "ours", state: "dropped" });
    const rows = (await commentRecord.rows?.(db())) ?? [];
    expect(rows.map((r) => [r.who, r.account, r.state])).toEqual([
      ["reader1", "WrenAutomation", "new"],
      ["reader2", "WrenAutomation", "new"],
      ["Ok_Crow", "WrenAutomation", "dropped"],
    ]);
  });

  it("sorts by words for $0, else by the model, which drafts for asked and question", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 10, 5);
    const [asked, q, chat] = await keepComments(
      db(),
      a,
      [
        comment(3, { text: "Would love the template, dm me" }),
        comment(2, { text: "Does this work with QuickBooks?" }),
        comment(1, { text: "Cool" }),
      ],
      [],
    );
    const llm = new FakeLlm({
      respond: (prompt) =>
        prompt.includes("QuickBooks")
          ? '{"sort":"question","why":"asks about a tool","answer":"Yes, it reads QuickBooks."}'
          : prompt.includes("dm me")
            ? '{"sort":"chat","why":"x","answer":"Sending it over in a DM."}'
            : '{"sort":"chat","why":"a nod","answer":"Thanks!"}',
    });
    expect(await sortComment(db(), llm, asked?.id ?? 0)).toBe("asked");
    expect(await sortComment(db(), llm, q?.id ?? 0)).toBe("question");
    expect(await sortComment(db(), llm, chat?.id ?? 0)).toBe("chat");
    expect(await commentById(db(), asked?.id ?? 0)).toMatchObject({
      state: "waiting",
      why: "Asked in words",
      draft: "Sending it over in a DM.",
    });
    expect((await commentById(db(), q?.id ?? 0)).draft).toBe("Yes, it reads QuickBooks.");
    expect((await commentById(db(), chat?.id ?? 0)).draft).toBeNull();
  });

  it("answers under the comment; never where our other account wrote; within the rung's cap", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 10, 5);
    await account("reddit@alt", "Ok_Crow", 10, 5);
    const [c1, c2, c3, c4] = await keepComments(
      db(),
      a,
      [comment(4), comment(3, { post: "t3_p2" }), comment(2), comment(1)],
      [],
    );
    const ch = channelFor(a);
    ch.threads.set("t3_p2", ["someone", "ok_crow"]);
    await expect(
      answerComment(db(), ch, { id: c2?.id ?? 0, body: "Thanks", now: NOW }),
    ).rejects.toThrow(/Ok_Crow already wrote/);

    await answerComment(db(), ch, { id: c1?.id ?? 0, body: "Thanks!", now: NOW });
    expect(ch.sent).toEqual([{ kind: "comment", handle: "t1_c4", text: "Thanks!" }]);
    expect(await commentById(db(), c1?.id ?? 0)).toMatchObject({ state: "answered" });
    await expect(
      answerComment(db(), ch, { id: c1?.id ?? 0, body: "again", now: NOW }),
    ).rejects.toThrow(/already answered/);
    // The comment rung allows 3 a day.
    await answerComment(db(), ch, { id: c3?.id ?? 0, body: "a", now: NOW });
    await answerComment(db(), ch, { id: c4?.id ?? 0, body: "b", now: NOW });
    const [c5] = await keepComments(db(), a, [comment(5)], []);
    await expect(answerComment(db(), ch, { id: c5?.id ?? 0, body: "c", now: NOW })).rejects.toThrow(
      /3 comments a day/,
    );
  });

  it("one DM per person, refused before the account may message, sent with the gate off", async () => {
    const young = await account("reddit@wren", "WrenAutomation", 10, 5);
    const [early] = await keepComments(db(), young, [comment(9)], []);
    await expect(dmCommenter(db(), { id: early?.id ?? 0, body: "hi", now: NOW })).rejects.toThrow(
      /can't DM yet/,
    );

    const old = await account("reddit@alt", "Ok_Crow", 40, 200);
    const [c] = await keepComments(db(), old, [comment(1, { ref: "t1_x1" })], []);
    const r = await dmCommenter(db(), { id: c?.id ?? 0, body: "Here it is", now: NOW });
    await expect(
      dmCommenter(db(), { id: c?.id ?? 0, body: "And again", now: NOW }),
    ).rejects.toThrow(ReachRefusal);
    expect((await commentById(db(), c?.id ?? 0)).contactId).toBe(r.contactId);

    const stats = await tick(db(), {
      channelFor,
      policy: { ...DEFAULT_POLICY, gapSeconds: 0 },
      sequences: REACH_SEQUENCES,
      sender: "William",
      live: false,
      now: NOW,
    });
    expect(stats.sent).toBe(1);
    expect(channelFor(old).sent).toEqual([
      { kind: "message", handle: "reader1", text: "Here it is" },
    ]);
    const [m] = await db().select().from(reachMessages).where(eq(reachMessages.id, r.messageId));
    expect(m?.state).toBe("sent");
  });
});
