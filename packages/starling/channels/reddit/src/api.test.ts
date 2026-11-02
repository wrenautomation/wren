import { SiteCallError } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { REDDIT_TOKEN_URL, redditApi } from "./api.js";

type Seen = { url: string; init: RequestInit };

function fakeReddit(answer: (s: Seen) => Response) {
  const seen: Seen[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const s = { url, init };
    seen.push(s);
    return answer(s);
  };
  return { seen, fetch };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const opts = { clientId: "id", clientSecret: "sec", refreshToken: "rt", username: "wren_hq" };

describe("redditApi", () => {
  it("mints once, reads with a query, writes a form, sends the User-Agent", async () => {
    let t = 0;
    const r = fakeReddit(({ url }) =>
      url === REDDIT_TOKEN_URL ? json({ access_token: "at1", expires_in: 3600 }) : json({ ok: 1 }),
    );
    const api = redditApi({ ...opts, fetch: r.fetch, now: () => t });
    await api.call("reddit", "GET", "/api/info", { id: "t3_a", raw_json: 1 });
    await api.call("reddit", "POST", "/api/submit", {
      sr: "startups",
      title: "t",
      sendreplies: true,
    });
    t = 3600 * 1000; // past expiry: mint again
    await api.call("reddit", "GET", "/api/v1/me");

    expect(r.seen.map((s) => s.url)).toEqual([
      REDDIT_TOKEN_URL,
      "https://oauth.reddit.com/api/info?id=t3_a&raw_json=1",
      "https://oauth.reddit.com/api/submit",
      REDDIT_TOKEN_URL,
      "https://oauth.reddit.com/api/v1/me",
    ]);
    const mint = r.seen[0]?.init;
    expect(String(mint?.body)).toBe("grant_type=refresh_token&refresh_token=rt");
    expect((mint?.headers ?? {}) as Record<string, string>).toHaveProperty(
      "authorization",
      `Basic ${Buffer.from("id:sec").toString("base64")}`,
    );
    const post = r.seen[2]?.init;
    expect(String(post?.body)).toBe("sr=startups&title=t&sendreplies=true");
    expect(post?.headers).toMatchObject({
      authorization: "bearer at1",
      "user-agent": "server:wren-content:1.0 (by /u/wren_hq)",
      "content-type": "application/x-www-form-urlencoded",
    });
  });

  it("a 401 mints again once; other errors are SiteCallErrors with the status", async () => {
    let n = 0;
    const r = fakeReddit(({ url }) => {
      if (url === REDDIT_TOKEN_URL) return json({ access_token: `at${++n}`, expires_in: 3600 });
      if (url.endsWith("/me")) return n === 1 ? json({}, 401) : json({ name: "wren_hq" });
      return json({ message: "Forbidden" }, 403);
    });
    const api = redditApi({ ...opts, fetch: r.fetch });
    expect(await api.call("reddit", "GET", "/api/v1/me")).toEqual({ name: "wren_hq" });
    await expect(api.call("reddit", "POST", "/api/submit", {})).rejects.toSatisfy(
      (e: unknown) => e instanceof SiteCallError && e.status === 403,
    );
  });

  it("a refused token never echoes the body", async () => {
    const r = fakeReddit(() => json({ error: "invalid_grant", access_token_hint: "secret" }, 400));
    const err = await redditApi({ ...opts, fetch: r.fetch })
      .call("reddit", "GET", "/api/v1/me")
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(SiteCallError);
    expect((err as Error).message).toContain("invalid_grant");
    expect((err as Error).message).not.toContain("secret");
  });
});
