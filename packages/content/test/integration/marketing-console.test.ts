/**
 * A client's Marketing in the portal (designs/2026-10-07-per-client-runs.md): its records come
 * from its own database once `marketing.stats` is installed; two clients never mix; a draft's
 * verdict is its approver's, to `ContentDesk/<client>/desk`; a redraft waits on its own model
 * gate. A promo of its YouTube post: its approver's, on its own gate and logins, drafts that wait
 * in its To approve and link its own video straight. Synthetic clients and drafts only.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, addMember, addOperator, updateClient } from "@wren/core/clients";
import { startTestRestate } from "@wren/core/testing";
import { setManaged } from "@wren/core/vendors";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFunnel } from "../../src/funnel.js";
import { addIdea, contentDrafts } from "../../src/index.js";
import { CONTENT_RECORDS } from "../../src/records.js";
import { makeContentDesk } from "../../src/restate/desk.js";
import {
  type MarketingConsoleService,
  makeMarketingConsole,
  marketingConsoleApi,
} from "../../src/restate/marketing-console.js";

// Only a promo's LinkedIn brief is answered: every other call would be a model asked past a gate.
const llm = new FakeLlm({
  respond: (prompt) => {
    if (prompt.includes("a LinkedIn post that sends people to watch a new YouTube video"))
      return '{"text": "Most demos bury the point.\\n\\nThe full walkthrough is in the video."}';
    throw new Error("no model is asked without the client's gate");
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
let kappa: Db;
let lambda: Db;
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const operator = { viewer: { email: "op@example.test", operator: true } };
const member = (email: string) => ({ viewer: { email } });
const products = {
  "marketing.stats": {},
  "content.planner": { about: "dental billing for small practices" },
};

/** One waiting LinkedIn draft in this client's database; its id. */
async function draft(db: Db, text: string): Promise<string> {
  const idea = await addIdea(db, text, "cli");
  const [row] = await db
    .insert(contentDrafts)
    .values({ ideaId: idea.id, platform: "linkedin", text, status: "draft", promptVersion: "test" })
    .returning({ id: contentDrafts.id });
  if (!row) throw new Error("no draft");
  return row.id;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "kappa",
    name: "Kappa",
    accounts: { linkedin: "linkedin@kappa" },
    products,
  });
  await addClient(pg.db, pg.url, { id: "lambda", name: "Lambda", products });
  await addClient(pg.db, pg.url, { id: "mu", name: "Mu", products: { "content.posting": {} } });
  await addClient(pg.db, pg.url, {
    id: "omicron",
    name: "Omicron",
    accounts: { linkedin: "linkedin@omicron" },
    products: {
      ...products,
      "content.planner": { about: "demo videos for small software teams" },
    },
  });
  await setManaged(pg.db, {
    client: "omicron",
    vendor: "models",
    perDay: 100,
    capCents: 500,
    by: "test",
  });
  await addMember(pg.db, "omicron", "oli@omicron.test", { role: "owner" });
  await addMember(pg.db, "kappa", "amy@kappa.test", { role: "owner" });
  await addMember(pg.db, "lambda", "lee@lambda.test", { role: "owner" });
  await addOperator(pg.db, "op@example.test");
  kappa = open("kappa");
  lambda = open("lambda");
  env = await startTestRestate({
    services: [
      makeContentDesk({
        db: pg.db,
        llm,
        platforms: ["linkedin"],
        zone: "UTC",
        clients: { clientDb: open, llm },
      }),
      makeMarketingConsole({ db: pg.db, open: (c) => open(c.id), records: CONTENT_RECORDS }),
    ],
    disableRetries: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const api = () =>
  marketingConsoleApi({ db: pg.db, open: (c) => open(c.id), records: CONTENT_RECORDS });
const svc = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<MarketingConsoleService>({ name: "MarketingConsole" });
const states = async (db: Db) =>
  (await db.select({ text: contentDrafts.text, status: contentDrafts.status }).from(contentDrafts))
    .map((d) => `${d.text}: ${d.status}`)
    .sort();

describe("a client's Marketing numbers", () => {
  it("missing: not installed says so", async () => {
    await expect(api().recordsTypes({ ...operator, client: "mu" })).rejects.toMatchObject({
      status: 404,
      message: "Marketing numbers is not installed",
    });
  });

  it("one client: its own drafts, from its own database", async () => {
    await draft(kappa, "Kappa cut denials by a third");
    const types = await api().recordsTypes({ ...operator, client: "kappa" });
    expect(types.map((t) => t.id)).toEqual(["marketing.draft", "marketing.post"]);
    const page = await api().recordsList({
      ...member("amy@kappa.test"),
      client: "kappa",
      record: "marketing.draft",
    });
    expect(page.total).toBe(1);
    // Another client's people never read it.
    await expect(
      api().recordsList({
        ...member("lee@lambda.test"),
        client: "kappa",
        record: "marketing.draft",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("two clients: each sees only its own", async () => {
    await draft(lambda, "Lambda closed its books in a day");
    const of = async (client: string) =>
      (await api().recordsList({ ...operator, client, record: "marketing.draft" })).total;
    expect([await of("kappa"), await of("lambda")]).toEqual([1, 1]);
  });
});

describe("a draft's verdict", () => {
  it("gate stop: Wren approves by default, so the client's own login can't", async () => {
    const [id] = (await kappa.select({ id: contentDrafts.id }).from(contentDrafts)).map(
      (d) => d.id,
    );
    await expect(
      svc().approveDraft({ ...member("amy@kappa.test"), client: "kappa", ids: [String(id)] }),
    ).rejects.toThrow("Wren's team approves these");
    expect(await states(kappa)).toEqual(["Kappa cut denials by a third: draft"]);
  });

  it("Wren's team approves into the client's database; the other client's stays", async () => {
    const [id] = (await kappa.select({ id: contentDrafts.id }).from(contentDrafts)).map(
      (d) => d.id,
    );
    const out = await svc().approveDraft({ ...operator, client: "kappa", ids: [String(id)] });
    expect(out).toEqual({ done: [id] });
    expect(await states(kappa)).toEqual(["Kappa cut denials by a third: approved"]);
    expect(await states(lambda)).toEqual(["Lambda closed its books in a day: draft"]);
    // Twice: the desk's refusal is the viewer's answer.
    await expect(
      svc().approveDraft({ ...operator, client: "kappa", ids: [String(id)] }),
    ).rejects.toThrow();
  });

  it("a client that approves its own: its login decides, Wren's team doesn't", async () => {
    await updateClient(pg.db, "lambda", { approver: "client" });
    const [id] = (await lambda.select({ id: contentDrafts.id }).from(contentDrafts)).map(
      (d) => d.id,
    );
    await expect(
      svc().rejectDraft({ ...operator, client: "lambda", ids: [String(id)] }),
    ).rejects.toThrow("the client approves these");
    await svc().rejectDraft({ ...member("lee@lambda.test"), client: "lambda", ids: [String(id)] });
    expect(await states(lambda)).toEqual(["Lambda closed its books in a day: rejected"]);
  });

  it("a redraft waits on the client's own model gate", async () => {
    const id = await draft(kappa, "Kappa again");
    await expect(
      svc().redraft({ ...operator, client: "kappa", draftId: id, note: "shorter" }),
    ).rejects.toThrow(/models: /);
    await expect(
      svc().redraft({ ...operator, client: "kappa", draftId: id, note: " " }),
    ).rejects.toThrow("say what to change");
  });
});

describe("a client's promo", () => {
  /** A YouTube video in the client's database, up; its id. */
  async function youtube(db: Db, status: "published" | "draft" = "published"): Promise<string> {
    const idea = await addIdea(db, "How I cut a demo to the part that matters", "cli");
    const [row] = await db
      .insert(contentDrafts)
      .values({
        ideaId: idea.id,
        platform: "youtube",
        title: "How I cut a demo to the part that matters",
        text: "Most demos bury the point. This one shows how I cut to it.",
        status,
        url: status === "published" ? "https://www.youtube.com/watch?v=synthetic02" : null,
        promptVersion: "test",
        stage: "trust",
      })
      .returning({ id: contentDrafts.id });
    if (!row) throw new Error("no video");
    return row.id;
  }

  it("gate stop: only its approver, only a video up, only on its own model gate", async () => {
    const omicron = open("omicron");
    const id = await youtube(omicron);
    await expect(
      svc().promote({ ...member("oli@omicron.test"), client: "omicron", draftId: id }),
    ).rejects.toThrow("Wren's team approves these");
    const post = await draft(omicron, "Omicron shipped a faster demo");
    await expect(svc().promote({ ...operator, client: "omicron", draftId: post })).rejects.toThrow(
      /isn't a YouTube draft/,
    );
    const waiting = await youtube(omicron, "draft");
    await expect(
      svc().promote({ ...operator, client: "omicron", draftId: waiting }),
    ).rejects.toThrow(/approve it for YouTube first/);
    await expect(
      svc().promote({ ...operator, client: "omicron", draftId: "not-a-draft" }),
    ).rejects.toThrow("pick a YouTube post first");
    const k = await youtube(kappa);
    await expect(svc().promote({ ...operator, client: "kappa", draftId: k })).rejects.toThrow(
      /models: /,
    );
  });

  it("drafts on its own logins into its To approve, linking its own video straight", async () => {
    const omicron = open("omicron");
    const id = await youtube(omicron);
    const out = await svc().promote({ ...operator, client: "omicron", draftId: id });
    expect(out).toEqual({ started: true, platforms: ["linkedin"] });
    let promos: (typeof contentDrafts.$inferSelect)[] = [];
    for (let i = 0; i < 60 && !promos.length; i++) {
      await new Promise((r) => setTimeout(r, 250));
      promos = await omicron.select().from(contentDrafts).where(eq(contentDrafts.videoDraft, id));
    }
    expect(promos).toHaveLength(1);
    const [li] = promos;
    if (!li) throw new Error("no promo");
    expect(li).toMatchObject({ platform: "linkedin", status: "draft", stage: "reach" });
    expect(await readFunnel(omicron, li)).toMatchObject({
      posts: "https://www.youtube.com/watch?v=synthetic02",
      note: null,
    });
    // Nothing else of Wren's: no promo in Wren's own database, none in another client's.
    expect(
      await pg.db.select().from(contentDrafts).where(eq(contentDrafts.videoDraft, id)),
    ).toHaveLength(0);
  });
});
