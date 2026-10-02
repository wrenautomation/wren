/**
 * `wren email answers …`: William's yes on every answer to a warm reply. Code
 * proposes (a time and a drafted reply); nothing books or sends until `approve`.
 * The writes go through the worker's `Disposition` object, which holds the
 * calendar and the inboxes.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { openInvites } from "@wren/channel-email";
import { DISPOSITION_KEY, type Disposition } from "@wren/channel-email/restate";
import { ingressOf, type Settings } from "@wren/config";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const indent = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");

export function registerAnswers(email: Command, withDb: WithDb, settings: Settings): Command {
  const disposition = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<Disposition>({ name: "Disposition" }, DISPOSITION_KEY);

  const answers = email
    .command("answers")
    .description("Warm replies waiting on you: list, then approve (books + sends) or drop");

  answers
    .command("list", { isDefault: true })
    .description("Open proposals and replies that need your words, newest first")
    .action(async () => {
      await withDb(async (db) => {
        const rows = await openInvites(db);
        if (rows.length === 0) {
          console.log("nothing waiting");
          return;
        }
        for (const r of rows) {
          const when = r.start
            ? ` · ${r.start.toLocaleString("en-US", { timeZone: r.timeZone ?? "America/Toronto" })}`
            : "";
          console.log(`#${r.id} ${r.state} · ${r.email}${when}${r.detail ? ` · ${r.detail}` : ""}`);
          console.log(
            `  they wrote:\n${indent((r.words || r.snippet || "(no text)").slice(0, 600))}`,
          );
          if (r.draft) console.log(`  draft:\n${indent(r.draft)}`);
          console.log("");
        }
      });
    });

  answers
    .command("approve <id>")
    .description("Book the proposed time (if any) and send the reply in the thread")
    .option("--body <text>", "send your words instead of the draft (required with no draft)")
    .action(async (id: string, opts: { body?: string }) => {
      const out = await disposition().approve({ id: Number(id), body: opts.body ?? null });
      if (!out.ok) {
        console.error(`not done (${out.state}): ${out.reason}`);
        process.exitCode = 1;
        return;
      }
      const booked = out.said ? `booked ${out.said}; ` : "";
      const reply = out.reply?.sent ? "reply sent" : `reply not sent: ${out.reply?.reason ?? "?"}`;
      console.log(`#${id} ${out.state}: ${booked}${reply}`);
    });

  answers
    .command("drop <id>")
    .description("Pass on it: nothing books, nothing sends")
    .action(async (id: string) => {
      const out = await disposition().drop({ id: Number(id) });
      console.log(`#${id} ${out.state}`);
    });

  return answers;
}
