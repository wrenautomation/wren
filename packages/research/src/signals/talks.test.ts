/** The talks collector: synthetic people, canned iTunes answers, a fake YouTube. */
import { describe, expect, it } from "vitest";
import { YouTubeError, type YouTubeGet } from "../enrichment/youtube.js";
import type { Fetcher } from "../fetch/fetcher.js";
import { signalRefusal } from "../findings.js";
import type { SignalDeps } from "./index.js";
import { decides, pacificDay, talks } from "./talks.js";

const NOW = new Date("2026-10-01T12:00:00Z");

const personRow = (over: Record<string, unknown> = {}) => ({
  person_id: 3,
  full_name: "Jane Quill",
  first_name: "Jane",
  last_name: "Quill",
  title: "Founder & CEO",
  person_linkedin: null,
  id: 7,
  name: "Acme Staffing LLC",
  domain: "acmestaffing.test",
  niche: null,
  country: null,
  linkedin_url: null,
  ...over,
});

function itunes(results: unknown[] | null, status = 200): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    userAgent: "test",
    async get(url) {
      urls.push(url);
      return {
        status,
        url,
        text: results ? JSON.stringify({ resultCount: results.length, results }) : "",
      };
    },
  };
}

function youtube(answer: () => unknown): YouTubeGet & { calls: Record<string, string>[] } {
  const calls: Record<string, string>[] = [];
  return Object.assign(
    async (_resource: string, query: Record<string, string>) => {
      calls.push(query);
      return answer();
    },
    { calls },
  );
}

/** The db answers the person read, then the YouTube count. */
function deps(over: Partial<SignalDeps> & { row?: unknown; spent?: number } = {}): SignalDeps {
  const { row = personRow(), spent = 0, ...rest } = over;
  let n = 0;
  return {
    db: { execute: async () => (n++ === 0 ? (row ? [row] : []) : [{ n: spent }]) } as never,
    sites: null,
    desk: null,
    fetcher: null,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
    googleLeft: 0,
    now: NOW,
    ...rest,
  };
}

const on = talks.settings.parse({});

const episode = (over: Record<string, unknown> = {}) => ({
  wrapperType: "podcastEpisode",
  kind: "podcast-episode",
  trackName: "Scaling a staffing desk with Jane Quill",
  collectionName: "The Synthetic Show",
  description: "Jane Quill, founder of Acme Staffing, on placements.",
  releaseDate: "2026-09-20T00:00:00Z",
  trackViewUrl: "https://podcasts.apple.test/ep/1",
  ...over,
});

const video = (over: Record<string, unknown> = {}) => ({
  id: { kind: "youtube#video", videoId: "abc123" },
  snippet: {
    title: "Jane Quill on hiring",
    description: "A talk from the founder of acmestaffing.test",
    publishedAt: "2026-08-01T15:00:00Z",
    channelTitle: "Synthetic Talks",
  },
  ...over,
});

