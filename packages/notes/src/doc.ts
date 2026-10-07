/**
 * A note's doc: Yjs in, editor JSON, plain text, links and Markdown out, and back. Pure, so the
 * server, the CLI and the browser share it. The Yjs shape is y-prosemirror's (a node is an
 * `XmlElement` named for its type with its attrs; a run of text is one `XmlText` whose marks are
 * attributes), so what the server writes opens in the editor as if typed there.
 */
import * as Y from "yjs";
import { EMPTY, type NoteJson, Y_BODY, Y_TITLE } from "./types.js";

type Mark = NonNullable<NoteJson["marks"]>[number];

/** The note's body as editor JSON. */
export function readBody(doc: Y.Doc): NoteJson {
  const content = doc.getXmlFragment(Y_BODY).toArray().flatMap(readNode);
  return { type: "doc", content: content.length ? content : (EMPTY.content ?? []) };
}

function readNode(item: unknown): NoteJson[] {
  if (item instanceof Y.XmlText)
    return item.toDelta().map((d: { insert: unknown; attributes?: Record<string, unknown> }) => {
      const out: NoteJson = { type: "text", text: String(d.insert) };
      if (d.attributes && Object.keys(d.attributes).length)
        out.marks = Object.entries(d.attributes).map(([name, attrs]) => {
          const m: Mark = { type: markName(name) };
          if (attrs && typeof attrs === "object" && Object.keys(attrs).length)
            m.attrs = attrs as Record<string, unknown>;
          return m;
        });
      return out;
    });
  if (item instanceof Y.XmlElement) {
    const out: NoteJson = { type: item.nodeName };
    const attrs = item.getAttributes();
    if (Object.keys(attrs).length) out.attrs = attrs;
    const kids = item.toArray().flatMap(readNode);
    if (kids.length) out.content = kids;
    return [out];
  }
  return [];
}

/** y-prosemirror names a mark that may overlap itself `name--<hash>`. */
const markName = (attr: string) => attr.split("--")[0] ?? attr;

/** The note's title as typed, "" when none. */
export const readTitle = (doc: Y.Doc): string => doc.getText(Y_TITLE).toString();

/** Replace the whole body with `json`, as one change. */
export function writeBody(doc: Y.Doc, json: NoteJson) {
  const frag = doc.getXmlFragment(Y_BODY);
  doc.transact(() => {
    if (frag.length) frag.delete(0, frag.length);
    frag.insert(0, writeKids(json.content?.length ? json.content : (EMPTY.content ?? [])));
  });
}

/** Add `json`'s blocks after what's there, as one change. */
export function appendBody(doc: Y.Doc, json: NoteJson) {
  const frag = doc.getXmlFragment(Y_BODY);
  const blocks = json.content ?? [];
  if (!blocks.length) return;
  doc.transact(() => {
    // An empty first paragraph, as a new note has, makes way for what's added.
    const only = frag.length === 1 ? frag.get(0) : null;
    if (only instanceof Y.XmlElement && only.nodeName === "paragraph" && only.length === 0)
      frag.delete(0, 1);
    frag.insert(frag.length, writeKids(blocks));
  });
}

/** Set the title, as one change. */
export function writeTitle(doc: Y.Doc, title: string) {
  const t = doc.getText(Y_TITLE);
  doc.transact(() => {
    if (t.length) t.delete(0, t.length);
    if (title) t.insert(0, title);
  });
}

