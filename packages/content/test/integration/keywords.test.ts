/**
 * Comment keywords against Postgres: which kept comments a keyword catches, once per comment and
 * per person, narrowest keyword first; the log's views; edits as changes. Synthetic rows only.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { editRecord } from "@wren/core/edits";
import { serveRecords } from "@wren/core/records/serve";
import { startTestRestate } from "@wren/core/testing";
import {
  commentObjects,
  seedObjects,
  startTestPostgres,
  type TestPostgres,
} from "@wren/db/testing";
import { sendAttempt } from "@wren/outreach";
import { comments, sendAttempts } from "@wren/outreach/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type KeywordDm, makeKeywordDm } from "../../src/restate/keyword-dm.js";
import { keywordHits } from "../../src/schema.js";
import {
  addKeyword,
  catchKeywords,
  failHit,
  handHit,
  keywordHitRecord,
  keywordRecord,
  removeKeywords,
} from "../../src/social/keywords.js";

/**
 * What the fake Content service was asked. Keyed, it answers a `Delivery` as the core does: a
 * comment whose ref is `nope` Meta refuses, `lost` the page did not confirm (unknown), `busy` the
 * browser was busy (nothing sent).
 */
const asked: { handler: string; commentId: string; text: string; sendKey?: string }[] = [];
type Ask = { platform: string; commentId: string; text: string; sendKey?: string };
const answer = (req: Ask, out: unknown, handler = "privateReply") => {
  if (!req.sendKey) return out;
  // Only the public reply is refused.
  if (handler === "reply" && req.commentId.startsWith("noreply"))
    return { kind: "not_sent", how: "refused", reason: "Meta: reply blocked", status: 400 };
  if (req.commentId.startsWith("nope"))
    return {
      kind: "not_sent",
      how: "refused",
      reason: "Meta: window closed",
      status: 400,
    };
  if (req.commentId.startsWith("busy"))
    return {
      kind: "not_sent",
      how: "before_submit",
      reason: "the browser was busy",
      status: null,
    };
  if (req.commentId.startsWith("lost"))
    return {
      kind: "unknown",
      reason: "the page did not confirm the reply",
      since: new Date().toISOString(),
    };
  return { kind: "sent", out };
};
const fakeContent = restate.service({
  name: "Content",
  handlers: {
    privateReply: async (_ctx: restate.Context, req: Ask) => {
      asked.push({ handler: "privateReply", ...req });
      return answer(req, { ref: `m-${req.commentId}` });
    },
    reply: async (_ctx: restate.Context, req: Ask) => {
      asked.push({ handler: "reply", ...req });
      return answer(req, undefined, "reply");
    },
  },
});

