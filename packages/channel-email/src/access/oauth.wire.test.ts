/**
 * The mail apps' sign-in wire, pinned: every link, request, result and refusal for Google and
 * Microsoft (tenant included). A fake `fetch` keeps each call. Field order in a form or a query
 * does not count. Synthetic ids and tokens only.
 *
 * The block below is the only part that names where the functions live. The tests under it call
 * `connectUrl`, `consentUrl`, `exchange`, `refresh` and `appInTenant` and never change.
 */
import { shapeOfError, type Wire, wireRecorder } from "@wren/core/wire";
import { describe, expect, it } from "vitest";
import { appInTenant, connectUrl, consentUrl, exchange, refresh } from "./oauth.js";

const APP = { id: "app-id", secret: "app-secret" };
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const REDIRECT = "https://app.test/oauth/mail/google";
const VERIFIER = "v".repeat(48);

const parsed = (url: string) => {
  const u = new URL(url);
  return {
    url: u.origin + u.pathname,
    query: Object.fromEntries([...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
};

describe("connectUrl", () => {
  const base = { redirect: REDIRECT, state: "st", verifier: VERIFIER };

  it("Google Workspace, read: offline, consent, PKCE, hd, login_hint", () => {
    expect(
      parsed(connectUrl("google", APP, { ...base, want: "read", address: "ann@acme.example" })),
    ).toMatchInlineSnapshot(`
      {
        "query": {
          "access_type": "offline",
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "hd": "acme.example",
          "include_granted_scopes": "false",
          "login_hint": "ann@acme.example",
          "prompt": "consent",
          "redirect_uri": "https://app.test/oauth/mail/google",
          "response_type": "code",
          "scope": "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
          "state": "st",
        },
        "url": "https://accounts.google.com/o/oauth2/v2/auth",
      }
    `);
  });

  it("Google Workspace, send only", () => {
    expect(
      parsed(connectUrl("google", APP, { ...base, want: "send", address: "ann@acme.example" })),
    ).toMatchInlineSnapshot(`
      {
        "query": {
          "access_type": "offline",
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "hd": "acme.example",
          "include_granted_scopes": "false",
          "login_hint": "ann@acme.example",
          "prompt": "consent",
          "redirect_uri": "https://app.test/oauth/mail/google",
          "response_type": "code",
          "scope": "openid email https://www.googleapis.com/auth/gmail.send",
          "state": "st",
        },
        "url": "https://accounts.google.com/o/oauth2/v2/auth",
      }
    `);
  });

  it("Google personal accounts send no hd", () => {
    for (const address of ["bo@gmail.com", "bo@googlemail.com"])
      expect(
        parsed(connectUrl("google", APP, { ...base, want: "send", address })).query,
      ).not.toHaveProperty("hd");
  });

  it("Microsoft, read, no tenant: any work account", () => {
    expect(
      parsed(connectUrl("microsoft", APP, { ...base, want: "read", address: "ann@acme.example" })),
    ).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "login_hint": "ann@acme.example",
          "prompt": "select_account",
          "redirect_uri": "https://app.test/oauth/mail/google",
          "response_mode": "query",
          "response_type": "code",
          "scope": "openid email offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send",
          "state": "st",
        },
        "url": "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
      }
    `);
  });

  it("Microsoft, send only, with a domain tenant and a GUID tenant", () => {
    const at = (tenant: string | null | undefined) =>
      parsed(
        connectUrl("microsoft", APP, {
          ...base,
          want: "send",
          address: "ann@acme.example",
          ...(tenant !== undefined ? { tenant } : {}),
        }),
      );
    expect(at("acme.example")).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "code_challenge": "4A01DUGx7AT8ouWhbPhYzuvyoNDA2r8CzlD81Yz8KbQ",
          "code_challenge_method": "S256",
          "login_hint": "ann@acme.example",
          "prompt": "select_account",
          "redirect_uri": "https://app.test/oauth/mail/google",
          "response_mode": "query",
          "response_type": "code",
          "scope": "openid email offline_access https://graph.microsoft.com/Mail.Send",
          "state": "st",
        },
        "url": "https://login.microsoftonline.com/acme.example/oauth2/v2.0/authorize",
      }
    `);
    expect(at("0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0").url).toBe(
      "https://login.microsoftonline.com/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/oauth2/v2.0/authorize",
    );
    expect(at(null).url).toBe(at(undefined).url);
    expect(at(null).url).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    );
  });

  it("a tenant that is not a domain or an id is refused, with the same words", () => {
    const bad = (tenant: string) => () =>
      connectUrl("microsoft", APP, { ...base, want: "send", address: "a@b.c", tenant });
    for (const t of ["evil.com/x?y", "a b", "", "../x", "-x.com"])
      expect(bad(t)).toThrowErrorMatchingInlineSnapshot(`[Error: tenant: a domain or a tenant id]`);
  });

  it("neither link carries the secret", () => {
    const g = connectUrl("google", APP, { ...base, want: "read", address: "a@acme.example" });
    const m = connectUrl("microsoft", APP, { ...base, want: "read", address: "a@acme.example" });
    expect(g + m).not.toContain("app-secret");
  });
});

