/**
 * LearnConsole: the Learn app's hands. Save a link (the box, the phone's Shortcut), follow a
 * source and pick when it tells William, browse items like a drive (places, filters, sorts,
 * collections, tags, marks), keep where playback is, read one again, ask for items in an SOP,
 * and search every transcript. A save that still has to be read goes onto the spine.
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
import {
  addCollection,
  browse,
  dropCollection,
  editCollection,
  home,
  itemPage,
  MARKS,
  type Mark,
  mark,
  moveItems,
  opened,
  PLACES,
  progress,
  rail,
  SORTS,
  sourcesByKind,
  tagItems,
} from "./drive.js";
import { type FetchFn, follow, itemEvent } from "./feeds.js";
import { saveLink, searchItems } from "./items.js";
import { cleanUrl } from "./links.js";
import { items, sources, TELLS, type Tell, TYPES, VIAS, type Via } from "./schema.js";
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
export interface BrowseRequest extends PortalRequest {
  place?: string | null;
  types?: string[] | null;
  sources?: string[] | null;
  tag?: string | null;
  q?: string | null;
  sort?: string | null;
  offset?: number | null;
  limit?: number | null;
}
export interface MarkRequest extends IdsRequest {
  mark: string;
}
export interface ProgressRequest extends PortalRequest {
  id: string;
  position: number;
  duration?: number | null;
}
export interface MoveRequest extends IdsRequest {
  /** The collection's id; blank takes them out of every collection. */
  collection?: string | null;
}
export interface TagRequest extends IdsRequest {
  add?: string[] | null;
  remove?: string[] | null;
}
export interface CollectionRequest extends PortalRequest {
  id?: string | null;
  name?: string | null;
  /** The collection it goes inside; blank for the top. */
  parent?: string | null;
}

const idsOf = (req: IdsRequest) => {
  const ids = (req.ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) throw new PortalRefusal("nothing picked", 404);
  return ids;
};
const idOf = (raw: string | number | null | undefined): number => {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal("no such item", 404);
  return n;
};
const maybeId = (raw: string | null | undefined): number | null =>
  raw === null || raw === undefined || raw === "" ? null : idOf(raw);
