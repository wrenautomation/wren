// Wren's mail apps' OAuth, against fake token endpoints: scopes, URLs, refusals, the consent check.
import { claimsOf, OAuthError, pkceChallenge } from "@wren/core/oauth";
import { describe, expect, it } from "vitest";
import {
  accessOf,
  appInTenant,
  connectUrl,
  consentUrl,
  exchange,
  GMAIL_READ,
  GMAIL_SEND,
  GRAPH_READ,
  GRAPH_SEND,
  graphScopes,
  refresh,
  scopesFor,
} from "./oauth.js";

const APP = { id: "app-id", secret: "app-secret" };
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

/** A token endpoint that answers `body` with `status`, keeping what it was asked. */
function endpoint(status: number, body: object) {
  const asked: { url: string; form: URLSearchParams }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    asked.push({ url, form: new URLSearchParams(String(init?.body ?? "")) });
    return Response.json(body, { status });
  };
  return { fetch, asked };
}

describe("scopes", () => {
  it("read always comes with send; identity for the address", () => {
    expect(scopesFor("google", "send")).toEqual(["openid", "email", GMAIL_SEND]);
    expect(scopesFor("google", "read")).toEqual(["openid", "email", GMAIL_READ, GMAIL_SEND]);
    expect(scopesFor("microsoft", "read")).toEqual([
      "openid",
      "email",
      "offline_access",
      GRAPH_READ,
      GRAPH_SEND,
    ]);
  });

  it("what a grant lets Wren do", () => {
    expect(accessOf("google", [GMAIL_SEND])).toBe("send");
    expect(accessOf("google", [GMAIL_READ, GMAIL_SEND])).toBe("read");
    expect(accessOf("google", [GMAIL_READ])).toBeNull();
    expect(accessOf("microsoft", graphScopes("Mail.Read Mail.Send openid"))).toBe("read");
    expect(accessOf("microsoft", graphScopes("mail.send"))).toBe("send");
  });
});

describe("URLs", () => {
  it("Google: offline, consent, PKCE, and hd only for Workspace", () => {
    const u = new URL(
      connectUrl("google", APP, {
        redirect: "https://app.test/oauth/mail/google",
        state: "st",
        verifier: "v".repeat(48),
        want: "read",
        address: "ann@acme.example",
      }),
    );
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = u.searchParams;
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("hd")).toBe("acme.example");
    expect(q.get("code_challenge")).toBe(pkceChallenge("v".repeat(48)));
    expect(q.get("scope")).toContain(GMAIL_READ);
    expect(q.get("client_id")).toBe("app-id");
    expect(u.toString()).not.toContain("app-secret");
    const personal = new URL(
      connectUrl("google", APP, {
        redirect: "r",
        state: "s",
        verifier: "v",
        want: "send",
        address: "bo@gmail.com",
      }),
    );
    expect(personal.searchParams.get("hd")).toBeNull();
  });

  it("Microsoft: the tenant in the path, and a bad tenant refused", () => {
    const o = { redirect: "r", state: "s", verifier: "v", want: "send" as const, address: "a@b.c" };
    expect(connectUrl("microsoft", APP, o)).toContain(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?",
    );
    expect(connectUrl("microsoft", APP, { ...o, tenant: "acme.example" })).toContain(
      "/acme.example/oauth2/",
    );
    expect(() => connectUrl("microsoft", APP, { ...o, tenant: "evil.com/x?y" })).toThrow();
  });

  it("admin consent names the scopes on the v2 endpoint", () => {
    const u = new URL(consentUrl(APP, { tenant: "acme.example", redirect: "r", state: "s" }));
    expect(u.pathname).toBe("/acme.example/v2.0/adminconsent");
    const scope = u.searchParams.get("scope") ?? "";
    for (const s of [GRAPH_READ, GRAPH_SEND, "offline_access"]) expect(scope).toContain(s);
  });
});

describe("tokens", () => {
  it("an exchange keeps the refresh token, the scopes and who signed in", async () => {
    const e = endpoint(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
      scope: `${GMAIL_SEND} openid`,
      id_token: jwt({ email: "Ann@Acme.example", hd: "acme.example" }),
    });
    const t = await exchange(e.fetch, "google", APP, { code: "c", redirect: "r", verifier: "v" });
    expect(t).toMatchObject({
      access: "at",
      refresh: "rt",
      expiresIn: 3599,
      address: "ann@acme.example",
      org: "acme.example",
    });
    expect(e.asked[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(e.asked[0]?.form.get("code_verifier")).toBe("v");
  });

  it("Microsoft's scope names come back as URLs; tid is the org", async () => {
    const e = endpoint(200, {
      access_token: "at",
      refresh_token: "rt2",
      scope: "Mail.Read Mail.Send openid",
      id_token: jwt({ preferred_username: "ann@acme.example", tid: "tid-1" }),
    });
    const t = await refresh(e.fetch, "microsoft", APP, { refresh: "rt", tenant: "tid-1" });
    expect(t.scopes).toContain(GRAPH_READ);
    expect(t.org).toBe("tid-1");
    expect(t.refresh).toBe("rt2");
  });

  it("a revoked grant says so and carries no token", async () => {
    const e = endpoint(400, { error: "invalid_grant", error_description: "Token revoked\nmore" });
    const err = await refresh(e.fetch, "google", APP, { refresh: "secret-rt" }).catch((x) => x);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.revoked).toBe(true);
    expect(err.message).toBe("invalid_grant: Token revoked");
    expect(err.message).not.toContain("secret-rt");
  });

  it("claims of junk are empty", () => {
    expect(claimsOf("x")).toEqual({});
    expect(claimsOf(undefined)).toEqual({});
    expect(claimsOf("a.!!!.b")).toEqual({});
  });
});

describe("appInTenant", () => {
  it("a token means consented; AADSTS700016 means not", async () => {
    expect((await appInTenant(endpoint(200, { access_token: "x" }).fetch, APP, "t")).ok).toBe(true);
    const no = await appInTenant(
      endpoint(400, {
        error: "unauthorized_client",
        error_description: "AADSTS700016: Application not found in the directory",
      }).fetch,
      APP,
      "t",
    );
    expect(no).toEqual({
      ok: false,
      why: "Wren's app isn't in the tenant: the admin hasn't consented",
    });
  });
});
