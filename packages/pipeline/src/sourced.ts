/**
 * Sourced sources (designs/2026-10-19-business-map.md). The list a person is added to is an
 * import batch: `import:<imports.id>`, its members the `people` rows with that `import_id`. People
 * come in through the importer, outside Restate, so there is no writer to fire from; a tail loop
 * reads the new members instead. A cursor per list (the last `people.id` seen) keeps it one pass
 * per member. The first pass of a list new to the shape reads all its members.
 *
 * Pure of Restate: the worker's `SourcedFeed` loop keeps the cursors and sends the fires.
 */

import type { Fired } from "@wren/core/executor";
import { SOURCE_ID } from "@wren/core/logic";
import type { Db } from "@wren/db";
import { desc, sql } from "drizzle-orm";
import { liveSources as liveSourceNodes } from "./entry.js";
import { shapeVersions } from "./schema.js";
import { runOf } from "./stored.js";

/** The last `people.id` seen, per list id. */
export type SourceCursors = Record<string, number>;

interface SourcedPass {
  fires: Fired[];
  cursors: SourceCursors;
  scanned: number;
  /** Members with no profile yet: skipped. */
  unkeyed: number;
  /** A list had `limit` members to read: more may follow. */
  more: boolean;
}

/** Lists that the newest shape's live sourced sources take people from. */
export async function liveSources(db: Db): Promise<string[]> {
  const [newest] = await db
    .select({ body: shapeVersions.body })
    .from(shapeVersions)
    .orderBy(desc(shapeVersions.number))
    .limit(1);
  if (!newest) return [];
  const ids = liveSourceNodes(runOf(newest.body)).flatMap((n) =>
    n.via === "sourced" && n.source ? [n.source] : [],
  );
  return [...new Set(ids)].filter((s) => SOURCE_ID.test(s)).sort();
}

/** The fires for members added since `cursors`, at most `limit` per list. */
export async function sourcedPass(
  db: Db,
  client: string | null,
  cursors: SourceCursors,
  now: Date,
  limit = 200,
): Promise<SourcedPass> {
  const next: SourceCursors = { ...cursors };
  const fires: Fired[] = [];
  let scanned = 0;
  let unkeyed = 0;
  let more = false;
  for (const source of await liveSources(db)) {
    const batch = Number(source.slice("import:".length));
    const after = cursors[source] ?? 0;
    const rows = (await db.execute(sql`
      select p.id as person, k.profile_id as profile
      from people p
      left join profile_keys k on k.kind = 'person' and k.value = p.id::text
      where p.import_id = ${batch} and p.id > ${after}
      order by p.id
      limit ${limit}`)) as unknown as { person: number; profile: number | null }[];
    if (rows.length === limit) more = true;
    for (const r of rows) {
      scanned++;
      next[source] = r.person;
      if (r.profile === null) {
        unkeyed++;
        continue;
      }
      fires.push({
        client,
        facts: { trigger: "trigger.source", source },
        event: {
          subject: `source:${source}:${r.person}`,
          kind: "lead",
          data: {
            profile: r.profile,
            row: String(r.person),
            source,
            cause: { kind: "sourced", ref: source, at: now.toISOString() },
          },
        },
      });
    }
  }
  return { fires, cursors: next, scanned, unkeyed, more };
}
