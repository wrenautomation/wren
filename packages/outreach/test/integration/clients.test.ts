/**
 * Reach per client (designs/2026-10-07-per-client-runs.md): a client's comment reader and
 * Reddit discovery run on its own logins into its own database, every read through its vendor
 * gate; two clients never mix; no login or a gate saying no stops them; a sort uses the client's
 * database. Synthetic logins and threads only.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, updateClient } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import type { PassOutcome } from "@wren/core/restate";
import { spineRecorder, startTestRestate } from "@wren/core/testing";
import { vendorUsage } from "@wren/core/vendor-schema";
import { setManaged } from "@wren/core/vendors";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAccount } from "../../src/accounts.js";
import { clientReach, clientSends, loginsOf } from "../../src/clients.js";
import { sortStep } from "../../src/comments.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import type { DiscoveryStats } from "../../src/restate/discovery.js";
import { makeRedditReads } from "../../src/restate/discovery.js";
import { makeReachWatch, type ReachDeps, type WatchStats } from "../../src/restate/index.js";
import { comments, redditPlaces as places, reachAccounts } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";

const calls: { site: string; path: string; account: string | undefined }[] = [];
const NOW_S = Math.floor(Date.parse("2026-10-07T15:00:00Z") / 1000);

/** The desk, faked: one comment in every inbox, a small public subreddit. */
const sites: SiteClient = {
  async call<T>(
    site: string,
    _method: string,
    path: string,
    _input?: Record<string, unknown>,
    account?: string,
  ) {
    calls.push({ site, path, account });
    const label = account?.split("@")[1] ?? "public";
    const out: unknown =
      path === "/api/v1/me"
        ? { name: `${label}_bot`, total_karma: 12, created_utc: NOW_S - 90 * 86_400 }
        : path === "/message/inbox"
          ? {
              data: {
                children: [
                  {
                    data: {
                      name: `t1_${label}c1`,
                      author: `${label}_reader`,
                      body: "Interested, DM me the price",
                      was_comment: true,
                      context: `/r/smallbiz/comments/${label}p1/x/${label}c1/?context=3`,
                      subreddit: "smallbiz",
                      created_utc: NOW_S - 600,
                    },
                  },
                ],
              },
            }
          : path.endsWith("/about")
            ? { data: { display_name: "dentistry", subscribers: 5000, subreddit_type: "public" } }
            : { data: { children: [] } };
    return out as T;
  },
  via: async () => "api",
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
let kappa: Db;
let lambda: Db;
const spine = spineRecorder();
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));

