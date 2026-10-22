/**
 * The sync between Wren's consents and Listmonk's lists (designs/2026-10-21-esign-and-newsletter.md).
 * Wren owns consent: a person is on a list when their consent is confirmed. Listmonk may only take
 * a person off, and only when that change is newer than Wren's last word on the consent, so a
 * re-confirm in Wren wins and the two never undo each other. `planTopic` is pure; `syncTopic`
 * applies its plan.
 */
import type { Listmonk, ListmonkSubscriber } from "./client.js";
import { ListmonkError } from "./client.js";

/** Tags a list the sync made, naming its Wren topic: how a campaign finds its topic. */
export const TOPIC_TAG = "wren-topic:";
export const topicTag = (topic: string) => `${TOPIC_TAG}${topic}`;

export interface WrenConsent {
  consentId: number;
  address: string;
  state: string;
  /** The last time Wren changed this consent: confirmed, withdrawn or created. */
  changedAt: Date;
}

export interface TopicPlan {
  /** Confirmed in Wren, unknown to Listmonk. */
  create: string[];
  /** Confirmed in Wren, known to Listmonk but not on the list: put on it. */
  add: number[];
  /** No longer confirmed in Wren, still on the list in Listmonk: take off. */
  remove: number[];
  /** Taken off in Listmonk after Wren's last word: withdraw in Wren. */
  withdraw: { consentId: number; address: string }[];
}

const lower = (s: string) => s.trim().toLowerCase();

/** Whether Listmonk has this person off the list, and since when. Null = on it. */
function offSince(sub: ListmonkSubscriber, listId: number): Date | null {
  const mine = sub.lists.find((l) => l.id === listId);
  const blocked = sub.status === "blocklisted";
  const unsubscribed = mine?.subscription_status === "unsubscribed";
  if (!blocked && !unsubscribed) return null;
  const at = (blocked ? sub.updated_at : mine?.subscription_updated_at) ?? sub.updated_at;
  return at ? new Date(at) : new Date(0);
}

export function planTopic(o: {
  consents: WrenConsent[];
  subscribers: ListmonkSubscriber[];
  listId: number;
}): TopicPlan {
  const plan: TopicPlan = { create: [], add: [], remove: [], withdraw: [] };
  const byEmail = new Map(o.subscribers.map((s) => [lower(s.email), s]));
  const seen = new Set<string>();
  for (const c of o.consents) {
    const email = lower(c.address);
    seen.add(email);
    const sub = byEmail.get(email);
    const off = sub ? offSince(sub, o.listId) : null;
    const on = !!sub?.lists.some((l) => l.id === o.listId) && !off;
    if (c.state === "confirmed") {
      if (!sub) plan.create.push(c.address);
      else if (off && off > c.changedAt)
        plan.withdraw.push({ consentId: c.consentId, address: c.address });
      else if (!on) plan.add.push(sub.id);
    } else if (sub && on) {
      plan.remove.push(sub.id);
    }
  }
  return plan;
}

/** The name Listmonk shows for an address Wren knows only by email. */
const nameOf = (address: string) => address.split("@")[0] ?? address;

export interface TopicSync extends Record<keyof TopicPlan, number> {
  topic: string;
  listId: number;
}

/** One topic: make sure its list exists, then bring both sides in line. Returns how much moved. */
export async function syncTopic(o: {
  lm: Listmonk;
  topic: string;
  publicName?: string | null;
  consents: WrenConsent[];
  withdraw: (c: { consentId: number; address: string }) => Promise<unknown>;
}): Promise<TopicSync> {
  const { lm, topic } = o;
  const tag = topicTag(topic);
  const list =
    (await lm.lists()).find((l) => l.tags?.includes(tag)) ??
    (await lm.createList({ name: o.publicName?.trim() || topic, tags: [tag] }));
  const subscribers = await lm.subscribers();
  const plan = planTopic({ consents: o.consents, subscribers, listId: list.id });

  const added = [...plan.add];
  for (const address of plan.create) {
    try {
      await lm.createSubscriber({ email: address, name: nameOf(address), listId: list.id });
    } catch (e) {
      // The address exists under a different case, or was made since the read: add it by id.
      if (!(e instanceof ListmonkError) || e.status !== 409) throw e;
      const known = (await lm.subscribers()).find((s) => lower(s.email) === lower(address));
      if (known) added.push(known.id);
    }
  }
  await lm.setSubscription(added, list.id, "add");
  await lm.setSubscription(plan.remove, list.id, "unsubscribe");
  for (const w of plan.withdraw) await o.withdraw(w);
  return {
    topic,
    listId: list.id,
    create: plan.create.length,
    add: plan.add.length,
    remove: plan.remove.length,
    withdraw: plan.withdraw.length,
  };
}
