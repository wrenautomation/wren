/** `wren monitor`: the Monitor's loop on the Postgres box. Its mail and rules live in the Inbox app. */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { loadLlmEnv, makeLlm } from "@wren/llm";
import { mail, sortAgain } from "@wren/watch";
import { WATCH_KEY, type Watch } from "@wren/watch/restate";
import type { Command } from "commander";
import { and, eq, isNull, or } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

export function registerWatch(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const loop = () =>
    clients.connect(ingressOf(settings)).objectClient<Watch>({ name: "Watch" }, WATCH_KEY);
  const watch = program
    .command("monitor")
    .alias("watch")
    .description(
      "Monitor (Watch/all) on the Postgres box: new mail every 15 minutes and feeds hourly, sorted on the spine",
    );
  watch.command("status").action(async () => json(await loop().status()));
  watch
    .command("start")
    .description("Every 15 minutes from now on")
    .action(async () => json(await loop().start()));
  watch.command("stop").action(async () => json(await loop().stop()));
  watch
    .command("sync")
    .description("One pass now")
    .action(async () => json(await loop().sync()));
  watch
    .command("sort")
    .description("Triage everything waiting in Needs you again, under today's rules and prompt")
    .option("--model <name>", "the model (prod's WREN_WATCH_LLM)", "cohere")
    .action(async (o: { model: string }) => {
      // Provider keys come from the CLI's key file or the host's env; never logged.
      loadLlmEnv(settings.llmEnvPath, rootDir);
      const llm = makeLlm(o.model, process.env);
      json(
        await withDb(async (db) => {
          const waiting = await db
            .select({ id: mail.id })
            .from(mail)
            .where(and(isNull(mail.doneAt), or(isNull(mail.verdict), eq(mail.verdict, "show"))));
          return sortAgain(
            db,
            llm,
            waiting.map((r) => r.id),
          );
        }),
      );
    });
}
