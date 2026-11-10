/**
 * `wren variants`: vireo's commands (`@wrenautomation/vireo/cli`) on wren's db, collectors,
 * media bucket and audit actor. William judges in the portal (Variants).
 */
import { resolve } from "node:path";
import { renderLambda } from "@wren/browser";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { checkMediaStore } from "@wren/starling-inbound";
import { FPS, getEdit, keepSegments, shortCutsOver } from "@wren/starling-studio";
import { variants } from "@wren/variants";
import { promoteVerdicts } from "@wren/variants/knowledge";
import { contentTypesIn, pushCanon, readPlaybook } from "@wren/variants/playbook";
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
  rootDir: string,
): void {
  const canon = resolve(rootDir, settings.canonDir);
  const v = program
    .command("variants")
    .description(
      "Variants (vireo): batches the agent makes, William's calls and notes, guides, the catalog, live numbers",
    );
  registerCommands(v, {
    by,
    // the playbook's types; no Canon checkout (prod): any text
    get contentTypes() {
      return contentTypesIn(canon);
    },
    withVireo: (fn) => withDb((db) => fn(variants(db), db)),
    ...(settings.mediaBucket ? { bucket: checked(settings.mediaBucket) } : {}),
    // a live page with no poster: the render Lambda shoots one (vireo `posters`)
    shoot: (url) => renderLambda(settings.renderFunction ?? "wren-prod-render").shot(url),
    // a batch file's `studio: {edit, format}` → the cut's footage spans
    resolve: async (raw, db) => {
      const x = raw.studio as { edit: number; format?: "long" | "short" } | undefined;
      return x ? { source: await studioSource(db as unknown as Db, x) } : {};
    },
  });
  v.command("promote")
    .description(
      "kept samples and locked tips as verdict records in Canon; un-keep, unlock or drop retires. One commit; a rerun is a no-op",
    )
    .option("--why <text>", "why, on the commit", "Vireo's kept samples and locked tips")
    .action(async (o: { why: string }) =>
      console.log(
        JSON.stringify(
          await withDb((db) =>
            promoteVerdicts(db, canon, {
              by: "wren-variants",
              why: o.why,
            }),
          ),
          null,
          2,
        ),
      ),
    );
}

/** `wren playbook <type>`: promote first, so a lock or a keep is in what the agent reads. */
export function registerPlaybook(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  program
    .command("playbook <type>")
    .description(
      "Every rule for a content type: the playbook guide, the type's rule sets, proven lines with their numbers, top kept samples (Canon)",
    )
    .option("--json", "{type, proven, sets, references}")
    .option("--offline", "skip promote; print the last state")
    .action(async (type: string, o: { json?: boolean; offline?: boolean }) => {
      const canon = resolve(rootDir, settings.canonDir);
      let stale: string | null = o.offline ? "offline" : null;
      let untyped: string[] = [];
      if (!o.offline)
        try {
          const r = await withDb((db) =>
            promoteVerdicts(db, canon, { by: "wren-playbook", why: `wren playbook ${type}` }),
          );
          untyped = r.untyped;
          if (r.commit) {
            const p = pushCanon(canon);
            if (!p.pushed)
              stale = `promoted ${r.commit.slice(0, 7)}, push failed: ${p.error ?? "lint"}`;
          }
        } catch (e) {
          stale = `promote failed: ${(e as Error).message}`;
        }
      const book = readPlaybook(canon, type);
      if (o.json)
        console.log(JSON.stringify({ ...book, text: undefined, stale, untyped }, null, 2));
      else {
        if (stale) console.error(`last state (${stale})`);
        if (untyped.length)
          console.error(
            `no content type, so their tips and keeps reach nothing: ${untyped.join(", ")} (wren variants type <subject> <type>)`,
          );
        process.stdout.write(book.text);
      }
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
