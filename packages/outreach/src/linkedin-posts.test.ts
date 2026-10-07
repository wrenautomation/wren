/**
 * Reach targeting in code (designs/2026-10-07-reach-targeting.md): job ads, job seekers and
 * posts for job seekers are off; an owner in the audience's world ranks above a vendor to it;
 * search words rest when they find nothing on target, and the model's new ones are checked.
 * Every post here is synthetic, shaped like the cases the model caught on prod.
 */
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import {
  authorFit,
  DEFAULT_AUDIENCE,
  type FeedPost,
  isJobAd,
  jobPost,
  MIN_FIT,
  planTopics,
  proposeTopics,
  REST_AFTER,
  rankPost,
} from "./linkedin-posts.js";

const NOW = new Date("2026-10-07T15:00:00Z");
const post = (o: Partial<FeedPost> = {}): FeedPost => ({
  urn: "urn:li:activity:1",
  author: "Sam Example",
  authorUrl: "https://www.linkedin.com/in/sam-example",
  text: "Our recruiting agency spends hours chasing candidates for interview slots every week.",
  at: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
  reactions: 10,
  comments: 2,
  url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
  ...o,
});
const rank = (p: FeedPost, topics: string[] = []) =>
  rankPost(p, { topics, key: false, foundBy: "topic: x", maxAgeHours: 72, now: NOW });

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
  });

  it("job posts are off with their reason", () => {
    expect(rank(post({ text: "#hiring Office Coordinator. Apply here." })).off).toBe("a job ad");
    expect(
      rank(post({ text: "Our recruiting agency can get you a job this week. Students welcome." }))
        .off,
    ).toBe("for job seekers");
  });

  it("authorFit: tiers, sellers, no headline", () => {
    const a = [...DEFAULT_AUDIENCE];
    expect(authorFit("", a)).toEqual({ points: 0, kind: null });
    expect(authorFit("CEO, Acme Staffing", a).kind).toBe("buyer");
    expect(authorFit("CEO, Acme Bakery", a).kind).toBe("owner");
    expect(authorFit("Director, Acme Recruiting", a).kind).toBe("manager");
    expect(authorFit("Fractional COO | Helping agency owners scale", a).kind).toBe("seller");
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

  it("an unreadable answer is no new words", async () => {
    const llm = new FakeLlm({ default: "not json" });
    expect(await proposeTopics(llm, { about: "x", n: 3, yields: [], known: [] })).toEqual([]);
  });
});
