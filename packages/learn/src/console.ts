/**
 * LearnConsole: the Learn app's hands. Save a link (the box, the phone's Shortcut), follow a
 * source and pick when it tells William, mark items done, read one again, ask for items in an
 * SOP, and search every transcript. A save that still has to be read goes onto the spine.
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
import { spineEmit } from "@wren/core/spine";
import { atomic, type Db, setAuditActor, type Tx } from "@wren/db";
import { and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { LEARN_CONSOLE_APPS, LEARN_CONSOLE_ROUTES } from "./console-routes.js";
import { type FetchFn, follow, itemEvent } from "./feeds.js";
import { itemOf, saveLink, searchItems } from "./items.js";
import { cleanUrl } from "./links.js";
import { items, sources, TELLS, type Tell, VIAS, type Via } from "./schema.js";
import { askSop } from "./sops.js";

/** The workflow Learn's items walk, and where a save and a feed item enter it. */
export const LEARN_FLOW = "learn";
export const LEARN_SAVED_FROM = "saved.item";
export const LEARN_FEEDS_FROM = "feeds.items";

export interface IdsRequest extends PortalRequest {
  ids: string[];
}
export interface SaveRequest extends PortalRequest {
  url: string;
  title?: string | null;
  via?: string | null;
}
export interface FollowRequest extends PortalRequest {
  url: string;
  name?: string | null;
  tell?: string | null;
}
export interface TellRequest extends IdsRequest {
  tell: string;
}
export interface SopRequest extends IdsRequest {
  sop: string;
}
export interface SearchRequest extends PortalRequest {
  q: string;
}
export interface ItemRequest extends PortalRequest {
  id: string;
}

const idsOf = (req: IdsRequest) => {
  const ids = (req.ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) throw new PortalRefusal("nothing picked", 404);
  return ids;
};
const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const tellOf = (v: string | null | undefined): Tell | null => {
  if (!v) return null;
  if (!(TELLS as readonly string[]).includes(v))
    throw new PortalRefusal(`Tell me is one of ${TELLS.join(", ")}`, 400);
  return v as Tell;
};
const viaOf = (v: string | null | undefined): Via =>
  v && (VIAS as readonly string[]).includes(v) ? (v as Via) : "portal";

/** A link the save can keep, or a refusal: checked before any journaled run. */
export function checkUrl(raw: string | null | undefined): string {
  try {
    return cleanUrl(raw ?? "");
  } catch {
    throw new PortalRefusal("a web address, starting https://", 400);
  }
}

