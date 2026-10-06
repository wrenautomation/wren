/**
 * Replies: every lead's answer, on any channel, in one queue in the Inbox app. Every human
 * email reply, text threads and DM threads whose lead wrote back, comments on our posts, and
 * accepted LinkedIn invites not yet written to, in the same states. Each row links to its
 * channel's page, where it's answered; every answer still waits on William's yes.
 */
import { date, defineRecord, link, name, status, text } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

/** ponytail: rows, not a view: Wren's channels hold a few hundred answers; a view past that. */
const ROWS = 500;

/** An email reply's state, in the queue's words: its call invite's, when it has one. */
const INVITE: Record<string, string> = {
  needs_you: "needs_you",
  proposed: "draft",
  booking: "answered",
  booked: "answered",
  already_booked: "answered",
  sent: "answered",
  dropped: "left",
};
/** With no invite, its disposition's; unread or a question for a person needs you. */
const DISPOSITION: Record<string, string> = {
  interested: "needs_you",
  referral: "needs_you",
  other: "needs_you",
  meeting_booked: "answered",
  not_interested: "left",
  not_now: "left",
  wrong_person: "left",
};

/** A comment's state, in the queue's words. */
const COMMENT: Record<string, string> = {
  new: "needs_you",
  waiting: "needs_you",
  answered: "answered",
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
    const [email, texts, dms, said, accepted] = await Promise.all([
      rowsOf(
        db,
        sql`SELECT te.id, ci.id invite, ci.state invite_state, te.disposition,
              coalesce(nullif(concat_ws(' ', p.first_name, p.last_name), ''), p.full_name,
                te.from_address) who,
              co.name company, coalesce(te.received_at, te.created_at) at,
              coalesce(te.body_text, te.snippet) words
            FROM thread_events te
            LEFT JOIN call_invites ci ON ci.thread_event_id = te.id
            LEFT JOIN enrollments e ON e.id = te.enrollment_id
            LEFT JOIN people p ON p.id = e.person_id
            LEFT JOIN companies co ON co.id = e.company_id
            WHERE te.kind = 'reply'
            ORDER BY 7 DESC LIMIT ${ROWS}`,
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
      rowsOf(
        db,
        sql`SELECT c.id, c.author who, c.place company, c.body words, c.at, c.state, c.draft,
              p.read #>> '{business,value}' business
            FROM comments c
            LEFT JOIN reddit_people p ON c.platform = 'reddit' AND p.handle = lower(c.author)
            WHERE c.sort IS DISTINCT FROM 'ours'
            ORDER BY c.at DESC LIMIT ${ROWS}`,
      ),
      // An accepted invite is an opening: it waits on William until he messages or reads it.
      rowsOf(
        db,
        sql`SELECT c.id, coalesce(c.name, c.handle) who, c.headline company, c.connected_at at,
              EXISTS (SELECT 1 FROM reach_messages o WHERE o.contact_id = c.id AND o.direction = 'out'
                AND o.kind <> 'connect') answered,
              (c.read_at IS NULL OR c.read_at < c.connected_at) unread
            FROM reach_contacts c
            WHERE c.connected_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM reach_messages i WHERE i.contact_id = c.id AND i.direction = 'in')
            ORDER BY c.connected_at DESC LIMIT ${ROWS}`,
      ),
    ]);
    return [
      // ponytail: a reply with no invite has no page to answer from; it shows, unlinked.
      ...email.map(({ invite, invite_state, disposition, ...r }) => ({
        ...r,
        id: `email-${r.id}`,
        channel: "email",
        state: invite
          ? (INVITE[String(invite_state)] ?? "left")
          : (DISPOSITION[String(disposition)] ?? "needs_you"),
        open: invite ? `/inbox/replies/${invite}` : null,
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
      ...said.map(({ state, draft, business, ...r }) => ({
        ...r,
        id: `comment-${r.id}`,
        channel: "comment",
        company:
          [business, r.company ? `r/${r.company}` : null].filter(Boolean).join(" · ") || null,
        state: COMMENT[String(state)] === "needs_you" && draft ? "draft" : COMMENT[String(state)],
        open: `/marketing/comments/${r.id}`,
      })),
      ...accepted.map((r) => ({
        ...r,
        id: `invite-${r.id}`,
        channel: "invite",
        words: "Accepted your invite",
        state: stateOf(r),
        open: `/marketing/invites/${r.id}`,
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
        comment: { label: "Comment", tone: "neutral" },
        invite: { label: "LinkedIn invite", tone: "neutral" },
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
