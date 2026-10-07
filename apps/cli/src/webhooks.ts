/**
 * `wren [--client <id>] webhooks …`: outbound webhooks (designs/2026-10-07-webhooks-out.md). A
 * client's https URL hears the events it picks, signed; a secret shows once. Without --client,
 * Wren's own. Redeliver goes through Restate, so the ladder and the log are the worker's.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { getClient } from "@wren/core/clients";
import { WEBHOOK_EVENTS } from "@wren/core/webhook-events";
import {
  addSubscription,
  deliveriesOf,
  deliveryOf,
  editSubscription,
  removeSubscription,
  rotateSubscription,
  subscriptionsOf,
  testSubscription,
  WEBHOOKS,
  type WebhooksService,
} from "@wren/core/webhooks";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
const BY = "cli";

export function registerWebhooks(program: Command, withMainDb: WithDb, settings: Settings) {
  const client = () => program.opts<{ client?: string }>().client ?? null;
  /** The client checked to exist, then `fn` on main. */
  const onMain = <T>(fn: (db: Db, client: string | null) => Promise<T>) =>
    withMainDb(async (db) => {
      const id = client();
      if (id) await getClient(db, id);
      return fn(db, id);
    });
  const cmd = program
    .command("webhooks")
    .description("URLs that hear Wren's events, signed (Account > Webhooks)");
  const shown = (secret: string) =>
    console.log(`Secret, shown once: ${secret}\nVerify with any Standard Webhooks library.`);

  cmd
    .command("events")
    .description("What a URL may hear")
    .action(() => {
      for (const [id, says] of Object.entries(WEBHOOK_EVENTS)) console.log(`${id}\t${says}`);
    });

  cmd
    .command("list")
    .description("The URLs and what each hears")
    .action(async () => {
      const subs = await onMain((db, id) => subscriptionsOf(db, id));
      if (!subs.length) console.log("No webhooks.");
      for (const s of subs)
        console.log(
          `${s.id}\t${s.active ? "on" : "off"}\t${s.name}\t${s.url}\t${s.events.join(",")}`,
        );
    });

  cmd
    .command("add <url>")
    .description("A URL that hears events; prints its secret once")
    .requiredOption(
      "--events <names>",
      `comma separated: ${Object.keys(WEBHOOK_EVENTS).join(", ")}`,
    )
    .option("--name <words>", "what it is")
    .action(async (url: string, o: { events: string; name?: string }) => {
      const events = o.events.split(",").map((e) => e.trim()).filter(Boolean);
      const name = o.name ?? new URL(url).host;
      const got = await onMain((db, id) => addSubscription(db, id, { name, url, events }, BY));
      console.log(`Added ${got.subscription.id}.`);
      shown(got.secret);
    });

  cmd
    .command("remove <id>")
    .description("Stop and delete it, with its log")
    .action(async (sub: string) => {
      await onMain((db, id) => removeSubscription(db, id, sub));
      console.log("Removed.");
    });

  for (const [name, active] of [
    ["on", true],
    ["off", false],
  ] as const)
    cmd
      .command(`${name} <id>`)
      .description(active ? "Send it events again" : "Send it nothing; pending tries stop")
      .action(async (sub: string) => {
        await onMain((db, id) => editSubscription(db, id, sub, { active }));
        console.log(active ? "On." : "Off.");
      });

  cmd
    .command("rotate <id>")
    .description("A new secret, shown once; the old one signs too for 24 hours")
    .action(async (sub: string) => {
      const got = await onMain((db, id) => rotateSubscription(db, id, sub));
      shown(got.secret);
    });

  cmd
    .command("test <id>")
    .description("Send a signed webhook.test now, from here; prints the answer")
    .action(async (sub: string) => {
      const got = await onMain((db, id) => testSubscription(db, id, sub));
      console.log(
        `${got.state}\t${got.status ?? "no answer"}\t${got.latencyMs ?? 0} ms` +
          (got.answer?.error ? `\t${got.answer.error}` : ""),
      );
      if (got.response) console.log(got.response);
    });

  cmd
    .command("log [id]")
    .description("The newest deliveries, or one's tries with --delivery")
    .option("--delivery <id>", "one delivery: its body and every try")
    .option("--limit <n>", "how many", "30")
    .action(async (sub: string | undefined, o: { delivery?: string; limit: string }) => {
      if (o.delivery) {
        const id = o.delivery;
        console.log(JSON.stringify(await onMain((db, c) => deliveryOf(db, c, id)), null, 2));
        return;
      }
      const rows = await onMain((db, c) =>
        deliveriesOf(db, c, { ...(sub ? { subscription: sub } : {}), limit: Number(o.limit) }),
      );
      if (!rows.length) console.log("Nothing sent yet.");
      for (const d of rows)
        console.log(
          [d.id, d.at, d.event, d.state, d.attempts, d.status ?? "-", d.error ?? ""].join("\t"),
        );
    });

  cmd
    .command("redeliver <delivery>")
    .description("Send a finished delivery again, on the worker's ladder")
    .action(async (delivery: string) => {
      // The id must be this client's: read it first.
      await onMain((db, c) => deliveryOf(db, c, delivery));
      const got = await clients
        .connect(ingressOf(settings))
        .serviceClient<WebhooksService>(WEBHOOKS)
        .redeliver({ id: delivery });
      console.log(`Sending ${got.id} again.`);
    });
}
