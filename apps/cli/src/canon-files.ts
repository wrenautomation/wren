/**
 * Files on Canon sources (designs/2026-11-12-canon-files.md): a picture, a PDF, a carousel's slides
 * go to the media bucket under `canon/<sha32><ext>`, listed in the source's `files`. A reel keeps
 * its id key (`cache/instagram/<id>.mp4`); its poster sits beside it as `.jpg`.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Source } from "@wren/research/sops";
import {
  getKey,
  keyExists,
  MEDIA_TYPES,
  type MediaStoreOptions,
  putKey,
} from "@wren/starling-inbound";
import type { SourceFile } from "@wrenautomation/knowledge";
import type { Model } from "@wrenautomation/models";
import { s3MediaStore } from "@wrenautomation/read/s3";
import {
  download,
  fetchPostItem,
  postItems,
  renderWatched,
  type WatchOptions,
  watch,
} from "@wrenautomation/read/video";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Same bytes, same key. */
export const canonKey = (bytes: Uint8Array, ext: string) =>
  `canon/${sha(bytes).slice(0, 32)}${ext.toLowerCase()}`;

const IMAGE = /^image\//;

/** An iPhone HEIC as a JPEG beside it (sips, on the Mac). */
function asJpeg(path: string, dir: string): string {
  const out = join(dir, `${basename(path, extname(path))}.jpg`);
  const r = spawnSync("sips", ["-s", "format", "jpeg", path, "--out", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sips ${path}: ${(r.stderr || r.stdout).trim()}`);
  return out;
}

/** A local file into `canon/`; a type the store does not know is refused. */
export async function putCanonFile(
  path: string,
  o: MediaStoreOptions,
  role: SourceFile["role"],
  extra: { at?: string; name?: string } = {},
): Promise<SourceFile & { bytes: Uint8Array }> {
  const ext = extname(path).toLowerCase();
  const type = MEDIA_TYPES[ext];
  if (!type)
    throw new Error(`${basename(path)}: ${ext || "no extension"} is not a type Canon keeps`);
  const bytes = await readFile(path);
  const key = canonKey(bytes, ext);
  if (!(await keyExists(key, o))) await putKey(path, key, o);
  return { key, type, role, ...extra, bytes };
}

const READ_IMAGE =
  "Write out every word shown in this image, in reading order, as Markdown. Then one short paragraph: what the image shows.";

/** The eye's read of a picture: its words, then what it shows. */
async function readImage(eye: Model, bytes: Uint8Array, type: string): Promise<string> {
  const r = await eye.complete({
    prompt: [
      { type: "image", data: bytes, mediaType: type },
      { type: "text", text: READ_IMAGE },
    ],
    maxTokens: 4000,
  });
  return r.text.trim();
}

const fm = (fields: Record<string, unknown>) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
    .join("\n")}\n---\n`;

/**
 * A picture or a PDF as its own source: `image-<sha12>` (a PDF: `file-<sha12>`), so the same bytes
 * are one record. A picture's body is the eye's read.
 */
export async function fileSourceOf(
  path: string,
  o: MediaStoreOptions & { eye: Model; title: string; priority: number },
): Promise<{ source: Source; files: SourceFile[] }> {
  const dir = await mkdtemp(join(tmpdir(), "canon-file-"));
  try {
    const from = /\.heic$/i.test(path) ? asJpeg(path, dir) : path;
    const image = IMAGE.test(MEDIA_TYPES[extname(from).toLowerCase()] ?? "");
    const { bytes, ...file } = await putCanonFile(from, o, image ? "image" : "page", {
      name: basename(path),
    });
    const stem = `${image ? "image" : "file"}-${sha(bytes).slice(0, 12)}`;
    const body = image ? await readImage(o.eye, bytes, file.type) : "";
    return {
      source: {
        name: `${stem}.md`,
        md: `${fm({ title: o.title, priority: o.priority })}# ${o.title}\n\n${body}\n`,
      },
      files: [file],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** An Instagram post link (`/p/`): a carousel, or a single picture. */
export const POST_LINK = /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+/i;

/**
 * A post's slides as one source: the caption, then each slide's read (a picture by the eye, a
 * video slide watched). Null when the post is one video: a reel's path reads it.
 */
export async function postSource(
  url: string,
  o: MediaStoreOptions & {
    ytDlp: string;
    eye: Model;
    watch: Omit<WatchOptions, "eye">;
    priority: number;
    warn?: (line: string) => void;
  },
): Promise<{ source: Source; files: SourceFile[] } | null> {
  const items = await postItems(url, o.ytDlp);
  const first = items[0];
  if (!first) throw new Error(`${url}: yt-dlp found no items (signed out, the post may be hidden)`);
  if (items.length === 1 && first.kind === "video") return null;
  const dir = await mkdtemp(join(tmpdir(), "canon-post-"));
  try {
    const files: SourceFile[] = [];
    const parts: string[] = [];
    for (const item of items) {
      const at = String(item.at);
      const path = await fetchPostItem(url, item, o.ytDlp, dir);
      const { bytes, ...file } = await putCanonFile(path, o, "slide", { at });
      files.push(file);
      const read =
        item.kind === "image"
          ? await readImage(o.eye, bytes, file.type)
          : renderWatched(await watch(path, { ...o.watch, eye: o.eye }));
      parts.push(`## Slide ${at}${item.kind === "video" ? " (video)" : ""}\n\n${read}`);
    }
    const caption = (first.info.description ?? "").trim();
    const id = `instagram-${new URL(url).pathname.split("/")[2]}`;
    const title = first.info.title || id;
    const handle = first.info.channel ?? first.info.uploader;
    return {
      source: {
        name: `${id}.md`,
        md: `${fm({
          url: url.replace(/\?.*$/, ""),
          title,
          ...(handle ? { channel: handle } : {}),
          priority: o.priority,
        })}# ${title}\n\n${caption ? `${caption}\n\n` : ""}${parts.join("\n\n")}\n`,
      },
      files,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A post's slides into `canon/`, no reads: for a record whose body is already written. */
export async function postFiles(
  url: string,
  o: MediaStoreOptions & { ytDlp: string },
): Promise<SourceFile[]> {
  const items = await postItems(url, o.ytDlp);
  if (!items.length) throw new Error(`${url}: yt-dlp found no items`);
  const dir = await mkdtemp(join(tmpdir(), "canon-post-"));
  try {
    const files: SourceFile[] = [];
    for (const item of items) {
      const path = await fetchPostItem(url, item, o.ytDlp, dir);
      const { bytes: _, ...file } = await putCanonFile(path, o, "slide", { at: String(item.at) });
      files.push(file);
    }
    return files;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `cache/instagram/<code>.mp4` and its poster key, from a reel's record id. */
const reelKeys = (id: string) => {
  const code = id.replace(/^instagram-/, "");
  return { video: `cache/instagram/${code}.mp4`, poster: `cache/instagram/${code}.jpg` };
};

/** A reel's video into the bucket (`cache/instagram/<code>.mp4` + `.json`) through yt-dlp; the temp copy goes. */
export async function reelVideoOf(
  url: string,
  o: MediaStoreOptions & { ytDlp: string },
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "canon-reel-"));
  try {
    await download(url, o.ytDlp, dir, {
      store: s3MediaStore(o.bucket),
      // a store write that fails must fail the reel, not warn
      warn: (line) => {
        throw new Error(line);
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A stored reel's poster: one frame (0.5 s in, else the first), beside the mp4. Answers what it
 * did: `made`, `had` one, or `no video` stored.
 */
export async function posterOf(
  id: string,
  o: MediaStoreOptions & { ffmpeg: string },
): Promise<"made" | "had" | "no video"> {
  const keys = reelKeys(id);
  if (await keyExists(keys.poster, o)) return "had";
  if (!(await keyExists(keys.video, o))) return "no video";
  const dir = await mkdtemp(join(tmpdir(), "canon-poster-"));
  try {
    const mp4 = join(dir, "v.mp4");
    const jpg = join(dir, "p.jpg");
    await getKey(keys.video, mp4, o);
    const made = () =>
      stat(jpg).then(
        (s) => s.size > 0,
        () => false,
      );
    for (const ss of ["0.5", "0"]) {
      spawnSync(o.ffmpeg, ["-v", "error", "-y", "-ss", ss, "-i", mp4, "-frames:v", "1", jpg]);
      if (await made()) break;
    }
    if (!(await made())) throw new Error(`${id}: ffmpeg made no frame`);
    await putKey(jpg, keys.poster, o);
    return "made";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