/** The handlers as plain functions: the service wraps them, tests call them. */
export function learnConsoleApi(db: Db, fetchFn: FetchFn = fetch) {
  const write = <T>(req: PortalRequest, fn: (tx: Tx) => Promise<T>) =>
    atomic(db, async (tx) => {
      await setAuditActor(tx, by(req));
      return fn(tx);
    });
  const done = (rows: { id: number }[]) => ({ done: rows.map((r) => String(r.id)) });
  return {
    save: async (req: SaveRequest) => {
      checkUrl(req.url);
      const s = await saveLink(db, {
        url: req.url,
        by: by(req),
        via: viaOf(req.via),
        title: req.title ?? null,
      });
      return { id: String(s.id), url: s.url, kind: s.kind, fresh: s.fresh, unread: s.unread };
    },
    follow: async (req: FollowRequest) => {
      const url = req.url?.trim();
      if (!url || !/^https?:\/\//.test(url)) throw new PortalRefusal("an https address", 400);
      const tell = tellOf(req.tell);
      try {
        const got = await follow(db, fetchFn, { url, name: req.name ?? null, tell, by: by(req) });
        return { id: String(got.id), name: got.name, kind: got.kind, items: got.items };
      } catch (err) {
        throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
      }
    },
    tell: (req: TellRequest) => {
      const tell = tellOf(req.tell);
      if (!tell) throw new PortalRefusal("pick when to tell you", 400);
      return write(req, async (tx) =>
        done(
          await tx
            .update(sources)
            .set({ tell })
            .where(inArray(sources.id, idsOf(req)))
            .returning({ id: sources.id }),
        ),
      );
    },
    unfollow: (req: IdsRequest) =>
      write(req, async (tx) =>
        done(
          await tx
            .update(sources)
            .set({ stoppedAt: new Date() })
            .where(and(inArray(sources.id, idsOf(req)), isNull(sources.stoppedAt)))
            .returning({ id: sources.id }),
        ),
      ),
    itemDone: (req: IdsRequest) =>
      write(req, async (tx) =>
        done(
          await tx
            .update(items)
            .set({ doneAt: new Date() })
            .where(and(inArray(items.id, idsOf(req)), isNull(items.doneAt)))
            .returning({ id: items.id }),
        ),
      ),
    itemUndone: (req: IdsRequest) =>
      write(req, async (tx) =>
        done(
          await tx
            .update(items)
            .set({ doneAt: null })
            .where(inArray(items.id, idsOf(req)))
            .returning({ id: items.id }),
        ),
      ),
    /** Clear a failed read so the reader takes it again; returns those to put back on the spine. */
    readAgain: (req: IdsRequest) =>
      write(req, async (tx) =>
        done(
          await tx
            .update(items)
            .set({ readFailure: null, tries: 0 })
            .where(and(inArray(items.id, idsOf(req)), isNull(items.readAt)))
            .returning({ id: items.id }),
        ),
      ),
    toSop: async (req: SopRequest) => {
      const ids = idsOf(req);
      const out: string[] = [];
      for (const itemId of ids) {
        try {
          const row = await askSop(db, { itemId, sop: req.sop ?? "", by: by(req) });
          out.push(String(row.itemId));
        } catch (err) {
          throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
        }
      }
      return { done: out };
    },
    search: async (req: SearchRequest) => ({ hits: await searchItems(db, req.q ?? "") }),
    item: async (req: ItemRequest) => {
      const got = await itemOf(db, Number(req.id));
      if (!got) throw new PortalRefusal("no such item", 404);
      return got;
    },
  };
}

const IDS = { ...PORTAL_FIELDS, ids: z.array(z.string()) };
const TELL = z
  .string()
  .nullish()
  .describe(`${TELLS.join(", ")}: every item, score 8 and up, or the daily digest`);

export function makeLearnConsole(db: Db, fetchFn: FetchFn = fetch) {
  const api = learnConsoleApi(db, fetchFn);
  const read = (ctx: restate.Context, ids: string[]) => {
    if (ids.length)
      spineEmit(ctx, {
        client: null,
        workflow: LEARN_FLOW,
        from: LEARN_SAVED_FROM,
        events: ids.map((id) => itemEvent(Number(id))),
      });
  };
  return portalService({
    name: "LearnConsole",
    main: db,
    routes: LEARN_CONSOLE_ROUTES,
    apps: LEARN_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      save: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            url: z.string().describe("The link: a reel, a video, a post, an article"),
            title: z.string().nullish().describe("Blank takes the page's own"),
            via: z
              .string()
              .nullish()
              .describe(`${VIAS.join(", ")}; portal when blank`),
          }),
        },
        // A bad address refuses before the run, which would retry a refusal forever.
        (ctx: restate.Context, req: SaveRequest) =>
          answer(async () => {
            checkUrl(req.url);
            const saved = await ctx.run("save", () => api.save(req));
            if (saved.unread) read(ctx, [saved.id]);
            return saved;
          }),
      ),
      follow: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            url: z.string().describe("A feed, or a page that names one: a channel, a blog"),
            name: z.string().nullish().describe("Blank takes the feed's own title"),
            tell: TELL,
          }),
        },
        // Not in a run: a bad address is a refusal. A retry reads again and upserts the same row.
        (_: restate.Context, req: FollowRequest) => answer(() => api.follow(req)),
      ),
      tell: serviceHandler(
        { input: z.looseObject({ ...IDS, tell: z.string().describe(TELLS.join(", ")) }) },
        (_: restate.Context, req: TellRequest) => answer(() => api.tell(req)),
      ),
      unfollow: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.unfollow(req)),
      ),
      itemDone: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.itemDone(req)),
      ),
      itemUndone: serviceHandler(
        { input: z.looseObject(IDS) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.itemUndone(req)),
      ),
      readAgain: serviceHandler(
        { input: z.looseObject(IDS) },
        (ctx: restate.Context, req: IdsRequest) =>
          answer(async () => {
            idsOf(req);
            const out = await ctx.run("read again", () => api.readAgain(req));
            read(ctx, out.done);
            return out;
          }),
      ),
      toSop: serviceHandler(
        {
          input: z.looseObject({
            ...IDS,
            sop: z.string().describe("The SOP's folder name, as wren sop ls prints it"),
          }),
        },
        (_: restate.Context, req: SopRequest) => answer(() => api.toSop(req)),
      ),
      search: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, q: z.string().describe("Words to find") }) },
        (_: restate.Context, req: SearchRequest) => answer(() => api.search(req)),
      ),
      item: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: z.string() }) },
        (_: restate.Context, req: ItemRequest) => answer(() => api.item(req)),
      ),
    },
  });
}
