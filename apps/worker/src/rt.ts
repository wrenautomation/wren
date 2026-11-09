/**
 * The Postgres runtime beside Restate (designs/2026-11-09-own-runtime.md, "Phase 3").
 * `PG_SERVICES` run on it; Restate serves a proxy of each. The box hosts the loops:
 *   box lane     pg services in BOX_SERVICES, in this process, pinned to this build
 *   lambda lane  other pg services, one Lambda invoke per turn, pinned to a version ARN
 *   bridge lane  rows for services still on Restate, forwarded to Restate's loopback ingress
 *   replier      resolves each finished proxy call's Restate awakeable
 *   door         (self-hosted) Restate's ingress protocol at slot port + 10: pg services served
 *                direct, the rest passed to Restate. Caddy puts it in front of ingress.
 */
import { readFileSync, statSync } from "node:fs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  bridgeTurn,
  Dispatcher,
  type Ingress,
  migrate,
  postgres,
  proxy,
  Registry,
  register,
  release,
  remoteTurn,
  renameService,
  replier,
  returnState,
  runTurn,
  serveDoor,
  servedTurn,
  setPgServices,
  type TurnAsk,
  type TurnReply,
  takeState,
} from "@wren/runtime/pg";
import type { Logger } from "pino";
import type { AnyService } from "./services.js";

/**
 * Services on the Postgres runtime. A deploy flips one; pg keeps every service registered.
 * Groups (design doc "Move plan"): 1 AuditLogSeal; 2 platform and people loops; 3 email and content
 * loops; 4a the other loops and workers; 4b webhooks and public calls. All on the Lambda lane.
 * The watchdogs (FailedCallAlert, LoopRevive) move last: they watch the moved loops from Restate.
 */
export const PG_SERVICES: readonly string[] = [
  "AuditLogSeal",
  "NextStepDecide",
  "SiteTokenRenew",
  "VaultKeyMirror",
  "SetupRecheck",
  "SegmentsRefresh",
  "TouchToJourney",
  "ListToJourney",
  "MapLineFeed",
  "StripeReconcile",
  "ClientUpdateMail",
  "ClientInvoicing",
  "ClientMailTriage",
  "EmailSend",
  "EmailInboxRead",
  "EmailOpenerFill",
  "EmailBounceRead",
  "EmailFleetDigest",
  "EmailPlacementTest",
  "EmailClickPull",
  "NewsletterSync",
  "PostPlan",
  "PostPublish",
  "PostMetrics",
  // 4a
  "InboxPush",
  "Newsletter",
  "ListmonkMail",
  "ListmonkIntake",
  "ClientReport",
  "ProfileResearch",
  "AutoReply",
  "KeywordDm",
  "SmsSend",
  "SmsUpkeep",
  "Broadcast",
  "PeopleMap",
  "ReachSend",
  "ReachInboxRead",
  "SiteRollup",
  "Reactivation",
  "CrmRun",
  "ConnectorSync",
  "Tokens",
  "SetupAgent",
  "DraftAsk",
  "Ask",
  "MailReply",
  "SocialInbox",
  "ReplyLabel",
  "MetaReplyPace",
  "SocialPushHold",
  "EmailQueueRerender",
  "PieceList",
  "BlogSave",
  "CommentLiveCheck",
  "PushedCommentKeep",
  "JourneyMove",
  "CallBriefBuild",
  "DomainLookup",
  "SegmentPass",
  // 4b: webhooks and public calls
  "SocialPushIntake",
  "CallBookingIntake",
  "SmsWebhookIntake",
  "SmsApplicationFollowUp",
  "SignupForm",
  "SiteChat",
  "PaymentLinkSend",
  "BookingPage",
  "ClientBookingPage",
  "DocumentSign",
  "WebhookSend",
  "ConnectorCallback",
  "MailCallback",
  "SocialCallback",
];

/**
 * Old name → new, for pg services only (WA-1219: a rename lands with the move). Restate keeps a
 * proxy under the old name: its scheduled calls and state reach the new one; the door serves it too.
 * Drop an entry once Restate holds nothing under the old name and no outside caller uses it
 * (a webhook URL, a trigger, the portal Worker: those stay).
 */
export const RENAMED: Readonly<Record<string, string>> = {
  AuditSeal: "AuditLogSeal",
  Judge: "NextStepDecide",
  SegmentsHourly: "SegmentsRefresh",
  Disposition: "ReplyLabel",
  MetaPace: "MetaReplyPace",
  SocialPushed: "SocialPushHold",
  QueueRefresh: "EmailQueueRerender",
  Pieces: "PieceList",
  Blog: "BlogSave",
  CommentProofs: "CommentLiveCheck",
  PushedComments: "PushedCommentKeep",
  Journeys: "JourneyMove",
  CallBriefs: "CallBriefBuild",
  Domains: "DomainLookup",
  Segments: "SegmentPass",
  // 4b: the phone and portal Workers called these; a Worker on an old build still does. Kept for good
  SocialPush: "SocialPushIntake",
  CallBookings: "CallBookingIntake",
  SmsEvents: "SmsWebhookIntake",
  SmsForms: "SmsApplicationFollowUp",
  Marketing: "SignupForm",
  Chat: "SiteChat",
  Payments: "PaymentLinkSend",
  Calendar: "BookingPage",
  ClientCalendar: "ClientBookingPage",
  Documents: "DocumentSign",
  Webhooks: "WebhookSend",
};

