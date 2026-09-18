import { describe, expect, it } from "vitest";
import { looksLikePeoplePage, PEOPLE_PAGE_HINTS, peoplePageCandidates, sameHost } from "./urls.js";

const PHONE_IN_PORT = "https://example.com:+1(832)384-8118";

describe("crawler urls", () => {
  it("unparseable links are not ours", () => {
    expect(sameHost(PHONE_IN_PORT, "example.com")).toBe(false);
    expect(looksLikePeoplePage(PHONE_IN_PORT, "Our team", PEOPLE_PAGE_HINTS)).toBe(false);
  });
  it("same host accepts apex and www only", () => {
    expect(sameHost("https://www.example.com/team", "example.com")).toBe(true);
    expect(sameHost("https://EXAMPLE.com/", "example.com")).toBe(true);
    expect(sameHost("https://blog.example.com/", "example.com")).toBe(false);
  });
  it("people pages match on path or anchor, with extra hints", () => {
    expect(looksLikePeoplePage("https://x.com/our-team", "", PEOPLE_PAGE_HINTS)).toBe(true);
    expect(looksLikePeoplePage("https://x.com/p", "Meet the Staff", PEOPLE_PAGE_HINTS)).toBe(true);
    expect(looksLikePeoplePage("https://x.com/advisors", "", PEOPLE_PAGE_HINTS)).toBe(false);
    expect(
      looksLikePeoplePage("https://x.com/advisors", "", [...PEOPLE_PAGE_HINTS, "advisors"]),
    ).toBe(true);
  });
  it("candidates are same-host, hash-stripped, deduped, ordered", () => {
    const links = [
      { url: "https://x.com/team#a", anchor: "Team" },
      { url: "https://x.com/blog", anchor: "Blog" },
      { url: "https://x.com/team", anchor: "Team again" },
      { url: "https://other.com/team", anchor: "Team" },
      { url: "https://x.com/about", anchor: "" },
    ];
    expect(peoplePageCandidates(links, "x.com", PEOPLE_PAGE_HINTS)).toEqual([
      "https://x.com/team",
      "https://x.com/about",
    ]);
  });
});
