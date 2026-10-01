/**
 * Reply alerts on the phone app: web push to every device that turned them on.
 * A device is a browser push subscription (endpoint + keys), saved by the app
 * through SmsDesk.subscribe. The push service says when a subscription is gone
 * (404/410); that device is dropped.
 */
import type { Queryable } from "@wren/db";
import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { type SmsPushSubscription, smsPushSubscriptions } from "./schema.js";

/** What the app's service worker shows. `url` opens on tap. */
export interface PushAlert {
  title: string;
  body: string;
  url: string;
  /** One notification per thread: a newer one replaces it. */
  tag: string;
}

export interface Pusher {
  name: string;
  /** The key the app subscribes with. */
  publicKey: string;
  /** "gone" = the device unsubscribed or was reset: drop it. Throws on anything else. */
  push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  /** Who runs this sender, for the push services: a mailto: or https: URL. */
  subject: string;
}

export class WebPusher implements Pusher {
  readonly name = "web-push";
  readonly publicKey: string;
  constructor(private readonly vapid: Vapid) {
    this.publicKey = vapid.publicKey;
  }

  async push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone"> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(alert),
        { vapidDetails: this.vapid, TTL: 86_400, urgency: "high" },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      throw new Error(`push service answered ${status ?? (err as Error).message}`);
    }
  }
}

/** Tests: records every alert; endpoints in `gone` answer gone. */
export class FakePusher implements Pusher {
  readonly name = "fake";
  readonly publicKey = "fake-public-key";
  readonly sent: { endpoint: string; alert: PushAlert }[] = [];
  readonly gone = new Set<string>();

  async push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone"> {
    if (this.gone.has(sub.endpoint)) return "gone";
    this.sent.push({ endpoint: sub.endpoint, alert });
    return "ok";
  }
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Save this device; the same endpoint again updates its keys and operator. */
export async function subscribe(
  db: Queryable,
  sub: PushSubscriptionInput,
  operator: string,
): Promise<void> {
  const endpoint = new URL(sub.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("a push endpoint is https");
  if (!sub.keys?.p256dh || !sub.keys?.auth) throw new Error("a push subscription needs its keys");
  const row = { p256dh: sub.keys.p256dh, auth: sub.keys.auth, operator };
  await db
    .insert(smsPushSubscriptions)
    .values({ endpoint: endpoint.toString(), ...row })
    .onConflictDoUpdate({ target: smsPushSubscriptions.endpoint, set: row });
}

export async function unsubscribe(db: Queryable, endpoint: string): Promise<boolean> {
  const gone = await db
    .delete(smsPushSubscriptions)
    .where(eq(smsPushSubscriptions.endpoint, endpoint))
    .returning({ id: smsPushSubscriptions.id });
  return gone.length > 0;
}

/** Alert one device by its endpoint (the first alert after it subscribes). */
export async function pushOne(
  db: Queryable,
  pusher: Pusher,
  endpoint: string,
  alert: PushAlert,
): Promise<{ pushed: boolean; error: string | null }> {
  const [sub] = await db
    .select()
    .from(smsPushSubscriptions)
    .where(eq(smsPushSubscriptions.endpoint, new URL(endpoint).toString()));
  if (!sub) return { pushed: false, error: "this device is not subscribed" };
  try {
    if ((await pusher.push(sub, alert)) === "gone") {
      await db.delete(smsPushSubscriptions).where(eq(smsPushSubscriptions.id, sub.id));
      return { pushed: false, error: "the push service says this device is gone" };
    }
  } catch (err) {
    return { pushed: false, error: (err as Error).message };
  }
  await db
    .update(smsPushSubscriptions)
    .set({ lastPushedAt: new Date() })
    .where(eq(smsPushSubscriptions.id, sub.id));
  return { pushed: true, error: null };
}

export interface PushStats {
  sent: number;
  dropped: number;
  errors: string[];
}

/** Alert every device. One device failing never stops the rest. */
export async function pushAll(db: Queryable, pusher: Pusher, alert: PushAlert): Promise<PushStats> {
  const stats: PushStats = { sent: 0, dropped: 0, errors: [] };
  const subs = await db.select().from(smsPushSubscriptions);
  const ok: string[] = [];
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        if ((await pusher.push(sub, alert)) === "gone") gone.push(sub.id);
        else ok.push(sub.id);
      } catch (err) {
        stats.errors.push(`${new URL(sub.endpoint).host}: ${(err as Error).message}`);
      }
    }),
  );
  if (gone.length > 0)
    await db.delete(smsPushSubscriptions).where(inArray(smsPushSubscriptions.id, gone));
  if (ok.length > 0)
    await db
      .update(smsPushSubscriptions)
      .set({ lastPushedAt: new Date() })
      .where(inArray(smsPushSubscriptions.id, ok));
  stats.sent = ok.length;
  stats.dropped = gone.length;
  return stats;
}
