/**
 * `wren reach …`: cold outreach on Reddit and LinkedIn from the keyboard.
 * Reads that need no platform (templates, threads, stats) go straight to
 * Postgres; everything else goes through the ReachDesk / ReachSender /
 * ReachWatch Restate services, so every platform call is journaled and runs
 * on the Mac's desk. Nothing here sends by itself: the ReachSender loop does,
 * and only when WREN_REACH_LIVE lets it.
 */
import { readFile } from "node:fs/promises";
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import type { Db } from "@wren/db";
import {
  CONTACT_STATES,
  type ContactState,
  inviteSettings,
  listAccounts,
  listTemplates,
  listThreads,
  PLATFORMS,
  platformOf,
  policyFrom,
  REACH_SEQUENCES,
  reachStats,
  slotsOf,
  viewOf,
  warmupOf,
} from "@wren/outreach";
import {
  READS_KEY,
  type ReachDeskService,
  type ReachSender,
  type ReachWatchObject,
  type RedditReadsObject,
  SENDER_KEY,
  WATCH_KEY,
} from "@wren/outreach/restate";
import type { Command } from "commander";
import { sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function oneOf<T extends string>(what: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

export function registerReach(program: Command, withDb: WithDb, settings: Settings): Command {
  const ingress = () => clients.connect(ingressOf(settings));
  const desk = () => ingress().serviceClient<ReachDeskService>({ name: "ReachDesk" });
  const sender = () => ingress().objectClient<ReachSender>({ name: "ReachSender" }, SENDER_KEY);
  const watch = () => ingress().objectClient<ReachWatchObject>({ name: "ReachWatch" }, WATCH_KEY);

  const cmd = program
    .command("reach")
    .description(
      "Cold outreach on Reddit and LinkedIn: accounts, finds, sequences, the send loop, inbox",
    );

  const acc = cmd
    .command("accounts")
    .description("The accounts we speak as (autobrowse credential keys, never william@'s own)");
  acc
    .command("list", { isDefault: true })
    .description("Each account, its state, warmup stage and today's caps")
    .action(async () => {
      const now = new Date();
      const rows = await withDb((db) => listAccounts(db));
      if (rows.length === 0)
        console.log(
          "no accounts: `wren reach accounts add reddit reddit@alt` after autobrowse holds the login",
        );
      for (const a of rows) {
        const v = viewOf(a, policyFrom(settings), now);
        console.log(
          `${a.id}\t${a.platform}\t${a.account}\t${a.state}${a.pausedReason ? ` (${a.pausedReason})` : ""}\t${v.standing.stage}\tconnects ${v.standing.caps.connects}/day messages ${v.standing.caps.messages}/day${v.standing.frozen ? `\tFROZEN: ${v.standing.frozen}` : ""}`,
        );
      }
    });
  acc
    .command("add <platform> <account>")
    .description("Point a row at an autobrowse credential (reddit@alt). Starts `warming`")
    .action(async (platform: string, account: string) =>
      json(await desk().addAccount({ platform, account })),
    );
  acc
    .command("activate <id>")
    .description("Let it reach out (its caps still follow the warmup ladder or ramp)")
    .action(async (id: string) => json(await desk().setAccountState({ id, state: "active" })));
  acc
    .command("pause <id>")
    .option("--reason <text>", "why", "paused by hand")
    .action(async (id: string, o: { reason: string }) =>
      json(await desk().setAccountState({ id, state: "paused", reason: o.reason })),
    );
  acc
    .command("retire <id>")
    .action(async (id: string) => json(await desk().setAccountState({ id, state: "retired" })));
  acc
    .command("health <id>")
    .description("Read the account's standing on the platform now (age, karma, suspended)")
    .action(async (id: string) => {
      const v = await desk().health({ id });
      json(v);
      if (v.platform === "reddit" && v.health) json(warmupOf(v.health, new Date()));
    });

  cmd
    .command("find <accountId> <query...>")
    .description(
      "Search as an account and keep who it found as new contacts. Reddit: `r/sub words` or words; LinkedIn: words or `company/<handle> words`",
    )
    .option("--limit <n>", "at most", "25")
    .option("--cursor <c>", "continue a previous page")
    .option("--niche <niche>", "tag the contacts with a niche")
    .action(
      async (
        accountId: string,
        words: string[],
        o: { limit: string; cursor?: string; niche?: string },
      ) => {
        const r = await desk().find({
          accountId,
          query: words.join(" "),
          limit: Number(o.limit),
          cursor: o.cursor ?? null,
          niche: o.niche ?? null,
        });
        for (const p of r.found.prospects)
          console.log(`${p.handle}\t${p.name ?? ""}\t${p.headline ?? ""}\t${p.foundIn}`);
        console.log(
          `${r.added.added} new, ${r.added.known} known · via ${r.found.fetchedWith}${r.found.cursor ? ` · next --cursor ${r.found.cursor}` : ""}`,
        );
      },
    );

  const con = cmd.command("contacts").description("People found or added, by state");
  con
    .command("list", { isDefault: true })
    .option("--platform <p>", PLATFORMS.join(" | "))
    .option("--state <s>", CONTACT_STATES.join(" | "))
    .option("--limit <n>", "at most", "50")
    .action(async (o: { platform?: string; state?: string; limit: string }) => {
      const rows = await desk().contacts({
        platform: o.platform ?? null,
        state: o.state ? oneOf("state", o.state, CONTACT_STATES) : null,
        limit: Number(o.limit),
      });
      for (const c of rows)
        console.log(
          `${c.id}\t${c.platform}\t${c.handle}\t${c.state}\t${c.name ?? ""}\t${c.headline ?? ""}\t${c.foundIn}${c.enrichedAt ? "\tenriched" : ""}`,
        );
    });
  con
    .command("add <platform> <handle>")
    .description("One person by hand (a URL or a handle)")
    .option("--name <name>")
    .option("--niche <niche>")
    .action(async (platform: string, handle: string, o: { name?: string; niche?: string }) =>
      json(
        await desk().addContact({ platform, handle, name: o.name ?? null, niche: o.niche ?? null }),
      ),
    );
  con
    .command("enrich <contactId>")
    .description("Read their page once as an account and keep it")
    .option(
      "--account <id>",
      "read as this account (default: theirs, else the first on the platform)",
    )
    .action(async (contactId: string, o: { account?: string }) =>
      json(await desk().enrich({ contactId: Number(contactId), accountId: o.account ?? null })),
    );

  cmd
    .command("sequences")
    .description("The sequences code declares (steps and gaps)")
    .action(() => {
      for (const s of REACH_SEQUENCES.values())
        console.log(
          `${s.name}\t${s.platform}\t${s.connectFirst ? `invite, then ` : ""}${s.steps.map((st) => `step ${st.step} +${st.afterDays}d`).join(", ")}`,
        );
    });

  const tpl = cmd
    .command("templates")
    .description(
      "Every message you write: sequence steps and the LinkedIn invite note. Empty = never sent",
    );
  tpl.command("list", { isDefault: true }).action(async () => {
    const views = await withDb((db) =>
      listTemplates(db, slotsOf(REACH_SEQUENCES.values()), settings.smsSenderName),
    );
    for (const v of views) {
      console.log(`${v.key}\t${v.purpose}`);
      if (!v.body) {
        console.log(
          `  (empty) fields: ${v.fields.map((f) => `{${f}}`).join(" ")} · at most ${v.maxLength}`,
        );
        continue;
      }
      console.log(
        `  ${v.body.length} chars · ${v.updatedBy} ${v.updatedAt?.slice(0, 10)}\n  ${v.preview}`,
      );
    }
  });
  tpl
    .command("set <key>")
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
    .action(async (key: string) => json(await desk().setTemplate({ key, body: "", by: "cli" })));

  cmd
    .command("enroll <sequence>")
    .description(
      "Give new contacts on the sequence's platform an account and queue their first step",
    )
    .option("--limit <n>", "at most", "20")
    .option("--contact <id...>", "only these contacts")
    .option("--enriched-only", "only contacts whose page was read")
    .option("--niche <niche>", "the niche these belong to (held niches are refused)")
    .action(
      async (
        sequence: string,
        o: { limit: string; contact?: string[]; enrichedOnly?: boolean; niche?: string },
      ) =>
        json(
          await desk().enroll({
            sequence,
            limit: Number(o.limit),
            ...(o.contact ? { contactIds: o.contact.map(Number) } : {}),
            ...(o.enrichedOnly ? { enrichedOnly: true } : {}),
            niche: o.niche ?? null,
          }),
        ),
    );

  const queue = cmd.command("queue").description("ReachSender: the send loop (off until started)");
  queue.command("status").action(async () => json(await sender().status()));
  queue
    .command("start")
    .description("Loop: at most one send per account per tick, inside the window, under the caps")
    .action(async () => json(await sender().start()));
  queue.command("stop").action(async () => json(await sender().stop()));
  queue
    .command("tick")
    .description("One pass now")
    .action(async () => json(await sender().sync()));

  const w = cmd
    .command("watch")
    .description(
      "ReachWatch: replies and comments on the warm cadence, account health every 30 min",
    );
  w.command("status").action(async () => json(await watch().status()));
  w.command("start").action(async () => json(await watch().start()));
  w.command("stop").action(async () => json(await watch().stop()));
  w.command("sync")
    .description("One pass now")
    .action(async () => json(await watch().sync()));

  const inv = cmd
    .command("invites")
    .description(
      "LinkedIn invites from our people: settings in Shop → LinkedIn invites, swept every 6 h by the watch",
    );
  inv
    .command("status", { isDefault: true })
    .description("The settings, and invites by status")
    .action(async () =>
      json(
        await withDb(async (db) => ({
          settings: await inviteSettings(db),
          invites: await db.execute(
            sql`select status, count(*)::int n from reach_invites group by 1 order by 2 desc`,
          ),
        })),
      ),
    );
  inv
    .command("sweep")
    .description("Accepts, stale invites withdrawn, tomorrow's queued: now")
    .action(async () => json(await desk().invites()));

  const reads = () => ingress().objectClient<RedditReadsObject>({ name: "RedditReads" }, READS_KEY);
  const d = cmd
    .command("discovery")
    .description(
      "RedditReads: places monthly, watched places' threads every 2 h, drafts; reads signed out",
    );
  d.command("status").action(async () => json(await reads().status()));
  d.command("start").action(async () => json(await reads().start()));
  d.command("stop").action(async () => json(await reads().stop()));
  d.command("sync")
    .alias("run")
    .description("One pass now; the loop stays as it is")
    .action(async () => json(await reads().sync()));

  cmd
    .command("threads")
    .description("Conversations, newest first")
    .option("--platform <p>", PLATFORMS.join(" | "))
    .option("--state <s>", CONTACT_STATES.join(" | "))
    .option("--unread", "only threads with a reply you have not read")
    .option("--limit <n>", "at most", "50")
    .action(async (o: { platform?: string; state?: string; unread?: boolean; limit: string }) => {
      const rows = await withDb((db) =>
        listThreads(db, {
          platform: o.platform ? platformOf(o.platform) : null,
          state: o.state ? (o.state as ContactState) : null,
          unread: Boolean(o.unread),
          limit: Number(o.limit),
        }),
      );
      for (const t of rows)
        console.log(
          `${t.contact.id}\t${t.contact.platform}\t${t.contact.handle}\t${t.contact.state}\t${t.account ?? ""}\t${t.unread ? "UNREAD\t" : ""}${t.last ? `${t.last.direction === "in" ? "<" : ">"} ${t.last.body.slice(0, 80).replace(/\s+/g, " ")}` : ""}`,
        );
    });
  cmd
    .command("thread <contactId>")
    .description("One conversation; marks it read")
    .action(async (contactId: string) => {
      const t = await desk().thread({ contactId: Number(contactId) });
      await desk().markRead({ contactId: Number(contactId) });
      console.log(
        `${t.contact.platform} ${t.contact.handle} · ${t.contact.state} · ${t.contact.url}`,
      );
      for (const m of t.messages)
        console.log(
          `${(m.sentAt ?? m.createdAt).toString().slice(0, 16)} ${m.direction === "in" ? "<" : ">"} [${m.kind}${m.step ? ` ${m.step}` : ""} ${m.state}] ${m.subject ? `${m.subject}: ` : ""}${m.body}`,
        );
    });
  cmd
    .command("reply <contactId>")
    .description("Queue a message on a thread (out on the next tick, from the contact's account)")
    .requiredOption("--body <text>")
    .option("--subject <text>", "Reddit only")
    .action(async (contactId: string, o: { body: string; subject?: string }) =>
      json(
        await desk().reply({
          contactId: Number(contactId),
          body: o.body,
          subject: o.subject ?? null,
        }),
      ),
    );
  cmd
    .command("stats")
    .option("--platform <p>", PLATFORMS.join(" | "))
    .option("--days <n>", "window", "7")
    .action(async (o: { platform?: string; days: string }) =>
      json(
        await withDb((db) =>
          reachStats(db, {
            platform: o.platform ? platformOf(o.platform) : null,
            days: Number(o.days),
            now: new Date(),
          }),
        ),
      ),
    );
  return cmd;
}
