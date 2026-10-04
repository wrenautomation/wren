/**
 * Adversarial tests for the cross-checks. A false pass mails the wrong person
 * at a live mailbox; a false fail drops a good lead. Tests here state what
 * SHOULD happen. A failing one is a bug, not a flaky test.
 */
import { describe, expect, it } from "vitest";
import {
  checkLead,
  domainIsFirm,
  type LeadCheckInput,
  type LookupFinding,
  mailboxFitsName,
  mailboxForms,
  mailboxOf,
  pageIsFirm,
  phoneAgrees,
  titleAgrees,
  worksThere,
} from "./checks.js";

const jane = { id: 1, fullName: "Jane Doe", firstName: "Jane", lastName: "Doe" };
const bob = { id: 2, fullName: "Bob Roe", firstName: "Bob", lastName: "Roe" };
const fits = (email: string, person = jane, colleagues = [jane, bob]) =>
  mailboxFitsName(email, person, colleagues);
const lookup = (
  kind: string,
  confidence = 0.9,
  value: Record<string, unknown> = {},
): LookupFinding => ({
  id: 7,
  kind,
  confidence,
  value,
});

describe("mailboxFitsName", () => {
  it("every listed pattern fits", () => {
    for (const local of [
      "jane",
      "doe",
      "jane.doe",
      "janedoe",
      "jdoe",
      "j.doe",
      "janed",
      "jane_doe",
      "jane-doe",
    ])
      expect(fits(`${local}@oakbridge.example`)?.result, local).toBe("pass");
  });

  it("case, a plus-tag and a trailing number never decide it", () => {
    expect(fits("Jane.Doe+news@oakbridge.example")?.result).toBe("pass");
    expect(fits("jdoe2@oakbridge.example")?.result).toBe("pass");
  });

  it("accents fold: josé.núñez@ fits José Núñez", () => {
    const jose = { id: 3, fullName: "José Núñez", firstName: "José", lastName: "Núñez" };
    expect(fits("jose.nunez@oakbridge.example", jose, [jose])?.result).toBe("pass");
  });

  it("a colleague's mailbox fails, naming that colleague", () => {
    const r = fits("bob.roe@oakbridge.example");
    expect(r).toMatchObject({ result: "fail", evidence: { fits_person_id: 2 } });
  });

  it("fits nobody we hold: unknown, never a pass", () => {
    expect(fits("partners@oakbridge.example")?.result).toBe("unknown");
    expect(fits("jx@oakbridge.example")?.result).toBe("unknown");
  });

  it("two Janes at one firm: jane@ proves neither", () => {
    const other = { id: 4, fullName: "Jane Poe", firstName: "Jane", lastName: "Poe" };
    expect(fits("jane@oakbridge.example", jane, [jane, other])).toMatchObject({
      result: "unknown",
      evidence: { also_fits: [4] },
    });
    // The full pattern still singles her out.
    expect(fits("jane.doe@oakbridge.example", jane, [jane, other])?.result).toBe("pass");
  });

  it("a role mailbox skips the check", () => {
    expect(fits("info@oakbridge.example")).toBeNull();
    expect(fits("Office+web@oakbridge.example")).toBeNull();
  });

  it("no person: a colleague's mailbox still fails, anything else is unknown", () => {
    expect(mailboxFitsName("bob.roe@oakbridge.example", null, [jane, bob])?.result).toBe("fail");
    expect(mailboxFitsName("jane.x@oakbridge.example", null, [jane, bob])?.result).toBe("unknown");
  });

  it("names come from full_name when first and last are empty, suffix and middle dropped", () => {
    const ann = { id: 5, fullName: "Ann Marie Poe Jr." };
    expect(mailboxForms(ann).has("ann.poe")).toBe(true);
    expect(mailboxForms(ann).has("apoe")).toBe(true);
  });

  it("a compound last name fits joined or by its last word", () => {
    const van = { id: 6, fullName: "Kim Van Dyke", firstName: "Kim", lastName: "Van Dyke" };
    expect(fits("kim.vandyke@oakbridge.example", van, [van])?.result).toBe("pass");
    expect(fits("kdyke@oakbridge.example", van, [van])?.result).toBe("pass");
  });

  it("a one-letter first name never makes a bare-letter mailbox fit", () => {
    const j = { id: 8, fullName: "J Doe", firstName: "J", lastName: "Doe" };
    expect(mailboxForms(j).has("j")).toBe(false);
    expect(mailboxOf("j@oakbridge.example")).toBe("j");
  });
});

