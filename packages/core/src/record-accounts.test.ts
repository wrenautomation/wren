/** Accounts as a record dimension (designs/2026-10-15-accounts-first-class.md). Synthetic logins. */
import { afterEach, describe, expect, it } from "vitest";
import {
  accountChoices,
  accountLabel,
  accountSource,
  accountsOn,
  defaultAccount,
  refreshRecordAccounts,
  setRecordAccounts,
} from "./record-accounts.js";
import { accountField, defineRecord, metaOf, name, text } from "./records.js";

const SYNTH = [
  { key: "reddit@one", platform: "reddit", label: "u/synthetic_one" },
  { key: "reddit@two", platform: "reddit", label: "u/synthetic_two" },
  { key: "linkedin@one", platform: "linkedin", label: "Synthetic Co" },
];
const db = {} as never;

afterEach(() => {
  accountSource(null);
  setRecordAccounts([]);
});

const rec = (account: "on" | "words" | undefined) =>
  defineRecord({
    id: "t.sends",
    app: "marketing",
    channel: null,
    name: { one: "send", many: "sends" },
    rows: async () => [],
    key: "id",
    title: "who",
    fields: { who: name("Who"), on: accountField("On"), words: text("Words") },
    views: [{ id: "all", label: "All" }],
    ...(account ? { account } : {}),
  });

describe("defaultAccount", () => {
  it("a pick, else the one they spoke to, else the place's, else the default login", () => {
    expect(defaultAccount({ picked: "reddit@two", spokeTo: "reddit@one" })).toBe("reddit@two");
    expect(defaultAccount({ spokeTo: "reddit@one", assigned: "reddit@two" })).toBe("reddit@one");
    expect(defaultAccount({ assigned: "reddit@two" })).toBe("reddit@two");
    expect(defaultAccount({ picked: "", spokeTo: null })).toBeNull();
  });
});

describe("the account registry", () => {
  it("choices and platform lists come from the set", () => {
    setRecordAccounts(SYNTH);
    expect(accountChoices()).toEqual({
      "reddit@one": "u/synthetic_one",
      "reddit@two": "u/synthetic_two",
      "linkedin@one": "Synthetic Co",
    });
    expect(accountsOn("reddit").map((a) => a.key)).toEqual(["reddit@one", "reddit@two"]);
  });
  it("a source loads once a TTL; a failed load keeps the last set", async () => {
    let calls = 0;
    accountSource(async () => {
      calls++;
      if (calls === 2) throw new Error("down");
      return SYNTH;
    });
    await refreshRecordAccounts(db, 1_000_000);
    await refreshRecordAccounts(db, 1_000_500);
    expect(calls).toBe(1);
    await refreshRecordAccounts(db, 2_000_000);
    expect(calls).toBe(2);
    expect(Object.keys(accountChoices())).toHaveLength(3);
  });
  it("labels a Reddit login u/handle, others by handle, no handle by key", () => {
    expect(accountLabel("reddit", "reddit@one", "synthetic_one")).toBe("u/synthetic_one");
    expect(accountLabel("linkedin", "linkedin@one", "Synthetic Co")).toBe("Synthetic Co");
    expect(accountLabel("x", "x@one", null)).toBe("x@one");
  });
});

describe("declaring a record's account", () => {
  it("the meta names it, flags the field and marks each choice with its platform", () => {
    setRecordAccounts(SYNTH);
    const meta = metaOf(rec("on"), false);
    expect(meta.account).toBe("on");
    const on = meta.fields.find((f) => f.key === "on");
    expect(on?.account).toBe(true);
    expect(on?.states?.["reddit@one"]).toMatchObject({ label: "u/synthetic_one", mark: "reddit" });
    expect(meta.fields.find((f) => f.key === "words")?.account).toBeUndefined();
  });
  it("a field kept to some platforms offers only their accounts", () => {
    setRecordAccounts(SYNTH);
    const t = defineRecord({
      id: "t.threads",
      app: "marketing",
      channel: null,
      name: { one: "thread", many: "threads" },
      rows: async () => [],
      key: "id",
      title: "who",
      fields: { who: name("Who"), on: accountField("From", { platforms: ["reddit"] }) },
      views: [{ id: "all", label: "All" }],
      account: "on",
    });
    const on = metaOf(t, false).fields.find((f) => f.key === "on");
    expect(Object.keys(on?.states ?? {}).sort()).toEqual(["reddit@one", "reddit@two"]);
  });
  it("only an accountField can be the account", () => {
    expect(() => rec("words")).toThrow(/must be an accountField/);
  });
  it("undeclared, the record has no account", () => {
    expect(metaOf(rec(undefined), false).account).toBeUndefined();
  });
});
