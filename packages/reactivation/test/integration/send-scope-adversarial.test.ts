/**
 * The real SendScheduler under a client's send scope, routed the way the
 * worker routes it: `<client>/<mailbox>` to the client's own database, a bare
 * address to Wren's. Whose mail goes out, from which database, and does the
 * loop stop the moment the client can't send.
 */
import * as ingress from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ConsoleTransport, SendPolicy } from "@wren/channel-email";
import { makeSendScheduler, oneScope, type SendScheduler } from "@wren/channel-email/restate";
import { loadSettings } from "@wren/config";
import { addClient, updateClient } from "@wren/core/clients";
import { clientOfKey } from "@wren/core/restate";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clientSendScope } from "../../src/sending.js";

const ANN = "ann@acme-talent.example";
const OPEN = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    WREN_SEND_WINDOW_START: "00:00",
    WREN_SEND_WINDOW_END: "23:59",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1000",
  }),
);
const block = (extra: Record<string, unknown>) => ({
  reactivation: { on: true, senders: [{ address: ANN, name: "Ann Lee" }], ...extra },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
let acmeDb: Db;
const transport = new ConsoleTransport({ write: () => {} });

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "acme",
    name: "Acme",
    products: block({ stages: { send: true } }),
  });
  acmeDb = cachedDb(clientDatabaseUrl(pg.url, "wren_client_acme"));
  const clients = {
    main: pg.db,
    open: (c: { database: string }) => cachedDb(clientDatabaseUrl(pg.url, c.database)),
    policy: OPEN,
  };
  // Wren's own fleet also lists Ann, so a bare key for her would send Wren's mail, never acme's.
  const wren = oneScope({
    db: pg.db,
    policy: OPEN,
    fleet: { senders: [ANN], domainFleet: [ANN], fromNames: {}, signatureHtml: {}, pages: {} },
  });
  env = await RestateTestEnvironment.start({
    services: [
      makeSendScheduler({
        transport,
        scopeOf: (key) => (clientOfKey(key) ? clientSendScope(clients, key) : wren(key)),
        tickMs: 60_000,
      }),
    ],
    alwaysReplay: true,
  });
}, 120_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

let leads = 0;
/** An approved opener from Ann in `db`. */
async function approvedOpener(db: Db): Promise<number> {
  leads += 1;
  const to = `lead${leads}@lead${leads}.example`;
  const [c] = await db.execute<{ id: number }>(sql`
    insert into companies (domain, name, niche, raw)
    values (${`lead${leads}.example`}, ${`Lead ${leads}`}, 'agencies', '{}'::jsonb) returning id`);
  const [p] = await db.execute<{ id: number }>(sql`
    insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw)
    values (${c?.id}, ${`Lead ${leads}`}, false, 'website', ${`lead${leads}`}, '{}'::jsonb)
    returning id`);
  const [e] = await db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${p?.id}, ${c?.id}, 'reactivation', 'reactivation', '{"steps":[{"day":0}]}'::jsonb,
      'reactivation', 'active', 'person', ${to}, ${ANN})
    returning id`);
  await db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state, approved_at, approved_by)
    values (${e?.id}, 0, 'opener', 'v1', ${to}, 'hello', 'hi', '{}'::jsonb, 'approved', now(), 'client')`);
  return e?.id ?? 0;
}
const stateOf = async (db: Db, enrollment: number) =>
  (
    await db.execute<{ state: string }>(
      sql`select state from messages where enrollment_id = ${enrollment}`,
    )
  )[0]?.state;
const scheduler = (key: string) =>
  ingress
    .connect({ url: env.baseUrl() })
    .objectClient<SendScheduler>({ name: "SendScheduler" }, key);

describe("a client mailbox's send loop", () => {
  it("sends the client's mail from the client's database, and a bare key never does", async () => {
    const theirs = await approvedOpener(acmeDb);
    const wrens = await approvedOpener(pg.db);

    const bare = await scheduler(ANN).tick();
    expect(bare?.stats.sent).toBe(1);
    expect(await stateOf(pg.db, wrens)).toBe("sent");
    expect(await stateOf(acmeDb, theirs)).toBe("approved");

    const client = await scheduler(`acme/${ANN}`).tick();
    expect(client?.stats.sent).toBe(1);
    expect(await stateOf(acmeDb, theirs)).toBe("sent");
    // The ledger row lands in the client's database, named by the mailbox alone.
    const [run] = await acmeDb.execute<{ argv: unknown }>(
      sql`select argv from runs where command = 'send tick' order by started_at desc limit 1`,
    );
    expect(run?.argv).toEqual({ sender: ANN });
  });

  it("a key in capitals is the same mailbox", async () => {
    const theirs = await approvedOpener(acmeDb);
    const out = await scheduler(`acme/${ANN.toUpperCase()}`).tick();
    expect(out).not.toBeNull();
    // The gap after the last test's send holds it; it is Ann's, not unrostered.
    expect(out?.stats.sender_not_on_roster).toBe(0);
    expect(await stateOf(acmeDb, theirs)).toBe("approved");
  });

  it("sending turned off: the running loop stops itself and sends nothing", async () => {
    await scheduler(`acme/${ANN}`).start();
    await updateClient(pg.db, "acme", { products: block({ stages: { send: false } }) });
    const held = await approvedOpener(acmeDb);
    // The next tick (the loop's own, or this one) finds no scope.
    expect(await scheduler(`acme/${ANN}`).tick()).toBeNull();
    await vi.waitFor(
      async () => expect((await scheduler(`acme/${ANN}`).status()).running).toBe(false),
      {
        timeout: 10_000,
        interval: 200,
      },
    );
    expect(await stateOf(acmeDb, held)).toBe("approved");
    expect((await scheduler(`acme/${ANN}`).status()).onRoster).toBe(false);
  });

  it("a key for a client that doesn't exist never opens a database", async () => {
    expect(await scheduler(`ghost/${ANN}`).tick()).toBeNull();
  });
});