function writeKids(kids: readonly NoteJson[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let run: NoteJson[] = [];
  const flush = () => {
    if (!run.length) return;
    const t = new Y.XmlText();
    let at = 0;
    for (const n of run) {
      const s = n.text ?? "";
      if (!s) continue;
      t.insert(at, s, attrsOfMarks(n.marks));
      at += s.length;
    }
    out.push(t);
    run = [];
  };
  for (const k of kids) {
    if (k.type === "text") {
      run.push(k);
      continue;
    }
    flush();
    const el = new Y.XmlElement(k.type);
    for (const [key, v] of Object.entries(k.attrs ?? {}))
      if (v !== null && v !== undefined) el.setAttribute(key, v as string);
    const inner = writeKids(k.content ?? []);
    if (inner.length) el.insert(0, inner);
    out.push(el);
  }
  flush();
  return out;
}

/** Marks as XmlText attributes. Plain text gets `{}`, so it never takes the mark on its left. */
function attrsOfMarks(marks: readonly Mark[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of marks ?? []) out[m.type] = m.attrs ?? {};
  return out;
}

/** A Yjs doc from editor JSON and a title: a new note's first state, or a test's. */
export function docOf(json: NoteJson, title = ""): Y.Doc {
  const doc = new Y.Doc();
  writeBody(doc, json);
  if (title) writeTitle(doc, title);
  return doc;
}

// ---- Plain text ----

/** The words, one block a line: what search, compare, the CLI and Ask Claude read. */
export function textOf(json: NoteJson): string {
  const lines: string[] = [];
  const blocks = (kids: readonly NoteJson[] | undefined, lead = "") => {
    let first = true;
    for (const k of kids ?? []) {
      block(k, first ? lead : "");
      first = false;
    }
  };
  const block = (n: NoteJson, lead: string) => {
    switch (n.type) {
      case "paragraph":
      case "heading":
        lines.push(lead + inlineText(n.content));
        return;
      case "codeBlock":
        lines.push(...plain(n.content).split("\n"));
        return;
      case "horizontalRule":
        lines.push("---");
        return;
      case "image":
        if (n.attrs?.alt) lines.push(`[image: ${String(n.attrs.alt)}]`);
        return;
      case "taskItem":
        blocks(n.content, n.attrs?.checked ? "[x] " : "[ ] ");
        return;
      case "tableRow":
        lines.push(
          (n.content ?? [])
            .map((c) => (c.content ?? []).map((p) => inlineText(p.content)).join(" "))
            .join(" | "),
        );
        return;
      default:
        blocks(n.content, lead);
    }
  };
  blocks(json.content);
  return lines
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const inlineText = (kids: readonly NoteJson[] | undefined): string =>
  (kids ?? [])
    .map((k) =>
      k.type === "text"
        ? (k.text ?? "")
        : k.type === "mention"
          ? `@${String(k.attrs?.label ?? k.attrs?.id ?? "")}`
          : k.type === "hardBreak"
            ? "\n"
            : "",
    )
    .join("");

/** What a list shows for a note: its title, else its first line, else "Untitled". */
export function nameOf(title: string, text: string): string {
  const t = title.trim();
  if (t) return t;
  const first = text.split("\n").find((l) => l.trim() && l.trim() !== "---");
  return first ? clip(first.replace(/^\[[ x]\] /, "").trim(), 80) : "Untitled";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---- Links ----

export interface Link {
  /** `<record type>:<id>`, `note:<id>` or `person:<email>`. */
  target: string;
  label: string;
}

const NOTE_HREF = /(?:^|\/)notes\/doc\/([0-9a-f-]{36})(?:[/?#]|$)/i;

/** Every mention, and every link to another note, once each. */
export function linksOf(json: NoteJson): Link[] {
  const out = new Map<string, Link>();
  const walk = (n: NoteJson) => {
    if (n.type === "mention" && typeof n.attrs?.id === "string" && n.attrs.id.includes(":")) {
      const target = n.attrs.id.slice(0, 300);
      if (!out.has(target))
        out.set(target, { target, label: String(n.attrs.label ?? "").slice(0, 300) });
    }
    for (const m of n.marks ?? [])
      if (m.type === "link" && typeof m.attrs?.href === "string") {
        const id = NOTE_HREF.exec(m.attrs.href)?.[1];
        if (id && !out.has(`note:${id}`))
          out.set(`note:${id}`, { target: `note:${id}`, label: (n.text ?? "").slice(0, 300) });
      }
    for (const k of n.content ?? []) walk(k);
  };
  walk(json);
  return [...out.values()];
}

/** The people a note mentions: `person:<email>` targets, as emails. */
export const peopleIn = (json: NoteJson): string[] =>
  linksOf(json)
    .filter((l) => l.target.startsWith("person:"))
    .map((l) => l.target.slice("person:".length));

// ---- Markdown ----

/** The note as Markdown: the CLI's `show`, Ask Claude's context, and export. */
export function toMarkdown(json: NoteJson): string {
  const out: string[] = [];
  const blocks = (list: readonly NoteJson[], indent: string) => {
    for (const b of list) block(b, indent);
  };
  const block = (n: NoteJson, indent: string) => {
    switch (n.type) {
      case "heading":
        out.push(`${indent}${"#".repeat(Number(n.attrs?.level ?? 1))} ${inline(n.content)}`, "");
        return;
      case "paragraph":
        out.push(`${indent}${inline(n.content)}`, "");
        return;
      case "blockquote": {
        const inner: string[] = [];
        const save = out.splice(0);
        blocks(n.content ?? [], "");
        inner.push(...out.splice(0));
        out.push(...save, ...trimBlank(inner).map((l) => `${indent}> ${l}`.trimEnd()), "");
        return;
      }
      case "codeBlock":
        out.push(
          `${indent}\`\`\`${String(n.attrs?.language ?? "")}`,
          ...plain(n.content)
            .split("\n")
            .map((l) => indent + l),
          `${indent}\`\`\``,
          "",
        );
        return;
      case "horizontalRule":
        out.push(`${indent}---`, "");
        return;
      case "image":
        out.push(`${indent}![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`, "");
        return;
      case "bulletList":
      case "orderedList":
      case "taskList": {
        let i = Number(n.attrs?.start ?? 1);
        for (const item of n.content ?? []) {
          const mark =
            n.type === "orderedList"
              ? `${i++}. `
              : n.type === "taskList"
                ? `- [${item.attrs?.checked ? "x" : " "}] `
                : "- ";
          const [first, ...rest] = item.content ?? [];
          out.push(`${indent}${mark}${first ? inline(first.content) : ""}`);
          const pad = indent + " ".repeat(mark.length);
          for (const r of rest) {
            if (r.type === "paragraph") out.push(`${pad}${inline(r.content)}`);
            else block(r, pad);
            if (out.at(-1) === "") out.pop();
          }
        }
        out.push("");
        return;
      }
      case "table": {
        const rows = (n.content ?? []).map((r) =>
          (r.content ?? []).map((c) =>
            (c.content ?? [])
              .map((p) => inline(p.content))
              .join(" ")
              .replaceAll("|", "\\|"),
          ),
        );
        const width = Math.max(1, ...rows.map((r) => r.length));
        const row = (r: string[]) =>
          `${indent}| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
        const [head = [], ...body] = rows;
        out.push(row(head), `${indent}|${" --- |".repeat(width)}`, ...body.map(row), "");
        return;
      }
      default:
        if (n.content) blocks(n.content, indent);
    }
  };
  blocks(json.content ?? [], "");
  return `${trimBlank(out).join("\n")}\n`;
}

const trimBlank = (lines: string[]) => {
  const out = [...lines];
  while (out.at(-1) === "") out.pop();
  while (out[0] === "") out.shift();
  return out;
};

const plain = (kids: readonly NoteJson[] | undefined) =>
  (kids ?? []).map((k) => (k.type === "text" ? (k.text ?? "") : "")).join("");

function inline(kids: readonly NoteJson[] | undefined): string {
  let s = "";
  for (const k of kids ?? []) {
    if (k.type === "hardBreak") {
      s += "  \n";
      continue;
    }
    if (k.type === "mention") {
      s += `@${String(k.attrs?.label ?? k.attrs?.id ?? "")}`;
      continue;
    }
    if (k.type === "image") {
      s += `![${String(k.attrs?.alt ?? "")}](${String(k.attrs?.src ?? "")})`;
      continue;
    }
    let t = k.text ?? "";
    const marks = new Set((k.marks ?? []).map((m) => m.type));
    if (marks.has("code")) t = `\`${t}\``;
    else {
      if (marks.has("bold")) t = `**${t}**`;
      if (marks.has("italic")) t = `*${t}*`;
      if (marks.has("strike")) t = `~~${t}~~`;
    }
    const link = k.marks?.find((m) => m.type === "link");
    if (link) t = `[${t}](${String(link.attrs?.href ?? "")})`;
    s += t;
  }
  return s;
}

/**
 * Markdown to editor JSON: headings, lists, checklists, quotes, code, rules, tables and inline
 * bold, italic, strike, code and links. What the CLI, quick capture and import write.
 */
export function fromMarkdown(md: string): NoteJson {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  return { type: "doc", content: parseBlocks(lines) };
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

function parseBlocks(lines: string[]): NoteJson[] {
  const out: NoteJson[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith(fence[1] ?? "```"))
        body.push(lines[i++] ?? "");
      i++;
      const text = body.join("\n");
      out.push({
        type: "codeBlock",
        attrs: { language: fence[2]?.trim() || null },
        ...(text ? { content: [{ type: "text", text }] } : {}),
      });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(textBlock("heading", h[2] ?? "", { level: Math.min(h[1]?.length ?? 1, 3) }));
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? ""))
        body.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""));
      out.push({ type: "blockquote", content: parseBlocks(body) });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const rows: string[][] = [];
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replaceAll("\\|", "|"));
      rows.push(cells(line));
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? ""))
        rows.push(cells(lines[i++] ?? ""));
      out.push({
        type: "table",
        content: rows.map((r, ri) => ({
          type: "tableRow",
          content: r.map((c) => ({
            type: ri === 0 ? "tableHeader" : "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [textBlock("paragraph", c)],
          })),
        })),
      });
      continue;
    }
    if (LIST.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || /^(#{1,6}\s|\s*>|\s*```|\s*~~~)/.test(l) || LIST.test(l)) break;
      para.push(l);
      i++;
    }
    out.push(paragraphOf(para));
  }
  return out;
}

