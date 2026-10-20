/** `tokenPost`'s wire: what a token endpoint is sent and how its refusals read. Synthetic keys. */
import { describe, expect, it } from "vitest";
import { tokenPost } from "./oauth.js";
import { shapeOfError, wireRecorder } from "./wire.js";

const KEYS = { id: "app-id", secret: "app-secret" };
const URL = "https://auth.example/token";

describe("tokenPost: the request", () => {
  it("keys in the body: id and secret join the form", async () => {
    const r = wireRecorder(() => Response.json({ access_token: "a" }));
    const out = await tokenPost(
      r.fetch,
      URL,
      { grant_type: "refresh_token", refresh_token: "rt" },
      {
        ...KEYS,
        as: "body",
      },
    );
    expect(out).toEqual({ access_token: "a" });
    expect(r.calls).toMatchInlineSnapshot(`
      [
        {
          "form": {
            "client_id": "app-id",
            "client_secret": "app-secret",
            "grant_type": "refresh_token",
            "refresh_token": "rt",
          },
          "headers": {
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          "method": "POST",
          "url": "https://auth.example/token",
        },
      ]
    `);
  });

  it("keys as basic auth: a header, and neither id nor secret in the form", async () => {
    const r = wireRecorder(() => Response.json({ access_token: "a" }));
    await tokenPost(
      r.fetch,
      URL,
      { grant_type: "authorization_code", code: "c" },
      {
        ...KEYS,
        as: "basic",
      },
    );
    expect(r.calls).toMatchInlineSnapshot(`
      [
        {
          "form": {
            "code": "c",
            "grant_type": "authorization_code",
          },
          "headers": {
            "accept": "application/json",
            "authorization": "Basic YXBwLWlkOmFwcC1zZWNyZXQ=",
            "content-type": "application/x-www-form-urlencoded",
          },
          "method": "POST",
          "url": "https://auth.example/token",
        },
      ]
    `);
  });

  it("no client: the form goes as given, with no keys", async () => {
    const r = wireRecorder(() => Response.json({ access_token: "a" }));
    await tokenPost(r.fetch, URL, { grant_type: "client_credentials", scope: "s" });
    expect(r.calls[0]?.form).toEqual({ grant_type: "client_credentials", scope: "s" });
    expect(r.calls[0]?.headers).not.toHaveProperty("authorization");
  });
});

describe("tokenPost: the refusals", () => {
  const refusal = async (status: number, body: unknown) => {
    const r = wireRecorder(() => Response.json(body, { status }));
    return shapeOfError(await tokenPost(r.fetch, URL, {}).catch((e: unknown) => e));
  };

  it("RFC 6749: the code, then the first line of the description", async () => {
    expect(
      await refusal(400, {
        error: "invalid_grant",
        error_description: "AADSTS70000: expired\nTrace ID: 1",
      }),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_grant",
        "isError": true,
        "message": "invalid_grant: AADSTS70000: expired",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
  });

  it("an error with no description is its code alone; a 200 with an error is a refusal", async () => {
    expect(await refusal(400, { error: "invalid_client" })).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "invalid_client",
        "isError": true,
        "message": "invalid_client",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
    expect(await refusal(200, { error: "access_denied" })).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "access_denied",
        "isError": true,
        "message": "access_denied",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
  });

  it("HubSpot answers {status, message}", async () => {
    expect(
      await refusal(400, { status: "BAD_REFRESH_TOKEN", message: "missing or unknown" }),
    ).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "BAD_REFRESH_TOKEN",
        "isError": true,
        "message": "BAD_REFRESH_TOKEN: missing or unknown",
        "name": "OAuthError",
        "revoked": true,
      }
    `);
  });

  it("no body: http_<status>, not revoked; a long description is cut at 200", async () => {
    expect(await refusal(503, {})).toMatchInlineSnapshot(`
      {
        "class": "OAuthError",
        "code": "http_503",
        "isError": true,
        "message": "http_503",
        "name": "OAuthError",
        "revoked": false,
      }
    `);
    const long = await refusal(400, {
      error: "invalid_request",
      error_description: "x".repeat(300),
    });
    expect(long.message).toBe(`invalid_request: ${"x".repeat(200)}`);
  });

  it("every revoked code, and one that is not", async () => {
    const codes = [
      "invalid_grant",
      "invalid_token",
      "unauthorized_client",
      "interaction_required",
      "expired",
      "temporarily_unavailable",
    ];
    const got = await Promise.all(
      codes.map(async (c) => [c, (await refusal(400, { error: c })).revoked]),
    );
    expect(Object.fromEntries(got)).toMatchInlineSnapshot(`
      {
        "expired": true,
        "interaction_required": true,
        "invalid_grant": true,
        "invalid_token": true,
        "temporarily_unavailable": false,
        "unauthorized_client": true,
      }
    `);
  });
});
