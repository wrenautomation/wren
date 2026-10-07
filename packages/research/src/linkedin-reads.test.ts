/** LinkedIn read helpers: synthetic URLs and ids. */
import { describe, expect, it } from "vitest";
import { idTime, postOfUrl, vendorOfSource } from "./linkedin-reads.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const idAt = (iso: string) => (BigInt(Date.parse(iso)) << 22n).toString();

describe("linkedin reads", () => {
  it("a post URL gives its author's vanity and urn; anything else is null", () => {
    const id = idAt("2026-09-22T12:00:00.000Z");
    expect(
      postOfUrl(`https://www.linkedin.com/posts/Avery-Q_hiring-update-activity-${id}-AbCd`),
    ).toEqual({ vanity: "avery-q", urn: `urn:li:activity:${id}`, id });
    expect(
      postOfUrl(`https://uk.linkedin.com/posts/north_wind_our-news-ugcPost-${id}-x?utm=1`),
    ).toMatchObject({ vanity: "north", urn: `urn:li:ugcPost:${id}` });
    expect(postOfUrl("https://www.linkedin.com/in/avery-q")).toBeNull();
    expect(postOfUrl("https://www.linkedin.com/posts/avery-q_no-id")).toBeNull();
  });

  it("an activity id carries its time; one outside 2010..now is null", () => {
    expect(idTime(idAt("2026-09-22T12:00:00.000Z"), NOW)).toEqual(
      new Date("2026-09-22T12:00:00.000Z"),
    );
    expect(idTime(idAt("2027-01-01T00:00:00.000Z"), NOW)).toBeNull();
    expect(idTime("123456789012345", NOW)).toBeNull();
    expect(idTime("not-a-number", NOW)).toBeNull();
  });

  it("the account is vendor linkedin, search linkedin_search", () => {
    expect(vendorOfSource("account")).toBe("linkedin");
    expect(vendorOfSource("search")).toBe("linkedin_search");
  });
});
