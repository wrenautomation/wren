/**
 * The `.email` files into the template store, once (designs/2026-10-06-edits-claude-templates.md,
 * 3): each file a version of its niche's template, live where nothing is. Edits happen in the
 * store from then on; a file that changed later is kept as a version, never made live over a
 * publish.
 */
import { toSource } from "@wren/core/slots";
import { emailRef, importVersion } from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import type { Niche } from "./niche.js";

export interface ImportStats {
  /** Templates read from the files. */
  files: number;
  /** Of them, the ones whose file version is live. */
  live: number;
}

export async function importEmailFiles(
  db: Queryable,
  niches: readonly Niche[],
): Promise<ImportStats> {
  const stats: ImportStats = { files: 0, live: 0 };
  for (const niche of niches)
    for (const [name, tpl] of niche.templates) {
      stats.files++;
      const out = await importVersion(db, emailRef(niche.name, name), toSource(tpl), {
        by: "import:files",
      });
      if (out.live) stats.live++;
    }
  return stats;
}
