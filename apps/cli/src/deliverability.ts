/**
 * `wren email spamcheck` and `wren email deliverability`: the three tests of
 * designs/2026-10-05-deliverability-tests.md from the operator's chair. Spamcheck runs
 * SpamAssassin in Docker on this machine; deliverability only reads.
 */
import { resolve } from "node:path";
import {
  activePauses,
  buildMime,
  CALL_TIMES,
  domainOf,
  domainProblems,
  domainStandings,
  fillCallTimes,
  loadMailboxes,
  loadRoster,
  mailDomainTargets,
  mintMessageId,
  placementSummary,
  placementTrouble,
  placementVerdicts,
  sentenceReady,
  signed,
} from "@wren/channel-email";
import { coveringRenders, SPAM_LIMIT, type SpamScore, startSpamd } from "@wren/channel-email/spam";
import type { Settings } from "@wren/config";
import type { Db } from "@wren/db";
import { NICHE_NAMES, NICHES } from "@wren/niches";
import type { Command } from "commander";
import { sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const FROM = "will@example.com";
const SIGNATURE = "Will";
/** A made-up lead whose facts fill every template; a key with no sample is a loud error. */
const SAMPLE: Record<string, unknown> = {
  ...sentenceReady({ first_name: "Dana", company_name: "Tulsa Nurse Partners", title: "Owner" })
    .values,
  "company.aum": "$420 million",
  "company.ind_clients": "300",
  "call.times": CALL_TIMES,
  "call.booked": "Tuesday at 2 PM",
  "link.watch": "https://wrenautomation.com/watch/demo",
};

interface Scored {
  label: string;
  result: SpamScore;
}

function line({ label, result }: Scored): string {
  const ok = result.score < SPAM_LIMIT;
  const rules = result.rules
    .filter((r) => r.points !== 0)
    .map((r) => `${r.name} ${r.points > 0 ? "+" : ""}${r.points}`)
    .join(", ");
  return `${ok ? "ok  " : "FAIL"} ${result.score.toFixed(1).padStart(4)}  ${label}${rules ? `  (${rules})` : ""}`;
}

export function registerDeliverability(
  email: Command,
  withDb: WithDb,
  settings: Settings,
  rootDir: string,
): void {
  email
    .command("spamcheck")
    .description(
      `SpamAssassin score (Docker, local rules) for every template option, and with --drafts the newest real openers; fails at ${SPAM_LIMIT}`,
    )
    .option(
      "--drafts <n>",
      "also score the newest n composed openers per niche (reads the database)",
    )
    .option("--niche <niche>", "one niche")
    .option("-v, --verbose", "print every rule, zero-point ones too")
    .action(async (opts: { drafts?: string; niche?: string; verbose?: boolean }) => {
      const niches = NICHES.filter((n) => !opts.niche || n.name === opts.niche);
      if (niches.length === 0) throw new Error(`no niche ${opts.niche}`);
      const now = new Date();
      const messages: { label: string; raw: Buffer }[] = [];
      for (const niche of niches) {
        const offers = Object.assign({}, ...niche.offerFacts.values());
        for (const [name, tpl] of niche.templates) {
          const rendered = coveringRenders(tpl, { ...SAMPLE, ...offers });
          rendered.forEach((r, i) => {
            const subject = r.subject ?? "following up";
            const raw = buildMime({
              fromAddress: FROM,
              fromName: SIGNATURE,
              to: "dana@example.org",
              subject: r.subject,
              replySubject: r.subject === null ? subject : null,
              body: fillCallTimes(signed(r.body, SIGNATURE), null, null, now).body,
              messageId: mintMessageId(FROM),
              // A follow-up rides the thread: the multipart shape it really ships in.
              inReplyTo: r.subject === null ? mintMessageId(FROM) : null,
            });
            messages.push({ label: `${niche.name} ${name} #${i + 1}`, raw });
          });
        }
      }
      const drafts = Number(opts.drafts ?? 0);
      if (drafts > 0) {
        const rows = (await withDb((db) =>
          db.execute(sql`
            SELECT niche, sender, subject, body FROM (
              SELECT e.niche, e.sender, m.subject, m.body,
                row_number() OVER (PARTITION BY e.niche ORDER BY m.id DESC) AS k
              FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
              WHERE m.step = 0 AND m.state IN ('draft', 'approved', 'sending', 'sent')
            ) d WHERE k <= ${drafts} ${opts.niche ? sql`AND niche = ${opts.niche}` : sql``}
            ORDER BY niche, k`),
        )) as unknown as { niche: string; sender: string; subject: string; body: string }[];
        rows.forEach((d, i) => {
          messages.push({
            label: `${d.niche} draft ${i + 1} (${domainOf(d.sender)})`,
            raw: buildMime({
              fromAddress: d.sender,
              fromName: null,
              to: "lead@example.org",
              subject: d.subject,
              replySubject: null,
              body: fillCallTimes(d.body, null, null, now).body,
              messageId: mintMessageId(d.sender),
            }),
          });
        });
      }
      const spamd = await startSpamd({
        dockerDir: resolve(rootDir, "deploy/spamassassin"),
        log: (l) => console.error(l),
      });
      let failed = 0;
      try {
        for (const m of messages) {
          const result = await spamd.score(m.raw);
          if (result.score >= SPAM_LIMIT) failed += 1;
          console.log(line({ label: m.label, result }));
          if (opts.verbose)
            for (const r of result.rules)
              console.log(`        ${r.points} ${r.name}: ${r.description}`);
        }
      } finally {
        await spamd.stop();
      }
      console.log(`${messages.length - failed} of ${messages.length} under ${SPAM_LIMIT}`);
      if (failed > 0) process.exitCode = 1;
    });

  email
    .command("deliverability")
    .description(
      "Per domain: setup (DNS, lists, the receiver's SPF/DKIM/DMARC), plain and real seed placement, verdict, pause",
    )
    .action(async () => {
      const mailboxes = loadMailboxes(settings.mailboxesFile);
      const roster = loadRoster(
        resolve(rootDir, settings.sendersFile),
        NICHE_NAMES,
        new Set(mailboxes.keys()),
      );
      const now = new Date();
      const [standings, verdicts, pauses] = await Promise.all([
        domainStandings(mailDomainTargets(roster, mailboxes, settings.siteBaseUrl)),
        withDb((db) => placementVerdicts(db, { now, senders: roster.map((s) => s.address) })),
        withDb((db) => activePauses(db)),
      ]);
      for (const s of standings) {
        const v = verdicts.find((d) => d.domain === s.domain);
        console.log(s.domain);
        const dns = domainProblems(s);
        console.log(
          `  dns: ${dns.length ? dns.join("; ") : "ok (SPF, DKIM, DMARC, MX, NS, lists)"}`,
        );
        if (!v) continue;
        console.log(`  ${placementSummary(v).slice(s.domain.length + 2)}`);
        for (const t of placementTrouble(v, now)) console.log(`  ! ${t}`);
        const paused = [...pauses.values()].filter((p) => p.domain === s.domain);
        for (const p of paused)
          console.log(
            `  paused ${p.sender} (${p.source}, ${p.pausedAt.toISOString().slice(0, 10)}): ${p.reason}`,
          );
      }
      if (settings.placementSeeds.length === 0)
        console.log("no seeds (WREN_PLACEMENT_SEEDS): placement never runs");
    });
}
