import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { toDocx } from "./docx.js";
import { type NoteJson, SUGGEST_ADD, SUGGEST_DEL } from "./types.js";

const t = (text: string, ...marks: NonNullable<NoteJson["marks"]>): NoteJson => ({
  type: "text",
  text,
  ...(marks.length ? { marks } : {}),
});
const p = (...content: NoteJson[]): NoteJson => ({ type: "paragraph", content });
const li = (...content: NoteJson[]): NoteJson => ({ type: "listItem", content });

const NOTE: NoteJson = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("Launch plan")] },
    p(
      t("Ship "),
      t("Friday", { type: "bold" }),
      t(" and "),
      t("tell", { type: "italic" }),
      t(" "),
      t("Ada", { type: "link", attrs: { href: "https://example.test/ada" } }),
    ),
    {
      type: "bulletList",
      content: [
        li(p(t("Pick the venue")), {
          type: "bulletList",
          content: [li(p(t("Ask about parking")))],
        }),
      ],
    },
    { type: "orderedList", content: [li(p(t("First"))), li(p(t("Second")))] },
    {
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Book it"))] }],
    },
    { type: "blockquote", content: [p(t("Quoted words"))] },
    { type: "codeBlock", content: [t("let a = 1;\nlet b = 2;")] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [p(t("Who"))] },
            { type: "tableHeader", content: [p(t("What"))] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p(t("Oz"))] },
            { type: "tableCell", content: [p(t("Food"))] },
          ],
        },
      ],
    },
    p(
      t("kept "),
      t("added", { type: SUGGEST_ADD, attrs: { by: "oz@example.test", at: "2026-10-07T10:00" } }),
      t("gone", { type: SUGGEST_DEL, attrs: { by: "oz@example.test", at: "2026-10-07T10:01" } }),
    ),
    { type: "image", attrs: { src: "wren-file:notes/x/pic.png", alt: "A chart" } },
  ],
};

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const html = async (bytes: Uint8Array) =>
  (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;

describe("toDocx", () => {
  it("writes a Word file that reads back with its blocks and marks", async () => {
    const bytes = await toDocx(NOTE, { title: "Plan" });
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const out = await html(bytes);
    expect(out).toContain("<h1>Launch plan</h1>");
    expect(out).toContain("<strong>Friday</strong>");
    expect(out).toContain("<em>tell</em>");
    expect(out).toContain('<a href="https://example.test/ada">Ada</a>');
    expect(out).toMatch(/<ul><li>Pick the venue<ul><li>Ask about parking<\/li><\/ul><\/li><\/ul>/);
    expect(out).toMatch(/<ol><li>First<\/li><li>Second<\/li><\/ol>/);
    expect(out).toContain("☑ Book it");
    expect(out).toContain("Quoted words");
    expect(out).toContain("let a = 1;");
    expect(out).toMatch(/<table>.*Who.*What.*Oz.*Food.*<\/table>/);
    expect(out).toContain("[image: A chart]");
  });

  it("puts open suggestions in as tracked changes", async () => {
    const out = await html(await toDocx(NOTE));
    // mammoth reads an insertion as text and drops a deletion, as Word's "no markup" view does.
    expect(out).toContain("kept added");
    expect(out).not.toContain("gone");
  });

  it("puts in the images the caller fetches", async () => {
    const asked: string[] = [];
    const bytes = await toDocx(NOTE, {
      image: async (src) => {
        asked.push(src);
        return { data: PNG, type: "png", width: 1200, height: 600 };
      },
    });
    expect(asked).toEqual(["wren-file:notes/x/pic.png"]);
    expect(await html(bytes)).toMatch(/<img alt="A chart" src="data:image\/png;base64,[^"]+"/);
  });

  it("makes an empty note a valid file", async () => {
    const out = await html(await toDocx({ type: "doc", content: [] }));
    expect(out).toBe("");
  });
});
