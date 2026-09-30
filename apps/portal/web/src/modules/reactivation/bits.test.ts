// What a source card says (detailOf), which marks a line cites (marksOf), the brief without
// its marks (stripMarks), and the brief with its marks as chips (Cited). Tests that expose a
// bug assert the correct behavior and are marked "Bug".
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Source } from "../../api.js";
import { Cited, detailOf, kindLabel, marksOf, stripMarks, viaLabel } from "./bits.js";

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

describe("marksOf", () => {
  it("reads every mark, lowercase, in order", () => {
    expect(marksOf("A. [f1] B. [ F2 ; c3 ] C. [f4,c5][c6]")).toEqual([
      "f1",
      "f2",
      "c3",
      "f4",
      "c5",
      "c6",
    ]);
  });

  it("a bracket that isn't all marks cites nothing", () => {
    for (const s of ["[f1, x2]", "[f1,]", "[f 1]", "[1]", "(f1)", "f1", "[]", "[f]", "[f1.5]"])
      expect(marksOf(s), s).toEqual([]);
  });

  it("is the same twice: the regex keeps no state between calls", () => {
    const s = "One. [f1] Two. [c2]";
    expect(marksOf(s)).toEqual(marksOf(s));
    expect(marksOf(s)).toEqual(["f1", "c2"]);
  });
});

describe("stripMarks", () => {
  it("drops marks and the space they leave before a period, comma or semicolon", () => {
    expect(stripMarks("Moved to Initech [f1]. Still hiring [f2, c3], and more [c4];")).toBe(
      "Moved to Initech. Still hiring, and more;",
    );
  });

  // Bug: stripMarks (bits.tsx:87) closes the gap only before . , ; so a mark before ? or !
  // leaves "there ?". The server's stripMarks (compose.ts:370-374) handles . , ; ! ?.
  it("Bug: a mark before ? or ! leaves no gap", () => {
    expect(stripMarks("Still there [f1]? Hiring [f2]!")).toBe("Still there? Hiring!");
  });
});

describe("Cited", () => {
  type El = ReactElement<Record<string, unknown>>;
  const chips = (text: string, order: string[]) => {
    const out = (Cited({ text, order, onPick: () => {} }) as El).props.children as ReactNode[];
    return out
      .filter((n): n is El => isValidElement(n))
      .map((span) =>
        (span.props.children as ReactNode[]).filter((c): c is El => isValidElement(c)),
      );
  };
  const html = (text: string, order: string[], lit?: string) =>
    renderToStaticMarkup(createElement(Cited, { text, order, lit, onPick: () => {} }));

  it("a chip's number is its mark's place in the order; case doesn't matter", () => {
    const got = chips("A. [F2] B. [c3, f1]", ["c3", "f1", "f2"]);
    expect(got.map((s) => s.map((c) => c.props.n))).toEqual([[3], [1, 2]]);
    expect(got.flat().map((c) => c.props.href)).toEqual(["#src-f2", "#src-c3", "#src-f1"]);
  });

  it("an unknown mark shows no chip and no mark", () => {
    const out = html("A. [f9] B. [f1, f9]", ["f1"]);
    expect(out).not.toMatch(/f9|\[|\]/);
    expect(out.match(/class="ui-cite/g)).toHaveLength(1);
  });

  it("the words around the marks stay whole, in order", () => {
    const text = "Cara moved. [f1] Umbrella is hiring. [f2] Worth a note.";
    expect(html(text, ["f1", "f2"]).replace(/<[^>]+>/g, "")).toBe(
      "Cara moved.1 Umbrella is hiring.2 Worth a note.",
    );
    expect(html("No marks here.", [])).toBe("No marks here.");
    expect(html("", [])).toBe("");
  });

  it("the lit mark's chip is on, the others aren't", () => {
    const got = chips("[f1, f2]", ["f1", "f2"]).flat();
    expect(got.map((c) => c.props.on)).toEqual([false, false]);
    const out = html("[f1, f2]", ["f1", "f2"], "f2");
    expect(out.match(/ui-cite-on/g)).toHaveLength(1);
  });

  it("a pick names the mark, lowercase", () => {
    const picked: string[] = [];
    const out = (Cited({ text: "[F1]", order: ["f1"], onPick: (m) => picked.push(m) }) as El).props
      .children as ReactNode[];
    const span = out.find((n): n is El => isValidElement(n));
    if (!span) throw new Error("no chips");
    const [chip] = (span.props.children as ReactNode[]).filter((c): c is El => isValidElement(c));
    if (!chip) throw new Error("no chip");
    (chip.props.onPick as () => void)();
    expect(picked).toEqual(["f1"]);
  });

  // Bug: Cited (bits.tsx:112-124) makes one chip per id in the bracket, keyed by id, so a mark
  // cited twice in one bracket ("[f1, F1]") shows the same number twice with a repeated key.
  it("Bug: a mark repeated in one bracket shows one chip", () => {
    const [span] = chips("Moved. [f1, F1]", ["f1"]);
    expect(span).toHaveLength(1);
  });
});
