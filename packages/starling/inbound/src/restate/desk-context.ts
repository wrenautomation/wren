/** The content desk's context, built once per desk: the scope a call drafts in and the drafting steps every group shares. */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { byOf } from "@wren/core/ask";
import type { Platform } from "@wren/core/content";
import { PLATFORMS } from "@wren/core/content";
import type { KeyStore } from "@wren/core/keys";
import { isVendorStop, meteredModel } from "@wren/core/metered";
import { PortalRefusal, terminalOf } from "@wren/core/portal";
import { clientOfKey } from "@wren/core/restate";
import { gate } from "@wren/core/vendors";
import type { Db, Queryable } from "@wren/db";
import { type LlmClient, llmForKey, type Tracer } from "@wren/llm";
import { z } from "zod";
import type { SlidePainter } from "../carousel.js";
import { clientContent, clientPlan } from "../clients.js";
import { DRAFT_STAGE, type DraftOptions, type DraftResult, draftIdea } from "../draft.js";
import { getIdea } from "../ideas.js";
import type { MediaStoreOptions } from "../media.js";
import { approveDrafts } from "../review.js";
import { slotsOf } from "../slots.js";
import { type Brand, DEFAULT_BRAND } from "../voice.js";
import { type ContentPlanner, PLANNER_KEY, type PlannerSettings } from "./planner.js";

/**
 * May this client's desk draft now, and on which platforms? Its plan installed with an About, a
 * login that posts, and its `models` gate open. Read only: the portal asks it before starting one.
 */
export async function clientDrafting(main: Db, id: string) {
  const c = await clientContent(main, id, "content.planner");
  if (c.kind === "gone") return { ok: false as const, why: c.why };
  const p = clientPlan(c.client);
  if (!p.ok) return p;
  const g = await gate(main, id, "models", 1, new Date());
  return g.ok
    ? { ...p, platforms: c.platforms as Platform[] }
    : { ok: false as const, why: `models: ${g.why}` };
}

export interface ContentDeskDeps {
  db: Db;
  llm: LlmClient;
  /** Platforms drafted when a request names none: the configured channels. */
  platforms: readonly Platform[];
  /** Approved drafts take their platform's next slot on this clock (`WREN_SEND_TIMEZONE`). */
  zone: string;
  voice?: string;
  brand?: Brand;
  tracer?: Tracer | null;
  /** The media store a field's file goes to (thumbnail, cover); none: `attach` refuses. */
  media?: MediaStoreOptions;
  /** Draws a carousel's slides (a chromium); none: slides save but don't draw here. */
  slides?: SlidePainter;
  /**
   * A client's desk: its database, the model its drafts run on (Wren's) and the store its own
   * model key is in. None: a client's key fails.
   */
  clients?: { clientDb: (client: string) => Db; llm: LlmClient | null; keys?: KeyStore | null };
  /** A post just went out on `platform` (a client's, or Wren's at null): its replies read warm. */
  posted?: (ctx: restate.ObjectContext, platform: Platform, client: string | null) => void;
}

/** One desk call's database, model and words: Wren's, or a client's. */
interface Scope {
  db: Db;
  llm: LlmClient;
  voice?: string;
  brand?: Brand;
  /** A client's: the platforms its logins post on, drafted when a request names none. */
  platforms?: Platform[];
}

export interface DraftRequest {
  ideaId: string;
  /** Default: every configured platform. */
  platforms?: Platform[];
  again?: boolean;
}

export type DraftReport = { ideaId: string; results: DraftResult[]; runId: string };

/** One platform's line in Write's answer: its draft, or why not; after a yes, when it posts. */
export interface WriteResult {
  platform: Platform;
  draftId: string | null;
  text: string | null;
  title: string | null;
  reason: string | null;
  /** Its slot after a yes; null on the next pass. */
  at?: string | null;
  /** Why the yes didn't take: it waits as a draft. */
  held?: string;
}

export const written = (r: DraftResult): WriteResult =>
  r.ok
    ? {
        platform: r.platform,
        draftId: r.draft.id,
        text: r.draft.text,
        title: r.draft.title,
        reason: null,
      }
    : { platform: r.platform, draftId: null, text: null, title: null, reason: r.reason };

export const WRITE_GO = ["draft", "slot", "now"] as const;

export type WriteGo = (typeof WRITE_GO)[number];

export const NONE = z.looseObject({});

/** A refusal the person can fix (not approved yet, no such video) fails the call, never retries. */
export const verdictOf = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (err) {
    throw new restate.TerminalError((err as Error).message, { errorCode: 409 });
  }
};

/**
 * A verdict the review refuses (not waiting, over the cap) is the person's to fix, so it fails
 * the call instead of retrying. ponytail: a database blip fails it too; the person clicks again.
 */
export const verdict = (f: () => Promise<{ id: string }[]>): Promise<{ done: string[] }> =>
  verdictSaved(f, () => undefined);

/** A verdict that also answers what the save moved (`saved`), so the page patches itself. */
export const verdictSaved = async <T extends { id: string }, S>(
  f: () => Promise<T[]>,
  saved: (rows: T[]) => S,
): Promise<{ done: string[]; saved?: NonNullable<S> }> => {
  try {
    const rows = await f();
    const moved = saved(rows);
    return {
      done: rows.map((d) => d.id),
      ...(moved == null ? {} : { saved: moved as NonNullable<S> }),
    };
  } catch (err) {
    // A coded refusal (words that moved since the page drew them) keeps its code.
    if (err instanceof PortalRefusal) throw terminalOf(err);
    throw new restate.TerminalError((err as Error).message, { errorCode: 409 });
  }
};

