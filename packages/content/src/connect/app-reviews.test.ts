import { describe, expect, it } from "vitest";
import {
  callbackOf,
  checkReview,
  DELETION,
  PRIVACY,
  packetOf,
  REVIEWS,
  reviewOf,
} from "./app-reviews.js";

const png = (w: number, h: number) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
};

const site = (pages: Record<string, [number, string]>) => {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (url: string) => {
      asked.push(url);
      const [status, body] = pages[url] ?? [404, "not found"];
      return { status, text: async () => body };
    },
  };
};

describe("app reviews", () => {
  it("every permission a platform asks has its reason written", () => {
    for (const r of REVIEWS)
      for (const [scope, why] of r.scopes)
        expect(why, `${r.id} ${scope}`).not.toBe("Not described yet.");
    const meta = reviewOf("meta-app");
    expect(meta?.scopes.map(([s]) => s)).toContain("instagram_manage_messages");
  });

  it("checks pages for their words, callbacks for being served, keys and the icon", async () => {
    const meta = reviewOf("meta-app");
    if (!meta) throw new Error("no meta-app");
    const s = site({
      [PRIVACY]: [200, "<p>Facebook and Instagram data; to delete it, email me</p>"],
      [DELETION]: [200, "Facebook: Disconnect in the app"],
      [callbackOf("facebook")]: [400, "no sign-in in flight"],
    });
    const checks = await checkReview(meta, {
      fetch: s.fetch,
      hasKey: (n) => n.endsWith("_ID"),
      icon: async () => png(1024, 1024),
    });
    const by = (needle: string) => checks.find((c) => c.need.includes(needle));
    expect(by("_CLIENT_ID")).toMatchObject({ ok: true, detail: "set" });
    expect(by("_CLIENT_SECRET")).toMatchObject({ ok: false, detail: "missing" });
    expect(by("/oauth/social/facebook")).toMatchObject({ ok: true, detail: "served" });
    expect(by("/oauth/social/instagram")).toMatchObject({ ok: false, detail: "answers 404" });
    expect(by(PRIVACY)).toMatchObject({ ok: true });
    expect(by(DELETION)).toMatchObject({ ok: true });
    expect(by("icon")).toMatchObject({ ok: true, detail: "1024x1024" });
    // One fetch per page, however many needs read it.
    expect(s.asked.filter((u) => u === PRIVACY)).toHaveLength(1);
  });

  it("names the words a page is missing; a small icon or no env says so", async () => {
    const google = reviewOf("google-oauth");
    const tiktok = reviewOf("tiktok-app");
    if (!google || !tiktok) throw new Error("missing reviews");
    const s = site({ [PRIVACY]: [200, "Google API Services User Data Policy"] });
    const g = await checkReview(google, {
      fetch: s.fetch,
      hasKey: () => null,
      icon: async () => null,
    });
    expect(g.find((c) => c.need.includes(PRIVACY))?.detail).toBe('missing "Limited Use"');
    expect(g.find((c) => c.need.startsWith("key"))?.detail).toBe("env not loaded here");
    const t = await checkReview(tiktok, {
      fetch: s.fetch,
      hasKey: () => true,
      icon: async () => png(180, 180),
    });
    expect(t.find((c) => c.need.startsWith("icon"))).toMatchObject({
      ok: false,
      detail: "180x180",
    });
  });

  it("a packet holds the fields, permissions, screencast, open items and checks", () => {
    const meta = reviewOf("meta-app");
    if (!meta) throw new Error("no meta-app");
    const text = packetOf(meta, [{ need: "key X", ok: false, detail: "missing" }]);
    expect(text).toContain("Filed: not yet. Filing is held for William's yes.");
    expect(text).toContain(`- Privacy policy URL: ${PRIVACY}`);
    expect(text).toContain("- `pages_manage_posts`: Publishes the posts");
    expect(text).toMatch(/## Screencast\n\n1\. /);
    expect(text).toContain("- TODO key X: missing");
    expect(packetOf(meta, null)).not.toContain("## Checks");
  });
});