/** A library error as a refusal the viewer reads. */
const refuse = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PortalRefusal) throw err;
    throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
  }
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
    browse: (req: BrowseRequest) =>
      refuse(() =>
        browse(db, {
          place: req.place,
          types: req.types,
          sources: req.sources,
          tag: req.tag,
          q: req.q,
          sort: req.sort,
          offset: req.offset,
          limit: req.limit,
        }),
      ),
    rail: () => rail(db),
    home: () => home(db),
    sources: async () => ({ kinds: await sourcesByKind(db) }),
    mark: async (req: MarkRequest) => {
      if (!(MARKS as readonly string[]).includes(req.mark))
        throw new PortalRefusal(`mark is one of ${MARKS.join(", ")}`, 400);
      const ids = idsOf(req);
      return write(req, async (tx) => ({
        done: (await mark(tx, ids, req.mark as Mark)).map(String),
      }));
    },
    open: async (req: ItemRequest) => {
      await opened(db, idOf(req.id));
      return { ok: true };
    },
    progress: async (req: ProgressRequest) => {
      if (!Number.isFinite(req.position)) throw new PortalRefusal("a position in seconds", 400);
      await progress(db, { id: idOf(req.id), position: req.position, duration: req.duration });
      return { ok: true };
    },
    move: async (req: MoveRequest) => {
      const ids = idsOf(req);
      const to = maybeId(req.collection);
      return refuse(() =>
        write(req, async (tx) => ({ done: (await moveItems(tx, ids, to)).map(String) })),
      );
    },
    tag: async (req: TagRequest) => {
      const ids = idsOf(req);
      return write(req, async (tx) => {
        await tagItems(tx, ids, { add: req.add ?? [], remove: req.remove ?? [] });
        return { done: ids.map(String) };
      });
    },
    collectionAdd: (req: CollectionRequest) =>
      refuse(() =>
        write(req, async (tx) => {
          const c = await addCollection(tx, {
            name: req.name ?? "",
            parentId: maybeId(req.parent),
            by: by(req),
          });
          return { id: String(c.id), name: c.name };
        }),
      ),
    collectionEdit: (req: CollectionRequest) =>
      refuse(() =>
        write(req, async (tx) => {
          const c = await editCollection(tx, {
            id: idOf(req.id),
            name: req.name,
            ...(req.parent !== undefined ? { parentId: maybeId(req.parent) } : {}),
          });
          return { id: String(c.id), name: c.name };
        }),
      ),
    collectionDrop: (req: CollectionRequest) =>
      write(req, async (tx) => {
        if (!(await dropCollection(tx, idOf(req.id))))
          throw new PortalRefusal("no such collection", 404);
        return { done: [String(req.id)] };
      }),
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
      const got = await itemPage(db, idOf(req.id));
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
      browse: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            place: z
              .string()
              .nullish()
              .describe(`${PLACES.join(", ")}, c<collection id> or s<source id>; inbox when blank`),
            types: z.array(z.string()).nullish().describe(TYPES.join(", ")),
            sources: z.array(z.string()).nullish().describe("Source ids"),
            tag: z.string().nullish(),
            q: z.string().nullish().describe("Words to find"),
            sort: z.string().nullish().describe(SORTS.join(", ")),
            offset: z.number().int().min(0).nullish(),
            limit: z.number().int().min(1).max(200).nullish(),
          }),
        },
        (_: restate.Context, req: BrowseRequest) => answer(() => api.browse(req)),
      ),
      rail: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, (_: restate.Context) =>
        answer(() => api.rail()),
      ),
      home: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, (_: restate.Context) =>
        answer(() => api.home()),
      ),
      sources: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, (_: restate.Context) =>
        answer(() => api.sources()),
      ),
      mark: serviceHandler(
        { input: z.looseObject({ ...IDS, mark: z.string().describe(MARKS.join(", ")) }) },
        (_: restate.Context, req: MarkRequest) => answer(() => api.mark(req)),
      ),
      open: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: z.string() }) },
        (_: restate.Context, req: ItemRequest) => answer(() => api.open(req)),
      ),
      progress: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: z.string(),
            position: z.number().min(0).describe("Seconds in"),
            duration: z.number().min(0).nullish().describe("Seconds long, when the player knows"),
          }),
        },
        (_: restate.Context, req: ProgressRequest) => answer(() => api.progress(req)),
      ),
      move: serviceHandler(
        {
          input: z.looseObject({
            ...IDS,
            collection: z.string().nullish().describe("The collection's id; blank for none"),
          }),
        },
        (_: restate.Context, req: MoveRequest) => answer(() => api.move(req)),
      ),
      tag: serviceHandler(
        {
          input: z.looseObject({
            ...IDS,
            add: z.array(z.string()).nullish(),
            remove: z.array(z.string()).nullish(),
          }),
        },
        (_: restate.Context, req: TagRequest) => answer(() => api.tag(req)),
      ),
      collectionAdd: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            name: z.string().describe("Its name"),
            parent: z
              .string()
              .nullish()
              .describe("The collection it goes inside; blank for the top"),
          }),
        },
        (_: restate.Context, req: CollectionRequest) => answer(() => api.collectionAdd(req)),
      ),
      collectionEdit: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: z.string(),
            name: z.string().nullish().describe("A new name"),
            parent: z
              .string()
              .nullish()
              .describe("Move it inside this collection; empty string for the top"),
          }),
        },
        (_: restate.Context, req: CollectionRequest) => answer(() => api.collectionEdit(req)),
      ),
      collectionDrop: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: z.string() }) },
        (_: restate.Context, req: CollectionRequest) => answer(() => api.collectionDrop(req)),
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
