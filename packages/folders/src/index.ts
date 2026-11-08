/**
 * The folder tree's writes (designs/2026-11-08-folders.md). Each write: one transaction, one
 * advisory lock, the whole tree read under it (dozens of rows), checks in code.
 */
import { atomic, type Db, setAuditActor, type Tx } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { filed, folders, ITEM_KINDS, type ItemKind } from "./schema.js";

export { ITEM_KINDS, type ItemKind } from "./schema.js";

export const MAX_DEPTH = 3;

export class FolderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "FolderError";
  }
}

export interface Folder {
  id: number;
  parent: number | null;
  name: string;
}
export interface Filed {
  kind: ItemKind;
  ref: string;
  folder: number;
}
export interface Tree {
  folders: Folder[];
  filed: Filed[];
}

const cleanName = (raw: string) => {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new FolderError("a folder needs a name");
  if (name.length > 80) throw new FolderError("a folder name is at most 80 characters");
  return name;
};

const isKind = (k: string): k is ItemKind => (ITEM_KINDS as readonly string[]).includes(k);

/** Levels from the top: a top folder is 1. */
const depthOf = (all: Map<number, Folder>, id: number) => {
  let d = 0;
  for (let f = all.get(id); f; f = f.parent == null ? undefined : all.get(f.parent)) d++;
  return d;
};
/** Levels from this folder down: a leaf is 1. */
const heightOf = (list: Folder[], id: number): number =>
  1 + Math.max(0, ...list.filter((f) => f.parent === id).map((f) => heightOf(list, f.id)));

const FOLDER_COLS = { id: folders.id, parent: folders.parentId, name: folders.name };

export function folderTree(db: Db) {
  /** One write: the lock, the actor, the tree as it stands. */
  const write = <T>(by: string, fn: (tx: Tx, all: Map<number, Folder>) => Promise<T>) =>
    atomic(db, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('folders.tree'))`);
      await setAuditActor(tx, by);
      const rows = await tx.select(FOLDER_COLS).from(folders);
      return fn(tx, new Map(rows.map((f) => [f.id, f])));
    });
  const must = (all: Map<number, Folder>, id: number) => {
    const f = all.get(id);
    if (!f) throw new FolderError(`no folder ${id}`, 404);
    return f;
  };
  const clash = (all: Map<number, Folder>, parent: number | null, name: string, not?: number) =>
    [...all.values()].some(
      (f) => f.parent === parent && f.id !== not && f.name.toLowerCase() === name.toLowerCase(),
    );
  /** "Name", else "Name 2", "Name 3"…: a drop never fails on a name. */
  const freeName = (all: Map<number, Folder>, parent: number | null, name: string, not: number) => {
    for (let n = 1; ; n++) {
      const pick = n === 1 ? name : `${name} ${n}`;
      if (!clash(all, parent, pick, not)) return pick;
    }
  };

  return {
    tree: async (kind?: ItemKind): Promise<Tree> => ({
      folders: await db.select(FOLDER_COLS).from(folders).orderBy(sql`lower(${folders.name})`),
      filed: await db
        .select({ kind: filed.kind, ref: filed.ref, folder: filed.folderId })
        .from(filed)
        .where(kind ? eq(filed.kind, kind) : undefined),
    }),

    make: (o: { name: string; parent?: number | null; by: string }) =>
      write(o.by, async (tx, all) => {
        const name = cleanName(o.name);
        const parent = o.parent ?? null;
        if (parent != null && depthOf(all, must(all, parent).id) >= MAX_DEPTH)
          throw new FolderError(`folders nest at most ${MAX_DEPTH} deep`);
        if (clash(all, parent, name)) throw new FolderError(`“${name}” is already here`, 409);
        const [row] = await tx
          .insert(folders)
          .values({ name, parentId: parent, madeBy: o.by })
          .returning(FOLDER_COLS);
        return row as Folder;
      }),

    rename: (id: number, raw: string, by: string) =>
      write(by, async (tx, all) => {
        const f = must(all, id);
        const name = cleanName(raw);
        if (clash(all, f.parent, name, id)) throw new FolderError(`“${name}” is already here`, 409);
        await tx.update(folders).set({ name }).where(eq(folders.id, id));
        return { ...f, name };
      }),

    move: (id: number, to: number | null, by: string) =>
      write(by, async (tx, all) => {
        const f = must(all, id);
        if (to != null) {
          must(all, to);
          for (let a: number | null = to; a != null; a = all.get(a)?.parent ?? null)
            if (a === id) throw new FolderError("a folder cannot go inside itself");
        }
        const depth = to == null ? 0 : depthOf(all, to);
        if (depth + heightOf([...all.values()], id) > MAX_DEPTH)
          throw new FolderError(`folders nest at most ${MAX_DEPTH} deep`);
        if (clash(all, to, f.name, id)) throw new FolderError(`“${f.name}” is already there`, 409);
        await tx.update(folders).set({ parentId: to }).where(eq(folders.id, id));
        return { ...f, parent: to };
      }),

    /** Its items and folders go up one level; at the top, its items are unfiled. Nothing is deleted but the folder. */
    drop: (id: number, by: string) =>
      write(by, async (tx, all) => {
        const f = must(all, id);
        all.delete(id);
        for (const c of [...all.values()].filter((x) => x.parent === id)) {
          const name = freeName(all, f.parent, c.name, c.id);
          await tx.update(folders).set({ parentId: f.parent, name }).where(eq(folders.id, c.id));
          all.set(c.id, { ...c, parent: f.parent, name });
        }
        if (f.parent == null) await tx.delete(filed).where(eq(filed.folderId, id));
        else await tx.update(filed).set({ folderId: f.parent }).where(eq(filed.folderId, id));
        await tx.delete(folders).where(eq(folders.id, id));
        return { dropped: id, to: f.parent };
      }),

    /** Files each ref into `folder` (moving it if filed elsewhere); `folder` null unfiles them. */
    file: (o: { kind: string; refs: readonly string[]; folder: number | null; by: string }) =>
      write(o.by, async (tx, all) => {
        if (!isKind(o.kind)) throw new FolderError(`kind is one of ${ITEM_KINDS.join(", ")}`);
        const kind = o.kind;
        const refs = [...new Set(o.refs.map((r) => r.trim()).filter(Boolean))];
        if (!refs.length) throw new FolderError("file what?");
        if (kind === "subject" && refs.some((r) => !/^\d{1,9}$/.test(r)))
          throw new FolderError("a subject ref is its id");
        if (o.folder == null) {
          await tx.delete(filed).where(and(eq(filed.kind, kind), inArray(filed.ref, refs)));
          return { kind, refs, folder: null };
        }
        must(all, o.folder);
        const folderId = o.folder;
        await tx
          .insert(filed)
          .values(refs.map((ref) => ({ kind, ref, folderId, filedBy: o.by })))
          .onConflictDoUpdate({
            target: [filed.kind, filed.ref],
            set: { folderId, filedBy: o.by, filedAt: sql`now()` },
          })
          .catch((err: unknown) => {
            // 23503: the subject is not there
            const e = err as { code?: string; cause?: { code?: string } };
            if ((e.code ?? e.cause?.code) === "23503")
              throw new FolderError("no such subject", 404);
            throw err;
          });
        return { kind, refs, folder: folderId };
      }),
  };
}

export type FolderTree = ReturnType<typeof folderTree>;
