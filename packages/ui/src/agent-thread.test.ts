import { describe, expect, it } from "vitest";
import { answersOf, linksIn } from "./agent-cards.js";
import { isCommand, stat, took, toolTitle } from "./agent-steps.js";

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

describe("steps", () => {
  it("folds plain commands, names weaver", () => {
    expect(isCommand("Bash", { command: "ls -la" })).toBe(true);
    expect(isCommand("Bash", { command: "weaver plan x" })).toBe(false);
    expect(isCommand("Read", { file_path: "/a" })).toBe(false);
  });
  it("says a result in a few words", () => {
    expect(stat("Error: Exit code 2\nboom", true)).toBe("exit 2");
    expect(stat('{"sources":[1,2,3],"pages":6,"run":"x"}')).toBe("3 sources · 6 pages");
    expect(stat("[1,2]")).toBe("2 items");
    expect(stat("a\nb\nc")).toBe("3 lines");
    expect(stat("ok")).toBe("ok");
    expect(stat("  ")).toBe("no output");
    expect(stat("{}")).toBe("");
  });
  it("says a time", () => {
    expect(took(3100)).toBe("3.1s");
    expect(took(24_000)).toBe("24s");
    expect(took(64_000)).toBe("1m 4s");
  });
  it("names a call", () => {
    expect(toolTitle("Bash", { command: "ls", description: "List files" })).toBe("List files");
    expect(toolTitle("Read", { file_path: "/x/notes.md" })).toBe("Read notes.md");
  });
});
