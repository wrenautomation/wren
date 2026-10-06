/**
 * The sign-in end to end on a migrated database: who may get an account, the
 * emailed code, and the token an app checks. No network: mail is captured.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Auth, type AuthMail, makeAuth } from "../../src/index.js";
import { verifyToken } from "../../src/verify.js";

const ORIGIN = "https://auth.test";
const MEMBER = "member@acme.example";
const STRANGER = "stranger@evil.example";
const CLIENT_HOST = "portal.acme.example";

let pg: TestPostgres;
let auth: Auth;
const mail: AuthMail[] = [];
const operators = new Set<string>();

const call = async (path: string, body?: unknown, cookie?: string) =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: ORIGIN,
        "x-wren-ip": "1.2.3.4",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
const codeIn = (m: AuthMail | undefined) => /code: (\d+)/.exec(m?.subject ?? "")?.[1] ?? "";
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const signIn = async (email: string) => {
  mail.length = 0;
  await call("email-otp/send-verification-otp", { email, type: "sign-in" });
  return call("sign-in/email-otp", { email, otp: codeIn(mail[0]) });
};
const userCount = async () =>
  (
    (await pg.db.execute(`select count(*)::int as n from auth."user"`)) as unknown as {
      n: number;
    }[]
  )[0]?.n;

beforeAll(async () => {
  pg = await startTestPostgres();
  auth = makeAuth({
    db: pg.db,
    secret: "a-test-secret-that-is-long-enough-0123456789",
    baseURL: ORIGIN,
    trustedOrigins: ["https://app.test"],
    allowed: async (email) => email === MEMBER || operators.has(email),
    claims: async (email) => ({ operator: operators.has(email) }),
    send: async (m) => void mail.push(m),
    ipHeader: "x-wren-ip",
    handoff: async (host, email) => host === CLIENT_HOST && email === MEMBER,
    portal: "https://app.test",
  });
}, 120_000);
afterAll(() => pg.stop());

describe("who gets an account", () => {
  it("a stranger is sent nothing and gets no account", async () => {
    const res = await signIn(STRANGER);
    expect(mail).toEqual([]);
    expect(res.ok).toBe(false);
    expect(await userCount()).toBe(0);
  });

  it("a member gets a code by email, then an account and a session", async () => {
    mail.length = 0;
    await call("email-otp/send-verification-otp", { email: MEMBER, type: "sign-in" });
    expect(mail).toHaveLength(1);
    expect(mail[0]?.text).toContain(`${ORIGIN}/link?email=`);
    const res = await call("sign-in/email-otp", { email: MEMBER, otp: codeIn(mail[0]) });
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toContain("session_token");
    expect(await userCount()).toBe(1);
  });

  it("a code works once", async () => {
    mail.length = 0;
    await call("email-otp/send-verification-otp", { email: MEMBER, type: "sign-in" });
    const otp = codeIn(mail[0]);
    expect((await call("sign-in/email-otp", { email: MEMBER, otp })).status).toBe(200);
    expect((await call("sign-in/email-otp", { email: MEMBER, otp })).ok).toBe(false);
  });

  it("no one signs up with a password", async () => {
    const res = await call("sign-up/email", {
      email: MEMBER,
      password: "long-enough-pass",
      name: "x",
    });
    expect(res.ok).toBe(false);
  });
});

describe("the token an app checks", () => {
  const fetcher = (async (url: string | URL | Request) =>
    auth.handler(new Request(String(url)))) as typeof fetch;
  const check = { issuer: ORIGIN, audience: "wren" };

  it("names the member, signed with the published key", async () => {
    const cookie = cookieOf(await signIn(MEMBER));
    const { token } = (await (await call("token", undefined, cookie)).json()) as { token: string };
    const who = await verifyToken(token, check, { fetcher });
    expect(who).toMatchObject({ email: MEMBER, operator: false });
  });

  it("carries the operator flag, read fresh for each token", async () => {
    operators.add(MEMBER);
    const cookie = cookieOf(await signIn(MEMBER));
    const { token } = (await (await call("token", undefined, cookie)).json()) as { token: string };
    expect((await verifyToken(token, check, { fetcher }))?.operator).toBe(true);
    operators.delete(MEMBER);
  });

  it("no session, no token", async () => {
    expect((await call("token")).status).toBe(401);
  });
});

describe("passkeys", () => {
  let cookie = "";
  beforeAll(async () => {
    // The tests above used up this address's code sends.
    await pg.db.execute("delete from auth.rate_limit");
    cookie = cookieOf(await signIn(MEMBER));
  });

  it("adding one needs a session; the ceremony is for the registrable domain", async () => {
    expect((await call("passkey/generate-register-options")).status).toBe(401);
    const res = await call("passkey/generate-register-options", undefined, cookie);
    expect(res.status).toBe(200);
    const o = (await res.json()) as { rp: { id: string; name: string }; user: { name: string } };
    expect(o.rp).toEqual({ id: "test", name: "Wren" });
    expect(o.user.name).toBe(MEMBER);
    // Signing in with one needs no session.
    expect((await call("passkey/generate-authenticate-options")).status).toBe(200);
  });

  it("lists and deletes the person's own", async () => {
    await pg.db.execute(`
      insert into auth.passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
      select 'pk1', id, 'key', 'cred1', 0, 'multiDevice', true from auth."user" where email = '${MEMBER}'`);
    const list = await (await call("passkey/list-user-passkeys", undefined, cookie)).json();
    expect(list).toMatchObject([{ id: "pk1", credentialID: "cred1", backedUp: true }]);
    expect((await call("passkey/delete-passkey", { id: "pk1" }, cookie)).status).toBe(200);
    expect(await (await call("passkey/list-user-passkeys", undefined, cookie)).json()).toEqual([]);
  });
});

describe("handing sign-in to a client's host", () => {
  let cookie = "";
  beforeAll(async () => {
    await pg.db.execute("delete from auth.rate_limit");
    cookie = cookieOf(await signIn(MEMBER));
  });
  const back = `https://${CLIENT_HOST}/__auth/back?next=%2Fhome`;
  const handoff = (to: string, headers: Record<string, string> = {}) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth/handoff?to=${encodeURIComponent(to)}`, {
        headers: { cookie, "x-wren-ip": "1.2.3.4", "sec-fetch-site": "same-origin", ...headers },
      }),
    );
  const ottOf = (res: Response) =>
    new URL(res.headers.get("location") ?? "").searchParams.get("ott");

  it("sends a one-time token to the member's client host; it redeems once, server to server", async () => {
    const res = await handoff(back);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location") ?? "");
    expect(`${to.origin}${to.pathname}`).toBe(`https://${CLIENT_HOST}/__auth/back`);
    expect(to.searchParams.get("next")).toBe("/home");
    const ott = ottOf(res) ?? "";
    expect(ott.length).toBeGreaterThan(20);

    const redeem = () =>
      auth.handler(
        new Request(`${ORIGIN}/api/auth/one-time-token/verify`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-wren-ip": "1.2.3.4" },
          body: JSON.stringify({ token: ott }),
        }),
      );
    const first = await redeem();
    expect(first.status).toBe(200);
    const carried = cookieOf(first);
    expect(carried).toContain("session_token");
    // The carried cookie is a session the token endpoint honours.
    const token = await call("token", undefined, carried);
    expect(token.status).toBe(200);
    expect((await redeem()).ok).toBe(false);
  });

  it("refuses other hosts, other paths, links from other sites, and no session", async () => {
    for (const to of [
      "https://portal.other.example/__auth/back",
      `https://${CLIENT_HOST}/elsewhere`,
      `http://${CLIENT_HOST}/__auth/back`,
      `https://${CLIENT_HOST}:8443/__auth/back`,
      `https://${CLIENT_HOST}/__auth/back?ott=planted`,
      "not a url",
    ]) {
      const res = await handoff(to);
      expect(res.headers.get("location"), to).toBe("https://app.test");
    }
    const cross = await handoff(back, { "sec-fetch-site": "cross-site" });
    expect(cross.headers.get("location")).toBe("https://app.test");
    const anon = await auth.handler(
      new Request(`${ORIGIN}/api/auth/handoff?to=${encodeURIComponent(back)}`, {
        headers: { "x-wren-ip": "1.2.3.4" },
      }),
    );
    expect(anon.status).toBe(401);
  });

  it("the browser can't mint one itself", async () => {
    expect((await call("one-time-token/generate", undefined, cookie)).ok).toBe(false);
  });
});
