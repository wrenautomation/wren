/**
 * A note as a Word file: headings, lists, checklists, quotes, code, rules, tables, images and
 * links, with open suggestions as Word's tracked changes. Pure, so the browser and the CLI share
 * it; images come from the caller, which knows how to fetch a `wren-file:` source.
 */
import {
  AlignmentType,
  BorderStyle,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  LevelFormat,
  Packer,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { type NoteJson, SUGGEST_ADD, SUGGEST_DEL } from "./types.js";

/** An image ready for Word: its bytes and size in pixels. */
export interface DocxImage {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
}

export interface DocxOptions {
  title?: string;
  /** Fetch an image by its `src`; null leaves its alt text in its place. */
  image?: (src: string) => Promise<DocxImage | null>;
}

const MONO = "Courier New";
/** Widest an image goes, in pixels at 96 to the inch: a page's text width. */
const PAGE_PX = 600;
const ORDERED = "ordered";
const HEADS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

type Mark = NonNullable<NoteJson["marks"]>[number];
type Block = Paragraph | Table;

/** Where a block sits: its list depth, quote depth, list, and checkbox. */
interface Place {
  level: number;
  quote: number;
  list?: { ordered: boolean; instance: number } | undefined;
  check?: boolean | undefined;
}

/** The note as `.docx` bytes. */
export async function toDocx(json: NoteJson, o: DocxOptions = {}): Promise<Uint8Array> {
  const images = await fetchImages(json, o.image);
  let change = 0;
  let lists = 0;

  const runs = (kids: readonly NoteJson[] | undefined, base: { mono?: boolean } = {}) => {
    const out: ParagraphChild[] = [];
    for (const k of kids ?? []) {
      if (k.type === "hardBreak") {
        out.push(new TextRun({ text: "", break: 1 }));
        continue;
      }
      if (k.type === "mention") {
        out.push(new TextRun({ text: `@${String(k.attrs?.label ?? k.attrs?.id ?? "")}` }));
        continue;
      }
      if (k.type === "image") {
        out.push(imageRun(k));
        continue;
      }
      if (k.type !== "text" || !k.text) continue;
      const marks = k.marks ?? [];
      const has = (t: string) => marks.some((m) => m.type === t);
      const look = {
        text: k.text,
        ...(has("bold") ? { bold: true } : {}),
        ...(has("italic") ? { italics: true } : {}),
        ...(has("strike") ? { strike: true } : {}),
        ...(has("underline") ? { underline: {} } : {}),
        ...(has("code") || base.mono ? { font: MONO } : {}),
      };
      const add = marks.find((m) => m.type === SUGGEST_ADD);
      const del = marks.find((m) => m.type === SUGGEST_DEL);
      const link = marks.find((m) => m.type === "link");
      const run = add
        ? new InsertedTextRun({ ...look, ...tracked(add) })
        : del
          ? new DeletedTextRun({ ...look, ...tracked(del) })
          : new TextRun(link ? { ...look, style: "Hyperlink" } : look);
      const href = String(link?.attrs?.href ?? "");
      out.push(
        /^(https?:|mailto:)/i.test(href)
          ? new ExternalHyperlink({ link: href, children: [run] })
          : run,
      );
    }
    return out;
  };

  const tracked = (m: Mark) => ({
    id: ++change,
    author: String(m.attrs?.by ?? "") || "Someone",
    date: toDate(String(m.attrs?.at ?? "")),
  });

  const imageRun = (n: NoteJson): ParagraphChild => {
    const src = String(n.attrs?.src ?? "");
    const alt = String(n.attrs?.alt ?? "");
    const img = images.get(src);
    if (!img) return new TextRun({ text: alt ? `[image: ${alt}]` : "[image]", italics: true });
    const scale = Math.min(1, PAGE_PX / Math.max(1, img.width));
    return new ImageRun({
      type: img.type,
      data: img.data,
      transformation: {
        width: Math.round(img.width * scale),
        height: Math.round(img.height * scale),
      },
      ...(alt ? { altText: { name: alt, description: alt, title: alt } } : {}),
    });
  };

  /** Blocks at a list depth (`level`) and quote depth (`quote`). */
  const blocks = (kids: readonly NoteJson[] | undefined, at: Place): Block[] =>
    (kids ?? []).flatMap((k) => block(k, at));

  const indent = (at: Place) =>
    at.quote ? { indent: { left: 360 * at.quote }, border: quoteBorder } : {};

  const block = (n: NoteJson, at: Place): Block[] => {
    switch (n.type) {
      case "heading": {
        const level = Math.min(Math.max(Number(n.attrs?.level ?? 1), 1), 3) - 1;
        return [
          new Paragraph({
            heading: HEADS[level] ?? HeadingLevel.HEADING_1,
            children: runs(n.content),
            ...indent(at),
          }),
        ];
      }
      case "paragraph":
        return [new Paragraph({ children: runs(n.content), ...indent(at) })];
      case "blockquote":
        return blocks(n.content, { ...at, quote: at.quote + 1 });
      case "codeBlock": {
        const lines = (n.content ?? [])
          .map((t) => t.text ?? "")
          .join("")
          .split("\n");
        return [
          new Paragraph({
            children: lines.map(
              (l, i) => new TextRun({ text: l, font: MONO, ...(i ? { break: 1 } : {}) }),
            ),
            shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" },
            ...indent(at),
          }),
        ];
      }
      case "horizontalRule":
        return [
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } },
          }),
        ];
      case "image":
        return [new Paragraph({ children: [imageRun(n)], alignment: AlignmentType.LEFT })];
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const ordered = n.type === "orderedList";
        const list = { ordered, instance: ordered ? ++lists : 0 };
        return (n.content ?? []).flatMap((item) =>
          listItem(item, {
            ...at,
            list,
            check: n.type === "taskList" ? item.attrs?.checked === true : undefined,
          }),
        );
      }
      case "table":
        return [table(n)];
      default:
        return n.content ? blocks(n.content, at) : [];
    }
  };

  /** A list item: its first paragraph takes the bullet, number or box; the rest sit under it. */
  const listItem = (item: NoteJson, at: Place): Block[] => {
    const [first, ...rest] = item.content ?? [];
    const lead =
      at.check === undefined
        ? at.list?.ordered
          ? {
              numbering: {
                reference: ORDERED,
                level: Math.min(at.level, 8),
                instance: at.list.instance,
              },
            }
          : { bullet: { level: Math.min(at.level, 8) } }
        : { indent: { left: 360 * (at.level + 1 + at.quote), hanging: 360 } };
    const box = at.check === undefined ? [] : [new TextRun({ text: at.check ? "☑ " : "☐ " })];
    const out: Block[] = [];
    if (first?.type === "paragraph" || first?.type === "heading")
      out.push(new Paragraph({ children: [...box, ...runs(first.content)], ...lead }));
    else {
      out.push(new Paragraph({ children: box, ...lead }));
      if (first) rest.unshift(first);
    }
    const inner: Place = { level: at.level + 1, quote: at.quote };
    for (const r of rest)
      out.push(
        ...(r.type === "paragraph"
          ? [
              new Paragraph({
                children: runs(r.content),
                indent: { left: 360 * (at.level + 1 + at.quote) },
              }),
            ]
          : block(r, inner)),
      );
    return out;
  };

  const table = (n: NoteJson): Table => {
    const rows = n.content ?? [];
    const width = Math.max(1, ...rows.map((r) => r.content?.length ?? 0));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (r) =>
          new TableRow({
            children: Array.from({ length: width }, (_, i) => {
              const c = r.content?.[i];
              const kids = blocks(c?.content, { level: 0, quote: 0 }).filter(
                (b): b is Paragraph => b instanceof Paragraph,
              );
              const head = c?.type === "tableHeader";
              return new TableCell({
                children: kids.length ? kids : [new Paragraph({ children: [] })],
                ...(head
                  ? { shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" } }
                  : {}),
              });
            }),
          }),
      ),
    });
  };

  const body: Block[] = [
    ...(o.title ? [new Paragraph({ heading: HeadingLevel.TITLE, text: o.title })] : []),
    ...blocks(json.content, { level: 0, quote: 0 }),
  ];
  const doc = new Document({
    creator: "Wren Notes",
    title: o.title ?? "",
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][
              level % 3
            ] as (typeof LevelFormat)[keyof typeof LevelFormat],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: body.length ? body : [new Paragraph({ children: [] })] }],
  });
  return Packer.pack(doc, "uint8array");
}

const quoteBorder = { left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } };

/** A suggestion's `at` ("2026-10-07T14:03") as Word's full timestamp. */
function toDate(at: string): string {
  const d = new Date(at.length === 16 ? `${at}:00Z` : at);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** Every image's bytes, fetched once each, side by side. */
async function fetchImages(
  json: NoteJson,
  get: DocxOptions["image"],
): Promise<Map<string, DocxImage>> {
  const srcs = new Set<string>();
  const walk = (n: NoteJson) => {
    if (n.type === "image" && typeof n.attrs?.src === "string") srcs.add(n.attrs.src);
    for (const k of n.content ?? []) walk(k);
  };
  walk(json);
  const out = new Map<string, DocxImage>();
  if (!get) return out;
  await Promise.all(
    [...srcs].map(async (src) => {
      const img = await get(src).catch(() => null);
      if (img) out.set(src, img);
    }),
  );
  return out;
}
