import { afterEach, describe, expect, it, vi } from "vitest";
import { ingressSend } from "./ingress.js";

afterEach(() => vi.unstubAllGlobals());

describe("ingressSend", () => {
  it("posts a one-way call with its idempotency key, and throws on a refusal", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("nope", { status: seen.length === 1 ? 202 : 500 });
    });
    const ingress = { url: "https://restate.test:8080/", headers: { authorization: "Bearer t" } };
    await ingressSend(ingress, { service: "Books", key: "all", handler: "sync" }, "k1");
    expect(seen[0]?.url).toBe("https://restate.test:8080/Books/all/sync/send");
    const h = new Headers(seen[0]?.init.headers);
    expect(h.get("idempotency-key")).toBe("k1");
    expect(h.get("authorization")).toBe("Bearer t");
    expect(seen[0]?.init.body).toBe("null");
    await expect(
      ingressSend(ingress, { service: "Svc", handler: "go" }, "k2", { a: 1 }),
    ).rejects.toThrow(/ingress Svc\/go: 500/);
  });
});
