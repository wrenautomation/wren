/**
 * `wren variants`: vireo's commands (`@wrenautomation/vireo/cli`) on wren's db, collectors,
 * media bucket and audit actor. William judges in the portal (Campaigns › Variants).
 */
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { checkMediaStore } from "@wren/starling-inbound";
import { FPS, getEdit, keepSegments, shortCutsOver } from "@wren/starling-studio";
import { variants } from "@wren/variants";
import type { Source } from "@wrenautomation/vireo";
import { registerCommands } from "@wrenautomation/vireo/cli";
import { type Bucket, s3Bucket } from "@wrenautomation/vireo/media";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export function registerVariants(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  by: string,
): void {
  const v = program
    .command("variants")
    .description(
      "Variants (vireo): batches the agent makes, William's calls and notes, guides, the catalog, live numbers",
    );
  registerCommands(v, {
    by,
    withVireo: (fn) => withDb((db) => fn(variants(db), db)),
    ...(settings.mediaBucket ? { bucket: checked(settings.mediaBucket) } : {}),
    // a batch file's `studio: {edit, format}` → the cut's footage spans
    resolve: async (raw, db) => {
      const x = raw.studio as { edit: number; format?: "long" | "short" } | undefined;
      return x ? { source: await studioSource(db as unknown as Db, x) } : {};
    },
  });
}

/** The bucket, after one check that the laptop's AWS session can write (with the login hint). */
function checked(bucket: string): Bucket {
  const s3 = s3Bucket({ bucket });
  let ok: Promise<void> | null = null;
  return {
    put: async (bytes, ext) => {
      ok ??= checkMediaStore({ bucket });
      await ok;
      return s3.put(bytes, ext);
    },
    url: s3.url,
  };
}

/** A studio edit's kept spans: the long cut, or the Short's tighter one. */
async function studioSource(
  db: Db,
  x: { edit: number; format?: "long" | "short" },
): Promise<Source> {
  const e = await getEdit(db, x.edit);
  const cuts = x.format === "short" ? shortCutsOver(e.cuts, e.shortCuts ?? []) : e.cuts;
  return { ref: `studio:${e.id}`, spans: keepSegments(cuts, e.tracks.main.durationS, FPS) };
}
