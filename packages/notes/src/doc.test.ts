import { Schema } from "@tiptap/pm/model";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  appendBody,
  captureBlock,
  cleanBody,
  docOf,
  fromB64,
  fromMarkdown,
  linksOf,
  nameOf,
  readBody,
  readTitle,
  textOf,
  toB64,
  toMarkdown,
  writeBody,
  writeTitle,
} from "./doc.js";
import type { NoteJson } from "./types.js";

const NOTE: NoteJson = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Call " },
        { type: "text", text: "Acme", marks: [{ type: "bold" }] },
        { type: "text", text: " about " },
        { type: "mention", attrs: { id: "console.client:acme", label: "Acme Co" } },
        { type: "text", text: " and " },
        {
          type: "text",
          text: "the brief",
          marks: [
            { type: "link", attrs: { href: "/notes/doc/0f8fad5b-d9cb-469f-a165-70867728950e" } },
          ],
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "draft" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "send" }] }],
        },
      ],
    },
    { type: "horizontalRule" },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const a = 1;\nconst b = 2;" }],
    },
  ],
};

/** Enough of the editor's schema for y-prosemirror's own writer. */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    taskList: { group: "block", content: "taskItem+" },
    taskItem: { content: "paragraph block*", attrs: { checked: { default: false } } },
    horizontalRule: { group: "block" },
    codeBlock: {
      group: "block",
      content: "text*",
      marks: "",
      attrs: { language: { default: null } },
    },
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { id: {}, label: { default: null } },
    },
    text: { group: "inline" },
  },
  marks: { bold: {}, link: { attrs: { href: {} } } },
});

describe("the Yjs shape", () => {
  it("reads what y-prosemirror writes", () => {
    const doc = new Y.Doc();
    prosemirrorJSONToYXmlFragment(schema, NOTE, doc.getXmlFragment("default"));
    expect(readBody(doc)).toEqual(NOTE);
  });

  it("writes what y-prosemirror reads", () => {
    const doc = docOf(NOTE, "Plan for Q4");
    // y-prosemirror's reader gives every mark `attrs`, empty or not.
    const bare = JSON.parse(
      JSON.stringify(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment("default"))).replaceAll(
        ',"attrs":{}',
        "",
      ),
    );
    expect(bare).toEqual(NOTE);
    expect(readTitle(doc)).toBe("Plan for Q4");
  });

  it("keeps plain text after a mark plain", () => {
    const doc = docOf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " plain" },
          ],
        },
      ],
    });
    expect(readBody(doc).content?.[0]?.content?.[1]).toEqual({ type: "text", text: " plain" });
  });

  it("merges two offline edits made from one state", () => {
    const base = docOf(fromMarkdown("one"));
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
    appendBody(a, fromMarkdown("from a"));
    writeTitle(b, "from b");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(textOf(readBody(a))).toBe("one\nfrom a");
    expect(readBody(a)).toEqual(readBody(b));
    expect(readTitle(a)).toBe("from b");
  });

  it("replaces and appends as one change each", () => {
    const doc = docOf(fromMarkdown("old"));
    const seen: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => seen.push(u));
    writeBody(doc, fromMarkdown("new"));
    appendBody(doc, fromMarkdown("more"));
    expect(seen).toHaveLength(2);
    expect(textOf(readBody(doc))).toBe("new\nmore");
  });

  it("drops a new note's empty line when something is appended", () => {
    const doc = docOf({ type: "doc", content: [] });
    appendBody(doc, fromMarkdown("first"));
    expect(readBody(doc).content).toHaveLength(1);
  });
});

describe("derived", () => {
  it("text, one block a line", () => {
    expect(textOf(NOTE)).toBe(
      "Plan\nCall Acme about @Acme Co and the brief\n[x] draft\n[ ] send\n---\nconst a = 1;\nconst b = 2;",
    );
  });

  it("links: mentions and links to notes", () => {
    expect(linksOf(NOTE)).toEqual([
      { target: "console.client:acme", label: "Acme Co" },
      { target: "note:0f8fad5b-d9cb-469f-a165-70867728950e", label: "the brief" },
    ]);
  });

  it("a name from the title, else the first line", () => {
    expect(nameOf(" Q4 ", "x")).toBe("Q4");
    expect(nameOf("", "\n[ ] call Sam\nmore")).toBe("call Sam");
    expect(nameOf("", "")).toBe("Untitled");
  });

  it("base64 both ways", () => {
    const u = new Uint8Array([0, 1, 2, 250, 255]);
    expect(fromB64(toB64(u))).toEqual(u);
  });
});

describe("markdown", () => {
  it("reads the common shapes", () => {
    const md = [
      "# Title",
      "",
      "Some **bold**, *it*, `code` and [a link](https://x.test).",
      "",
      "- one",
      "- two",
      "  - nested",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] todo",
      "- [x] done",
      "",
      "> quoted",
      "",
      "```js",
      "x()",
      "```",
      "",
      "---",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const json = fromMarkdown(md);
    expect(json.content?.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "table",
    ]);
    expect(json.content?.[1]?.content).toEqual([
      { type: "text", text: "Some " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: ", " },
      { type: "text", text: "it", marks: [{ type: "italic" }] },
      { type: "text", text: ", " },
      { type: "text", text: "code", marks: [{ type: "code" }] },
      { type: "text", text: " and " },
      {
        type: "text",
        text: "a link",
        marks: [{ type: "link", attrs: { href: "https://x.test" } }],
      },
      { type: "text", text: "." },
    ]);
    expect(json.content?.[2]?.content?.[1]?.content?.[1]?.type).toBe("bulletList");
    expect(json.content?.[4]?.content?.[1]?.attrs).toEqual({ checked: true });
  });

  it("round trips through toMarkdown", () => {
    const md =
      "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n- [ ] todo\n- [x] done\n\n> quoted\n\n```js\nx()\n```\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(toMarkdown(fromMarkdown(md))).toBe(md);
  });

  it("a capture leads with its time", () => {
    const json = captureBlock("call **Sam** back", new Date("2026-10-07T15:04:00Z"), "UTC");
    expect(textOf(json)).toBe("Oct 7, 3:04 PM call Sam back");
    expect(json.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  });
});

describe("cleanBody", () => {
  it("keeps what the editor knows", () => {
    expect(cleanBody(NOTE)).toEqual(NOTE);
  });

  it("drops unknown marks, attrs and unsafe links and images; unwraps unknown blocks", () => {
    const out = cleanBody({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 6, onclick: "x" },
          content: [{ type: "text", text: "Big" }],
        },
        {
          type: "section",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "a",
                  marks: [{ type: "bold" }, { type: "font", attrs: { f: 1 } }],
                },
                {
                  type: "text",
                  text: "b",
                  marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                },
                { type: "text", text: "" },
              ],
            },
          ],
        },
        { type: "image", attrs: { src: "data:image/png;base64,AAAA" } },
        { type: "image", attrs: { src: "wren-file:notes/x/a.png", alt: "A" } },
      ],
    });
    expect(out).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Big" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }] },
            { type: "text", text: "b" },
          ],
        },
        { type: "image", attrs: { src: "wren-file:notes/x/a.png", alt: "A" } },
      ],
    });
  });

  it("refuses what isn't a doc", () => {
    expect(cleanBody(null)).toBeNull();
    expect(cleanBody("doc")).toBeNull();
    expect(cleanBody({ type: "paragraph" })).toBeNull();
  });
});
