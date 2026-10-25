/**
 * What the three objects share: `ReachDeps` as the worker wires it, a client's own copy of it
 * (`clientDeps`: its logins' rows, its keys), the channels an account sends through
 * (`channelsFor`), the wake to the watch, and a site's refusal that never retries.
 */
import * as restate from "@restatedev/restate-sdk";
import { linkedinOutreach } from "@wren/channel-linkedin";
import { redditOutreach } from "@wren/channel-reddit";
import type { Platform as ContentPlatform, SiteClient } from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import type { FireTriggers } from "@wren/core/executor";
import type { KeyStore } from "@wren/core/keys";
import { meteredModel, meteredSites } from "@wren/core/metered";
import type { Notifier } from "@wren/core/notify";
import type { OurPost } from "@wren/core/our-posts";
import type { OutreachChannel } from "@wren/core/outreach";
import { clientKey } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { type LlmClient, llmForKey } from "@wren/llm";
import type { ClientReach, ReachPart } from "../clients.js";
import type { DmGuide } from "../drafts.js";
import type { ReachPolicy } from "../policy.js";
import type { DmPlatform, Platform, ReachAccount } from "../schema.js";
import type { ReachSequence } from "../sequences.js";

/** The `Content` service's reply handler as the worker serves it. */
export type ContentReply = {
  reply: (
    ctx: restate.Context,
    req: {
      platform: ContentPlatform;
      commentId: string;
      postId?: string | null;
      text: string;
      sendKey?: string;
      recheck?: boolean;
    },
  ) => Promise<unknown>;
  privateReply: (
    ctx: restate.Context,
    req: {
      platform: ContentPlatform;
      commentId: string;
      text: string;
      sendKey?: string;
      recheck?: boolean;
    },
  ) => Promise<unknown>;
  arm: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; commentId: string; postId?: string | null; text: string },
  ) => Promise<{ armed: boolean }>;
};

export const SENDER_KEY = "fleet";

export const WATCH_KEY = "daily";

export interface ReachDeps {
  db: Db;
  /**
   * What was pushed for our own logins (content's `SocialPushed/wren.reach`): DMs to read now,
   * and platforms a tab watcher is on, read cold. Unset: none.
   */
  pushes?: (ctx: restate.ObjectContext) => Promise<ReachView>;
  /** Each lead's DM reply to the executor's Reply triggers (`executorFire`). Unset, none fire. */
  fire?: FireTriggers;
  policy: ReachPolicy;
  sequences: ReadonlyMap<string, ReachSequence>;
  /** The live gate: off = the loop plans and holds, nothing leaves. */
  live: boolean;
  /** `{sender}` in the copy. */
  senderName: string;
  heldNiches: readonly string[];
  /** The desk's sites client for this context (journaled calls to the Mac). */
  sitesFor: (ctx: restate.Context) => SiteClient;
  notifier?: Notifier;
  clock?: () => Date;
  /** When Wren last posted on `platform` (content's channel): a post warms that site's accounts. */
  postedAt?: (platform: Platform) => Promise<string | null>;
  /**
   * DM drafts: the model and the `outbound-copy` SOP. No model, no drafts. Comments on others'
   * LinkedIn posts: the comments SOP (`commentGuide`) and his voice. `facts`: what is true about
   * the writer, the only first-person claims a draft may make; none, and it claims nothing.
   */
  drafts?: {
    llm: LlmClient | null;
    guide?: DmGuide;
    commentGuide?: DmGuide;
    voice?: string;
    facts?: () => Promise<readonly string[]>;
    /** What we've posted: what comments on others' posts draw on. */
    ours?: () => Promise<readonly OurPost[]>;
  };
  /** Runs per client (`ReachWatch/<client>/daily`): none, and a client's key stops. */
  clients?: ReachClients;
}

export interface ReachClients {
  /** A client's own database. */
  clientDb: (id: string) => Db;
  /** The model a client's drafts use on Wren's key, metered on its own `models` vendor. */
  llm: LlmClient | null;
  /** Clients' own keys: a client on its own Exa or model key runs on it. */
  keys?: KeyStore | null;
  /** A client's DM guide, from the SOPs in its own database. */
  dmGuide?: (db: Db, platform: DmPlatform) => Promise<string>;
  /** A client's facts for Reddit drafts: the SOPs in its own database. */
  facts?: (db: Db) => Promise<{ label: string; text: string }[]>;
}

/**
 * The deps for one client's pass: its own database, every read through its vendor gate (in
 * journaled steps), its model metered, no Discord lane and no content posts of Wren's.
 */
export function clientDeps(
  deps: ReachDeps,
  plan: Extract<ClientReach, { kind: "work" }>,
  part: ReachPart,
  now: Date,
  /** Its `models` gate said yes this pass (`gate` once: a model call costs no units). */
  model = false,
): ReachDeps {
  const { notifier: _n, postedAt: _p, drafts: _d, clients, ...rest } = deps;
  if (!clients) throw new Error("no client databases here");
  const db = clients.clientDb(plan.client.id);
  const scope = {
    main: deps.db,
    client: plan.client.id,
    part,
    now: () => now,
    store: clients.keys ?? null,
  };
  const dmGuide = clients.dmGuide;
  return {
    ...rest,
    db,
    sitesFor: (ctx) =>
      meteredSites(deps.sitesFor(ctx), { ...scope, step: (name, fn) => ctx.run(name, fn) }),
    ...(clients.llm && model
      ? {
          drafts: {
            llm: meteredModel(clients.llm, { ...scope, own: llmForKey }),
            ...(dmGuide ? { guide: (p: DmPlatform) => dmGuide(db, p) } : {}),
          },
        }
      : {}),
  };
}

/** Wake the watch so a touch's first check comes now, not after a cold sleep. */
export const wakeWatch = (ctx: restate.Context, client: string | null = null) =>
  ctx
    .objectSendClient<{ wake: (c: restate.ObjectContext) => Promise<unknown> }>(
      { name: "ReachWatch" },
      client ? clientKey(client, WATCH_KEY) : WATCH_KEY,
    )
    .wake();

export async function nowFor(ctx: restate.Context, clock?: () => Date): Promise<Date> {
  return clock ? clock() : new Date(await ctx.date.now());
}

/** One adapter per account row, over the desk's sites as that account. */
export function channelsFor(deps: ReachDeps, ctx: restate.Context) {
  const sites = deps.sitesFor(ctx);
  const made = new Map<string, OutreachChannel>();
  return (a: ReachAccount): OutreachChannel | null => {
    const hit = made.get(a.id);
    if (hit) return hit;
    const asAccount: SiteClient = {
      call: (site, method, path, input, acct) =>
        sites.call(site, method, path, input, acct ?? a.account),
      via: (site, method, path) => sites.via(site, method, path),
    };
    const ch =
      a.platform === "reddit"
        ? redditOutreach(asAccount, { account: a.account, handle: a.handle })
        : linkedinOutreach(asAccount, { account: a.account, startedOn: a.startedOn });
    made.set(a.id, ch);
    return ch;
  };
}

/**
 * A site's refusal (4xx, `isRefusal`) as the terminal error it is. `restateSites` hands it back
 * as a SiteCallError, which a handler would retry forever against the journaled answer.
 */
export function finalRefusal(err: unknown): unknown {
  return isRefusal(err) ? new restate.TerminalError(err.message, { errorCode: err.status }) : err;
}

/** What content's `SocialPushed/wren.reach` answers. */
export type ReachView = { pushed: string[]; watched: string[] };
