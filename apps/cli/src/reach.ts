/**
 * `wren reach …`: cold outreach on Reddit and LinkedIn, and comments on others' posts, from the keyboard.
 * Reads that need no platform (templates, threads, stats) go straight to
 * Postgres; everything else goes through the ReachDesk / ReachSender /
 * ReachWatch Restate services, so every platform call is journaled and runs
 * on the Mac's desk. Nothing here sends by itself: the ReachSender loop does,
 * and only when WREN_REACH_LIVE lets it.
 */
import { readFile } from "node:fs/promises";
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { settingsFor, setWrenSettings } from "@wren/core/clients";
import type { Proof } from "@wren/core/content";
import { PASS_REASONS, type PassReason } from "@wren/core/pass-reasons";
import { REJECT_REASONS } from "@wren/core/reject-reasons";
import { atomic, type Db, setAuditActor } from "@wren/db";
import {
  backfillFromProofs,
  COMMENTS_COMPONENTS,
  COMMENTS_SETTINGS,
  CONTACT_STATES,
  type ContactState,
  clearGate,
  commentsSettings,
  discoverySettingsSchema,
  gateList,
  INVITES_COMPONENT,
  inviteSettings,
  invitesSettingsSchema,
  isProofItem,
  learnText,
  listAccounts,
  listPosts,
  listTemplates,
  listThreads,
  PLATFORMS,
  platformOf,
  policyFrom,
  proofsSince,
  proposedInvites,
  REACH_POST_PLATFORMS,
  REACH_SEQUENCES,
  type ReachPostPlatform,
  reachStats,
  sentSince,
  setNeed,
  slotsOf,
  topicYields,
  viewOf,
  warmupOf,
} from "@wren/outreach";
import {
  type CommentProofsService,
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
import { longCallKey, pollOutput } from "./poll.js";

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
  const deskSend = () => ingress().serviceSendClient<ReachDeskService>({ name: "ReachDesk" });
  /** A desk call longer than one HTTP request may wait: sent, then its output polled. */
  const long = async <T>(
    what: string,
    send: (
      d: ReturnType<typeof deskSend>,
      idempotencyKey: string,
    ) => Promise<{ invocationId: string }>,
  ): Promise<T> => {
    const sent = await send(deskSend(), longCallKey(what));
    console.error(`sent ${what}: ${sent.invocationId}; waiting for it`);
    const { url, headers } = ingressOf(settings);
    return pollOutput<T>(sent.invocationId, {
      url,
      ...(headers ? { headers } : {}),
      log: (l) => console.error(l),
    });
  };
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
    .option("--client <id>", "a client's own logins (rows in its database)")
    .action(async (o: { client?: string }) => {
      const now = new Date();
      if (o.client) {
        for (const v of await desk().accounts({ client: o.client }))
          console.log(`${v.id}\t${v.platform}\t${v.account}\t${v.state}\t${v.standing.stage}`);
        return;
      }
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
  const forClient = "a client's login (an admin's: its sends still wait on `clients set --live`)";
  acc
    .command("activate <id>")
    .description("Let it reach out (its caps still follow the warmup ladder or ramp)")
    .option("--client <id>", forClient)
    .action(async (id: string, o: { client?: string }) =>
      json(await desk().setAccountState({ id, state: "active", client: o.client ?? null })),
    );
  acc
    .command("pause <id>")
    .option("--reason <text>", "why", "paused by hand")
    .option("--client <id>", forClient)
    .action(async (id: string, o: { reason: string; client?: string }) =>
      json(
        await desk().setAccountState({
          id,
          state: "paused",
          reason: o.reason,
          client: o.client ?? null,
        }),
      ),
    );
  acc
    .command("retire <id>")
    .option("--client <id>", forClient)
    .action(async (id: string, o: { client?: string }) =>
      json(await desk().setAccountState({ id, state: "retired", client: o.client ?? null })),
    );
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
    .command("set")
    .description(
      "Change the settings (as Shop → LinkedIn invites does); a field left out keeps its value",
    )
    .option("--account <key>", "the autobrowse credential that sends (linkedin@wren); empty = off")
    .option("--per-day <n>", "invites a day at most (the ramp may allow fewer)")
    .option("--niches <list>", "comma separated; empty = every niche not held")
    .option("--titles <list>", "comma separated words a title must hold; empty = any")
    .option(
      "--decision-makers <on|off>",
      "only founders, owners, C-level, partners, VPs, heads, directors",
    )
    .option("--min-employees <n>", "firms with at least this many people; 0 = any size")
    .option("--known-size-only <on|off>", "leave out firms whose size we don't know")
    .option("--engaged <on|off>", "people who engaged with us on LinkedIn first, past the filters")
    .option("--withdraw-after-days <n>")
    .action(
      async (o: {
        account?: string;
        perDay?: string;
        niches?: string;
        titles?: string;
        decisionMakers?: string;
        minEmployees?: string;
        knownSizeOnly?: string;
        engaged?: string;
        withdrawAfterDays?: string;
      }) => {
        const flag = (v: string) => {
          if (!["on", "off", "true", "false"].includes(v)) throw new Error(`on or off, not ${v}`);
          return v === "on" || v === "true";
        };
        const list = (v: string) =>
          v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        const change = {
          ...(o.account !== undefined && { account: o.account }),
          ...(o.perDay !== undefined && { perDay: Number(o.perDay) }),
          ...(o.niches !== undefined && { niches: list(o.niches) }),
          ...(o.titles !== undefined && { titles: list(o.titles) }),
          ...(o.decisionMakers !== undefined && { decisionMakers: flag(o.decisionMakers) }),
          ...(o.minEmployees !== undefined && { minEmployees: Number(o.minEmployees) }),
          ...(o.knownSizeOnly !== undefined && { knownSizeOnly: flag(o.knownSizeOnly) }),
          ...(o.engaged !== undefined && { engaged: flag(o.engaged) }),
          ...(o.withdrawAfterDays !== undefined && {
            withdrawAfterDays: Number(o.withdrawAfterDays),
          }),
        };
        json(
          await withDb(async (db) => {
            const next = invitesSettingsSchema.parse({ ...(await inviteSettings(db)), ...change });
            await atomic(db, async (tx) => {
              await setAuditActor(tx, "cli");
              await setWrenSettings(tx, INVITES_COMPONENT, next, "cli");
            });
            return next;
          }),
        );
      },
    );
  inv
    .command("sweep")
    .description("Accepts, stale invites withdrawn, tomorrow's proposed for your yes: now")
    .action(async () => json(await desk().invites()));
  inv
    .command("proposed")
    .description("Invites waiting on your yes (To approve), with why each was picked")
    .action(() =>
      withDb(async (db) => {
        const rows = await proposedInvites(db);
        for (const r of rows) console.log(`${r.id}\t${r.name ?? r.handle}\t${r.fit?.why ?? ""}`);
        if (rows.length === 0) console.log("none waiting");
      }),
    );
  inv
    .command("approve <ids...>")
    .description("Your yes: they send on the next ticks, under the day's cap and ramp")
    .action(async (ids: string[]) => json(await desk().approveInvites({ ids: ids.map(Number) })));
  inv
    .command("skip <ids...>")
    .description("Your no: skipped, never proposed again")
    .action(async (ids: string[]) => json(await desk().skipInvites({ ids: ids.map(Number) })));

  const passes = cmd
    .command("passes")
    .description("People you passed on: nothing of theirs is proposed again")
    .action(async () => json(await desk().passes()));
  passes
    .command("add <ids...>")
    .description("Pass on the people behind Engage ids (comment:4, onpost:9, thread:t3_x, dm:3)")
    .requiredOption("--reason <reason>", PASS_REASONS.join(", "))
    .option("--note <text>", "why, in a line")
    .action(async (ids: string[], o: { reason: PassReason; note?: string }) =>
      json(await desk().passOn({ ids, reason: o.reason, note: o.note ?? null })),
    );
  passes
    .command("lift <platform> <handle>")
    .description("They can be proposed again")
    .action(async (platform: string, handle: string) =>
      json(await desk().liftPass({ platform, handle })),
    );

  const posts = cmd
    .command("posts")
    .description(
      "Comments on others' posts (LinkedIn, X, Instagram): read daily by the watch as each platform's comments account, drafted for your yes in To approve",
    );
  const postPlatformOf = (v: string | undefined): ReachPostPlatform => {
    const p = (v ?? "linkedin").toLowerCase();
    if (!(REACH_POST_PLATFORMS as readonly string[]).includes(p))
      throw new Error(`--platform is one of ${REACH_POST_PLATFORMS.join(", ")}`);
    return p as ReachPostPlatform;
  };
  posts
    .command("status", { isDefault: true })
    .description("One platform's settings, posts by state, and each search word's yield lately")
    .option("--platform <p>", "linkedin, x or instagram", "linkedin")
    .action(async (o: { platform?: string }) => {
      const platform = postPlatformOf(o.platform);
      json(
        await withDb(async (db) => {
          const settings = await commentsSettings(db, platform);
          return {
            platform,
            settings,
            posts: await db.execute(
              sql`select state, count(*)::int n from reach_posts where platform = ${platform} group by 1 order by 2 desc`,
            ),
            topics: await topicYields(db, { platform, minFit: settings.minFit, now: new Date() }),
          };
        }),
      );
    });
  posts
    .command("set")
    .description("Change one platform's settings; a field left out keeps its value")
    .option("--platform <p>", "linkedin, x or instagram", "linkedin")
    .option(
      "--account <key>",
      "the autobrowse login that reads (linkedin@wren, x@wren); empty = off",
    )
    .option("--per-day <n>", "comments queued for your yes a day at most")
    .option("--topics <list>", "comma separated search words")
    .option("--pages <list>", "comma separated LinkedIn company handles or X/Instagram usernames")
    .option("--people <on|off>", "also read people who accepted our invites or engaged")
    .option("--author-title <words>", "LinkedIn search: authors whose title has these words")
    .option("--like <on|off>", "like the post with the comment")
    .option("--follow <on|off>", "follow the author with the comment")
    .option("--max-age-hours <n>", "posts older than this are left")
    .option("--min-fit <n>", "the rank (0 to 100) a post needs for a draft")
    .option("--audience <list>", "comma separated word starts a post must have (recruit,staffing)")
    .option("--about <text>", "who the buyers are; the model writes new search words from it")
    .option("--new-topics <n>", "search words the model adds a pass (0 = only --topics)")
    .option("--auto-send <on|off>", "each pass's drafts take spaced send slots without your yes")
    .action(
      async (o: {
        platform?: string;
        account?: string;
        perDay?: string;
        topics?: string;
        pages?: string;
        people?: string;
        authorTitle?: string;
        like?: string;
        follow?: string;
        maxAgeHours?: string;
        minFit?: string;
        audience?: string;
        about?: string;
        newTopics?: string;
        autoSend?: string;
      }) => {
        const list = (v: string) =>
          v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        const platform = postPlatformOf(o.platform);
        for (const v of [o.people, o.like, o.follow, o.autoSend])
          if (v !== undefined && !["on", "off"].includes(v)) throw new Error(`on or off, not ${v}`);
        const change = {
          ...(o.account !== undefined && { account: o.account }),
          ...(o.perDay !== undefined && { perDay: Number(o.perDay) }),
          ...(o.topics !== undefined && { topics: list(o.topics) }),
          ...(o.pages !== undefined && { pages: list(o.pages) }),
          ...(o.people !== undefined && { people: o.people === "on" }),
          ...(o.authorTitle !== undefined && { authorTitle: o.authorTitle }),
          ...(o.like !== undefined && { like: o.like === "on" }),
          ...(o.follow !== undefined && { follow: o.follow === "on" }),
          ...(o.maxAgeHours !== undefined && { maxAgeHours: Number(o.maxAgeHours) }),
          ...(o.minFit !== undefined && { minFit: Number(o.minFit) }),
          ...(o.audience !== undefined && { audience: list(o.audience) }),
          ...(o.about !== undefined && { about: o.about }),
          ...(o.newTopics !== undefined && { newTopics: Number(o.newTopics) }),
          ...(o.autoSend !== undefined && { autoSend: o.autoSend === "on" }),
        };
        json(
          await withDb(async (db) => {
            const next = COMMENTS_SETTINGS[platform].parse({
              ...(await commentsSettings(db, platform)),
              ...change,
            });
            await atomic(db, async (tx) => {
              await setAuditActor(tx, "cli");
              await setWrenSettings(tx, COMMENTS_COMPONENTS[platform], next, "cli");
            });
            return next;
          }),
        );
      },
    );
  posts
    .command("run")
    .description("Read, rank and draft up to the day's cap now; nothing posts. Waits for the pass")
    .action(async () =>
      json(
        await long("posts run", (d, key) =>
          d.postsNow(clients.rpc.sendOpts({ idempotencyKey: key })),
        ),
      ),
    );
  posts
    .command("redraft <ids...>")
    .description(
      "Write queued drafts again from the posts kept at read time (no platform read): ranked again, facts-guarded, replaced in To approve; one now off target leaves it",
    )
    .action(async (ids: string[]) =>
      json(
        await long("posts redraft", (d, key) =>
          d.redraftPosts({ ids: ids.map(Number) }, clients.rpc.sendOpts({ idempotencyKey: key })),
        ),
      ),
    );
  posts
    .command("list")
    .description("Posts, newest first")
    .option("--state <s>", "found | queued | commented | skipped | dropped")
    .option("--limit <n>")
    .action((o: { state?: string; limit?: string }) =>
      withDb(async (db) => {
        const rows = await listPosts(db, {
          ...(o.state ? { state: o.state } : {}),
          ...(o.limit ? { limit: Number(o.limit) } : {}),
        });
        for (const r of rows)
          console.log(
            `${r.id}\t${r.state}\t${r.fit ?? ""}\t${r.author}\t${r.url}\n\t${r.why ?? ""}${r.draft ? `\n\t> ${r.draft.replace(/\n/g, " ")}` : ""}`,
          );
        if (rows.length === 0) console.log("none");
      }),
    );
  posts
    .command("comment <id>")
    .description("Your yes: post the draft (or --body) under their post from Wren's account")
    .option("--body <text>")
    .action(async (id: string, o: { body?: string }) =>
      json(await desk().commentPost({ id: Number(id), ...(o.body ? { body: o.body } : {}) })),
    );
  for (const act of ["like", "follow"] as const)
    posts
      .command(`${act} <id>`)
      .description(
        act === "like"
          ? "Like their post without commenting, as the comments account"
          : "Follow the post's author without commenting, as the comments account",
      )
      .action(async (id: string) => json(await desk().actOnPost({ id: Number(id), act })));
  posts
    .command("skip <ids...>")
    .description("Your no; --reason and --note are kept with the draft in the training record")
    .option("--by <who>", "who said no (an email); default console")
    .option("--reason <r>", REJECT_REASONS.join(" | "))
    .option("--note <text>", "the rest of why")
    .action(async (ids: string[], o: { by?: string; reason?: string; note?: string }) => {
      if (o.reason) oneOf("--reason", o.reason, REJECT_REASONS);
      json(
        await desk().skipPost({
          ids: ids.map(Number),
          ...(o.by ? { by: o.by } : {}),
          ...(o.reason ? { reason: o.reason } : {}),
          ...(o.note ? { note: o.note } : {}),
        }),
      );
    });

  const reads = () => ingress().objectClient<RedditReadsObject>({ name: "RedditReads" }, READS_KEY);
  const d = cmd
    .command("discovery")
    .description(
      "RedditReads: places monthly, watched places' threads every 2 h, drafts; reads signed out",
    );
  d.command("status").action(async () => json(await reads().status()));
  d.command("start").action(async () => json(await reads().start()));
  d.command("stop").action(async () => json(await reads().stop()));
  d.command("set")
    .description("Wren's discovery settings; a field left out keeps its value")
    .option("--auto-send <on|off>", "each pass's drafts take spaced send slots without your yes")
    .action(async (o: { autoSend?: string }) => {
      if (o.autoSend !== undefined && !["on", "off"].includes(o.autoSend))
        throw new Error(`on or off, not ${o.autoSend}`);
      json(
        await withDb(async (db) => {
          const next = discoverySettingsSchema.parse({
            ...((await settingsFor(db, null))["reddit.discovery"] ?? {}),
            ...(o.autoSend !== undefined && { autoSend: o.autoSend === "on" }),
          });
          await atomic(db, async (tx) => {
            await setAuditActor(tx, "cli");
            await setWrenSettings(tx, "reddit.discovery", next, "cli");
          });
          return next;
        }),
      );
    });
  d.command("sync")
    .alias("run")
    .description("One pass now; the loop stays as it is")
    .action(async () => json(await reads().sync()));

  cmd
    .command("schedule")
    .description("Give every drafted comment (others' posts, Reddit threads) a spaced send slot")
    .option("--posts <on|off>", "others' posts", "on")
    .option("--threads <on|off>", "Reddit threads", "on")
    .action(async (o: { posts: string; threads: string }) =>
      json(await desk().schedule({ posts: o.posts === "on", threads: o.threads === "on" })),
    );
  cmd
    .command("unschedule")
    .description("Take comments off the schedule; they wait on your yes again")
    .option("--posts <ids>", "reach post ids, comma separated")
    .option("--threads <ids>", "Reddit thread ids, comma separated")
    .action(async (o: { posts?: string; threads?: string }) =>
      json(
        await desk().unschedule({
          posts: (o.posts ?? "").split(",").filter(Boolean).map(Number),
          threads: (o.threads ?? "").split(",").filter(Boolean),
        }),
      ),
    );
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

  // designs/2026-10-14-comment-proof.md: is a sent comment there for a stranger.
  const proofLine = (
    item: string,
    p: { state: string; note?: string | null; url?: string | null },
  ) => console.log([item, p.state, p.note ?? "", p.url ?? ""].join("\t"));
  /** One check on the desk: sent, then its output polled (the reads are paced). */
  const checkNow = async (item: string): Promise<Proof> => {
    const sent = await ingress()
      .serviceSendClient<CommentProofsService>({ name: "CommentProofs" })
      .check({ item }, clients.rpc.sendOpts({ idempotencyKey: longCallKey(`proof ${item}`) }));
    const { url, headers } = ingressOf(settings);
    return pollOutput<Proof>(sent.invocationId, {
      url,
      ...(headers ? { headers } : {}),
      log: (l) => console.error(l),
    });
  };
  cmd
    .command("proof [item]")
    .description(
      "Whether a sent comment is there for a stranger (thread:t3_x, onpost:9, comment:4): live, hidden, missing or pending, checked now",
    )
    .option("--recent", "the last day's proofs, newest first")
    .option("--since <day>", "check every comment sent since this day (2026-10-12), one by one")
    .action(async (item: string | undefined, o: { recent?: boolean; since?: string }) => {
      if (o.recent) {
        const rows = await withDb((db) => proofsSince(db, new Date(Date.now() - 86_400_000)));
        if (!rows.length) console.log("no proofs in the last day");
        for (const r of rows)
          console.log(
            [
              r.item,
              r.platform,
              r.state,
              r.checkedAt?.toISOString() ?? "",
              r.note ?? "",
              r.url ?? "",
            ].join("\t"),
          );
        return;
      }
      if (o.since) {
        const since = new Date(o.since);
        if (Number.isNaN(since.getTime())) throw new Error("--since: want a day, 2026-10-12");
        const items = await withDb((db) => sentSince(db, since));
        console.error(`${items.length} sent since ${o.since}`);
        for (const i of items) {
          try {
            proofLine(i, await checkNow(i));
          } catch (err) {
            proofLine(i, {
              state: "failed",
              note: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }
      if (!item)
        throw new Error("give an item (thread:t3_x, onpost:9, comment:4), --recent or --since");
      if (!isProofItem(item))
        throw new Error(`${item}: want thread:<t3_id>, onpost:<id> or comment:<id>`);
      json(await checkNow(item));
    });
  const gates = cmd
    .command("gates")
    .description(
      "Subreddits whose karma or age rule holds our comments (queued, never dropped), with the gate now",
    )
    .action(async () => {
      const rows = await withDb((db) => gateList(db, new Date()));
      if (!rows.length) console.log("no subreddit has a requirement or a hold");
      for (const r of rows)
        console.log(
          [
            `r/${r.name}`,
            r.gate?.ok ? "open" : "held",
            r.gate?.reason ?? "",
            r.hold ? "unknown gate" : "",
            r.need.other ? `also: ${r.need.other}` : "",
            ...r.from,
          ].join("\t"),
        );
    });
  gates
    .command("set <subreddit>")
    .description("Set a subreddit's floor by hand (fields left out stay)")
    .option("--days <n>", "account age in days")
    .option("--karma <n>", "total karma")
    .option("--comment-karma <n>", "comment karma")
    .option("--note <text>", "where it came from")
    .action(
      async (
        sub: string,
        o: { days?: string; karma?: string; commentKarma?: string; note?: string },
      ) => {
        const n = (v: string | undefined, flag: string) => {
          if (v === undefined) return undefined;
          const x = Number(v);
          if (!Number.isInteger(x) || x < 0) throw new Error(`${flag}: want a whole number`);
          return x;
        };
        const need = {
          minAgeDays: n(o.days, "--days"),
          minKarma: n(o.karma, "--karma"),
          minCommentKarma: n(o.commentKarma, "--comment-karma"),
        };
        await withDb((db) =>
          setNeed(
            db,
            sub,
            Object.fromEntries(Object.entries(need).filter(([, v]) => v !== undefined)),
            o.note ?? null,
          ),
        );
        console.log(`r/${sub.replace(/^\/?r\//i, "")} set`);
      },
    );
  gates
    .command("learn <subreddit> <words>")
    .description('Keep the floor a moderator\'s words state ("must be 10 days old with 50 karma")')
    .action(async (sub: string, words: string) => {
      json(await withDb((db) => learnText(db, sub, words, new Date())));
    });
  gates
    .command("clear <subreddit>")
    .description("Lift every hold and floor on a subreddit; the next removal brings them back")
    .action(async (sub: string) => {
      const n = await withDb((db) => clearGate(db, sub, new Date()));
      console.log(n ? `cleared ${n}` : "nothing to clear");
    });
  gates
    .command("backfill")
    .description("Replay the kept comment proofs into requirements (removals state their floor)")
    .action(async () => {
      console.log(`${await withDb((db) => backfillFromProofs(db))} proofs replayed`);
    });
  return cmd;
}
