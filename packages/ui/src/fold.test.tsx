import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FoldList, FoldPreview, foldOf } from "./fold.js";

const M = [
  {
    id: "comment:2",
    text: "And a question?",
    at: "2026-10-01T03:00:00.000Z",
    state: "waiting",
    open: true,
  },
  {
    id: "comment:1",
    text: "First reply",
    at: "2026-10-01T02:00:00.000Z",
    state: "answered",
    open: false,
  },
];
const meta = { fold: "messages" };

describe("foldOf", () => {
  it("reads the folded messages, as an array or as JSON text", () => {
    expect(foldOf(meta, { messages: M })?.map((m) => m.id)).toEqual(["comment:2", "comment:1"]);
    expect(foldOf(meta, { messages: JSON.stringify(M) })?.length).toBe(2);
  });
  it("is null for one message, a type with no fold, or junk", () => {
    expect(foldOf(meta, { messages: [M[0]] })).toBeNull();
    expect(foldOf({}, { messages: M })).toBeNull();
    expect(foldOf(meta, { messages: "{not json" })).toBeNull();
    expect(foldOf(meta, { messages: [{ nope: 1 }, { nope: 2 }] })).toBeNull();
  });
});

describe("FoldPreview", () => {
  it("shows the newest first, each marked, and counts the rest", () => {
    const three = [...M, { ...M[1], id: "comment:0", text: "Oldest" }] as typeof M;
    const html = renderToStaticMarkup(<FoldPreview messages={three} lines={2} />);
    expect(html.indexOf("And a question?")).toBeLessThan(html.indexOf("First reply"));
    expect(html).toContain('aria-label="Waiting"');
    expect(html).toContain('aria-label="Answered"');
    expect(html).not.toContain("Oldest");
    expect(html).toContain("1 earlier message");
  });
});

describe("FoldList", () => {
  it("says which one Reply answers", () => {
    const html = renderToStaticMarkup(<FoldList messages={M} current="comment:2" />);
    expect(html).toContain("Reply goes here");
    expect(html.indexOf("Reply goes here")).toBeLessThan(html.indexOf("First reply"));
  });
});
