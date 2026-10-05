import { describe, expect, it } from "vitest";
import { keepTeam, type TeamProfile, teamQuery } from "./team.js";

const firm = { name: "Acme Staffing LLC", domain: "acmestaffing.example" };
const p = (
  name: string,
  vanity: string,
  roles: TeamProfile["roles"],
  url = `https://www.linkedin.com/in/${vanity}`,
): TeamProfile => ({ name, url, headline: null, roles });

describe("teamQuery", () => {
  it("searches the firm's bare name", () => {
    expect(teamQuery(firm)).toBe("Acme Staffing");
  });
  it("a firm with no name worth a search is not searched", () => {
    expect(teamQuery({ name: "AB", domain: null })).toBeNull();
  });
});

describe("keepTeam", () => {
  it("keeps current staff at the firm with their role and one spelling of the profile", () => {
    const out = keepTeam(firm, [
      p("Jane Doe", "Jane-Doe", [
        { title: "Recruiter", company: "Globex", current: false },
        { title: "Managing Partner", company: "Acme Staffing", current: true },
      ]),
      p("Jane Doe", "jane-doe", [{ title: "Partner", company: "Acme Staffing", current: true }]),
    ]);
    expect(out).toEqual([
      {
        fullName: "Jane Doe",
        firstName: "Jane",
        lastName: "Doe",
        title: "Managing Partner",
        linkedin: "https://www.linkedin.com/in/jane-doe/",
        vanity: "jane-doe",
      },
    ]);
  });

  it("skips past staff, other firms, headline-only mentions, one-word names and non-profiles", () => {
    expect(
      keepTeam(firm, [
        p("Sam Poe", "sam-poe", [{ title: "Recruiter", company: "Acme Staffing", current: false }]),
        p("Ann Lee", "ann-lee", [{ title: "Owner", company: "Acme Robotics", current: true }]),
        { ...p("Bo Ray", "bo-ray", []), headline: "Ex Acme Staffing" },
        p("Cher", "cher", [{ title: "Partner", company: "Acme Staffing", current: true }]),
        p(
          "Kim Ito",
          "kim",
          [{ title: "Partner", company: "Acme Staffing", current: true }],
          "https://www.linkedin.com/company/acme-staffing/",
        ),
      ]),
    ).toEqual([]);
  });
});