describe("consentUrl", () => {
  it("the v2 admin consent names the scopes", () => {
    expect(
      parsed(consentUrl(APP, { tenant: "acme.example", redirect: REDIRECT, state: "st" })),
    ).toMatchInlineSnapshot(`
      {
        "query": {
          "client_id": "app-id",
          "redirect_uri": "https://app.test/oauth/mail/google",
          "scope": "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send offline_access openid email",
          "state": "st",
        },
        "url": "https://login.microsoftonline.com/acme.example/v2.0/adminconsent",
      }
    `);
  });

  it("a bad tenant is refused", () => {
    expect(() =>
      consentUrl(APP, { tenant: "evil.com/x", redirect: REDIRECT, state: "st" }),
    ).toThrowErrorMatchingInlineSnapshot(`[Error: tenant: a domain or a tenant id]`);
  });
});

const googleAnswer = {
  access_token: "g-access",
  refresh_token: "g-refresh",
  expires_in: 3599,
  scope:
    "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid",
  id_token: jwt({ email: "Ann@Acme.example", hd: "acme.example" }),
};
const microsoftAnswer = {
  access_token: "m-access",
  refresh_token: "m-refresh-2",
  expires_in: 3600,
  scope: "Mail.Read Mail.Send openid profile email offline_access",
  id_token: jwt({ preferred_username: "Ann@Acme.example", tid: "tid-1" }),
};

describe("exchange", () => {
  it("Google: the code, the verifier, the keys in the form; refresh token, scopes, who signed in", async () => {
    const r = wireRecorder(() => Response.json(googleAnswer));
    const t = await exchange(r.fetch, "google", APP, {
      code: "code-1",
      redirect: REDIRECT,
      verifier: VERIFIER,
    });
    expect({ calls: r.calls, tokens: t }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "code_verifier": "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/oauth/mail/google",
            },
            "headers": {
              "accept": "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://oauth2.googleapis.com/token",
          },
        ],
        "tokens": {
          "access": "g-access",
          "address": "ann@acme.example",
          "expiresIn": 3599,
          "org": "acme.example",
          "refresh": "g-refresh",
          "scopes": [
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.readonly",
            "openid",
          ],
        },
      }
    `);
  });

  it("Microsoft: the tenant's endpoint; Graph scopes come back as URLs; tid is the org", async () => {
    const r = wireRecorder(() => Response.json(microsoftAnswer));
    const t = await exchange(r.fetch, "microsoft", APP, {
      code: "code-1",
      redirect: "https://app.test/oauth/mail/microsoft",
      verifier: VERIFIER,
      tenant: "acme.example",
    });
    expect({ calls: r.calls, tokens: t }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "code": "code-1",
              "code_verifier": "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
              "grant_type": "authorization_code",
              "redirect_uri": "https://app.test/oauth/mail/microsoft",
            },
            "headers": {
              "accept": "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://login.microsoftonline.com/acme.example/oauth2/v2.0/token",
          },
        ],
        "tokens": {
          "access": "m-access",
          "address": "ann@acme.example",
          "expiresIn": 3600,
          "org": "tid-1",
          "refresh": "m-refresh-2",
          "scopes": [
            "https://graph.microsoft.com/Mail.Read",
            "https://graph.microsoft.com/Mail.Send",
            "openid",
            "profile",
            "email",
            "offline_access",
          ],
        },
      }
    `);
  });

  it("Microsoft with no tenant goes to organizations; a bad tenant never reaches the network", async () => {
    const r = wireRecorder(() => Response.json(microsoftAnswer));
    await exchange(r.fetch, "microsoft", APP, { code: "c", redirect: "r", verifier: "v" });
    expect(r.calls[0]?.url).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    );
    const none = wireRecorder();
    await expect(
      exchange(none.fetch, "microsoft", APP, {
        code: "c",
        redirect: "r",
        verifier: "v",
        tenant: "evil.com/x",
      }),
    ).rejects.toThrow("tenant: a domain or a tenant id");
    expect(none.calls).toHaveLength(0);
  });

  it("an answer with no id token, no scope and no expiry still reads", async () => {
    const r = wireRecorder(() => Response.json({ access_token: "a" }));
    expect(
      await exchange(r.fetch, "google", APP, { code: "c", redirect: "r", verifier: "v" }),
    ).toMatchInlineSnapshot(`
      {
        "access": "a",
        "address": null,
        "expiresIn": 3600,
        "org": null,
        "refresh": null,
        "scopes": [],
      }
    `);
  });
});

