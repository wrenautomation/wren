/**
 * WatchConsole: the Inbox app's hands on the Watch. Done clears an email. Hide like this writes a
 * rule that holds the sender's mail (subject words narrow it) and clears what's waiting from
 * them; Show like this writes one that shows it. Sort again re-triages what's waiting under today's
 * rules. Rules can also be written or removed by hand. Feeds are followed and unfollowed here, and
 * a feed item is marked done.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { atomic, type Db, setAuditActor, type Tx } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { and, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { WATCH_CONSOLE_APPS, WATCH_CONSOLE_ROUTES } from "./console-routes.js";
import { type FetchFn, follow } from "./feeds.js";
import { feeds, items, mail, rules, VERDICTS, type Verdict } from "./schema.js";
import { sortAgain } from "./triage.js";

export interface IdsRequest extends PortalRequest {
  ids: string[];
}
export interface LikeRequest extends IdsRequest {
  /** Words the subject must hold too; blank is any subject. */
  subject?: string | null;
}
export interface FollowRequest extends PortalRequest {
  url: string;
  name?: string | null;
}
export interface RuleRequest extends PortalRequest {
  words: string;
  sender?: string | null;
  subject?: string | null;
  verdict?: string | null;
}

const idsOf = (req: IdsRequest) => {
  const ids = (req.ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) throw new PortalRefusal("nothing picked", 404);
  return ids;
};
const blank = (v: string | null | undefined) => v?.trim() || null;
const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;

