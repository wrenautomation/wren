/**
 * The sent log as a console record (designs/2026-10-14-customerio-audit.md, B2): every message
 * we sent, on any channel, with one state ladder. Views in `./sent-views.ts`, which says what
 * each channel can prove. Read only: nothing here sends or changes a message.
 *
 * The address is shown as it was sent to. When profiles land (B1), `key_kind` and `key_value` on
 * the view are the `profile_keys` pair for the same address: join them there, show the profile's
 * name in `to`, and link the row to its profile.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { cued, date, defineRecord, name, status, text } from "./records.js";

/** The channels a message goes out on. The keys are access channels; each gets its mark. */
const CHANNELS = cued({
  email: { label: "Email", tone: "neutral" },
  sms: { label: "Text", tone: "neutral" },
  linkedin: { label: "LinkedIn", tone: "neutral" },
  reddit: { label: "Reddit", tone: "neutral" },
  instagram: { label: "Instagram", tone: "neutral" },
  x: { label: "X", tone: "neutral" },
  facebook: { label: "Facebook", tone: "neutral" },
  youtube: { label: "YouTube", tone: "neutral" },
  tiktok: { label: "TikTok", tone: "neutral" },
  threads: { label: "Threads", tone: "neutral" },
  google_business: { label: "Google", tone: "neutral" },
} as const);

/** What kind of message: a cold or follow-up email, a newsletter issue, a text, a DM, a comment. */
export const SENT_KINDS = {
  email: { label: "Email", tone: "neutral" },
  newsletter: { label: "Newsletter", tone: "neutral" },
  sms: { label: "Text", tone: "neutral" },
  dm: { label: "DM", tone: "neutral" },
  comment: { label: "Comment", tone: "neutral" },
} as const;

/**
 * The ladder, in order. A message sits at the furthest step it reached; bounced and failed win
 * over the rest. "Clicked" is declared but nothing sets it: email clicks stay in the lander.
 */
export const SENT_STATES = {
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  delivered: { label: "Delivered", tone: "good" },
  bounced: { label: "Bounced", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  opened: { label: "Opened", tone: "good" },
  clicked: { label: "Clicked", tone: "good" },
  replied: { label: "Replied", tone: "good" },
} as const;

/** What `load` hands the page: the message as it went out, for a preview. */
export interface SentDetail {
  /** `email`, `sms`, `dm`, `post` (a comment): the preview's kind. */
  as: "email" | "sms" | "dm" | "post";
  /** Where it went, for a DM or a comment: "LinkedIn". */
  site: string | null;
  from: string | null;
  to: string;
  subject: string | null;
  body: string;
}

const SITES: Readonly<Record<string, string>> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  instagram: "Instagram",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  threads: "Threads",
  google_business: "Google",
};

type Raw = Record<string, string | null>;
const rowsOf = async (db: Queryable, q: SQL) => (await db.execute(q)) as unknown as Raw[];

/** The columns every source selects; a missing one is null. */
const base = (m: Raw) => ({
  from: m.from ?? null,
  to: m.to ?? "",
  subject: m.subject ?? null,
  body: m.body ?? "",
});

/**
 * One message as it went out, read from its own table by its sent id (`email:12` is `messages`
 * row 12); null when the id names none.
 */
export async function sentDetail(db: Queryable, id: string): Promise<SentDetail | null> {
  const [source = "", ...rest] = id.split(":");
  const ref = rest.join(":");
  const n = /^\d+$/.test(ref) ? Number(ref) : null;
  if (source === "email" && n !== null) {
    const [m] = await rowsOf(
      db,
      sql`select e.sender "from", m.to_email "to", m.subject, m.body
        from messages m join enrollments e on e.id = m.enrollment_id where m.id = ${n}`,
    );
    return m ? { as: "email", site: null, ...base(m) } : null;
  }
  if (source === "newsletter" && n !== null) {
    const [m] = await rowsOf(
      db,
      sql`select c.address "to", b.title subject, b.body,
          e.evidence ->> 'url' url, e.evidence ->> 'issue' issue
        from consent_events e join consents c on c.id = e.consent_id
        left join blog_posts b on b.slug = split_part(e.evidence ->> 'issue', ':', 2)
        where e.id = ${n} and e.kind = 'sent' and c.channel = 'email'`,
    );
    if (!m) return null;
    // The mail is the post's text, then a line to the page (`issueMail`).
    const body = [m.body ?? "", m.url ? `On the site, with the pictures: ${m.url}` : ""];
    return {
      as: "email",
      site: null,
      from: null,
      to: m.to ?? "",
      subject: m.subject ?? m.issue ?? null,
      body: body.filter(Boolean).join("\n\n"),
    };
  }
  if (source === "sms" && n !== null) {
    const [m] = await rowsOf(
      db,
      sql`select from_e164 "from", to_e164 "to", body from sms_messages
        where id = ${n} and direction = 'out'`,
    );
    return m ? { as: "sms", site: null, ...base(m) } : null;
  }
  if (source === "dm" && n !== null) {
    const [m] = await rowsOf(
      db,
      sql`select c.platform, a.handle "from", c.handle "to", m.subject, m.body
        from reach_messages m join reach_contacts c on c.id = m.contact_id
        left join reach_accounts a on a.id = m.account_id
        where m.id = ${n} and m.direction = 'out'`,
    );
    return m ? { as: "dm", site: SITES[m.platform ?? ""] ?? null, ...base(m) } : null;
  }
  const [m] =
    source === "comment" && n !== null
      ? await rowsOf(
          db,
          sql`select k.platform, a.handle "from", k.author "to", k.answer body
            from comments k left join reach_accounts a on a.id = k.account_id
            where k.id = ${n} and k.answer is not null`,
        )
      : source === "post" && n !== null
        ? await rowsOf(
            db,
            sql`select p.platform, p.account "from", coalesce(p.handle, p.author) "to", p.comment body
              from reach_posts p where p.id = ${n} and p.comment is not null`,
          )
        : source === "thread" && ref
          ? await rowsOf(
              db,
              sql`select 'reddit' platform, null "from", r.author "to", r.answer body
                from reddit_threads r where r.id = ${ref} and r.answer is not null`,
            )
          : [];
  return m ? { as: "post", site: SITES[m.platform ?? ""] ?? null, ...base(m) } : null;
}

export const sentRecord = defineRecord({
  id: "people.sent",
  app: "people",
  channel: { field: "channel" },
  name: { one: "message", many: "messages" },
  view: "sent_records",
  key: "id",
  title: "subject",
  subtitle: "to",
  fields: {
    at: date("When"),
    channel: status(CHANNELS),
    kind: status(SENT_KINDS, "Type"),
    to: name("To", { from: "to_address" }),
    subject: text("Subject or first line"),
    state: status(SENT_STATES),
    channelState: text("Channel's own state"),
    campaign: text("Campaign or workflow"),
  },
  quick: ["channel", "state", "kind"],
  views: [
    { id: "all", label: "All", sort: "-at", at: "at" },
    {
      id: "failed",
      label: "Bounced and failed",
      where: { state: ["bounced", "failed"] },
      sort: "-at",
      at: "at",
    },
    {
      id: "opened",
      label: "Opened",
      where: { state: ["opened", "clicked"] },
      sort: "-at",
      at: "at",
    },
    { id: "replied", label: "Replied", where: { state: "replied" }, sort: "-at", at: "at" },
  ],
  activity: { view: "sent_activity", by: "message", seq: "seq", label: "History" },
  load: (db, id) => sentDetail(db, id),
});

export const SENT_RECORDS = [sentRecord];
