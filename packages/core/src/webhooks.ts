/**
 * Outbound webhooks (designs/2026-10-07-webhooks-out.md): what a client's URL hears, signed the
 * Standard Webhooks way, posted past an SSRF guard, tried again on a ladder by Restate, every try
 * logged. Also the Send webhook node's step. The pure half is `./webhook-events.ts`.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { openToken, sealToken } from "./doors.js";
import { PortalRefusal } from "./portal.js";
import { serviceHandler } from "./restate/form.js";
import {
  type DeliveryState,
  type WebhookSubscription,
  webhookAttempts,
  webhookDeliveries,
  webhookSubscriptions,
} from "./schema.js";
import type { Step } from "./spine.js";
import {
  answerKept,
  bodyOf,
  fillText,
  headersOf,
  isWebhookEvent,
  keepOf,
  privateIp,
  TEST_EVENT,
  urlProblem,
  WEBHOOK_EVENTS,
  WEBHOOK_METHODS,
  type WebhookEvent,
} from "./webhook-events.js";

// ---- Signing: Standard Webhooks (standardwebhooks.com) ----

/** A new secret: `whsec_` and 24 random bytes, base64. */
export const newSecret = () => `whsec_${randomBytes(24).toString("base64")}`;

const keyOf = (secret: string) => Buffer.from(secret.replace(/^whsec_/, ""), "base64");

/** `v1,<base64 HMAC-SHA256 of "id.timestamp.body">`. */
export const signatureOf = (secret: string, id: string, ts: number, body: string) =>
  `v1,${createHmac("sha256", keyOf(secret)).update(`${id}.${ts}.${body}`).digest("base64")}`;

/** The three headers a delivery carries; each secret signs, space separated. */
export function signedHeaders(
  secrets: readonly string[],
  id: string,
  ts: number,
  body: string,
): Record<string, string> {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": secrets.map((s) => signatureOf(s, id, ts, body)).join(" "),
  };
}

/** Five minutes either way: an older or newer timestamp is a replay. */
export const TOLERANCE_S = 300;

/**
 * A receiver's check, for tests and for clients who ask: the timestamp within five minutes, and
 * one of the signatures this secret's.
 */
