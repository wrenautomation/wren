/** A list's cards: what each card shows by default, the address's form, and what a list keeps. */
import { describe, expect, it } from "vitest";
import { cardOf, cardWords, listFormOf, listFormParam, opensAs } from "./cards.js";
import { cardsMeta as rec } from "./fixtures/cards.js";
import { keptOf, lastOf, restoreOf } from "./list-bar.js";

const keys = (fs: readonly { key: string }[]) => fs.map((f) => f.key);
const columns = (meta: ReturnType<typeof rec>) => meta.fields.filter((f) => f.column);

describe("cardOf defaults", () => {
  it("mark from the channel, badge the first state that tells rows apart, body the prose subtitle", () => {
    const meta = rec({ site: true, words: true });
    const rows = [
      { who: "a", kind: "a", state: "a" },
      { who: "b", kind: "a", state: "b" },
    ];
    const card = cardOf(meta, columns(meta), {}, rows);
    expect(card.title?.key).toBe("who");
    expect(card.mark?.key).toBe("platform");
    expect(card.badge?.key).toBe("state");
    expect(card.body?.key).toBe("words");
  });
  it("facts: the next shown columns, no long words, four at most", () => {
    const meta = rec({ site: true, words: true });
    const card = cardOf(meta, columns(meta));
    expect(card.badge?.key).toBe("kind");
    expect(keys(card.facts)).toEqual(["state", "note", "count", "city"]);
  });
  it("follows the viewer's columns", () => {
    const meta = rec({});
    const picked = columns(meta).filter((f) => ["who", "city", "seen"].includes(f.key));
    const card = cardOf(meta, picked);
    expect(card.badge).toBeNull();
    expect(keys(card.facts)).toEqual(["city", "seen"]);
  });
  it("no channel, no mark; no prose subtitle, no body", () => {
    const card = cardOf(rec({}), columns(rec({})));
    expect(card.mark).toBeNull();
    expect(card.body).toBeNull();
  });
  it("a picture only where the type has them", () => {
    expect(cardOf(rec({}), []).media).toBeNull();
    expect(cardOf(rec({ thumbs: true }), []).media).toBe("wide");
    expect(cardOf(rec({}), [], { media: "square" }).media).toBeNull();
    expect(cardOf(rec({ thumbs: true }), [], { media: null }).media).toBeNull();
  });
});

describe("cardOf with a spec", () => {
  it("the page's parts win; unknown keys drop; facts skip what the card shows already", () => {
    const meta = rec({ site: true, thumbs: true });
    const card = cardOf(meta, columns(meta), {
      mark: null,
      badge: "kind",
      body: "note",
      facts: ["kind", "nope", "city", "at"],
      media: "tall",
    });
    expect(card.mark).toBeNull();
    expect(card.badge?.key).toBe("kind");
    expect(card.body?.key).toBe("note");
    expect(keys(card.facts)).toEqual(["city", "at"]);
    expect(card.media).toBe("tall");
  });
});

describe("cardOf with fields tried in turn", () => {
  it("a title and a body from the first field a row fills, the record's title last", () => {
    const meta = rec({ site: true });
    const card = cardOf(meta, columns(meta), { title: ["city", "note"], body: ["note", "city"] });
    expect(keys(card.titles)).toEqual(["city", "note", "who"]);
    expect(card.title?.key).toBe("city");
    expect(keys(card.bodies)).toEqual(["note", "city"]);
    expect(card.body?.key).toBe("note");
  });
  it("the words come from the first filled field, and those fields are spent", () => {
    const meta = rec({ site: true });
    const card = cardOf(meta, columns(meta), { title: "city", body: ["note", "city"] });
    const row: Record<string, string> = { who: "Ann", city: "", note: "hello" };
    const read = (k: string) => row[k] ?? "";
    expect(cardWords(card, read)).toEqual({ title: "Ann", body: "hello", spent: ["who", "note"] });
    row.city = "Oslo";
    row.note = "";
    expect(cardWords(card, read)).toEqual({ title: "Oslo", body: "Oslo", spent: ["city", "city"] });
  });
  it("a spec that names neither reads the record's title", () => {
    const meta = rec({});
    const card = cardOf(meta, columns(meta));
    expect(keys(card.titles)).toEqual(["who"]);
    expect(card.bodies).toEqual([]);
  });
});

