/**
 * Reach targeting in code (designs/2026-10-07-reach-targeting.md): job ads, job seekers and
 * posts for job seekers are off; an owner in the audience's world ranks above a vendor to it;
 * search words rest when they find nothing on target, and the model's new ones are checked.
 * Every post here is synthetic, shaped like the cases the model caught on prod.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import {
  authorFit,
  COMMENTS_SETTINGS,
  type FeedPost,
  isJobAd,
  jobPost,
  MIN_FIT,
  momentum,
  ownCircle,
  phrase,
  planTopics,
  postActs,
  postReader,
  proposeTopics,
  REST_AFTER,
  rankPost,
  shortcodeAt,
  topicCore,
  vanityOf,
  ytPostOf,
} from "./reach-posts.js";

const NOW = new Date("2026-10-07T15:00:00Z");
const post = (o: Partial<FeedPost> = {}): FeedPost => ({
  ref: "urn:li:activity:1",
  author: "Sam Example",
  authorUrl: "https://www.linkedin.com/in/sam-example",
  text: "Our recruiting agency spends hours chasing candidates for interview slots every week.",
  at: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
  reactions: 10,
  comments: 2,
  url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
  ...o,
});
/** A one-trade audience (synthetic): the rank's mechanism, not Wren's default buyers. */
const TRADE = [
  "recruit",
  "staffing",
  "headhunt",
  "talent acquisition",
  "placement",
  "executive search",
  "search firm",
  "candidate",
  "rpo",
  "agency owner",
];
const rank = (p: FeedPost, topics: string[] = []) =>
  rankPost(p, {
    topics,
    audience: TRADE,
    key: false,
    foundBy: "topic: x",
    halfLifeHours: 36,
    now: NOW,
  });

describe("jobPost", () => {
  it("job ads the old regex missed", () => {
    const ads = [
      // A facility's opening: one year, not "years", of experience; resumes to an address.
      "A clinic in Springfield is looking for an X-ray tech for the day shift. 5 days per week, 8-hour shifts. Candidates must have at least 1 year of experience. Interested candidates can send their resumes to jobs@example.com.",
      // Field labels, no hiring words.
      "Senior Analyst, Fan Marketing\nLocation: Remote (Canada)\nRate: 100K\nBonus: 10%\nInterview: 3 rounds\nClient: a media group",
      // Curly apostrophe and emoji labels.
      "WE’RE HIRING BUSINESS DEVELOPMENT OFFICER 📍 Location: Nairobi 💼 Employment Type: Full-Time",
      "We are recruiting reliable distributors worldwide for our testing equipment.",
    ];
    for (const t of ads) expect(jobPost(t), t).toBe("a job ad");
  });

  it("job seekers, by the post or the headline", () => {
    expect(
      jobPost(
        "I built a deck on support costs. Happy to share it if you're recruiting for an operations analyst role, or to join an interview.",
      ),
    ).toBe("a job seeker");
    expect(
      jobPost(
        "Twenty years of shipping systems that still run.",
        "Software engineer | Available for part-time remote work",
      ),
    ).toBe("a job seeker");
    expect(jobPost("I am currently looking for a part-time, remote role. Open to work.")).toBe(
      "a job seeker",
    );
  });

  it("posts for job seekers", () => {
    expect(
      jobPost(
        "How fast can an agency get you a job? With us, sometimes the same day. Keep your phone on.",
      ),
    ).toBe("for job seekers");
    expect(
      jobPost(
        "Spoke to a room of students today about how to land a job in marketing after they graduate.",
      ),
    ).toBe("for job seekers");
  });

  it("leaves owners' posts about clients and the firm alone", () => {
    const owners = [
      "Our recruiting agency lost two retainer clients last year. The pipeline was all referrals and no outreach.",
      "I started my own search firm eight years ago. The first client paid late; the pipeline was all referrals.",
      "Every client asks what the bill rate covers. Our staffing agency breaks it down: pay, taxes, insurance.",
      "There's an advantage that doesn't show on any CV: placing someone you already know. Clients come back.",
    ];
    for (const t of owners) {
      expect(jobPost(t), t).toBeNull();
      expect(isJobAd(t)).toBe(false);
    }
  });
});