export function verifyWebhook(
  secret: string,
  headers: Readonly<Record<string, string | undefined>>,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const id = headers["webhook-id"];
  const ts = Number(headers["webhook-timestamp"]);
  const sigs = headers["webhook-signature"];
  if (!id || !Number.isInteger(ts) || !sigs) return false;
  if (Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const want = Buffer.from(signatureOf(secret, id, ts, body));
  return sigs.split(" ").some((s) => {
    const got = Buffer.from(s);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** A stable `webhook-id`: one Restate call, one event, one subject. */
export const eventIdOf = (call: string, event: string, subject: string) =>
  `msg_${createHash("sha256").update(`${call}|${event}|${subject}`).digest("base64url").slice(0, 32)}`;

// ---- Posting past the guard ----

export interface Answer {
  /** Null: no answer (refused, timed out, the guard). */
  status: number | null;
  ms: number;
  /** The first 64 KB of the answer. */
  body: string;
  error?: string;
}

type Resolve = (host: string) => Promise<LookupAddress[]>;
const systemResolve: Resolve = (host) =>
  new Promise((ok, no) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, list) => (err ? no(err) : ok(list))),
  );

export interface PostOptions {
  /** Where the host resolves; the system's by default. Tests pass their own. */
  resolve?: Resolve;
  timeoutMs?: number;
  maxBytes?: number;
}

/** What a log keeps of an answer. */
export const SNIPPET = 1000;

/**
 * One request, only to a public https address: the URL is checked, then every address the host
 * resolves to, inside the socket's own lookup, so a rebind between check and connect can't
 * reach a private one. No redirects. Never throws: a failure is an answer with no status.
 */
export async function safePost(
  r: { url: string; method?: string; headers?: Record<string, string>; body?: string },
  o: PostOptions = {},
): Promise<Answer> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const why = urlProblem(r.url);
  if (why) return { status: null, ms: 0, body: "", error: why };
  const resolve = o.resolve ?? systemResolve;
  const maxBytes = o.maxBytes ?? 65_536;
  const u = new URL(r.url);
  return new Promise<Answer>((done) => {
    let settled = false;
    const finish = (a: Omit<Answer, "ms">) => {
      if (settled) return;
      settled = true;
      done({ ...a, ms: ms() });
    };
    const req = request(
      {
        protocol: "https:",
        hostname: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: r.method ?? "POST",
        headers: {
          "user-agent": "Wren-Webhooks/1",
          ...(r.body !== undefined
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(r.body) }
            : {}),
          ...r.headers,
        },
        timeout: o.timeoutMs ?? 10_000,
        agent: false,
        lookup: (host, opts, cb) => {
          resolve(host).then(
            (all) => {
              const bad = all.find((a) => privateIp(a.address));
              if (!all.length || bad) {
                const err = Object.assign(new Error("that host resolves to a private address"), {
                  code: "EPRIVATE",
                });
                return cb(err, "", 4);
              }
              const want = (opts as { family?: number }).family;
              const fits = all.filter((a) => !want || a.family === want);
              const list = fits.length ? fits : all;
              if ((opts as { all?: boolean }).all)
                return (cb as unknown as (e: null, l: LookupAddress[]) => void)(null, list);
              const first = list[0] as LookupAddress;
              cb(null, first.address, first.family);
            },
            (err: Error) => cb(err as NodeJS.ErrnoException, "", 4),
          );
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          if (size >= maxBytes) return;
          chunks.push(c);
          size += c.length;
          if (size >= maxBytes) res.destroy();
        });
        const end = () =>
          finish({
            status: res.statusCode ?? null,
            body: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8"),
          });
        res.on("end", end);
        res.on("close", end);
        res.on("error", end);
      },
    );
    req.on("timeout", () => req.destroy(new Error("no answer in time")));
    req.on("error", (err: NodeJS.ErrnoException) =>
      finish({ status: null, body: "", error: errorWords(err) }),
    );
    if (r.body !== undefined) req.write(r.body);
    req.end();
  });
}

function errorWords(err: NodeJS.ErrnoException): string {
  if (err.code === "EPRIVATE") return err.message;
  if (err.code === "ENOTFOUND") return "the host isn't found";
  if (err.code === "ECONNREFUSED") return "the connection was refused";
  if (err.code === "ECONNRESET") return "the connection was cut";
  if (/certificate|CERT/i.test(`${err.code} ${err.message}`)) return "the TLS certificate failed";
  return err.message.slice(0, 200) || "no answer";
}

/** Worth trying again: no answer, 408, 425, 429 or 5xx. Any other 4xx won't change. */
export const retryable = (a: Pick<Answer, "status">) =>
  a.status === null || a.status === 408 || a.status === 425 || a.status === 429 || a.status >= 500;
export const delivered = (a: Pick<Answer, "status">) =>
  a.status !== null && a.status >= 200 && a.status < 300;

/** After each failed try: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h. Seven tries over about 21 h. */
export const DELIVERY_LADDER_MS = [
  60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
] as const;
export const DELIVERY_TRIES = DELIVERY_LADDER_MS.length + 1;

// ---- Subscriptions ----

/** A subscription as anyone may see it: never its secret. */
export interface SubscriptionView {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  by: string;
  at: string;
  rotatedAt: string | null;
  /** The old secret still signs until then. */
  prevUntil: string | null;
}

const viewOf = (s: WebhookSubscription): SubscriptionView => ({
  id: s.id,
  name: s.name,
  url: s.url,
  events: s.events,
  active: s.active,
  by: s.by,
  at: s.at.toISOString(),
  rotatedAt: s.rotatedAt?.toISOString() ?? null,
  prevUntil: s.prevUntil?.toISOString() ?? null,
});

const whose = (client: string | null) =>
  client === null ? isNull(webhookSubscriptions.client) : eq(webhookSubscriptions.client, client);

