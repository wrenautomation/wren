/**
 * Content per client (designs/2026-10-07-per-client-runs.md): a client's planner drafts as the
 * client into its own database, on its own `models` gate; its scheduler holds approved drafts
 * until an admin turns its posting on, then posts on its own login; its metrics and social reads
 * land in its own database. Two clients never mix; no login, no About or a gate saying no stops
 * them and says why. Synthetic clients and posts only.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, findClient, sendsOn, updateClient } from "@wren/core/clients";
import { fakeContentChannel, type Platform } from "@wren/core/content";
import { type Channels, makeContent, SENDS_OFF } from "@wren/core/content/restate";
import type { PassOutcome } from "@wren/core/restate";
import { spineRecorder, startTestRestate } from "@wren/core/testing";
import { vendorUsage } from "@wren/core/vendor-schema";
import { setManaged } from "@wren/core/vendors";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientContent, clientPlan } from "../../src/clients.js";
import { addIdea, contentDrafts, contentMetrics } from "../../src/index.js";
import { makeContentDesk } from "../../src/restate/desk.js";
import { type MetricsStats, makeContentMetrics } from "../../src/restate/metrics.js";
import { makeContentPlanner, type PlannerStats } from "../../src/restate/planner.js";
import { makeContentScheduler, type PublishStats } from "../../src/restate/scheduler.js";
import { makeSocialWatch, type SocialStats } from "../../src/restate/social.js";

const prompts: string[] = [];
/** The clients' model: a Reddit post has a title. Wren's model is never asked for a client. */
const clientLlm = new FakeLlm({
  respond: async (prompt) => {
    prompts.push(prompt);
    return prompt.includes("a Reddit text post")
      ? '{"title": "Fewer denials", "text": "We cut claim denials by a third."}'
      : '{"text": "We cut claim denials by a third."}';
  },
});
const wrenLlm = new FakeLlm({
  respond: () => {
    throw new Error("Wren's model never drafts a client's post");
  },
});

/** Each client's channels on its own login. */
const channels: Record<string, Channels> = {
  kappa: { linkedin: fakeContentChannel("linkedin") },
  lambda: { reddit: fakeContentChannel("reddit") },
};
const kappaIn = () => channels.kappa?.linkedin as ReturnType<typeof fakeContentChannel>;
const lambdaReddit = () => channels.lambda?.reddit as ReturnType<typeof fakeContentChannel>;

