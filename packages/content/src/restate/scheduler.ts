/**
 * `ContentScheduler/default`: publishes approved drafts when they are due.
 * Each publish is one call to the `Content` service (itself journaled down to
 * autobrowse's `sites`), bracketed by two journaled row moves: approved →
 * publishing before, published or failed after. A crash between them leaves a
 * `publishing` row a person can see and re-approve; nothing posts twice.
 *
 * Cadence: after a pass with work, look again in a minute; otherwise sleep
 * until the next scheduled draft, or `idleMs` when nothing is scheduled (a
 * fresh approval with no time also gets picked up then, or on `sync`).
 *
 * `ContentScheduler/<client>/posts`: the same over the client's own database, posting on its own
 * login (`Content` with `client`). Until an admin turns its posting on, approved drafts wait:
 * nothing is claimed, the pass says how many are held. Posts carry no link to Wren's lander.
 *
 * A post's link is its funnel's (`funnel.ts`): read when it is claimed, appended on its own line.
 *
 * Every publish runs under a ledger claim (`draft:<id>`, designs/2026-10-16-send-verdicts.md).
 * The claim makes the send key, and `Content.publish` carries it to autobrowse, which answers
 * what became of the write. Wren reads no words:
 * - sent: published. Found (autobrowse read it back): published with the id it found.
 * - the platform refused: failed, as always.
 * - not sent (the browser was busy, the page never loaded, the read showed it absent): back to
 *   approved, its slot kept, "Waiting for the browser" on it. The rest of the pass skips that
 *   platform and the next pass comes in a minute. The next try makes a new key.
 * - unknown: the draft stays `publishing` and its ledger row (`draft:<id>`) waits in To approve
 *   under "May have gone out". Never failed, never sent again by itself. A client's publish
 *   is the same: its connected account answers a verdict under the same key.
 *
 * A pass waits on one publish at most `PUBLISH_WAIT_MS` (designs/2026-10-16-loop-watchdog.md). A
 * publish Restate paused never answers, and a pass waiting on it held this key's lock for hours.
 * Past the wait the call runs on alone: the draft stays `publishing`, its invocation id is kept
 * in `publishing` state, and each later pass looks at it for a moment and settles the row.
 */
import * as restate from "@restatedev/restate-sdk";
import { sendsOn } from "@wren/core/clients";
import { capWaitMs, type Platform, type Post, type Published } from "@wren/core/content";
import { ShapeError } from "@wren/core/content/shapes";
import type { Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  errorText,
  LIMITS,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
  within,
} from "@wren/core/restate";
import { type Delivery, isDelivery } from "@wren/core/send-verdict";
import type { Db } from "@wren/db";
import {
  claimSend,
  parkUnsure,
  pickedAccount,
  ReachRefusal,
  releaseSend,
  sendAttempt,
} from "@wren/outreach";
import { clientContent } from "../clients.js";
import { postedLinks } from "../funnel.js";
import { PLATFORM_SPECS, postOf } from "../platforms.js";
import {
  claim,
  dueDrafts,
  markCapped,
  markFailed,
  markPublished,
  markUnsure,
  markWaiting,
  nextDue,
  noteOnDraft,
} from "../queue.js";
import { afterPublish } from "./after-publish.js";

export const SCHEDULER_KEY = "default";
const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const BUSY_MS = 60 * 1000;
const MAX_PER_PASS = 10;
/** The longest a pass waits on one publish before it moves on. */
export const PUBLISH_WAIT_MS = LIMITS.publish;
/** How long a pass looks at a publish it moved on from. */
const SETTLE_LOOK_MS = 1000;
/** State key: the publishes a pass moved on from, still to settle. */
const PUBLISHING = "publishing";

/** A publish still running after its pass moved on. */
export interface OpenPublish {
  invocationId: string;
  draftId: string;
  platform: Platform;
  /** The funnel link, for the row and the first comment. */
  link: string | null;
  comment: string | null;
  account: string | null;
  since: string;
  /** The words as sent, kept on the ledger if it may have gone out. */
  text?: string;
  /** How a person knows it in To approve: its title or first words. */
  target?: string;
  /** This draft's publishes so far, as the ledger counts them. */
  tries?: number;
  /** The ledger row's send key: the publish runs under it. Absent: an older pass's. */
  sendKey?: string;
  /** A take-over: an `unknown` answer is asked once more. */
  recheck?: boolean;
}

