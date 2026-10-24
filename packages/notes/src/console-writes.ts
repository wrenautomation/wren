/** Notes handlers that create or change a note: star, create, append, capture, rename, restore, upload, Drive. */
import { PortalRefusal } from "@wren/core/portal";
import { type NotesApiContext, numOf, type Req, str } from "./console-context.js";
import { appendBody, captureBlock, cleanBody, fromMarkdown, toB64 } from "./doc.js";
import { driveIdOf } from "./drive.js";
import {
  appendNote,
  changeNote,
  createNote,
  dumpOf,
  isNoteId,
  nameVersion,
  renameNote,
  restoreVersion,
  star,
} from "./store.js";

/** An image a note takes, by type. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const IMAGE_MAX = 20 * 1024 * 1024;

/** Biggest body an import appends, as JSON: images go up on their own. */
const BODY_MAX = 4_000_000;

/** How an image's `src` names a stored file. */
export const FILE_SRC = "wren-file:";

export function writesHandlers(notes: NotesApiContext) {
  const { deps, placeOf, readerOf, byOf, locate, tell } = notes;
  return {
    /** Star or unstar, for this person only. */
    async star(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "view");
      await star(db, note.id, byOf(req), req.on !== false);
      return { starred: req.on !== false };
    },
    /** A new note, private to its author unless under a parent (it takes the parent's sharing). */
    async create(req: Req<{ title?: unknown; markdown?: unknown; parentId?: unknown }>) {
      const by = byOf(req);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (req.parentId !== undefined && req.parentId !== null)
        await locate(req, req.parentId, "edit");
      const title = typeof req.title === "string" ? req.title.slice(0, 3000) : "";
      const md = typeof req.markdown === "string" ? req.markdown.slice(0, 500_000) : "";
      const note = await createNote(place.db, {
        owner: by,
        by,
        title,
        ...(md ? { body: fromMarkdown(md) } : {}),
        parentId: isNoteId(req.parentId) ? req.parentId : null,
      });
      return { id: note.id };
    },
    /**
     * Blocks at the end of a note, from editor JSON: an import's body once its images are up.
     * `from` names the file, and makes it an `import` version so the history says so.
     */
    async append(req: Req<{ id?: unknown; body?: unknown; from?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "edit");
      const by = byOf(req);
      if (JSON.stringify(req.body ?? null).length > BODY_MAX)
        throw new PortalRefusal("that's too long for one note", 400);
      const body = cleanBody(req.body);
      if (!body) throw new PortalRefusal("that isn't a note's body", 400);
      const from = typeof req.from === "string" ? req.from.trim().slice(0, 200) : "";
      const c = await changeNote(
        db,
        note.id,
        by,
        (doc) => appendBody(doc, body),
        from ? { kind: "import", name: `From ${from}` } : {},
      );
      await tell(home, place);
      return { version: c.version };
    },
    /** A Google Doc or Word file in Drive, as `.docx` bytes for the browser to turn into a note. */
    async drive(req: Req<{ link?: unknown }>) {
      byOf(req);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (!deps.drive) throw new PortalRefusal("Google Drive isn't set up here", 503);
      const id = driveIdOf(str(req.link, 2000, "the link"));
      if (!id) throw new PortalRefusal("Paste a Google Docs or Drive link.", 400);
      const file = await deps.drive.get(id);
      return { name: file.name, data: toB64(file.bytes) };
    },
    /** A Drive link's file name, for the chip a pasted link becomes; null when it isn't readable. */
    async driveTitle(req: Req<{ link?: unknown }>) {
      byOf(req);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      const id = driveIdOf(str(req.link, 2000, "the link"));
      if (!deps.drive || !id) return { title: null };
      return { title: await deps.drive.title(id).catch(() => null) };
    },
    /** Quick capture: a timestamped line at the end of the person's Dump note, or a new note. */
    async capture(req: Req<{ words?: unknown; open?: unknown }>) {
      const by = byOf(req);
      const words = str(req.words, 20_000, "the note").trim();
      if (!words) throw new PortalRefusal("write something", 400);
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (reader.cap !== "edit") throw new PortalRefusal("your role can't do that", 403);
      if (req.open === true) {
        const note = await createNote(place.db, { owner: by, by, body: fromMarkdown(words) });
        return { id: note.id, dump: false };
      }
      const dump = await dumpOf(place.db, by);
      await appendNote(place.db, dump.id, by, captureBlock(words, new Date(), deps.zone));
      return { id: dump.id, dump: true };
    },
    async rename(req: Req<{ id?: unknown; title?: unknown }>) {
      const { db, note } = await locate(req, req.id, "edit");
      const c = await renameNote(db, note.id, byOf(req), str(req.title, 300, "the title").trim());
      return { title: c.note.title, version: c.version };
    },
    /** Version `number` back as a new version; nothing is lost. */
    async restore(req: Req<{ id?: unknown; number?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "edit");
      const c = await restoreVersion(db, note.id, numOf(req.number, "version"), byOf(req));
      await tell(home, place);
      return { version: c.version };
    },
    async nameVersion(req: Req<{ id?: unknown; number?: unknown; name?: unknown }>) {
      const { db, note } = await locate(req, req.id, "edit");
      byOf(req);
      const name = req.name === null ? null : str(req.name, 200, "the name");
      const v = await nameVersion(db, note.id, numOf(req.number, "version"), name);
      return { number: v.number, name: v.name };
    },
    /** A signed PUT for an image pasted into a note; its `src` goes in the doc. */
    async upload(req: Req<{ id?: unknown; name?: unknown; type?: unknown; size?: unknown }>) {
      const { note, home } = await locate(req, req.id, "edit");
      byOf(req);
      if (!deps.files) throw new PortalRefusal("files aren't set up here", 503);
      const type = str(req.type, 100, "the type");
      if (!Object.hasOwn(IMAGE_TYPES, type))
        throw new PortalRefusal("paste a PNG, JPEG, WebP or GIF", 400);
      const size = Number(req.size);
      if (!Number.isSafeInteger(size) || size <= 0)
        throw new PortalRefusal("that image is empty", 400);
      if (size > IMAGE_MAX) throw new PortalRefusal("images go up to 20 MB", 400);
      const safe =
        String(req.name ?? "image")
          .normalize("NFKD")
          .replace(/[^\w.-]+/g, "-")
          .replace(/^[-.]+|-+$/g, "")
          .slice(-80) || "image";
      const key = `notes/${home}/${note.id}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
      return { key, src: `${FILE_SRC}${key}`, url: await deps.files.putUrl(key, type, size) };
    },
  };
}
