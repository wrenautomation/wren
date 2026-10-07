/**
 * `ContentPlanner/default`: once a day, at `hour` on the fleet's clock, reads
 * tomorrow's plan (slots vs drafts per platform) and says it on Discord. With
 * `draft: true` it first fills each open slot with a draft (O5): ideas in order
 * from `nextIdea` (undrafted ideas, the day's build log, a reader's question),
 * drafted by `ContentDesk` with the platform's playbook. A draft lands as
 * `draft` holding its slot; nothing is approved here, approving is publishing
 * and stays a person's click. Off until started;
 * `start {"platforms":["linkedin","reddit"],"draft":true}`.
 * Design: designs/2026-10-06-social-inbox.md (Daily drafts).
 *
 * `ContentPlanner/<client>/daily`: the same for a client with Content plan installed, on its own
 * logins' platforms, into its own database, drafted by `ContentDesk/<client>/desk` as the client.
 * Its block (`content.planner`) is the settings; its ideas are its own and its readers'
 * questions, never Wren's build log. Drafts wait in its To approve.
 */
import * as restate from "@restatedev/restate-sdk";
import { PLATFORMS, type Platform } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import {
  clientKey,
  clientOfKey,
  loopSettings,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { clientContent, clientPlan } from "../clients.js";
import type { Fetch } from "../ideas/build-log.js";
import {
  type DayPlan,
  formatPlan,
  nextIdea,
  openSlots,
  planFor,
  shortfallOf,
  tomorrowOf,
} from "../plan.js";
import { PLATFORM_SPECS } from "../platforms.js";
import { contentDrafts } from "../schema.js";
import { DEFAULT_SLOTS, type Slot, type Slots } from "../slots.js";
import { type ContentDesk, DESK_KEY, DESK_UNIT } from "./desk.js";

export const PLANNER_KEY = "default";
export const DEFAULT_PLAN_PLATFORMS: readonly Platform[] = ["linkedin", "reddit"];
const DEFAULT_HOUR = 17;
/** Ideas tried per pass: a run of ideas that all fail to draft stops here. */
const MAX_IDEAS = 6;

export interface ContentPlannerDeps {
  db: Db;
  /** The fleet's clock: slots and the daily hour read on it. */
  zone: string;
  /** Hour of day the plan goes out (default 17:00, time to review before tomorrow). */
  hour?: number;
  notifier?: Notifier;
  /** For the build log's GitHub read; tests pass a stand-in. */
  fetch?: Fetch;
  repos?: readonly string[];
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
}

export interface PlannerSettings {
  platforms?: Platform[];
  /** Fill tomorrow's open slots with drafts (default off: the plan is only said). */
  draft?: boolean;
  /** A platform's slots a day, replacing its defaults: `{"linkedin":[{"hour":8,"minute":30}]}`. */
  slots?: Partial<Record<Platform, Slot[]>>;
}

export interface Drafted {
  platform: Platform;
  draftId: string;
  /** ISO instant of the slot it holds. */
  slot: string;
  source: string;
}

export type PlannerStats = DayPlan & { drafted: Drafted[]; skipped: string[] };

/** The next `hour`:00 on `zone`'s clock strictly after `now`. */
export function nextRunAt(now: Date, zone: string, hour: number): Date {
  const w = wallClock(zone, now);
  const today = zonedInstant(zone, w.year, w.month, w.day, hour);
  if (today.getTime() > now.getTime()) return today;
  const t = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return zonedInstant(zone, t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), hour);
}

/** The defaults with the settings' platforms replaced; a malformed slot is dropped. */
export function slotsOf(custom: PlannerSettings["slots"]): Slots {
  const out: Record<Platform, readonly Slot[]> = { ...DEFAULT_SLOTS };
  for (const [p, list] of Object.entries(custom ?? {})) {
    if (!PLATFORMS.includes(p as Platform) || !Array.isArray(list)) continue;
    out[p as Platform] = list.filter(
      (s) =>
        Number.isInteger(s?.hour) &&
        s.hour >= 0 &&
        s.hour < 24 &&
        Number.isInteger(s.minute ?? 0) &&
        (s.minute ?? 0) >= 0 &&
        (s.minute ?? 0) < 60,
    );
  }
  return out;
}

/** "drafted 2 for tomorrow: LinkedIn, Reddit" or the shortfall when nothing was drafted. */
export function plannerTitle(plan: DayPlan, drafted: readonly Drafted[]): string {
  if (drafted.length > 0)
    return `content ${plan.day}: drafted ${drafted.length} for tomorrow: ${[...new Set(drafted.map((d) => PLATFORM_SPECS[d.platform].name))].join(", ")}`;
  const short = shortfallOf(plan);
  return short > 0
    ? `content ${plan.day}: ${short} empty slots`
    : `content ${plan.day}: every slot filled`;
}

