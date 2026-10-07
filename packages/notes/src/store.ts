/**
 * Notes in one database: create, change through Yjs, versions, sharing, lists and search.
 * Who may do what is `access.ts`'s answer; the console asks it before calling these.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import * as Y from "yjs";
import { clientWho, noteRole, type Reader, TEAM } from "./access.js";
import {
  appendBody,
  docOf,
  linksOf,
  readBody,
  readTitle,
  textOf,
  writeBody,
  writeTitle,
} from "./doc.js";
import {
  type Note,
  type NoteVersion,
  noteLinks,
  noteSeen,
  noteShares,
  noteStars,
  notes,
  notesSettings,
  noteUpdates,
  noteVersions,
} from "./schema.js";
import type { General, NoteJson, NoteKind, Role, ShareRole, VersionKind, Via } from "./types.js";

/** An auto version stays open this long after its last edit. */
export const SESSION_MS = 10 * 60 * 1000;

export class NoteMissing extends Error {
  constructor(id: string) {
    super(`no such note: ${id}`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isNoteId = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

// ---- Create ----

export interface NewNote {
  owner: string;
  by: string;
  via?: Via;
  title?: string;
  body?: NoteJson;
  kind?: NoteKind;
  parentId?: string | null;
  general?: General;
  generalRole?: ShareRole;
  shares?: readonly { who: string; role: ShareRole }[];
  /** The first version's kind: `import` for an import; else `auto`. */
  versionKind?: VersionKind;
  versionName?: string | null;
}

/** A new note, its first update and version. A child copies its parent's sharing. */
export async function createNote(db: Db, o: NewNote): Promise<Note> {
  const doc = docOf(o.body ?? { type: "doc", content: [] }, o.title ?? "");
  const state = Y.encodeStateAsUpdate(doc);
  const body = readBody(doc);
  const text = textOf(body);
  const title = readTitle(doc);
  return atomic(db, async (tx) => {
    let general = o.general ?? "private";
    let generalRole = o.generalRole ?? "view";
    let shares = [...(o.shares ?? [])];
    if (o.parentId) {
      const [parent] = await tx.select().from(notes).where(eq(notes.id, o.parentId));
      if (!parent) throw new NoteMissing(o.parentId);
      if (!o.general) {
        general = parent.general;
        generalRole = parent.generalRole;
      }
      if (!o.shares) {
        const ps = await tx.select().from(noteShares).where(eq(noteShares.noteId, parent.id));
        shares = ps.map((s) => ({ who: s.who, role: s.role }));
      }
    }
    const [note] = await tx
      .insert(notes)
      .values({
        ...pgSafe({
          parentId: o.parentId ?? null,
          kind: o.kind ?? "note",
          title,
          body,
          text,
          owner: o.owner,
          createdBy: o.by,
          via: o.via ?? "person",
          general,
          generalRole,
          editedBy: o.by,
        }),
        // Bytes as they are: `pgSafe` reads a Uint8Array as an object.
        yState: state,
      })
      .returning();
    if (!note) throw new Error("note not made");
    await tx.insert(noteUpdates).values({ noteId: note.id, update: state, by: o.by });
    await tx.insert(noteVersions).values(
      pgSafe({
        noteId: note.id,
        number: 1,
        kind: o.versionKind ?? "auto",
        name: o.versionName ?? null,
        title,
        body,
        text,
        authors: [o.by],
      }),
    );
    const shared = shares.filter((s) => s.who.toLowerCase() !== o.owner.toLowerCase());
    if (shared.length)
      await tx
        .insert(noteShares)
        .values(shared.map((s) => ({ noteId: note.id, who: s.who, role: s.role, by: o.by })))
        .onConflictDoNothing();
    await relink(tx, note.id, body);
    return note;
  });
}

// ---- Change ----

export interface Changed {
  note: Note;
  /** What this change added, or null when nothing changed. */
  update: Uint8Array | null;
  /** The version the change landed in (the newest). */
  version: number;
}

export interface ChangeOpts {
  /** Start a version of this kind instead of the session's auto one. */
  kind?: Exclude<VersionKind, "auto">;
  name?: string | null;
  restoredFrom?: number | null;
}

/**
 * Change a note through its Yjs doc, locked: `fn` edits the doc (applies a browser's update, or
 * writes as the server). Every update is kept; the derived title, body, text and links follow,
 * and the version timeline with them.
 */
export async function changeNote(
  db: Db,
  id: string,
  by: string,
  fn: (doc: Y.Doc) => void,
  opts: ChangeOpts = {},
): Promise<Changed> {
  return atomic(db, async (tx) => {
    const [row] = await tx.select().from(notes).where(eq(notes.id, id)).for("update");
    if (!row) throw new NoteMissing(id);
    const doc = new Y.Doc();
    if (row.yState) Y.applyUpdate(doc, row.yState);
    const parts: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => parts.push(u));
    fn(doc);
    const latest = await latestVersion(tx, id);
    if (!parts.length && !opts.kind)
      return { note: row, update: null, version: latest?.number ?? 0 };
    const update = parts.length ? Y.mergeUpdates(parts) : null;
    const body = readBody(doc);
    const text = textOf(body);
    const title = readTitle(doc);
    const now = new Date();
    if (update) await tx.insert(noteUpdates).values({ noteId: id, update, by });
    const [note] = await tx
      .update(notes)
      .set({
        ...pgSafe({ body, text, title }),
        updatedAt: now,
        editedBy: by,
        yState: Y.encodeStateAsUpdate(doc),
      })
      .where(eq(notes.id, id))
      .returning();
    if (JSON.stringify(linksOf(body)) !== JSON.stringify(linksOf(row.body)))
      await relink(tx, id, body);
    const version = await keepVersion(tx, id, latest, by, now, { title, body, text }, opts);
    return { note: note as Note, update, version };
  });
}

async function latestVersion(db: Queryable, id: string): Promise<NoteVersion | null> {
  const [v] = await db
    .select()
    .from(noteVersions)
    .where(eq(noteVersions.noteId, id))
    .orderBy(desc(noteVersions.number))
    .limit(1);
  return v ?? null;
}

/**
 * The timeline after a change: the open auto version (same one person, unnamed, edited within
 * `SESSION_MS`) takes it; else a new version starts.
 */
async function keepVersion(
  db: Queryable,
  id: string,
  latest: NoteVersion | null,
  by: string,
  now: Date,
  state: { title: string; body: NoteJson; text: string },
  opts: ChangeOpts,
): Promise<number> {
  const open =
    !opts.kind &&
    latest?.kind === "auto" &&
    !latest.name &&
    latest.authors.length === 1 &&
    latest.authors[0] === by &&
    now.getTime() - latest.at.getTime() < SESSION_MS;
  if (open && latest) {
    await db
      .update(noteVersions)
      .set({ ...pgSafe(state), at: now })
      .where(eq(noteVersions.id, latest.id));
    return latest.number;
  }
  const number = (latest?.number ?? 0) + 1;
  await db.insert(noteVersions).values({
    noteId: id,
    number,
    kind: opts.kind ?? "auto",
    name: opts.name ?? null,
    ...pgSafe(state),
    authors: [by],
    startedAt: now,
    at: now,
    restoredFrom: opts.restoredFrom ?? null,
  });
  return number;
}

/** The links table follows the body. */
async function relink(db: Queryable, id: string, body: NoteJson) {
  await db.delete(noteLinks).where(eq(noteLinks.noteId, id));
  const links = linksOf(body);
  if (links.length)
    await db
      .insert(noteLinks)
      .values(links.map((l) => pgSafe({ noteId: id, target: l.target, label: l.label })))
      .onConflictDoNothing();
}

/**
 * A browser's sync: take its update (when it may edit and sent one), then answer what it lacks
 * against its state vector.
 */
export async function syncNote(
  db: Db,
  id: string,
  by: string,
  update: Uint8Array | null,
  sv: Uint8Array | null,
): Promise<{
  note: Note;
  missing: Uint8Array;
  /** The server's state vector after: what the browser sends next is what this lacks. */
  sv: Uint8Array;
  version: number;
  changed: boolean;
}> {
  let note: Note | null = null;
  let version = 0;
  let changed = false;
  if (update && update.length > 2) {
    const c = await changeNote(db, id, by, (doc) => Y.applyUpdate(doc, update));
    note = c.note;
    version = c.version;
    changed = c.update !== null;
  }
  if (!note) {
    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    if (!row) throw new NoteMissing(id);
    note = row;
    version = (await latestVersion(db, id))?.number ?? 0;
  }
  const state = note.yState ?? Y.encodeStateAsUpdate(new Y.Doc());
  return {
    note,
    missing: sv ? Y.diffUpdate(state, sv) : state,
    sv: Y.encodeStateVectorFromUpdate(state),
    version,
    changed,
  };
}

/** Write `body` and `title` as the server, as one change (CLI, capture). */
export const replaceNote = (db: Db, id: string, by: string, body: NoteJson, title?: string) =>
  changeNote(db, id, by, (doc) => {
    writeBody(doc, body);
    if (title !== undefined && title !== readTitle(doc)) writeTitle(doc, title);
  });

/** Add blocks at the end, as one change. */
export const appendNote = (db: Db, id: string, by: string, body: NoteJson) =>
  changeNote(db, id, by, (doc) => appendBody(doc, body));

/** Rename: the title lives in the doc, so open editors get it. */
export const renameNote = (db: Db, id: string, by: string, title: string) =>
  changeNote(db, id, by, (doc) => {
    if (title !== readTitle(doc)) writeTitle(doc, title);
  });

/** Version `number` back as the note, as a new `restore` version. Nothing rewinds. */
export async function restoreVersion(db: Db, id: string, number: number, by: string) {
  const [v] = await db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, id), eq(noteVersions.number, number)));
  if (!v) throw new NoteMissing(`${id} v${number}`);
  return changeNote(
    db,
    id,
    by,
    (doc) => {
      writeBody(doc, v.body);
      if (v.title !== readTitle(doc)) writeTitle(doc, v.title);
    },
    { kind: "restore", restoredFrom: number },
  );
}