beforeAll(async () => {
  pg = await startTestPostgres();
  // Wren's own login: never a client's.
  await addAccount(pg.db, { platform: "reddit", account: "reddit@wren", now: new Date() });
  await addClient(pg.db, pg.url, {
    id: "kappa",
    name: "Kappa",
    accounts: { reddit: "reddit@kappa" },
    products: {
      "comments.read": {},
      "comments.sort": {},
      "reddit.discovery": {
        about: "Dentists who run their own practice",
        subreddits: ["dentistry"],
        exaSearches: 0,
      },
    },
  });
  await addClient(pg.db, pg.url, {
    id: "lambda",
    name: "Lambda",
    accounts: { reddit: "reddit@lambda" },
    products: { "comments.read": {}, "reddit.discovery": {} },
  });
  await addClient(pg.db, pg.url, { id: "mu", name: "Mu", products: { "comments.read": {} } });
  await addClient(pg.db, pg.url, {
    id: "nu",
    name: "Nu",
    accounts: { reddit: "reddit@wren" },
    products: { "comments.read": {} },
  });
  // Kappa's reads on Wren's key with its own daily share; Lambda has no mode: "Needs setup".
  await setManaged(pg.db, {
    client: "kappa",
    vendor: "reddit",
    perDay: 100,
    capCents: 0,
    by: "test",
  });
  kappa = open("kappa");
  lambda = open("lambda");
  const deps: ReachDeps = {
    db: pg.db,
    policy: DEFAULT_POLICY,
    sequences: REACH_SEQUENCES,
    live: false,
    senderName: "Test",
    heldNiches: [],
    // Journaled like the desk's calls: a replay reads the journal, not the desk again.
    sitesFor: (ctx) => ({
      call: <T>(...a: Parameters<SiteClient["call"]>) =>
        ctx.run(`site ${a[2]}`, () => sites.call(...a)) as Promise<T>,
      via: sites.via,
    }),
    clients: { clientDb: open, llm: null },
  };
  env = await startTestRestate({
    services: [
      spine.service,
      makeReachWatch(deps),
      makeRedditReads({
        ...deps,
        discovery: {
          llm: null,
          voice: "",
          facts: async () => [],
          audience: async () => {
            throw new Error("Wren's audience is never read on a client's pass");
          },
        },
      }),
    ],
    alwaysReplay: true,
    disableRetries: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const watch = (key: string) =>
  ingress()
    .objectClient<ReturnType<typeof makeReachWatch>>({ name: "ReachWatch" }, key)
    .sync() as Promise<PassOutcome<WatchStats>>;
const reads = (key: string) =>
  ingress()
    .objectClient<ReturnType<typeof makeRedditReads>>({ name: "RedditReads" }, key)
    .sync() as Promise<PassOutcome<DiscoveryStats>>;

describe("a client's logins", () => {
  it("are its own: never one of Wren's, each site@label", () => {
    expect(
      loginsOf(
        { reddit: "reddit@a, reddit@wren,bad", linkedin: "linkedin@a" },
        new Set(["reddit@wren"]),
      ),
    ).toEqual({
      logins: [
        { platform: "reddit", account: "reddit@a" },
        { platform: "linkedin", account: "linkedin@a" },
      ],
      skipped: ["reddit@wren: one of Wren's own logins", "bad: not reddit@<label>"],
    });
  });

  it("missing: the pass stops and says why", async () => {
    expect(await clientReach(pg.db, "mu", ["comments.read"])).toEqual({
      kind: "gone",
      why: "no login connected",
    });
    expect((await clientReach(pg.db, "nu", ["comments.read"])).kind).toBe("gone");
    const out = await watch("mu/daily");
    expect(out.stopped).toBe("no login connected");
    expect(calls.filter((c) => c.account === "reddit@wren")).toEqual([]);
  });
});

describe("the comment reader per client", () => {
  it("one client: reads its inbox on its own login, metered, into its own database", async () => {
    calls.length = 0;
    spine.emitted.length = 0;
    const out = await watch("kappa/daily");
    expect(out.stopped).toBeUndefined();
    expect(out.stats).toMatchObject({ comments: { kept: 1 }, stopped: null });
    expect(new Set(calls.map((c) => c.account))).toEqual(new Set(["reddit@kappa"]));
    expect(await kappa.select({ author: comments.author }).from(comments)).toEqual([
      { author: "kappa_reader" },
    ]);
    expect(await pg.db.select().from(comments)).toEqual([]);
    expect(spine.emitted).toEqual([
      expect.objectContaining({ client: "kappa", workflow: "reach.comments" }),
    ]);
    const used = await pg.db.select().from(vendorUsage).where(eq(vendorUsage.client, "kappa"));
    expect(used.length).toBe(calls.length);
    expect(used.every((u) => u.vendor === "reddit" && u.part === "comments.read")).toBe(true);
  });

  it("two clients: each on its own logins and database; a gate saying no stops the reads", async () => {
    calls.length = 0;
    const out = await watch("lambda/daily");
    // Lambda has no reddit mode: nothing is read.
    expect(out.stats?.stopped).toBe("Needs setup");
    expect(calls).toEqual([]);
    expect(await lambda.select().from(comments)).toEqual([]);
    // Its login is a row in its own database only.
    expect((await lambda.select().from(reachAccounts)).map((a) => a.account)).toEqual([
      "reddit@lambda",
    ]);
    expect((await kappa.select().from(reachAccounts)).map((a) => a.account)).toEqual([
      "reddit@kappa",
    ]);
  });
});

describe("the comment sort per client", () => {
  it("sorts in the client's database; no model reads the words", async () => {
    const [c] = await kappa.select({ id: comments.id }).from(comments);
    const step = sortStep(pg.db, new FakeLlm(() => "{}"), undefined, async () => ({
      db: kappa,
      llm: null,
    }));
    const out = await step(
      "comment",
      { kind: "comment", subject: `comment:${c?.id}`, data: { commentId: c?.id }, at: "" } as never,
      { client: "kappa", workflow: "reach.comments", node: "sort", with: {} },
    );
    expect(out).toEqual([{ port: "asked", event: expect.anything() }]);
    const [row] = await kappa.select().from(comments);
    expect(row).toMatchObject({ sort: "asked", state: "waiting" });
  });
});

describe("Reddit discovery per client", () => {
  it("reads for the client's own buyers, into its own database, metered", async () => {
    calls.length = 0;
    const out = await reads("kappa/daily");
    expect(out.stopped).toBeUndefined();
    expect(out.stats).toMatchObject({ judged: 1, stopped: null });
    expect(calls.every((c) => c.site === "reddit-public")).toBe(true);
    expect((await kappa.select().from(places)).map((p) => p.subreddit)).toEqual(["dentistry"]);
    expect(await pg.db.select().from(places)).toEqual([]);
    const used = await pg.db
      .select()
      .from(vendorUsage)
      .where(eq(vendorUsage.part, "reddit.discovery"));
    expect(used.length).toBe(calls.length);
  });

  it("never reads for Wren's buyers: no About, no pass", async () => {
    expect((await reads("lambda/daily")).stopped).toBe("say who its buyers are: set About");
  });
});

describe("sends", () => {
  it("wait on the client's live flag and the global gate, by kind", async () => {
    const c = await updateClient(pg.db, "kappa", { sends: ["reach.outreach"] });
    expect(clientSends(c, true)("manual")).toBe(true);
    expect(clientSends(c, true)("connect")).toBe(false);
    expect(clientSends(c, false)("manual")).toBe(false);
    await updateClient(pg.db, "kappa", { sends: [] });
  });
});
