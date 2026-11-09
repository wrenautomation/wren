/**
 * The Postgres runtime on the box (designs/2026-11-09-own-runtime.md). Every service runs on it:
 *   box lane     BOX_SERVICES, in this process, pinned to this build
 *   lambda lane  the rest, one Lambda invoke per turn, pinned to a version ARN
 *   door         the ingress protocol at slot port + 10; Caddy fronts it (box-front-door.sh)
 * Slots (box-slot.ts): the build that started last takes new rows; an older one finishes its own.
 */
import { readFileSync, statSync } from "node:fs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  boxStarted,
  Dispatcher,
  migrate,
  newestBox,
  postgres,
  Registry,
  register,
  release,
  remoteTurn,
  runTurn,
  serveDoor,
  servedTurn,
  type TurnAsk,
  type TurnReply,
} from "@wren/runtime/pg";
import type { Logger } from "pino";
import type { AnyService } from "./services.js";

/**
 * Old name → new (WA-1219): the door serves a call under the old name as the new one. Drop an
 * entry once no outside caller uses it (a webhook URL, a trigger, the portal Worker: those stay).
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
  // 4d: Restate holds daily wakes and the pool chain's sends under these
  FailedCallAlert: "DeadLetterFile",
  BooksDaily: "BooksClose",
  Resolution: "LeadVerify",
  Discovery: "CompanySiteFind",
  Enrichment: "CompanyEnrich",
  // 4e: dead-letter and timeout rows, and calls already queued, name it
  Content: "ContentPublish",
};

/** Services autobrowse's desk (the Mac) claims over the door's `/rt/*` routes (`pull.ts`). */
const PULLED: readonly string[] = ["desk", "claude", "studio", "calls"];

const LEASE_MS = 60_000;
const THROTTLE_MS = 2_000;
/** How often an older slot looks whether a newer build started. */
const SUPERSEDED_EVERY_MS = 10_000;

/**
 * Postgres for the runtime. `direct` (the box, port 5432): prepared statements, so the claim's
 * plan (1.5 ms) is made once. Lambda goes through PgBouncer (transaction mode): none.
 */
export const rtSql = (url: string, max: number, app: string, direct = false) =>
  postgres(url, {
    max,
    prepare: direct,
    onnotice: () => {},
    connection: { application_name: app, idle_in_transaction_session_timeout: 120_000 },
  });

