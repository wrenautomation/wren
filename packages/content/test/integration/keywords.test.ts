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
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { comments } from "@wren/outreach/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type KeywordDm, makeKeywordDm } from "../../src/restate/keyword-dm.js";
import { keywordHits } from "../../src/schema.js";
import {
  addKeyword,
  catchKeywords,
  keywordHitRecord,
  keywordRecord,
  removeKeywords,
  settleHit,
} from "../../src/social/keywords.js";

/** What the fake Content service was asked; a comment whose ref is `nope` Meta refuses. */
const asked: { handler: string; commentId: string; text: string }[] = [];
type Ask = { platform: string; commentId: string; text: string };
const fakeContent = restate.service({
  name: "Content",
  handlers: {
    privateReply: async (_ctx: restate.Context, req: Ask) => {
      if (req.commentId === "nope") throw new restate.TerminalError("Meta: window closed");
      asked.push({ handler: "privateReply", ...req });
      return { ref: `m-${req.commentId}` };
    },
    reply: async (_ctx: restate.Context, req: Ask) => {
      asked.push({ handler: "reply", ...req });
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

    await settleHit(pg.db, hits[0]?.id ?? 0, { sent: true, ref: "m1", now: new Date() });
    await settleHit(pg.db, hits[1]?.id ?? 0, { sent: false, why: "past Meta's 7 days" });
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
    // Sent once: a second ask finds it settled.
    expect(await w.send(hits[0]?.id ?? 0)).toEqual({ state: "sent" });
    expect(asked).toEqual([
      {
        handler: "privateReply",
        platform: "instagram",
        commentId: "yes1",
        client: null,
        text: "The guide: example.test/g",
      },
      {
        handler: "reply",
        platform: "instagram",
        commentId: "yes1",
        client: null,
        text: "Sent, check your DMs",
      },
    ]);
    const log = await pg.db.select().from(keywordHits).where(eq(keywordHits.keywordId, k.id));
    expect(log.map((h) => [h.author, h.state, h.ref, h.why]).sort()).toEqual([
      ["fay", "sent", "m-yes1", null],
      ["gus", "failed", null, "Meta: window closed"],
    ]);
    const [c] = await pg.db.select().from(comments).where(eq(comments.id, ok));
    expect(c).toMatchObject({ state: "answered", answer: "Sent, check your DMs" });
    expect(c?.contactId).toBeGreaterThan(0);
  });
});
