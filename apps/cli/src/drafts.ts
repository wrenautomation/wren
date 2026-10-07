/**
 * `wren drafts …`: every draft waiting on William, from a terminal (designs/2026-10-06-content-desk.md,
 * 4), so a Claude Code session reads and rewrites the drafts the console shows. Ids are the
 * Inbox's: draft:<id>, comment:3, thread:t3_x. `set` writes the field the console edits and
 * leaves a runs row, so the item's Ask Claude thread shows it. `edits` prints how William changed
 * drafts (before and after), the same examples every drafting call reads; `examples` his comment
 * yeses and nos the comment prompts read. `facts` lists and edits
 * what is true about him: the only first-person claims a draft may make. Nothing sends.
 */
import {
  DRAFT_TYPES,
  type DraftType,
  listEdits,
  listWaiting,
  readDraft,
  writeDraft,
} from "@wren/content";
import { draftTurns } from "@wren/core/ask";
import { REJECT_LABELS } from "@wren/core/draft-record";
import { editRecord } from "@wren/core/edits";
import { DEFAULT_FACTS, FACTS_ID, factsRecord, wrenFacts } from "@wren/core/facts";
import { factsOf, factsText } from "@wren/core/facts-list";
import { type Db, serializable, setAuditActor } from "@wren/db";
import { commentExamples, EXAMPLES_MAX } from "@wren/outreach";
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
    .command("edits")
    .description(
      "How you edited drafts: before and after, newest first. Read these before writing one",
    )
    .option("--type <type>", `one of ${DRAFT_TYPES.join(", ")} (dm takes in invites)`)
    .option("--limit <n>", "how many", "5")
    .action(async (o: { type?: string; limit: string }) => {
      if (o.type && !(DRAFT_TYPES as readonly string[]).includes(o.type))
        throw new Error(`--type must be one of ${DRAFT_TYPES.join(", ")}`);
      const rows = await withDb((db) =>
        listEdits(db, {
          ...(o.type ? { type: o.type as DraftType } : {}),
          limit: Number(o.limit),
        }),
      );
      if (!rows.length) console.log("No edits kept yet.");
      for (const e of rows) {
        console.log(`\n${e.record}:${e.id}  ${new Date(e.at).toISOString()}  ${e.by ?? ""}`);
        console.log(`Before:\n${e.before}\nAfter:\n${e.after}`);
      }
    });

  drafts
    .command("examples")
    .description(
      "Your comment decisions the drafting prompts read: sent and turned down, closest to --about first",
    )
    .option("--about <text>", "the post or comment a draft would answer", "")
    .option("--limit <n>", "how many", String(EXAMPLES_MAX))
    .action(async (o: { about: string; limit: string }) => {
      const rows = await withDb((db) =>
        commentExamples(db, { about: o.about, limit: Number(o.limit) }),
      );
      if (!rows.length) console.log("No comment decisions in the last 90 days.");
      for (const e of rows) {
        const why = e.yes
          ? "sent"
          : `turned down${e.reason ? ` (${REJECT_LABELS[e.reason]})` : ""}${e.note ? `: ${e.note}` : ""}`;
        console.log(`\n${e.item}  ${e.at.toISOString()}  ${why}`);
        console.log(`  answering: ${line(e.about)}`);
        console.log(`  draft: ${line(e.text, 300)}`);
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

  const facts = drafts
    .command("facts")
    .description(
      "What is true about you: drafts may claim only these (Marketing → Facts). Public repo: no amounts, no client names",
    );
  // Through the edits path, as the portal saves: checked, and a History line with Undo there.
  const save = (next: string[]) =>
    withDb((db) =>
      serializable(db, async (tx) => {
        await setAuditActor(tx, "cli");
        const out = await editRecord(tx, factsRecord, FACTS_ID, {
          patch: { facts: factsText(next) },
          by: "cli",
        });
        return factsOf(String(out.values.facts ?? ""));
      }),
    );
  const print = (list: readonly string[]) =>
    list.forEach((f, i) => {
      console.log(`${i + 1}\t${f}`);
    });
  facts
    .command("list", { isDefault: true })
    .description("Each fact, numbered")
    .action(async () => print(await withDb((db) => wrenFacts(db))));
  facts
    .command("add <fact...>")
    .description("Add one fact, in your words")
    .action(async (words: string[]) => {
      const fact = words.join(" ").trim();
      print(await save([...(await withDb((db) => wrenFacts(db))), fact]));
    });
  facts
    .command("remove <n>")
    .description("Remove fact n (from list)")
    .action(async (n: string) => {
      const list = await withDb((db) => wrenFacts(db));
      const i = Number(n) - 1;
      if (!Number.isInteger(i) || !list[i]) throw new Error(`no fact ${n}: 1 to ${list.length}`);
      print(await save(list.filter((_, j) => j !== i)));
    });
  facts
    .command("reset")
    .description("Back to the default facts")
    .action(async () => print(await save([...DEFAULT_FACTS])));
}
