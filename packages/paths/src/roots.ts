/** The roots a server or the CLI holds, by name (designs/2026-11-12-explorer.md D2). */

import type { Adapter } from "@wren/core/paths";
import type { Db } from "@wren/db";
import { folderTree } from "@wren/folders";
import type { Media } from "@wren/research/canon-console";
import { variants } from "@wren/variants";
import { canonPaths } from "./canon.js";
import { foldersTree } from "./folders-tree.js";
import { vireoPaths } from "./vireo.js";
import { type WeaverSource, weaverServe, weaverTree } from "./weaver-tree.js";

export interface PathsDeps {
  db: Db;
  /** signs Canon's files and Vireo's stills; null: links show as missing */
  media: Media | null;
  /** Canon's GitHub remote, for file links */
  canonRemote: string;
}

/**
 * A fresh adapter per call: its loads are that call's. `viewer`: whose eyes, for Vireo's blind
 * rule; null (the CLI, an agent) hides nothing.
 */
export function serverRoots(d: PathsDeps): Record<string, (viewer: string | null) => Adapter> {
  return {
    canon: () => canonPaths(d.db, d.canonRemote, d.media),
    vireo: (viewer) => vireoPaths(d.db, viewer, d.media),
  };
}

/**
 * The CLI's roots: the server's with no viewer, plus Weaver over `weaver serve` and folders.
 * The portal holds those two in the browser instead (D5).
 */
export function cliRoots(
  d: PathsDeps,
  weaver: WeaverSource = weaverServe(),
): Record<string, Adapter> {
  const tree = folderTree(d.db);
  return {
    ...Object.fromEntries(Object.entries(serverRoots(d)).map(([k, make]) => [k, make(null)])),
    weaver: weaverTree(weaver),
    folders: foldersTree({
      tree: () => tree.tree(),
      subjects: () => variants(d.db).listSubjects(),
      runs: () => weaver.runs(),
    }),
  };
}
