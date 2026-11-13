/** The roots a server or the CLI holds, by name (designs/2026-11-12-explorer.md D2). */
import type { Db } from "@wren/db";
import type { Media } from "@wren/research/canon-console";
import { canonPaths } from "./canon.js";
import type { Adapter } from "./index.js";

export interface PathsDeps {
  db: Db;
  media: Media | null;
  /** Canon's GitHub remote, for file links */
  canonRemote: string;
}

/** A fresh adapter per call: its loads are that call's. */
export function serverRoots(d: PathsDeps): Record<string, () => Adapter> {
  return { canon: () => canonPaths(d.db, d.canonRemote, d.media) };
}