export function makeContentPlanner(deps: ContentPlannerDeps) {
  const hour = deps.hour ?? DEFAULT_HOUR;
  return makeLoopObject("ContentPlanner", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const client = clientOfKey(ctx.key)?.client ?? null;
    let db = deps.db;
    let settings: PlannerSettings;
    let platforms: Platform[];
    if (client) {
      if (!deps.clientDb) return stoppedPass<PlannerStats>(ctx, now, "no client databases here");
      const plan = await ctx.run("client", async () => {
        const c = await clientContent(deps.db, client, "content.planner");
        if (c.kind === "gone") return c;
        const p = clientPlan(c.client);
        if (!p.ok) return { kind: "gone" as const, why: p.why };
        const wanted = p.settings.platforms ?? c.platforms;
        return {
          kind: "work" as const,
          platforms: c.platforms.filter((x) => wanted.includes(x)) as Platform[],
          draft: p.settings.draft,
        };
      });
      if (plan.kind === "gone") return stoppedPass<PlannerStats>(ctx, now, plan.why);
      db = deps.clientDb(client);
      settings = { draft: plan.draft };
      platforms = plan.platforms;
    } else {
      settings = (await loopSettings<PlannerSettings>(ctx)) ?? {};
      platforms = (settings.platforms ?? DEFAULT_PLAN_PLATFORMS).filter((p) =>
        PLATFORMS.includes(p),
      );
    }
    const slots = slotsOf(settings.slots);
    const day = tomorrowOf(now, deps.zone);
    const drafted: Drafted[] = [];
    const skipped: string[] = [];
    if (settings.draft) await fill();
    const plan = await ctx.run("plan", () => planFor(db, platforms, day, deps.zone, slots));
    const stats: PlannerStats = { ...plan, drafted, skipped };
    const notifier = client ? undefined : deps.notifier;
    if (notifier)
      await ctx.run("notify", () =>
        notifier.notify(
          plannerTitle(plan, drafted),
          [
            ...drafted.map(
              (d) =>
                `drafted ${d.platform} for ${clock(new Date(d.slot))} from ${d.source.replace("_", " ")}: ${d.draftId}`,
            ),
            ...skipped.map((s) => `skipped ${s}`),
            ...formatPlan(plan),
          ].join("\n"),
          "info",
        ),
      );
    const outcome: PassOutcome<PlannerStats> = {
      stats,
      error: null,
      failures: 0,
      delayMs: nextRunAt(now, deps.zone, hour).getTime() - now.getTime(),
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    return outcome;

    async function fill(): Promise<void> {
      const open = await ctx.run("open slots", async () => {
        const o = await openSlots(db, platforms, day, deps.zone, slots);
        return Object.fromEntries(
          Object.entries(o).map(([p, at]) => [p, at.map((d) => d.toISOString())]),
        ) as Partial<Record<Platform, string[]>>;
      });
      const short = () => platforms.filter((p) => (open[p]?.length ?? 0) > 0);
      const tried: string[] = [];
      const desk = ctx.objectClient<ContentDesk>(
        { name: "ContentDesk" },
        client ? clientKey(client, DESK_UNIT) : DESK_KEY,
      );
      for (let i = 0; i < MAX_IDEAS && short().length > 0; i++) {
        const next = await ctx.run(`idea ${i}`, () =>
          nextIdea(db, {
            now,
            day: day.day,
            exclude: tried,
            ...(client ? { buildLog: false } : {}),
            ...(deps.repos ? { repos: deps.repos } : {}),
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
          }),
        );
        for (const e of next.errors) skipped.push(`build log: ${e}`);
        if (!next.idea) break;
        const idea = next.idea;
        tried.push(idea.id);
        let report: Awaited<ReturnType<typeof desk.draft>>;
        try {
          report = await desk.draft({ ideaId: idea.id, platforms: short() });
        } catch (err) {
          // The desk said no for good (a client's About, its model gate): said, and no more ideas.
          if (!(err instanceof restate.TerminalError)) throw err;
          skipped.push(`drafting: ${err.message}`);
          break;
        }
        for (const r of report.results) {
          const slot = open[r.platform]?.[0];
          if (!r.ok || !slot) {
            if (!r.ok) skipped.push(`${r.platform} (${idea.source}): ${r.reason}`);
            continue;
          }
          open[r.platform]?.shift();
          await ctx.run(`hold ${r.draft.id}`, () =>
            db
              .update(contentDrafts)
              .set({ scheduledFor: new Date(slot) })
              .where(eq(contentDrafts.id, r.draft.id))
              .then(() => undefined),
          );
          drafted.push({ platform: r.platform, draftId: r.draft.id, slot, source: idea.source });
        }
      }
    }

    function clock(at: Date): string {
      const w = wallClock(deps.zone, at);
      return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
    }
  });
}

export type ContentPlanner = ReturnType<typeof makeContentPlanner>;
