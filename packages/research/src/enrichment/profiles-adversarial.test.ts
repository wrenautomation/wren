/**
 * Adversarial tests for the `profiles` stage's pure parts: which links on a
 * firm's page belong to a person, and when a run stops. A link handed to the
 * wrong person costs a metered read; a run that keeps going past a failed read
 * spends against a broken site. Tests here state what SHOULD happen. A failing
 * one is a bug, not a flaky test.
 */
import { describe, expect, it } from "vitest";
import {
  countProfileUnit,
  emptyProfileStats,
  linkedinLinks,
  type ProfileUnit,
} from "./profiles.js";

const jane = { first: "Jane", last: "Doe" };
const card = (name: string, vanity: string) =>
  `<div class="card"><img src="/t/${vanity}.jpg"><h3>${name}</h3><p>Partner</p>` +
  `<a href="https://www.linkedin.com/in/${vanity}/">in</a></div>`;

describe("linkedinLinks", () => {
  it("a team page: each person gets their own card's link, never a neighbour's", () => {
    const page =
      card("John Roe", "john-roe") + card("Jane Doe", "jane-doe") + card("Ann Poe", "ann-poe");
    expect(linkedinLinks(page, jane).people).toEqual(["https://www.linkedin.com/in/jane-doe/"]);
  });

  it("a link with no name of theirs on the page is nobody's", () => {
    expect(linkedinLinks(card("John Roe", "john-roe"), jane).people).toEqual([]);
  });

  it("only the first name, or only the last, is not the person", () => {
    const page = card("Jane Roe", "jane-roe") + card("Bob Doe", "bob-doe");
    expect(linkedinLinks(page, jane).people).toEqual([]);
  });

  it("Jane is not Janet, and Doe is not Doerr", () => {
    expect(linkedinLinks(card("Janet Doerr", "janet-doerr"), jane).people).toEqual([]);
  });

  it("a middle initial and markup between the names still match", () => {
    const page = card("<span>Jane</span>&nbsp;Q.&nbsp;<b>Doe</b>", "janeqdoe");
    expect(linkedinLinks(page, jane).people).toEqual(["https://www.linkedin.com/in/janeqdoe/"]);
  });

  it("a card with no link never borrows its neighbour's", () => {
    const page = card("Jane Doe", "jane-doe") + `<div class="card"><h3>Bob Roe</h3></div>`;
    expect(linkedinLinks(page, { first: "Bob", last: "Roe" }).people).toEqual([]);
  });

  it("a vanity that spells neither name is someone else's; a member id may be theirs", () => {
    expect(linkedinLinks(card("Jane Doe", "talent-guru"), jane).people).toEqual([]);
    expect(linkedinLinks(card("Jane Doe", "jdoe1"), jane).people).toEqual([
      "https://www.linkedin.com/in/jdoe1/",
    ]);
    expect(linkedinLinks(card("Jane Doe", "ACoAAB12cdE"), jane).people).toEqual([
      "https://www.linkedin.com/in/ACoAAB12cdE/",
    ]);
  });

  it("a name far from any link takes nothing", () => {
    const page = `<p>Jane Doe founded the firm.</p>${" ".repeat(2000)}<a href="https://linkedin.com/in/someone-else">x</a>`;
    expect(linkedinLinks(page, jane).people).toEqual([]);
  });

  it("no name to look for: no profile links, company links still kept", () => {
    const page = `${card("Jane Doe", "jane-doe")}<footer><a href="https://www.linkedin.com/company/acme-staffing/">LinkedIn</a></footer>`;
    expect(linkedinLinks(page, { first: null, last: "Doe" })).toEqual({
      people: [],
      companies: ["https://www.linkedin.com/company/acme-staffing/"],
    });
  });

  it("regex characters in a name are text, not pattern", () => {
    const page = card("Jo (Ann) Doe", "jo-ann");
    expect(() => linkedinLinks(page, { first: "Jo (Ann)", last: "Doe" })).not.toThrow();
    expect(linkedinLinks(page, { first: "J.", last: "Doe" }).people).toEqual([]);
  });

  it("profile links are spelled one way, so the same person twice is one link", () => {
    const page =
      card("Jane Doe", "Jane-Doe") +
      `<p>Jane Doe <a href="https://linkedin.com/in/jane-doe?trk=team">profile</a></p>`;
    expect(linkedinLinks(page, jane).people).toEqual(["https://www.linkedin.com/in/jane-doe/"]);
  });

  it("an href that only mentions linkedin, or a post, is not a profile", () => {
    const page = `<p>Jane Doe</p><a href="https://example.com/?u=linkedin.com/in/jane-doe">x</a><a href="https://www.linkedin.com/posts/jane-doe_123">p</a>`;
    expect(linkedinLinks(page, jane).people).toEqual([]);
  });
});

const unit = (over: Partial<ProfileUnit> = {}): ProfileUnit => ({
  personId: 1,
  person: "matched",
  company: "matched",
  google: 0,
  googleStopped: false,
  capped: false,
  failedRead: false,
  error: null,
  ...over,
});

describe("countProfileUnit", () => {
  it("counts people and firms by outcome; a firm done before counts as neither", () => {
    const stats = emptyProfileStats();
    const streak = { errors: 0 };
    countProfileUnit(stats, unit({ google: 2 }), streak);
    countProfileUnit(stats, unit({ person: "unresolved", company: "done" }), streak);
    countProfileUnit(stats, unit({ company: "unresolved", google: 1 }), streak);
    expect(stats).toMatchObject({
      people_matched: 2,
      people_unresolved: 1,
      companies_matched: 1,
      companies_unresolved: 1,
      google: 3,
      errors: 0,
    });
  });

  it("a failed metered read stops the run at once", () => {
    const why = countProfileUnit(
      emptyProfileStats(),
      unit({ person: "matched", company: "error", failedRead: true, error: "502 exa" }),
      { errors: 0 },
    );
    expect(why).toMatch(/failed a read/);
  });

  it("a cap stops the run, even on a person whose firm was never tried", () => {
    const why = countProfileUnit(
      emptyProfileStats(),
      unit({ person: "capped", company: "skipped", capped: true }),
      { errors: 0 },
    );
    expect(why).toMatch(/cap/);
  });

  it("odd errors go on until five in a row; a success between resets the streak", () => {
    const stats = emptyProfileStats();
    const streak = { errors: 0 };
    const bad = unit({ person: "error", error: "boom" });
    for (let i = 0; i < 4; i++) expect(countProfileUnit(stats, bad, streak)).toBeNull();
    expect(countProfileUnit(stats, unit(), streak)).toBeNull();
    for (let i = 0; i < 4; i++) expect(countProfileUnit(stats, bad, streak)).toBeNull();
    expect(countProfileUnit(stats, bad, streak)).toMatch(/5 errors in a row/);
    expect(stats.errors).toBe(9);
  });
});
