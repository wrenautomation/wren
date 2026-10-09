/**
 * Items into SOPs. "Add to SOP" asks. For Wren's own items the Mac, where `../sops` lives, writes
 * the item's stored transcript into that SOP's `sources/` and extracts its points; build and push
 * stay William's (`wren sop build`, `wren sop push`). A client's item goes into that client's own
 * Notes instead, under a note named for the SOP, in its own database: never Wren's folder.
 * The SOP library reads the folders where they exist and the database everywhere: which items fed
 * which SOP, and what was pushed when. A client's library is its own links alone.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { WREN } from "@wren/core/access";
import type { Db, Queryable } from "@wren/db";
import { createNote } from "@wren/notes";
import { fromMarkdown } from "@wren/notes/doc";
import { notes } from "@wren/notes/schema";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { fileOf } from "./read.js";
import { items, sopSources } from "./schema.js";

/** An SOP folder's name, as `wren sop add` makes one. */
export const SOP_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Ask for this workspace's item in an SOP; a failed ask asks again. */
export async function askSop(
  db: Db,
  p: { client: string; itemId: number; sop: string; by: string | null },
) {
  const sop = p.sop.trim().toLowerCase();
  if (!SOP_NAME.test(sop)) throw new Error("An SOP name is lowercase letters, digits and dashes");
  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, p.itemId), eq(items.client, p.client)));
  if (!item) throw new Error(`No item ${p.itemId}`);
  const [row] = await db
    .insert(sopSources)
    .values({ itemId: p.itemId, sop, by: p.by })
    .onConflictDoUpdate({
      target: [sopSources.itemId, sopSources.sop],
      set: {
        state: sql`case when ${sopSources.state} = 'failed' then 'asked' else ${sopSources.state} end`,
        error: null,
      },
    })
    .returning();
  if (!row) throw new Error("ask returned no row");
  return row;
}

/** What writes into a folder: `sop add`'s and `sop extract`'s, passed in by the CLI. */
export interface SopWriter {
  add(dir: string, source: { name: string; md: string }): Promise<string>;
  extract(dir: string, stem: string): Promise<void>;
}

/**
 * Write each of Wren's asked items that's read into its SOP's folder, then extract its points.
 * One that fails keeps why; the rest go on. Unread items wait. Clients' asks go to their Notes.
 */
export async function writeAsked(
  db: Db,
  sopsDir: string,
  writer: SopWriter,
  only?: { itemId?: number; sop?: string },
): Promise<Array<{ sop: string; file: string | null; error: string | null }>> {
  const asked = await db
    .select({ ask: sopSources, item: items })
    .from(sopSources)
    .leftJoin(items, eq(items.id, sopSources.itemId))
    .where(
      and(
        or(
          and(eq(items.client, WREN), isNotNull(items.transcript)),
          // Words from one of Wren's notes; never with `only.itemId`.
          only?.itemId ? undefined : eq(sopSources.client, WREN),
        ),
        eq(sopSources.state, "asked"),
        only?.itemId ? eq(sopSources.itemId, only.itemId) : undefined,
        only?.sop ? eq(sopSources.sop, only.sop) : undefined,
      ),
    )
    .orderBy(asc(sopSources.id));
  const out: Array<{ sop: string; file: string | null; error: string | null }> = [];
  for (const { ask, item } of asked) {
    const name = item ? (item.file ?? fileOf(item.url)) : noteFile(ask);
    const md = item ? (item.transcript ?? "") : noteWords(ask);
    const dir = join(sopsDir, ask.sop);
    let written = false;
    try {
      await writer.add(dir, { name, md });
      written = true;
      await db
        .update(sopSources)
        .set({ state: "added", file: name, error: null, doneAt: new Date() })
        .where(eq(sopSources.id, ask.id));
      await writer.extract(dir, name.replace(/\.md$/, ""));
      await db.update(sopSources).set({ points: new Date() }).where(eq(sopSources.id, ask.id));
      out.push({ sop: ask.sop, file: name, error: null });
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      // Written but not extracted stays added: `wren sop extract` finishes it.
      await db
        .update(sopSources)
        .set({ error, ...(written ? {} : { state: "failed" as const }) })
        .where(eq(sopSources.id, ask.id));
      out.push({ sop: ask.sop, file: null, error });
    }
  }
  return out;
}

/** A note's words under an SOP's `sources/`: one file per ask. */
const noteFile = (ask: { id: number; noteId: string | null }) =>
  `note-${(ask.noteId ?? "").slice(0, 8)}-${ask.id}.md`;
