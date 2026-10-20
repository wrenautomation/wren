/**
 * The apps' sign-in wire, pinned: the link, the code's exchange and a refresh for HubSpot,
 * QuickBooks and Jobber. A fake `fetch` keeps each call. Field order in a form or a query does
 * not count. Synthetic keys and tokens only.
 *
 * The block below is the only part that names where the functions live. The tests under it call
 * `connectUrl`, `exchange` and `refresh` and never change.
 */
import { shapeOfError, wireRecorder } from "@wren/core/wire";
import { describe, expect, it } from "vitest";
import { APPS, CONNECTOR_APPS, type ConnectorApp } from "./apps.js";
import { connectUrl, exchange, refresh } from "./oauth.js";

const KEYS = { id: "app-id", secret: "app-secret" };
const REDIRECT = "https://app.test/oauth/connector";

const parsed = (url: string) => {
  const u = new URL(url);
  return {
    url: u.origin + u.pathname,
    query: Object.fromEntries([...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
};

const GOOD = { access_token: "acc-1", refresh_token: "ref-2", expires_in: 1800 };

describe("connectUrl", () => {
  it("each app: where a person signs in", () => {
    const links = Object.fromEntries(
      CONNECTOR_APPS.map((app) => [
        app,
        parsed(connectUrl(app, KEYS, { redirect: REDIRECT, state: "st" })),
      ]),
    );
    expect(links).toMatchInlineSnapshot(`
      {
        "hubspot": {
          "query": {
            "client_id": "app-id",
            "redirect_uri": "https://app.test/oauth/connector",
            "response_type": "code",
            "scope": "oauth crm.objects.contacts.read crm.objects.companies.read",
            "state": "st",
          },
          "url": "https://app.hubspot.com/oauth/authorize",
        },
        "jobber": {
          "query": {
            "client_id": "app-id",
            "redirect_uri": "https://app.test/oauth/connector",
            "response_type": "code",
            "state": "st",
          },
          "url": "https://api.getjobber.com/api/oauth/authorize",
        },
        "quickbooks": {
          "query": {
            "client_id": "app-id",
            "redirect_uri": "https://app.test/oauth/connector",
            "response_type": "code",
            "scope": "com.intuit.quickbooks.accounting",
            "state": "st",
          },
          "url": "https://appcenter.intuit.com/connect/oauth2",
        },
      }
    `);
  });

  it("HubSpot and QuickBooks name their scopes; Jobber sets them on its developer app", () => {
    const scope = (app: ConnectorApp) =>
      parsed(connectUrl(app, KEYS, { redirect: REDIRECT, state: "st" })).query.scope;
    expect(scope("hubspot")).toBe("oauth crm.objects.contacts.read crm.objects.companies.read");
    expect(scope("quickbooks")).toBe("com.intuit.quickbooks.accounting");
    expect(scope("jobber")).toBeUndefined();
  });

  it("no link carries the secret", () => {
    for (const app of CONNECTOR_APPS)
      expect(connectUrl(app, KEYS, { redirect: REDIRECT, state: "st" })).not.toContain(
        "app-secret",
      );
  });
});

describe("exchange", () => {
  it("each app: the code, the redirect and the keys", async () => {
    const out: Record<string, unknown> = {};
    for (const app of CONNECTOR_APPS) {
      const r = wireRecorder(() => Response.json(GOOD));
      const t = await exchange(r.fetch, app, KEYS, { code: "code-1", redirect: REDIRECT });
      out[app] = { calls: r.calls, tokens: t };
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "hubspot": {
          "calls": [
            {
              "form": {
                "client_id": "app-id",
                "client_secret": "app-secret",
                "code": "code-1",
                "grant_type": "authorization_code",
                "redirect_uri": "https://app.test/oauth/connector",
              },
              "headers": {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
              },
              "method": "POST",
              "url": "https://api.hubapi.com/oauth/v1/token",
            },
          ],
          "tokens": {
            "access": "acc-1",
            "expiresIn": 1800,
            "refresh": "ref-2",
          },
        },
        "jobber": {
          "calls": [
            {
              "form": {
                "client_id": "app-id",
                "client_secret": "app-secret",
                "code": "code-1",
                "grant_type": "authorization_code",
                "redirect_uri": "https://app.test/oauth/connector",
              },
              "headers": {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
              },
              "method": "POST",
              "url": "https://api.getjobber.com/api/oauth/token",
            },
          ],
          "tokens": {
            "access": "acc-1",
            "expiresIn": 1800,
            "refresh": "ref-2",
          },
        },
        "quickbooks": {
          "calls": [
            {
              "form": {
                "code": "code-1",
                "grant_type": "authorization_code",
                "redirect_uri": "https://app.test/oauth/connector",
              },
              "headers": {
                "accept": "application/json",
                "authorization": "Basic YXBwLWlkOmFwcC1zZWNyZXQ=",
                "content-type": "application/x-www-form-urlencoded",
              },
              "method": "POST",
              "url": "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
            },
          ],
          "tokens": {
            "access": "acc-1",
            "expiresIn": 1800,
            "refresh": "ref-2",
          },
        },
      }
    `);
  });

  it("only QuickBooks sends the keys as Basic auth, with none in the form", async () => {
    const sent = async (app: ConnectorApp) => {
      const r = wireRecorder(() => Response.json(GOOD));
      await exchange(r.fetch, app, KEYS, { code: "c", redirect: REDIRECT });
      return r.calls[0];
    };
    for (const app of CONNECTOR_APPS) {
      const c = await sent(app);
      if (APPS[app].auth === "basic") {
        expect(c?.headers.authorization).toBe("Basic YXBwLWlkOmFwcC1zZWNyZXQ=");
        expect(c?.form).not.toHaveProperty("client_id");
        expect(c?.form).not.toHaveProperty("client_secret");
      } else {
        expect(c?.headers).not.toHaveProperty("authorization");
        expect(c?.form).toMatchObject({ client_id: "app-id", client_secret: "app-secret" });
      }
    }
  });

  it("an answer with no refresh token is refused, by the app's name", async () => {
    const out: Record<string, unknown> = {};
    for (const app of CONNECTOR_APPS) {
      const r = wireRecorder(() => Response.json({ access_token: "a" }));
      out[app] = shapeOfError(
        await exchange(r.fetch, app, KEYS, { code: "c", redirect: REDIRECT }).catch(
          (e: unknown) => e,
        ),
      );
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "hubspot": {
          "class": "OAuthError",
          "code": "no_refresh",
          "isError": true,
          "message": "HubSpot gave no refresh token",
          "name": "OAuthError",
          "revoked": false,
        },
        "jobber": {
          "class": "OAuthError",
          "code": "no_refresh",
          "isError": true,
          "message": "Jobber gave no refresh token",
          "name": "OAuthError",
          "revoked": false,
        },
        "quickbooks": {
          "class": "OAuthError",
          "code": "no_refresh",
          "isError": true,
          "message": "QuickBooks gave no refresh token",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
  });

  it("an answer with no access token is refused, by the app's name", async () => {
    const out: Record<string, unknown> = {};
    for (const app of CONNECTOR_APPS) {
      const r = wireRecorder(() => Response.json({ refresh_token: "r" }));
      out[app] = shapeOfError(
        await exchange(r.fetch, app, KEYS, { code: "c", redirect: REDIRECT }).catch(
          (e: unknown) => e,
        ),
      );
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "hubspot": {
          "class": "OAuthError",
          "code": "no_access",
          "isError": true,
          "message": "HubSpot gave no access token",
          "name": "OAuthError",
          "revoked": false,
        },
        "jobber": {
          "class": "OAuthError",
          "code": "no_access",
          "isError": true,
          "message": "Jobber gave no access token",
          "name": "OAuthError",
          "revoked": false,
        },
        "quickbooks": {
          "class": "OAuthError",
          "code": "no_access",
          "isError": true,
          "message": "QuickBooks gave no access token",
          "name": "OAuthError",
          "revoked": false,
        },
      }
    `);
  });
});

describe("refresh", () => {
  it("each app: the refresh token and the keys; a rotated token comes back", async () => {
    const out: Record<string, unknown> = {};
    for (const app of CONNECTOR_APPS) {
      const r = wireRecorder(() => Response.json(GOOD));
      const t = await refresh(r.fetch, app, KEYS, "ref-1");
      out[app] = { calls: r.calls, tokens: t };
    }
    expect(out).toMatchInlineSnapshot(`
      {
        "hubspot": {
          "calls": [
            {
              "form": {
                "client_id": "app-id",
                "client_secret": "app-secret",
                "grant_type": "refresh_token",
                "refresh_token": "ref-1",
              },
              "headers": {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
              },
              "method": "POST",
              "url": "https://api.hubapi.com/oauth/v1/token",
            },
          ],
          "tokens": {
            "access": "acc-1",
            "expiresIn": 1800,
            "refresh": "ref-2",
          },
        },
        "jobber": {
          "calls": [
            {
              "form": {
                "client_id": "app-id",
                "client_secret": "app-secret",
                "grant_type": "refresh_token",
                "refresh_token": "ref-1",
              },
              "headers": {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded",
              },
              "method": "POST",
              "url": "https://api.getjobber.com/api/oauth/token",
            },
          ],
          "tokens": {
            "access": "acc-1",
            "expiresIn": 1800,
            "refresh": "ref-2",
          },
        },
        "quickbooks": {
          "calls": [
            {
              "form": {
                "grant_type": "refresh_token",
                "refresh_token": "ref-1",
              },
              "headers": {
                "accept": "application/json",
                "authorization": "Basic YXBwLWlkOmFwcC1zZWNyZXQ=",
                "content-type": "application/x-www-form-urlencoded",
              },
              "method": "POST",
              "url": "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
            },
          ],
          "tokens": {
            "access": "acc-1",
            "expiresIn": 1800,
            "refresh": "ref-2",
          },
        },
      }
    `);
  });

  it("an answer with no new refresh token keeps the old one", async () => {
    const r = wireRecorder(() => Response.json({ access_token: "acc-9", expires_in: 600 }));
    expect(await refresh(r.fetch, "hubspot", KEYS, "ref-1")).toMatchInlineSnapshot(`
      {
        "access": "acc-9",
        "expiresIn": 600,
        "refresh": "ref-1",
      }
    `);
  });

  it("an answer with no access token is refused", async () => {
    const r = wireRecorder(() => Response.json({ refresh_token: "ref-2" }));
    expect(
      shapeOfError(await refresh(r.fetch, "jobber", KEYS, "ref-1").catch((e: unknown) => e)),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "no_access",
        "isError": true,
        "message": "Jobber gave no access token",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });

  it("expires_in: an hour when missing, zero, negative or not a number; the answer's when positive", async () => {
    const lives = async (expires_in: unknown) => {
      const r = wireRecorder(() => Response.json({ ...GOOD, expires_in }));
      return (await refresh(r.fetch, "quickbooks", KEYS, "ref-1")).expiresIn;
    };
    expect(
      await Promise.all([undefined, 0, -5, "soon", null, 1800, "900"].map((v) => lives(v))),
    ).toMatchInlineSnapshot(`
      [
        3600,
        3600,
        3600,
        3600,
        3600,
        1800,
        900,
      ]
    `);
  });
});

describe("refusals", () => {
  const refused = async (status: number, body: unknown) => {
    const r = wireRecorder(() => Response.json(body, { status }));
    return shapeOfError(
      await refresh(r.fetch, "hubspot", KEYS, "secret-rt").catch((e: unknown) => e),
    );
  };

  it("HubSpot's BAD_REFRESH_TOKEN is a revoked connection", async () => {
    const out = await refused(400, {
      status: "BAD_REFRESH_TOKEN",
      message: "missing or unknown refresh token",
    });
    expect(out).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "BAD_REFRESH_TOKEN",
        "isError": true,
        "message": "BAD_REFRESH_TOKEN: missing or unknown refresh token",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
    expect(out.message).not.toContain("secret-rt");
  });

  it("a revoked grant from QuickBooks, and a server error from Jobber", async () => {
    const q = wireRecorder(() =>
      Response.json(
        { error: "invalid_grant", error_description: "Incorrect or invalid refresh token" },
        { status: 400 },
      ),
    );
    expect(
      shapeOfError(await refresh(q.fetch, "quickbooks", KEYS, "ref-1").catch((e: unknown) => e)),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_grant",
        "isError": true,
        "message": "invalid_grant: Incorrect or invalid refresh token",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
    const j = wireRecorder(() => Response.json({}, { status: 503 }));
    expect(
      shapeOfError(await refresh(j.fetch, "jobber", KEYS, "ref-1").catch((e: unknown) => e)),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "http_503",
        "isError": true,
        "message": "http_503",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });
});