/** A publish about to go out: everything but its invocation. */
type Pending = Omit<OpenPublish, "invocationId">;

/** The `Content` service's publish handler as the worker serves it. */
type ContentService = {
  publish: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      post: Post;
      client?: string | null;
      account?: string | null;
      sendKey?: string;
      recheck?: boolean;
    },
  ) => Promise<Published | Delivery<Published>>;
  reply: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      commentId: string;
      text: string;
      client?: string | null;
      account?: string | null;
      sendKey?: string;
    },
  ) => Promise<void | Delivery<void>>;
};

export interface ContentSchedulerDeps {
  db: Db;
  /** Sleep between passes when nothing is scheduled (default 15 min). */
  idleMs?: number;
  notifier?: Notifier;
  /** A post just went out on `platform` (a client's, or Wren's at null): its replies read warm. */
  posted?: (ctx: restate.ObjectContext, platform: Platform, client: string | null) => void;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
  /** How long a pass waits on one publish (default `PUBLISH_WAIT_MS`); tests shorten it. */
  publishWaitMs?: number;
}

export interface PublishStats {
  published: { id: string; platform: Platform; url: string }[];
  failed: { id: string; platform: Platform; error: string }[];
  /** Approved drafts still waiting after this pass (a batch is capped). */
  remaining: number;
  /** A client's due drafts held because its sends are off. */
  held?: number;
  /** Drafts put back because the desk's browser was busy: they go next pass. */
  waiting?: { id: string; platform: Platform }[];
  /** Publishes still running past the wait; a later pass settles them. */
  posting?: { id: string; platform: Platform; since: string }[];
  /** Publishes that may have gone out and no read could tell: they wait in To approve. */
  unsure?: { id: string; platform: Platform; why: string }[];
}

