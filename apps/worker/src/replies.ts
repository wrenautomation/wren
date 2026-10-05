/**
 * Replies: every lead's answer, on any channel, in one queue in the Inbox app. Email replies,
 * text threads and DM threads whose lead wrote back, in the same states. Each row links to its
 * channel's page, where it's answered; every answer still waits on William's yes.
 */
import { date, defineRecord, link, name, status, text } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

/** ponytail: rows, not a view: Wren's channels hold a few hundred answers; a view past that. */
const ROWS = 500;

/** An email reply's state, in the queue's words. */
const EMAIL: Record<string, string> = {
  needs_you: "needs_you",
  proposed: "draft",
  booking: "answered",
  booked: "answered",
  already_booked: "answered",
  sent: "answered",
  dropped: "left",
};

type Got = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Got[];
/** Theirs is the last word and nobody read it: needs you. Ours came after: answered. */
const stateOf = (r: Got) => (r.answered ? "answered" : r.unread ? "needs_you" : "left");

export const replyQueueRecord = defineRecord({
  id: "inbox.reply",
  name: { one: "reply", many: "replies" },
  rows: async (db) => {
    const [email, texts, dms] = await Promise.all([
      rowsOf(
        db,
        sql`SELECT id, who, company, state, received AS at, words FROM email_reply_records
            ORDER BY received DESC LIMIT ${ROWS}`,
      ),
      rowsOf(
        db,
        sql`SELECT c.id, coalesce(c.name, c.e164) who, i.body words, i.at,
              EXISTS (SELECT 1 FROM sms_messages o WHERE o.contact_id = c.id AND o.direction = 'out'
                AND o.state <> 'skipped' AND o.created_at > i.at) answered,
              (c.read_at IS NULL OR c.read_at < i.at) unread
            FROM sms_contacts c
            JOIN LATERAL (SELECT body, received_at at FROM sms_messages
              WHERE contact_id = c.id AND direction = 'in'
              ORDER BY received_at DESC LIMIT 1) i ON true
            ORDER BY i.at DESC LIMIT ${ROWS}`,
      ),
      rowsOf(
        db,
        sql`SELECT c.id, coalesce(c.name, c.handle) who, c.headline company, i.body words, i.at,
              EXISTS (SELECT 1 FROM reach_messages o WHERE o.contact_id = c.id AND o.direction = 'out'
                AND o.created_at > i.at) answered,
              (c.read_at IS NULL OR c.read_at < i.at) unread
            FROM reach_contacts c
            JOIN LATERAL (SELECT body, coalesce(sent_at, created_at) at FROM reach_messages
              WHERE contact_id = c.id AND direction = 'in'
              ORDER BY coalesce(sent_at, created_at) DESC LIMIT 1) i ON true
            ORDER BY i.at DESC LIMIT ${ROWS}`,
      ),
    ]);
    return [
      ...email.map((r) => ({
        ...r,
        id: `email-${r.id}`,
        channel: "email",
        state: EMAIL[String(r.state)] ?? "left",
        open: `/inbox/replies/${r.id}`,
      })),
      ...texts.map((r) => ({
        ...r,
        id: `text-${r.id}`,
        channel: "text",
        company: null,
        state: stateOf(r),
        open: `/marketing/texts/${r.id}`,
      })),
      ...dms.map((r) => ({
        ...r,
        id: `dm-${r.id}`,
        channel: "dm",
        state: stateOf(r),
        open: `/marketing/dms/${r.id}`,
      })),
    ];
  },
  key: "id",
  title: "who",
  subtitle: "words",
  fields: {
    channel: status(
      {
        email: { label: "Email", tone: "neutral" },
        text: { label: "Text", tone: "neutral" },
        dm: { label: "DM", tone: "neutral" },
      },
      "Channel",
    ),
    who: name("From"),
    company: text("Company"),
    state: status({
      needs_you: { label: "Needs you", tone: "bad" },
      draft: { label: "Draft ready", tone: "warn" },
      answered: { label: "Answered", tone: "good" },
      left: { label: "Left", tone: "neutral" },
    }),
    at: date("When"),
    words: text("Their words"),
    open: link("Answer it"),
  },
  views: [
    {
      id: "waiting",
      label: "Waiting on you",
      where: { state: ["needs_you", "draft"] },
      sort: "-at",
      at: "at",
    },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
});