describe("refresh", () => {
  it("Google: no new refresh token in the answer", async () => {
    const r = wireRecorder(() => Response.json({ ...googleAnswer, refresh_token: undefined }));
    const t = await refresh(r.fetch, "google", APP, { refresh: "g-refresh" });
    expect({ calls: r.calls, tokens: t }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "grant_type": "refresh_token",
              "refresh_token": "g-refresh",
            },
            "headers": {
              "accept": "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://oauth2.googleapis.com/token",
          },
        ],
        "tokens": {
          "access": "g-access",
          "address": "ann@acme.example",
          "expiresIn": 3599,
          "org": "acme.example",
          "refresh": null,
          "scopes": [
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.readonly",
            "openid",
          ],
        },
      }
    `);
  });

  it("Microsoft rotates: the new refresh token comes back", async () => {
    const r = wireRecorder(() => Response.json(microsoftAnswer));
    const t = await refresh(r.fetch, "microsoft", APP, {
      refresh: "m-refresh-1",
      tenant: "tid-1",
    });
    expect({ calls: r.calls, tokens: t }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "grant_type": "refresh_token",
              "refresh_token": "m-refresh-1",
            },
            "headers": {
              "accept": "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://login.microsoftonline.com/tid-1/oauth2/v2.0/token",
          },
        ],
        "tokens": {
          "access": "m-access",
          "address": "ann@acme.example",
          "expiresIn": 3600,
          "org": "tid-1",
          "refresh": "m-refresh-2",
          "scopes": [
            "https://graph.microsoft.com/Mail.Read",
            "https://graph.microsoft.com/Mail.Send",
            "openid",
            "profile",
            "email",
            "offline_access",
          ],
        },
      }
    `);
  });
});

describe("refusals", () => {
  const refuse = async (status: number, body: unknown) => {
    const r = wireRecorder(() => Response.json(body, { status }));
    const err = await refresh(r.fetch, "google", APP, { refresh: "secret-rt" }).catch(
      (e: unknown) => e,
    );
    return shapeOfError(err);
  };

  it("a revoked grant: the code, the first line, and no token", async () => {
    const out = await refuse(400, {
      error: "invalid_grant",
      error_description: "Token revoked\nmore",
    });
    expect(out).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_grant",
        "isError": true,
        "message": "invalid_grant: Token revoked",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
    expect(out.message).not.toContain("secret-rt");
  });

  it("AADSTS descriptions keep their first line only, cut at 200", async () => {
    expect(
      await refuse(400, {
        error: "invalid_grant",
        error_description: "AADSTS70000: The request was denied.\nTrace ID: 1\nCorrelation ID: 2",
      }),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_grant",
        "isError": true,
        "message": "invalid_grant: AADSTS70000: The request was denied.",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
    const long = await refuse(400, {
      error: "invalid_request",
      error_description: "z".repeat(300),
    });
    expect(long.message).toBe(`invalid_request: ${"z".repeat(200)}`);
  });

  it("no body: http_<status>, not revoked; a plain error is its code", async () => {
    expect(await refuse(500, {})).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "http_500",
        "isError": true,
        "message": "http_500",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
    expect(await refuse(400, { error: "invalid_client" })).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_client",
        "isError": true,
        "message": "invalid_client",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });
});

describe("appInTenant", () => {
  const check = async (answer: (w: Wire) => Response) => {
    const r = wireRecorder(answer);
    const out = await appInTenant(r.fetch, APP, "acme.example");
    return { calls: r.calls, out };
  };

  it("a token means the app is in the tenant; the request is a client-credentials form", async () => {
    expect(await check(() => Response.json({ access_token: "x" }))).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "form": {
              "client_id": "app-id",
              "client_secret": "app-secret",
              "grant_type": "client_credentials",
              "scope": "https://graph.microsoft.com/.default",
            },
            "headers": {
              "accept": "application/json",
              "content-type": "application/x-www-form-urlencoded",
            },
            "method": "POST",
            "url": "https://login.microsoftonline.com/acme.example/oauth2/v2.0/token",
          },
        ],
        "out": {
          "ok": true,
          "why": "Wren's app is in the tenant",
        },
      }
    `);
  });

  it("AADSTS700016: the admin has not consented", async () => {
    const { out } = await check(() =>
      Response.json(
        {
          error: "unauthorized_client",
          error_description: "AADSTS700016: Application not found in the directory",
        },
        { status: 400 },
      ),
    );
    expect(out).toMatchInlineSnapshot(`
      {
        "ok": false,
        "why": "Wren's app isn't in the tenant: the admin hasn't consented",
      }
    `);
  });

  it("any other refusal names its code", async () => {
    const { out } = await check(() =>
      Response.json(
        { error: "invalid_client", error_description: "AADSTS7000215: bad secret" },
        { status: 401 },
      ),
    );
    expect(out).toMatchInlineSnapshot(`
      {
        "ok": false,
        "why": "Microsoft said invalid_client",
      }
    `);
  });

  it("a network failure says Microsoft said nothing it can name", async () => {
    const out = await appInTenant(
      async () => {
        throw new TypeError("fetch failed");
      },
      APP,
      "acme.example",
    );
    expect(out).toMatchInlineSnapshot(`
      {
        "ok": false,
        "why": "Microsoft said no",
      }
    `);
  });

  it("a bad tenant is caught inside: no call, and the same plain answer", async () => {
    const r = wireRecorder();
    const out = await appInTenant(r.fetch, APP, "evil.com/x");
    expect(r.calls).toHaveLength(0);
    expect(out).toMatchInlineSnapshot(`
      {
        "ok": false,
        "why": "Microsoft said no",
      }
    `);
  });
});
