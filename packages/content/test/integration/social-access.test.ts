/**
 * A client's own social accounts on Postgres and Restate with a fake X and a fake Meta
 * (designs/2026-10-07-client-social.md): Account → Social connects one with a one-time state, the
 * token lands in the key store under the client, a check reads who it is, a revoked grant breaks
 * it. Its content runs on the `social:` login. Its DMs come into its own Inbox, and a reply from
 * that Inbox goes through Ask to send and its approver, then out through its own account with a
 * touch written, only while its sends are on. Synthetic clients and ids only; no network.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, addMember, updateClient } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { clientSecrets } from "@wren/core/keys-schema";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { startTestRestate } from "@wren/core/testing";
import { touches } from "@wren/core/touches-schema";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { reachContacts, reachMessages } from "@wren/outreach";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientContent } from "../../src/clients.js";
import { liveConnections, loginOf, socialAccess } from "../../src/connect/access.js";
import { socialConsoleApi } from "../../src/connect/console.js";
import { liveFrom, SOCIAL } from "../../src/connect/platforms.js";
import { socialConnections } from "../../src/connect/schema.js";
import { socialChecks } from "../../src/connect/setups.js";
import { socialSites } from "../../src/connect/sites.js";
import { CONTENT_RECORDS } from "../../src/records.js";
import { makeInboxDesk } from "../../src/restate/inbox-desk.js";
import {
  type MarketingConsoleService,
  makeMarketingConsole,
} from "../../src/restate/marketing-console.js";
import { makeSocialInbox } from "../../src/restate/social-inbox.js";
import { askedReplyRecord, inboxRecord } from "../../src/social/records.js";

const TOKEN = "x-access-SYNTHETIC";
/** X, as far as these tests need it. */
const x = {
  revoked: false,
  dms: [] as { id: string; text: string; sender: string; at: string }[],
  sent: [] as { to: string; text: string; auth: string }[],
  asked: [] as string[],
};
const ME = "1001";
const LEE = "2002";
const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
  x.asked.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
  const auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
  if (url === SOCIAL.x.token) {
    const form = new URLSearchParams(String(init?.body ?? ""));
    if (form.get("grant_type") === "refresh_token" && x.revoked)
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({
      access_token: TOKEN,
      refresh_token: `rt-${x.asked.length}`,
      expires_in: 7200,
      scope: SOCIAL.x.scopes.join(" "),
    });
  }
  if (url === "https://api.x.com/2/users/me")
    return x.revoked
      ? Response.json({ title: "Unauthorized" }, { status: 401 })
      : Response.json({ data: { id: ME, name: "Kappa Dental", username: "kappadental" } });
  if (url.startsWith("https://api.x.com/2/dm_events"))
    return Response.json({
      data: x.dms.map((d) => ({
        id: d.id,
        text: d.text,
        created_at: d.at,
        sender_id: d.sender,
        dm_conversation_id: `${ME}-${LEE}`,
        event_type: "MessageCreate",
      })),
      includes: { users: [{ id: LEE, username: "lee_patient", name: "Lee" }] },
    });
  const to = /\/2\/dm_conversations\/with\/(\d+)\/messages$/.exec(url)?.[1];
  if (to && init?.method === "POST") {
    x.sent.push({ to, text: JSON.parse(String(init.body)).text, auth });
    return Response.json({ data: { dm_event_id: `ev-${x.sent.length}` } });
  }
  return new Response("{}", { status: 404 });
};

const ADMIN = "ada@wren.example.test";
const AMY = "amy@kappa.example.test"; // owner: acts, asks to send
const BO = "bo@kappa.example.test"; // member with a send grant
const VAL = "val@kappa.example.test"; // viewer
const products = { "marketing.stats": {}, "content.social": {}, "content.posting": {} };
const at = () => new Date();

let pg: TestPostgres;
let env: RestateTestEnvironment;
let kappa: Db;
let access: ReturnType<typeof socialAccess>;
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const apps = async () => ({ x: { id: "x-app", secret: "x-secret" } });
const accessOf = () =>
  socialAccess({
    main: pg.db,
    apps,
    keys: pgKeyStore(pg.db, throwawayRing()),
    origin: "https://app.test",
    fetch,
    live: liveFrom(""),
  });
