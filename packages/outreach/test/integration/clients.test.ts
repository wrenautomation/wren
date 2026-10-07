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
import { touchStep } from "../../src/follow.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import type { DiscoveryStats } from "../../src/restate/discovery.js";
import { makeRedditReads } from "../../src/restate/discovery.js";
import {
  makeReachSender,
  makeReachWatch,
  type ReachDeps,
  type WatchStats,
} from "../../src/restate/index.js";
import {
  comments,
  redditPlaces as places,
  reachAccounts,
  reachContacts,
  reachMessages,
} from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";
import type { TickStats } from "../../src/tick.js";

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
      "reach.outreach": {},
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
      // Live globally: only the client's own flag holds its DMs.
      makeReachSender({ ...deps, live: true, clock: () => new Date(NOW_S * 1000) }),
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
    const step = sortStep(
      pg.db,
      new FakeLlm({
        respond: () => {
          throw new Error("Wren's model never reads a client's comment");
        },
      }),
      undefined,
      async () => ({
        db: kappa,
        llm: null,
      }),
    );
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

describe("the DM step per client", () => {
  it("reads the contact in the client's database, never Wren's", async () => {
    const [c] = await kappa
      .insert(reachContacts)
      .values({
        platform: "reddit",
        handle: "kappa_reader",
        url: "https://reddit.test/u/kappa_reader",
        foundIn: "r/dentistry",
        state: "replied",
      })
      .returning({ id: reachContacts.id });
    const step = touchStep(pg.db, { sequences: REACH_SEQUENCES, sender: "Test" }, open);
    const e = { kind: "lead", subject: `lead:reach:${c?.id}`, data: { contactId: c?.id } };
    const at = (client: string | null) => ({
      client,
      workflow: "dm",
      node: "s1",
      with: { step: 1 },
    });
    // Kappa's contact answered: the cadence stops on its reply.
    expect(await step("in", e as never, at("kappa"))).toEqual([
      { port: "replied", event: expect.objectContaining({ kind: "reply" }) },
    ]);
    // The same id in Wren's database is no one.
    expect(await step("in", e as never, at(null))).toEqual([]);
    // A client's step with no client databases here fails loud.
    await expect(
      touchStep(pg.db, { sequences: REACH_SEQUENCES, sender: "Test" })(
        "in",
        e as never,
        at("kappa"),
      ),
    ).rejects.toThrow("no database for kappa's DMs here");
  });
});

describe("the DM sender per client", () => {
  const tick = (key: string) =>
    ingress()
      .objectClient<ReturnType<typeof makeReachSender>>({ name: "ReachSender" }, key)
      .sync() as Promise<PassOutcome<TickStats>>;

  it("missing: a client without Social outreach or a login stops", async () => {
    expect((await tick("lambda/fleet")).stopped).toBe(
      "none of reach.outreach, linkedin.invites is installed",
    );
    await updateClient(pg.db, "mu", { products: { "comments.read": {}, "reach.outreach": {} } });
    expect((await tick("mu/fleet")).stopped).toBe("no login connected");
  });

  it("holds a client's DMs in its own database while its sends are off", async () => {
    const [account] = await kappa.select().from(reachAccounts);
    const [c] = await kappa
      .insert(reachContacts)
      .values({
        platform: "reddit",
        handle: "kappa_lead",
        url: "https://reddit.test/u/kappa_lead",
        foundIn: "r/dentistry",
        state: "enrolled",
      })
      .returning({ id: reachContacts.id });
    await kappa.insert(reachMessages).values({
      contactId: c?.id ?? 0,
      accountId: account?.id ?? null,
      direction: "out",
      kind: "manual",
      body: "Hi, saw your post on billing",
      state: "queued",
    });
    calls.length = 0;
    const out = await tick("kappa/fleet");
    expect(out.stopped).toBeUndefined();
    expect(out.stats).toMatchObject({ sent: 0, held: { gated: 1 } });
    expect(calls.filter((x) => x.path.includes("compose"))).toEqual([]);
    expect((await kappa.select().from(reachMessages)).map((m) => m.state)).toEqual(["queued"]);
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
