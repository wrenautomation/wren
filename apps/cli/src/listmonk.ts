/**
 * `wren listmonk …` (designs/2026-10-21-esign-and-newsletter.md): the newsletter's lists,
 * subscribers and campaigns live in Listmonk. `setup` writes the settings Wren needs and makes the
 * template; `sync` brings the lists and Wren's consents in line, both ways, now.
 */
import { applySetup, listmonk } from "@wren/channel-email/listmonk";
import { syncAllTopics } from "@wren/channel-email/restate";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** Where Listmonk posts each message: the Restate ingress on the box, which it reaches on loopback. */
const INTAKE = "http://127.0.0.1:8080/ListmonkIntake/post";

function client(settings: Settings) {
  const { listmonkUrl: url, listmonkUser: user, listmonkToken: token } = settings;
  if (!url || !user || !token)
    throw new Error("needs WREN_LISTMONK_URL, WREN_LISTMONK_USER and WREN_LISTMONK_TOKEN");
  return listmonk({ url, user, token });
}

export function registerListmonk(program: Command, withMainDb: WithDb, settings: Settings) {
  const cmd = program
    .command("listmonk")
    .description("the newsletter's lists, subscribers and campaigns, kept in Listmonk");

  cmd
    .command("setup")
    .description("Write the settings Wren needs and make the plain template; safe to run again")
    .option("--root-url <url>", "where Listmonk is reached from outside", settings.listmonkUrl)
    .option("--intake-url <url>", "where Listmonk posts each message", INTAKE)
    .action(async (o: { rootUrl?: string; intakeUrl: string }) => {
      const rootUrl = o.rootUrl ?? settings.listmonkUrl;
      if (!rootUrl) throw new Error("give --root-url, or set WREN_LISTMONK_URL");
      const out = await applySetup(client(settings), { rootUrl, intakeUrl: o.intakeUrl });
      console.log(`Settings written; template "wren plain" is #${out.templateId}.`);
      if (out.unknown.length)
        console.log(`This Listmonk lacks: ${out.unknown.join(", ")}. Left as they were.`);
    });

  cmd
    .command("sync")
    .description("Bring every topic's list and Wren's consents in line, both ways, now")
    .action(async () => {
      const lm = client(settings);
      const { topics } = await withMainDb((db) => syncAllTopics({ db, lm }));
      if (topics.length === 0) return console.log("No email topic has a consent yet.");
      for (const t of topics)
        console.log(
          `${t.topic}: list #${t.listId}; ${t.create} created, ${t.add} added, ${t.remove} taken off, ${t.withdraw} withdrawn in Wren.`,
        );
    });
}
