/**
 * Handing replies to the client (R13, step 7e). Every `interested` or
 * `meeting_booked` reply to a reactivation email gets a handoff row, then is
 * forwarded from the mailbox it came to, to the recruiter. The forward's
 * Message-ID is stored before the send and the mailbox is asked for it before
 * any retry, so a crash between the send and the mark never forwards twice. A
 * row is locked while it is sent, so two overlapping passes never both send it.
 */
import type { OutgoingEmail, Transport } from "@wren/channel-email";
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { REACTIVATION } from "./compose.js";
import { ensureHandoff, handoffRecruiter, replyRef } from "./handoff.js";
import type { ClientProfile } from "./schema.js";
import type { Sender } from "./settings.js";

/** The replies a recruiter should see. */
export const HANDED_OFF = ["interested", "meeting_booked"] as const;

export interface ForwardStats {
  /** Handoff rows made this pass. */
  opened: number;
  forwarded: number;
  /** Sent on an earlier try; only the mark was missing. Counted in `sent` too. */
  found: number;
  /** No recruiter to send to: the reply would go back to its own mailbox. */
  noRecruiter: number;
  failed: number;
  /** One line per forward that went, for the operator; no contact names (they go to chat). */
  sent: string[];
  errors: string[];
}

export interface ForwardOptions {
  profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null;
  /** The From name per mailbox. */
  settings: { senders: readonly Pick<Sender, "address" | "name">[] };
  limit?: number;
  now?: Date;
}

const warm = sql`t.disposition IN (${sql.join(
  HANDED_OFF.map((d) => sql`${d}`),
  sql`, `,
)})`;
/** A reply still worth handing off: a warm disposition, or a meeting a person marked. */
const stillHandedOff = sql`${warm} OR h.meeting_booked_at IS NOT NULL`;

type Pending = {
  id: number;
  thread_event_id: number;
  recruiter_email: string;
  forward_message_id: string;
  sender: string;
  wrote_as: string | null;
  full_name: string | null;
  from_address: string | null;
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
  received_at: Date | string;
  disposition: string;
};

export async function forwardHandoffs(
  db: Queryable,
  transport: Transport,
  opts: ForwardOptions,
): Promise<ForwardStats> {
  const limit = opts.limit ?? 20;
  const stats: ForwardStats = {
    opened: 0,
    forwarded: 0,
    found: 0,
    noRecruiter: 0,
    failed: 0,
    sent: [],
    errors: [],
  };

  // Replies with no row yet: make one, recruiter and Message-ID fixed now.
  const fresh = await db.execute<{ id: number }>(sql`
    SELECT t.id FROM thread_events t JOIN enrollments e ON e.id = t.enrollment_id
    WHERE t.kind = 'reply' AND e.niche = ${REACTIVATION}
      AND ${warm}
      AND NOT EXISTS (SELECT 1 FROM handoffs h WHERE h.thread_event_id = t.id)
    ORDER BY t.received_at, t.id LIMIT ${limit}`);
  for (const { id } of fresh) {
    const reply = await replyRef(db, Number(id));
    if (!reply) continue;
    await ensureHandoff(db, reply, opts.profile);
    stats.opened += 1;
  }

  const pending = await db.execute<Pending>(sql`
    SELECT h.id, h.thread_event_id, h.recruiter_email, h.forward_message_id,
      e.sender, p.full_name, t.from_address, t.subject, t.body_text, t.snippet,
      t.received_at, t.disposition,
      (SELECT m.provenance->>'recruiter' FROM messages m
        WHERE m.enrollment_id = e.id ORDER BY m.step LIMIT 1) AS wrote_as
    FROM handoffs h
    JOIN thread_events t ON t.id = h.thread_event_id
    JOIN enrollments e ON e.id = h.enrollment_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE h.forwarded_at IS NULL AND (${stillHandedOff})
    ORDER BY h.attempted_at NULLS FIRST, h.id LIMIT ${limit}`);

  const now = (opts.now ?? new Date()).toISOString();
  const names = new Map(opts.settings.senders.map((s) => [s.address, s.name]));
  for (const row of pending) {
    try {
      // Tried last next time, so a row that fails every pass never starves newer ones.
      await db.execute(
        sql`UPDATE handoffs SET attempted_at = ${now}::timestamptz WHERE id = ${row.id}`,
      );
      const went = await atomic(db, async (tx) => {
        // Another pass holds it, or it went or stopped counting since the read.
        const [held] = await tx.execute<{ id: number }>(sql`
          SELECT h.id FROM handoffs h JOIN thread_events t ON t.id = h.thread_event_id
          WHERE h.id = ${row.id} AND h.forwarded_at IS NULL AND (${stillHandedOff})
          FOR UPDATE OF h SKIP LOCKED`);
        if (!held) return "skipped" as const;
        // A row made before the firm had recruiters pointed back at its own mailbox.
        let to = row.recruiter_email.toLowerCase();
        if (to === row.sender.toLowerCase()) {
          to = handoffRecruiter(row.wrote_as, opts.profile, row.sender).toLowerCase();
          if (to === row.sender.toLowerCase()) return "noRecruiter" as const;
          await tx.execute(sql`UPDATE handoffs SET recruiter_email = ${to} WHERE id = ${row.id}`);
        }
        const already = await transport.find(row.sender, row.forward_message_id);
        if (!already) await transport.send(forwardEmail(row, to, names.get(row.sender) ?? null));
        await tx.execute(
          sql`UPDATE handoffs SET forwarded_at = ${now}::timestamptz WHERE id = ${row.id}`,
        );
        return { to, already: already !== null };
      });
      if (went === "skipped") continue;
      if (went === "noRecruiter") {
        stats.noRecruiter += 1;
        continue;
      }
      if (went.already) stats.found += 1;
      else stats.forwarded += 1;
      stats.sent.push(
        `${row.disposition} reply to ${went.to}${went.already ? " (sent on an earlier try)" : ""}`,
      );
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(`handoff ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}

const who = (row: Pick<Pending, "full_name" | "from_address">) =>
  row.full_name?.trim() || row.from_address || "someone";

/** The forward: plain, the reply whole, and where to write back. */
export function forwardEmail(row: Pending, to: string, fromName: string | null): OutgoingEmail {
  const received = new Date(row.received_at);
  const text = (row.body_text ?? row.snippet ?? "").trim();
  const subject = row.subject?.trim()
    ? `Fwd: ${row.subject.trim()}`
    : `Fwd: reply from ${who(row)}`;
  const lines = [
    `${who(row)} replied${row.disposition === "meeting_booked" ? " to book a meeting" : ""}. Write back from your own inbox${row.from_address ? `: ${row.from_address}` : ""}.`,
    "",
    `---------- Forwarded message ----------`,
    `From: ${row.full_name ? `${row.full_name} <${row.from_address ?? ""}>` : (row.from_address ?? "")}`,
    `Date: ${received.toUTCString()}`,
    `Subject: ${row.subject ?? ""}`,
    `To: ${row.sender}`,
    "",
    text || "(no text)",
  ];
  return {
    fromAddress: row.sender,
    fromName,
    to,
    subject,
    replySubject: null,
    body: lines.join("\n"),
    messageId: row.forward_message_id,
  };
}