describe("talks collector", () => {
  it("is built and on, YouTube on and capped, Google off", () => {
    expect(talks.built).toBe(true);
    expect(on).toEqual({ youtube: true, youtubePerDay: 20 });
  });

  it("asks only owner titles", () => {
    for (const t of ["Owner", "Co-Founder", "Managing Director", "Partner", "CEO", "President"])
      expect(decides(t)).toBe(true);
    for (const t of ["Vice President of Sales", "Recruiter", null]) expect(decides(t)).toBe(false);
  });

  it("answers none for other titles without a call", async () => {
    const f = itunes([episode()]);
    const r = await talks.collect(
      deps({ row: personRow({ title: "Recruiter" }), fetcher: f }),
      "p3",
      on,
    );
    expect(r.state).toBe("none");
    expect(f.urls).toEqual([]);
  });

  it("keeps an episode naming the person and firm, drops a same-name stranger", async () => {
    const f = itunes([
      episode(),
      episode({
        trackName: "Jane Quill on gardening",
        description: "Another Jane Quill entirely.",
        trackViewUrl: "https://podcasts.apple.test/ep/2",
      }),
    ]);
    const yt = youtube(() => ({ items: [] }));
    const r = await talks.collect(deps({ fetcher: f, youtube: yt }), "p3", on);
    expect(f.urls[0]).toContain("entity=podcastEpisode");
    expect(f.urls[0]).toContain("term=%22Jane+Quill%22");
    expect(r.state).toBe("found");
    expect(r.signals).toHaveLength(1);
    const [s] = r.signals;
    if (!s) throw new Error("no signal");
    expect(s).toMatchObject({
      personId: 3,
      kind: "talk",
      factKey: "p3:talk:https://podcasts.apple.test/ep/1",
      sourceUrl: "https://podcasts.apple.test/ep/1",
      dated: "published",
      value: { topic: "podcast", show: "The Synthetic Show" },
    });
    expect(s.signalAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(signalRefusal(s)).toBeNull();
    expect(r.tried[0]?.outcome).toBe("2 episodes, 1 kept, 1 dropped");
    expect(yt.calls).toEqual([]);
  });

  it("needs whole words: a longer name is someone else", async () => {
    const f = itunes([episode({ trackName: "Janet Quillson", description: "Acme Staffing" })]);
    const r = await talks.collect(deps({ fetcher: f }), "p3", on);
    expect(r.state).toBe("none");
  });

  it("searches YouTube when iTunes finds nothing", async () => {
    const yt = youtube(() => ({ items: [video()] }));
    const r = await talks.collect(deps({ fetcher: itunes([]), youtube: yt }), "p3", on);
    expect(yt.calls[0]).toMatchObject({ q: '"Jane Quill" Acme Staffing LLC', type: "video" });
    expect(r.state).toBe("found");
    expect(r.signals[0]).toMatchObject({
      factKey: "p3:talk:https://www.youtube.com/watch?v=abc123",
      value: { topic: "video", show: "Synthetic Talks", title: "Jane Quill on hiring" },
    });
  });

  it("skips YouTube when off, missing, or spent for the day", async () => {
    const yt = youtube(() => ({ items: [video()] }));
    const off = await talks.collect(deps({ fetcher: itunes([]), youtube: yt }), "p3", {
      ...on,
      youtube: false,
    });
    expect(off.state).toBe("none");
    const none = await talks.collect(deps({ fetcher: itunes([]) }), "p3", on);
    expect(none.state).toBe("none");
    expect(yt.calls).toEqual([]);
    const spent = await talks.collect(
      deps({ fetcher: itunes([]), youtube: yt, spent: 20 }),
      "p3",
      on,
    );
    expect(spent.state).toBe("capped");
    expect(spent.retryAt).toEqual(pacificDay(NOW).next);
    expect(yt.calls).toEqual([]);
  });

  it("answers capped at the next Pacific midnight on a quota error", async () => {
    const yt = youtube(() => {
      throw new YouTubeError(403, "quotaExceeded", "YouTube search: quota");
    });
    const r = await talks.collect(deps({ fetcher: itunes([]), youtube: yt }), "p3", on);
    expect(r.state).toBe("capped");
    expect(r.retryAt?.toISOString()).toBe("2026-10-02T07:00:00.000Z");
    expect(r.stop).toBeTruthy();
  });

  it("is unresolved when nothing could be asked", async () => {
    const r = await talks.collect(deps({ fetcher: itunes(null, 500) }), "p3", on);
    expect(r.state).toBe("unresolved");
  });

  it("finds the Pacific day across DST", () => {
    expect(pacificDay(new Date("2026-11-01T10:00:00Z"))).toEqual({
      start: new Date("2026-11-01T07:00:00Z"),
      next: new Date("2026-11-02T08:00:00Z"),
    });
    expect(pacificDay(new Date("2026-01-15T07:59:00Z")).next).toEqual(
      new Date("2026-01-15T08:00:00Z"),
    );
  });
});