export async function subscriptionsOf(
  db: Queryable,
  client: string | null,
): Promise<SubscriptionView[]> {
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(whose(client))
    .orderBy(desc(webhookSubscriptions.at));
  return rows.map(viewOf);
}

/** At most this many URLs per client. */
export const MOST_SUBSCRIPTIONS = 20;

export const SubscriptionInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().max(2000),
  events: z.array(z.string()).min(1).max(Object.keys(WEBHOOK_EVENTS).length),
});

function checked(input: { name: string; url: string; events: readonly string[] }) {
  const why = urlProblem(input.url);
  if (why) throw new PortalRefusal(why, 400);
  const bad = input.events.filter((e) => !isWebhookEvent(e));
  if (bad.length) throw new PortalRefusal(`no such event: ${bad.join(", ")}`, 400);
  return { name: input.name.trim(), url: input.url.trim(), events: [...new Set(input.events)] };
}

const sealed = (secret: string) => {
  const s = sealToken(secret);
  if (!s) throw new PortalRefusal("webhooks need WREN_HOOK_KEY set", 503);
  return s;
};

/** A new subscription and its secret, shown this once. */
export async function addSubscription(
  db: Queryable,
  client: string | null,
  input: { name: string; url: string; events: readonly string[] },
  by: string,
): Promise<{ subscription: SubscriptionView; secret: string }> {
  const v = checked(input);
  const [{ n = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(webhookSubscriptions)
    .where(whose(client));
  if (n >= MOST_SUBSCRIPTIONS) throw new PortalRefusal(`at most ${MOST_SUBSCRIPTIONS} URLs`, 409);
  const secret = newSecret();
  const [row] = await db
    .insert(webhookSubscriptions)
    .values({ client, ...v, secret: sealed(secret), by })
    .returning();
  if (!row) throw new Error("subscription not saved");
  return { subscription: viewOf(row), secret };
}

async function mine(db: Queryable, client: string | null, id: string) {
  if (!z.uuid().safeParse(id).success) throw new PortalRefusal("no such webhook", 404);
  const [row] = await db
    .select()
    .from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.id, id), whose(client)));
  if (!row) throw new PortalRefusal("no such webhook", 404);
  return row;
}

/** Name, URL, events or on/off changed; the secret stays. */
export async function editSubscription(
  db: Queryable,
  client: string | null,
  id: string,
  edit: { name?: string; url?: string; events?: readonly string[]; active?: boolean },
): Promise<SubscriptionView> {
  const was = await mine(db, client, id);
  const v = checked({
    name: edit.name ?? was.name,
    url: edit.url ?? was.url,
    events: edit.events ?? was.events,
  });
  const [row] = await db
    .update(webhookSubscriptions)
    .set({ ...v, active: edit.active ?? was.active })
    .where(eq(webhookSubscriptions.id, id))
    .returning();
  return viewOf(row ?? was);
}

export async function removeSubscription(db: Queryable, client: string | null, id: string) {
  await mine(db, client, id);
  await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
  return { removed: id };
}

/** How long the old secret still signs after a rotate. */
export const ROTATE_GRACE_MS = 86_400_000;

/** A new secret, shown this once; the old one signs beside it for 24 hours. */
export async function rotateSubscription(
  db: Queryable,
  client: string | null,
  id: string,
  now = new Date(),
): Promise<{ subscription: SubscriptionView; secret: string }> {
  const was = await mine(db, client, id);
  const secret = newSecret();
  const [row] = await db
    .update(webhookSubscriptions)
    .set({
      secret: sealed(secret),
      prevSecret: was.secret,
      prevUntil: new Date(now.getTime() + ROTATE_GRACE_MS),
      rotatedAt: now,
    })
    .where(eq(webhookSubscriptions.id, id))
    .returning();
  return { subscription: viewOf(row ?? was), secret };
}

/** The secrets that sign now: the current one, and the old one in its grace. */
export function secretsOf(s: WebhookSubscription, now: Date, raw?: string): string[] {
  const cur = openToken(s.secret, raw);
  const prev =
    s.prevSecret && s.prevUntil && s.prevUntil > now ? openToken(s.prevSecret, raw) : null;
  return [cur, prev].filter((x): x is string => !!x);
}

