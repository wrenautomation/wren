// What a source card says (detailOf). Tests that expose a
// bug assert the correct behavior and are marked "Bug".
import { describe, expect, it } from "vitest";
import type { Source } from "../../api.js";
import { detailOf, kindLabel, viaLabel } from "./bits.js";

const src = (kind: string, value: Record<string, unknown>): Source => ({
  mark: "f1",
  kind,
  via: "search",
  url: null,
  title: null,
  confidence: 0.9,
  observedAt: null,
  value,
});
const detail = (kind: string, value: Record<string, unknown>) => detailOf(src(kind, value));

describe("detailOf", () => {
  it("a job change: now, before, dates; blanks and non-strings drop", () => {
    expect(
      detail("job_change", {
        title: " Senior Recruiter ",
        to: "Initech",
        from: "Umbrella",
        dates: "2024 - now",
      }),
    ).toEqual([
      ["Now", "Senior Recruiter at Initech"],
      ["Before", "Umbrella"],
      ["Dates", "2024 - now"],
    ]);
    expect(detail("job_change", { title: "  ", to: 7, from: null, dates: ["2024"] })).toEqual([]);
    expect(detail("job_change", { to: "Initech" })).toEqual([["Now", "Initech"]]);
  });

  it("still there: a reason wins over the role", () => {
    expect(detail("still_there", { reason: "Their page lists them", title: "Lead" })).toEqual([
      ["How we know", "Their page lists them"],
    ]);
    expect(detail("still_there", { reason: " ", title: "Lead", company: "Acme" })).toEqual([
      ["Role", "Lead at Acme"],
    ]);
  });

  it("left: a last role that isn't an object shows only that they left", () => {
    for (const lastRole of [null, "Lead at Acme", 3, undefined])
      expect(detail("left", { lastRole })).toEqual([["Now", "No current role found"]]);
    expect(detail("left", { lastRole: { title: "Lead", company: "Acme", dates: "2020" } })).toEqual(
      [
        ["Now", "No current role found"],
        ["Last role", "Lead at Acme"],
        ["Dates", "2020"],
      ],
    );
  });

  it("hiring: the count it says, else the roles listed; three roles at most", () => {
    const roles = [
      { title: "Recruiter", location: "Toronto" },
      { title: "Sourcer" },
      { location: "Remote" },
      { title: "Fourth" },
    ];
    expect(detail("hiring", { count: 1200, roles })).toEqual([
      ["Open roles", "1,200"],
      ["Role", "Recruiter, Toronto"],
      ["Role", "Sourcer"],
      ["Role", "Remote"],
    ]);
    expect(detail("hiring", { roles })[0]).toEqual(["Open roles", "4"]);
    expect(detail("hiring", { count: "12", roles: "many" })).toEqual([["Open roles", "0"]]);
    expect(detail("hiring", { count: 0, roles: [{}, { title: " " }] })).toEqual([
      ["Open roles", "0"],
    ]);
  });

  // Bug: detailOf (bits.tsx:188) casts roles to objects without checking; one null (or
  // other non-object) role in a finding's jsonb throws, and the whole emails page fails to render.
  it("Bug: a role that isn't an object is skipped, not a crash", () => {
    expect(() =>
      detail("hiring", { count: 2, roles: [null, { title: "Recruiter" }] }),
    ).not.toThrow();
    expect(detail("hiring", { count: 2, roles: ["Recruiter", 3] })).toEqual([["Open roles", "2"]]);
  });

  it("crm: status, owner, and months", () => {
    expect(
      detail("crm", {
        status: "Placed",
        owner: "Ann",
        lastContactedOn: "2025-03-14",
        lastPlacementOn: null,
      }),
    ).toEqual([
      ["Status", "Placed"],
      ["Owner", "Ann"],
      ["Last contact", "Mar 2025"],
    ]);
  });

  // Bug: the crm case (bits.tsx:192-206) keeps a row whose value is "" when the day can't be
  // read (month() gives ""), so the card shows a labeled blank. The filter only drops null.
  it("Bug: a crm day that isn't a date shows no row", () => {
    expect(detail("crm", { lastContactedOn: "unknown", lastPlacementOn: "n/a" })).toEqual([]);
  });

  it("unknown kinds show nothing; no row is ever blank", () => {
    expect(detail("salary", { amount: 1 })).toEqual([]);
    for (const kind of ["job_change", "still_there", "left", "hiring"])
      for (const value of [{}, { title: "", to: "", from: "", reason: "", count: 0, roles: [] }])
        for (const [, v] of detail(kind, value)) expect(v.trim(), kind).not.toBe("");
  });

  it("labels: known kinds and vias by name, others made readable", () => {
    expect(kindLabel("job_change")).toBe("Job change");
    expect(kindLabel("new_thing")).toBe("New thing");
    expect(kindLabel("")).toBe("");
    expect(viaLabel("web")).toBe(viaLabel("search"));
    expect(viaLabel("company_page")).toBe("Company page");
  });
});
