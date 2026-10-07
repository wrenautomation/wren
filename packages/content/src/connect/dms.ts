/**
 * A client's DMs (designs/2026-10-07-client-social.md): its Facebook Page's, Instagram's and X's
 * conversations read into its own `reach_contacts` and `reach_messages`, so they land in its Inbox
 * as `dm:<id>` threads; an answer goes back through the same account. Every call is a `SiteClient`
 * call on `social:<connection id>`, so tests pass a fake and the worker journals each one.
 */

import { keepSentEdit } from "@wren/core/ask";
import type { SiteClient } from "@wren/core/content";
import { recordDraft } from "@wren/core/draft-record";
import { recordTouch } from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { type ReachContact, ReachRefusal, reachContacts, reachMessages } from "@wren/outreach";
import { and, desc, eq } from "drizzle-orm";
import { loginOf } from "./access.js";
import type { SocialPlatform } from "./platforms.js";
import type { SocialConnectionRow } from "./schema.js";

/** The platforms whose DMs Wren reads and answers. */
export const DM_SOCIAL = [
  "facebook",
  "instagram",
  "x",
] as const satisfies readonly SocialPlatform[];
export type DmSocial = (typeof DM_SOCIAL)[number];
export const isDmSocial = (p: string): p is DmSocial =>
  (DM_SOCIAL as readonly string[]).includes(p);

/** Meta lets a Page answer only within a day of their last message. */
export const META_WINDOW_MS = 24 * 3_600_000;
/** Messages per conversation read each pass. */
const TAIL = 10;

export interface DmMessage {
  id: string;
  text: string;
  at: string;
  mine: boolean;
}
export interface DmThread {
  /** The person on the other side: the platform's id for them, and how they show. */
  them: { id: string; handle: string; name: string | null };
  messages: DmMessage[];
}

/** What reading and keeping need of a connection: plain, so it journals as is. */
export type DmAccount = Pick<
  SocialConnectionRow,
  "id" | "platform" | "externalId" | "handle" | "name" | "extra"
>;

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const listOf = (v: unknown) => ((v as { data?: Json[] } | undefined)?.data ?? []) as Json[];

/** Its conversations, newest first, each with its last few messages. */
export async function readDms(sites: SiteClient, c: DmAccount): Promise<DmThread[]> {
  const account = loginOf(c.id);
  if (c.platform === "facebook" || c.platform === "instagram") {
    const pageId = c.extra.pageId;
    if (!pageId) return [];
    const self = c.platform === "instagram" ? c.extra.igUserId : pageId;
    const r = await sites.call<Json>(
      "meta",
      "GET",
      `/${pageId}/conversations`,
      {
        platform: c.platform === "instagram" ? "instagram" : "messenger",
        fields: `participants,updated_time,messages.limit(${TAIL}){id,message,from,created_time}`,
        limit: 25,
      },
      account,
    );
    return listOf(r).flatMap((conv): DmThread[] => {
      const people = listOf(conv.participants);
      const them = people.find((p) => String(p.id) !== self);
      if (!them) return [];
      const messages = listOf(conv.messages).map((m) => ({
        id: String(m.id),
        text: String(m.message ?? ""),
        at: String(m.created_time ?? ""),
        mine: String((m.from as Json | undefined)?.id ?? "") === self,
      }));
      return [
        {
          them: {
            id: String(them.id),
            handle: str(them.username) ?? String(them.id),
            name: str(them.name) ?? str(them.username),
          },
          messages: messages.filter((m) => m.text).reverse(),
        },
      ];
    });
  }
  if (c.platform === "x") {
    const r = await sites.call<Json>(
      "x",
      "GET",
      "/2/dm_events",
      {
        "dm_event.fields": "id,text,created_at,sender_id,dm_conversation_id,event_type",
        event_types: "MessageCreate",
        expansions: "sender_id,participant_ids",
        "user.fields": "username,name",
        max_results: 50,
      },
      account,
    );
    const users = new Map(
      (((r.includes as Json | undefined)?.users as Json[] | undefined) ?? []).map((u) => [
        String(u.id),
        u,
      ]),
    );
    const byConv = new Map<string, DmThread>();
    for (const e of listOf(r)) {
      const conv = String(e.dm_conversation_id ?? "");
      // One to one: the conversation id is both ids joined by a dash.
      const other = conv.split("-").find((id) => id && id !== c.externalId);
      if (!other) continue;
      const u = users.get(other);
      const t = byConv.get(conv) ?? {
        them: {
          id: other,
          handle: str(u?.username) ?? other,
          name: str(u?.name) ?? str(u?.username),
        },
        messages: [],
      };
      t.messages.push({
        id: String(e.id),
        text: String(e.text ?? ""),
        at: String(e.created_at ?? ""),
        mine: String(e.sender_id) === c.externalId,
      });
      byConv.set(conv, t);
    }
    return [...byConv.values()].map((t) => ({
      ...t,
      messages: t.messages
        .filter((m) => m.text)
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-TAIL),
    }));
  }
  return [];
}

