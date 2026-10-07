/**
 * Items into SOPs. "Add to SOP" asks; the Mac, where `../sops` lives, writes the item's stored
 * transcript into that SOP's `sources/` and extracts its points. Build and push stay William's
 * (`wren sop build`, `wren sop push`). The SOP library reads the folders where they exist and
 * the database everywhere: which items fed which SOP, and what was pushed when.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Db, Queryable } from "@wren/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { fileOf } from "./read.js";
import { items, sopSources } from "./schema.js";

/** An SOP folder's name, as `wren sop add` makes one. */
export const SOP_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Ask for an item in an SOP; a failed ask asks again. */
export async function askSop(db: Db, p: { itemId: number; sop: string; by: string | null }) {
  const sop = p.sop.trim().toLowerCase();
  if (!SOP_NAME.test(sop)) throw new Error("An SOP name is lowercase letters, digits and dashes");
  const [item] = await db.select({ id: items.id }).from(items).where(eq(items.id, p.itemId));
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
 * Write each asked item that's read into its SOP's folder, then extract its points. One that
 * fails keeps why; the rest go on. Unread items wait.
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
    .innerJoin(items, eq(items.id, sopSources.itemId))
    .where(
      and(
        eq(sopSources.state, "asked"),
        isNotNull(items.transcript),
        only?.itemId ? eq(sopSources.itemId, only.itemId) : undefined,
        only?.sop ? eq(sopSources.sop, only.sop) : undefined,
      ),
    )
    .orderBy(asc(sopSources.id));
  const out: Array<{ sop: string; file: string | null; error: string | null }> = [];
  for (const { ask, item } of asked) {
    const name = item.file ?? fileOf(item.url);
    const dir = join(sopsDir, ask.sop);
    let written = false;
    try {
      await writer.add(dir, { name, md: item.transcript ?? "" });
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
 * Every SOP: from its folder under `sopsDir` when that's readable here, else from the database
 * alone (pushes and the items asked into it). `sopsDir` null reads the database only.
 */
export async function sopLibrary(db: Queryable, sopsDir: string | null): Promise<SopRow[]> {
  const pushes = (await db.execute(sql`
    select distinct on (sop) sop, created_at at, text from content_playbooks
    order by sop, created_at desc`)) as unknown as Pushed[];
  const pushed = new Map(pushes.map((p) => [p.sop, { ...p, at: new Date(p.at) }]));
  const links = await db
    .select({ sop: sopSources.sop, state: sopSources.state, title: items.title })
    .from(sopSources)
    .innerJoin(items, eq(items.id, sopSources.itemId))
    .orderBy(asc(sopSources.sop), asc(sopSources.id));
  const folders = sopsDir ? await readFolders(sopsDir) : null;
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

/** The SOPs an item may go into: every known name, for the "Add to SOP" picker. */
export async function sopNames(db: Queryable, sopsDir: string | null): Promise<string[]> {
  return (await sopLibrary(db, sopsDir)).map((r) => r.sop);
}