function parseList(lines: string[], start: number): [NoteJson, number] {
  const first = LIST.exec(lines[start] ?? "");
  const indent = first?.[1]?.length ?? 0;
  const ordered = /\d/.test(first?.[2] ?? "");
  const task = !!first?.[3];
  const items: NoteJson[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i] ?? "");
    if (!m || (m[1]?.length ?? 0) !== indent) break;
    if (/\d/.test(m[2] ?? "") !== ordered || !!m[3] !== task) break;
    i++;
    const inner: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      const sub = LIST.exec(l);
      if (sub && (sub[1]?.length ?? 0) <= indent) break;
      if (!l.trim()) {
        const nextLine = lines[i + 1] ?? "";
        if (!nextLine.startsWith(" ".repeat(indent + 2))) break;
      } else if (!sub && !l.startsWith(" ".repeat(indent + 1))) break;
      inner.push(l.slice(Math.min(indent + 2, l.length - l.trimStart().length)));
      i++;
    }
    const content = [textBlock("paragraph", m[4] ?? ""), ...parseBlocks(inner)];
    items.push(
      task
        ? { type: "taskItem", attrs: { checked: /x/i.test(m[3] ?? "") }, content }
        : { type: "listItem", content },
    );
  }
  const n = /^(\d+)/.exec(first?.[2] ?? "")?.[1];
  return [
    task
      ? { type: "taskList", content: items }
      : ordered
        ? { type: "orderedList", attrs: { start: Number(n ?? 1) }, content: items }
        : { type: "bulletList", content: items },
    i,
  ];
}

