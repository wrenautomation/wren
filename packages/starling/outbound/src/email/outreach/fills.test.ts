/** What a model's answer must be before an email may carry it, and how a slot reads in a template. */

import {
  MissingFactError,
  parseTemplate,
  render,
  slotKey,
  slots,
  toSource,
} from "@wren/core/slots";
import { describe, expect, it } from "vitest";
import {
  checkCompanyName,
  checkFirstName,
  checkSlot,
  promptVersion,
  requestsFor,
  resolvePrompt,
} from "./fills.js";

describe("checkCompanyName: the model may only cut and recase", () => {
  it.each([
    ["ASSERTIVE STAFFING SERVICES INC", "Assertive Staffing"],
    ["Express Employment Professionals Tyler, TX", "Express Employment"],
    ["Briggs & Associates, LLC", "Briggs and Associates"],
    ["Cma Services Inc Of Hartsville", "CMA Services"],
    ["PEOPLEMARK®, An Allied Universal® Company", "Peoplemark"],
    ["TEKsystems", "TEKsystems"],
  ])("%s -> %s passes", (input, out) => {
    expect(checkCompanyName(input, out, 6)).toBeNull();
  });

  it.each([
    ["ASSERTIVE STAFFING SERVICES INC", "ASS", /not in the filed name/],
    ["Best Employment Solutions", "BES", /not in the filed name/],
    ["Abel Mendoza Inc. Staffing Services", "Abel Mendoza Inc.", /legal form/],
    ["Grove Co.", "Grove Co", /legal form/],
    ["ASSERTIVE STAFFING SERVICES INC", "ASSERTIVE Staffing", /shouts/],
    ["Tulsa Nurse Partners", "Tulsa Nursing", /not in the filed name/],
    ["Tulsa Nurse Partners", "Tulsa Nurse Partners, Tulsa", /punctuation/],
    ["One Two Three Four Five Six Seven", "One Two Three Four Five", /over 4 words/],
  ])("%s -> %s refuses", (input, out, why) => {
    expect(checkCompanyName(input, out, 4)).toMatch(why);
  });
});

describe("checkFirstName", () => {
  const filed = (first: string, full: string) => `first_name: ${first} / full_name: ${full}`;
  it.each([
    [filed("Michael.Stenger", "Michael Stenger"), "Michael"],
    [filed("Developmentdouglas", "Business Developmentdouglas Reyes"), "Douglas"],
    [filed("MCKENZIE", "MCKENZIE ROSS"), "McKenzie"],
    [filed("mary-jo", "mary-jo o'neil"), "Mary-Jo"],
    [filed("E.", "E. Ann Guliex"), "Ann"],
  ])("%s -> %s passes", (input, out) => {
    expect(checkFirstName(input, out)).toBeNull();
  });
  it.each([
    [filed("Sales", "Sales Team"), "Sales", /role/],
    [filed("Vp,", "Vp, Sales"), "Vp", /role/],
    [filed("Robert", "Robert Lane"), "Bob", /not in the filed name/],
    [filed("JOHN", "JOHN SMITH"), "JOHN", /shouts/],
    [filed("R.P.", "R.P. Smith"), "R.P.", /not one name/],
    [filed("Ann Marie", "Ann Marie Cole"), "Ann Marie", /not one name/],
    [filed("Jg", "Jg Carver"), "Jg", /initials/],
    [filed("Fnu", "Fnu Deepak"), "Fnu", /role/],
  ])("%s -> %s refuses", (input, out, why) => {
    expect(checkFirstName(input, out)).toMatch(why);
  });
});

describe("checkSlot", () => {
  const prompt = "In 3 to 6 words, the kind of roles Tulsa Nurse fills";
  it("a plain phrase passes; a trailing period is the template's to place", () => {
    expect(checkSlot(prompt, "travel ICU and ER nurses")).toBeNull();
  });
  it.each([
    ["none", /none/],
    ["nurses — mostly ICU", /dash/],
    ["see https://x.test", /link/],
    ["over 300 nurses placed", /300/],
    ["nurses!", /exclamation/],
    ["line one\nline two", /one line/],
    [Array(30).fill("word").join(" "), /over 25 words/],
    [Array(20).fill("extraordinarily").join(" "), /over 200 characters/],
    ["nurses {first_name}", /brackets/],
    ["nurses [[a|b]]", /brackets/],
  ])("%s refuses", (out, why) => {
    expect(checkSlot(prompt, out)).toMatch(why);
  });
});

describe("prompt slots in a template", () => {
  const src =
    "Subject: hi\n\nI saw you place <<In 3 to 6 words, the roles {company_short} fills>>.\n";
  const tpl = parseTemplate("t", src);
  const key = slotKey("In 3 to 6 words, the roles {company_short} fills");

  it("`<<prompt>>` is a required field keyed by the prompt's hash, and round-trips", () => {
    expect([...slots(tpl)]).toEqual([[key, "In 3 to 6 words, the roles {company_short} fills"]]);
    expect(key).toMatch(/^ai\.[0-9a-f]{12}$/);
    expect(render(tpl, { [key]: "travel nurses" }, "s").body).toBe(
      "I saw you place travel nurses.",
    );
    expect(() => render(tpl, {}, "s")).toThrow(MissingFactError);
    expect(parseTemplate("t", toSource(tpl)).version).toBe(tpl.version);
  });

  it("editing the prompt is a new template version", () => {
    expect(parseTemplate("t", src.replace("3 to 6", "2 to 5")).version).not.toBe(tpl.version);
  });

  it("a | inside a prompt is the prompt's, not the variant's", () => {
    const t = parseTemplate("t", "[[<<pick one: a | b>> | plain]]\n");
    expect([...slots(t).values()]).toEqual(["pick one: a | b"]);
  });

  it("a slot in a dropped group is missing without failing the render", () => {
    const t = parseTemplate("t", "Hi.(( I saw <<the roles {company_short} fills>>.))\n");
    expect(render(t, {}, "s").body).toBe("Hi.");
  });

  it("the prompt goes out with its facts in; a missing fact means no call", () => {
    expect(resolvePrompt("roles {company_short} fills", { company_short: "Grove" })).toBe(
      "roles Grove fills",
    );
    expect(resolvePrompt("roles {company_short} fills", {})).toBeNull();
  });
});

describe("requestsFor", () => {
  it("asks for the firm and the person as filed, refused values too", () => {
    const reqs = requestsFor(
      {
        values: {
          company_name: "Grove Technical Resources",
          first_name: null,
          full_name: "Vp Sales",
        },
        refused: { first_name: "Vp," },
      },
      [],
    );
    expect(reqs).toEqual([
      { kind: "company", input: "Grove Technical Resources" },
      { kind: "person", input: "first_name: Vp, / full_name: Vp Sales" },
    ]);
  });

  it("a role inbox has no person to ask about", () => {
    expect(
      requestsFor({ values: { company_name: "Grove" }, refused: {} }, []).map((r) => r.kind),
    ).toEqual(["company"]);
  });

  it("each kind's prompt version is fixed by its system prompt", () => {
    expect(promptVersion("company")).toMatch(/^[0-9a-f]{12}$/);
    expect(promptVersion("company")).not.toBe(promptVersion("person"));
  });
});
