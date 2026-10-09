/**
 * LearnConsole: the Learn app's hands. Save a link (the box, the phone's Shortcut), follow a
 * source and pick when it tells you, browse items like a drive (places, filters, sorts,
 * collections, tags, marks), keep where playback is, read one again, ask for items in an SOP,
 * and search every transcript. A save that still has to be read goes onto the spine.
 *
 * Every call works in one workspace, picked here as in the Inbox: Wren's own for its team naming
 * no client, else the client the guard opened, checked again (its Learn grant, read or act).
 * Every row read or changed is that workspace's; another's is "no such item".
 */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import {
  answer,
  canAt,
  isOperator,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
  teamCan,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import { atomic, type Db, setAuditActor, type Tx } from "@wren/db";
import type { Embed } from "@wren/llm";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  bellOf,
  bellSeen,
  digestMailOn,
  picksOf,
  setDigestMail,
  setPick,
  todayOf,
} from "./alerts.js";
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
  markSeen,
  mediaOf,
  moveItems,
  opened,
  PLACES,
  progress,
  rail,
  SORTS,
  sourcesByKind,
  tagItems,
  unseen,
} from "./drive.js";
import { type FetchFn, follow, itemEvent, tellSources, unfollowSources } from "./feeds.js";
import { saveLink, searchItems } from "./items.js";
import { cleanUrl } from "./links.js";
import {
  ALERT_PICKS,
  ALERTS_PER_HOUR,
  type AlertPick,
  items,
  TELLS,
  type Tell,
  TYPES,
  VIAS,
  type Via,
} from "./schema.js";
import { askSop, writeClientAsked } from "./sops.js";

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
export interface PickRequest extends PortalRequest {
  /** A source's id, or `saved` for links saved by hand. */
  source: string;
  pick: string;
}
export interface DigestMailRequest extends PortalRequest {
  on: boolean;
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

const pickOf = (v: string | null | undefined): AlertPick => {
  if (!v || !(ALERT_PICKS as readonly string[]).includes(v))
    throw new PortalRefusal(`alerts are one of ${ALERT_PICKS.join(", ")}`, 400);
  return v as AlertPick;
};

/** A link the save can keep, or a refusal: checked before any journaled run. */
export function checkUrl(raw: string | null | undefined): string {
  try {
    return cleanUrl(raw ?? "");
  } catch {
    throw new PortalRefusal("a web address, starting https://", 400);
  }
}

/** A client's own database, where its Notes live: an SOP from its items goes there. */
export type ClientDbOf = (client: string) => Db;

/**
 * The workspace a call works in. Wren's team naming no client: Wren's own, for those who hold
 * Wren's team. Anyone else: the client the guard opened (the login's own when none is named),
 * checked again here for `need` in its Learn app. A write never lands on the demo.
 */
export async function learnPlace(
  main: Db,
  req: PortalRequest,
  need: "read" | "act",
): Promise<string> {
  const named = typeof req.client === "string" && req.client !== "" && req.client !== WREN;
  if (!named && isOperator(req.viewer)) {
    if (!teamCan(req, "team", WREN)) throw new PortalRefusal("no access", 403);
    return WREN;
  }
  const c = need === "act" ? (await pickForWrite(main, req)).client : await pickClient(main, req);
  if (!(await canAt(main, req, need, { client: c.id, app: "learn" })))
    throw new PortalRefusal(need === "act" ? "your role can't do that" : "no access", 403);
  return c.id;
}

/**
 * May this viewer change the workspace's own Learn settings? Wren's: a team seat with manage at
 * Wren (an admin). A client's: manage there (an owner, or a grant).
 */
export async function mayManage(main: Db, req: PortalRequest, client: string): Promise<boolean> {
  if (client === WREN) return teamCan(req, "manage", WREN);
  return canAt(main, req, "manage", { client, app: "learn" });
}

/** The handlers as plain functions: the service wraps them, tests call them. */
export function learnConsoleApi(
  db: Db,
  fetchFn: FetchFn = fetch,
  clientDb?: ClientDbOf,
  embed: Embed | null = null,
) {
  const reads = (req: PortalRequest) => learnPlace(db, req, "read");
  const acts = (req: PortalRequest) => learnPlace(db, req, "act");
  const write = async <T>(req: PortalRequest, fn: (tx: Tx, client: string) => Promise<T>) => {
    const client = await acts(req);
    return atomic(db, async (tx) => {
      await setAuditActor(tx, by(req));
      return fn(tx, client);
    });
  };
  const done = (ids: number[]) => ({ done: ids.map(String) });
  return {
    save: async (req: SaveRequest) => {
      checkUrl(req.url);
      const client = await acts(req);
      const s = await saveLink(db, {
        client,
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
      const client = await acts(req);
      try {
        const got = await follow(db, fetchFn, {
          client,
          url,
          name: req.name ?? null,
          tell,
          by: by(req),
        });
        return { id: String(got.id), name: got.name, kind: got.kind, items: got.items };
      } catch (err) {
        throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
      }
    },
    /** The workspace's alerts for a source: everyone without a pick of their own, and Discord. */
    tell: async (req: TellRequest) => {
      const tell = tellOf(req.tell);
      if (!tell) throw new PortalRefusal("pick when to tell you", 400);
      const ids = idsOf(req);
      if (!(await mayManage(db, req, await acts(req))))
        throw new PortalRefusal("only someone who manages this workspace can change that", 403);
      return write(req, async (tx, client) => done(await tellSources(tx, client, ids, tell)));
    },
    unfollow: (req: IdsRequest) => {
      const ids = idsOf(req);
      return write(req, async (tx, client) => done(await unfollowSources(tx, client, ids)));
    },
    browse: async (req: BrowseRequest) => {
      const client = await reads(req);
      return refuse(() =>
        browse(db, client, {
          place: req.place,
          types: req.types,
          sources: req.sources,
          tag: req.tag,
          q: req.q,
          sort: req.sort,
          offset: req.offset,
          limit: req.limit,
        }),
      );
    },
    rail: async (req: PortalRequest) => rail(db, await reads(req)),
    /** Learn's badge: new from sources since this viewer last looked. */
    unseen: async (req: PortalRequest) => ({ n: await unseen(db, await reads(req), by(req)) }),
    // Your own "last looked": a read, as a star is.
    seen: async (req: PortalRequest) => {
      const client = await reads(req);
      await markSeen(db, client, by(req));
      return { ok: true };
    },
    /** The media these items may load in this workspace: its own items' only. */
    media: async (req: IdsRequest) => ({
      urls: await mediaOf(db, idsOf(req), await reads(req)),
    }),
    home: async (req: PortalRequest) => home(db, await reads(req)),
    /**
     * Each source with this viewer's own alert pick on it, and whether they may set the
     * workspace's (`may`: they manage it).
     */
    sources: async (req: PortalRequest) => {
      const client = await reads(req);
      const [kinds, picks, may] = await Promise.all([
        sourcesByKind(db, client),
        picksOf(db, client, by(req)),
        mayManage(db, req, client),
      ]);
      return {
        may,
        kinds: kinds.map((k) => ({
          ...k,
          sources: k.sources.map((s) => ({ ...s, alert: picks.sources[s.id] ?? null })),
        })),
      };
    },
    /** Your bell here: what rang lately, and how many you haven't seen. */
    bell: async (req: PortalRequest) => bellOf(db, await reads(req), by(req)),
    bellSeen: async (req: PortalRequest) => ({
      n: await bellSeen(db, await reads(req), by(req)),
    }),
    /** Your digest: the last 24 hours here, best first. */
    today: async (req: PortalRequest) => todayOf(db, await reads(req), by(req)),
    /** Your pick for saved links, the bell's hourly limit, and whether the digest is mailed. */
    alerts: async (req: PortalRequest) => {
      const client = await reads(req);
      const [picks, mail] = await Promise.all([
        picksOf(db, client, by(req)),
        digestMailOn(db, client),
      ]);
      return {
        saved: picks.saved,
        perHour: ALERTS_PER_HOUR,
        mail: { on: mail, may: await mayManage(db, req, client), to: by(req) },
      };
    },
    alertPick: async (req: PickRequest) => {
      const pick = pickOf(req.pick);
      const on = req.source === "saved" ? ("saved" as const) : idOf(req.source);
      if (on === "saved" && pick === "every")
        throw new PortalRefusal("saved links alert on a high score or not at all", 400);
      const client = await reads(req);
      if (!(await setPick(db, client, by(req), on, pick)))
        throw new PortalRefusal("no such source", 404);
      return { source: String(on), pick };
    },
    digestMail: async (req: DigestMailRequest) => {
      if (typeof req.on !== "boolean") throw new PortalRefusal("on or off", 400);
      const client = await acts(req);
      if (!(await mayManage(db, req, client)))
        throw new PortalRefusal("only someone who manages this workspace can change that", 403);
      await setDigestMail(db, client, req.on, by(req));
      return { on: req.on };
    },
    mark: async (req: MarkRequest) => {
      if (!(MARKS as readonly string[]).includes(req.mark))
        throw new PortalRefusal(`mark is one of ${MARKS.join(", ")}`, 400);
      const ids = idsOf(req);
      return write(req, async (tx, client) => done(await mark(tx, client, ids, req.mark as Mark)));
    },
    // Where you are in an item: kept on a read, as `seen` is.
    open: async (req: ItemRequest) => {
      await opened(db, await reads(req), idOf(req.id));
      return { ok: true };
    },
    progress: async (req: ProgressRequest) => {
      if (!Number.isFinite(req.position)) throw new PortalRefusal("a position in seconds", 400);
      await progress(db, await reads(req), {
        id: idOf(req.id),
        position: req.position,
        duration: req.duration,
      });
      return { ok: true };
    },
    move: async (req: MoveRequest) => {
      const ids = idsOf(req);
      const to = maybeId(req.collection);
      return refuse(() =>
        write(req, async (tx, client) => done(await moveItems(tx, client, ids, to))),
      );
    },
    tag: async (req: TagRequest) => {
      const ids = idsOf(req);
      return write(req, async (tx, client) =>
        done(await tagItems(tx, client, ids, { add: req.add ?? [], remove: req.remove ?? [] })),
      );
    },
    collectionAdd: (req: CollectionRequest) =>
      refuse(() =>
        write(req, async (tx, client) => {
          const c = await addCollection(tx, client, {
            name: req.name ?? "",
            parentId: maybeId(req.parent),
            by: by(req),
          });
          return { id: String(c.id), name: c.name };
        }),
      ),
    collectionEdit: (req: CollectionRequest) =>
      refuse(() =>
        write(req, async (tx, client) => {
          const c = await editCollection(tx, client, {
            id: idOf(req.id),
            name: req.name,
            ...(req.parent !== undefined ? { parentId: maybeId(req.parent) } : {}),
          });
          return { id: String(c.id), name: c.name };
        }),
      ),
    collectionDrop: (req: CollectionRequest) =>
      write(req, async (tx, client) => {
        if (!(await dropCollection(tx, client, idOf(req.id))))
          throw new PortalRefusal("no such collection", 404);
        return { done: [String(req.id)] };
      }),
    /**
     * Clear a failed read, or a score that waited (a client's models allowance), so it's taken
     * again; returns those to put back on the spine.
     */
    readAgain: (req: IdsRequest) => {
      const ids = idsOf(req);
      return write(req, async (tx, client) =>
        done(
          (
            await tx
              .update(items)
              .set({ readFailure: null, tries: 0 })
              .where(
                and(
                  inArray(items.id, ids),
                  eq(items.client, client),
                  or(isNull(items.readAt), isNull(items.verdict)),
                ),
              )
              .returning({ id: items.id })
          ).map((r) => r.id),
        ),
      );
    },
    /**
     * Ask for items in an SOP. Wren's go to its folders on the Mac; a client's read items go into
     * its own Notes now, and the rest once read.
     */
    toSop: async (req: SopRequest) => {
      const ids = idsOf(req);
      const client = await acts(req);
      const out: string[] = [];
      for (const itemId of ids) {
        try {
          const row = await askSop(db, { client, itemId, sop: req.sop ?? "", by: by(req) });
          out.push(String(row.itemId));
        } catch (err) {
          throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
        }
      }
      if (client !== WREN && clientDb) {
        const notesDb = clientDb(client);
        for (const itemId of ids) await writeClientAsked(db, client, notesDb, { itemId });
      }
      return { done: out };
    },
    search: async (req: SearchRequest) => ({
      hits: await searchItems(db, await reads(req), req.q ?? "", 40, embed),
    }),
    item: async (req: ItemRequest) => {
      const got = await itemPage(db, await reads(req), idOf(req.id));
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

export function makeLearnConsole(
  db: Db,
  fetchFn: FetchFn = fetch,
  clientDb?: ClientDbOf,
  embed: Embed | null = null,
) {
  const api = learnConsoleApi(db, fetchFn, clientDb, embed);
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
      rail: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.rail(req)),
      ),
      home: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.home(req)),
      ),
      sources: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.sources(req)),
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
            sop: z.string().describe("The SOP's name: lowercase letters, digits and dashes"),
          }),
        },
        // Not in a run: an ask is an upsert, and a client's note is made once (state `added`).
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
      unseen: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.unseen(req)),
      ),
      seen: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.seen(req)),
      ),
      bell: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.bell(req)),
      ),
      bellSeen: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.bellSeen(req)),
      ),
      today: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.today(req)),
      ),
      alerts: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.alerts(req)),
      ),
      alertPick: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            source: z.string().describe("A source's id, or saved for links saved by hand"),
            pick: z
              .string()
              .describe(`${ALERT_PICKS.join(", ")}: every post, score 8 and up, or none`),
          }),
        },
        (_: restate.Context, req: PickRequest) => answer(() => api.alertPick(req)),
      ),
      digestMail: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            on: z.boolean().describe("Mail each person their daily digest at their login address"),
          }),
        },
        (_: restate.Context, req: DigestMailRequest) => answer(() => api.digestMail(req)),
      ),
      media: serviceHandler(
        { input: z.looseObject({ ...IDS, ids: z.array(z.string()).max(200) }) },
        (_: restate.Context, req: IdsRequest) => answer(() => api.media(req)),
      ),
    },
  });
}
