/**
 * Tags (designs/2026-10-19-business-map.md, "History like git"): a name on one version, like a git
 * tag. A tag is never moved or removed: the database refuses an update or a delete
 * (`shape_tags_never_edited`).
 */
import { atomic, type Queryable } from "@wren/db";
import { asc, eq } from "drizzle-orm";
import { type ShapeTag, shapeTags, shapeVersions } from "./schema.js";
import { lock, Refused } from "./store.js";

const TAG_NAME_MAX = 60;

/** Put a tag on a version. Refused when the name is empty or long, the version is none, or the name is taken. */
export async function addTag(
  db: Queryable,
  input: { name: string; version: number; note?: string; by: string },
): Promise<ShapeTag> {
  const name = input.name.trim();
  if (!name) throw new Refused(["The tag needs a name."]);
  if (name.length > TAG_NAME_MAX)
    throw new Refused([`A tag name is ${TAG_NAME_MAX} characters or fewer.`]);
  return atomic(db, async (tx) => {
    await lock(tx, `shape_tag:${name}`);
    const [v] = await tx
      .select({ number: shapeVersions.number })
      .from(shapeVersions)
      .where(eq(shapeVersions.number, input.version));
    if (!v) throw new Refused([`There is no shape version ${input.version}.`]);
    const [taken] = await tx.select().from(shapeTags).where(eq(shapeTags.name, name));
    if (taken) throw new Refused([`The tag "${name}" is on version ${taken.version}.`]);
    const [row] = await tx
      .insert(shapeTags)
      .values({
        name,
        version: input.version,
        note: input.note?.trim() ? input.note.trim() : null,
        createdBy: input.by,
      })
      .returning();
    if (!row) throw new Error("tag insert returned nothing");
    return row;
  });
}

/** Every tag, version then name. */
export async function tagsOf(db: Queryable): Promise<ShapeTag[]> {
  return db.select().from(shapeTags).orderBy(asc(shapeTags.version), asc(shapeTags.name));
}
