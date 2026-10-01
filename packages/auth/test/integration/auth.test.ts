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