describe("domainIsFirm", () => {
  it("same registrable domain passes, a subdomain too", () => {
    expect(domainIsFirm("jane@oakbridge.example", "oakbridge.example").result).toBe("pass");
    expect(domainIsFirm("jane@mail.oakbridge.co.uk", "www.oakbridge.co.uk").result).toBe("pass");
  });
  it("a personal or old-firm address fails; no firm domain is unknown", () => {
    expect(domainIsFirm("jane@gmail.com", "oakbridge.example").result).toBe("fail");
    expect(domainIsFirm("jane@oldfirm.example", "https://oakbridge.example/").result).toBe("fail");
    expect(domainIsFirm("jane@oakbridge.example", null).result).toBe("unknown");
  });
});

describe("worksThere", () => {
  it("still there passes; sure moves fail; unsure or none is unknown", () => {
    expect(worksThere(lookup("still_there")).result).toBe("pass");
    expect(worksThere(lookup("job_change", 0.8, { to: "Elm" })).result).toBe("fail");
    expect(worksThere(lookup("left", 0.95)).result).toBe("fail");
    expect(worksThere(lookup("job_change", 0.5)).result).toBe("unknown");
    expect(worksThere(null).result).toBe("unknown");
  });
});

describe("titleAgrees", () => {
  it("a shared word passes; stopwords and seniority never count", () => {
    expect(
      titleAgrees("Managing Partner", lookup("still_there", 0.9, { title: "Partner" })).result,
    ).toBe("pass");
    expect(
      titleAgrees("Head of Sales", lookup("still_there", 0.9, { title: "Director of Ops" })).result,
    ).toBe("fail");
    expect(
      titleAgrees("Senior Analyst", lookup("still_there", 0.9, { title: "Senior Engineer" }))
        .result,
    ).toBe("fail");
  });
  it("no title on either side, or a move, is unknown", () => {
    expect(titleAgrees(null, lookup("still_there", 0.9, { title: "Owner" })).result).toBe(
      "unknown",
    );
    expect(titleAgrees("Owner", lookup("job_change", 0.9, { title: "Owner" })).result).toBe(
      "unknown",
    );
  });
});

describe("pageIsFirm", () => {
  const page = (homepage: string | null) => ({ id: 9, value: { homepage } });
  it("the page's homepage is the firm's site", () => {
    expect(
      pageIsFirm(page("https://www.oakbridge.example/"), "oakbridge.example", "matched").result,
    ).toBe("pass");
    expect(
      pageIsFirm(page("https://lookalike.example"), "oakbridge.example", "matched").result,
    ).toBe("fail");
  });
  it("no page: fail only once a lookup finished without one", () => {
    expect(pageIsFirm(null, "oakbridge.example", "unresolved").result).toBe("fail");
    expect(pageIsFirm(null, "oakbridge.example", null).result).toBe("unknown");
    expect(pageIsFirm(null, "oakbridge.example", "capped").result).toBe("unknown");
  });
});

describe("phoneAgrees", () => {
  const page = (phone: string | null) => ({ id: 9, value: { phone } });
  it("digits only, last ten: +1 and punctuation never decide it", () => {
    expect(phoneAgrees(page("+1 (555) 010-0100"), "555.010.0100").result).toBe("pass");
    expect(phoneAgrees(page("555-010-0199"), "5550100100").result).toBe("fail");
  });
  it("a missing or too-short number is unknown", () => {
    expect(phoneAgrees(page(null), "5550100100").result).toBe("unknown");
    expect(phoneAgrees(page("ext 12"), "5550100100").result).toBe("unknown");
    expect(phoneAgrees(null, null).result).toBe("unknown");
  });
});

describe("checkLead", () => {
  const base: LeadCheckInput = {
    email: "jane.doe@oakbridge.example",
    firmDomain: "oakbridge.example",
    person: { ...jane, title: "Founder" },
    colleagues: [jane, bob],
    lookup: lookup("still_there", 0.9, { title: "Founder" }),
    page: null,
    companyLookupState: null,
    importPhone: null,
  };
  it("six checks for a named mailbox, five for a role mailbox", () => {
    expect(checkLead(base).map((c) => c.kind)).toEqual([
      "mailbox_fits_name",
      "domain_is_firm",
      "works_there",
      "title_agrees",
      "page_is_firm",
      "phone_agrees",
    ]);
    expect(
      checkLead({ ...base, email: "info@oakbridge.example" }).map((c) => c.kind),
    ).not.toContain("mailbox_fits_name");
  });
  it("no person: works_there and title_agrees are unknown, never borrowed from a lookup", () => {
    const r = checkLead({ ...base, person: null });
    expect(r.find((c) => c.kind === "works_there")?.result).toBe("unknown");
    expect(r.find((c) => c.kind === "title_agrees")?.result).toBe("unknown");
  });
});
