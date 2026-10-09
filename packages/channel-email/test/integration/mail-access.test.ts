/**
 * Mail access on Postgres with fake Google, Microsoft, Gmail and Graph (designs/2026-10-07-mail-
 * access.md): a client adds a mailbox, connects it through a one-time state, the token lands in
 * the key store, the checks read, a revoked grant breaks it, and an admin's consent is kept per
 * tenant. A client sees only its own. Synthetic clients only; no network.
 */

import { clientMembers, clients } from "@wren/core/clients";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { clientSecretEvents, clientSecrets } from "@wren/core/keys-schema";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { accountsOf } from "@wren/core/setup";
import { accountFacts } from "@wren/core/setup-schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FACTS, mailAccess } from "../../src/access/access.js";
import { mailConsoleApi } from "../../src/access/console.js";
import { GMAIL_READ, GMAIL_SEND } from "../../src/access/oauth.js";
import { mailChecks } from "../../src/access/setups.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  keys = pgKeyStore(pg.db, throwawayRing());
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Dental", database: "wren_client_acme" },
    { id: "beta", name: "Beta Roofing", database: "wren_client_beta" },
  ]);
  await pg.db.insert(clientMembers).values([
    { clientId: "acme", email: "amy@acme.example", role: "owner" },
    { clientId: "acme", email: "val@acme.example", role: "viewer" },
    { clientId: "beta", email: "bo@beta.example", role: "owner" },
  ]);
}, 240_000);
afterAll(() => pg?.stop());

const TENANT = "0b6f3a52-1c1e-4f0e-9d8a-2a7c1d3e4f50";
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

/** Google, Microsoft, Gmail and Graph, as far as these tests need them. */
const fake = {
  /** Who the next exchange signs in as, and what it grants. */
  signedIn: "ann@acme.example",
  scope: `openid email ${GMAIL_READ} ${GMAIL_SEND}`,
  revoked: false,
  consented: true,
  asked: [] as string[],
  /** Each send: the URL and its JSON body. */
  sent: [] as { url: string; body: unknown }[],
  /** The next send answers 403, as a send scope taken back does. */
  refuseSend: false,
};
const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
  fake.asked.push(url);
  if (
    init?.method === "POST" &&
    (url.endsWith("/messages/send") || url.startsWith("https://graph.microsoft.com/"))
  ) {
    if (fake.refuseSend)
      return Response.json({ error: { message: "Insufficient Permission" } }, { status: 403 });
    fake.sent.push({ url, body: JSON.parse(String(init.body)) });
    return url.endsWith("/messages/send")
      ? Response.json({ id: "s1", threadId: "t1" })
      : new Response(null, { status: 202 });
  }
  const form = new URLSearchParams(String(init?.body ?? ""));
  if (url === "https://oauth2.googleapis.com/token" || url.includes("/oauth2/v2.0/token")) {
    const ms = url.includes("microsoftonline");
    if (form.get("grant_type") === "client_credentials")
      return fake.consented
        ? Response.json({ access_token: "app-token", expires_in: 3600 })
        : Response.json(
            { error: "unauthorized_client", error_description: "AADSTS700016: not found" },
            { status: 400 },
          );
    if (form.get("grant_type") === "refresh_token" && fake.revoked)
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({
      access_token: `at-${fake.asked.length}`,
      refresh_token: ms || form.get("grant_type") === "authorization_code" ? "rt-new" : undefined,
      expires_in: 3600,
      scope: fake.scope,
      id_token: jwt(
        ms
          ? { preferred_username: fake.signedIn, tid: TENANT }
          : { email: fake.signedIn, hd: "acme.example" },
      ),
    });
  }
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?"))
    return Response.json({ messages: [{ id: "m1" }] });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1"))
    return Response.json({
      id: "m1",
      threadId: "t1",
      snippet: "Can you send a quote?",
      internalDate: "1791000000000",
      payload: { headers: [{ name: "From", value: "Lee <lee@patient.example>" }] },
    });
  if (url.startsWith("https://graph.microsoft.com/")) return Response.json({ value: [] });
  return new Response("no", { status: 404 });
};

let at = new Date("2026-10-07T12:00:00Z");
let keys: ReturnType<typeof pgKeyStore>;
const apps = async () => ({
  google: { id: "g-id", secret: "g-secret" },
  microsoft: { id: "m-id", secret: "m-secret" },
});
const access = () =>
  mailAccess({
    main: pg.db,
    apps,
    keys,
    origin: "https://app.test",
    fetch,
    now: () => at,
  });