export function makeContentScheduler(deps: ContentSchedulerDeps) {
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const publishWaitMs = deps.publishWaitMs ?? PUBLISH_WAIT_MS;
  return makeLoopObject("ContentScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const owner = clientOfKey(ctx.key);
    if (!owner)
      return publishPass(ctx, now, {
        db: deps.db,
        client: null,
        notifier: deps.notifier,
      });
    if (!deps.clientDb) return stoppedPass<PublishStats>(ctx, now, "no client databases here");
    const id = owner.client;
    const plan = await ctx.run("client", () => clientContent(deps.db, id, "content.posting"));
    if (plan.kind === "gone") return stoppedPass<PublishStats>(ctx, now, plan.why);
    const db = deps.clientDb(id);
    if (!sendsOn(plan.client, "content.posting")) {
      // Sends off: nothing is claimed; approved drafts keep their slot until an admin says go.
      const due = await ctx.run("held", async () => (await dueDrafts(db, now, 1000)).length);
      const outcome: PassOutcome<PublishStats> = {
        stats: { published: [], failed: [], remaining: 0, held: due },
        error: null,
        failures: 0,
        delayMs: idleMs,
        now: now.toISOString(),
      };
      await setLastPass(ctx, outcome);
      return outcome;
    }
    return publishPass(ctx, now, { db, client: id });
  });

  /**
   * The publishes earlier passes moved on from: each looked at for a moment. Done: the row
   * settles as if the pass had waited. Still running: kept for the next pass.
   */
  async function settleOpen(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    stats: PublishStats,
    busy: Set<Platform>,
  ): Promise<OpenPublish[]> {
    const still: OpenPublish[] = [];
    for (const p of (await ctx.get<OpenPublish[]>(PUBLISHING)) ?? []) {
      try {
        const got = await ctx
          .invocation(restate.InvocationIdParser.fromString(p.invocationId))
          .attach<Published | Delivery<Published>>()
          .orTimeout(SETTLE_LOOK_MS);
        await answered(ctx, o, content, p, got, stats, busy);
      } catch (err) {
        if (err instanceof restate.TimeoutError) still.push(p);
        else await ended(ctx, o, p, err, stats);
      }
    }
    return still;
  }

  /** The ledger row's item for a draft. */
  function itemOf(p: Pick<OpenPublish, "draftId">): string {
    return `draft:${p.draftId}`;
  }

  /** A publish that answered: what became of the write decides the row. */
  async function answered(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    p: OpenPublish,
    got: Published | Delivery<Published>,
    stats: PublishStats,
    busy: Set<Platform>,
  ): Promise<void> {
    // An older Content ignores the key and answers the output itself.
    const d: Delivery<Published> = isDelivery(got) ? got : { kind: "sent", out: got };
    if (d.kind === "sent") return finish(ctx, o, content, p, d.out, "sent", stats);
    if (d.kind === "found") {
      const published: Published = {
        id: d.id ?? "",
        url: d.url ?? "",
        publishedAt: d.at,
        fetchedWith: "api",
      };
      return finish(ctx, o, content, p, published, "found", stats);
    }
    if (d.kind === "unknown") return unsure(ctx, o, p, d.reason, stats);
    if (d.how === "refused") return failed(ctx, o, p, d.reason, stats);
    return notSent(ctx, o, p, d.reason, stats, busy);
  }

  /** A publish that is up (`afterPublish`). `by` is who said so: the publish, or autobrowse's read. */
  async function finish(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    p: OpenPublish,
    published: Published,
    by: "sent" | "found",
    stats: PublishStats,
  ): Promise<void> {
    await afterPublish(
      ctx,
      { db: o.db, client: o.client, posted: deps.posted },
      content,
      p,
      published,
      by,
    );
    stats.published.push({ id: p.draftId, platform: p.platform, url: published.url });
  }

  /** The platform said no: failed, as always. Nothing is left on the ledger. */
  async function failed(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    p: OpenPublish,
    error: string,
    stats: PublishStats,
  ): Promise<void> {
    await ctx.run(`failed ${p.draftId}`, async () => {
      await markFailed(o.db, p.draftId, error);
      await releaseSend(o.db, itemOf(p));
    });
    stats.failed.push({ id: p.draftId, platform: p.platform, error });
  }

  /**
   * Nothing went out (the browser was busy, the page never loaded, the read showed it absent): back
   * to approved with its slot, the platform skipped for this pass. The ledger row is released, so
   * the next pass sends under a new key.
   */
  async function notSent(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    p: OpenPublish,
    why: string,
    stats: PublishStats,
    busy: Set<Platform>,
  ): Promise<void> {
    await ctx.run(`waiting ${p.draftId}`, async () => {
      await markWaiting(o.db, p.draftId, why);
      await releaseSend(o.db, itemOf(p));
    });
    busy.add(p.platform);
    stats.waiting = [...(stats.waiting ?? []), { id: p.draftId, platform: p.platform }];
  }

  /** The platform's daily cap is used: back to approved at the reset, the ledger row released. */
  async function capped(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    p: OpenPublish,
    waitMs: number,
    why: string,
    stats: PublishStats,
  ): Promise<void> {
    const until = new Date((await ctx.date.now()) + waitMs);
    await ctx.run(`capped ${p.draftId}`, async () => {
      await markCapped(o.db, p.draftId, until, why);
      await releaseSend(o.db, itemOf(p));
    });
    stats.waiting = [...(stats.waiting ?? []), { id: p.draftId, platform: p.platform }];
  }

  /**
   * A publish that ended in an error. The platform said no (a 4xx, or a field it won't take):
   * failed. A Content error that is not a clear refusal (a stop, a cancel, a server fault) says
   * nothing about the write: it may have gone out, so a person decides. Anything else retries the
   * pass.
   */
  async function ended(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    p: OpenPublish,
    err: unknown,
    stats: PublishStats,
  ): Promise<void> {
    if (!(err instanceof restate.TerminalError) && !(err instanceof ShapeError)) throw err;
    const error = errorText(err);
    // A used daily cap refuses before any write: the draft waits for the reset, never fails.
    const wait = capWaitMs(err);
    if (wait !== null) return capped(ctx, o, p, wait, error, stats);
    const code = err instanceof restate.TerminalError ? (err.code ?? 500) : 400;
    if (code >= 400 && code < 500 && code !== 408 && code !== 409)
      return failed(ctx, o, p, error, stats);
    return unsure(ctx, o, p, error, stats);
  }

  /**
   * A publish that may have gone out and nothing said whether it did. It waits on a person in
   * To approve, the draft left `publishing` so no pass takes it. Wren reads no words.
   */
  async function unsure(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    p: OpenPublish,
    reason: string,
    stats: PublishStats,
  ): Promise<void> {
    const name = PLATFORM_SPECS[p.platform].name;
    const why = reason.slice(0, 300);
    const now = new Date(await ctx.date.now());
    await ctx.run(`unsure ${p.draftId}`, async () => {
      await parkUnsure(o.db, {
        item: itemOf(p),
        platform: p.platform,
        account: p.account,
        words: p.text ?? "",
        target: p.target ?? name,
        url: null,
        tries: p.tries ?? 1,
        why,
        now,
        since: new Date(p.since),
        sendKey: p.sendKey ?? null,
      });
      await markUnsure(o.db, p.draftId, why);
    });
    stats.unsure = [...(stats.unsure ?? []), { id: p.draftId, platform: p.platform, why }];
  }

  /**
   * One publish: called, waited on for `publishWaitMs`, then marked. Past the wait it runs on
   * alone and a later pass settles it.
   */
  async function send(
    ctx: restate.ObjectContext,
    o: { db: Db; client: string | null },
    content: restate.Client<ContentService>,
    pending: Pending,
    post: Post,
    stats: PublishStats,
    busy: Set<Platform>,
    open: OpenPublish[],
  ): Promise<void> {
    const call = content.publish({
      platform: pending.platform,
      post,
      ...(o.client ? { client: o.client } : {}),
      ...(pending.account ? { account: pending.account } : {}),
      ...(pending.sendKey ? { sendKey: pending.sendKey } : {}),
      ...(pending.recheck ? { recheck: true } : {}),
    });
    const p: OpenPublish = { invocationId: await call.invocationId, ...pending };
    try {
      const got = await within(ctx, call, {
        ms: publishWaitMs,
        call: "Content/publish",
        unit: p.draftId,
        keep: true,
      });
      await answered(ctx, o, content, p, got, stats, busy);
    } catch (err) {
      if (err instanceof restate.TimeoutError) {
        // Still running (or paused by Restate): it settles on a later pass, and the queue moves on.
        await ctx.run(`still posting ${p.draftId}`, () =>
          noteOnDraft(
            o.db,
            p.draftId,
            `Still posting after ${Math.round(publishWaitMs / 60_000)} min; the scheduler moved on and settles it when the call ends.`,
          ),
        );
        open.push(p);
        return;
      }
      await ended(ctx, o, p, err, stats);
    }
  }

  /** One pass: due drafts claimed, posted through `Content`, marked. */
  async function publishPass(
    ctx: restate.ObjectContext,
    now: Date,
    o: { db: Db; client: string | null; notifier?: Notifier | undefined },
  ): Promise<PassOutcome<PublishStats>> {
    const content = ctx.serviceClient<ContentService>({ name: "Content" });
    const stats: PublishStats = { published: [], failed: [], remaining: 0 };
    /** Platforms whose browser was busy this pass: their other drafts wait for the next. */
    const busy = new Set<Platform>();
    const open = await settleOpen(ctx, o, content, stats, busy);
    // Rows cross the journal as JSON: their Date columns are strings here; only id/platform/text/title/media/extra are read.
    const due = await ctx.run("due drafts", () => dueDrafts(o.db, now, MAX_PER_PASS + 1));
    const batch = due.slice(0, MAX_PER_PASS);
    stats.remaining = due.length - batch.length;
    for (const draft of batch) {
      if (busy.has(draft.platform)) continue;
      const claimed = await ctx.run(`claim ${draft.id}`, () => claim(o.db, draft.id));
      if (!claimed) continue;
      // A client's posts carry no Wren link; Wren's carry their funnel's, in the text or
      // as the first comment.
      const links = o.client
        ? { text: null, comment: null }
        : await ctx.run(`link ${draft.id}`, () => postedLinks(o.db, claimed));
      // A person's pick on the draft posts it as that login; none, the platform's default.
      const account = o.client
        ? null
        : await ctx.run(`account ${draft.id}`, () => pickedAccount(o.db, `draft:${draft.id}`));
      let post: Post;
      try {
        post = postOf(claimed, links.text);
      } catch (err) {
        // A field its platform won't take: the draft's to fix, nothing was sent.
        if (!(err instanceof ShapeError)) throw err;
        const error = errorText(err);
        await ctx.run(`failed ${draft.id}`, () => markFailed(o.db, draft.id, error));
        stats.failed.push({ id: draft.id, platform: draft.platform, error });
        continue;
      }
      const target = (claimed.title || claimed.text).replace(/\s+/g, " ").trim().slice(0, 120);
      // The ledger claim makes the send key. It is made before the call, so it survives every
      // retry of this pass: the same publish asks autobrowse for the same verdict.
      const invocation = ctx.request().id;
      const taken = await ctx.run(`send claim ${draft.id}`, async () => {
        try {
          return await claimSend(o.db, {
            item: `draft:${draft.id}`,
            platform: draft.platform,
            account,
            words: post.text,
            target,
            url: null,
            invocation,
            now,
          });
        } catch (err) {
          if (!(err instanceof ReachRefusal)) throw err;
          const row = await sendAttempt(o.db, `draft:${draft.id}`);
          return {
            go: "taken" as const,
            why: err.message,
            unsure: row?.state === "unsure" ? (row.why ?? err.message) : null,
          };
        }
      });
      if (taken.go === "taken") {
        // Another send of it is out, or it waits on a person: not ours to send.
        if (taken.unsure !== null) {
          const why = taken.unsure;
          await ctx.run(`unsure ${draft.id}`, () => markUnsure(o.db, draft.id, why));
          stats.unsure = [...(stats.unsure ?? []), { id: draft.id, platform: draft.platform, why }];
        } else {
          const why = taken.why;
          await ctx.run(`waiting ${draft.id}`, () => markWaiting(o.db, draft.id, why));
          stats.waiting = [...(stats.waiting ?? []), { id: draft.id, platform: draft.platform }];
        }
        continue;
      }
      if (taken.go === "done") {
        // The ledger says it went out: the row catches up, nothing is sent.
        const published: Published = {
          id: taken.ref ?? "",
          url: "",
          publishedAt: taken.at ?? now.toISOString(),
          fetchedWith: "api",
        };
        await ctx.run(`published ${draft.id}`, () =>
          markPublished(o.db, draft.id, published, links.text ?? links.comment),
        );
        stats.published.push({ id: draft.id, platform: draft.platform, url: published.url });
        continue;
      }
      await send(
        ctx,
        o,
        content,
        {
          draftId: draft.id,
          platform: draft.platform,
          link: links.text ?? links.comment,
          comment: links.comment,
          account,
          since: taken.since,
          text: post.text,
          target,
          tries: taken.tried ? 2 : 1,
          sendKey: taken.sendKey,
          ...(taken.tried ? { recheck: true } : {}),
        },
        post,
        stats,
        busy,
        open,
      );
    }
    ctx.set(PUBLISHING, open);
    if (open.length)
      stats.posting = open.map((p) => ({ id: p.draftId, platform: p.platform, since: p.since }));
    const next = await ctx.run("next due", () => nextDue(o.db, now));
    const delayMs =
      stats.remaining > 0 || busy.size > 0
        ? BUSY_MS
        : next
          ? Math.max(BUSY_MS, Math.min(idleMs, new Date(next).getTime() - now.getTime()))
          : idleMs;
    const outcome: PassOutcome<PublishStats> = {
      stats,
      error: null,
      failures: 0,
      delayMs,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    const notifier = o.notifier;
    const unsure = stats.unsure ?? [];
    if (notifier && (stats.published.length > 0 || stats.failed.length > 0 || unsure.length > 0)) {
      const lines = [
        ...stats.published.map((p) => `posted on ${p.platform}: ${p.url}`),
        ...stats.failed.map((f) => `${f.platform} failed: ${f.error}`),
        ...unsure.map((u) => `${u.platform} may have gone out, check it in To approve: ${u.why}`),
        ...(stats.posting ?? []).map((w) => `${w.platform} still posting since ${w.since}`),
      ];
      await ctx.run("notify", () =>
        notifier.notify(
          `content: ${stats.published.length} posted, ${stats.failed.length} failed${unsure.length ? `, ${unsure.length} may have gone out` : ""}`,
          lines.join("\n"),
          stats.failed.length > 0 || unsure.length > 0 ? "warning" : "info",
        ),
      );
    }
    return outcome;
  }
}

export type ContentScheduler = ReturnType<typeof makeContentScheduler>;
