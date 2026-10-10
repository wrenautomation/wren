/** The shared OAuth pieces against a fake token endpoint: no network. */
import { describe, expect, it } from "vitest";
import { claimsOf, OAuthError, tokenPost } from "./oauth.js";

const fake = (status: number, answer: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer), { status });
  };
  return { fetch, calls };
};
const KEYS = { id: "app-id", secret: "app-secret" };

describe("tokenPost", () => {
  it("sends keys as basic auth or in the body, as the app asks", async () => {
    const f = fake(200, { access_token: "a" });
    await tokenPost(f.fetch, "https://t.test", { grant_type: "x" }, { ...KEYS, as: "basic" });
    await tokenPost(f.fetch, "https://t.test", { grant_type: "x" }, { ...KEYS, as: "body" });
    const [basic, body] = f.calls as [(typeof f.calls)[0], (typeof f.calls)[0]];
    expect((basic.init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
    expect(String(basic.init.body)).not.toContain("app-secret");
    expect(String(body.init.body)).toContain("client_secret=app-secret");
  });

  it("names the provider's code, first line only, and whether the grant is gone", async () => {
    const ms = fake(400, {
      error: "invalid_grant",
      error_description: "AADSTS70000: expired\nTrace ID: 1",
    });
    const err = await tokenPost(ms.fetch, "https://t.test", {}).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err).toMatchObject({ code: "invalid_grant", revoked: true });
    expect(err.message).toBe("invalid_grant: AADSTS70000: expired");
    // HubSpot says {status, message}.
    const hs = fake(400, { status: "BAD_REFRESH_TOKEN", message: "missing or unknown" });
    await expect(tokenPost(hs.fetch, "https://t.test", {})).rejects.toMatchObject({
      code: "BAD_REFRESH_TOKEN",
      revoked: true,
    });
    const down = fake(503, {});
    await expect(tokenPost(down.fetch, "https://t.test", {})).rejects.toMatchObject({
      code: "http_503",
      revoked: false,
    });
  });

  it("reads a JWT's claims, and nothing from junk", () => {
    const jwt = `x.${Buffer.from('{"email":"a@b.test"}').toString("base64url")}.y`;
    expect(claimsOf(jwt)).toEqual({ email: "a@b.test" });
    expect(claimsOf("a.!!!.b")).toEqual({});
  });
});
