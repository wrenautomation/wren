/**
 * Inbox health per client (designs/2026-10-07-per-client-runs.md): a client's Postmaster pull
 * reads only its own sending domains its setup verified, into its own database; two clients never
 * mix; no domain or none verified stops the pass and says why. Synthetic domains only.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf, loadSettings } from "@wren/config";
import { addClient } from "@wren/core/clients";
import type { PassOutcome } from "@wren/core/restate";
import { addAccount, markStep } from "@wren/core/setup";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostmasterClient, PostmasterStats } from "../../src/inbox/postmaster.js";
import {
  clientPostmaster,
  domainsOf,
  makePostmasterScheduler,
  type PostmasterScheduler,
} from "../../src/restate/postmaster-scheduler.js";
import { postmasterDays } from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { DOMAIN_SETUP } from "../../src/setups.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);
const asked: string[] = [];
/** Every domain answers one day; the domain asked is noted. */
const postmaster: PostmasterClient = {
  fetch: async (url) => {
    asked.push(new URL(url).pathname.split("/domains/")[1]?.split("/")[0] ?? "");
    return Response.json({
      domainStats: [
        {
          metric: "spam_rate",
          date: { year: 2026, month: 10, day: 6 },
          value: { doubleValue: 0.001 },
        },
      ],
    });
  },
  token: async () => "t",
  sleep: async () => {},
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));

/** A domain account for the client, with Postmaster marked verified when `ok`. */
async function domain(client: string, ref: string, ok: boolean) {
  const a = await addAccount(pg.db, { client, site: "domain", ref, by: "test" });
  if (ok) await markStep(pg.db, DOMAIN_SETUP, { accountId: a.id, step: "postmaster", by: "test" });
}

beforeAll(async () => {
  pg = await startTestPostgres();
  const health = { "email.sequences": {}, "email.inbox_health": {} };
  await addClient(pg.db, pg.url, {
    id: "kappa",
    name: "Kappa",
    accounts: { postmaster: "kappa-mail.test, Kappa-Two.test" },
    products: health,
  });
  await addClient(pg.db, pg.url, {
    id: "lambda",
    name: "Lambda",
    accounts: { postmaster: "lambda-mail.test" },
    products: health,
  });
  await addClient(pg.db, pg.url, { id: "mu", name: "Mu", products: health });
  await addClient(pg.db, pg.url, {
    id: "nu",
    name: "Nu",
    accounts: { postmaster: "nu-mail.test" },
    products: health,
  });
  await domain("kappa", "kappa-mail.test", true);
  await domain("kappa", "kappa-two.test", false);
  await domain("lambda", "lambda-mail.test", true);
  await domain("nu", "nu-mail.test", false);
  env = await startTestRestate({
    services: [
      makePostmasterScheduler({
        db: pg.db,
        client: postmaster,
        domains: ["wren-mail.test"],
        policy: POLICY,
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

type Out = PassOutcome<PostmasterStats & { not_verified: string[] }>;
const pull = (key: string) =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<PostmasterScheduler>({ name: "PostmasterScheduler" }, key)
    .sync() as Promise<Out>;
const days = (id: string) =>
  open(id).select({ domain: postmasterDays.domain }).from(postmasterDays);

describe("a client's sending domains", () => {
  it("are comma separated, lower case, once each", () => {
    expect(domainsOf(" A.test,b.test,a.test, ")).toEqual(["a.test", "b.test"]);
    expect(domainsOf(undefined)).toEqual([]);
  });

  it("missing: no domain connected stops the pass", async () => {
    expect(await clientPostmaster(pg.db, "mu")).toEqual({
      kind: "gone",
      why: "no sending domain connected",
    });
    asked.length = 0;
    expect((await pull("mu/daily")).stopped).toBe("no sending domain connected");
    expect(asked).toEqual([]);
  });

  it("not verified: the setup's fact gates the read", async () => {
    asked.length = 0;
    expect((await pull("nu/daily")).stopped).toBe("not verified in Postmaster yet: nu-mail.test");
    expect(asked).toEqual([]);
  });
});

describe("the Postmaster pull per client", () => {
  it("one client: only its verified domains, into its own database", async () => {
    asked.length = 0;
    const out = await pull("kappa/daily");
    expect(out.stopped).toBeUndefined();
    expect(out.stats).toMatchObject({ domains: 1, stored: 1, not_verified: ["kappa-two.test"] });
    expect(asked).toEqual(["kappa-mail.test"]);
    expect(await days("kappa")).toEqual([{ domain: "kappa-mail.test" }]);
    expect(await pg.db.select().from(postmasterDays)).toEqual([]);
  });

  it("two clients: each into its own database", async () => {
    await pull("lambda/daily");
    expect(await days("lambda")).toEqual([{ domain: "lambda-mail.test" }]);
    expect(await days("kappa")).toEqual([{ domain: "kappa-mail.test" }]);
  });
});
