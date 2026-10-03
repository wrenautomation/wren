/**
 * `wren email …`: the operator's hands on the email channel. Reads go straight to
 * Postgres; the writes here (pause, resume, suppress, import) are one-row facts an
 * operator asserts, journaled by their own ledger rows, so they run against the
 * database directly. Composing and sending stay with the Restate loops.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import * as clients from "@restatedev/restate-sdk-clients";
import {
  activePauses,
  activeSenders,
  activeSuppression,
  addSuppression,
  audienceGate,
  campaignFunnel,
  classifyValue,
  emailClicks,
  expandHome,
  GmailClient,
  GmailTransport,
  liftSuppression,
  loadRoster,
  openOutcomes,
  pause,
  postmasterDays,
  replyByArmStep,
  resume,
  runListedContacts,
  senderDays,
  siteExport,
  variantOutcomes,
} from "@wren/channel-email";
import type { QueueRefresh } from "@wren/channel-email/restate";
import { ingressOf, type Settings } from "@wren/config";
import { runImport, runPeopleImport, runScreen, type Suppression, suppressions } from "@wren/core";
import type { Db } from "@wren/db";
import {
  LEAD_SOURCE_FORMATS,
  NICHE_NAMES,
  NICHE_PLATFORM_DOMAINS,
  NICHES,
  PERSON_SOURCE_FORMATS,
  requireNiche,
} from "@wren/niches";
import { sizeFromPpp } from "@wren/research/companies";
import type { Command } from "commander";
import { desc, gte, sql } from "drizzle-orm";
import { registerAnswers } from "./answers.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const BY = `cli:${process.env.USER ?? "operator"}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d === 0 ? "–" : `${((100 * n) / d).toFixed(2)}%`);

export function registerEmail(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): Command {
  const email = program
    .command("email")
    .description("the email channel: queue, outcomes, fleet, suppressions, imports");
  const rosterAddresses = () =>
    loadRoster(resolve(rootDir, settings.sendersFile), NICHE_NAMES).map((s) => s.address);

  email
    .command("status")
    .description("Queue, today's sends, pool per niche, active pauses, 7-day health per domain")
    .action(async () => {
      await withDb(async (db) => {
        const [queue] = (await db.execute(sql`
          SELECT count(*) FILTER (WHERE step = 0 AND state = 'approved')::int AS openers,
                 count(*) FILTER (WHERE step > 0 AND state = 'approved')::int AS followups,
                 count(*) FILTER (WHERE state = 'draft')::int AS drafts,
                 count(*) FILTER (WHERE state = 'sent' AND sent_at >= date_trunc('day', now()))::int AS sent_today,
                 count(*) FILTER (WHERE state = 'failed')::int AS failed
          FROM messages`)) as unknown as Record<string, number>[];
        console.log(
          `queue: ${queue?.openers} openers approved, ${queue?.followups} follow-ups waiting, ` +
            `${queue?.drafts} drafts unreviewed, ${queue?.failed} failed; sent today (UTC) ${queue?.sent_today}`,
        );
        // Fresh = never enrolled; may return = rested under the niche's recontact policy
        // (it still needs a sequence it has not had).
        const pool: string[] = [];
        for (const { name, recontact: policy } of NICHES) {
          const [row] = (await db.execute(sql`
            SELECT count(*) FILTER (WHERE ${audienceGate(sql`c.id`, "first_contact", policy)})::int AS fresh,
                   count(*) FILTER (WHERE ${audienceGate(sql`c.id`, "returning", policy)})::int AS returning
            FROM companies c
            WHERE c.niche = ${name} AND EXISTS (SELECT 1 FROM leads l WHERE l.company_id = c.id)`)) as unknown as {
            fresh: number;
            returning: number;
          }[];
          if (row && (row.fresh > 0 || row.returning > 0))
            pool.push(`${name} ${row.fresh} fresh + ${row.returning} may return`);
        }
        console.log(`pool (companies with a lead): ${pool.join(", ") || "none"}`);
        const paused = await activePauses(db);
        console.log(
          paused.size === 0
            ? "pauses: none"
            : `pauses: ${[...paused.values()].map((p) => `${p.sender} (${p.source}: ${p.reason})`).join("; ")}`,
        );
        const since = isoDay(new Date(Date.now() - 7 * 86_400_000));
        const byDomain = new Map<
          string,
          { sent: number; hard: number; replies: number; unsub: number }
        >();
        for (const d of await senderDays(db, { since })) {
          const key = d.domain ?? "?";
          const row = byDomain.get(key) ?? { sent: 0, hard: 0, replies: 0, unsub: 0 };
          row.sent += d.sent ?? 0;
          row.hard += d.hardBounces ?? 0;
          row.replies += d.replies ?? 0;
          row.unsub += d.unsubscribes ?? 0;
          byDomain.set(key, row);
        }
        console.log(`last 7 days by domain (since ${since}):`);
        for (const [domain, r] of [...byDomain].sort())
          console.log(
            `  ${domain}: sent ${r.sent}, hard bounces ${r.hard} (${pct(r.hard, r.sent)}), replies ${r.replies}, unsubscribes ${r.unsub}`,
          );
      });
    });

  email
    .command("outcomes")
    .description("Funnel per niche and sequence, then reply rate by arm and step")
    .action(async () => {
      await withDb(async (db) => {
        const funnel = await db.select().from(campaignFunnel);
        console.log(
          "funnel (niche · sequence · kind · first/recycled): enrolled active finished · replies interested bounces unsubs",
        );
        for (const f of funnel) {
          console.log(
            `  ${f.niche} · ${f.sequenceName} · ${f.enrollmentKind} · ${f.recycled ? "recycled" : "first"}: ${f.enrolled} ${f.active} ${f.finished} · ` +
              `${f.replies} ${f.interested} ${f.hardBounces} ${f.unsubscribes}  (openers ${f.openersSent}, follow-ups ${f.followupsSent})`,
          );
        }
        const arms = await db.select().from(replyByArmStep);
        console.log("by arm and step: sent replies interested bounces reply%");
        for (const a of arms) {
          if (!a.sent) continue;
          console.log(
            `  ${a.niche} · ${a.arm} · step ${a.step} (${a.template} ${a.templateVersion ?? ""}): ` +
              `${a.sent} ${a.replies} ${a.interested} ${a.hardBounces} ${a.replyRatePct ?? 0}%`,
          );
        }
      });
    });

  email
    .command("refresh")
    .description(
      "Re-render every niche's queued mail from the deployed templates now (deploy does this itself); composes and sends nothing",
    )
    .action(async () => {
      const out = await clients
        .connect(ingressOf(settings))
        .serviceClient<QueueRefresh>({ name: "QueueRefresh" })
        .all();
      for (const [niche, s] of Object.entries(out))
        console.log(
          `${niche}: ${s.rerendered} re-rendered of ${s.checked} queued · kept ${s.kept_started_or_inactive} started or inactive, ${s.kept_unrenderable} unrenderable`,
        );
      if (Object.keys(out).length === 0) console.log("no niche has an active sender");
    });

  email
    .command("variants")
    .description(
      "Each [[variant]] option's sends, opens, replies and interested, per template version; compare options at the same point",
    )
    .option("--niche <niche>", "one niche")
    .option("--all", "every version, not only the newest per template")
    .action(async (opts: { niche?: string; all?: boolean }) => {
      const rows = await withDb((db) => variantOutcomes(db, opts.niche));
      if (rows.length === 0) {
        console.log("no sent messages yet");
        return;
      }
      // Newest version per template: the one that is sending.
      const newest = new Map<string, string>();
      if (!opts.all) {
        const latest = await withDb((db) =>
          db.execute(sql`SELECT DISTINCT ON (e.niche, m.template) e.niche, m.template,
              m.template_version AS version
            FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
            WHERE m.state = 'sent' ORDER BY e.niche, m.template, m.sent_at DESC`),
        );
        for (const r of latest as Record<string, unknown>[])
          newest.set(`${r.niche}\0${r.template}`, String(r.version));
      }
      let head = "";
      let point = "";
      for (const r of rows) {
        if (!opts.all && newest.get(`${r.niche}\0${r.template}`) !== r.version) continue;
        const h = `${r.niche} · ${r.template}@${r.version}`;
        if (h !== head) {
          console.log(`${h}\n  option: sent · opened (of tracked) · replies · interested`);
          head = h;
          point = "";
        }
        if (r.variant !== point) {
          console.log(`  ${r.variant}${r.inSubject ? " (subject)" : ""}`);
          point = r.variant;
        }
        const words = (r.text ?? "?").replace(/\s+/g, " ");
        console.log(
          `    ${r.option}: ${r.sent} · ${r.opened}/${r.tracked} (${pct(r.opened, r.tracked)}) · ` +
            `${r.replies} (${pct(r.replies, r.sent)}) · ${r.interested}  "${words.length > 70 ? `${words.slice(0, 69)}…` : words}"`,
        );
      }
    });

  email
    .command("opens")
    .description(
      "Open rates per niche, sequence and step (raw, and human-plausible: first fetch ≥ 2 min after send)",
    )
    .action(async () => {
      await withDb(async (db) => {
        const rows = await db.select().from(openOutcomes);
        if (rows.length === 0) {
          console.log("no tracked sends (WREN_OPEN_TRACKING is off, or the pixel host is unset)");
          return;
        }
        for (const r of rows) {
          console.log(
            `  ${r.niche} · ${r.sequenceName} · step ${r.step}: tracked ${r.trackedSent}, ` +
              `opened raw ${pct(r.openedRaw ?? 0, r.trackedSent ?? 0)}, human-plausible ${pct(r.openedHumanPlausible ?? 0, r.trackedSent ?? 0)}`,
          );
        }
      });
    });

  email
    .command("clicks")
    .description(
      "Who clicked the site link in which email (?r= codes from the lander), and what they did after",
    )
    .option("--limit <n>", "at most", "50")
    .action(async (opts: { limit: string }) => {
      if (!settings.siteExportToken) {
        console.log("WREN_SITE_EXPORT_TOKEN is unset (the lander's EXPORT_TOKEN secret)");
        return;
      }
      const site = { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken };
      const [hits, applications] = await Promise.all([
        siteExport("hits", site),
        siteExport("applications", site),
      ]);
      const clicks = await withDb((db) => emailClicks(db, hits, applications));
      if (clicks.length === 0) {
        console.log("no email link clicks yet");
        return;
      }
      console.log("first click · company · to · niche step · visitors views secs · form · applied");
      for (const c of clicks.slice(0, Number(opts.limit))) {
        const m = c.message;
        const who = m
          ? `${m.company ?? "?"} · ${m.toEmail} · ${m.niche} step ${m.step}`
          : `unknown code ${c.code}`;
        const applied = c.applied
          ? `applied ${c.applied.offer}${c.applied.fit ? " (fit)" : ""}`
          : "–";
        console.log(
          `  ${c.firstClick.slice(0, 16)} · ${who} · ${c.visitors} ${c.views} ${c.secs}s · ${c.reachedForm ? "form" : "–"} · ${applied}`,
        );
      }
    });

  email
    .command("postmaster")
    .description(
      "Google Postmaster per sending domain: spam rate and auth ratios, newest day first",
    )
    .option("--days <n>", "how many days back", "14")
    .action(async (opts: { days: string }) => {
      await withDb(async (db) => {
        const since = isoDay(new Date(Date.now() - Number(opts.days) * 86_400_000));
        const rows = await db
          .select()
          .from(postmasterDays)
          .where(gte(postmasterDays.day, since))
          .orderBy(desc(postmasterDays.day), postmasterDays.domain);
        if (rows.length === 0) {
          console.log(`no Postmaster rows since ${since} (PostmasterScheduler/fleet running?)`);
          return;
        }
        console.log("day · domain: spam% · spf dkim dmarc · reputation");
        for (const r of rows) {
          const ratio = (v: number | string | null) =>
            v === null ? "–" : `${(100 * Number(v)).toFixed(1)}%`;
          console.log(
            `  ${r.day} · ${r.domain}: ${ratio(r.spamRate)} · ${ratio(r.spfSuccessRatio)} ${ratio(r.dkimSuccessRatio)} ${ratio(r.dmarcSuccessRatio)} · ${r.domainReputation ?? "–"}`,
          );
        }
      });
    });

  email
    .command("replies")
    .description("Human replies, newest first; #id feeds `email event` and `email reply --event`")
    .option("--days <n>", "how far back", "7")
    .option("--limit <n>", "at most", "50")
    .action(async (opts: { days: string; limit: string }) => {
      await withDb(async (db) => {
        const rows = (await db.execute(sql`
          SELECT te.id, te.received_at, e.sender, c.name AS company, te.disposition, te.subject, left(te.snippet, 90) AS snippet
          FROM thread_events te
          JOIN enrollments e ON e.id = te.enrollment_id
          LEFT JOIN companies c ON c.id = e.company_id
          WHERE te.kind = 'reply' AND te.received_at >= now() - (${Number(opts.days)} || ' days')::interval
          ORDER BY te.received_at DESC LIMIT ${Number(opts.limit)}`)) as unknown as Record<
          string,
          string | null
        >[];
        if (rows.length === 0) console.log("no replies in that window");
        for (const r of rows)
          console.log(
            `#${r.id}  ${String(r.received_at).slice(0, 16)}  ${r.sender}  ${r.company ?? "?"}  [${r.disposition ?? "unclassified"}]  ${r.subject ?? ""}\n    ${r.snippet ?? ""}`,
          );
      });
    });

  const senders = email.command("senders").description("the sending fleet");
  senders
    .command("list")
    .description("Roster addresses and any active pause")
    .action(async () => {
      await withDb(async (db) => {
        const paused = await activePauses(db);
        for (const address of rosterAddresses()) {
          const p = paused.get(address);
          console.log(
            p
              ? `${address}  PAUSED ${p.source}: ${p.reason} (since ${isoDay(p.pausedAt)})`
              : `${address}  active`,
          );
        }
      });
    });
  senders
    .command("pause <target>")
    .description("Pause an inbox, or every inbox on a bare domain")
    .requiredOption("--reason <text>", "why (stored on the pause)")
    .action(async (target: string, opts: { reason: string }) => {
      const rows = await withDb((db) =>
        pause(db, {
          target,
          reason: opts.reason,
          by: BY,
          now: new Date(),
          senders: rosterAddresses(),
        }),
      );
      console.log(`paused ${rows.map((r) => r.sender).join(", ") || "nothing new"}`);
    });
  senders
    .command("resume <target>")
    .description("Lift the pause on an inbox or domain (the only way a kill-switch pause lifts)")
    .action(async (target: string) => {
      const rows = await withDb((db) =>
        resume(db, { target, by: BY, now: new Date(), senders: rosterAddresses() }),
      );
      console.log(`resumed ${rows.map((r) => r.sender).join(", ") || "nothing was paused"}`);
    });

  senders
    .command("check")
    .description(
      "Prove every active inbox can send: mint its delegation token; --send mails one test each",
    )
    .option("--niche <name>", "only inboxes this niche's campaigns may use")
    .option(
      "--send",
      "one test mail per inbox, to another inbox in the fleet (mail stays inside the fleet)",
    )
    .action(async (opts: { niche?: string; send?: boolean }) => {
      const active = activeSenders(
        loadRoster(resolve(rootDir, settings.sendersFile), NICHE_NAMES),
        opts.niche ?? null,
      ).map((s) => s.address);
      if (active.length === 0) throw new Error("no active senders in scope — nothing to check");
      const client = new GmailClient({ keyPath: expandHome(settings.googleServiceAccount) });
      const transport = new GmailTransport(client);
      let failures = 0;
      const minted: string[] = [];
      for (const address of active) {
        try {
          await client.ensureToken(address);
          minted.push(address);
          console.log(`mint ok    ${address}`);
        } catch (err) {
          failures += 1;
          console.log(`mint FAIL  ${address}: ${(err as Error).message}`);
        }
      }
      if (opts.send) {
        for (const [i, address] of minted.entries()) {
          // Each inbox mails the next one round-robin: the exact path campaigns use, no outsider.
          const to = minted[(i + 1) % minted.length] as string;
          const domain = address.slice(address.lastIndexOf("@") + 1);
          try {
            await transport.send({
              fromAddress: address,
              fromName: null,
              to,
              subject: `wren fleet send check: ${address} -> ${to}`,
              replySubject: null,
              body: "Automated test send from `wren email senders check --send`. One email per active inbox, each to another inbox in the fleet, through the exact path campaigns use. Safe to ignore.",
              messageId: `<${randomUUID().replaceAll("-", "")}@${domain}>`,
            });
            console.log(`send ok    ${address} -> ${to}`);
          } catch (err) {
            failures += 1;
            console.log(`send FAIL  ${address} -> ${to}: ${(err as Error).message}`);
          }
        }
      }
      const verb = opts.send ? "minted + sent" : "minted";
      if (failures > 0) throw new Error(`${failures} failure(s) across ${active.length} inbox(es)`);
      console.log(`all ${active.length} inbox(es) ${verb} clean`);
    });

  const suppress = email.command("suppress").description("addresses and domains we never mail");
  const show = (s: Suppression) =>
    `${s.kind} ${s.value}  ${s.reason}${s.revokedAt ? "  (lifted)" : ""}`;
  suppress
    .command("add <value>")
    .description("Never mail this address or domain again")
    .option("--reason <r>", "opt_out | bounce | complaint | manual", "manual")
    .action(async (value: string, opts: { reason: string }) => {
      const [kind, normalized] = classifyValue(value);
      const { row, created } = await withDb((db) =>
        addSuppression(db, {
          kind,
          value: normalized,
          reason: opts.reason as Suppression["reason"],
          evidence: { by: BY },
        }),
      );
      console.log(`${created ? "added" : "re-asserted"}: ${show(row)}`);
    });
  suppress
    .command("lift <value>")
    .description("Allow mail to this address or domain again")
    .action(async (value: string) => {
      const [kind, normalized] = classifyValue(value);
      const row = await withDb((db) =>
        liftSuppression(db, { kind, value: normalized, evidence: { by: BY } }),
      );
      console.log(row ? `lifted: ${show(row)}` : "nothing to lift");
    });
  suppress
    .command("check <email>")
    .description("Would we mail this address?")
    .action(async (value: string) => {
      const hit = await withDb((db) => activeSuppression(db, value));
      console.log(hit ? `suppressed by ${show(hit)}` : "not suppressed");
      if (hit) process.exitCode = 1;
    });
  suppress
    .command("list")
    .option("--limit <n>", "at most", "100")
    .action(async (opts: { limit: string }) => {
      const rows = await withDb((db) =>
        db
          .select()
          .from(suppressions)
          .orderBy(desc(suppressions.createdAt))
          .limit(Number(opts.limit)),
      );
      for (const r of rows) console.log(show(r));
    });

  const formatNames = (m: ReadonlyMap<string, { name: string }>) => [...m.keys()].sort().join(", ");
  email
    .command("formats")
    .description("List the import formats: which file each reads and which niche owns it")
    .action(() => {
      console.log("lead formats (wren email import --format):");
      for (const f of [...LEAD_SOURCE_FORMATS.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ))
        console.log(`  ${f.name.padEnd(26)} ${f.niche ?? "any niche"}  ${f.help}`);
      console.log("people formats (wren email import-people --format):");
      for (const f of [...PERSON_SOURCE_FORMATS.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ))
        console.log(`  ${f.name.padEnd(26)} ${f.niche ?? "any niche"}  ${f.help}`);
    });

  email
    .command("import <path>")
    .description("Import a lead file (or a saved-page directory) into a niche")
    .option("--format <name>", `one of ${formatNames(LEAD_SOURCE_FORMATS)}`, "csv")
    .option(
      "--niche <name>",
      `for niche-less formats: one of ${[...NICHE_NAMES].sort().join(", ")}`,
    )
    .option("--map <column=field...>", "csv only: source column -> canonical field")
    .action(async (path: string, opts: { format: string; niche?: string; map?: string[] }) => {
      const format = LEAD_SOURCE_FORMATS.get(opts.format);
      if (!format) throw new Error(`unknown format ${opts.format}; see \`wren email formats\``);
      // The format's niche wins; a generic format needs the operator to say.
      const niche = format.niche ?? requireNiche(opts.niche ?? null);
      if (niche === null) throw new Error(`--niche is required with --format ${format.name}`);
      if (opts.map && !format.columnMapped)
        throw new Error(`--map does not apply to ${format.name}: the format owns its dialect`);
      const target = resolve(path);
      if (statSync(target).isDirectory() && !format.directory)
        throw new Error(`${format.name} reads one file, not a directory`);
      const columnMap = opts.map ? { columnMap: Object.fromEntries(opts.map.map(pair)) } : {};
      const result = await withDb((db) =>
        runImport(db, format.build(target), {
          niche,
          ...columnMap,
          extraPlatformDomains: NICHE_PLATFORM_DOMAINS,
        }),
      );
      console.log(`import ${result.batch.id}: ${JSON.stringify(result.stats)}`);
      const screen = NICHES.find((n) => n.name === niche)?.screen;
      if (screen) {
        const screened = await withDb((db) => runScreen(db, niche, screen));
        console.log(`screen: ${JSON.stringify(screened)}`);
      }
      const listed = await withDb((db) => runListedContacts(db, niche));
      console.log(`contacts: ${JSON.stringify(listed)}`);
      console.log(
        "next: the pool-feeder and queue-keeper pick new companies up on their next pass",
      );
    });

  email
    .command("import-people <path>")
    .description("Import a people file (registry owners, officers, LinkedIn profiles)")
    .requiredOption("--format <name>", `one of ${formatNames(PERSON_SOURCE_FORMATS)}`)
    .option(
      "--niche <name>",
      `for niche-less formats: one of ${[...NICHE_NAMES].sort().join(", ")}`,
    )
    .action(async (path: string, opts: { format: string; niche?: string }) => {
      const format = PERSON_SOURCE_FORMATS.get(opts.format);
      if (!format) throw new Error(`unknown format ${opts.format}; see \`wren email formats\``);
      const niche = format.niche ?? requireNiche(opts.niche ?? null);
      if (niche === null) throw new Error(`--niche is required with --format ${format.name}`);
      const result = await withDb((db) =>
        runPeopleImport(db, format.build(resolve(path)), { niche }),
      );
      console.log(`import ${result.batch.id}: ${JSON.stringify(result.stats)}`);
    });

  email
    .command("screen")
    .description(
      "Mark a niche's firms that are no buyer (chains, public bodies, abroad, the niche's rule); runs after every import",
    )
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .option("--dry-run", "count without writing")
    .action(async (opts: { niche: string; dryRun?: boolean }) => {
      const niche = requireNiche(opts.niche);
      const screen = NICHES.find((n) => n.name === niche)?.screen;
      if (niche === null || !screen) throw new Error(`niche ${opts.niche} has no screen`);
      const stats = await withDb((db) =>
        runScreen(db, niche, screen, { dryRun: opts.dryRun === true }),
      );
      console.log(`screen${opts.dryRun ? " (dry run)" : ""}: ${JSON.stringify(stats)}`);
    });

  email
    .command("contacts")
    .description(
      "Make people of a niche's named leads, each holding their own address; runs after every import",
    )
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .action(async (opts: { niche: string }) => {
      const niche = requireNiche(opts.niche);
      if (niche === null) throw new Error(`unknown niche ${opts.niche}`);
      const stats = await withDb((db) => runListedContacts(db, niche));
      console.log(`contacts: ${JSON.stringify(stats)}`);
    });

  email
    .command("size <dir>")
    .description("Size a niche's companies from PPP loan files (jobs reported, yearly payroll)")
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .action(async (dir: string, opts: { niche: string }) => {
      const niche = requireNiche(opts.niche);
      if (niche === null) throw new Error("--niche is required");
      const stats = await withDb((db) => sizeFromPpp(db, { dir: resolve(dir), niche }));
      console.log(`size: ${JSON.stringify(stats)}`);
    });
  registerAnswers(email, withDb, settings);
  return email;
}

/** "Column=field" -> [column, field]; refuses a pair with no "=". */
function pair(text: string): [string, string] {
  const at = text.indexOf("=");
  if (at <= 0) throw new Error(`--map expects column=field, got ${JSON.stringify(text)}`);
  return [text.slice(0, at), text.slice(at + 1)];
}
