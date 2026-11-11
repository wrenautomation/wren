/** Approve past the quality gate: every output gets a passing `video check` run on its current hash. */
import { finishRun, openRun } from "@wren/core";
import type { Queryable } from "@wren/db";
import { FLOOR_VERSION, VIDEO_CHECK } from "@wren/starling-studio/bar";
import { hashKey } from "@wren/starling-studio/hash";
import { videoEdits } from "@wren/starling-studio/schema";
import { eq } from "drizzle-orm";
import { approveVideo } from "../../src/video.js";

type Issue = { rank: string; rule: string; at: number; says: string };

/** A check run on `output` of video `id`, on its current hash (one is set when the row has none). */
export async function checkRun(db: Queryable, id: number, output: string, issues: Issue[] = []) {
  const [e] = await db.select().from(videoEdits).where(eq(videoEdits.id, id));
  if (!e) throw new Error(`no video ${id}`);
  let hash = e.files[hashKey(output)];
  if (!hash) {
    hash = `t-${output}`;
    await db
      .update(videoEdits)
      .set({ files: { ...e.files, [hashKey(output)]: hash } })
      .where(eq(videoEdits.id, id));
  }
  const { id: run } = await openRun(db, { command: VIDEO_CHECK, argv: { id, output, by: "t" } });
  await finishRun(db, run, { output, hash, floor: FLOOR_VERSION, issues });
}

export async function approveChecked(
  db: Queryable,
  id: number,
  o: Parameters<typeof approveVideo>[2],
) {
  const [e] = await db.select().from(videoEdits).where(eq(videoEdits.id, id));
  if (e) {
    const shorts = e.shorts.map((_, i) => `short-${i + 1}`);
    for (const out of ["long", "vertical", "square", "portrait", ...shorts])
      await checkRun(db, id, out);
  }
  return approveVideo(db, id, o);
}
