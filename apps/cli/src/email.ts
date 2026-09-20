/**
 * `wren email …`: the operator's hands on the email channel. Reads go straight to
 * Postgres; the writes here (pause, resume, suppress, import) are one-row facts an
 * operator asserts, journaled by their own ledger rows, so they run against the
 * database directly. Composing and sending stay with the Restate loops.
 */
import { resolve } from "node:path";
import {
  activePauses,
  activeSuppression,
  addSuppression,
  classifyValue,
  liftSuppression,
  loadRoster,
  pause,
  resume,
  senderDays,
} from "@wren/channel-email";
import type { Settings } from "@wren/config";
import { CsvLeadSource, runImport, type Suppression, suppressions } from "@wren/core";
import type { Db } from "@wren/db";
import { NICHE_NAMES, requireNiche } from "@wren/niches";
import type { Command } from "commander";
import { desc, sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const BY = `cli:${process.env.USER ?? "operator"}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d === 0 ? "–" : `${((100 * n) / d).toFixed(2)}%`);

export function registerEmail(
  program: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  const email = program
    .command("email")
    .description("the email channel: queue, fleet, suppressions, imports");
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
        const pool = (await db.execute(sql`
          SELECT c.niche, count(*)::int AS companies
          FROM companies c
          WHERE EXISTS (SELECT 1 FROM leads l WHERE l.company_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.company_id = c.id)
          GROUP BY c.niche ORDER BY c.niche`)) as unknown as { niche: string; companies: number }[];
        console.log(
          `pool (companies with a lead, not yet enrolled): ${pool.map((p) => `${p.niche} ${p.companies}`).join(", ") || "none"}`,
        );
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
    .command("replies")
    .description("Human replies, newest first (subject and a snippet; answer from the inbox)")
    .option("--days <n>", "how far back", "7")
    .option("--limit <n>", "at most", "50")
    .action(async (opts: { days: string; limit: string }) => {
      await withDb(async (db) => {
        const rows = (await db.execute(sql`
          SELECT te.received_at, e.sender, c.name AS company, te.disposition, te.subject, left(te.snippet, 90) AS snippet
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
            `${String(r.received_at).slice(0, 16)}  ${r.sender}  ${r.company ?? "?"}  [${r.disposition ?? "unclassified"}]  ${r.subject ?? ""}\n    ${r.snippet ?? ""}`,
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

  email
    .command("import <csv>")
    .description("Import a lead CSV (generic header aliases) into a niche")
    .requiredOption("--niche <name>", `one of ${[...NICHE_NAMES].sort().join(", ")}`)
    .action(async (path: string, opts: { niche: string }) => {
      requireNiche(opts.niche);
      const result = await withDb((db) =>
        runImport(db, new CsvLeadSource(resolve(path)), { niche: opts.niche }),
      );
      console.log(`import ${result.batch.id}: ${JSON.stringify(result.stats)}`);
      console.log(
        "next: the queue-keeper picks new companies up on its next pass (resolution/enrichment first if they have no address)",
      );
    });
}
