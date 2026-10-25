/**
 * `wren templates prune`: a niche's email templates whose default file is gone (a retired arm, a
 * dropped sequence) leave the Library (designs/2026-10-15-template-tidy.md). Main database only:
 * niche copy is Wren's own. Dry run unless `apply`.
 *
 * - Never sent: the row and its versions are deleted.
 * - Sent (a message names it): its versions are what those sends said, so they stay. The row is
 *   emptied (nothing live, no draft, not following a default) and moved to `retired/`.
 *
 * `templates` has no archive column; the `retired` folder is the archive. Run twice, the second
 * run finds nothing to do.
 */
import { defaultFolder } from "@wren/core/templates";
import { atomic, type Queryable, setAuditActor } from "@wren/db";
import { sql } from "drizzle-orm";

const RETIRED = "retired";

export interface PruneRow {
  id: number;
  system: string;
  name: string;
  folder: string;
  live: boolean;
  draft: boolean;
  waiting: boolean;
  followsDefault: boolean;
  /** Messages that name it, in any state. */
  messages: number;
}

type PruneAction = "delete" | "retire" | "keep";

/** What happens to one email row: `files` holds `<system>/<name>` of every email default. */
export function pruneAction(
  r: PruneRow,
  niches: ReadonlySet<string>,
  files: ReadonlySet<string>,
): PruneAction {
  if (!niches.has(r.system) || files.has(`${r.system}/${r.name}`)) return "keep";
  if (r.messages === 0) return "delete";
  const done = r.folder === folderOf(r) && !r.live && !r.draft && !r.waiting && !r.followsDefault;
  return done ? "keep" : "retire";
}

/** Where a retired row shows: `retired/<its default folder>`, so two niches' names never mix. */
const folderOf = (r: Pick<PruneRow, "system" | "name">) =>
  `${RETIRED}/${defaultFolder({ kind: "email", system: r.system, name: r.name })}`;

interface PruneResult {
  apply: boolean;
  delete: string[];
  retire: string[];
}

export async function pruneTemplates(
  db: Queryable,
  o: { niches: ReadonlySet<string>; files: ReadonlySet<string>; apply: boolean; by: string },
): Promise<PruneResult> {
  const rows = (
    (await db.execute(sql`
      SELECT t.id, t.system, t.name, t.folder, t.follows_default,
        t.live_version_id IS NOT NULL live, t.draft_version_id IS NOT NULL draft,
        t.waiting_version_id IS NOT NULL waiting,
        (SELECT count(*) FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
          WHERE e.niche = t.system AND m.template = t.name)::int messages
      FROM templates t WHERE t.kind = 'email' ORDER BY t.system, t.name`)) as unknown as Record<
      string,
      unknown
    >[]
  ).map(
    (r): PruneRow => ({
      id: Number(r.id),
      system: String(r.system),
      name: String(r.name),
      folder: String(r.folder),
      live: Boolean(r.live),
      draft: Boolean(r.draft),
      waiting: Boolean(r.waiting),
      followsDefault: Boolean(r.follows_default),
      messages: Number(r.messages),
    }),
  );
  const of = (a: PruneAction) => rows.filter((r) => pruneAction(r, o.niches, o.files) === a);
  const gone = of("delete");
  const retired = of("retire");
  const ref = (r: PruneRow) => `email:${r.system}/${r.name}`;
  if (o.apply && (gone.length || retired.length))
    await atomic(db, async (tx) => {
      await setAuditActor(tx, o.by);
      for (const r of retired)
        await tx.execute(sql`
          UPDATE templates SET live_version_id = NULL, draft_version_id = NULL,
            waiting_version_id = NULL, waiting_by = NULL, follows_default = false,
            folder = ${folderOf(r)}, why = 'retired: its default file is gone', updated_at = now()
          WHERE id = ${r.id}`);
      const ids = gone.map((r) => r.id);
      if (ids.length) {
        const list = sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE templates SET live_version_id = NULL, draft_version_id = NULL,
            waiting_version_id = NULL WHERE id IN (${list})`);
        await tx.execute(sql`DELETE FROM template_versions WHERE template_id IN (${list})`);
        await tx.execute(sql`DELETE FROM templates WHERE id IN (${list})`);
      }
    });
  return { apply: o.apply, delete: gone.map(ref), retire: retired.map(ref) };
}
