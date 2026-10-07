/**
 * Notes in and out as files: Word out (`@wren/notes/docx`), and Word in, from a file or from
 * Google Drive. A Word file becomes HTML in the browser (mammoth), then the editor's own parser
 * reads it, so it lands as the blocks the editor has. Its images go up to the note first. Both
 * libraries load only when used.
 */
import { generateJSON } from "@tiptap/core";
import type { DocxImage } from "@wren/notes/docx";
import type { NoteJson } from "@wren/notes/types";
import { ApiError } from "../../api.js";
import { notes } from "./api.js";
import { resolverOf, uploadImage } from "./editor.js";
import { extensionsOf } from "./extensions.js";

/** Biggest Word file it takes from disk. */
export const DOCX_MAX = 20 * 1024 * 1024;
const MARKDOWN_MAX = 500_000;

export function download(name: string, type: string, data: string | Uint8Array) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const fileName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .trim()
    .slice(0, 80) || "note";

// ---- Out ---------------------------------------------------------------------------------------

/** The note as a Word file, its images in it (alt text where one won't load). */
export async function downloadDocx(client: string, id: string, json: NoteJson, title: string) {
  const { toDocx } = await import("@wren/notes/docx");
  const resolve = resolverOf(client, id);
  const bytes = await toDocx(json, {
    title,
    image: async (src) => {
      const url = await resolve(src);
      if (!url) return null;
      const res = await fetch(url);
      return res.ok ? docxImage(await res.blob()) : null;
    },
  });
  download(
    `${fileName(title)}.docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes,
  );
}

/** An image's bytes and size; WebP becomes PNG, as Word reads no WebP. */
async function docxImage(blob: Blob): Promise<DocxImage | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  const { width, height } = bitmap;
  const type = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" }[blob.type] as
    | DocxImage["type"]
    | undefined;
  if (type) {
    bitmap.close();
    return { data: new Uint8Array(await blob.arrayBuffer()), type, width, height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  return png ? { data: new Uint8Array(await png.arrayBuffer()), type: "png", width, height } : null;
}

// ---- In ----------------------------------------------------------------------------------------

/** What a file picker takes. */
export const IMPORT_ACCEPT =
  ".docx,.md,.markdown,.txt,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A file from disk as a new note: Word or Markdown. Its id. */
export async function importFile(client: string, f: File): Promise<string> {
  if (/\.docx$/i.test(f.name)) {
    if (f.size > DOCX_MAX) throw new ApiError("Word files go up to 20 MB.", 413);
    return importDocx(client, f.name, await f.arrayBuffer());
  }
  if (f.size > MARKDOWN_MAX) throw new ApiError("Markdown files go up to 500 KB.", 413);
  const title = f.name.replace(/\.(md|markdown|txt)$/i, "");
  const r = await notes(client, "create", { markdown: await f.text(), title });
  return r.id;
}

/** A Google Doc or a Word file in Drive, by its link, as a new note. Its id. */
export async function importDrive(client: string, link: string): Promise<string> {
  const { name, data } = await notes(client, "drive", { link });
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return importDocx(client, `${name || "Google Doc"}.docx`, bytes.buffer);
}

/**
 * A Word file as a new note: the note first (its images need it), each image up to it, then the
 * body as an `import` version named for the file.
 */
async function importDocx(client: string, name: string, data: ArrayBuffer): Promise<string> {
  const title = name.replace(/\.docx$/i, "").slice(0, 300);
  const { id } = await notes(client, "create", { title });
  try {
    await fill(client, id, name, data);
  } catch (e) {
    // Nothing half done stays in the list.
    await notes(client, "archive", { id, on: true }).catch(() => {});
    throw e;
  }
  return id;
}

async function fill(client: string, id: string, name: string, data: ArrayBuffer) {
  const mammoth = (await import("mammoth")).default;
  let n = 0;
  const html = await mammoth.convertToHtml(
    { arrayBuffer: data },
    {
      styleMap: ["u => u", "strike => s"],
      convertImage: mammoth.images.imgElement(async (img) => {
        const type = img.contentType;
        if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return { src: "" };
        const ext = type.split("/")[1] ?? "png";
        const file = new File([await img.readAsArrayBuffer()], `image-${++n}.${ext}`, { type });
        return { src: await uploadImage(client, id, file).catch(() => "") };
      }),
    },
  );
  const body = generateJSON(html.value, extensionsOf({ resolve: async () => "" })) as NoteJson;
  await notes(client, "append", { id, body, from: name.slice(0, 200) });
}
