/**
 * `wren sms …`: cold SMS from the keyboard. Reads (threads, stats, numbers) go
 * straight to Postgres; writes go through the SmsDesk / SmsSender / SmsWatch
 * Restate services, so every one is journaled. Nothing here sends by itself:
 * the SmsSender loop does, and only when WREN_SMS_LIVE lets a real provider.
 */
import { readFile } from "node:fs/promises";
import * as clients from "@restatedev/restate-sdk-clients";
import {
  CONTACT_BASES,
  type ContactBasis,
  DISPOSITIONS,
  type Disposition,
  formatPhone,
  getThread,
  listTemplates,
  listThreads,
  policyFrom,
  poolToday,
  slotsOf,
  smsStats,
  type ThreadFilter,
  toPhoneE164,
} from "@wren/channel-sms";
import {
  SENDER_KEY,
  type SmsDeskService,
  type SmsSender,
  type SmsWatchObject,
  WATCH_KEY,
} from "@wren/channel-sms/restate";
import { ingressOf, type Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { SMS_SEQUENCES } from "@wren/niches";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function e164Of(phone: string): string {
  const e164 = toPhoneE164(phone);
  if (!e164) throw new Error(`not a US or Canadian number: ${phone}`);
  return e164;
}

function oneOf<T extends string>(what: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

export function registerSms(program: Command, withDb: WithDb, settings: Settings): Command {
  const ingress = () => clients.connect(ingressOf(settings));
  const desk = () => ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
  const sender = () => ingress().objectClient<SmsSender>({ name: "SmsSender" }, SENDER_KEY);
  const watch = () => ingress().objectClient<SmsWatchObject>({ name: "SmsWatch" }, WATCH_KEY);

  const cmd = program
    .command("sms")
    .description("Cold SMS: number pool, contacts, the send loop, inbox, stats");

  const nums = cmd.command("numbers").description("The number pool (at most WREN_SMS_MAX_NUMBERS)");
  nums
    .command("list", { isDefault: true })
    .description("Each number's state, today's cap and sends")
    .action(async () => {
      const pool = await withDb((db) => poolToday(db, policyFrom(settings), new Date()));
      console.log(
        `${pool.day} · provider ${settings.smsProvider} · live ${settings.smsLive} · sent ${pool.sentToday} · remaining ${pool.remaining} of ${settings.smsDailyCap}`,
      );
      if (pool.numbers.length === 0)
        console.log("no numbers: buy them at the provider, then `wren sms numbers sync`");
      for (const n of pool.numbers) {
        const reg =
          n.number.country !== "US"
            ? n.number.country
            : n.number.registeredAt
              ? `US, registered ${n.number.registeredAt.toISOString().slice(0, 10)}`
              : "US, waiting on carrier approval";
        console.log(
          `${formatPhone(n.number.e164)}\t${n.number.state}\t${reg}\t${n.sentToday}/${n.cap} today\tramp from ${n.number.rampStartedOn}${n.number.pausedReason ? `\t${n.number.pausedReason}` : ""}`,
        );
      }
    });
  nums
    .command("sync")
    .description("Mirror the provider's numbers into the pool (never grows past the cap)")
    .action(async () => json(await desk().syncNumbers()));
  nums
    .command("register")
    .description(
      "Attach waiting US numbers to the 10DLC campaign once carriers approve it (SmsWatch does this every 30 min)",
    )
    .action(async () => json(await desk().register()));
  nums
    .command("pause <phone>")
    .option("--reason <text>", "why", "paused by hand")
    .action(async (phone: string, o: { reason: string }) =>
      console.log(
        (await desk().pause({ e164: e164Of(phone), reason: o.reason }))
          ? "paused"
          : "no such active number",
      ),
    );
  nums
    .command("resume <phone>")
    .action(async (phone: string) =>
      console.log(
        (await desk().resume({ e164: e164Of(phone) })) ? "resumed" : "no such paused number",
      ),
    );

  const tpl = cmd
    .command("templates")
    .description(
      "Every text you write: sequence steps and HELP/START/STOP replies. Empty = never sent",
    );
  tpl
    .command("list", { isDefault: true })
    .description("Each one, filled or empty, rendered with a sample name and its segment count")
    .action(async () => {
      const views = await withDb((db) =>
        listTemplates(db, slotsOf(SMS_SEQUENCES.values()), settings.smsSenderName),
      );
      for (const v of views) {
        console.log(`${v.key}\t${v.purpose}`);
        if (!v.body) {
          console.log(
            `  (empty)${v.fields.length ? ` fields: ${v.fields.map((f) => `{${f}}`).join(" ")}` : ""}`,
          );
          continue;
        }
        const seg = v.segments;
        console.log(
          `  ${seg?.parts} part(s) ${seg?.encoding} · ${v.updatedBy} ${v.updatedAt?.slice(0, 10)}\n  ${v.preview}`,
        );
      }
    });
  tpl
    .command("set <key>")
    .description("Fill one. A keyword reply goes live on Telnyx at once")
    .option("--body <text>", "the text")
    .option("--file <path>", "read the text from a file")
    .action(async (key: string, o: { body?: string; file?: string }) => {
      if ((o.body === undefined) === (o.file === undefined))
        throw new Error("give exactly one of --body or --file");
      const body = o.file ? await readFile(o.file, "utf8") : (o.body as string);
      json(await desk().setTemplate({ key, body, by: "cli" }));
    });
  tpl
    .command("clear <key>")
    .description("Empty one: that text stops being sent (a keyword reply falls back to Telnyx's)")
    .action(async (key: string) => json(await desk().setTemplate({ key, body: "", by: "cli" })));

  cmd
    .command("forms")
    .description(
      "Text site applicants who ticked the texts box, now (SmsWatch does this every 30 min)",
    )
    .action(async () => json(await desk().forms()));

  cmd
    .command("reminders")
    .description(
      "Queue day-before texts for calls booked on cal.com, now (SmsWatch does this every 30 min)",
    )
    .action(async () => json(await desk().reminders()));

  cmd
    .command("add <phone>")
    .description("Add a number by hand (someone who asked to be texted, or your own for a test)")
    .requiredOption("--why <text>", "why it may be texted: the consent record")
    .option("--basis <basis>", CONTACT_BASES.join(" | "), "opt_in")
    .option("--niche <niche>", "niche it belongs to")
    .action(async (phone: string, o: { why: string; basis: string; niche?: string }) => {
      const basis = oneOf<ContactBasis>("--basis", o.basis, CONTACT_BASES);
      const r = await desk().addContact({
        phone,
        basis,
        why: o.why,
        ...(o.niche ? { niche: o.niche } : {}),
      });
      console.log(
        `${r.created ? "added" : "already there"}: contact ${r.contactId} ${formatPhone(r.e164)}`,
      );
    });

  cmd
    .command("lift")
    .description(
      "Lift published numbers from crawled pages into contacts (free; held niches skipped)",
    )
    .option("--niche <niche>")
    .option("--limit <n>", "documents to read")
    .action(async (o: { niche?: string; limit?: string }) =>
      json(
        await desk().lift({
          ...(o.niche ? { niche: o.niche } : {}),
          ...(o.limit ? { limit: Number(o.limit) } : {}),
        }),
      ),
    );

  cmd
    .command("enroll")
    .description("Queue step 1 for new contacts (one carrier lookup each, a fraction of a cent)")
    .requiredOption("--sequence <name>", `one of: ${[...SMS_SEQUENCES.keys()].join(", ")}`)
    .requiredOption("--limit <n>", "contacts to enroll")
    .option("--niche <niche>")
    .action(async (o: { sequence: string; limit: string; niche?: string }) => {
      const limit = Number(o.limit);
      if (!(limit > 0)) throw new Error("--limit must be > 0");
      json(
        await desk().enroll({
          sequence: o.sequence,
          limit,
          ...(o.niche ? { niche: o.niche } : {}),
        }),
      );
    });

  const queue = cmd.command("queue").description("SmsSender: the send loop (off until started)");
  queue.command("status").action(async () => json(await sender().status()));
  queue
    .command("start")
    .description("Loop: one text per ready number, then the gap")
    .action(async () => json(await sender().start()));
  queue.command("stop").action(async () => json(await sender().stop()));
  queue
    .command("tick")
    .description("One pass now")
    .action(async () => json(await sender().sync()));

  const w = cmd.command("watch").description("SmsWatch: reply labels + health checks every 30 min");
  w.command("status").action(async () => json(await watch().status()));
  w.command("start").action(async () => json(await watch().start()));
  w.command("stop").action(async () => json(await watch().stop()));
  w.command("sync")
    .description("One pass now")
    .action(async () => json(await watch().sync()));

  cmd
    .command("stats")
    .description("Delivery, reply, interested and opt-out rates with intervals, and spend")
    .option("--days <n>", "window", "30")
    .option("--niche <niche>")
    .option("--json", "raw")
    .action(async (o: { days: string; niche?: string; json?: boolean }) => {
      const since = new Date(Date.now() - Number(o.days) * 86_400_000);
      const s = await withDb((db) => smsStats(db, { since, niche: o.niche ?? null }));
      if (o.json) return json(s);
      console.log(`since ${s.since.slice(0, 10)} · ${s.texted} texted · $${s.costUsd.toFixed(2)}`);
      console.log(`delivered   ${s.delivery.text}`);
      console.log(`replied     ${s.reply.text}`);
      console.log(`interested  ${s.interested.text}`);
      console.log(`opted out   ${s.optOut.text}`);
      if (s.costPerReplyUsd !== null) console.log(`per reply   $${s.costPerReplyUsd.toFixed(2)}`);
      for (const r of s.steps)
        console.log(
          `  ${r.sequence ?? "manual"} #${r.step ?? "-"}: ${r.sent} sent, ${r.delivered} delivered, ${r.failed} failed`,
        );
      console.log(
        `contacts: ${Object.entries(s.contacts)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}`,
      );
    });

  cmd
    .command("threads")
    .description("Inbox, newest first")
    .option("--filter <f>", "all | unread | replied", "all")
    .option("--limit <n>", "rows", "30")
    .action(async (o: { filter: string; limit: string }) => {
      const filter = oneOf<ThreadFilter>("--filter", o.filter, ["all", "unread", "replied"]);
      const rows = await withDb((db) => listThreads(db, { filter, limit: Number(o.limit) }));
      if (rows.length === 0) console.log("no threads");
      for (const t of rows)
        console.log(
          `${t.contactId}\t${t.lastAt.slice(0, 16)}\t${t.display}\t${t.company ?? ""}\t${t.state}${t.unread ? ` · ${t.unread} new` : ""}\t${t.lastDirection === "in" ? "←" : "→"} ${t.lastBody.replace(/\s+/g, " ").slice(0, 60)}`,
        );
    });

  cmd
    .command("thread <contactId>")
    .description("One thread in full")
    .action(async (id: string) => {
      const t = await withDb((db) =>
        getThread(db, Number(id), {
          now: new Date(),
          cap: policyFrom(settings).monthlyPerContact,
        }),
      );
      if (!t) throw new Error(`no sms contact ${id}`);
      const c = t.contact;
      console.log(
        `${c.display} · ${c.company ?? "no company"} · ${c.state} · basis ${c.basis}${c.basisDetail ? ` (${c.basisDetail})` : ""}`,
      );
      if (c.sourceUrl) console.log(`found on ${c.sourceUrl}`);
      if (c.name || c.email) console.log([c.name, c.email].filter(Boolean).join(" · "));
      if (c.fromNumber) console.log(`from ${formatPhone(c.fromNumber)}`);
      console.log(`${t.month.sent}/${t.month.cap} texts in the last 31 days`);
      for (const m of t.messages)
        console.log(
          `${m.at.slice(0, 16)} ${m.direction === "in" ? "←" : "→"} [${m.id} ${m.state}${m.disposition ? ` · ${m.disposition}` : ""}] ${m.body}`,
        );
    });

  cmd
    .command("reply <contactId> <body...>")
    .description("Text a thread from its sticky number (leaves on the next tick)")
    .action(async (id: string, body: string[]) => {
      const r = await desk().reply({ contactId: Number(id), body: body.join(" ") });
      console.log(`queued message ${r.messageId}`);
    });

  cmd
    .command("label <messageId> <disposition>")
    .description(`Label an inbound text: ${DISPOSITIONS.join(" | ")}`)
    .action(async (id: string, d: string) => {
      await desk().label({
        messageId: Number(id),
        disposition: oneOf<Disposition>("disposition", d, DISPOSITIONS),
      });
      console.log("labelled");
    });

  return cmd;
}
