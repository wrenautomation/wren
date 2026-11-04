/**
 * Items into SOPs. "Add to SOP" asks. The Mac, where `../sops` lives, writes the item's stored
 * transcript into that SOP's `sources/` and extracts its points; build and push stay William's
 * (`wren sop build`, `wren sop push`).
 */
import { join } from "node:path";
import { WREN } from "@wren/core/access";
import type { Db } from "@wren/db";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { fileOf } from "./read.js";
import { items, sopSources } from "./schema.js";

/** An SOP folder's name, as `wren sop add` makes one. */
const SOP_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
interface SopWriter {
  add(dir: string, source: { name: string; md: string }): Promise<string>;
  extract(dir: string, stem: string): Promise<void>;
}

/**
 * Write each of Wren's asked items that's read into its SOP's folder, then extract its points.
 * One that fails keeps why; the rest go on. Unread items wait.
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
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 5000);
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