/** The handlers as plain functions: the service wraps them, tests call them. */
export function watchConsoleApi(db: Db, llm: LlmClient | null = null, fetchFn: FetchFn = fetch) {
  const write = <T>(req: PortalRequest, fn: (tx: Tx) => Promise<T>) =>
    atomic(db, async (tx) => {
      await setAuditActor(tx, by(req));
      return fn(tx);
    });

  /** A rule per sender among `ids`, unless the same one is there; then `after` on the rows. */
  const like = (req: LikeRequest, verdict: Verdict) =>
    write(req, async (tx) => {
      const subject = blank(req.subject);
      const picked = await tx
        .select({ id: mail.id, fromAddress: mail.fromAddress })
        .from(mail)
        .where(inArray(mail.id, idsOf(req)));
      if (!picked.length) throw new PortalRefusal("no such email", 404);
      const senders = [...new Set(picked.map((m) => m.fromAddress))];
      for (const sender of senders) {
        const same = and(
          eq(rules.sender, sender),
          eq(rules.verdict, verdict),
          subject ? eq(rules.subject, subject) : isNull(rules.subject),
        );
        if ((await tx.select({ id: rules.id }).from(rules).where(same)).length) continue;
        const about = subject ? ` about "${subject}"` : "";
        await tx.insert(rules).values({
          words: `${verdict === "hold" ? "Hold" : "Show"} mail from ${sender}${about}.`,
          sender,
          subject,
          verdict,
          by: by(req),
        });
      }
      const fits: SQL | undefined = subject ? ilike(mail.subject, `%${subject}%`) : undefined;
      const rows =
        verdict === "hold"
          ? // Everything still waiting from them leaves the queue.
            await tx
              .update(mail)
              .set({ verdict: "hold", why: "You hid mail like this." })
              .where(
                and(
                  inArray(mail.fromAddress, senders),
                  isNull(mail.doneAt),
                  or(isNull(mail.verdict), eq(mail.verdict, "show")),
                  fits,
                ),
              )
              .returning({ id: mail.id })
          : await tx
              .update(mail)
              .set({ verdict: "show", why: "You asked to see mail like this.", doneAt: null })
              .where(
                inArray(
                  mail.id,
                  picked.map((m) => m.id),
                ),
              )
              .returning({ id: mail.id });
      return { done: rows.map((r) => String(r.id)), rules: senders.length };
    });

  return {
    done: (req: IdsRequest) =>
      write(req, async (tx) => {
        const rows = await tx
          .update(mail)
          .set({ doneAt: new Date() })
          .where(and(inArray(mail.id, idsOf(req)), isNull(mail.doneAt)))
          .returning({ id: mail.id });
        return { done: rows.map((r) => String(r.id)) };
      }),
    undone: (req: IdsRequest) =>
      write(req, async (tx) => {
        const rows = await tx
          .update(mail)
          .set({ doneAt: null })
          .where(inArray(mail.id, idsOf(req)))
          .returning({ id: mail.id });
        return { done: rows.map((r) => String(r.id)) };
      }),
    hide: (req: LikeRequest) => like(req, "hold"),
    show: (req: LikeRequest) => like(req, "show"),
    /** Re-triage the picked mail under today's rules; answers how many went where. */
    sort: async (req: IdsRequest) => {
      const ids = idsOf(req);
      return { done: ids.map(String), ...(await sortAgain(db, llm, ids)) };
    },
    addRule: (req: RuleRequest) =>
      write(req, async (tx) => {
        const words = blank(req.words);
        if (!words) throw new PortalRefusal("say the rule in words", 400);
        const verdict = blank(req.verdict)?.toLowerCase() ?? null;
        if (verdict && !(VERDICTS as readonly string[]).includes(verdict))
          throw new PortalRefusal(`it's one of ${VERDICTS.join(", ")}`, 400);
        const [row] = await tx
          .insert(rules)
          .values({
            words,
            sender: blank(req.sender)?.toLowerCase() ?? null,
            subject: blank(req.subject),
            verdict: verdict as Verdict | null,
            by: by(req),
          })
          .returning({ id: rules.id });
        return { id: String(row?.id), words };
      }),
    removeRule: (req: IdsRequest) =>
      write(req, async (tx) => {
        const rows = await tx
          .delete(rules)
          .where(inArray(rules.id, idsOf(req)))
          .returning({ id: rules.id });
        return { done: rows.map((r) => String(r.id)) };
      }),
    itemDone: (req: IdsRequest) =>
      write(req, async (tx) => {
        const rows = await tx
          .update(items)
          .set({ doneAt: new Date() })
          .where(and(inArray(items.id, idsOf(req)), isNull(items.doneAt)))
          .returning({ id: items.id });
        return { done: rows.map((r) => String(r.id)) };
      }),
    itemUndone: (req: IdsRequest) =>
      write(req, async (tx) => {
        const rows = await tx
          .update(items)
          .set({ doneAt: null })
          .where(inArray(items.id, idsOf(req)))
          .returning({ id: items.id });
        return { done: rows.map((r) => String(r.id)) };
      }),
    follow: async (req: FollowRequest) => {
      const url = blank(req.url);
      if (!url || !/^https?:\/\//.test(url)) throw new PortalRefusal("a feed's https address", 400);
      try {
        const got = await follow(db, fetchFn, { url, name: req.name ?? null, by: by(req) });
        return { id: String(got.id), name: got.name, items: got.items };
      } catch (err) {
        throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
      }
    },
    unfollow: (req: IdsRequest) =>
      write(req, async (tx) => {
        const rows = await tx
          .update(feeds)
          .set({ stoppedAt: new Date() })
          .where(and(inArray(feeds.id, idsOf(req)), isNull(feeds.stoppedAt)))
          .returning({ id: feeds.id });
        return { done: rows.map((r) => String(r.id)) };
      }),
  };
}

const IDS = { ...PORTAL_FIELDS, ids: z.array(z.string()) };
const SUBJECT = z.string().nullish().describe("Words the subject must hold too; blank is any");

export function makeWatchConsole(db: Db, llm: LlmClient | null) {
  const api = watchConsoleApi(db, llm);
  return portalService({
    name: "WatchConsole",
    main: db,
    routes: WATCH_CONSOLE_ROUTES,
    apps: WATCH_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      done: serviceHandler({ input: z.looseObject(IDS) }, (_: restate.Context, req: IdsRequest) =>
        answer(() => api.done(req)),
      ),
      undone: serviceHandler({ input: z.looseObject(IDS) }, (_: restate.Context, req: IdsRequest) =>
        answer(() => api.undone(req)),
      ),
      hide: serviceHandler(
        { input: z.looseObject({ ...IDS, subject: SUBJECT }) },
        (_: restate.Context, req: LikeRequest) => answer(() => api.hide(req)),
      ),
      show: serviceHandler(
        { input: z.looseObject({ ...IDS, subject: SUBJECT }) },
        (_: restate.Context, req: LikeRequest) => answer(() => api.show(req)),
      ),
      sort: serviceHandler({ input: z.looseObject(IDS) }, (ctx: restate.Context, req: IdsRequest) =>
        // The refusal for an empty pick comes before the run, which would retry it forever.
        answer(async () => (idsOf(req), ctx.run("sort", () => api.sort(req)))),
      ),
      addRule: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            words: z.string().describe("The rule in plain words"),
            sender: z
              .string()
              .nullish()
              .describe("An address or domain; with a verdict, code settles it"),
            subject: SUBJECT,
            verdict: z
              .string()
              .nullish()
              .describe(`${VERDICTS.join(", ")}; blank leaves it to the model`),
          }),
        },
        (_: restate.Context, req: RuleRequest) => answer(() => api.addRule(req)),
      ),
      removeRule: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.removeRule(req)),
      ),
      itemDone: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.itemDone(req)),
      ),
      itemUndone: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.itemUndone(req)),
      ),
      follow: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            url: z.string().describe("The feed's address: RSS or Atom"),
            name: z.string().nullish().describe("Blank takes the feed's own title"),
          }),
        },
        // Not in a run: a bad address is a refusal, which a run would retry forever. A retry reads
        // again and upserts the same row.
        (_: restate.Context, req: FollowRequest) => answer(() => api.follow(req)),
      ),
      unfollow: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.unfollow(req)),
      ),
    },
  });
}
