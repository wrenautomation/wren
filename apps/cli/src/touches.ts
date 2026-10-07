/**
 * `wren touches …` (designs/2026-10-07-touches.md): every social touch with someone, newest
 * first. `wren touches <who>` takes a person id, `lead:<id>`, a profile URL, `u/name`, a LinkedIn
 * URN or `<platform>:<handle>`. `backfill` folds the source tables in; `link` ties a handle to a
 * person by hand.
 */
import { backfillTouches } from "@wren/content";
import {
  answerOf,
  linkHandle,
  lookupTouches,
  parseHandle,
  platformLabel,
  touchText,
} from "@wren/core/touches";
import type { Db } from "@wren/db";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const idOf = (v: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new InvalidArgumentError("not an id");
  return n;
};

export function registerTouches(program: Command, withDb: WithDb): void {
  const touches = program
    .command("touches")
    .description("every social touch with a person: follows, invites, comments, replies, DMs")
    .argument("[who]", "person id, lead:<id>, profile URL, u/name, x:@name, or a LinkedIn URN")
    .option("--limit <n>", "at most this many", (v) => idOf(v), 100)
    .option("--json", "print JSON")
    .action(async (who: string | undefined, o: { limit: number; json?: boolean }) => {
      if (!who) {
        touches.help();
        return;
      }
      await withDb(async (db) => {
        const r = await lookupTouches(db, who, o.limit);
        if (!r) {
          console.error(`not a person, lead or handle: ${who}`);
          process.exitCode = 1;
          return;
        }
        if (o.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        const now = new Date();
        const linked = r.handles
          .map((h) => `${platformLabel(h.platform)} ${h.handle}${h.personId ? "" : " (no person)"}`)
          .join(", ");
        console.log(`${r.who}${linked ? `: ${linked}` : ""}`);
        if (!r.touches.length) console.log("no touches");
        for (const t of r.touches) {
          const open = t.direction === "ours" && !t.response && answerOf(t, now) === null;
          console.log(
            `${t.at.toISOString().slice(0, 16).replace("T", " ")}  ${platformLabel(t.platform).padEnd(9)} ${t.direction.padEnd(6)} ${t.kind.padEnd(7)} ${touchText(t, now)}${open ? " (waiting)" : ""}${t.url ? `  ${t.url}` : ""}`,
          );
        }
      });
    });

  touches
    .command("backfill")
    .description("fold every source table into touches; safe to run again")
    .option("--dry-run", "count the source rows; write nothing")
    .action(async (o: { dryRun?: boolean }) => {
      const r = await withDb((db) => backfillTouches(db, { dryRun: !!o.dryRun }));
      const verb = o.dryRun ? "would read" : "wrote";
      console.log(
        `${verb}: ${r.messages} DMs and invites, ${r.comments} comments, ${r.answers} answers, ${r.threads} Reddit comments, ${r.posts} LinkedIn comments, ${r.activity} follows and reactions`,
      );
      if (!o.dryRun) console.log(`${r.responses} answers marked, ${r.linked} handles newly linked`);
    });

  touches
    .command("link <handle> <person>")
    .description("tie a handle (URL, u/name, x:@name) to a person id, and a lead with --lead")
    .option("--lead <id>", "the lead too", (v) => idOf(v))
    .action(async (handle: string, person: string, o: { lead?: number }) => {
      const ref = parseHandle(handle);
      if (!ref) throw new InvalidArgumentError(`not a handle: ${handle}`);
      const h = await withDb((db) =>
        linkHandle(db, ref, { personId: idOf(person), leadId: o.lead ?? null }),
      );
      console.log(`${platformLabel(h.platform)} ${h.handle} is person ${h.personId}`);
    });
}
