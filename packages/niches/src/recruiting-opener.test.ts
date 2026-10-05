/** The recruiting templates as a lead reads them. */
import { CALL_TIMES, render, sentenceReady } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { recruiting } from "./index.js";

const tpl = () => {
  const t = recruiting.templates.get("book-first/opener");
  if (t === undefined) throw new Error("missing book-first/opener");
  return t;
};
const terms: Readonly<Record<string, string>> = recruiting.offerFacts.get("reactivation") ?? {};
// Through sentenceReady, as compose does: `company_short` is derived there.
const base: Record<string, unknown> = {
  ...sentenceReady({ first_name: "Dana", company_name: "Tulsa Nurse Partners", title: "Owner" })
    .values,
  ...terms,
  "call.times": CALL_TIMES,
};
const body = (facts: Record<string, unknown>) => render(tpl(), facts, "person:7").body;

describe("recruiting book-first opener", () => {
  it("never prints a free-form company line: personalization is templated", () => {
    const line = "A line about the firm from research.";
    for (const name of ["book-first/opener", "watch-first/opener"])
      expect(
        render(named(name), { ...base, "company.opener": line }, "person:7").body,
      ).not.toContain(line);
  });

  it("opens on the cold read, names the problem, then says who William is", () => {
    const b = body(base);
    expect(b).toMatch(
      /^Hi Dana,\n\nI've (been following Tulsa Nurse for a while|followed Tulsa Nurse for a while now)\. (I'm a college student|As a college student)/,
    );
    expect(b).toContain("University of Waterloo");
    expect(b).toMatch(
      /built internal production tools for the Government of Canada\. I.ve also worked with Microsoft.s and Google.s backend systems\./,
    );
    expect(b).toContain("I think you're missing out on hundreds of thousands in revenue.");
    expect(b).toMatch(/hiring/i);
    expect(b.indexOf("hundreds of thousands")).toBeLessThan(b.indexOf("University of Waterloo"));
  });

  it("asks for a call with a Google Meet invite and drops the old claims", () => {
    const b = body(base);
    expect(b).toMatch(/(Are you down to hop on a|Are you open to a quick) 30 min call /);
    expect(b).toContain(`30 min call ${CALL_TIMES}?`);
    expect(b).toContain("Google Meet invite");
    expect(b).toContain("you don't pay me at all");
    for (const gone of [
      "I found you",
      "How does",
      "production systems",
      "calendar invite",
      "firms at a time",
      "new domain",
      "I'd bet",
      "I know you're busy",
      "every dollar back",
      "Just not through you",
      "Tulsa Nurse Partners",
      "university research",
      "uni ",
      "coop",
      "I love",
      "missing out on clients",
    ]) {
      expect(b).not.toContain(gone);
    }
  });

  it("scans on a phone: at most two sentences a paragraph", () => {
    for (let i = 0; i < 20; i++) {
      const b = render(tpl(), base, `person:${i}`).body;
      for (const para of b.split("\n\n"))
        expect(para.split(/[.?!] /).length).toBeLessThanOrEqual(2);
    }
  });

  it("varies every paragraph so no two firms get the same text", () => {
    const bodies = new Set(
      Array.from({ length: 40 }, (_, i) => render(tpl(), base, `person:${i}`).body),
    );
    expect(bodies.size).toBeGreaterThan(15);
    for (const para of body(base).split("\n\n").slice(1, -2)) {
      expect([...bodies].some((b) => !b.includes(para))).toBe(true);
    }
  });

  it("subject is a curiosity loop that gives no pitch away; a role inbox drops the name", () => {
    const subj = (facts: Record<string, unknown>, seed: string) =>
      render(tpl(), facts, seed).subject ?? "";
    const { first_name: _, ...company } = base;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = subj(base, `person:${i}`);
      seen.add(s);
      expect(s).toMatch(
        /^Dana, ((something interesting about|about) your clients|love your work|cool company)$/,
      );
      expect(subj(company, `person:${i}`)).toBe(s.slice("Dana, ".length));
    }
    expect(seen.size).toBe(4);
  });

  it("no subject uses the money lines that landed in junk", () => {
    for (const name of ["book-first/opener", "book-first/followup"]) {
      for (let i = 0; i < 20; i++) {
        expect(render(named(name), base, `person:${i}`).subject).not.toMatch(
          /six figures|dozens of placements|old clients|past clients|CRM|full of revenue|missing|quick question/,
        );
      }
    }
  });

  it("the follow-up opens on a one-line bump, restates the opener, under its own subject", () => {
    const f = recruiting.templates.get("book-first/followup");
    if (f === undefined) throw new Error("missing book-first/followup");
    const r = render(f, base, "person:7");
    expect(r.subject).toMatch(/^Dana, /);
    expect(r.subject).not.toBe(render(tpl(), base, "person:7").subject);
    expect(r.body).toContain("University of Waterloo");
    expect(r.body).toMatch(/hiring/i);
    expect(r.body).toMatch(
      /^Dana, bumping (this in case it got buried|my last email in case you missed it)\.\n\n/,
    );
    expect(r.body).not.toMatch(/following up|^(Hi|Hey) /im);
    expect(r.body).toContain("you don't pay me at all");
    expect(r.body).toContain(CALL_TIMES);
    const { first_name: _, ...company } = base;
    expect(render(f, company, "person:7").body).toMatch(/^Hi there, bumping /);
  });

  it("asks for the times, quotes the offer's terms, and leaves no syntax behind", () => {
    const b = body(base);
    expect(b).toMatch(/I'll send a Google Meet invite\.\n\nWilliam$/);
    expect(b).toContain(CALL_TIMES);
    expect(b).toContain(`${terms["offer.goal"]} meetings in ${terms["offer.days"]} days`);
    expect(b.replace(CALL_TIMES, "")).not.toMatch(/[{}]|\[\[|\(\(|\]\]|\)\)/);
  });
});