/** Name a version; a named version stays as it is, the next edit starts a new one. */
export async function nameVersion(db: Db, id: string, number: number, name: string | null) {
  const [v] = await db
    .update(noteVersions)
    .set({ name: name?.trim().slice(0, 200) || null })
    .where(and(eq(noteVersions.noteId, id), eq(noteVersions.number, number)))
    .returning();
  if (!v) throw new NoteMissing(`${id} v${number}`);
  return v;
}

/** The timeline, newest first, without bodies. */
export function versionsOf(db: Queryable, id: string) {
  return db
    .select({
      number: noteVersions.number,
      kind: noteVersions.kind,
      name: noteVersions.name,
      title: noteVersions.title,
      authors: noteVersions.authors,
      startedAt: noteVersions.startedAt,
      at: noteVersions.at,
      restoredFrom: noteVersions.restoredFrom,
      size: sql<number>`length(${noteVersions.text})`.mapWith(Number),
    })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, id))
    .orderBy(desc(noteVersions.number));
}

/** Versions `from` through `to`, with their words, oldest first. */
export function versionRange(db: Queryable, id: string, from: number, to: number) {
  return db
    .select()
    .from(noteVersions)
    .where(
      and(
        eq(noteVersions.noteId, id),
        sql`${noteVersions.number} between ${Math.min(from, to)} and ${Math.max(from, to)}`,
      ),
    )
    .orderBy(asc(noteVersions.number));
}