/** `KeywordDm.send` is ingress-private: SocialWatch calls it, so the test calls it from inside. */
const watch = restate.service({
  name: "Watch",
  handlers: {
    send: (ctx: restate.Context, hit: number) =>
      ctx.serviceClient<KeywordDm>({ name: "KeywordDm" }).send({ client: null, hit }),
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [makeKeywordDm({ db: pg.db }), fakeContent, watch],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

let n = 0;
const comment = async (o: {
  body: string;
  author?: string;
  platform?: "instagram" | "facebook" | "youtube";
  post?: string;
  ref?: string;
}) => {
  n += 1;
  await seedObjects(
    pg.db,
    commentObjects([
      { platform: o.platform ?? "instagram", ref: o.ref ?? `c${n}`, post: o.post ?? "p1" },
    ]),
  );
  const [c] = await pg.db
    .insert(comments)
    .values({
      platform: o.platform ?? "instagram",
      channel: "content",
      ref: o.ref ?? `c${n}`,
      post: o.post ?? "p1",
      parent: o.post ?? "p1",
      kind: "post_reply",
      author: o.author ?? `reader${n}`,
      body: o.body,
      url: `https://example.test/c${n}`,
      at: new Date(),
      raw: {},
    })
    .returning({ id: comments.id });
  return c?.id ?? 0;
};

describe("comment keywords", () => {
  it("catches whole-word keywords once per person, the post's own first", async () => {
    const by = "william";
    const every = await addKeyword(pg.db, { keyword: "LINK", dm: "Here: example.test" }, by);
    const one = await addKeyword(
      pg.db,
      { keyword: "link", dm: "This post's link", platform: "instagram", post: "p2" },
      by,
    );
    await expect(addKeyword(pg.db, { keyword: "link", dm: "again" }, by)).rejects.toThrow(
      /set already/,
    );
    const ids = [
      await comment({ body: "LINK please", author: "ana" }),
      await comment({ body: "link again!", author: "ana" }),
      await comment({ body: "linked in?", author: "bo" }),
      await comment({ body: "link", author: "cy", post: "p2" }),
      await comment({ body: "link", author: "dee", platform: "youtube" }),
    ];
    const hits = await catchKeywords(pg.db, ids);
    expect(hits.map((h) => h.commentId)).toEqual([ids[0], ids[3]]);
    expect(await catchKeywords(pg.db, ids)).toEqual([]);

    // A handed hit reads its state from the ledger row.
    const now = new Date();
    expect(await handHit(pg.db, hits[0]?.id ?? 0)).toBe(true);
    expect(await handHit(pg.db, hits[0]?.id ?? 0)).toBe(false);
    await pg.db.insert(sendAttempts).values({
      item: `private:${ids[0]}`,
      state: "sent",
      platform: "instagram",
      words: "Here: example.test",
      target: "c1",
      ref: "m1",
      sentAt: now,
      startedAt: now,
      updatedAt: now,
    });
    await failHit(pg.db, hits[1]?.id ?? 0, "past Meta's 7 days");
    const api = serveRecords([keywordRecord, keywordHitRecord], pg.db);
    const keys = await api.list({ record: "marketing.comment_keyword", view: "all", limit: 10 });
    expect(keys.rows.find((r) => r.id === String(every.id))).toMatchObject({
      caught: 1,
      sent: 1,
      platform: "any",
    });
    expect(keys.rows.find((r) => r.id === String(one.id))).toMatchObject({ caught: 1, failed: 1 });
    const failed = await api.list({ record: "marketing.keyword_hit", view: "failed", limit: 10 });
    expect(failed.rows).toEqual([
      expect.objectContaining({ author: "cy", why: "past Meta's 7 days", comment: "link" }),
    ]);

    await editRecord(pg.db, keywordRecord, String(every.id), { patch: { state: "off" }, by });
    expect(await catchKeywords(pg.db, [await comment({ body: "link", author: "eve" })])).toEqual(
      [],
    );
    expect(await removeKeywords(pg.db, [one.id])).toBe(1);
    const log = await api.list({ record: "marketing.keyword_hit", view: "all", limit: 10 });
    expect(log.rows.map((r) => r.author)).toEqual(["ana"]);
  });
});

describe("KeywordDm.send", () => {
  it("sends the DM then the public reply, and logs Meta's no as failed", async () => {
    const k = await addKeyword(
      pg.db,
      { keyword: "guide", dm: "The guide: example.test/g", reply: "Sent, check your DMs" },
      "william",
    );
    const ok = await comment({ body: "GUIDE", author: "fay", ref: "yes1" });
    const no = await comment({ body: "guide pls", author: "gus", ref: "nope" });
    const hits = await catchKeywords(pg.db, [ok, no]);
    expect(hits).toHaveLength(2);
    const w = clients
      .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
      .serviceClient<typeof watch>({ name: "Watch" });
    expect(await w.send(hits[0]?.id ?? 0)).toEqual({ state: "sent" });
    expect(await w.send(hits[1]?.id ?? 0)).toEqual({ state: "failed" });
    // Sent once: a second ask finds it handed to the ledger.
    expect(await w.send(hits[0]?.id ?? 0)).toEqual({ state: "handed" });
    // Each write runs under its ledger key: the DM as `private:<id>`, the reply as `comment:<id>`.
    expect(asked.filter((a) => a.commentId === "yes1")).toEqual([
      {
        handler: "privateReply",
        platform: "instagram",
        commentId: "yes1",
        client: null,
        text: "The guide: example.test/g",
        sendKey: expect.stringMatching(/^private:\d+ /),
        recheck: false,
        verifyOnly: false,
      },
      {
        handler: "reply",
        platform: "instagram",
        commentId: "yes1",
        client: null,
        text: "Sent, check your DMs",
        sendKey: expect.stringMatching(/^comment:\d+ /),
        recheck: false,
        verifyOnly: false,
      },
    ]);
    expect(await sendAttempt(pg.db, `private:${ok}`)).toMatchObject({ state: "sent" });
    expect(await sendAttempt(pg.db, `comment:${ok}`)).toMatchObject({ state: "sent" });
    const log = await pg.db.select().from(keywordHits).where(eq(keywordHits.keywordId, k.id));
    expect(log.map((h) => [h.author, h.state, h.ref, h.why]).sort()).toEqual([
      ["fay", "handed", null, null],
      ["gus", "failed", null, "send POST write: 400 Meta: window closed"],
    ]);
    const [c] = await pg.db.select().from(comments).where(eq(comments.id, ok));
    expect(c).toMatchObject({ state: "answered", answer: "Sent, check your DMs" });
    expect(c?.contactId).toBeGreaterThan(0);
  });
  /** A hit on a comment with this ref and the keyword's DM; its `send` result and ledger rows. */
  const hitOn = async (ref: string, o: { reply?: string } = {}) => {
    const k = await addKeyword(
      pg.db,
      { keyword: `kw${ref}`, dm: "The guide", ...(o.reply ? { reply: o.reply } : {}) },
      "william",
    );
    const id = await comment({ body: `kw${ref} please`, author: `by_${ref}`, ref });
    const [h] = await catchKeywords(pg.db, [id]);
    const w = clients
      .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
      .serviceClient<typeof watch>({ name: "Watch" });
    const state = await w.send(h?.id ?? 0);
    const [row] = await pg.db
      .select()
      .from(keywordHits)
      .where(eq(keywordHits.id, h?.id ?? 0));
    return { id, k, state, row };
  };

  it("unsure: the DM may have gone out, so the hit stays handed and its ledger row waits in To approve", async () => {
    const { id, state, row } = await hitOn("lost1", { reply: "Check your DMs" });
    expect(state).toEqual({ state: "handed" });
    expect(row?.state).toBe("handed");
    expect(await sendAttempt(pg.db, `private:${id}`)).toMatchObject({ state: "unsure" });
    const api = serveRecords([keywordHitRecord], pg.db);
    const failed = await api.list({ record: "marketing.keyword_hit", view: "unsure", limit: 50 });
    expect(failed.rows.find((r) => r.author === "by_lost1")).toMatchObject({ state: "unsure" });
    // No public reply goes after a DM that may not have gone out, and nothing was sent twice.
    expect(asked.filter((a) => a.commentId === "lost1").map((a) => a.handler)).toEqual([
      "privateReply",
    ]);
  });

  it("not sent: the hit is failed with why, the ledger row is released, nothing is queued to send", async () => {
    const { id, state, row } = await hitOn("busy1");
    expect(state).toEqual({ state: "failed" });
    expect(row?.why).toMatch(/Nothing went out.*browser was busy/);
    expect(await sendAttempt(pg.db, `private:${id}`)).toBeNull();
  });

  it("refused: the hit is failed with Meta's reason and the ledger row is released", async () => {
    const { id, state, row } = await hitOn("nope2");
    expect(state).toEqual({ state: "failed" });
    expect(row?.why).toContain("Meta: window closed");
    expect(await sendAttempt(pg.db, `private:${id}`)).toBeNull();
  });

  it("a public reply that fails never undoes the sent DM", async () => {
    const { id, state, row } = await hitOn("noreply1", { reply: "Check your DMs" });
    expect(state).toEqual({ state: "sent" });
    expect(row?.state).toBe("handed");
    expect(await sendAttempt(pg.db, `private:${id}`)).toMatchObject({ state: "sent" });
    // The reply was refused: its ledger row is released and the comment is not marked answered.
    expect(await sendAttempt(pg.db, `comment:${id}`)).toBeNull();
    const [c] = await pg.db.select().from(comments).where(eq(comments.id, id));
    expect(c?.state).not.toBe("answered");
  });
});