const urlOf = (p: DmSocial, them: DmThread["them"]) =>
  p === "x"
    ? `https://x.com/${them.handle}`
    : p === "instagram"
      ? `https://www.instagram.com/${them.handle}/`
      : `https://www.facebook.com/${them.id}`;

/** The contact's own record of who it is on the platform and which account it talks to. */
interface DmProfile {
  id: string;
  connection: number;
}
export const profileOf = (c: ReachContact): DmProfile | null => {
  const p = c.profile as Partial<DmProfile> | null;
  return p && typeof p.id === "string" && typeof p.connection === "number"
    ? { id: p.id, connection: p.connection }
    : null;
};

/**
 * Keep what was read: a contact per person, each message once (theirs by its id; ours only when
 * Wren didn't send it). A new message of theirs is a `theirs` touch. Answers how many were new.
 */
export async function keepDms(
  db: Queryable,
  c: DmAccount,
  threads: readonly DmThread[],
): Promise<{ threads: number; messages: number }> {
  if (!isDmSocial(c.platform)) return { threads: 0, messages: 0 };
  const platform = c.platform;
  let fresh = 0;
  for (const t of threads) {
    if (!t.messages.length) continue;
    const profile: DmProfile = { id: t.them.id, connection: c.id };
    const [contact] = await db
      .insert(reachContacts)
      .values({
        platform,
        handle: t.them.handle.slice(0, 120),
        url: urlOf(platform, t.them),
        name: t.them.name,
        foundIn: loginOf(c.id),
        profile,
        state: "replied",
      })
      .onConflictDoUpdate({
        target: [reachContacts.platform, reachContacts.handle],
        set: { name: t.them.name, profile },
      })
      .returning();
    if (!contact) continue;
    for (const m of t.messages) {
      const at = new Date(m.at);
      const when = Number.isNaN(at.getTime()) ? new Date() : at;
      if (m.mine) {
        const [had] = await db
          .select({ id: reachMessages.id })
          .from(reachMessages)
          .where(and(eq(reachMessages.contactId, contact.id), eq(reachMessages.ref, m.id)));
        if (had) continue;
        await db.insert(reachMessages).values({
          contactId: contact.id,
          direction: "out",
          kind: "manual",
          body: m.text,
          state: "sent",
          sentAt: when,
          ref: m.id.slice(0, 200),
        });
        continue;
      }
      const [row] = await db
        .insert(reachMessages)
        .values({
          contactId: contact.id,
          direction: "in",
          kind: "inbound",
          body: m.text,
          state: "received",
          sentAt: when,
          ref: m.id.slice(0, 200),
        })
        .onConflictDoNothing()
        .returning({ id: reachMessages.id });
      if (!row) continue;
      fresh += 1;
      await recordTouch(db, {
        platform,
        handle: t.them.handle,
        name: t.them.name,
        kind: "dm",
        direction: "theirs",
        account: c.handle ?? c.name,
        url: urlOf(platform, t.them),
        text: m.text,
        at: when,
        externalId: m.id,
        source: "social",
        ref: `sdm:${platform}:${m.id}`.slice(0, 200),
      }).catch(() => null);
    }
  }
  return { threads: threads.length, messages: fresh };
}

export interface DmPlan {
  contactId: number;
  platform: DmSocial;
  connection: number;
  to: string;
  body: string;
  messageId: number;
}

/**
 * Everything that refuses an answer before the platform is asked, then its row as `sending`: the
 * reach sender never picks it up (no account, never `queued`).
 */
