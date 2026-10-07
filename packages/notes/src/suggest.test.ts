import { describe, expect, it } from "vitest";
import { onlySuggests, withoutSuggestionsBy } from "./suggest.js";
import { type NoteJson, SUGGEST_ADD, SUGGEST_DEL } from "./types.js";

const para = (...kids: NoteJson[]): NoteJson => ({
  type: "doc",
  content: [{ type: "paragraph", content: kids }],
});
const t = (text: string, marks?: NoteJson["marks"]): NoteJson =>
  marks ? { type: "text", text, marks } : { type: "text", text };
const add = (by: string) => [{ type: SUGGEST_ADD, attrs: { by, at: "2026-10-07T10:00" } }];
const del = (by: string) => [{ type: SUGGEST_DEL, attrs: { by, at: "2026-10-07T10:00" } }];
const CAL = "cal@firm.example";

describe("suggestions", () => {
  const before = para(t("Ship on Friday."));

  it("takes back one person's suggestions, leaving others'", () => {
    const body = para(
      t("Ship on "),
      t("Friday", del(CAL)),
      t("Monday", add(CAL)),
      t(" now", add("amy@firm.example")),
      t("."),
    );
    expect(withoutSuggestionsBy(body, CAL)).toEqual(
      para(t("Ship on Friday"), t(" now", add("amy@firm.example")), t(".")),
    );
  });

  it("lets a commenter add and remove text as suggestions", () => {
    const after = para(t("Ship on "), t("Friday", del(CAL)), t("Monday", add(CAL)), t("."));
    expect(onlySuggests(before, after, CAL)).toBe(true);
    expect(onlySuggests(before, after, "CAL@firm.example")).toBe(true);
  });

  it("refuses a plain edit, someone else's name, or a format change", () => {
    expect(onlySuggests(before, para(t("Ship on Monday.")), CAL)).toBe(false);
    expect(
      onlySuggests(before, para(t("Ship on Friday."), t("!", add("amy@firm.example"))), CAL),
    ).toBe(false);
    expect(onlySuggests(before, para(t("Ship on Friday.", [{ type: "bold" }])), CAL)).toBe(false);
    expect(
      onlySuggests(
        before,
        { type: "doc", content: [...(before.content ?? []), { type: "paragraph" }] },
        CAL,
      ),
    ).toBe(false);
  });

  it("lets them take back their own, never another's", () => {
    const mine = para(t("Ship on Friday."), t(" soon", add(CAL)));
    expect(onlySuggests(mine, before, CAL)).toBe(true);
    const theirs = para(t("Ship on Friday."), t(" soon", add("amy@firm.example")));
    expect(onlySuggests(theirs, before, CAL)).toBe(false);
  });
});