const sitesOf = (): SiteClient =>
  socialSites({
    connection: access.connection,
    tokenOf: access.tokenOf,
    broke: access.broke,
    fetch,
  });

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "kappa", name: "Kappa", products });
  await addClient(pg.db, pg.url, { id: "lambda", name: "Lambda", products });
  await pg.db.execute(sql`insert into operators (email, role) values (${ADMIN}, 'admin')`);
  await addMember(pg.db, "kappa", AMY, { role: "owner" });
  await addMember(pg.db, "kappa", BO, { role: "member" });
  await addMember(pg.db, "kappa", VAL, { role: "viewer" });
  const { whoIs } = await import("@wren/core/portal");
  const { addGrant } = await import("@wren/core/grants");
  await addGrant(pg.db, await whoIs(pg.db, { email: ADMIN }), ADMIN, {
    email: BO,
    client: "kappa",
    verbs: ["effect"],
  });
  kappa = open("kappa");
  access = accessOf();
  env = await startTestRestate({
    services: [
      makeSocialInbox({
        main: pg.db,
        clientDb: open,
        access,
        sites: () => sitesOf(),
      }),
      makeInboxDesk({
        db: pg.db,
        clientDb: open,
        llm: new FakeLlm({ respond: () => '{"draft": "Thanks."}' }),
        senderName: "Will",
      }),
      makeMarketingConsole({
        db: pg.db,
        open: (c) => open(c.id),
        records: [...CONTENT_RECORDS, inboxRecord, askedReplyRecord],
      }),
    ],
    disableRetries: true,
  });
}, 240_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const inbox = () =>
  ingress().serviceClient<ReturnType<typeof makeSocialInbox>>({ name: "SocialInbox" });
const console_ = () =>
  ingress().serviceClient<MarketingConsoleService>({ name: "MarketingConsole" });
const api = () => socialConsoleApi({ main: pg.db, access });
const as = (email: string, client = "kappa") => ({ viewer: { email } as Viewer, client });
const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";

