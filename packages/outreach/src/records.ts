/**
 * DMs as console records for the Marketing app: each person's thread (`marketing.dm`), each
 * template slot William writes (`marketing.dm_copy`), with what the preview needs to draw them,
 * and each comment on our posts (`marketing.comment`).
 */
import { date, defineRecord, link, name, number, prose, status, text } from "@wren/core/records";
import { sql } from "drizzle-orm";
import { accountById, listAccounts } from "./accounts.js";
import type { Platform } from "./schema.js";
import {
  MESSAGE_MAX,
  REACH_SEQUENCES,
  type RenderFields,
  sampleFields,
  slotsOf,
} from "./sequences.js";
import { listTemplates } from "./store.js";
import { getThread, listThreads } from "./threads.js";

/** ponytail: rows, not a view: reach holds a few hundred threads at most; a view past that. */
const THREAD_ROWS = 500;
const SITES: Record<Platform, string> = { reddit: "Reddit", linkedin: "LinkedIn" };
/** Where a template's words go in its message. */
const SLOT = "WRENSLOT";

const neutral = (label: string) => ({ label, tone: "neutral" as const });

export const dmRecord = defineRecord({
  id: "marketing.dm",
  name: { one: "DM thread", many: "DM threads" },
  rows: async (db) =>
    (await listThreads(db, { limit: THREAD_ROWS })).map((t) => ({
      id: t.contact.id,
      who: t.contact.name ?? t.contact.handle,
      headline: t.contact.headline,
      platform: t.contact.platform,
      account: t.account,
      state: t.contact.state,
      last_body: t.last?.body ?? null,
      last_at: t.last?.sentAt ?? t.last?.createdAt ?? null,
      direction: t.last?.direction ?? null,
      waiting: t.unread ? "waiting" : "read",
    })),
  key: "id",
  title: "who",
  subtitle: "headline",
  fields: {
    who: name("Who"),
    headline: text(),
    platform: status({ reddit: neutral("Reddit"), linkedin: neutral("LinkedIn") }, "Site"),
    account: text("From"),
    state: status({
      new: neutral("Found"),
      enrolled: neutral("Messaging"),
      connected: { label: "Connected", tone: "good" },
      replied: { label: "Replied", tone: "good" },
      finished: neutral("Finished"),
      unreachable: { label: "Unreachable", tone: "bad" },
      opted_out: { label: "Opted out", tone: "warn" },
      blocked: { label: "Blocked", tone: "bad" },
    }),
    direction: status(
      { in: { label: "Their turn", tone: "warn" }, out: neutral("Ours sent") },
      "Last",
    ),
    lastBody: text("Last message"),
    lastAt: date("When"),
    waiting: status({ waiting: { label: "Unread", tone: "warn" }, read: neutral("Read") }, "Read"),
  },
  views: [
    {
      id: "waiting",
      label: "Unread",
      where: { waiting: "waiting" },
      sort: "-lastAt",
      at: "lastAt",
    },
    { id: "replied", label: "Replied", where: { state: "replied" }, sort: "-lastAt", at: "lastAt" },
    { id: "all", label: "All", sort: "-lastAt", at: "lastAt" },
  ],
  actions: ["marketing.dmReply", "marketing.dmRead"],
  /** The thread oldest first, and the preview's app, sender and cap for a reply. */
  load: async (db, id) => {
    const t = await getThread(db, Number(id));
    const from = t.contact.accountId
      ? ((await accountById(db, t.contact.accountId)).handle ?? null)
      : null;
    return {
      messages: t.messages.map((m) => ({
        id: m.id,
        at: (m.sentAt ?? m.createdAt).toISOString(),
        direction: m.direction,
        kind: m.kind,
        subject: m.subject,
        body: m.body,
        state: m.state,
      })),
      dm: { site: SITES[t.contact.platform], from, max: MESSAGE_MAX },
    };
  },
});