function paragraphOf(lines: string[]): NoteJson {
  const kids: NoteJson[] = [];
  lines.forEach((l, idx) => {
    const hard = idx < lines.length - 1 && /( {2,}|\\)$/.test(l);
    kids.push(...parseInline(l.replace(/( {2,}|\\)$/, "").trim()));
    if (idx < lines.length - 1)
      kids.push(hard ? { type: "hardBreak" } : { type: "text", text: " " });
  });
  return { type: "paragraph", ...(kids.length ? { content: mergeText(kids) } : {}) };
}

function textBlock(type: string, s: string, attrs?: Record<string, unknown>): NoteJson {
  const kids = parseInline(s.trim());
  return { type, ...(attrs ? { attrs } : {}), ...(kids.length ? { content: kids } : {}) };
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(~~[^~]+~~)|(!?\[[^\]]*\]\([^)\s]+\))/;

function parseInline(s: string, marks: Mark[] = []): NoteJson[] {
  const out: NoteJson[] = [];
  let rest = s;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(textNode(rest, marks));
      break;
    }
    if (m.index) out.push(textNode(rest.slice(0, m.index), marks));
    const tok = m[0];
    if (m[1]) out.push(textNode(tok.slice(1, -1), [...marks, { type: "code" }]));
    else if (m[2]) out.push(...parseInline(tok.slice(2, -2), [...marks, { type: "bold" }]));
    else if (m[3]) out.push(...parseInline(tok.slice(1, -1), [...marks, { type: "italic" }]));
    else if (m[4]) out.push(...parseInline(tok.slice(2, -2), [...marks, { type: "strike" }]));
    else if (m[5]) {
      const lm = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok);
      if (lm?.[1]) out.push({ type: "image", attrs: { src: lm[3], alt: lm[2] || null } });
      else
        out.push(
          ...parseInline(lm?.[2] || (lm?.[3] ?? ""), [
            ...marks,
            { type: "link", attrs: { href: lm?.[3] ?? "" } },
          ]),
        );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return mergeText(out.filter((n) => n.type !== "text" || n.text));
}

const textNode = (text: string, marks: Mark[]): NoteJson =>
  marks.length ? { type: "text", text, marks } : { type: "text", text };

function mergeText(kids: NoteJson[]): NoteJson[] {
  const out: NoteJson[] = [];
  for (const k of kids) {
    const prev = out.at(-1);
    if (
      prev?.type === "text" &&
      k.type === "text" &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(k.marks ?? [])
    )
      prev.text = (prev.text ?? "") + (k.text ?? "");
    else out.push({ ...k });
  }
  return out;
}

/** One line a capture adds to a Dump note: the time, then the words. */
export function captureBlock(words: string, at: Date, zone = "America/New_York"): NoteJson {
  const stamp = at.toLocaleString("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const parsed = fromMarkdown(words.trim()).content ?? [];
  const [first, ...rest] = parsed;
  const lead: NoteJson = {
    type: "paragraph",
    content: [
      { type: "text", text: stamp, marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      ...(first?.type === "paragraph" ? (first.content ?? []) : []),
    ],
  };
  return {
    type: "doc",
    content: first?.type === "paragraph" ? [lead, ...rest] : [lead, ...parsed],
  };
}

// ---- Wire ----

/** Base64 both sides of the wire: no Buffer, so the browser shares it. */
export function toB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
