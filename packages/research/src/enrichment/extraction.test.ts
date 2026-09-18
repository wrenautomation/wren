/** Extraction response parsing: tolerant of fences, strict on shape. */
import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  groundEmails,
  PROMPT_VERSION,
  parseExtraction,
} from "./extraction.js";

describe("parseExtraction", () => {
  it("clean json parses", () => {
    const result = parseExtraction(
      '{"people": [{"full_name": "Jane Doe", "title": "CEO", "email": "jane@acme.example", "bio_facts": ["CFA charterholder"]}], "generic_emails": ["info@acme.example"]}',
    );
    if (typeof result === "string") throw new Error(result);
    expect(result.people[0]?.full_name).toBe("Jane Doe");
    expect(result.people[0]?.email).toBe("jane@acme.example");
    expect(result.generic_emails).toEqual(["info@acme.example"]);
  });

  it("code fences and prose margins tolerated", () => {
    const result = parseExtraction('Here you go:\n```json\n{"people": []}\n```\nDone!');
    if (typeof result === "string") throw new Error(result);
    expect(result.people).toEqual([]);
  });

  it("no json is a reason string", () => {
    expect(typeof parseExtraction("I could not find any people on this page.")).toBe("string");
  });

  it("malformed json is a reason string", () => {
    expect(typeof parseExtraction('{"people": [')).toBe("string");
  });

  it("wrong shape is a reason string", () => {
    expect(typeof parseExtraction('{"people": ["just a string"]}')).toBe("string");
  });

  it("testimonial fields parse and default to staff", () => {
    const result = parseExtraction(
      '{"people": [{"full_name": "Jane Doe", "title": "Founder"}, {"full_name": "Ada Vale", "title": "President, Cordelia Labs", "is_testimonial": true, "testimonial_org": "Cordelia Labs"}]}',
    );
    if (typeof result === "string") throw new Error(result);
    const [staff, client] = result.people;
    expect([staff?.is_testimonial, staff?.testimonial_org]).toEqual([false, null]);
    expect([client?.is_testimonial, client?.testimonial_org]).toEqual([true, "Cordelia Labs"]);
  });

  it("nameless entries are dropped, not fatal", () => {
    const result = parseExtraction(
      '{"people": [{"full_name": null, "title": "Founder"}, {"full_name": "Jo Vale"}]}',
    );
    if (typeof result === "string") throw new Error(result);
    expect(result.people.map((p) => p.full_name)).toEqual(["Jo Vale"]);
  });
});

describe("buildExtractionPrompt", () => {
  it("teaches the testimonial exception under a new version", () => {
    expect(PROMPT_VERSION).toBe("v2");
    const prompt = buildExtractionPrompt({
      companyName: null,
      url: "https://x.example",
      title: "X",
      text: "hello",
    });
    expect(prompt).toContain("is_testimonial");
    expect(prompt).toContain("testimonial_org");
    expect(prompt).toContain("case-study");
    expect(prompt).toContain("Company: (unknown)");
  });
});

describe("groundEmails", () => {
  it("drops addresses not literally on the page", () => {
    const parsed = parseExtraction(
      '{"people": [{"full_name": "Jane Doe", "email": "Jane@acme.example"}, {"full_name": "Al", "email": "al@acme.example"}], "generic_emails": ["info@acme.example", "ghost@acme.example"]}',
    );
    if (typeof parsed === "string") throw new Error(parsed);
    const { parsed: grounded, dropped } = groundEmails(
      parsed,
      "Contact jane@acme.example or info@acme.example",
    );
    expect(grounded.people.map((p) => p.email)).toEqual(["Jane@acme.example", null]);
    expect(grounded.generic_emails).toEqual(["info@acme.example"]);
    expect(dropped).toEqual(["al@acme.example", "ghost@acme.example"]);
  });
});