/** Comments on our posts and under our comments, newest first, with the account that read them. */
export const commentRecord = defineRecord({
  id: "marketing.comment",
  name: { one: "comment", many: "comments" },
  rows: async (db) =>
    (await db.execute(sql`
      select c.id, c.author who, c.place, c.post_title, c.body, c.sort, c.why, c.draft, c.state,
        c.answer, c.at, c.url, a.handle account, c.contact_id
      from comments c join reach_accounts a on a.id = c.account_id
      order by c.at desc limit ${THREAD_ROWS}`)) as unknown as Array<Record<string, unknown>>,
  key: "id",
  title: "who",
  subtitle: "body",
  fields: {
    who: name("Who"),
    place: text("Subreddit"),
    postTitle: text("Post"),
    body: prose("Their words"),
    sort: status(
      {
        asked: { label: "Asked", tone: "good" },
        question: { label: "Question", tone: "warn" },
        chat: neutral("Chat"),
        hostile: { label: "Hostile", tone: "bad" },
        ours: neutral("Ours"),
      },
      "Read as",
    ),
    why: text("Why"),
    draft: prose("Draft answer"),
    state: status({
      new: neutral("Unread"),
      waiting: { label: "Waiting on you", tone: "warn" },
      answered: { label: "Answered", tone: "good" },
      dropped: neutral("Dropped"),
    }),
    answer: prose("Our answer"),
    account: text("On"),
    at: date("When"),
    url: link("On Reddit"),
  },
  views: [
    {
      id: "waiting",
      label: "Waiting on you",
      where: { state: ["new", "waiting"] },
      sort: "-at",
      at: "at",
    },
    { id: "answered", label: "Answered", where: { state: "answered" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["marketing.commentAnswer", "marketing.commentDm", "marketing.commentDrop"],
});

/** The slots and their words; the preview fills `{fields}` with `sender` and sample facts. */
export function dmCopyRecord(sender: string) {
  const slots = slotsOf(REACH_SEQUENCES.values());
  const sample: RenderFields = sampleFields(sender);
  return defineRecord({
    id: "marketing.dm_copy",
    name: { one: "DM template", many: "DM templates" },
    rows: async (db) =>
      (await listTemplates(db, slots, sender)).map((v) => ({
        id: v.key,
        purpose: v.purpose,
        platform: v.platform,
        body: v.body,
        filled: v.body ? "filled" : "empty",
        chars: v.body.length,
        max: v.maxLength,
        fields: `${v.fields.map((f) => `{${f}}`).join(" ")}; {field|fallback} when it may be empty`,
        updated_at: v.updatedAt,
        updated_by: v.updatedBy,
      })),
    key: "id",
    title: "purpose",
    subtitle: "body",
    fields: {
      purpose: text("Slot"),
      platform: status({ reddit: neutral("Reddit"), linkedin: neutral("LinkedIn") }, "Site"),
      body: prose("Your words"),
      filled: status(
        { filled: { label: "Written", tone: "good" }, empty: neutral("Empty: never goes") },
        "State",
      ),
      chars: number("Characters"),
      max: number("At most"),
      fields: text("Fields it may use"),
      updatedAt: date("Saved"),
      updatedBy: text("By"),
    },
    // No sort: key order, each platform's slots together.
    views: [
      { id: "all", label: "All" },
      { id: "empty", label: "Empty", where: { filled: "empty" } },
    ],
    actions: ["marketing.dmCopy"],
    /** The whole message around this slot: a subject slot sits on its step's words, and back. */
    load: async (db, id) => {
      const all = await listTemplates(db, slots, sender);
      const slot = all.find((v) => v.key === id);
      if (!slot) return null;
      const subject = id.endsWith(".subject");
      const other = all.find((v) => v.key === (subject ? id.slice(0, -8) : `${id}.subject`));
      const [account] = await listAccounts(db, slot.platform);
      return {
        sample,
        dm: {
          site: SITES[slot.platform],
          from: account?.handle ?? null,
          // A subject's cap is checked on save; the count shown is the message's.
          max: (subject ? other : slot)?.maxLength ?? slot.maxLength,
          frame: subject
            ? { subject: SLOT, body: other?.preview ?? "", slot: SLOT }
            : { subject: other?.preview || null, body: SLOT, slot: SLOT },
        },
      };
    },
  });
}
