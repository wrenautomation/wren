/**
 * The shape's git mirror (designs/2026-10-19-business-map.md, "History like git"): every version
 * lands as one commit of `shapes/<workspace>.yaml` in a private repo, so git log and git blame
 * read the shape's history. The database stays the source of truth; the mirror is a copy that
 * catches up. A failed mirror never fails a save: the next run commits what is missing, oldest first.
 */
import type { GithubFiles } from "@wren/core/github";
import { atomic, type Queryable } from "@wren/db";
import { asc, eq, notExists } from "drizzle-orm";
import { shapeMirrors, shapeVersions } from "./schema.js";
import { exportShape } from "./shape-file.js";
import { lock } from "./store.js";

/** Wren's own workspace in the repo's file names. */
export const WREN_WORKSPACE = "wren";

export interface MirrorCommit {
  version: number;
  sha: string;
}

/** What a run did: it was off, or it committed some versions and may have stopped at a failure. */
export type MirrorResult =
  | { off: true }
  | { off?: undefined; committed: MirrorCommit[]; failed?: string };

export const mirrorPath = (workspace: string) => `shapes/${workspace}.yaml`;

/** A commit's subject line stays one line, whatever the note holds. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const told = new WeakSet<(line: string) => void>();

/**
 * Commit each version that has no `shape_mirrors` row, oldest first, to `files`. With `files`
 * null the mirror is off: one info line per process (per `log`), nothing else. Holds one
 * advisory lock for the run, so two runs never interleave and git log keeps number order. It
 * stops at the first failure so a later version never lands before an earlier one, writes a row
 * only for a commit that landed, and never throws.
 */
export async function mirrorShapes(
  db: Queryable,
  o: {
    files: GithubFiles | null;
    repo: string;
    workspace: string;
    log?: (line: string) => void;
  },
): Promise<MirrorResult> {
  const log = o.log ?? ((line: string) => console.info(line));
  if (!o.files) {
    if (!told.has(log)) {
      told.add(log);
      log("shape mirror off: WREN_SHAPES_GITHUB_TOKEN is not set");
    }
    return { off: true };
  }
  const files = o.files;
  const path = mirrorPath(o.workspace);
  try {
    return await atomic(db, async (tx) => {
      await lock(tx, "shape mirror");
      const todo = await tx
        .select()
        .from(shapeVersions)
        .where(
          notExists(
            tx.select().from(shapeMirrors).where(eq(shapeMirrors.version, shapeVersions.number)),
          ),
        )
        .orderBy(asc(shapeVersions.number));
      const committed: MirrorCommit[] = [];
      for (const v of todo) {
        try {
          const message = `shape ${o.workspace} v${v.number}: ${oneLine(v.note)}\n\nAuthor: ${v.createdBy}`;
          // Null: the file already held this text (a commit that landed before its row did).
          const sha =
            (await files.write(path, exportShape(v.body), message)) ??
            (await files.lastCommit(path));
          if (!sha) throw new Error(`no commit found for ${path}`);
          await tx
            .insert(shapeMirrors)
            .values({ version: v.number, repo: o.repo, path, sha })
            .onConflictDoNothing();
          committed.push({ version: v.number, sha });
        } catch (e) {
          const failed = `v${v.number}: ${e instanceof Error ? e.message : String(e)}`;
          console.warn(`shape mirror (${o.workspace}) stopped at ${failed}`);
          return { committed, failed };
        }
      }
      return { committed };
    });
  } catch (e) {
    const failed = e instanceof Error ? e.message : String(e);
    console.warn(`shape mirror (${o.workspace}) failed: ${failed}`);
    return { committed: [], failed };
  }
}