const LEASE_MS = 60_000;
/** The last slot sees it was superseded within 30 s of this one's register (`watchSuperseded`). */
const OLD_SLOT_MS = 120_000;
const THROTTLE_MS = 2_000;
/** State takes after start: 30 min covers register and the old deployment's last calls. */
const TAKE_EVERY_MS = 120_000;
const TAKE_REPEATS = 15;

/** The Restate side: each pg service becomes a proxy of the same name. */
export function restateSide(services: AnyService[], sql: () => postgres.Sql): AnyService[] {
  return services.flatMap((s) => {
    if (!PG_SERVICES.includes(s.name)) return [s];
    const olds = Object.keys(RENAMED).filter((o) => RENAMED[o] === s.name);
    return [s.name, ...olds].map((as) => proxy(s as never, sql, as) as unknown as AnyService);
  });
}

/** Postgres for the runtime. No prepared statements: Lambda goes through PgBouncer (transaction mode). */
export const rtSql = (url: string, max: number, app: string) =>
  postgres(url, {
    max,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: app, idle_in_transaction_session_timeout: 120_000 },
  });

/** The current Lambda version ARN; CI writes it at register. Read again when the file changes. */
function arnFile(path: string) {
  let mtime = 0;
  let arn: string | undefined;
  return () => {
    try {
      const m = statSync(path).mtimeMs;
      if (m !== mtime) {
        arn = readFileSync(path, "utf8").trim() || undefined;
        mtime = m;
      }
    } catch {}
    return arn;
  };
}

