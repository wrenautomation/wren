import { describe, expect, it } from "vitest";
import { answersOf, linksIn } from "./agent-cards.js";

describe("answersOf", () => {
  it("reads the picks out of AskUserQuestion's result", () => {
    const r =
      'Your questions have been answered: "Which list?"="List B", "Say \\"hi\\"?"="Yes, twice". You can now continue with these answers in mind.';
    expect(answersOf(r)).toEqual({ "Which list?": "List B", 'Say "hi"?': "Yes, twice" });
  });
  it("no picks, no answers", () => {
    expect(answersOf("The person said no.")).toBeNull();
    expect(answersOf(undefined)).toBeNull();
  });
});

describe("linksIn", () => {
  it("finds each address once, without the sentence's punctuation", () => {
    const got = linksIn(
      "Read https://northwind.example/pricing?x=1. Then (https://www.acme.example/) and https://northwind.example/pricing?x=1!",
    );
    expect(got.map((u) => u.href)).toEqual([
      "https://northwind.example/pricing?x=1",
      "https://www.acme.example/",
    ]);
  });
  it("skips what is not an address", () => {
    expect(linksIn("ftp://x.example and mailto:a@b.example and http://")).toEqual([]);
  });
});

describe("linksIn, brackets", () => {
  it("keeps a matched ) and drops an unmatched one", () => {
    expect(
      linksIn("See (https://en.wikipedia.example/wiki/Foo_(bar)).").map((u) => u.href),
    ).toEqual(["https://en.wikipedia.example/wiki/Foo_(bar)"]);
  });
});
