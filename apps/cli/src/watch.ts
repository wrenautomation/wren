/** `wren watch`: the Watch's loop on the Postgres box. Its mail and rules live in the Inbox app. */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { WATCH_KEY, type Watch } from "@wren/watch/restate";
import type { Command } from "commander";

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

export function registerWatch(program: Command, settings: Settings): void {
  const loop = () =>
    clients.connect(ingressOf(settings)).objectClient<Watch>({ name: "Watch" }, WATCH_KEY);
  const watch = program
    .command("watch")
    .description("Watch/all on the Postgres box: new mail every 15 minutes, triaged on the spine");
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
}