let acc: ReturnType<typeof access>;
const api = () =>
  mailConsoleApi({ main: pg.db, access: acc, clientDb: () => pg.db, now: () => at });
const checks = () => mailChecks({ main: pg.db, apps, access: acc, fetch });

const AMY: Viewer = { email: "amy@acme.example" };
const VAL: Viewer = { email: "val@acme.example" };
const BO: Viewer = { email: "bo@beta.example" };
const refused = async (p: Promise<unknown>, status: number, says?: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
  if (says) expect((err as Error).message).toMatch(says);
};
const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";
const account = async (client: string, ref: string) => {
  const a = (await accountsOf(pg.db, client)).find((x) => x.ref === ref);
  if (!a) throw new Error(`no ${ref}`);
  return a;
};

describe("Google Workspace", () => {
  it("a mailbox to read starts its own setup and its domain's trust step", async () => {
    acc = access();
    await refused(
      api().addMailbox({
        viewer: VAL,
        client: "acme",
        address: "ann@acme.example",
        provider: "google",
        want: "read",
      }),
      403,
    );
    const { emits } = await api().addMailbox({
      viewer: AMY,
      client: "acme",
      address: "Ann@Acme.example",
      provider: "google",
      want: "read",
    });
    expect(emits.map((e) => e.workflow).sort()).toEqual(["setup.google_mail", "setup.mailbox"]);
    const page = await api().mail({ viewer: AMY, client: "acme" });
    if (page.wren) throw new Error("not Wren's");
    expect(page.mailboxes).toMatchObject([
      { address: "ann@acme.example", state: "waiting_admin", want: "read" },
    ]);
    expect(page.orgs[0]).toMatchObject({ domain: "acme.example", ready: false, readers: 1 });
    expect(page.googleClientId).toBe("g-id");
    expect(JSON.stringify(page)).not.toContain("g-secret");
  });

  it("a client sees and touches only its own", async () => {
    await refused(api().mail({ viewer: BO, client: "acme" }), 403);
    const ann = await account("acme", "ann@acme.example");
    await refused(
      api().connect({ viewer: BO, client: "beta", account: ann.id, want: "read" }),
      404,
    );
  });

  it("connects through a one-time state; the token goes to the key store", async () => {
    const ann = await account("acme", "ann@acme.example");
    const { url } = await api().connect({
      viewer: AMY,
      client: "acme",
      account: ann.id,
      want: "read",
    });
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("hd=acme.example");
    const state = stateOf(url);
    // Signed in as someone else: refused, and the state is spent.
    fake.signedIn = "eve@acme.example";
    const wrong = await acc.land({ provider: "google", state, code: "c1" });
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.said).toMatch(/not ann@acme.example/);
    expect((await acc.land({ provider: "google", state, code: "c1" })).said).toMatch(/expired/);

    fake.signedIn = "ann@acme.example";
    const again = await api().connect({
      viewer: AMY,
      client: "acme",
      account: ann.id,
      want: "read",
    });
    const out = await acc.land({ provider: "google", state: stateOf(again.url), code: "c2" });
    expect(out).toMatchObject({ ok: true, client: "acme" });
    expect(out.said).toBe("ann@acme.example is connected to read and send.");
    const [row] = await pg.db.select().from(clientSecrets);
    expect(row).toMatchObject({ client: "acme", state: "live" });
    expect(row?.name).toMatch(/^MAIL_GOOGLE_[0-9A-F]{16}$/);
    expect(Buffer.from(row?.sealed ?? []).includes(Buffer.from("rt-new"))).toBe(false);
    const saved = await keys.get({ ref: row?.id ?? "", client: "acme", by: "test", why: "test" });
    expect(JSON.parse(saved ?? "{}").refresh).toBe("rt-new");
    const c = await acc.connectionOf(ann.id);
    expect(c).toMatchObject({ access: "read", state: "connected", tokenName: row?.id });
    expect(JSON.stringify(c)).not.toContain("rt-new");
    const events = await pg.db.select().from(clientSecretEvents);
    expect(events.map((e) => e.op)).toEqual(["put", "read"]);
    expect(JSON.stringify(events)).not.toContain("rt-new");
  });

  it("the checks: trust by a test read, the token by a read", async () => {
    const org = await account("acme", "acme.example");
    const ann = await account("acme", "ann@acme.example");
    const trust = await checks()["google.mail_trust"]?.({ account: org, now: at });
    expect(trust).toMatchObject({ ok: true, why: "A read works on ann@acme.example" });
    const token = await checks()["mailbox.token"]?.({ account: ann, now: at });
    expect(token).toMatchObject({ ok: true, why: "Reads and sends" });
    const page = await api().mail({ viewer: AMY, client: "acme" });
    if (page.wren) throw new Error("not Wren's");
    expect(page.mailboxes[0]?.state).toBe("read_send");
  });

  it("the reader's mailbox reads headers on the stored token", async () => {
    const [box] = await acc.boxesOf("acme");
    expect(await acc.readingClients()).toEqual(["acme"]);
    expect(box?.address).toBe("ann@acme.example");
    expect(await box?.search("in:inbox after:1")).toEqual(["m1"]);
    expect(await box?.meta("m1")).toMatchObject({ fromAddress: "lee@patient.example" });
  });

  it("a reply goes out through the mailbox, in Gmail's thread", async () => {
    const box = await acc.senderOf("acme", "Ann@acme.example");
    const out = await box.reply(
      { messageId: "m1", threadId: "t1", to: "lee@patient.example", subject: "Quote" },
      "A crown runs $1,200.",
      "<ours@acme.example>",
    );
    expect(out).toEqual({ id: "s1", threadId: "t1" });
    const [send] = fake.sent;
    expect(send?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const { raw, threadId } = (send?.body ?? {}) as { raw: string; threadId: string };
    expect(threadId).toBe("t1");
    const mime = Buffer.from(raw, "base64url").toString();
    expect(mime).toContain("From: ann@acme.example");
    expect(mime).toContain("Subject: Re: Quote");
  });

  it("a refused send breaks the mailbox with why", async () => {
    fake.refuseSend = true;
    const box = await acc.senderOf("acme", "ann@acme.example");
    const to = { messageId: "m1", threadId: "t1", to: "lee@patient.example", subject: "Quote" };
    await expect(box.reply(to, "Yes.", "<o2@acme.example>")).rejects.toThrow(/403/);
    fake.refuseSend = false;
    const ann = await account("acme", "ann@acme.example");
    expect(await acc.connectionOf(ann.id)).toMatchObject({
      state: "broken",
      why: "Sending was refused. Connect it again.",
    });
    await expect(acc.senderOf("acme", "ann@acme.example")).rejects.toThrow(
      "Needs setup: ann@acme.example needs connecting again.",
    );
    await expect(acc.senderOf("acme", "nobody@acme.example")).rejects.toThrow(
      "Needs setup: nobody@acme.example isn't connected to send.",
    );
    // Another client never sends from it.
    await expect(acc.senderOf("beta", "ann@acme.example")).rejects.toThrow(/Needs setup/);
    await pg.db.execute(sql`update mail_connections set state = 'connected', why = null`);
  });

  it("a grant taken back breaks the mailbox; the page says connect again", async () => {
    acc = access(); // a fresh worker: no access token in memory
    fake.revoked = true;
    const ann = await account("acme", "ann@acme.example");
    const token = await checks()["mailbox.token"]?.({ account: ann, now: at });
    expect(token).toMatchObject({ ok: false, why: "Access was taken back. Connect it again." });
    const page = await api().mail({ viewer: AMY, client: "acme" });
    if (page.wren) throw new Error("not Wren's");
    expect(page.mailboxes[0]).toMatchObject({ state: "broken", next: "Connect it again." });
    expect(await acc.boxesOf("acme")).toEqual([]);
    fake.revoked = false;
  });
});