// ---- Read ----

export async function noteById(db: Queryable, id: string): Promise<Note | null> {
  if (!isNoteId(id)) return null;
  const [row] = await db.select().from(notes).where(eq(notes.id, id));
  return row ?? null;
}

export const sharesOf = (db: Queryable, id: string) =>
  db.select().from(noteShares).where(eq(noteShares.noteId, id)).orderBy(asc(noteShares.at));

/** The note's role for a reader, from its rows. */
export async function roleOn(
  db: Queryable,
  note: Note,
  r: Omit<Reader, "cap">,
): Promise<Role | null> {
  return noteRole(note, await sharesOf(db, note.id), r);
}

/** Which notes a reader may open, as SQL on `notes`. */
export function visible(r: Omit<Reader, "cap">): SQL {
  const whos = [
    r.email.toLowerCase(),
    ...(r.team ? [TEAM] : []),
    ...(r.client ? [clientWho(r.client)] : []),
  ];
  return or(
    r.email ? sql`lower(${notes.owner}) = ${r.email.toLowerCase()}` : sql`false`,
    sql`exists (select 1 from ${noteShares} s where s.note_id = ${notes.id} and lower(s.who) in (${sql.join(
      whos.map((w) => sql`${w}`),
      sql`, `,
    )}))`,
    r.inWorkspace ? eq(notes.general, "workspace") : sql`false`,
  ) as SQL;
}

export type ListView = "recent" | "mine" | "shared" | "starred" | "archived" | "all";

export interface ListOpts {
  view: ListView;
  q?: string | null;
  limit?: number;
  /** Only notes shared to these `who`s (a Wren note shared to a client, read from main). */
  sharedTo?: readonly string[];
  /** Every note, whoever's: the CLI without `--as`, as it reads every table. */
  everything?: boolean;
  parentId?: string | null;
}

/** A list row: enough for Notes' home and the CLI. */
export interface NoteRow {
  id: string;
  title: string;
  kind: NoteKind;
  owner: string;
  via: Via;
  general: General;
  generalRole: ShareRole;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  editedBy: string | null;
  archivedAt: Date | null;
  starred: boolean;
  seenAt: Date | null;
  excerpt: string;
  text: string;
  rank: number;
}