let pg: TestPostgres;
let env: RestateTestEnvironment;
let kappa: Db;
let lambda: Db;
const spine = spineRecorder();
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const products = (about?: string) => ({
  "content.posting": {},
  "content.planner": about ? { about } : {},
  "content.social": {},
});

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "kappa",
    name: "Kappa Dental",
    accounts: { linkedin: "linkedin@kappa" },
    products: products("dental billing for small practices"),
  });
  await addClient(pg.db, pg.url, {
    id: "lambda",
    name: "Lambda Books",
    accounts: { reddit: "reddit@lambda" },
    products: products("bookkeeping for cafes"),
  });
  await addClient(pg.db, pg.url, { id: "mu", name: "Mu", products: products("roofing") });
  await addClient(pg.db, pg.url, {
    id: "nu",
    name: "Nu",
    accounts: { linkedin: "linkedin@nu" },
    products: products(),
  });
  await addClient(pg.db, pg.url, {
    id: "xi",
    name: "Xi",
    accounts: { linkedin: "linkedin@xi" },
    products: products("plumbing"),
  });
  for (const client of ["kappa", "lambda"])
    await setManaged(pg.db, { client, vendor: "models", perDay: 100, capCents: 500, by: "test" });
  kappa = open("kappa");
  lambda = open("lambda");
  env = await startTestRestate({
    services: [
      spine.service,
      makeContent(() => ({}), {
        channels: async (_ctx, client) => channels[client] ?? {},
        sends: async (client) => {
          const c = await findClient(pg.db, client);
          return !!c && sendsOn(c, "content.posting");
        },
      }),
      makeContentDesk({
        db: pg.db,
        llm: wrenLlm,
        platforms: ["linkedin", "x"],
        zone: "UTC",
        clients: { clientDb: open, llm: clientLlm },
      }),
      makeContentPlanner({ db: pg.db, zone: "UTC", clientDb: open }),
      makeContentScheduler({ db: pg.db, idleMs: 60_000, clientDb: open }),
      makeContentMetrics({ db: pg.db, clientDb: open }),
      makeSocialWatch({
        db: pg.db,
        platforms: ["linkedin", "reddit"],
        zone: "UTC",
        clientDb: open,
      }),
    ],
    disableRetries: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const loop = <S>(name: string, key: string) =>
  ingress().objectClient<{ sync: () => Promise<unknown> }>({ name }, key).sync() as Promise<
    PassOutcome<S>
  >;
const plan = (c: string) => loop<PlannerStats>("ContentPlanner", `${c}/daily`);
const post = (c: string) => loop<PublishStats>("ContentScheduler", `${c}/posts`);
const drafts = (db: Db) =>
  db
    .select({
      id: contentDrafts.id,
      platform: contentDrafts.platform,
      status: contentDrafts.status,
      text: contentDrafts.text,
    })
    .from(contentDrafts);

describe("a client's content plan", () => {
  it("missing: no LinkedIn or Reddit login stops every loop and says why", async () => {
    expect(await clientContent(pg.db, "mu", "content.posting")).toEqual({
      kind: "gone",
      why: "no LinkedIn or Reddit login connected",
    });
    expect((await plan("mu")).stopped).toBe("no LinkedIn or Reddit login connected");
    expect((await post("mu")).stopped).toBe("no LinkedIn or Reddit login connected");
    expect((await loop<SocialStats>("SocialWatch", "mu/social")).stopped).toBe(
      "no LinkedIn or Reddit login connected",
    );
  });

  it("never speaks as Wren: no About, no drafts", async () => {
    const nu = await findClient(pg.db, "nu");
    if (!nu) throw new Error("no nu");
    expect(clientPlan(nu)).toEqual({ ok: false, why: "say what it does and for whom: set About" });
    expect((await plan("nu")).stopped).toBe("say what it does and for whom: set About");
  });
});

describe("the planner per client", () => {
  it("one client: drafts as the client on its own login, into its own database, metered", async () => {
    await addIdea(kappa, "We cut claim denials by a third for a two-chair practice", "cli");
    prompts.length = 0;
    const out = await plan("kappa");
    expect(out.stopped).toBeUndefined();
    expect(out.stats?.drafted.map((d) => d.platform)).toEqual(["linkedin"]);
    // Drafts wait in its To approve; Wren's database has none.
    expect(await drafts(kappa)).toEqual([expect.objectContaining({ status: "draft" })]);
    expect(await pg.db.select().from(contentDrafts)).toEqual([]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Kappa Dental, dental billing for small practices");
    const used = await pg.db.select().from(vendorUsage).where(eq(vendorUsage.client, "kappa"));
    expect(used.map((u) => [u.vendor, u.part])).toEqual([["models", "content.planner"]]);
  });

  it("two clients: each on its own platforms and database", async () => {
    await addIdea(lambda, "A cafe closed its books in a day", "cli");
    const out = await plan("lambda");
    expect(out.stats?.drafted.map((d) => d.platform)).toEqual(["reddit"]);
    expect((await drafts(lambda)).map((d) => d.platform)).toEqual(["reddit"]);
    expect((await drafts(kappa)).map((d) => d.platform)).toEqual(["linkedin"]);
  });

  it("gate stop: no models mode, nothing drafted, said why", async () => {
    await addIdea(open("xi"), "A leak found before the ceiling fell", "cli");
    prompts.length = 0;
    const out = await plan("xi");
    expect(out.stats?.drafted).toEqual([]);
    expect(out.stats?.skipped).toEqual([expect.stringMatching(/^drafting: models: /)]);
    expect(prompts).toEqual([]);
    expect(await drafts(open("xi"))).toEqual([]);
  });
});

describe("posting per client", () => {
  it("holds approved drafts while sends are off; posts on its own login once an admin says go", async () => {
    const [d] = await drafts(kappa);
    if (!d) throw new Error("no draft");
    // Approved and due now (the planner held it for tomorrow's slot).
    await kappa
      .update(contentDrafts)
      .set({
        status: "approved",
        approvedAt: new Date(),
        scheduledFor: new Date(Date.now() - 60_000),
      })
      .where(eq(contentDrafts.id, d.id));
    const held = await post("kappa");
    expect(held.stats).toMatchObject({ published: [], held: 1 });
    expect(kappaIn().posts).toEqual([]);
    // The Content service refuses a client's post outright while its sends are off.
    await expect(
      ingress()
        .serviceClient<ReturnType<typeof makeContent>>({ name: "Content" })
        .publish({ platform: "linkedin", post: { text: "x" }, client: "kappa" } as never),
    ).rejects.toThrow(SENDS_OFF);

    await updateClient(pg.db, "kappa", { sends: ["content.posting"] });
    const sent = await post("kappa");
    expect(sent.stats?.published).toEqual([expect.objectContaining({ id: d.id })]);
    expect(kappaIn().posts.map((p) => p.post.text)).toEqual([d.text]);
    expect((await drafts(kappa))[0]?.status).toBe("published");
    expect(lambdaReddit().posts).toEqual([]);
  });

  it("a platform without its login fails on the row, never on Wren's channel", async () => {
    await kappa.insert(contentDrafts).values({
      ideaId: (await addIdea(kappa, "x only", "cli")).id,
      platform: "x" as Platform,
      text: "on x",
      status: "approved",
      promptVersion: "test",
      approvedAt: new Date(),
      scheduledFor: new Date(Date.now() - 60_000),
    });
    const out = await post("kappa");
    expect(out.stats?.failed).toEqual([
      expect.objectContaining({ platform: "x", error: expect.stringContaining("no x login") }),
    ]);
    await updateClient(pg.db, "kappa", { sends: [] });
  });
});

describe("metrics and social reads per client", () => {
  it("read its own posts into its own database", async () => {
    const [p] = kappaIn().posts;
    if (!p) throw new Error("not posted");
    kappaIn().count(p.id, { views: 40 });
    kappaIn().receive({
      id: "c1",
      postId: p.id,
      author: "a reader",
      text: "How long did that take?",
      at: new Date().toISOString(),
    });
    const m = await loop<MetricsStats>("ContentMetrics", "kappa/posts");
    expect(m.stopped).toBeUndefined();
    expect((await kappa.select().from(contentMetrics)).map((r) => r.views)).toEqual([40]);
    expect(await pg.db.select().from(contentMetrics)).toEqual([]);

    spine.emitted.length = 0;
    const s = await loop<SocialStats>("SocialWatch", "kappa/social");
    expect(s.stopped).toBeUndefined();
    expect(s.stats).toMatchObject({ posts: 1, comments: 1 });
    expect(spine.emitted).toEqual([expect.objectContaining({ client: "kappa" })]);
  });
});