describe("personal Gmail", () => {
  it("sends only; reading is refused with the reason", async () => {
    await api().addMailbox({
      viewer: AMY,
      client: "acme",
      address: "front.desk@gmail.com",
      provider: "google",
      want: "send",
    });
    const fd = await account("acme", "front.desk@gmail.com");
    await refused(
      api().connect({ viewer: AMY, client: "acme", account: fd.id, want: "read" }),
      409,
      /yearly Google security review/,
    );
    const { url } = await api().connect({
      viewer: AMY,
      client: "acme",
      account: fd.id,
      want: "send",
    });
    expect(new URL(url).searchParams.get("scope")).not.toContain(GMAIL_READ);
    fake.signedIn = "front.desk@gmail.com";
    fake.scope = `openid email ${GMAIL_SEND}`;
    const out = await acc.land({ provider: "google", state: stateOf(url), code: "c" });
    expect(out.said).toBe("front.desk@gmail.com is connected to send.");
    const page = await api().mail({ viewer: AMY, client: "acme" });
    if (page.wren) throw new Error("not Wren's");
    expect(page.mailboxes.find((m) => m.personal)).toMatchObject({ state: "send_only" });
    await refused(
      api().addMailbox({
        viewer: AMY,
        client: "acme",
        address: "x@outlook.com",
        provider: "microsoft",
        want: "send",
      }),
      409,
      /Personal Outlook/,
    );
  });
});

