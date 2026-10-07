/**
 * The mail callbacks (designs/2026-10-07-mail-access.md): only the known query names reach
 * `MailCallback/land`, the page shows the service's sentence escaped, and the demo has none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

let sent: { url: string; body: Record<string, unknown> }[];
let reply: { status: number; body: unknown };

const env = (): Env => ({
  ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: "https://restate.test:8080/",
  RESTATE_AUTH_TOKEN: "rt",
  AUTH_ORIGIN: "https://auth.test",
});

beforeEach(() => {
  sent = [];
  reply = { status: 200, body: { ok: true, said: "amy@acme.example sends and reads." } };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json(reply.body, { status: reply.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const get = (path: string, host = "app.test") =>
  worker.fetch(new Request(`https://${host}${path}`), env());

describe("mail callbacks", () => {
  it("passes the known names on and shows the answer", async () => {
    const res = await get("/oauth/mail/google?state=s1&code=c1&scope=x&evil=1&viewer=x");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(sent).toEqual([
      {
        url: "https://restate.test:8080/MailCallback/land",
        body: { provider: "google", state: "s1", code: "c1", scope: "x" },
      },
    ]);
    const html = await res.text();
    expect(html).toContain("<h1>Connected</h1>");
    expect(html).toContain("amy@acme.example sends and reads.");
    expect(html).toContain('href="/account/mail"');
  });

  it("an admin's consent goes on as Microsoft's", async () => {
    reply.body = { ok: true, said: "Consent recorded." };
    await get("/oauth/mail/microsoft?state=s2&admin_consent=True&tenant=t-1");
    expect(sent[0]?.body).toEqual({
      provider: "microsoft",
      state: "s2",
      admin_consent: "True",
      tenant: "t-1",
    });
  });

  it("escapes the sentence, and says no on a refusal", async () => {
    reply.body = { ok: false, said: "<script>x</script>" };
    const html = await (await get("/oauth/mail/google?state=s3&error=access_denied")).text();
    expect(html).toContain("<h1>Not connected</h1>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("no state, no call; a server error, a plain page", async () => {
    expect((await get("/oauth/mail/google?code=c")).status).toBe(400);
    expect(sent).toEqual([]);
    reply = { status: 500, body: { message: "boom" } };
    const res = await get("/oauth/mail/google?state=s4&code=c");
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("boom");
  });

  it("other paths and the demo host aren't callbacks", async () => {
    expect(await (await get("/oauth/mail/yahoo?state=s")).text()).toBe("app");
    expect(await (await get("/oauth/mail/google?state=s", "demo.test")).text()).toBe("app");
    expect(sent).toEqual([]);
  });
});
