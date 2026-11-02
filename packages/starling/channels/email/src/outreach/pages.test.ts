import { parseTemplate } from "@wren/core/slots";
import { describe, expect, it } from "vitest";
import { pageFacts, pageSlugs, pagesIn } from "./pages.js";

describe("pages in an email", () => {
  it("reads {page.<slug>} keys, dashes and all", () => {
    const t = parseTemplate("a", "subject: Hi\n\nSee {page.speed-lander} and {page.faq}.\n");
    expect(pageSlugs([t])).toEqual(["faq", "speed-lander"]);
  });

  it("links the page with the email's utm and code", () => {
    expect(pageFacts(["speed"], "reactivation", "c1")).toEqual({
      "page.speed":
        "https://wrenautomation.com/o/speed?utm_source=email&utm_medium=email&utm_campaign=reactivation&utm_content=c1",
    });
  });

  it("finds pages in a written email, never a form or the kit", () => {
    const body =
      "A https://wrenautomation.com/o/speed?utm_source=email, B https://wrenautomation.com/o/f/apply, C https://wrenautomation.com/o/__kit.js, D https://wrenautomation.com/o/two-words.";
    expect(pagesIn(body)).toEqual(["speed", "two-words"]);
  });
});