describe("connect", () => {
  it("a viewer can't connect; Wren's own accounts aren't here", async () => {
    await expect(api().connect({ ...as(VAL), platform: "x" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(api().connect({ ...as(ADMIN, "wren"), platform: "x" })).rejects.toBeInstanceOf(
      PortalRefusal,
    );
  });

  it("the page says each platform's state before anything connects", async () => {
    const v = await api().social(as(AMY));
    if (v.wren) throw new Error("not a client");
    const by = Object.fromEntries(v.platforms.map((p) => [p.platform, p]));
    expect(by.x).toMatchObject({ state: "not_connected", may: { connect: true } });
    expect(by.facebook).toMatchObject({ blocking: "Needs setup: Wren's Meta app" });
    expect(v.mayAct).toBe(true);
  });

  it("connect, land: the token is in the key store under the client, never in the row", async () => {
    const { url } = await api().connect({ ...as(AMY), platform: "x" });
    expect(url).toContain("code_challenge=");
    const state = stateOf(url);
    const out = await access.land({ platform: "x", state, code: "code-1" });
    expect(out).toMatchObject({
      ok: true,
      client: "kappa",
      said: "@kappadental is connected on X.",
    });
    // Used once.
    expect((await access.land({ platform: "x", state, code: "code-1" })).ok).toBe(false);
    const [c] = await liveConnections(pg.db, "kappa");
    expect(c).toMatchObject({ platform: "x", externalId: ME, handle: "kappadental" });
    expect(JSON.stringify(c)).not.toContain("rt-");
    const [secret] = await pg.db
      .select()
      .from(clientSecrets)
      .where(eq(clientSecrets.id, c?.tokenRef ?? ""));
    expect(secret?.client).toBe("kappa");
    expect(await liveConnections(pg.db, "lambda")).toEqual([]);
  });

  it("a denied sign-in says nothing was granted", async () => {
    const { url } = await api().connect({ ...as(AMY), platform: "x" });
    const out = await access.land({ platform: "x", state: stateOf(url), error: "access_denied" });
    expect(out).toMatchObject({ ok: false, said: expect.stringMatching(/Nothing was granted/) });
  });

  it("its content runs on the social: login, and its DMs are read", async () => {
    const [c] = await liveConnections(pg.db, "kappa");
    const plan = await clientContent(pg.db, "kappa", "content.social");
    expect(plan).toMatchObject({
      kind: "work",
      logins: { x: loginOf(c?.id ?? 0) },
      platforms: ["x"],
      dms: ["x"],
    });
    expect(await clientContent(pg.db, "lambda", "content.social")).toMatchObject({
      kind: "gone",
      why: "no social account connected",
    });
  });
});

describe("DMs into the client's Inbox", () => {
  it("read keeps their message once, with a theirs touch", async () => {
    x.dms = [{ id: "m1", text: "Do you take walk-ins?", sender: LEE, at: at().toISOString() }];
    expect(await inbox().read({ client: "kappa" })).toMatchObject({ accounts: 1, messages: 1 });
    expect(await inbox().read({ client: "kappa" })).toMatchObject({ messages: 0 });
    const [lee] = await kappa.select().from(reachContacts).where(eq(reachContacts.platform, "x"));
    expect(lee).toMatchObject({ handle: "lee_patient", state: "replied" });
    const t = await kappa.select().from(touches).where(eq(touches.direction, "theirs"));
    expect(t.map((r) => r.text)).toEqual(["Do you take walk-ins?"]);
    expect(await open("lambda").select().from(reachContacts)).toEqual([]);
  });

  it("while its sends are off, a reply is refused before X is asked", async () => {
    await updateClient(pg.db, "kappa", { approver: "client", sends: [] });
    const [lee] = await kappa.select().from(reachContacts);
    await expect(
      inbox().send({ client: "kappa", contactId: lee?.id ?? 0, body: "Yes, until 5." }),
    ).rejects.toThrow();
    expect(x.sent).toEqual([]);
  });

  it("the owner asks to send; a sender says yes; it goes through Kappa's own X", async () => {
    await updateClient(pg.db, "kappa", { approver: "client", sends: ["reach.outreach"] });
    const [lee] = await kappa.select().from(reachContacts);
    const thread = { thread: `dm:${lee?.id}`, channel: "dm" as const, target: String(lee?.id) };
    const asked = await console_().inboxReply({ ...as(AMY), ...thread, body: "Yes, until 5." });
    expect(asked).toMatchObject({ sent: false, asked: expect.any(Number) });
    expect(x.sent).toEqual([]);
    const [row] = (await askedReplyRecord.rows?.(kappa)) ?? [];
    expect(row).toMatchObject({ state: "waiting", who: "Lee" });
    await console_().inboxApprove({ ...as(BO), id: asked.asked as number });
    expect(x.sent).toEqual([{ to: LEE, text: "Yes, until 5.", auth: `Bearer ${TOKEN}` }]);
    const out = await kappa.select().from(reachMessages).where(eq(reachMessages.direction, "out"));
    expect(out).toMatchObject([{ state: "sent", ref: "ev-1", body: "Yes, until 5." }]);
    const ours = await kappa.select().from(touches).where(eq(touches.direction, "ours"));
    expect(ours).toMatchObject([{ kind: "dm", text: "Yes, until 5." }]);
  });

  it("a sender's own reply goes at once", async () => {
    const [lee] = await kappa.select().from(reachContacts);
    const thread = { thread: `dm:${lee?.id}`, channel: "dm" as const, target: String(lee?.id) };
    const out = await console_().inboxReply({ ...as(BO), ...thread, body: "See you then." });
    expect(out).toEqual({ sent: true, asked: null, why: null });
    expect(x.sent.at(-1)?.text).toBe("See you then.");
  });
});

describe("refresh and Broken", () => {
  it("the hourly check works, then breaks when X takes access back", async () => {
    const [c] = await liveConnections(pg.db, "kappa");
    if (!c) throw new Error("no connection");
    const check = socialChecks({ main: pg.db, access })["social.token"];
    const account = { id: c.accountId } as never;
    expect(await check?.({ account } as never)).toMatchObject({ ok: true });
    x.revoked = true;
    access = accessOf(); // a fresh worker: no token in memory, so it refreshes
    expect(await check?.({ account } as never)).toMatchObject({ ok: false });
    const [after] = await pg.db
      .select()
      .from(socialConnections)
      .where(eq(socialConnections.id, c.id));
    expect(after).toMatchObject({
      state: "broken",
      why: "Access was taken back. Connect it again.",
    });
    const v = await socialConsoleApi({ main: pg.db, access }).social(as(AMY));
    if (v.wren) throw new Error("not a client");
    expect(v.platforms.find((p) => p.platform === "x")?.state).toBe("broken");
    expect(await liveConnections(pg.db, "kappa")).toEqual([]);
  });

  it("disconnect deletes its token and its account", async () => {
    const [c] = await pg.db.select().from(socialConnections);
    await socialConsoleApi({ main: pg.db, access }).disconnect({ ...as(AMY), id: c?.id ?? 0 });
    expect(await pg.db.select().from(socialConnections)).toEqual([]);
    const [s] = await pg.db
      .select()
      .from(clientSecrets)
      .where(eq(clientSecrets.id, c?.tokenRef ?? ""));
    expect(s?.state).not.toBe("live");
  });
});