describe("Microsoft 365", () => {
  it("admin consent is kept per tenant and checked by an app token", async () => {
    await api().addMailbox({
      viewer: BO,
      client: "beta",
      address: "bo@beta.example",
      provider: "microsoft",
      want: "read",
    });
    const org = await account("beta", "beta.example");
    const bo = await account("beta", "bo@beta.example");
    const page = await api().mail({ viewer: BO, client: "beta" });
    if (page.wren) throw new Error("not Wren's");
    expect(page.mailboxes[0]).toMatchObject({ state: "waiting_admin", provider: "microsoft" });
    expect(page.mailboxes[0]?.may.connectRead).toBe(false);

    const { url } = await api().consent({ viewer: BO, client: "beta", account: org.id });
    expect(url).toContain("/beta.example/v2.0/adminconsent");
    const bad = await acc.land({
      provider: "microsoft",
      state: stateOf(url),
      admin_consent: "True",
      tenant: "not-a-tenant",
    });
    expect(bad.ok).toBe(false);
    const again = await api().consent({ viewer: BO, client: "beta", account: org.id });
    const ok = await acc.land({
      provider: "microsoft",
      state: stateOf(again.url),
      admin_consent: "True",
      tenant: TENANT,
      scope: "https://graph.microsoft.com/Mail.Read",
    });
    expect(ok).toMatchObject({ ok: true, check: [org.id] });

    fake.consented = false;
    expect(await checks()["microsoft.admin_consent"]?.({ account: org, now: at })).toMatchObject({
      ok: false,
    });
    fake.consented = true;
    expect(await checks()["microsoft.admin_consent"]?.({ account: org, now: at })).toMatchObject({
      ok: true,
      seen: { tenant: TENANT },
    });

    // Check asks the setup to look again now (its step lands the fact on the spine).
    const { emits } = await api().check({ viewer: BO, client: "beta", account: org.id });
    expect(emits[0]).toMatchObject({ client: "beta", workflow: "setup.microsoft_mail" });
    // As the setup's step would land it: then the mailbox may connect to read, in that tenant.
    await pg.db.insert(accountFacts).values({
      accountId: org.id,
      fact: FACTS.microsoftConsent,
      state: "ok",
      why: "Wren's app is in the tenant",
      by: "check:microsoft.admin_consent",
      okAt: at,
    });
    const after = await api().mail({ viewer: BO, client: "beta" });
    if (after.wren) throw new Error("not Wren's");
    expect(after.orgs[0]).toMatchObject({ ready: true, tenant: TENANT });
    expect(after.mailboxes[0]?.may.connectRead).toBe(true);
    const c = await api().connect({ viewer: BO, client: "beta", account: bo.id, want: "read" });
    expect(c.url).toContain(`/${TENANT}/oauth2/v2.0/authorize`);

    // Connected, a reply goes through Graph's own reply on their message.
    fake.signedIn = "bo@beta.example";
    fake.scope =
      "openid email https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send";
    expect(
      await acc.land({ provider: "microsoft", state: stateOf(c.url), code: "c" }),
    ).toMatchObject({ ok: true });
    fake.sent.length = 0;
    const box = await acc.senderOf("beta", "bo@beta.example");
    const out = await box.reply(
      { messageId: "AAMk=1", threadId: "conv-1", to: "lee@patient.example", subject: "Roof" },
      "Tuesday works.",
      "<o3@beta.example>",
    );
    expect(out).toEqual({ id: null, threadId: "conv-1" });
    expect(fake.sent).toEqual([
      {
        url: "https://graph.microsoft.com/v1.0/me/messages/AAMk%3D1/reply",
        body: { message: { body: { contentType: "Text", content: "Tuesday works." } } },
      },
    ]);
  });
});

describe("old grants", () => {
  it("an expired link says so", async () => {
    const ann = await account("acme", "ann@acme.example");
    const { url } = await api().connect({
      viewer: AMY,
      client: "acme",
      account: ann.id,
      want: "read",
    });
    at = new Date(at.getTime() + 31 * 60_000);
    expect((await acc.land({ provider: "google", state: stateOf(url), code: "c" })).said).toMatch(
      /expired/,
    );
  });
});
