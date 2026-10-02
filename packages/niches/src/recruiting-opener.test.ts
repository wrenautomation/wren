/** The recruiting opener template with and without the company's opener line. */
import { CALL_TIMES, render } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { recruiting } from "./index.js";

const tpl = () => {
  const t = recruiting.templates.get("book-first/opener");
  if (t === undefined) throw new Error("missing book-first/opener");
  return t;
};
const LINE = "You have placed ICU nurses in Tulsa hospitals since 1999.";
const terms: Readonly<Record<string, string>> = recruiting.offerFacts.get("reactivation") ?? {};
const base = {
  first_name: "Dana",
  company_name: "Tulsa Nurse Partners",
  title: "Owner",
  ...terms,
  "call.times": CALL_TIMES,
};
const body = (facts: Record<string, unknown>) => render(tpl(), facts, "person:7").body;

describe("recruiting book-first opener", () => {
  it("puts the line in its own paragraph after the greeting", () => {
    const b = body({ ...base, "company.opener": LINE });
    expect(b.startsWith(`Hi Dana,\n\n${LINE}\n\n`)).toBe(true);
    expect(b).not.toMatch(/\n{3,}/);
  });

  it("no line leaves no gap, whether the fact is absent, null or blank", () => {
    const without = body(base);
    expect(without).toMatch(/^Hi Dana,\n\n[^\n]/);
    expect(without).not.toContain(LINE);
    expect(without).not.toMatch(/\n{3,}/);
    for (const opener of [null, "", "   "]) {
      expect(body({ ...base, "company.opener": opener })).toBe(without);
    }
  });

  it("a role inbox gets the fallback greeting and still the line", () => {
    const { first_name: _, title: __, ...company } = base;
    const b = body({ ...company, "company.opener": LINE });
    expect(b.startsWith(`Hi there,\n\n${LINE}\n\n`)).toBe(true);
  });

  it("the line only changes its own paragraph", () => {
    const withLine = body({ ...base, "company.opener": LINE });
    expect(withLine.replace(`${LINE}\n\n`, "")).toBe(body(base));
  });

  it("opens on the cold read, names the problem, then says who William is", () => {
    const b = body(base);
    expect(b.startsWith("Hi Dana,\n\nI've been following Tulsa Nurse Partners for a while.")).toBe(
      true,
    );
    expect(b).toContain("University of Waterloo");
    expect(b).toContain("Government of Canada");
    expect(b).toContain("missing out on hundreds of thousands in potential revenue");
    expect(b).toMatch(/hiring/i);
    expect(b.indexOf("hundreds of thousands")).toBeLessThan(b.indexOf("University of Waterloo"));
  });

  it("asks for a call with a Google Meet invite and drops the old claims", () => {
    const b = body(base);
    expect(b).toContain(`Are you down to hop on a 30-minute call ${CALL_TIMES}?`);
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
    ]) {
      expect(b).not.toContain(gone);
    }
  });

  it("subject has the first name and a loss; a role inbox drops the name", () => {
    const subj = (facts: Record<string, unknown>) => render(tpl(), facts, "person:7").subject ?? "";
    expect(subj(base)).toMatch(/^Dana, (you're|your) /);
    const { first_name: _, ...company } = base;
    expect(subj(company)).toMatch(/^(you're|your) /);
  });

  it("the follow-up restates the opener, says it follows up, under its own subject", () => {
    const f = recruiting.templates.get("book-first/followup");
    if (f === undefined) throw new Error("missing book-first/followup");
    const r = render(f, base, "person:7");
    expect(r.subject).toMatch(/^Dana, /);
    expect(r.subject).not.toBe(render(tpl(), base, "person:7").subject);
    expect(r.body).toContain("University of Waterloo");
    expect(r.body).toMatch(/hiring/i);
    expect(r.body).toMatch(/following up on my (last email|email from a few days ago)\./i);
    expect(r.body).toContain("you don't pay me at all");
    expect(r.body).toContain(CALL_TIMES);
  });

  it("asks for the times, quotes the offer's terms, and leaves no syntax behind", () => {
    const b = body(base);
    expect(b).toMatch(/\n\n(Thanks|Appreciate it),\nWilliam$/);
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
      "If this sounds too good to be true, I can send you a quick demo.",
    );
    expect(render(named("watch-first/followup"), base, "person:7").body).toMatch(
      /following up on my/i,
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
