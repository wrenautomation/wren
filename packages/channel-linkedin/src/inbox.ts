/**
 * The inbox: drop `<stem>.md` plus any `<stem>.png|jpg` or `<stem>-N.png|jpg`.
 * `readInbox` is pure over the filesystem; `ingestNotes` takes injected I/O so the
 * Restate handler can journal each step and tests can fake them.
 */
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export const IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg"]);
export const DONE_DIR_NAME = "done";

export interface InboxNote {
  path: string;
  body: string;
  imagePaths: string[];
}

export class IngestError extends Error {
  override name = "IngestError";
}

function stemOf(file: string): string {
  return basename(file, extname(file));
}

function pairsWith(imageStem: string, noteStem: string): boolean {
  return imageStem === noteStem || imageStem.startsWith(`${noteStem}-`);
}

/**
 * Every non-empty top-level .md with its same-stem images. Notes are matched
 * longest stem first and images are claimed from one pool, so each image has
 * exactly one owner (`monday-2.png` goes to `monday-2.md`, not `monday.md`).
 * Returns notes sorted by path. Missing dir → empty list.
 */
export async function readInbox(inboxDir: string): Promise<InboxNote[]> {
  let entries: string[];
  try {
    entries = await readdir(inboxDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const unclaimed = new Set(
    entries.filter((f) => IMAGE_SUFFIXES.has(extname(f).toLowerCase())).sort(),
  );
  const mds = entries.filter((f) => extname(f).toLowerCase() === ".md");
  mds.sort((a, b) => stemOf(b).length - stemOf(a).length || a.localeCompare(b));
  const notes: InboxNote[] = [];
  for (const md of mds) {
    const body = (await readFile(join(inboxDir, md), "utf8")).trim();
    if (body === "") continue;
    const stem = stemOf(md);
    const images: string[] = [];
    for (const img of unclaimed) {
      if (pairsWith(stemOf(img), stem)) {
        images.push(join(inboxDir, img));
        unclaimed.delete(img);
      }
    }
    notes.push({ path: join(inboxDir, md), body, imagePaths: images });
  }
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes;
}

/** Move a note's files into `<inboxDir>/done/`. Throws IngestError naming the stuck file. */
export async function moveToDone(inboxDir: string, note: InboxNote): Promise<void> {
  const done = join(inboxDir, DONE_DIR_NAME);
  await mkdir(done, { recursive: true });
  for (const file of [...note.imagePaths, note.path]) {
    try {
      await rename(file, join(done, basename(file)));
    } catch (err) {
      throw new IngestError(`note saved but could not move ${file}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }
}

export interface IngestIo {
  /** Persist one note. Must be durable before it returns. */
  insert(note: InboxNote): Promise<void>;
  /** Move the note's files out of the inbox. */
  move(note: InboxNote): Promise<void>;
}

/**
 * Insert-then-move, one note at a time, so a failed move never loses a note:
 * the row exists and the file is still in the inbox for the operator to clear.
 * Returns how many notes were fully ingested.
 */
export async function ingestNotes(notes: readonly InboxNote[], io: IngestIo): Promise<number> {
  let done = 0;
  for (const note of notes) {
    await io.insert(note);
    await io.move(note);
    done++;
  }
  return done;
}