const named = (name: string) => {
  const t = recruiting.templates.get(name);
  if (t === undefined) throw new Error(`missing ${name}`);
  return t;
};

describe("recruiting watch-first", () => {
  it("the opener and follow-up offer the demo", () => {
    for (const name of ["watch-first/opener", "watch-first/followup"]) {
      const b = render(named(name), base, "person:7").body;
      expect(b).toMatch(/send you a quick demo\./);
      expect(b).not.toContain("curious how I'll pull that off");
    }
    expect(render(named("watch-first/opener"), base, "person:7").body).toContain(
      "If you're curious, I can send you a quick demo.",
    );
    expect(render(named("watch-first/followup"), base, "person:7").body).toMatch(
      /^Dana, just checking in on the email I sent a few days ago\./,
    );
  });

  it("both arms send a follow-up", () => {
    expect(recruiting.sequences.get("watch-first-days-0-5")?.steps.map((s) => s.template)).toEqual([
      "watch-first/opener",
      "watch-first/followup",
    ]);
  });
});

describe("recruiting replies (drafted for William's approval)", () => {
  it("book-first names the booked time and rides the thread", () => {
    const r = render(
      named("book-first/reply"),
      { ...base, "call.booked": "Tuesday at 10am ET" },
      "person:7",
    );
    expect(r.subject).toBeNull();
    expect(r.body).toMatch(
      /^(Hi|Hey) Dana,\n\n(Just sent|Sent) you the invite for Tuesday at 10am ET\./,
    );
    expect(r.body).toContain(
      "Looking forward to chatting more about how I can help your business.",
    );
  });

  it("watch-first carries the demo link", () => {
    const r = render(
      named("watch-first/reply"),
      { ...base, "link.watch": "https://x.test/w" },
      "person:7",
    );
    expect(r.subject).toBeNull();
    expect(r.body).toContain("https://x.test/w");
  });
});
