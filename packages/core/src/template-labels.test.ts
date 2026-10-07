import { describe, expect, it } from "vitest";
import { promptLabel } from "./slots/preview.js";
import { folderLabel, labelOf, namedParts, nameLabel, nameParts } from "./template-labels.js";

describe("template labels", () => {
  it("reads path parts as names, a part with its own label as that label", () => {
    expect(labelOf("sec_ria")).toBe("Sec ria");
    nameParts({ sec_ria: "SEC RIA" });
    expect(labelOf("sec_ria")).toBe("SEC RIA");
    expect(folderLabel("sec_ria/book-first")).toBe("SEC RIA / Book first");
    expect(namedParts()).toEqual({ sec_ria: "SEC RIA" });
    expect(labelOf("book-first")).toBe("Book first");
    expect(labelOf("final_followup")).toBe("Final follow-up");
    expect(labelOf("recruiting")).toBe("Recruiting");
    expect(nameLabel("book-first/opener")).toBe("Opener");
  });

  it("leaves out the folder already shown", () => {
    expect(folderLabel("recruiting/book-first", "recruiting")).toBe("Book first");
    expect(folderLabel("recruiting/book-first")).toBe("Recruiting / Book first");
    expect(folderLabel("recruiting", "recruiting")).toBe("");
    expect(folderLabel("agencies", "recruiting")).toBe("Agencies");
  });
});

describe("promptLabel", () => {
  it("reads a model fill as what it writes, never its key", () => {
    expect(
      promptLabel(
        "The topic of this video in 3 to 8 words, written the way it reads mid-sentence.",
      ),
    ).toBe("topic of this video");
    expect(promptLabel("")).toBe("a line");
  });
});
