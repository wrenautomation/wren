import { describe, expect, it } from "vitest";
import { fromEdge, toRequest, toResult, type UrlEvent } from "./http.js";

const event = (over: Partial<UrlEvent> = {}): UrlEvent => ({
  rawPath: "/api/auth/sign-in/email",
  rawQueryString: "a=1",
  headers: {
    "content-type": "application/json",
    "x-wren-edge": "s3cret",
    origin: "https://auth.test",
  },
  cookies: ["a=1", "b=2"],
  body: Buffer.from('{"email":"x@y.z"}').toString("base64"),
  isBase64Encoded: true,
  requestContext: { http: { method: "POST" } },
  ...over,
});

describe("fromEdge", () => {
  it("takes only the edge secret", () => {
    expect(fromEdge(event(), "s3cret")).toBe(true);
    expect(fromEdge(event(), "other")).toBe(false);
    expect(fromEdge(event({ headers: {} }), "s3cret")).toBe(false);
  });
  it("refuses everything when no secret is set", () => {
    expect(fromEdge(event(), undefined)).toBe(false);
    expect(fromEdge(event({ headers: { "x-wren-edge": "" } }), "")).toBe(false);
  });
});

describe("toRequest", () => {
  it("rebuilds the browser's call on our origin, without the secret", async () => {
    const req = toRequest(event(), "https://auth.test");
    expect(req.url).toBe("https://auth.test/api/auth/sign-in/email?a=1");
    expect(req.method).toBe("POST");
    expect(req.headers.get("cookie")).toBe("a=1; b=2");
    expect(req.headers.get("x-wren-edge")).toBeNull();
    expect(await req.json()).toEqual({ email: "x@y.z" });
  });
  it("sends no body on GET", () => {
    const req = toRequest(
      event({ requestContext: { http: { method: "GET" } } }),
      "https://auth.test",
    );
    expect(req.body).toBeNull();
  });
});

describe("toResult", () => {
  it("keeps every cookie apart from the other headers", async () => {
    const headers = new Headers({ "content-type": "application/json", location: "/x" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    const out = await toResult(new Response('{"ok":true}', { status: 302, headers }));
    expect(out.statusCode).toBe(302);
    expect(out.cookies).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(out.headers["set-cookie"]).toBeUndefined();
    expect(out.headers.location).toBe("/x");
    expect(Buffer.from(out.body, "base64").toString()).toBe('{"ok":true}');
  });
});