// ---- Deliveries ----

export interface DeliveryView {
  id: string;
  subscription: string;
  event: string;
  eventId: string;
  state: DeliveryState;
  attempts: number;
  status: number | null;
  latencyMs: number | null;
  response: string | null;
  error: string | null;
  at: string;
  lastAt: string | null;
}

const deliveryView = (d: typeof webhookDeliveries.$inferSelect): DeliveryView => ({
  id: d.id,
  subscription: d.subscription,
  event: d.event,
  eventId: d.eventId,
  state: d.state,
  attempts: d.attempts,
  status: d.status,
  latencyMs: d.latencyMs,
  response: d.response,
  error: d.error,
  at: d.at.toISOString(),
  lastAt: d.lastAt?.toISOString() ?? null,
});

/** The newest deliveries of a client's subscriptions, or of one. */
export async function deliveriesOf(
  db: Queryable,
  client: string | null,
  o: { subscription?: string; limit?: number } = {},
): Promise<DeliveryView[]> {
  const subs = (await subscriptionsOf(db, client)).map((s) => s.id);
  const ids = o.subscription ? subs.filter((s) => s === o.subscription) : subs;
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.subscription, ids))
    .orderBy(desc(webhookDeliveries.at))
    .limit(Math.min(200, o.limit ?? 50));
  return rows.map(deliveryView);
}