describe("listFormOf", () => {
  const p = (s: string) => new URLSearchParams(s);
  it("cards only when the address says so and the page has them", () => {
    expect(listFormOf(p(""), undefined)).toBe("rows");
    expect(listFormOf(p("as=cards"), undefined)).toBe("cards");
    expect(listFormOf(p("as=cards"), {})).toBe("cards");
    expect(listFormOf(p("as=cards"), false)).toBe("rows");
    expect(listFormOf(p("as=grid"), undefined)).toBe("rows");
  });
  it("rows leave the address", () => {
    expect(listFormParam("rows")).toEqual({ as: null });
    expect(listFormParam("cards")).toEqual({ as: "cards" });
  });
  it("a page that asks opens as cards on a phone only", () => {
    const queue = { phone: "cards" as const };
    expect(opensAs(queue, true)).toBe("cards");
    expect(opensAs(queue, false)).toBe("rows");
    expect(opensAs({}, true)).toBe("rows");
    expect(opensAs(undefined, true)).toBe("rows");
    expect(opensAs(false, true)).toBe("rows");
    expect(listFormOf(p(""), queue, true)).toBe("cards");
    expect(listFormOf(p(""), queue, false)).toBe("rows");
    expect(listFormOf(p(""), {}, true)).toBe("rows");
  });
  it("his pick on a phone wins, rows too", () => {
    const queue = { phone: "cards" as const };
    expect(listFormOf(p("as=rows"), queue, true)).toBe("rows");
    expect(listFormOf(p("as=cards"), queue, true)).toBe("cards");
    expect(listFormOf(p("as=cards"), queue, false)).toBe("cards");
    expect(listFormOf(p("as=cards"), false, true)).toBe("rows");
  });
  it("the form a page opens as leaves the address; the other one names itself", () => {
    expect(listFormParam("cards", "cards")).toEqual({ as: null });
    expect(listFormParam("rows", "cards")).toEqual({ as: "rows" });
    expect(listFormParam("rows", "rows")).toEqual({ as: null });
  });
});

describe("rows or cards as a list pref", () => {
  const p = (s: string) => new URLSearchParams(s);
  it("kept with the rest of where he left the list", () => {
    expect(lastOf(p("view=all&sort=-at&as=cards&q=hi&sv=3"))).toEqual({
      sv: 3,
      view: "all",
      sort: "-at",
      as: "cards",
    });
  });
  it("a saved view keeps it", () => {
    expect(keptOf(rec({}), p("view=all&as=cards"))).toContain("as=cards");
  });
  it("restored on a bare link, with his view", () => {
    expect(restoreOf({ view: "all", as: "cards" }, p(""), false)).toEqual({
      change: { view: "all", sort: null, cols: null, as: "cards" },
    });
  });
  it("restored when the link names a view but not the form", () => {
    expect(restoreOf({ view: "all", as: "cards" }, p("view=done"), false)).toEqual({
      change: { as: "cards" },
    });
  });
  it("restored beside filters", () => {
    expect(restoreOf({ cols: "city", as: "cards" }, p("state=a"), true)).toEqual({
      change: { cols: "city", as: "cards" },
    });
  });
  it("a link that names it, or a saved view, wins", () => {
    expect(restoreOf({ as: "cards" }, p("as=cards&view=all"), false)).toBeNull();
    expect(restoreOf({ view: "all", as: "cards" }, p("sv=4"), false)).toBeNull();
  });
  it("a saved view he used last opens when it still exists", () => {
    expect(restoreOf({ sv: 4, as: "cards" }, p(""), false, new Set([4]))).toEqual({ sv: 4 });
    expect(restoreOf({ sv: 4, as: "cards" }, p(""), false, new Set())).toEqual({
      change: { view: null, sort: null, cols: null, as: "cards" },
    });
  });
  it("a rows pick on a phone page is kept and restored like cards", () => {
    expect(lastOf(p("as=rows"))).toEqual({ as: "rows" });
    expect(restoreOf({ as: "rows" }, p(""), false)).toEqual({
      change: { view: null, sort: null, cols: null, as: "rows" },
    });
    expect(restoreOf({ as: "rows" }, p("view=waiting"), false)).toEqual({
      change: { as: "rows" },
    });
  });
  it("nothing kept, nothing changed", () => {
    expect(restoreOf(undefined, p(""), false)).toBeNull();
    expect(restoreOf({}, p(""), false)).toBeNull();
  });
});
