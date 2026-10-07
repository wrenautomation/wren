import { describe, expect, it } from "vitest";
import {
  answerOf,
  nameHandle,
  normalizeHandle,
  parseHandle,
  type TouchLine,
  touchesContext,
  touchFacts,
} from "./touches.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const line = (o: Partial<TouchLine>): TouchLine => ({
  id: 1,
  platform: "linkedin",
  handle: "sam-rivera",
  name: null,
  profileUrl: null,
  personId: 7,
  leadId: null,
  kind: "comment",
  direction: "ours",
  account: "wren",
  url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
  text: "Two weeks is fast for travel nurses.",
  at: daysAgo(3),
  response: null,
  responseAt: null,
  ...o,
});

describe("normalizeHandle", () => {
  it("keys LinkedIn on the vanity, any URL shape, and keeps a URN", () => {
    for (const raw of [
      "https://www.linkedin.com/in/Sam-Rivera/",
      "linkedin.com/in/sam-rivera?trk=x",
      "https://uk.linkedin.com/in/sam-rivera",
      "/in/sam-rivera",
      "sam-rivera",
    ])
      expect(normalizeHandle("linkedin", raw)).toEqual({
        platform: "linkedin",
        handle: "sam-rivera",
        url: "https://www.linkedin.com/in/sam-rivera/",
      });
    expect(normalizeHandle("linkedin", "https://www.linkedin.com/in/j%C3%B6rg-x/")?.handle).toBe(
      "jörg-x",
    );
    expect(normalizeHandle("linkedin", "urn:li:person:AbC123")?.handle).toBe(
      "urn:li:person:AbC123",
    );
    expect(normalizeHandle("linkedin", "https://www.linkedin.com/company/Northwind/")).toEqual({
      platform: "linkedin",
      handle: "company:northwind",
      url: "https://www.linkedin.com/company/northwind/",
    });
    expect(normalizeHandle("linkedin", "https://www.linkedin.com/feed/")).toBeNull();
  });

  it("keys X, Instagram and Reddit on the bare handle", () => {
    for (const raw of ["@SamR", "https://x.com/samr", "https://twitter.com/SamR/status/1", "samr"])
      expect(normalizeHandle("x", raw)?.handle).toBe("samr");
    expect(normalizeHandle("x", "id:12345")).toEqual({
      platform: "x",
      handle: "id:12345",
      url: "https://x.com/i/user/12345",
    });
    expect(normalizeHandle("x", "https://x.com/home")).toBeNull();
    for (const raw of ["@sam.rivera", "https://www.instagram.com/Sam.Rivera/", "sam.rivera"])
      expect(normalizeHandle("instagram", raw)?.handle).toBe("sam.rivera");
    expect(normalizeHandle("instagram", "https://www.instagram.com/p/abc/")).toBeNull();
    for (const raw of [
      "u/Jo_Test",
      "/u/jo_test",
      "https://www.reddit.com/user/jo_test/",
      "jo_test",
    ])
      expect(normalizeHandle("reddit", raw)?.handle).toBe("jo_test");
    expect(normalizeHandle("reddit", "https://www.reddit.com/r/startups/")).toBeNull();
  });

  it("keeps a display name as a name handle so the touch isn't lost", () => {
    expect(normalizeHandle("x", "Sam Rivera")).toBeNull();
    expect(nameHandle("x", "  Sam   Rivera ")?.handle).toBe("name:sam rivera");
    expect(nameHandle("myspace", "Sam")).toBeNull();
  });
});

describe("parseHandle", () => {
  it("reads the platform off a URL, a prefix or the shape", () => {
    expect(parseHandle("https://x.com/samr")).toMatchObject({ platform: "x", handle: "samr" });
    expect(parseHandle("x:@samr")).toMatchObject({ platform: "x", handle: "samr" });
    expect(parseHandle("ig:sam.rivera")).toMatchObject({ platform: "instagram" });
    expect(parseHandle("u/jo_test")).toMatchObject({ platform: "reddit", handle: "jo_test" });
    expect(parseHandle("urn:li:person:AbC")).toMatchObject({ platform: "linkedin" });
    expect(parseHandle("linkedin:sam-rivera")).toMatchObject({ handle: "sam-rivera" });
    expect(parseHandle("sam rivera")).toBeNull();
  });
});

describe("touch words", () => {
  it("reads no answer after two weeks, and a kept answer always", () => {
    expect(answerOf(line({ at: daysAgo(3) }), NOW)).toBeNull();
    expect(answerOf(line({ at: daysAgo(20) }), NOW)).toBe("ignored");
    expect(answerOf(line({ kind: "follow", at: daysAgo(20) }), NOW)).toBeNull();
    expect(answerOf(line({ direction: "theirs", at: daysAgo(20) }), NOW)).toBeNull();
    expect(answerOf(line({ response: "replied", at: daysAgo(20) }), NOW)).toBe("replied");
  });

  it("writes the prompt block newest first, with their answer", () => {
    const text = touchesContext(
      [
        line({ id: 2, response: "replied", responseAt: daysAgo(2) }),
        line({
          id: 1,
          platform: "x",
          kind: "follow",
          direction: "theirs",
          text: null,
          at: daysAgo(30),
        }),
      ],
      NOW,
    );
    expect(text).toBe(
      [
        "Earlier touches with them, newest first:",
        '- 2026-10-04 LinkedIn: we commented on their post: "Two weeks is fast for travel nurses." (they replied 2026-10-05)',
        "- 2026-09-07 X: they followed us",
      ].join("\n"),
    );
    expect(touchesContext([], NOW)).toBe("");
  });

  it("cites the mutual touch first in compose facts, and none when there are none", () => {
    const facts = touchFacts(
      [
        line({ id: 3, kind: "dm", at: daysAgo(1) }),
        line({ id: 2, kind: "comment", direction: "theirs", platform: "x", at: daysAgo(9) }),
      ],
      NOW,
    );
    expect(facts).toMatchObject({
      "touch.count": 2,
      "touch.line": "your comment on our X post",
      "touch.platform": "X",
      "touch.days": 9,
      "touch.when": "last week",
    });
    expect(String(facts["touch.context"])).toContain("we messaged them");
    expect(touchFacts([], NOW)).toEqual({});
    // An unanswered DM or invite is no shared history to cite.
    expect(touchFacts([line({ kind: "connect" })], NOW)["touch.line"]).toBeUndefined();
    expect(touchFacts([line({})], NOW)["touch.line"]).toBe("my comment on your LinkedIn post");
  });
});