/** A client's delivery, with the body as sent and every try. */
export async function deliveryOf(db: Queryable, client: string | null, id: string) {
  if (!z.uuid().safeParse(id).success) throw new PortalRefusal("no such delivery", 404);
  const [row] = await db
    .select({ d: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(webhookSubscriptions, eq(webhookSubscriptions.id, webhookDeliveries.subscription))
    .where(and(eq(webhookDeliveries.id, id), whose(client)));
  if (!row) throw new PortalRefusal("no such delivery", 404);
  const attempts = await db
    .select()
    .from(webhookAttempts)
    .where(eq(webhookAttempts.delivery, id))
    .orderBy(webhookAttempts.n);
  return {
    ...deliveryView(row.d),
    payload: row.d.payload,
    tries: attempts.map((a) => ({
      n: a.n,
      status: a.status,
      latencyMs: a.latencyMs,
      response: a.response,
      error: a.error,
      at: a.at.toISOString(),
    })),
  };
}

/**
 * A finished delivery set going again; null when it's sending now. The flip from delivered or
 * failed to pending is the guard, so two presses send once.
 */
export async function reopen(db: Queryable, id: string): Promise<string | null> {
  const [row] = await db
    .update(webhookDeliveries)
    .set({ state: "pending", attempts: 0, error: null })
    .where(
      and(eq(webhookDeliveries.id, id), inArray(webhookDeliveries.state, ["delivered", "failed"])),
    )
    .returning({ id: webhookDeliveries.id });
  return row?.id ?? null;
}

/** A client's finished delivery, set going again; refused while it's sending. */
export async function reopenDelivery(db: Queryable, client: string | null, id: string) {
  await deliveryOf(db, client, id);
  const got = await reopen(db, id);
  if (!got) throw new PortalRefusal("it's sending now", 409);
  return got;
}

/** What a client's URL gets: Standard Webhooks' shape. */
export interface Payload {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** One event in: a delivery per active subscription that hears it. Again does nothing. */
export async function queueDeliveries(
  db: Queryable,
  p: { client: string | null; event: WebhookEvent | typeof TEST_EVENT; id: string; payload: Payload },
  only?: string,
): Promise<string[]> {
  const subs = await db
    .select({ id: webhookSubscriptions.id })
    .from(webhookSubscriptions)
    .where(
      and(
        whose(p.client),
        only
          ? eq(webhookSubscriptions.id, only)
          : and(
              eq(webhookSubscriptions.active, true),
              sql`${p.event} = any(${webhookSubscriptions.events})`,
            ),
      ),
    );
  if (!subs.length) return [];
  const rows = await db
    .insert(webhookDeliveries)
    .values(
      subs.map((s) => ({
        subscription: s.id,
        event: p.event,
        eventId: p.id,
        payload: p.payload,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  return rows.map((r) => r.id);
}

/** One try of a delivery, logged. `last`: a failure now is final. */
export async function attemptDelivery(
  db: Queryable,
  id: string,
  last: boolean,
  o: PostOptions & { now?: Date; key?: string } = {},
): Promise<{ done: boolean; answer: Answer | null }> {
  const [row] = await db
    .select({ d: webhookDeliveries, s: webhookSubscriptions })
    .from(webhookDeliveries)
    .innerJoin(webhookSubscriptions, eq(webhookSubscriptions.id, webhookDeliveries.subscription))
    .where(eq(webhookDeliveries.id, id));
  if (!row || row.d.state !== "pending") return { done: true, answer: null };
  const test = row.d.event === TEST_EVENT;
  if (!row.s.active && !test) {
    await db
      .update(webhookDeliveries)
      .set({ state: "failed", error: "the webhook is off" })
      .where(eq(webhookDeliveries.id, id));
    return { done: true, answer: null };
  }
  const now = o.now ?? new Date();
  const secrets = secretsOf(row.s, now, o.key);
  const body = JSON.stringify(row.d.payload);
  const answer: Answer = secrets.length
    ? await safePost(
        {
          url: row.s.url,
          headers: signedHeaders(secrets, row.d.eventId, Math.floor(now.getTime() / 1000), body),
          body,
        },
        o,
      )
    : { status: null, ms: 0, body: "", error: "the secret won't open: WREN_HOOK_KEY changed" };
  const n = row.d.attempts + 1;
  const ok = delivered(answer);
  const done = ok || last || !retryable(answer);
  const snippet = answer.body.slice(0, SNIPPET) || null;
  await db.insert(webhookAttempts).values({
    delivery: id,
    n,
    status: answer.status,
    latencyMs: answer.ms,
    response: snippet,
    error: answer.error ?? null,
  });
  await db
    .update(webhookDeliveries)
    .set({
      state: ok ? "delivered" : done ? "failed" : "pending",
      attempts: n,
      status: answer.status,
      latencyMs: answer.ms,
      response: snippet,
      error: ok ? null : (answer.error ?? `answered ${answer.status}`),
      lastAt: now,
    })
    .where(eq(webhookDeliveries.id, id));
  return { done, answer };
}

// ---- The service ----

export const WEBHOOKS = { name: "Webhooks" } as const;

/** An event the spine heard that a client's URL may want. */
export interface Published {
  client: string | null;
  event: WebhookEvent;
  /** `eventIdOf`: the same on a retried call. */
  id: string;
  subject: string;
  data: Record<string, unknown>;
}

export type WebhooksService = {
  publish: (ctx: restate.Context, p: Published) => Promise<{ queued: number }>;
  deliver: (ctx: restate.Context, req: { id: string }) => Promise<{ state: string }>;
  redeliver: (ctx: restate.Context, req: { id: string }) => Promise<{ id: string }>;
};

/** Hand an event to `Webhooks/publish` from a handler: journaled, so it goes once. */
export function webhooksPublish(
  ctx: restate.Context,
  p: { client: string | null; event: WebhookEvent; subject: string; data: Record<string, unknown> },
) {
  ctx
    .serviceSendClient<WebhooksService>(WEBHOOKS)
    .publish({ ...p, id: eventIdOf(ctx.request().id, p.event, p.subject) });
}

const TRY = { maxRetryAttempts: 5 };

export function makeWebhooks(d: { main: Db }) {
  return restate.service({
    name: WEBHOOKS.name,
    handlers: {
      /** An event: a delivery per subscription that hears it, each sent on its own call. */
      publish: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, p: Published) => {
          const timestamp = new Date(await ctx.date.now()).toISOString();
          const payload: Payload = {
            type: p.event,
            timestamp,
            data: { subject: p.subject, ...p.data },
          };
          const ids = await ctx.run("queue", () =>
            queueDeliveries(d.main, { client: p.client, event: p.event, id: p.id, payload }),
          );
          for (const id of ids)
            ctx.serviceSendClient<WebhooksService>(WEBHOOKS).deliver({ id });
          return { queued: ids.length };
        },
      ),
      /** Tries until it lands, a 4xx says no, or the ladder runs out. Each try is journaled. */
      deliver: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { id: string }) => {
          for (let n = 1; n <= DELIVERY_TRIES; n++) {
            const r = await ctx.run(
              `try ${n}`,
              async () => {
                const got = await attemptDelivery(d.main, req.id, n === DELIVERY_TRIES);
                return { done: got.done, ok: !!got.answer && delivered(got.answer) };
              },
              TRY,
            );
            if (r.done) return { state: r.ok ? "delivered" : "stopped" };
            await ctx.sleep(DELIVERY_LADDER_MS[n - 1] ?? 0);
          }
          return { state: "failed" };
        },
      ),
      /** A finished delivery, again: the console and `wren webhooks redeliver`. */
      redeliver: serviceHandler(
        { input: z.object({ id: z.uuid() }) },
        async (ctx: restate.Context, req: { id: string }) => {
          const id = await ctx.run("reopen", () => reopen(d.main, req.id));
          if (!id)
            throw new restate.TerminalError("no finished delivery by that id", { errorCode: 409 });
          ctx.serviceSendClient<WebhooksService>(WEBHOOKS).deliver({ id });
          return { id };
        },
      ),
    },
  });
}

/**
 * A test send, now and once: a signed `webhook.test` to one subscription, logged like any
 * delivery. Runs where it's asked (the portal, the CLI); nothing retries it.
 */
export async function testSubscription(
  db: Queryable,
  client: string | null,
  id: string,
  o: PostOptions & { now?: Date } = {},
): Promise<DeliveryView & { answer: Answer | null }> {
  await mine(db, client, id);
  const now = o.now ?? new Date();
  const eventId = `msg_test_${randomBytes(12).toString("base64url")}`;
  const [queued] = await queueDeliveries(
    db,
    {
      client,
      event: TEST_EVENT,
      id: eventId,
      payload: {
        type: TEST_EVENT,
        timestamp: now.toISOString(),
        data: { subject: "test", message: "A test from Wren. Check the signature." },
      },
    },
    id,
  );
  if (!queued) throw new Error("test not queued");
  const { answer } = await attemptDelivery(db, queued, true, { ...o, now });
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, queued));
  if (!row) throw new Error("test delivery missing");
  return { ...deliveryView(row), answer };
}

// ---- The Send webhook node ----

/**
 * `logic.webhook` on the spine: the event's request, posted past the guard. 2xx leaves by
 * `answered`, any other 4xx by `refused`, each with `data.webhook`. No answer or a 5xx throws, so
 * the step's tries, the failed row and the workflow's auto-retry apply.
 */
export function webhookStep(o: PostOptions = {}): Step {
  return async (_port, e, at) => {
    const w = at.with;
    const url = fillText(String(w.url ?? "").trim(), e, true);
    const why = urlProblem(url);
    if (why) throw new restate.TerminalError(`Send webhook: ${why}`);
    const method = WEBHOOK_METHODS.find((m) => m === String(w.method ?? "POST")) ?? "POST";
    const { headers } = headersOf(w.headers, e);
    const { keep } = keepOf(w.keep);
    const sends = method !== "GET" && method !== "DELETE";
    const answer = await safePost(
      { url, method, headers, ...(sends ? { body: JSON.stringify(bodyOf(w.body, e)) } : {}) },
      o,
    );
    if (answer.status === null || retryable(answer))
      throw new Error(`Send webhook: ${answer.error ?? `answered ${answer.status}`}`);
    const webhook = answerKept(
      { status: answer.status, ms: answer.ms, body: answer.body },
      keep,
    );
    return [
      {
        port: delivered(answer) ? "answered" : "refused",
        event: { ...e, data: { ...e.data, webhook } },
      },
    ];
  };
}