export async function startRt(o: {
  all: AnyService[];
  box: readonly string[];
  /** Straight to Postgres: LISTEN needs a session, which PgBouncer's transaction mode drops. */
  databaseUrl: string;
  build: string;
  /** The slot this one replaces; it keeps finishing its own rows. */
  buildLive?: string;
  ingress: Ingress;
  /** Restate's admin, self-hosted only: a flip back returns object state through it. */
  admin?: string;
  arnPath?: string;
  /** Port for the door; unset: no door (the tunnel host has no Caddy in front). */
  doorPort?: number;
  log: Logger;
}) {
  const sql = rtSql(o.databaseUrl, 12, "wren-rt-box");
  await migrate(sql);
  const registry = new Registry(o.all as never);
  await register(sql, registry);
  await setPgServices(sql, PG_SERVICES, o.build);
  // a failed rename must not stop the box: rows left under the old name take the bridge lane
  for (const [from, to] of Object.entries(RENAMED))
    try {
      const moved = await renameService(sql, from, to, OLD_SLOT_MS);
      if (moved.rows || moved.state) o.log.info({ from, to, ...moved }, "rt: renamed");
    } catch (e) {
      o.log.error({ err: String(e), from, to }, "rt: rename failed");
    }
  // state Restate still holds for a pg service moves in before any turn reads it; again until the
  // deploy has registered the proxies (it restarts the box first) and old-deployment calls are done
  const warned = new Set<string>();
  const take = async () => {
    if (!o.admin) return;
    for (const [from, to] of [
      ...PG_SERVICES.map((s) => [s, s] as const),
      ...Object.entries(RENAMED),
    ])
      try {
        const { moved, kept } = await takeState(sql, o.admin, from, to);
        if (moved.length) o.log.info({ from, to, moved }, "rt: state taken from Restate");
        const fresh = kept.filter((k) => !warned.has(`${from}/${k}`));
        for (const k of fresh) warned.add(`${from}/${k}`);
        if (fresh.length)
          o.log.warn({ from, to, kept: fresh }, "rt: Restate state kept, pg holds these keys");
      } catch (e) {
        o.log.error({ err: String(e), from, to }, "rt: state take failed");
      }
  };
  await take();
  let takes = 0;
  const retake = setInterval(() => {
    if (++takes >= TAKE_REPEATS) clearInterval(retake);
    void take();
  }, TAKE_EVERY_MS);
  retake.unref();
  if (o.admin)
    for (const { service } of await sql<
      { service: string }[]
    >`SELECT DISTINCT service FROM rt.state`)
      if (!PG_SERVICES.includes(service)) {
        const n = await returnState(sql, o.admin, service);
        o.log.info({ service, keys: n }, "rt: state returned to Restate");
      }
  const log = (m: string, e?: unknown) =>
    o.log.warn({ err: e ? String(e) : undefined }, `rt: ${m}`);
  const onBox = PG_SERVICES.filter((s) => o.box.includes(s));
  const onLambda = PG_SERVICES.filter((s) => !o.box.includes(s));
  // rows pinned to a stopped slot (two deploys ago) replay on this build, as Restate's `force` does
  if (onBox.length)
    await sql`UPDATE rt.invocations SET build = ${o.build}
      WHERE service IN ${sql(onBox)} AND status NOT IN ('done', 'killed')
        AND build NOT IN ${sql([o.build, ...(o.buildLive ? [o.buildLive] : [])])}`;
  const arn = arnFile(o.arnPath ?? "/etc/wren/worker-arn");
  const lambda = new LambdaClient({});

  const boxLane = new Dispatcher({
    sql,
    concurrency: 6,
    leaseMs: LEASE_MS,
    lane: { only: onBox, build: o.build, strict: true },
    run: (c) => runTurn({ sql, registry, leaseMs: LEASE_MS, log }, c),
    log,
  });
  // under the worker's reserved concurrency (lambda_max_concurrency, 6), which Restate shares until phase 6
  const width = Number(process.env.WREN_RT_LAMBDA_CONCURRENCY ?? 5);
  const lambdaLane = new Dispatcher({
    sql,
    concurrency: width,
    // rows a caller waits on (portal, webhooks) always keep 2 slots (design doc "Group 4")
    background: Math.max(1, width - 2),
    leaseMs: LEASE_MS,
    lane: { only: onLambda, ...(arn() ? { build: arn() as string } : {}) },
    run: (c) =>
      remoteTurn(sql, c, LEASE_MS, async (ask) => {
        const fn = c.build ?? arn();
        if (!fn) throw new Error("no worker ARN yet");
        const r = await lambda
          .send(
            new InvokeCommand({
              FunctionName: fn,
              InvocationType: "RequestResponse",
              Payload: Buffer.from(JSON.stringify({ rt: ask })),
            }),
          )
          .catch(async (e: unknown) => {
            // reserved concurrency full: no turn began, so the row goes back now, not at lease end
            if ((e as { name?: string }).name !== "TooManyRequestsException") throw e;
            await release(sql, c.id, c.attempt, THROTTLE_MS);
            return null;
          });
        if (!r) return "released";
        // a crashed turn keeps its lease and is claimed again when it runs out
        if (r.FunctionError) {
          log(`lambda turn ${c.id} #${c.attempt}: ${r.FunctionError}`);
          return null;
        }
        return r.Payload ? (JSON.parse(Buffer.from(r.Payload).toString()) as TurnReply) : null;
      }),
    log,
  });
  const bridgeLane = new Dispatcher({
    sql,
    concurrency: 40,
    leaseMs: LEASE_MS,
    lane: { except: PG_SERVICES, lock: false, skipPg: true },
    run: (c) =>
      bridgeTurn(
        { sql, ingress: o.ingress, leaseMs: LEASE_MS, ...(o.admin ? { admin: o.admin } : {}) },
        c,
      ),
    log,
  });
  // a new ARN pins new Lambda rows to it; a stat every 2 s (rows made before it ran on the old one)
  const repin = setInterval(() => {
    const a = arn();
    if (a) lambdaLane.setLane({ only: onLambda, build: a });
  }, 2_000);
  repin.unref();
  await Promise.all([boxLane.start(), lambdaLane.start(), bridgeLane.start()]);
  let reply: { stop(): Promise<void> } | null = await replier({ sql, ingress: o.ingress, log });
  // own pool: portal calls must not starve the lanes; a failed door leaves Caddy on Restate
  const doorPort = o.doorPort;
  const doorSql = doorPort ? rtSql(o.databaseUrl, 4, "wren-rt-door") : null;
  const door =
    doorPort && doorSql
      ? await serveDoor({
          sql: doorSql,
          port: doorPort,
          restate: o.ingress.url,
          renamed: RENAMED,
        }).catch(async (e: unknown) => {
          o.log.error({ err: String(e), port: doorPort }, "rt: door failed");
          await doorSql.end({ timeout: 5 });
          return null;
        })
      : null;
  o.log.info({ pg: PG_SERVICES, onBox, onLambda, build: o.build, door: door?.url }, "rt ready");

  return {
    sql,
    /** A newer slot took over: finish this build's own box rows only. */
    async superseded() {
      clearInterval(repin);
      clearInterval(retake);
      boxLane.setLane({ only: onBox, build: o.build, strict: true, fresh: false });
      await Promise.all([lambdaLane.stop(), bridgeLane.stop(), reply?.stop()]);
      reply = null;
    },
    async stop() {
      clearInterval(repin);
      clearInterval(retake);
      await door?.close();
      await doorSql?.end({ timeout: 5 });
      await Promise.all([boxLane.stop(), lambdaLane.stop(), bridgeLane.stop(), reply?.stop()]);
      await sql.end({ timeout: 5 });
    },
  };
}

/** Lambda: one turn of a pg row, when the box's lambda lane invokes with `{rt}`. */
export const isRtEvent = (e: unknown): e is { rt: TurnAsk } =>
  typeof e === "object" && e !== null && "rt" in e;

/** One turn the box hands over: it loaded the row and writes the outcome (`remoteTurn`). */
export function lambdaTurns(all: AnyService[], sql: postgres.Sql) {
  const registry = new Registry(all as never);
  return (e: { rt: TurnAsk }) => servedTurn({ sql, registry }, e.rt);
}
