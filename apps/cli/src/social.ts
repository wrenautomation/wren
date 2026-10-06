/**
 * `wren social`: SocialWatch's loop on the box (designs/2026-10-06-social-inbox.md). It reads
 * comments, activity and followers on our own accounts; Marketing → Inbox is where they're worked.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { SOCIAL_KEY, type SocialWatch } from "@wren/content/restate";
import type { Command } from "commander";

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

export function registerSocial(program: Command, settings: Settings): void {
  const loop = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<SocialWatch>({ name: "SocialWatch" }, SOCIAL_KEY);
  const social = program
    .command("social")
    .description(
      "SocialWatch/wren: comments, activity and followers on our posts every 30 minutes, 07:00-23:00 New York",
    );
  social.command("status").action(async () => json(await loop().status()));
  social
    .command("start")
    .description("Every 30 minutes from now on")
    .action(async () => json(await loop().start()));
  social.command("stop").action(async () => json(await loop().stop()));
  social
    .command("sync")
    .description("One pass now")
    .action(async () => json(await loop().sync()));
}
