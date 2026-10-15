/** A list's cards: what each card shows by default, the address's form, and what a list keeps. */
import { date, defineRecord, metaOf, name, number, prose, status, text } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { cardOf, listFormOf, listFormParam } from "./cards.js";
import { keptOf, lastOf, restoreOf } from "./list-bar.js";

const two = {
  a: { label: "A", tone: "neutral" as const },
  b: { label: "B", tone: "neutral" as const },
};
const sites = {
  x: { label: "X", tone: "neutral" as const, mark: "x" as const },
  li: { label: "LinkedIn", tone: "neutral" as const, mark: "linkedin" as const },
};
const rec = (o: { site?: boolean; thumbs?: boolean; words?: boolean }) =>
  metaOf(
    defineRecord({
      id: "t.cards",
      app: "marketing",
      channel: o.site ? { field: "platform" } : null,
      name: { one: "thing", many: "things" },
      rows: async () => [],
      key: "id",
      title: "who",
      ...(o.words ? { subtitle: "words" } : {}),
      fields: {
        who: name("Who"),
        platform: status(sites, "Site"),
        kind: status(two, "Kind"),
        state: status(two, "State"),
        words: prose("Words"),
        note: text("Note"),
        count: number("Count"),
        city: text("City"),
        at: date("When"),
        seen: date("Seen"),
      },
      views: [{ id: "all", label: "All" }],
      ...(o.thumbs ? { thumbs: async () => ({}) } : {}),
    }),
    false,
  );
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
  it("nothing kept, nothing changed", () => {
    expect(restoreOf(undefined, p(""), false)).toBeNull();
    expect(restoreOf({}, p(""), false)).toBeNull();
  });
});
