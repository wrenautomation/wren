/**
 * `wren dossier …`: everything we know about a company and its people, read
 * back from what the runners wrote (findings, enrichments, checks, emails).
 * `show` prints one firm; `export` writes a niche as JSON lines, a page at a
 * time. Always the main database. Read only.
 */
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { emailFacts } from "@wren/channel-email";
import type { Db } from "@wren/db";
import {
  type Dossier,
  dossiers,
  dossierText,
  findCompanyIds,
  nicheCompanyIds,
  withFacts,
} from "@wren/research/dossier";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const PAGE = 200;

/** Research facts plus the email channel's, for these companies. */
async function fullDossiers(db: Db, ids: readonly number[]): Promise<Dossier[]> {
  const list = await dossiers(db, ids);
  const more = await emailFacts(
    db,
    list.map((d) => d.company.id),
    list.flatMap((d) => d.people.map((p) => p.id)),
  );
  return withFacts(list, more);
}

export function registerDossier(program: Command, withDb: WithDb, rootDir: string): void {
  const dossier = program
    .command("dossier")
    .description("everything we know about a company and its people, with sources");

  dossier
    .command("show <company>")
    .description("one firm by id, domain or a name fragment (up to 5 matches)")
    .option("--json", "print JSON instead of lines")
    .action((query: string, opts: { json?: boolean }) =>
      withDb(async (db) => {
        const list = await fullDossiers(db, await findCompanyIds(db, query, 5));
        if (!list.length) {
          console.log(`no company matches "${query}"`);
          return;
        }
        console.log(opts.json ? JSON.stringify(list, null, 2) : list.map(dossierText).join("\n\n"));
      }),
    );

  dossier
    .command("export")
    .description("a niche's dossiers as JSON lines, one company per line")
    .requiredOption("--niche <niche>", "which niche")
    .option("--limit <n>", "at most this many companies", (v) => Number.parseInt(v, 10))
    .option("--out <file>", "write here instead of stdout")
    .action((opts: { niche: string; limit?: number; out?: string }) =>
      withDb(async (db) => {
        const out = opts.out ? createWriteStream(resolve(rootDir, opts.out)) : process.stdout;
        const cap = opts.limit ?? Number.POSITIVE_INFINITY;
        let written = 0;
        let afterId = 0;
        while (written < cap) {
          const ids = await nicheCompanyIds(db, opts.niche, Math.min(PAGE, cap - written), afterId);
          if (!ids.length) break;
          for (const d of await fullDossiers(db, ids)) out.write(`${JSON.stringify(d)}\n`);
          written += ids.length;
          afterId = ids[ids.length - 1] ?? afterId;
        }
        if (opts.out) {
          await new Promise<void>((done) => (out as NodeJS.WritableStream).end(done));
          console.error(`wrote ${written} dossiers to ${opts.out}`);
        }
      }),
    );
}