/** Phase times (ms) per minute as p50/p90/max: where a pg call spends its time. */
function timings(log: Logger, everyMs = 60_000) {
  let seen = new Map<string, number[]>();
  const tick = setInterval(() => {
    if (!seen.size) return;
    const out: Record<string, string> = {};
    for (const [k, v] of seen) {
      v.sort((a, b) => a - b);
      const q = (p: number) =>
        (v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0).toFixed(1);
      out[k] = `n${v.length} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)}`;
    }
    seen = new Map();
    log.info(out, "rt timing");
  }, everyMs);
  tick.unref();
  return {
    of: (lane: string) => (phase: string, ms: number) => {
      const k = `${lane}.${phase}`;
      const v = seen.get(k) ?? [];
      if (v.length < 5_000) v.push(ms);
      seen.set(k, v);
    },
    stop: () => clearInterval(tick),
  };
}

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
  /** Services this process runs (box lane); the rest go to the Lambda. */
  box: readonly string[];
  /** Straight to Postgres: LISTEN needs a session, which PgBouncer's transaction mode drops. */
  databaseUrl: string;
  build: string;
  /** The slot this one replaces; it keeps finishing its own rows. */
  buildLive?: string;
  arnPath?: string;
  /** Port for the door; unset: no door. */
  doorPort?: number;
  /** Bearer the door checks (local dev); prod: Caddy checks it in front. */
  doorBearer?: string;
  /** Once, when a newer build started: this one finishes its own rows only. */
  onSuperseded?(): void | Promise<void>;
  log: Logger;
}) {
  const sql = rtSql(o.databaseUrl, 12, "wren-rt-box", true);
  await migrate(sql);
  const registry = new Registry(o.all as never);
  await register(sql, registry);
  const log = (m: string, e?: unknown) =>
    o.log.warn({ err: e ? String(e) : undefined }, `rt: ${m}`);
  const names = o.all.map((s) => s.name);
  const onBox = names.filter((s) => o.box.includes(s));
  const onLambda = names.filter((s) => !o.box.includes(s));
  // rows pinned to a stopped slot (two deploys ago) replay on this build
  if (onBox.length)
    await sql`UPDATE rt.invocations SET build = ${o.build}
      WHERE service IN ${sql(onBox)} AND status NOT IN ('done', 'killed')
        AND build NOT IN ${sql([o.build, ...(o.buildLive ? [o.buildLive] : [])])}`;
  const arn = arnFile(o.arnPath ?? "/etc/wren/worker-arn");
  const lambda = new LambdaClient({});
  const timed = timings(o.log);

  const boxLane = onBox.length
    ? new Dispatcher({
        sql,
        concurrency: 6,
        leaseMs: LEASE_MS,
        lane: { only: onBox, build: o.build, strict: true },
        run: (c) => runTurn({ sql, registry, leaseMs: LEASE_MS, log }, c),
        log,
        time: timed.of("box"),
      })
    : null;
  // under the worker's reserved concurrency (lambda_max_concurrency, 6)
  const width = Number(process.env.WREN_RT_LAMBDA_CONCURRENCY ?? 5);
  const lambdaLane = onLambda.length
    ? new Dispatcher({
        sql,
        concurrency: width,
        // rows a caller waits on (portal, webhooks) always keep 2 slots (design doc "Group 4")
        background: Math.max(1, width - 2),
        leaseMs: LEASE_MS,
        lane: { only: onLambda, ...(arn() ? { build: arn() as string } : {}) },
        run: (c) =>
          remoteTurn(
            sql,
            c,
            LEASE_MS,
            async (ask) => {
              const fn = c.build ?? arn();
              if (!fn) throw new Error("no worker ARN yet");
              const t0 = performance.now();
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
              timed.of("lambda")("invoke", performance.now() - t0);
              if (!r) return "released";
              // a crashed turn keeps its lease and is claimed again when it runs out
              if (r.FunctionError) {
                log(`lambda turn ${c.id} #${c.attempt}: ${r.FunctionError}`);
                return null;
              }
              return r.Payload
                ? (JSON.parse(Buffer.from(r.Payload).toString()) as TurnReply)
                : null;
            },
            timed.of("lambda"),
          ),
        log,
        time: timed.of("lambda"),
      })
    : null;
  // a new ARN pins new Lambda rows to it; a stat every 2 s (rows made before it ran on the old one)
  const repin = setInterval(() => {
    const a = arn();
    if (a) lambdaLane?.setLane({ only: onLambda, build: a });
  }, 2_000);
  repin.unref();
  await Promise.all([boxLane?.start(), lambdaLane?.start()]);
  // own pool: portal calls must not starve the lanes
  const doorSql = o.doorPort ? rtSql(o.databaseUrl, 4, "wren-rt-door", true) : null;
  const door =
    o.doorPort && doorSql
      ? await serveDoor({
          sql: doorSql,
          port: o.doorPort,
          ...(o.doorBearer ? { bearer: o.doorBearer } : {}),
          renamed: RENAMED,
          pull: { pulled: PULLED, leaseMs: LEASE_MS },
          time: timed.of("door"),
        })
      : null;
  await boxStarted(sql, o.build);
  o.log.info({ onBox, onLambda: onLambda.length, build: o.build, door: door?.url }, "rt ready");

  let superseded = false;
  /** A newer slot took over: finish this build's own box rows only. */
  const standDown = async () => {
    if (superseded) return;
    superseded = true;
    clearInterval(repin);
    clearInterval(watch);
    boxLane?.setLane({ only: onBox, build: o.build, strict: true, fresh: false });
    // Caddy takes the first healthy door: new calls, and the desk's `/rt` pulls, go to the newest
    door?.drain();
    await lambdaLane?.stop();
    await o.onSuperseded?.();
  };
  const watch = setInterval(() => {
    newestBox(sql)
      .then((b) => (b && b !== o.build ? standDown() : undefined))
      .catch((e: unknown) => log("superseded check failed", e));
  }, SUPERSEDED_EVERY_MS);
  watch.unref();

  return {
    sql,
    /** The door's loopback URL; null without one. */
    doorUrl: door?.url ?? null,
    superseded: standDown,
    async stop() {
      clearInterval(repin);
      clearInterval(watch);
      timed.stop();
      await door?.close();
      await doorSql?.end({ timeout: 5 });
      await Promise.all([boxLane?.stop(), lambdaLane?.stop()]);
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