describe("rankPost", () => {
  it("the default audience is any business: an owner outside recruiting passes (William, 10-26)", () => {
    const r = rankPost(
      post({
        headline: "Founder, Northwind Logistics",
        text: "Our company lost two big clients this year. Our pipeline was all referrals, so we started outreach and follow-ups to grow revenue again.",
      }),
      { topics: [], key: false, foundBy: "topic: x", halfLifeHours: 36, now: NOW },
    );
    expect(r.off).toBeNull();
    expect(r.fit).toBeGreaterThanOrEqual(MIN_FIT);
  });

  const firmText =
    "Our recruiting agency lost two retainer clients last year. The pipeline was all referrals and no outreach. Revenue now comes from old clients we follow up with.";

  it("an owner in their world ranks above a vendor to it", () => {
    const owner = rank(post({ headline: "Founder, Northwind Recruiting", text: firmText }));
    const vendor = rank(
      post({ headline: "Advisor to staffing CEOs | I help agencies grow", text: firmText }),
    );
    const plain = rank(post({ headline: "Founder, Northwind Bakery", text: firmText }));
    expect(owner.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(owner.fit).toBeGreaterThan(plain.fit);
    expect(plain.fit).toBeGreaterThan(vendor.fit);
    expect(vendor.fit).toBeLessThan(MIN_FIT);
    expect(owner.why).toContain("Runs a firm in their world.");
    expect(vendor.why).toContain("Sells to them.");
  });

  it("a pitch costs points; the owner's voice adds them", () => {
    const base = rank(post({ text: firmText }));
    const pitch = rank(post({ text: `${firmText} Book a free call, link in the comments.` }));
    const voice = rank(
      post({ text: firmText.replace("Our recruiting agency", "The recruiting agency") }),
    );
    expect(pitch.fit).toBeLessThan(base.fit);
    expect(pitch.why).toContain("Pitches.");
    expect(voice.fit).toBeLessThan(base.fit);
  });

  it("an owner in the world need not name it; anyone else must", () => {
    const text =
      "Two clients paused this quarter. Pipeline is thin, so we went back to old referrals.";
    expect(rank(post({ headline: "Owner, Northwind Staffing", text })).off).toBeNull();
    expect(rank(post({ headline: "Recruiter", text })).off).toMatch(/^not about recruit/);
    expect(rank(post({ text })).off).toMatch(/^not about recruit/);
    // Someone we invited is in the world already.
    const known = rankPost(post({ headline: "Recruiter", text }), {
      topics: [],
      key: true,
      foundBy: "person: x",
      halfLifeHours: 36,
      now: NOW,
    });
    expect(known.off).toBeNull();
  });

  it("a boolean search hits on its quoted phrase", () => {
    const q = '"recruiting agency" (clients OR "business development")';
    expect(topicCore(q)).toBe("recruiting agency");
    expect(topicCore("staffing agency")).toBe("staffing agency");
    expect(rank(post(), [q]).why).toContain(`On "${q}".`);
  });

  it("topic, title, people we know rank above a bare match", () => {
    const o = {
      topics: ["recruiting agency"],
      audience: TRADE,
      foundBy: "x",
      halfLifeHours: 36,
      now: NOW,
    };
    const plain = rankPost(post({ text: "Nothing to see here at all, a long enough line." }), {
      ...o,
      key: false,
    });
    const topic = rankPost(post({ headline: "Recruiter" }), { ...o, key: false });
    const founder = rankPost(post({ headline: "Founder, Acme Recruiting" }), { ...o, key: false });
    const vp = rankPost(post({ headline: "Vice President, Recruiting" }), { ...o, key: false });
    const known = rankPost(post({ headline: "Recruiter" }), { ...o, key: true });
    expect(topic.fit).toBeGreaterThan(plain.fit);
    expect(founder.fit).toBeGreaterThan(vp.fit);
    expect(vp.fit).toBeGreaterThan(topic.fit);
    expect(known.fit).toBeGreaterThan(founder.fit);
    expect(founder.why).toContain('On "recruiting agency".');
  });

  it("growing a recruiting firm ranks above a recruiter's day", () => {
    const on = ["recruiting agency"];
    const growth = rank(post({ headline: "Founder, a search firm", text: firmText }), on);
    const day = rank(post({ headline: "Recruiter" }), on);
    expect(growth.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(day.fit).toBeLessThan(MIN_FIT);
    expect(growth.why).toContain("Talks");
  });

  it("job ads and seekers are off; so is a post outside the world", () => {
    const ads = [
      "#hiring Office Coordinator. Apply here: https://example.com/job. Job Title: Office Coordinator.",
      "WE'RE HIRING: Business Development Officer. Location: Remote. Requirements: 3 years of experience, full-time.",
      "A clinic is actively looking for a night nurse. Full-time, day shift or night shift, benefits include dental.",
      "I am currently looking for a part-time, remote role as a recruiter. Open to work.",
    ];
    for (const text of ads) {
      expect(isJobAd(text), text).toBe(true);
      expect(rank(post({ text }), ["client reactivation"]).off).toMatch(/^a job (ad|seeker)$/);
    }
    const elsewhere = rank(
      post({
        text: "Most contractors stop following up the day the job is done. The CRM holds the money.",
      }),
    );
    expect(elsewhere.off).toMatch(/^not about recruit/);
    expect(rank(post()).off).toBeNull();
    expect(isJobAd(post().text)).toBe(false);
  });

  it("job posts are off with their reason", () => {
    expect(rank(post({ text: "#hiring Office Coordinator. Apply here." })).off).toBe("a job ad");
    expect(
      rank(post({ text: "Our recruiting agency can get you a job this week. Students welcome." }))
        .off,
    ).toBe("for job seekers");
  });

  it("authorFit: tiers, sellers, no headline", () => {
    const a = TRADE;
    expect(authorFit("", a)).toEqual({ points: 0, kind: null });
    expect(authorFit("CEO, Acme Staffing", a).kind).toBe("buyer");
    expect(authorFit("CEO, Acme Bakery", a).kind).toBe("owner");
    expect(authorFit("Director, Acme Recruiting", a).kind).toBe("manager");
    expect(authorFit("Fractional COO | Helping agency owners scale", a).kind).toBe("seller");
    // The trade's own title is staff, not a vendor; a consultant to the trade still sells.
    expect(authorFit("Senior Recruitment Consultant at Acme Staffing", a)).toEqual({
      points: 5,
      kind: "manager",
    });
    expect(authorFit("Director | Staffing Consultant", a).kind).toBe("manager");
    expect(authorFit("Growth consultant to staffing firms", a).kind).toBe("seller");
    expect(authorFit("Recruitment Consultant | I help agencies grow", a).kind).toBe("seller");
  });
});

describe("planTopics", () => {
  const y = (topic: string, read: number, onTarget: number) => ({ topic, read, onTarget });

  it("his own by yield, untried first; nothing on target lately rests", () => {
    const out = planTopics(
      ["staffing agency", "client reactivation", "recruiting agency", "new words"],
      [
        y("staffing agency", 20, 2),
        y("client reactivation", REST_AFTER, 0),
        y("recruiting agency", 20, 6),
      ],
      [],
      0,
    );
    expect(out.rested).toEqual(["client reactivation"]);
    expect(out.topics).toEqual(["new words", "recruiting agency", "staffing agency"]);
  });

  it("few reads with none on target do not rest yet", () => {
    expect(planTopics(["lead follow-up"], [y("lead follow-up", 9, 0)], [], 0).rested).toEqual([]);
  });

  it("extra slots: proven model words, then new ones; one slot always explores", () => {
    const out = planTopics(
      ["mine"],
      [y("proven a", 10, 4), y("proven b", 10, 3), y("weak", 10, 1), y("dead", REST_AFTER, 0)],
      ["dead", "MINE", "fresh one", "fresh two"],
      3,
    );
    expect(out.topics).toEqual(["mine", "proven a", "proven b", "fresh one"]);
    // With the trade's words, a past model word that names no trade is not reused.
    expect(
      planTopics(["mine"], [y("firm growth", 10, 4), y("staffing fees", 10, 3)], [], 2, [
        "staffing",
      ]).topics,
    ).toEqual(["mine", "staffing fees"]);
    expect(planTopics(["mine"], [y("proven a", 10, 4)], ["fresh"], 1).topics).toEqual([
      "mine",
      "fresh",
    ]);
  });
});

describe("proposeTopics", () => {
  it("keeps short phrases that bring no job ads and are not known; tells the model the yields", async () => {
    const asked: string[] = [];
    const llm = new FakeLlm({
      respond: (prompt) => {
        asked.push(prompt);
        return JSON.stringify({
          topics: [
            '"my staffing agency"',
            "we're hiring recruiters",
            "Recruiting Agency",
            "our clients",
            "a phrase with far too many words to search",
            "my staffing agency",
            "lost a retainer client",
          ],
        });
      },
    });
    const out = await proposeTopics(llm, {
      about: "Owners of small firms.",
      n: 2,
      yields: [
        { topic: "recruiting agency", read: 20, onTarget: 3 },
        { topic: "client reactivation", read: 20, onTarget: 0 },
      ],
      known: ["recruiting agency"],
    });
    expect(out).toEqual(["my staffing agency", "our clients"]);
    expect(asked[0]).toContain("Owners of small firms.");
    expect(asked[0]).toContain('"recruiting agency" 3/20');
    expect(asked[0]).toContain('Found none of their posts: "client reactivation"');
  });

  it("with the trade's words, keeps only phrases that name the trade", async () => {
    const asked: string[] = [];
    const llm = new FakeLlm({
      respond: (prompt) => {
        asked.push(prompt);
        return JSON.stringify({
          topics: [
            "our clients",
            "Recruiting firm growth",
            "staffing agency fees",
            "sales pipeline",
          ],
        });
      },
    });
    const out = await proposeTopics(llm, {
      about: "Owners of small firms.",
      n: 3,
      yields: [],
      known: [],
      audience: ["recruit", "staffing"],
    });
    expect(out).toEqual(["Recruiting firm growth", "staffing agency fees"]);
    expect(asked[0]).toContain("one of these words: recruit, staffing");
  });

  it("an unreadable answer is no new words", async () => {
    const llm = new FakeLlm({ default: "not json" });
    expect(await proposeTopics(llm, { about: "x", n: 3, yields: [], known: [] })).toEqual([]);
  });
});

describe("search words", () => {
  it("plain words with a space search as one phrase; operators stay", () => {
    expect(phrase("recruitment agency")).toBe('"recruitment agency"');
    expect(phrase(" staffing ")).toBe("staffing");
    expect(phrase('"recruiting agency" (clients OR fees)')).toBe(
      '"recruiting agency" (clients OR fees)',
    );
    expect(phrase("agency owner -hiring")).toBe("agency owner -hiring");
    expect(phrase("#recruitmentagency")).toBe("#recruitmentagency");
  });

  it("an Instagram shortcode tells when the post was made, with no page load", () => {
    // A synthetic code: media id (2026-10-24T12:00:00Z - epoch) << 23, in Instagram's base64.
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const at = Date.parse("2026-10-24T12:00:00Z");
    let id = BigInt(at - 1_314_220_021_721) << 23n;
    let code = "";
    while (id > 0n) {
      code = A[Number(id % 64n)] + code;
      id /= 64n;
    }
    expect(shortcodeAt(code)?.toISOString()).toBe("2026-10-24T12:00:00.000Z");
    expect(shortcodeAt("bad!code")).toBeNull();
  });
});

describe("Instagram search", () => {
  const sites = (fail: (code: string) => Error | null): SiteClient => ({
    via: async () => "browser",
    call: async <T>(_site: string, _m: string, path: string): Promise<T> => {
      if (path === "/web/search") return { shortcodes: ["AAA", "BBB", "CCC"] } as T;
      const code = path.split("/").pop() ?? "";
      const err = fail(code);
      if (err) throw err;
      return {
        shortcode: code,
        url: `https://www.instagram.com/p/${code}/`,
        username: "sam.example",
        caption: "Our recruiting agency lost a client.",
        likes: 1,
        comments: 0,
        timestamp: NOW.toISOString(),
      } as T;
    },
  });
  const search = (s: SiteClient) =>
    postReader(s, "instagram", "instagram", { now: NOW }).search("recruitmentagency", "past-24h");

  it("a post page that fails costs only itself", async () => {
    const out = await search(sites((c) => (c === "BBB" ? new Error("did not render") : null)));
    expect(out.map((p) => p.ref).sort()).toEqual(["AAA", "CCC"]);
  });

  it("a used cap ends the search; all failing is an error", async () => {
    const cap = new SiteCallError(
      "instagram",
      "GET",
      "/web/p/BBB",
      429,
      "capped, retry after 36000s",
    );
    await expect(search(sites((c) => (c === "BBB" ? cap : null)))).rejects.toBe(cap);
    await expect(search(sites(() => new Error("did not render")))).rejects.toThrow(
      "did not render",
    );
  });
});

describe("home feeds", () => {
  /** A desk that answers one route and records each call. */
  const desk = (answer: unknown) => {
    const calls: string[] = [];
    const sites: SiteClient = {
      via: async () => "browser",
      call: async <T>(site: string, m: string, path: string, input?: unknown, acct?: string) => {
        calls.push(`${acct} ${site} ${m} ${path} ${JSON.stringify(input)}`);
        return answer as T;
      },
    };
    return { sites, calls };
  };
  const at = NOW.toISOString();

  it("LinkedIn: one /feed load as the account", async () => {
    const { sites, calls } = desk({
      posts: [
        {
          urn: "urn:li:activity:1",
          author: "Sam Example",
          authorUrl: "https://www.linkedin.com/in/sam-example/",
          text: "We placed nine nurses.",
          at,
          reactions: 3,
          comments: 1,
          url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        },
      ],
    });
    const out = await postReader(sites, "linkedin", "linkedin@test", { now: NOW }).feed();
    expect(calls).toEqual(['linkedin@test linkedin GET /feed {"max":50}']);
    expect(out.map((p) => [p.ref, p.handle])).toEqual([["urn:li:activity:1", "sam-example"]]);
  });

  it("X: the home timeline; reposts and pinned posts are left", async () => {
    const t = (id: string, more = {}) => ({
      id,
      text: `post ${id}`,
      author_username: "SamExample",
      author_name: "Sam",
      created_at: at,
      ...more,
    });
    const { sites, calls } = desk({
      data: [t("1"), t("2", { reposted_by: "Kim" }), t("3", { pinned: true })],
    });
    const out = await postReader(sites, "x", "x@test", { now: NOW }).feed();
    expect(calls).toEqual([
      'x@test x GET /2/users/me/timelines/reverse_chronological {"id":"me","max_results":50}',
    ]);
    expect(out.map((p) => [p.ref, p.handle])).toEqual([["1", "samexample"]]);
  });

  it("Instagram: /web/feed; a post with no owner is left", async () => {
    const post = {
      shortcode: "AAA",
      url: "https://www.instagram.com/p/AAA/",
      username: "sam.example",
      caption: "Our agency grew.",
      likes: 4,
      comments: 0,
      timestamp: at,
    };
    const { sites, calls } = desk({ data: [post, { ...post, shortcode: "BBB", username: null }] });
    const out = await postReader(sites, "instagram", "instagram", { now: NOW }).feed();
    expect(calls).toEqual(['instagram instagram GET /web/feed {"max":50}']);
    expect(out.map((p) => p.ref)).toEqual(["AAA"]);
  });
});

describe("vanityOf", () => {
  it("decodes a non-Latin slug so it fits the handle column", () => {
    const slug = encodeURIComponent("مصطفى-عبد-الحميد-محمد-62b041209");
    expect(slug.length).toBeGreaterThan(120);
    expect(vanityOf(`https://www.linkedin.com/in/${slug}/`)).toBe(
      "مصطفى-عبد-الحميد-محمد-62b041209",
    );
  });
  it("lowercases, keeps a bad escape as is, drops one past 120", () => {
    expect(vanityOf("https://www.linkedin.com/in/Sam-Example?x=1")).toBe("sam-example");
    expect(vanityOf("https://www.linkedin.com/in/50%-off")).toBe("50%-off");
    expect(vanityOf(`https://www.linkedin.com/in/${"a".repeat(121)}`)).toBeNull();
    expect(vanityOf(null)).toBeNull();
  });
});

describe("COMMENTS_SETTINGS account", () => {
  const ok = (p: keyof typeof COMMENTS_SETTINGS, account: string) =>
    COMMENTS_SETTINGS[p].safeParse({ account }).success;

  it("off by default; never his own login or the research alt", () => {
    expect(COMMENTS_SETTINGS.linkedin.parse({})).toMatchObject({
      account: "",
      perDay: 10,
      minFit: MIN_FIT,
    });
    expect(MIN_FIT).toBe(70);
    expect(ok("linkedin", "linkedin")).toBe(false);
    expect(ok("linkedin", "linkedin@alt")).toBe(false);
    expect(ok("linkedin", "reddit@wren")).toBe(false);
  });

  it("takes YouTube as a Google login: its token is kept there", () => {
    expect(ok("youtube", "google@wren")).toBe(true);
    expect(ok("youtube", "youtube")).toBe(false);
    expect(ok("youtube", "youtube@wren")).toBe(false);
  });

  it("takes Threads as an Instagram login", () => {
    expect(ok("threads", "instagram")).toBe(true);
    expect(ok("threads", "threads")).toBe(false);
  });
});

describe("ownCircle", () => {
  const post = (platform: string, text: string, headline: string | null = null) => ({
    platform: platform as "instagram",
    handle: "someone",
    author: "Someone",
    headline,
    text,
  });

  it("finds a UWaterloo student on Instagram and Threads", () => {
    expect(ownCircle(post("instagram", "first week done", "SE '29 @ uwaterloo"))).toBe(true);
    expect(ownCircle(post("threads", "co-op hunt at Waterloo is wild"))).toBe(true);
    expect(ownCircle(post("instagram", "", "University of Waterloo"))).toBe(true);
    expect(ownCircle(post("threads", "", "cs 2029"))).toBe(true);
  });

  it("leaves a Waterloo business owner, and X", () => {
    expect(ownCircle(post("instagram", "Our Waterloo bakery hit 20 staff"))).toBe(false);
    expect(ownCircle(post("x", "", "SE '29 @ uwaterloo"))).toBe(false);
  });

  it("drops the like and follow, keeps the comment", () => {
    const p = {
      ...post("instagram", "", "uwaterloo se 29"),
      ref: "abc",
      likedAt: null,
      followedAt: null,
      authorUrl: null,
    } as unknown as Parameters<typeof postActs>[0];
    const acts = postActs(p, { like: true, follow: true }, "hi");
    expect(acts.like).toBeNull();
    expect(acts.follow).toBeNull();
    expect(acts.comment).not.toBeNull();
  });
});

describe("ytPostOf", () => {
  const video = (snippet: Record<string, string>) => ({
    id: "v1",
    snippet: { title: "How a founder grew sales", channelId: "UCx", ...snippet },
    statistics: { likeCount: "3", commentCount: "1" },
  });

  it("drops gaming and news videos and ones not in English", () => {
    expect(ytPostOf(video({ categoryId: "20" }))?.off).toBe("a gaming video");
    expect(ytPostOf(video({ categoryId: "25" }))?.off).toBe("a news video");
    expect(ytPostOf(video({ categoryId: "27", defaultAudioLanguage: "tr" }))?.off).toBe(
      "not in English",
    );
  });

  it("keeps a how-to video in English", () => {
    const p = ytPostOf(video({ categoryId: "26", defaultAudioLanguage: "en-US" }));
    expect(p?.off).toBeUndefined();
    expect(p?.handle).toBe("UCx");
  });
});

describe("momentum", () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  it("a viral post two days on outranks a quiet new one (LinkedIn's 36 h half-life)", () => {
    const viral = rank(post({ at: at(48), reactions: 400, comments: 80 }));
    const quiet = rank(post({ at: at(2), reactions: 2, comments: 0 }));
    expect(viral.fit).toBeGreaterThan(quiet.fit);
  });
  it("fades on the half-life, never past its most", () => {
    const busy = { reactions: 400, comments: 80 };
    expect(momentum(busy, 1, 36)).toBeLessThanOrEqual(14);
    expect(momentum(busy, 48, 36)).toBeGreaterThan(momentum(busy, 240, 36));
    // The same age is young on YouTube's month and old on X's eight hours.
    expect(momentum(busy, 48, 720)).toBeGreaterThan(momentum(busy, 48, 8));
  });
  it("reads an unknown age as one half-life", () => {
    const p = { reactions: 10, comments: 2 };
    expect(momentum(p, null, 36)).toBe(momentum(p, 36, 36));
  });
  it("a crowded thread costs points: a new comment there is buried", () => {
    expect(momentum({ reactions: 400, comments: 600 }, 6, 36)).toBeLessThan(
      momentum({ reactions: 2200, comments: 0 }, 6, 36),
    );
  });
});