const noteWords = (ask: { title: string | null; text: string | null }) =>
  [ask.title ? `# ${ask.title}` : "", ask.text ?? ""].filter(Boolean).join("\n\n");

/**
 * Words from a note (Notes → Make an SOP) asked into an SOP. Wren's wait for the Mac to write
 * them into the folder, as items do; a client's go now into its own Notes, under the SOP's note.
 * `notesDb` is the workspace's own database. What happened, in a few words.
 */
export async function askNoteSop(
  db: Db,
  notesDb: Db,
  p: { client: string; noteId: string; sop: string; title: string; text: string; by: string },
): Promise<{ sop: string; state: "asked" | "added"; note: string | null }> {
  const sop = p.sop.trim().toLowerCase();
  if (!SOP_NAME.test(sop)) throw new Error("An SOP name is lowercase letters, digits and dashes");
  const text = p.text.trim();
  if (!text) throw new Error("Select the words for the SOP");
  const row = {
    noteId: p.noteId,
    client: p.client,
    sop,
    title: p.title.slice(0, 300),
    text: text.slice(0, 200_000),
    by: p.by,
  };
  if (p.client === WREN) {
    await db.insert(sopSources).values(row);
    return { sop, state: "asked", note: null };
  }
  const parent = await sopNote(notesDb, sop);
  const note = await createNote(notesDb, {
    owner: LEARN_AGENT,
    by: p.by,
    via: "agent",
    title: row.title || sop,
    body: fromMarkdown(row.text),
    parentId: parent,
  });
  await db.insert(sopSources).values({
    ...row,
    state: "added",
    file: `note:${note.id}`,
    doneAt: new Date(),
  });
  return { sop, state: "added", note: note.id };
}

/** One row of the SOP library. */
export interface SopRow {
  id: string;
  sop: string;
  /** "folder" when `../sops` was read here, "database" when only pushes and links are known. */
  seen: "folder" | "database";
  sources: number | null;
  fromItems: number;
  asked: number;
  items: string | null;
  built: Date | null;
  pushed: Date | null;
  state: "pushed" | "changed" | "unpushed" | "unknown";
  words: number | null;
}

interface Pushed {
  sop: string;
  at: Date;
  text: string;
}

/**
 * Every SOP of a workspace. Wren's: from its folder under `sopsDir` when that's readable here,
 * else from the database alone (pushes and the items asked into it); `sopsDir` null reads the
 * database only. A client's: the SOP names its own items were asked into, nothing of Wren's.
 */
export async function sopLibrary(
  db: Queryable,
  client: string,
  sopsDir: string | null,
): Promise<SopRow[]> {
  const wren = client === WREN;
  const pushes = wren
    ? ((await db.execute(sql`
    select distinct on (sop) sop, created_at at, text from content_playbooks
    order by sop, created_at desc`)) as unknown as Pushed[])
    : [];
  const pushed = new Map(pushes.map((p) => [p.sop, { ...p, at: new Date(p.at) }]));
  const links = await db
    .select({
      sop: sopSources.sop,
      state: sopSources.state,
      title: sql<string>`coalesce(${items.title}, ${sopSources.title}, 'A note')`,
    })
    .from(sopSources)
    .leftJoin(items, eq(items.id, sopSources.itemId))
    .where(or(eq(items.client, client), eq(sopSources.client, client)))
    .orderBy(asc(sopSources.sop), asc(sopSources.id));
  const folders = wren && sopsDir ? await readFolders(sopsDir) : null;
  const names = new Set([...(folders?.keys() ?? []), ...pushed.keys(), ...links.map((l) => l.sop)]);
  return [...names].sort().map((sop): SopRow => {
    const f = folders?.get(sop) ?? null;
    const p = pushed.get(sop) ?? null;
    const mine = links.filter((l) => l.sop === sop);
    const state = !f
      ? p
        ? "pushed"
        : "unknown"
      : !p
        ? "unpushed"
        : p.text.trim() === f.current.trim()
          ? "pushed"
          : "changed";
    return {
      id: sop,
      sop,
      seen: f ? "folder" : "database",
      sources: f ? f.sources : null,
      fromItems: mine.filter((l) => l.state === "added").length,
      asked: mine.filter((l) => l.state === "asked").length,
      items: mine.length ? mine.map((l) => l.title).join("; ") : null,
      built: f?.built ?? null,
      pushed: p?.at ?? null,
      state: folders ? state : p ? "pushed" : "unknown",
      words: f?.current ? f.current.split(/\s+/).filter(Boolean).length : null,
    };
  });
}

