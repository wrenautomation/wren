/**
 * Follow-ups in a thread (designs/2026-10-15-engage-threads.md) on Postgres with synthetic data:
 * a watch starts when a reply lands under ours, a thread read keeps the self-reply the inbox
 * missed and a third person's deep reply, never twice; one person's messages fold into one row,
 * newest first; an answer goes to the node picked and covers their earlier ones; and an answer
 * made on the site closes the row.
 */
import type { CommentIn, ThreadNode, ThreadRead } from "@wren/core/outreach";
import { foldRows } from "@wren/core/records";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, setAccountState } from "../../src/accounts.js";
import { keepComments, markAnswered } from "../../src/comments.js";
import {
  adoptNode,
  applyThread,
  dueThreads,
  threadContextOf,
  threadFor,
  watchFromComments,
} from "../../src/follow-ups.js";
import { COMMENT_FOLD, commentRecord } from "../../src/records.js";
import { comments, commentThreads, type ReachAccount } from "../../src/schema.js";

const TABLES = ["comment_threads", "comments", "reach_contacts", "reach_accounts"];
const NOW = new Date("2026-10-01T18:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
const OURS = ["wren_test"];

let pg: TestPostgres;
const db = () => pg.db;
let acct: ReachAccount;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  const a = await addAccount(db(), { platform: "reddit", account: "reddit@test", now: NOW });
  acct = await setAccountState(db(), a.id, "warming", { reason: null, now: NOW });
  await db().execute(`update reach_accounts set handle = 'wren_test' where id = '${acct.id}'`);
});

const ago = (m: number) => new Date(NOW.getTime() - m * MIN).toISOString();
const node = (
  ref: string,
  parent: string,
  handle: string,
  m: number,
  text = `${handle} at ${ref}`,
): ThreadNode => ({
  ref,
  parent,
  handle,
  text,
  at: ago(m),
  url: `https://example.test/c/${ref}`,
});
const readOf = (nodes: ThreadNode[]): ThreadRead => ({
  post: {
    ref: "t3_p1",
    title: "A synthetic post",
    text: "Its words",
    handle: "poster",
    url: "https://example.test/p1",
    place: "r/test",
    media: null,
    at: ago(600),
    count: nodes.length,
  },
  nodes,
  more: 0,
});
/** The reply the inbox showed: replier_a under our comment. */
const inboxReply = (over: Partial<CommentIn> = {}): CommentIn => ({
  ref: "t1_a1",
  post: "t3_p1",
  parent: "t1_ours",
  kind: "comment_reply",
  place: "r/test",
  postTitle: "A synthetic post",
  handle: "replier_a",
  text: "First reply",
  url: "https://example.test/c/t1_a1",
  at: ago(50),
  raw: {},
  ...over,
});
const THREAD = [
  node("t1_ours", "t3_p1", "wren_test", 60),
  node("t1_a1", "t1_ours", "replier_a", 50, "First reply"),
  node("t1_a2", "t1_a1", "replier_a", 40, "And a question?"),
  node("t1_b1", "t1_a2", "replier_b", 30, "Same question"),
  node("t1_x1", "t3_p1", "stranger", 20),
];

async function watched() {
  await keepComments(db(), acct, [inboxReply()], OURS);
  expect(await watchFromComments(db(), NOW, 7, ["reddit"])).toBe(1);
  const [t] = await dueThreads(db(), NOW, [acct.id]);
  if (!t) throw new Error("no watch");
  return t;
}
const rowsByRef = async () => new Map((await db().select().from(comments)).map((c) => [c.ref, c]));