/** A client's vendor gate said no mid-call: those platforms weren't drafted, and say why. */
/** The line over each slide: the brand that speaks. */
export const byLine = (s: Pick<Scope, "brand">) => (s.brand ?? DEFAULT_BRAND).name;

export async function stopped(
  platforms: readonly Platform[],
  work: () => Promise<DraftResult[]>,
): Promise<DraftResult[]> {
  try {
    return await work();
  } catch (err) {
    if (!isVendorStop(err)) throw err;
    return platforms.map((platform) => ({ platform, ok: false, reason: `models: ${err.why}` }));
  }
}

export function contentDeskContext(deps: ContentDeskDeps) {
  const options = (s: Scope, runId: string, again: boolean): DraftOptions => ({
    runId,
    again,
    ...(s.voice !== undefined ? { voice: s.voice } : {}),
    ...(s.brand ? { brand: s.brand } : {}),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
  });
  const wren: Scope = {
    db: deps.db,
    llm: deps.llm,
    ...(deps.voice !== undefined ? { voice: deps.voice } : {}),
    ...(deps.brand ? { brand: deps.brand } : {}),
  };
  /**
   * Who this call is for. A client's drafts need its About and its `models` gate open (asked once
   * a call); a verdict needs only its database.
   */
  const scopeOf = async (ctx: restate.ObjectSharedContext, drafts = false): Promise<Scope> => {
    const owner = clientOfKey(ctx.key);
    if (!owner) return wren;
    const clients = deps.clients;
    if (!clients) throw new restate.TerminalError("no client databases here", { errorCode: 404 });
    const id = owner.client;
    const db = clients.clientDb(id);
    if (!drafts) return { db, llm: deps.llm };
    const plan = await ctx.run("client", () => clientDrafting(deps.db, id));
    if (!plan.ok || !clients.llm)
      throw new restate.TerminalError(plan.ok ? "no model here" : plan.why, { errorCode: 409 });
    return {
      db,
      llm: meteredModel(clients.llm, {
        main: deps.db,
        client: id,
        part: "content.planner",
        now: () => new Date(),
        store: clients.keys ?? null,
        own: llmForKey,
      }),
      voice: plan.voice,
      brand: plan.brand,
      platforms: plan.platforms,
    };
  };
  /** Wren's posts land on the planner's slots; a client's on the defaults. */
  /**
   * Write's go: "draft" leaves them waiting; "slot" or "now" gives each its yes, one at a time, so
   * a draft that can't go yet (Reddit with no subreddit) stays a draft and says why.
   */
  async function goOn(
    ctx: restate.ObjectContext,
    db: Queryable,
    out: { results: WriteResult[] }[],
    go: WriteGo,
    by: ReturnType<typeof byOf>,
  ) {
    if (go === "draft") return;
    const slots = go === "slot" ? await slotsHere(ctx) : undefined;
    for (const post of out)
      for (const r of post.results) {
        if (!r.draftId) continue;
        const id = r.draftId;
        const why = await ctx.run(`approve ${id}`, async () => {
          try {
            const [row] = await approveDrafts(db, [id], {
              now: new Date(),
              zone: deps.zone,
              asap: go === "now",
              ...(slots ? { slots } : {}),
              by,
            });
            return { at: row?.scheduledFor?.toISOString() ?? null, error: null };
          } catch (err) {
            return { at: null, error: err instanceof Error ? err.message : String(err) };
          }
        });
        if (why.error) r.held = why.error;
        else r.at = why.at;
      }
  }
  async function slotsHere(ctx: restate.ObjectContext) {
    const planned = clientOfKey(ctx.key)
      ? null
      : (await ctx.objectClient<ContentPlanner>({ name: "ContentPlanner" }, PLANNER_KEY).status())
          .settings;
    return slotsOf((planned as PlannerSettings | null)?.slots);
  }
  async function draft(ctx: restate.ObjectContext, req: DraftRequest): Promise<DraftReport> {
    for (const p of req.platforms ?? [])
      if (!PLATFORMS.includes(p))
        throw new restate.TerminalError(`unknown platform ${p}`, { errorCode: 400 });
    const s = await scopeOf(ctx, true);
    // A client's drafts only where its own logins post.
    const own = s.platforms;
    const platforms = own
      ? (req.platforms ?? own).filter((p) => own.includes(p))
      : (req.platforms ?? deps.platforms);
    const idea = await ctx.run("read idea", () => getIdea(s.db, req.ideaId));
    const runId = await ctx.run("open run", async () => {
      const run = await openRun(s.db, {
        command: `content draft`,
        argv: { idea: idea.id, platforms, again: req.again ?? false },
      });
      return run.id;
    });
    const results: DraftResult[] = [];
    for (const platform of platforms) {
      const [r] = await ctx.run(`${DRAFT_STAGE} ${platform}`, () =>
        stopped([platform], () =>
          draftIdea(s.db, s.llm, idea, [platform], options(s, runId, req.again ?? false)),
        ),
      );
      if (r) results.push(r);
    }
    const stats = {
      drafted: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => !r.ok).length,
    };
    await ctx.run("finish run", () => finishRun(s.db, runId, stats));
    return { ideaId: idea.id, results, runId };
  }
  return { deps, options, wren, scopeOf, goOn, slotsHere, draft };
}

export type ContentDeskContext = ReturnType<typeof contentDeskContext>;