/** Each SOP folder: its source count, SOP.md, and when SOP.md was last written. */
async function readFolders(
  sopsDir: string,
): Promise<Map<string, { sources: number; current: string; built: Date | null }> | null> {
  const names = await readdir(sopsDir, { withFileTypes: true }).catch(() => null);
  if (!names) return null;
  const out = new Map<string, { sources: number; current: string; built: Date | null }>();
  for (const d of names) {
    if (!d.isDirectory() || !SOP_NAME.test(d.name)) continue;
    const dir = join(sopsDir, d.name);
    const files = await readdir(dir).catch(() => [] as string[]);
    if (!files.includes("SOP.md") && !files.includes("notes.md") && !files.includes("sources"))
      continue;
    const sources = (await readdir(join(dir, "sources")).catch(() => [] as string[])).filter((n) =>
      n.endsWith(".md"),
    ).length;
    const current = await readFile(join(dir, "SOP.md"), "utf8").catch(() => "");
    const built = await stat(join(dir, "SOP.md")).then(
      (s) => s.mtime,
      () => null,
    );
    out.set(d.name, { sources, current, built });
  }
  return out;
}

/** The SOPs a workspace's item may go into: every known name, for the "Add to SOP" picker. */
export async function sopNames(
  db: Queryable,
  client: string,
  sopsDir: string | null,
): Promise<string[]> {
  return (await sopLibrary(db, client, sopsDir)).map((r) => r.sop);
}

/** Who writes a client's SOP notes. */
const LEARN_AGENT = "agent:learn";

/** A note body for an item: its link, summary and transcript. */
export function noteMarkdown(item: {
  url: string;
  summary: string | null;
  transcript: string | null;
  text: string;
}): string {
  const parts = [`Source: ${item.url}`];
  if (item.summary) parts.push(item.summary);
  parts.push(item.transcript ?? item.text);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Write a client's asked items that are read into its own Notes: one note per item, under a
 * top-level note named for the SOP that everyone in the workspace sees. `notesDb` is that
 * client's own database; Wren's items never come here. Unread items wait.
 */
export async function writeClientAsked(
  db: Db,
  client: string,
  notesDb: Db,
  only?: { itemId?: number },
): Promise<Array<{ sop: string; note: string | null; error: string | null }>> {
  if (client === WREN) throw new Error("Wren's SOPs are folders: wren learn to-sop");
  const asked = await db
    .select({ ask: sopSources, item: items })
    .from(sopSources)
    .innerJoin(items, eq(items.id, sopSources.itemId))
    .where(
      and(
        eq(items.client, client),
        eq(sopSources.state, "asked"),
        isNotNull(items.readAt),
        only?.itemId ? eq(sopSources.itemId, only.itemId) : undefined,
      ),
    )
    .orderBy(asc(sopSources.id));
  const out: Array<{ sop: string; note: string | null; error: string | null }> = [];
  for (const { ask, item } of asked) {
    try {
      const parent = await sopNote(notesDb, ask.sop);
      const note = await createNote(notesDb, {
        owner: LEARN_AGENT,
        by: ask.by ?? LEARN_AGENT,
        via: "agent",
        title: item.title.slice(0, 300),
        body: fromMarkdown(noteMarkdown(item)),
        parentId: parent,
      });
      await db
        .update(sopSources)
        .set({ state: "added", file: `note:${note.id}`, error: null, doneAt: new Date() })
        .where(eq(sopSources.id, ask.id));
      out.push({ sop: ask.sop, note: note.id, error: null });
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await db.update(sopSources).set({ error, state: "failed" }).where(eq(sopSources.id, ask.id));
      out.push({ sop: ask.sop, note: null, error });
    }
  }
  return out;
}

/** After an item is read and scored: if it's a client's, its asked SOPs go into its Notes. */
export const clientAskedOnRead =
  (db: Db, clientDb: (client: string) => Db) =>
  async (itemId: number): Promise<void> => {
    const [row] = await db.select({ client: items.client }).from(items).where(eq(items.id, itemId));
    if (row && row.client !== WREN)
      await writeClientAsked(db, row.client, clientDb(row.client), { itemId });
  };

/** The SOP's top-level note in a client's Notes, made the first time. */
async function sopNote(notesDb: Db, sop: string): Promise<string> {
  const [found] = await notesDb
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        isNull(notes.parentId),
        isNull(notes.archivedAt),
        eq(notes.owner, LEARN_AGENT),
        eq(notes.title, sop),
      ),
    )
    .limit(1);
  if (found) return found.id;
  const made = await createNote(notesDb, {
    owner: LEARN_AGENT,
    by: LEARN_AGENT,
    via: "agent",
    title: sop,
    general: "workspace",
    generalRole: "edit",
  });
  return made.id;
}