describe("engage threads", () => {
  it("watches a thread once a reply lands, and not past the window", async () => {
    const t = await watched();
    expect(t).toMatchObject({ platform: "reddit", post: "t3_p1", accountId: acct.id });
    expect(t.until.getTime()).toBeGreaterThan(NOW.getTime() + 6 * DAY);
    // Again with nothing new: no change, still one watch.
    expect(await watchFromComments(db(), NOW, 7, ["reddit"])).toBe(0);
    expect(await db().select().from(commentThreads)).toHaveLength(1);
    // A reply older than the window starts none.
    await truncate(pg.db, ["comment_threads", "comments"]);
    await keepComments(
      db(),
      acct,
      [inboxReply({ at: new Date(NOW.getTime() - 8 * DAY).toISOString() })],
      OURS,
    );
    expect(await watchFromComments(db(), NOW, 7, ["reddit"])).toBe(0);
  });

  it("keeps the self-reply and the deep third person once, never the stranger", async () => {
    const t = await watched();
    const first = await applyThread(db(), t, acct, readOf(THREAD), OURS, NOW, 0.5, 7);
    expect(first.kept.map((k) => k.author).sort()).toEqual(["replier_a", "replier_b"]);
    const rows = await rowsByRef();
    expect(rows.get("t1_a2")).toMatchObject({
      kind: "thread_reply",
      parent: "t1_a1",
      author: "replier_a",
    });
    expect(rows.get("t1_b1")).toMatchObject({
      kind: "thread_reply",
      parent: "t1_a2",
      author: "replier_b",
    });
    expect(rows.has("t1_x1")).toBe(false);
    // The same read again, and the inbox showing the same reply again: nothing doubles.
    const [again] = await db().select().from(commentThreads);
    if (!again) throw new Error("no watch");
    expect((await applyThread(db(), again, acct, readOf(THREAD), OURS, NOW, 0.5, 7)).kept).toEqual(
      [],
    );
    expect(await keepComments(db(), acct, [inboxReply()], OURS)).toEqual([]);
    expect(await db().select().from(comments)).toHaveLength(3);
  });

  it("folds one person's two messages into one row, newest first", async () => {
    const t = await watched();
    await applyThread(db(), t, acct, readOf(THREAD), OURS, NOW, 0.5, 7);
    const raw = (await commentRecord.rows?.(db())) ?? [];
    const folded = foldRows(raw, COMMENT_FOLD, "id");
    const a = folded.find((r) => r.who === "replier_a");
    const msgs = a?.messages as { text: string; open: boolean }[];
    expect(msgs.map((m) => m.text)).toEqual(["And a question?", "First reply"]);
    expect(folded.filter((r) => r.who === "replier_a")).toHaveLength(1);
    expect(folded.find((r) => r.who === "replier_b")?.messages).toHaveLength(1);
  });

  it("draws the whole conversation nested, with each kept row's state", async () => {
    const t = await watched();
    await applyThread(db(), t, acct, readOf(THREAD), OURS, NOW, 0.5, 7);
    const a2 = (await rowsByRef()).get("t1_a2");
    const ctx = await threadContextOf(db(), a2?.id ?? 0);
    expect(ctx?.focus).toBe("t1_a2");
    expect(ctx?.post).toMatchObject({ title: "A synthetic post", url: "https://example.test/p1" });
    expect(ctx?.nodes.map((n) => [n.ref, n.parent, n.ours])).toEqual([
      ["t1_ours", "t3_p1", true],
      ["t1_a1", "t1_ours", false],
      ["t1_a2", "t1_a1", false],
      ["t1_b1", "t1_a2", false],
      ["t1_x1", "t3_p1", false],
    ]);
    expect(ctx?.nodes.find((n) => n.ref === "t1_x1")?.row).toBeNull();
    expect(ctx?.nodes.find((n) => n.ref === "t1_a2")?.row?.id).toBe(a2?.id);
    expect(ctx?.refresh).toBe(true);
  });

  it("a reply goes to the node picked: its row, or one made from the read; never ours", async () => {
    const t = await watched();
    await applyThread(db(), t, acct, readOf(THREAD), OURS, NOW, 0.5, 7);
    const rows = await rowsByRef();
    const from = rows.get("t1_a1")?.id ?? 0;
    expect(await adoptNode(db(), from, "t1_a1")).toBe(from);
    expect(await adoptNode(db(), from, "t1_b1")).toBe(rows.get("t1_b1")?.id);
    // The stranger had no row: answering them makes one, once.
    const x = await adoptNode(db(), from, "t1_x1");
    expect(await adoptNode(db(), from, "t1_x1")).toBe(x);
    const [made] = await db().select().from(comments).where(eq(comments.id, x));
    expect(made).toMatchObject({ ref: "t1_x1", author: "stranger", post: "t3_p1" });
    await expect(adoptNode(db(), from, "t1_ours")).rejects.toThrow();
    await expect(adoptNode(db(), from, "t1_nope")).rejects.toThrow();
  });

  it("an answer to their newest covers their earlier one; a later one stays open", async () => {
    const t = await watched();
    await applyThread(db(), t, acct, readOf(THREAD), OURS, NOW, 0.5, 7);
    const rows = await rowsByRef();
    await markAnswered(db(), rows.get("t1_a2")?.id ?? 0, { body: "Yes", ref: "t1_ans", now: NOW });
    const after = await rowsByRef();
    expect(after.get("t1_a1")?.state).toBe("answered");
    expect(after.get("t1_a2")?.state).toBe("answered");
    expect(after.get("t1_b1")?.state).not.toBe("answered");
  });

  it("our answer made on the site closes the row it answers", async () => {
    const t = await watched();
    await applyThread(db(), t, acct, readOf(THREAD), OURS, NOW, 0.5, 7);
    const [again] = await db().select().from(commentThreads);
    if (!again) throw new Error("no watch");
    const done = await applyThread(
      db(),
      again,
      acct,
      readOf([...THREAD, node("t1_mine", "t1_b1", "wren_test", 5, "Here you go")]),
      OURS,
      NOW,
      0.5,
      7,
    );
    const b1 = (await rowsByRef()).get("t1_b1");
    expect(done.answered).toEqual([b1?.id]);
    expect(b1).toMatchObject({ state: "answered", answer: "Here you go", answerRef: "t1_mine" });
  });

  it("threadFor makes a watch for a row opened before one existed", async () => {
    const [c] = await keepComments(db(), acct, [inboxReply()], OURS);
    const t = await threadFor(db(), c?.id ?? 0, NOW, 7);
    expect(t?.thread).toMatchObject({ post: "t3_p1", accountId: acct.id });
    expect(t?.account.id).toBe(acct.id);
    expect(await db().select().from(commentThreads)).toHaveLength(1);
  });
});
