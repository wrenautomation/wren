/**
 * The business map's tree on the server (designs/2026-11-12-explorer.md D4): the newest shape
 * version only, drawn with `metroView`. A graph that cannot be drawn reads as no map.
 */

import type { Adapter } from "@wren/core/paths";
import type { Db } from "@wren/db";
import { newestShape } from "@wren/pipeline/store";
import { drawnOf } from "@wren/pipeline/stored";
import { metroTree } from "./metro-tree.js";

export function metroPaths(db: Db): Adapter {
  return metroTree({
    shape: async () => {
      const row = await newestShape(db);
      if (!row) return null;
      const drawn = drawnOf(row.body);
      return drawn.ok
        ? { body: drawn.metro, version: row.number, at: row.createdAt.toISOString() }
        : null;
    },
  });
}
