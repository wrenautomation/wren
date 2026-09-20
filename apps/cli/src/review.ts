/**
 * `wren email drafts|show|approve|reject|edit|stop|preview|reply|event`: the review
 * seat. Every write is one operator fact on a row the loops already own; nothing here
 * sends. Text the operator reads comes from the stored message, never re-rendered.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveMessages,
  describeAddress,
  editableText,
  editMessage,
  enrollments,
  enumerateRenders,
  labelEvent,
  listDrafts,
  messages,
  parseEditable,
  placeholderFacts,
  REJECT_REASONS,
  REPLY_DISPOSITIONS,
  type RejectReason,
  type ReplyDisposition,
  recordOperatorReply,
  rejectMessages,
  STOP_REASONS,
  type StopReason,
  stopByHand,
  threadEvents,
  variantCounts,
} from "@wren/channel-email";
import type { Db } from "@wren/db";
import { nicheFor } from "@wren/niches";
import type { Command } from "commander";
import { eq } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const ids = (args: string[]) =>
  args.map((a) => {
    const n = Number(a);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`not a message id: ${a}`);
    return n;
  });

function oneOf<T extends string>(what: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

export function registerReview(email: Command, withDb: WithDb): void {
  email
    .command("drafts")
    .description("Drafts awaiting review, with how each address was come by")
    .option("--enrollment <id>", "one enrollment")
    .option("--flagged", "only drafts compose flagged as a possible duplicate company")
    .action(async (opts: { enrollment?: string; flagged?: boolean }) => {
      const rows = await withDb((db) =>
        listDrafts(db, {
          ...(opts.enrollment ? { enrollmentId: Number(opts.enrollment) } : {}),
          ...(opts.flagged ? { flagged: true } : {}),
        }),
      );
      if (rows.length === 0) {
        console.log("no drafts");
        return;
      }
      for (const r of rows) {
        const flag = r.duplicate ? `  DUP? ${r.duplicate}` : "";
        console.log(
          `${r.id}  e${r.enrollmentId}/${r.step}  ${r.to}  via ${r.addressVia || "?"}  ${r.template}${flag}\n    ${r.subject ?? "(rides the thread)"} — ${r.firstLine}`,
        );
      }
      console.log(`${rows.length} draft(s)`);
    });

  email
    .command("show <message>")
    .description("One message in full, with its address provenance and review history")
    .action(async (id: string) => {
      await withDb(async (db) => {
        const [m] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, Number(id)));
        if (!m) throw new Error(`no message ${id}`);
        const p = m.provenance as Record<string, unknown>;
        const address = p.address as Record<string, unknown> | undefined;
        const review = p.review as { edits?: number; original?: unknown } | undefined;
        const lines = [
          `message ${m.id}  enrollment ${m.enrollmentId}  step ${m.step}  ${m.state}`,
          `to: ${m.toEmail}`,
          `template: ${m.template}@${m.templateVersion}`,
          `address via: ${describeAddress(address) || "?"}`,
        ];
        if (address?.source_url) lines.push(`source page: ${String(address.source_url)}`);
        if (p.possible_duplicate_company)
          lines.push(`possible duplicate: ${JSON.stringify(p.possible_duplicate_company)}`);
        if (m.approvedAt) lines.push(`approved: ${m.approvedAt.toISOString()} by ${m.approvedBy}`);
        if (m.reviewReason)
          lines.push(`rejected: ${m.reviewReason}${m.detail ? ` — ${m.detail}` : ""}`);
        if (review?.edits) lines.push(`edited ${review.edits}× (original pinned in provenance)`);
        if (m.sentAt) lines.push(`sent: ${m.sentAt.toISOString()}`);
        console.log(`${lines.join("\n")}\n\n${editableText(m.subject, m.body)}`);
      });
    });

  email
    .command("approve [ids...]")
    .description("Approve drafts: ids (a failed step may be re-armed), --enrollment, or --all")
    .option("--enrollment <id>", "every draft of one enrollment")
    .option("--all", "every draft")
    .action(async (args: string[], opts: { enrollment?: string; all?: boolean }) => {
      const selector = opts.all
        ? { all: true as const }
        : opts.enrollment
          ? { enrollmentId: Number(opts.enrollment) }
          : { ids: ids(args) };
      if ("ids" in selector && selector.ids.length === 0)
        throw new Error("give message ids, --enrollment <id> or --all");
      const result = await withDb((db) => approveMessages(db, selector));
      for (const n of result.notices) console.log(n);
      console.log(
        `approved ${result.approved}${result.refused ? `, refused ${result.refused}` : ""}`,
      );
    });

  email
    .command("reject <ids...>")
    .description("Strike drafts or approved messages; the reason feeds rejections_by_reason")
    .requiredOption("--reason <r>", REJECT_REASONS.join(" | "))
    .option("--note <text>", "what was wrong, in your words")
    .action(async (args: string[], opts: { reason: string; note?: string }) => {
      const reason = oneOf<RejectReason>("--reason", opts.reason, REJECT_REASONS);
      const n = await withDb((db) => rejectMessages(db, ids(args), reason, opts.note ?? null));
      console.log(`rejected ${n}`);
    });

  email
    .command("edit <message>")
    .description("Open a draft in $VISUAL/$EDITOR; the original stays pinned in provenance")
    .action(async (id: string) => {
      await withDb(async (db) => {
        const [m] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, Number(id)));
        if (!m) throw new Error(`no message ${id}`);
        if (m.state !== "draft")
          throw new Error(`message ${id} is ${m.state} — only a draft is editable`);
        const edited = openInEditor(editableText(m.subject, m.body), `message-${m.id}`);
        const parsed = parseEditable(edited, { riding: m.subject === null });
        const count = await editMessage(db, m.id, parsed);
        console.log(count === null ? "unchanged" : `saved edit ${count} of message ${m.id}`);
      });
    });

  email
    .command("stop")
    .description("Stop an enrollment, or every active one at a company; unsent steps are skipped")
    .option("--enrollment <id>", "one enrollment")
    .option("--company-domain <domain>", "every active enrollment at the firm")
    .requiredOption("--reason <r>", STOP_REASONS.join(" | "))
    .option("--detail <text>", "stored on the stop")
    .action(
      async (opts: {
        enrollment?: string;
        companyDomain?: string;
        reason: string;
        detail?: string;
      }) => {
        const reason = oneOf<StopReason>("--reason", opts.reason, STOP_REASONS);
        const target = opts.enrollment
          ? { enrollmentId: Number(opts.enrollment) }
          : opts.companyDomain
            ? { companyDomain: opts.companyDomain.toLowerCase() }
            : null;
        if (!target) throw new Error("give --enrollment <id> or --company-domain <domain>");
        const out = await withDb((db) => stopByHand(db, target, reason, opts.detail ?? null));
        console.log(out.summary);
      },
    );

  email
    .command("preview <template>")
    .description(
      "Render a niche's template with «placeholder» facts; --variants walks every combination",
    )
    .requiredOption("--niche <name>", "which niche's copy")
    .option("--variants", "every variant combination, not one seeded pick")
    .action((name: string, opts: { niche: string; variants?: boolean }) => {
      const niche = nicheFor(opts.niche);
      const tpl = niche.templates.get(name);
      if (!tpl)
        throw new Error(
          `no template ${name} in ${niche.name}: ${[...niche.templates.keys()].join(", ")}`,
        );
      const facts = placeholderFacts(tpl);
      const counts = variantCounts(tpl);
      console.log(`${tpl.name}@${tpl.version}  variants: ${JSON.stringify(counts)}`);
      for (const [choices, rendered] of enumerateRenders(tpl, facts)) {
        console.log(
          `\n--- ${JSON.stringify(choices)}\n${editableText(rendered.subject, rendered.body)}`,
        );
        if (!opts.variants) break;
      }
    });

  email
    .command("reply")
    .description("Label a reply's disposition, or record one that never reached the mailbox")
    .requiredOption("--disposition <d>", REPLY_DISPOSITIONS.join(" | "))
    .option("--event <id>", "an existing thread event (relabel)")
    .option("--enrollment <id>", "record a reply by hand for this enrollment; stops the company")
    .option("--note <text>", "for a hand-recorded reply: what they said, in your words")
    .option("--from <address>", "for a hand-recorded reply: who wrote")
    .action(
      async (opts: {
        disposition: string;
        event?: string;
        enrollment?: string;
        note?: string;
        from?: string;
      }) => {
        const disposition = oneOf<ReplyDisposition>(
          "--disposition",
          opts.disposition,
          REPLY_DISPOSITIONS,
        );
        const now = new Date();
        await withDb(async (db) => {
          if (opts.event) {
            const [event] = await db
              .select()
              .from(threadEvents)
              .where(eq(threadEvents.id, Number(opts.event)));
            if (!event) throw new Error(`no thread event ${opts.event}`);
            await labelEvent(db, { event, disposition, now });
            console.log(`event ${event.id}: ${event.disposition ?? "unlabelled"} → ${disposition}`);
            return;
          }
          if (!opts.enrollment)
            throw new Error("give --event <id> to relabel, or --enrollment <id> to record");
          const [enrollment] = await db
            .select()
            .from(enrollments)
            .where(eq(enrollments.id, Number(opts.enrollment)));
          if (!enrollment) throw new Error(`no enrollment ${opts.enrollment}`);
          const event = await recordOperatorReply(db, {
            enrollment,
            disposition,
            note: opts.note ?? null,
            fromAddress: opts.from ?? null,
            now,
          });
          console.log(`recorded reply as event ${event.id} (${disposition}); company stopped`);
        });
      },
    );

  email
    .command("event <id>")
    .description("One inbox event: kind, disposition, and which message (and address) it answers")
    .action(async (id: string) => {
      await withDb(async (db) => {
        const [e] = await db
          .select()
          .from(threadEvents)
          .where(eq(threadEvents.id, Number(id)));
        if (!e) throw new Error(`no thread event ${id}`);
        const lines = [
          `event ${e.id}  ${e.kind}  enrollment ${e.enrollmentId}  ${e.receivedAt.toISOString()}`,
          `disposition: ${e.disposition ?? "—"}${e.dispositionSource ? ` (${e.dispositionSource})` : ""}`,
          `from: ${e.fromAddress ?? "?"}  subject: ${e.subject ?? ""}`,
        ];
        if (e.detail) lines.push(`detail: ${e.detail}`);
        const [m] = e.inReplyToMessageId
          ? await db.select().from(messages).where(eq(messages.id, e.inReplyToMessageId))
          : await db
              .select()
              .from(messages)
              .where(eq(messages.enrollmentId, e.enrollmentId))
              .limit(1);
        if (m) {
          const address = (m.provenance as Record<string, unknown>).address as
            | Record<string, unknown>
            | undefined;
          lines.push(`answers message ${m.id} (step ${m.step}, ${m.template})`);
          lines.push(`address via: ${describeAddress(address) || "?"}`);
          if (address?.source_url) lines.push(`source page: ${String(address.source_url)}`);
        }
        if (e.snippet) lines.push(`\n${e.snippet}`);
        console.log(lines.join("\n"));
      });
    });
}

/** Hand text to $VISUAL/$EDITOR in a scratch file; the file is gone by the time this returns. */
function openInEditor(text: string, name: string): string {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) throw new Error("set $VISUAL or $EDITOR to edit a draft");
  const dir = mkdtempSync(join(tmpdir(), "wren-edit-"));
  const file = join(dir, `${name}.txt`);
  try {
    writeFileSync(file, text);
    const run = spawnSync(editor, [file], { stdio: "inherit", shell: true });
    if (run.status !== 0)
      throw new Error(`editor exited ${run.status ?? "abnormally"}; nothing saved`);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
