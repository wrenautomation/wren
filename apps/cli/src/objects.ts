/**
 * `wren objects …` (designs/2026-10-20-platform-objects.md): the platform objects behind every
 * post, comment and group. `find` shows what holds a spelling. `link` joins two spellings of one
 * object and moves every row that names the old one. Both take `--client`.
 */
import {
  CANON_PLATFORMS,
  type FoundObject,
  findObject,
  type LinkResult,
  linkRefs,
  type RoleRows,
  roleRowsOf,
} from "@wren/core/objects";
import type { Db } from "@wren/db";
import { Argument, type Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export interface ObjectsDeps {
  withDb: WithDb;
  /** Who ran the command: the actor on the audit events a link causes. */
  by: string;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "-");

export function objectLines(o: FoundObject, rows: RoleRows[]): string[] {
  const lines = [
    `${o.platform} ${o.ref}  ${o.kind}`,
    `  first seen ${day(o.firstSeen)}, last seen ${day(o.lastSeen)}`,
  ];
  if (o.author) lines.push(`  author ${o.author}`);
  if (o.post && o.post !== o.ref) lines.push(`  post ${o.post}`);
  if (o.parent && o.parent !== o.post) lines.push(`  parent ${o.parent}`);
  if (o.url) lines.push(`  url ${o.url}`);
  lines.push(`aliases (${o.aliases.length})`);
  for (const a of o.aliases) lines.push(`  ${a}`);
  lines.push(rows.length ? "named by" : "named by no row");
  for (const r of rows) {
    const more = r.count > r.ids.length ? ", ..." : "";
    lines.push(`  ${r.table}.${r.column}  ${r.count}  id ${r.ids.join(", ")}${more}`);
  }
  return lines;
}

export function linkLines(r: LinkResult): string[] {
  if (!r.dropped) return [`${r.platform}: both spellings already name ${r.kept}; nothing moved`];
  const lines = [`${r.platform}: kept ${r.kept}, dropped ${r.dropped}`];
  for (const m of r.moves)
    lines.push(`  ${m.table}.${m.column}  moved ${m.moved}, folded ${m.folded}`);
  if (!r.moves.length) lines.push("  no row named the dropped ref");
  return lines;
}

export function registerObjects(program: Command, deps: ObjectsDeps): void {
  const objects = program
    .command("objects")
    .description("platform objects: the one record behind each post, comment and group");

  objects
    .command("find <spelling>")
    .description("the object a ref, alias or URL names, its aliases, and the rows that name it")
    .option("--platform <platform>", `limit to one platform (${CANON_PLATFORMS.join(", ")})`)
    .option("--json", "print JSON")
    .action(async (spelling: string, o: { platform?: string; json?: boolean }) => {
      await deps.withDb(async (db) => {
        const found = await findObject(db, spelling, o.platform);
        if (!found) {
          console.error(`no object holds: ${spelling}`);
          process.exitCode = 1;
          return;
        }
        const rows = await roleRowsOf(db, found.platform, [found.ref, ...found.aliases]);
        if (o.json) console.log(JSON.stringify({ object: found, rows }, null, 2));
        else for (const line of objectLines(found, rows)) console.log(line);
      });
    });

  objects
    .command("link")
    .description("join two spellings of one object; every row that names the old one moves")
    .addArgument(new Argument("<platform>").choices(CANON_PLATFORMS))
    .argument("<a>", "one spelling (the kept one, unless b is LinkedIn's API URN)")
    .argument("<b>", "the other spelling")
    .option("--json", "print JSON")
    .action(async (platform: string, a: string, b: string, o: { json?: boolean }) => {
      const r = await deps.withDb((db) => linkRefs(db, platform, a, b, { by: deps.by }));
      if (o.json) console.log(JSON.stringify(r, null, 2));
      else for (const line of linkLines(r)) console.log(line);
    });
}