/** Notes a reader may open, by view, newest first, or best match first when searching. */
export async function listNotes(
  db: Queryable,
  r: Omit<Reader, "cap">,
  o: ListOpts,
): Promise<NoteRow[]> {
  const email = r.email.toLowerCase();
  const q = o.q?.trim() || null;
  const tsq = q ? sql`websearch_to_tsquery('english', ${q})` : null;
  const where: (SQL | undefined)[] = [
    o.sharedTo
      ? sql`exists (select 1 from ${noteShares} s where s.note_id = ${notes.id} and s.who in (${sql.join(
          o.sharedTo.map((w) => sql`${w}`),
          sql`, `,
        )}))`
      : o.everything
        ? undefined
        : visible(r),
    o.view === "archived" ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt),
  ];
  if (o.view === "mine") where.push(sql`lower(${notes.owner}) = ${email}`);
  if (o.view === "shared") where.push(sql`lower(${notes.owner}) <> ${email}`);
  if (o.view === "starred") where.push(isNotNull(noteStars.at));
  if (o.view === "recent")
    where.push(
      or(
        isNotNull(noteSeen.at),
        sql`lower(${notes.owner}) = ${email}`,
        eq(notes.editedBy, r.email),
      ),
    );
  if (o.parentId !== undefined)
    where.push(o.parentId === null ? isNull(notes.parentId) : eq(notes.parentId, o.parentId));
  if (q && tsq)
    where.push(
      or(
        sql`${notes.search} @@ ${tsq}`,
        sql`${notes.title} ilike ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
      ),
    );
  const rank = tsq ? sql<number>`ts_rank(${notes.search}, ${tsq})` : sql<number>`0`;
  const excerpt = tsq
    ? sql<string>`ts_headline('english', ${notes.text}, ${tsq}, 'MaxWords=24, MinWords=8, MaxFragments=1, StartSel=«, StopSel=»')`
    : sql<string>`left(${notes.text}, 240)`;
  const recency =
    o.view === "recent"
      ? sql`greatest(${noteSeen.at}, case when lower(${notes.owner}) = ${email} or ${notes.editedBy} = ${r.email} then ${notes.updatedAt} end) desc nulls last`
      : sql`${notes.updatedAt} desc`;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      kind: notes.kind,
      owner: notes.owner,
      via: notes.via,
      general: notes.general,
      generalRole: notes.generalRole,
      parentId: notes.parentId,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      editedBy: notes.editedBy,
      archivedAt: notes.archivedAt,
      starred: sql<boolean>`${noteStars.at} is not null`,
      seenAt: noteSeen.at,
      excerpt,
      text: sql<string>`left(${notes.text}, 400)`,
      rank,
    })
    .from(notes)
    .leftJoin(noteStars, and(eq(noteStars.noteId, notes.id), eq(noteStars.email, email)))
    .leftJoin(noteSeen, and(eq(noteSeen.noteId, notes.id), eq(noteSeen.email, email)))
    .where(and(...where))
    .orderBy(...(q ? [sql`${rank} desc`, recency] : [recency]))
    .limit(Math.min(Math.max(o.limit ?? 100, 1), 500));
  return rows.map((x) => ({ ...x, starred: !!x.starred, rank: Number(x.rank) }));
}

/** Notes that link to `target` and that the reader may open. */
export function backlinks(db: Queryable, r: Omit<Reader, "cap">, target: string) {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      text: sql<string>`left(${notes.text}, 240)`,
      owner: notes.owner,
      updatedAt: notes.updatedAt,
      label: noteLinks.label,
    })
    .from(noteLinks)
    .innerJoin(notes, eq(notes.id, noteLinks.noteId))
    .where(and(eq(noteLinks.target, target), isNull(notes.archivedAt), visible(r)))
    .orderBy(desc(notes.updatedAt))
    .limit(50);
}

/** Its children, for the doc's sidebar. */
export function childrenOf(db: Queryable, r: Omit<Reader, "cap">, id: string) {
  return db
    .select({ id: notes.id, title: notes.title, text: sql<string>`left(${notes.text}, 120)` })
    .from(notes)
    .where(and(eq(notes.parentId, id), isNull(notes.archivedAt), visible(r)))
    .orderBy(asc(notes.createdAt));
}

// ---- Per person ----

export async function star(db: Queryable, id: string, email: string, on: boolean) {
  if (on)
    await db
      .insert(noteStars)
      .values({ noteId: id, email: email.toLowerCase() })
      .onConflictDoNothing();
  else
    await db
      .delete(noteStars)
      .where(and(eq(noteStars.noteId, id), eq(noteStars.email, email.toLowerCase())));
}

export async function seen(db: Queryable, id: string, email: string) {
  if (!email) return;
  await db
    .insert(noteSeen)
    .values({ noteId: id, email: email.toLowerCase() })
    .onConflictDoUpdate({ target: [noteSeen.noteId, noteSeen.email], set: { at: new Date() } });
}

/** This person's Dump note here, made on first use. */
export async function dumpOf(db: Db, email: string): Promise<Note> {
  const owner = email.toLowerCase();
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.kind, "dump"), eq(notes.owner, owner)));
  if (row) return row;
  try {
    return await createNote(db, { owner, by: owner, kind: "dump", title: "Dump" });
  } catch (err) {
    // Two captures at once: the other made it.
    const [again] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.kind, "dump"), eq(notes.owner, owner)));
    if (again) return again;
    throw err;
  }
}

// ---- Sharing ----

export async function share(
  db: Queryable,
  id: string,
  who: string,
  role: ShareRole | null,
  by: string,
) {
  const w = who.includes("@") ? who.trim().toLowerCase() : who.trim();
  if (!role) {
    await db.delete(noteShares).where(and(eq(noteShares.noteId, id), eq(noteShares.who, w)));
    return;
  }
  await db
    .insert(noteShares)
    .values({ noteId: id, who: w, role, by })
    .onConflictDoUpdate({
      target: [noteShares.noteId, noteShares.who],
      set: { role, by, at: new Date() },
    });
}

export async function setGeneral(db: Queryable, id: string, general: General, role: ShareRole) {
  await db.update(notes).set({ general, generalRole: role }).where(eq(notes.id, id));
}

/** A new owner; the old one keeps edit. */
export async function transfer(db: Db, id: string, to: string, by: string) {
  await atomic(db, async (tx) => {
    const [row] = await tx.select().from(notes).where(eq(notes.id, id)).for("update");
    if (!row) throw new NoteMissing(id);
    const next = to.trim().toLowerCase();
    await tx.update(notes).set({ owner: next }).where(eq(notes.id, id));
    await tx.delete(noteShares).where(and(eq(noteShares.noteId, id), eq(noteShares.who, next)));
    if (!row.owner.startsWith("agent:")) await share(tx, id, row.owner, "edit", by);
  });
}

export async function setArchived(db: Queryable, id: string, on: boolean) {
  await db
    .update(notes)
    .set({ archivedAt: on ? new Date() : null })
    .where(eq(notes.id, id));
}

export async function setTrain(db: Queryable, id: string, on: boolean) {
  await db.update(notes).set({ train: on }).where(eq(notes.id, id));
}

/** Under another note, or at the top; never under itself or its own child. */
export async function move(db: Db, id: string, parentId: string | null) {
  if (parentId) {
    let at: string | null = parentId;
    for (let i = 0; at && i < 50; i++) {
      if (at === id) throw new Error("a note can't go under itself");
      const [p]: { parentId: string | null }[] = await db
        .select({ parentId: notes.parentId })
        .from(notes)
        .where(eq(notes.id, at));
      at = p?.parentId ?? null;
    }
  }
  await db.update(notes).set({ parentId }).where(eq(notes.id, id));
}

// ---- Workspace ----

export async function settingsOf(db: Queryable): Promise<{ train: boolean }> {
  const [row] = await db.select().from(notesSettings).where(eq(notesSettings.id, 1));
  return { train: row?.train ?? false };
}

export async function setWorkspaceTrain(db: Queryable, on: boolean, by: string) {
  await db
    .insert(notesSettings)
    .values({ id: 1, train: on, updatedBy: by })
    .onConflictDoUpdate({
      target: notesSettings.id,
      set: { train: on, updatedBy: by, updatedAt: new Date() },
    });
}

/** What `wren train export --notes` writes: opted-in notes with their versions. */
export async function trainingNotes(db: Queryable) {
  const all = (await settingsOf(db)).train;
  const rows = await db
    .select()
    .from(notes)
    .where(and(all ? undefined : eq(notes.train, true), ne(notes.kind, "dump")))
    .orderBy(asc(notes.createdAt));
  if (!rows.length) return [];
  const versions = await db
    .select({
      noteId: noteVersions.noteId,
      number: noteVersions.number,
      kind: noteVersions.kind,
      name: noteVersions.name,
      authors: noteVersions.authors,
      at: noteVersions.at,
      text: noteVersions.text,
    })
    .from(noteVersions)
    .where(
      inArray(
        noteVersions.noteId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(noteVersions.number));
  return rows.map((n) => ({ note: n, versions: versions.filter((v) => v.noteId === n.id) }));
}
