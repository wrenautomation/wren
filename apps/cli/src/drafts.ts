/**
 * `wren drafts …`: every draft waiting on William, from a terminal (designs/2026-10-06-content-desk.md,
 * 4), so a Claude Code session reads and rewrites the drafts the console shows. Ids are the
 * Inbox's: draft:<id>, comment:3, thread:t3_x. `set` writes the field the console edits and
 * leaves a runs row, so the item's Ask Claude thread shows it. Nothing sends.
 */
import { DRAFT_TYPES, type DraftType, listWaiting, readDraft, writeDraft } from "@wren/content";
import { draftTurns } from "@wren/core/ask";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { readText } from "./content.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const line = (s: string | null, n = 90) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function registerDrafts(program: Command, withDb: WithDb): void {
  const drafts = program
    .command("drafts")
    .description(
      "Drafts waiting on you (posts, comment answers, thread comments): read and rewrite",
    );

  drafts
    .command("list")
    .description("Drafts waiting on you, newest first")
    .option("--type <type>", `one of ${DRAFT_TYPES.join(", ")}`)
    .option("--limit <n>", "how many", "50")
    .action(async (o: { type?: string; limit: string }) => {
      if (o.type && !(DRAFT_TYPES as readonly string[]).includes(o.type))
        throw new Error(`--type must be one of ${DRAFT_TYPES.join(", ")}`);
      const rows = await withDb((db) =>
        listWaiting(db, {
          ...(o.type ? { type: o.type as DraftType } : {}),
          limit: Number(o.limit),
        }),
      );
      if (!rows.length) console.log("No draft waits on you.");
      for (const r of rows) {
        console.log(`${r.item}  ${r.type.padEnd(7)}  ${line(r.title, 70)}`);
        console.log(`  ${line(r.draft) || "(no draft)"}`);
      }
    });

  drafts
    .command("show <id>")
    .description("The whole draft, what it answers, and its Ask Claude thread")
    .action(async (item: string) => {
      const [d, turns] = await withDb(async (db) => {
        const d = await readDraft(db, item);
        const at = item.indexOf(":");
        return [d, await draftTurns(db, item.slice(0, at), item.slice(at + 1))] as const;
      });
      console.log(`${item}  ${d.what}  ${d.open ? "waiting" : "closed"}  max ${d.max} chars`);
      console.log(`${d.title}\n\nDraft:\n${d.draft ?? "(none yet)"}\n\n${d.context}`);
      for (const t of turns) {
        console.log(`\n${t.at}  ${t.command}  ${t.by ?? ""}  ${t.state}`);
        if (t.message) console.log(`  asked: ${t.message}`);
        if (t.reply) console.log(`  Claude: ${t.reply}`);
        if (t.error) console.log(`  error: ${t.error}`);
      }
    });

  drafts
    .command("set <id>")
    .description("Replace a draft from a file or stdin; it still waits for your click")
    .option("--file <f>", "read the text from this file; else stdin")
    .action(async (item: string, o: { file?: string }) => {
      const text = (await readText(o.file)).trim();
      if (!text) throw new Error("no text: pass --file or pipe it in");
      const out = await withDb((db) =>
        writeDraft(db, item, text, { command: "draft-set", by: "cli" }),
      );
      console.log(`${item}: set (${text.length} chars), was ${out.before?.length ?? 0}`);
    });
}