export async function planDm(
  db: Queryable,
  o: { contactId: number; body: string; now: Date; live: (id: number) => Promise<boolean> },
): Promise<DmPlan> {
  const body = o.body.trim();
  if (!body) throw new ReachRefusal("the message is empty");
  const [contact] = await db.select().from(reachContacts).where(eq(reachContacts.id, o.contactId));
  if (!contact) throw new ReachRefusal(`no contact ${o.contactId}`);
  if (!isDmSocial(contact.platform)) throw new ReachRefusal("not a connected account's DM");
  if (contact.state === "opted_out") throw new ReachRefusal("they asked to stop");
  const p = profileOf(contact);
  if (!p) throw new ReachRefusal("no connected account talks to them");
  if (!(await o.live(p.connection)))
    throw new ReachRefusal("its account isn't connected. Fix it on Account → Social.");
  if (contact.platform !== "x") {
    const [last] = await db
      .select({ at: reachMessages.sentAt })
      .from(reachMessages)
      .where(and(eq(reachMessages.contactId, contact.id), eq(reachMessages.direction, "in")))
      .orderBy(desc(reachMessages.sentAt))
      .limit(1);
    if (!last?.at || o.now.getTime() - last.at.getTime() > META_WINDOW_MS)
      throw new ReachRefusal("Meta lets a Page answer only within 24 hours of their last message");
  }
  const [msg] = await db
    .insert(reachMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: "manual",
      body,
      state: "sending",
      dueAt: o.now,
    })
    .returning({ id: reachMessages.id });
  if (!msg) throw new Error("dm: the message didn't save");
  return {
    contactId: contact.id,
    platform: contact.platform,
    connection: p.connection,
    to: p.id,
    body,
    messageId: msg.id,
  };
}

/** The platform call: the answer's id. */
export async function sendDm(
  sites: SiteClient,
  plan: DmPlan,
  pageId: string | null,
): Promise<{ ref: string | null }> {
  const account = loginOf(plan.connection);
  if (plan.platform === "x") {
    const r = await sites.call<Json>(
      "x",
      "POST",
      `/2/dm_conversations/with/${encodeURIComponent(plan.to)}/messages`,
      { text: plan.body },
      account,
    );
    return { ref: str((r.data as Json | undefined)?.dm_event_id) };
  }
  if (!pageId) throw new ReachRefusal("its Page is unknown. Connect it again.");
  const r = await sites.call<Json>(
    "meta",
    "POST",
    `/${pageId}/messages`,
    { recipient: { id: plan.to }, message: { text: plan.body }, messaging_type: "RESPONSE" },
    account,
  );
  return { ref: str(r.message_id) };
}

/** Sent: the row, the contact read and its draft cleared, the touch, the draft's log. */
export async function sentDm(
  db: Queryable,
  plan: DmPlan,
  o: { ref: string | null; now: Date; by: string },
): Promise<void> {
  const [contact] = await db
    .select()
    .from(reachContacts)
    .where(eq(reachContacts.id, plan.contactId));
  await db
    .update(reachMessages)
    .set({ state: "sent", sentAt: o.now, ref: o.ref })
    .where(eq(reachMessages.id, plan.messageId));
  if (!contact) return;
  await keepSentEdit(db, {
    record: "dm",
    id: String(contact.id),
    by: o.by,
    before: contact.draft,
    after: plan.body,
  });
  await db
    .update(reachContacts)
    .set({ draft: null, readAt: o.now })
    .where(eq(reachContacts.id, contact.id));
  await recordTouch(db, {
    platform: plan.platform,
    handle: contact.handle,
    name: contact.name,
    kind: "dm",
    direction: "ours",
    account: loginOf(plan.connection),
    url: contact.url,
    text: plan.body,
    at: o.now,
    externalId: o.ref,
    source: "social",
    ref: `sdm:out:${plan.messageId}`,
  }).catch(() => null);
  await recordDraft(db, {
    item: `dm:${contact.id}`,
    platform: plan.platform,
    event: "sent",
    via: "person",
    by: o.by,
    text: plan.body,
    externalId: o.ref,
    ref: `sent:dm:${plan.messageId}`,
  });
}

/** Refused by the platform: the row says why, nothing resends it. */
export async function failedDm(db: Queryable, messageId: number, why: string): Promise<void> {
  await db
    .update(reachMessages)
    .set({ state: "failed", stateReason: why.slice(0, 300) })
    .where(eq(reachMessages.id, messageId));
}
