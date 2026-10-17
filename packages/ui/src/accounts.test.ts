/** The shared account pieces read the record's declared account (designs/2026-10-15-accounts-first-class.md). */
import { setRecordAccounts } from "@wren/core/record-accounts";
import { afterEach, describe, expect, it } from "vitest";
import { accountFieldOf, accountState } from "./accounts.js";
import { choicesOf } from "./edits.js";
import { accountsMeta } from "./fixtures/accounts.js";
import { quickFilters } from "./list-bar.js";

afterEach(() => setRecordAccounts([]));

const meta = accountsMeta;

describe("a declared account", () => {
  it("leads the quick filters", () => {
    expect(quickFilters(meta(true)).map((f) => f.key)).toEqual(["on", "platform", "state"]);
  });
  it("undeclared, it is just another field", () => {
    expect(accountFieldOf(meta(false))).toBeNull();
    expect(quickFilters(meta(false))[0]?.key).toBe("platform");
  });
  it("the badge's state: label and mark; an unknown key reads as itself", () => {
    const f = accountFieldOf(meta(true));
    expect(accountState(f, "reddit@two")).toMatchObject({
      label: "u/synthetic_two",
      mark: "reddit",
    });
    expect(accountState(f, "gone@x").label).toBe("gone@x");
  });
  it("a reassign offers only accounts on the same platform", () => {
    const f = accountFieldOf(meta(true));
    if (!f) throw new Error("no account field");
    expect(choicesOf(f, "reddit@one").map(([k]) => k)).toEqual(["reddit@one", "reddit@two"]);
  });
});
