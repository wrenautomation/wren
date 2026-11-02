/**
 * `ContentPlanner/default`: once a day, at `hour` on the fleet's clock, reads
 * tomorrow's plan (slots vs drafts per platform) and says it on Discord. With
 * `draft: true` it first fills each open slot with a draft (O5): ideas in order
 * from `nextIdea` (undrafted ideas, a reader's question, a video chapter),
 * drafted by `ContentDesk` with the platform's playbook. A draft lands as
 * `draft` holding its slot. With `approve: true` as well (Wren only, his call of 10-13: keep the
 * queues full) each draft is approved into the slot it holds; otherwise approving stays a
 * person's click. Off until started;
 * `start {"platforms":["linkedin","reddit"],"draft":true}`.
 * Design: designs/2026-10-06-social-inbox.md (Daily drafts).
 *
 * A draft waits at most `DRAFT_WAIT_MS` (designs/2026-10-16-loop-watchdog.md): past it the desk's
 * call runs on alone (it writes the draft) and the pass drafts no more, since the desk's one lock
 * is that call's. The next pass starts past it. An idea that times out three passes in a row is
 * held (`unit_holds`, stage `loop.content-planner/<key>`), and the next idea goes first.
 *
 * Campaigns (designs/2026-11-02-campaigns.md, phase 3): the pass fills slots per live campaign in
 * body order, then the default. A campaign takes only its own ideas, on the platforms it names an
 * account for, under its `<platform>.post` cap; its drafts post as that account.
 *
 * `ContentPlanner/<client>/daily`: the same for a client with Content plan installed, on its own
 * logins' platforms, into its own database, drafted by `ContentDesk/<client>/desk` as the client.
 * Its block (`content.planner`) is the settings; its ideas are its own and its readers'
 * questions, never Wren's video chapters. Drafts wait in its To approve.
 */
import * as restate from "@restatedev/restate-sdk";
import { PLATFORMS, type Platform } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import {
  CallTimeout,
  clientKey,
  clientOfKey,
  loopSettings,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
  unitLimits,
} from "@wren/core/restate";
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Db } from "@wren/db";
import { capLeft, type LoopCampaign } from "@wren/starling-core/campaigns";
import { pickAccount, ReachRefusal } from "@wren/starling-outbound";
import { eq } from "drizzle-orm";
import { clientContent, clientPlan } from "../clients.js";
import {
  campaignSlots,
  type DayPlan,
  formatPlan,
  nextIdea,
  openSlots,
  planFor,
  shortfallOf,
  tomorrowOf,
} from "../plan.js";
import { PLATFORM_SPECS } from "../platforms.js";
import { approveDrafts } from "../review.js";
import { contentDrafts } from "../schema.js";
import { type Slot, slotsOf } from "../slots.js";
import { type ContentDesk, DESK_KEY, DESK_UNIT } from "./desk.js";

export const PLANNER_KEY = "default";
export const DEFAULT_PLAN_PLATFORMS: readonly Platform[] = ["linkedin", "reddit"];
const DEFAULT_HOUR = 17;
/** Ideas tried per sweep (a campaign, or the default): a run that all fail to draft stops here. */
const MAX_IDEAS = 6;
/** The longest a pass waits on one idea's drafts: a model call per platform, a minute or two each. */
const DRAFT_WAIT_MS = 15 * 60_000;

interface ContentPlannerDeps {
  db: Db;
  /** The fleet's clock: slots and the daily hour read on it. */
  zone: string;
  /** Hour of day the plan goes out (default 17:00, time to review before tomorrow). */
  hour?: number;
  notifier?: Notifier;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
  /** Slots under every key's own, replacing the platforms' defaults (tests: any weekday). */
  slots?: Partial<Record<Platform, Slot[]>>;
  /** How long a pass waits on one idea's drafts (default `DRAFT_WAIT_MS`); tests shorten it. */
  draftWaitMs?: number;
  /** The live metro campaigns of a database (`liveCampaignsOf`); absent, the default alone. */
  liveCampaigns?: (db: Db, now: Date) => Promise<readonly LoopCampaign[]>;
}

export interface PlannerSettings {
  platforms?: Platform[];
  /** Fill tomorrow's open slots with drafts (default off: the plan is only said). */
  draft?: boolean;
  /** Approve each draft into its slot as it is made (default off: approving is his). */
  approve?: boolean;
  /** A platform's slots a day, replacing its defaults: `{"linkedin":[{"hour":8,"minute":30}]}`. */
  slots?: Partial<Record<Platform, Slot[]>>;
}

export interface Drafted {
  platform: Platform;
  draftId: string;
  /** ISO instant of the slot it holds. */
  slot: string;
  source: string;
  /** The metro campaign it was drafted for; absent = the default. */
  campaign?: string;
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
    const slots = slotsOf({ ...deps.slots, ...settings.slots });
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
                `drafted ${d.platform} for ${clock(new Date(d.slot))} from ${d.source.replace("_", " ")}${d.campaign ? ` (${d.campaign})` : ""}: ${d.draftId}`,
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
      const live = deps.liveCampaigns
        ? await ctx.run(
            "campaigns",
            async () =>
              // Only what the pass reads crosses the journal.
              (await deps.liveCampaigns?.(db, now))?.map(({ id, accounts, caps }) => ({
                id,
                accounts,
                caps,
              })) ?? [],
          )
        : [];
      const used = live.length ? await ctx.run("campaign slots", () => campaignSlots(db, day)) : {};
      const sweeps = [...live, null];
      const tried: string[] = [];
      const limits = await unitLimits(ctx, deps.db, "ContentPlanner");
      const desk = ctx.objectClient<ContentDesk>(
        { name: "ContentDesk" },
        client ? clientKey(client, DESK_UNIT) : DESK_KEY,
      );
      let i = 0;
      for (const c of sweeps) {
        // Slots this sweep may still take: a campaign only where it names an account, under its cap.
        const room = (p: Platform): number => {
          const free = open[p]?.length ?? 0;
          if (!c) return free;
          return c.accounts[p] ? capLeft(free, c.caps[`${p}.post`], used[c.id]?.[p] ?? 0) : 0;
        };
        const short = () => platforms.filter((p) => room(p) > 0);
        let tries = 0;
        while (tries < MAX_IDEAS && short().length > 0) {
          const next = await ctx.run(`idea ${i++}`, () =>
            nextIdea(db, {
              now,
              exclude: tried,
              ...(client ? { client: true } : {}),
              ...(c ? { campaign: c.id } : {}),
            }),
          );
          if (!next.idea) break;
          const idea = next.idea;
          tried.push(idea.id);
          const unit = `idea ${idea.id}`;
          // Held after timing out pass after pass: the next idea instead, not counted as a try.
          if (limits.skip(unit)) continue;
          tries++;
          let report: Awaited<ReturnType<typeof desk.draft>>;
          try {
            report = await limits.within(
              unit,
              desk.draft({ ideaId: idea.id, platforms: short() }),
              // A draft past its wait still lands as a row: left running, never asked twice.
              { ms: deps.draftWaitMs ?? DRAFT_WAIT_MS, call: "ContentDesk/draft", keep: true },
            );
          } catch (err) {
            // Still running on the desk's lock: the next idea would wait behind it.
            if (err instanceof CallTimeout) {
              skipped.push(`drafting ${idea.source} ${idea.id}: ${err.message}`);
              return;
            }
            // The desk said no for good (a client's About, its model gate): said, and no more ideas.
            if (!(err instanceof restate.TerminalError)) throw err;
            skipped.push(`drafting: ${err.message}`);
            return;
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
            drafted.push({
              platform: r.platform,
              draftId: r.draft.id,
              slot,
              source: idea.source,
              ...(c ? { campaign: c.id } : {}),
            });
            if (c) {
              used[c.id] = { ...used[c.id], [r.platform]: (used[c.id]?.[r.platform] ?? 0) + 1 };
              // A client's drafts post as its own login: no pick.
              const account = c.accounts[r.platform];
              const unpicked =
                client || !account
                  ? null
                  : await ctx.run(`account ${r.draft.id}`, () =>
                      pickAccount(db, {
                        item: `draft:${r.draft.id}`,
                        account,
                        by: "ContentPlanner",
                      }).then(
                        () => null,
                        (err: unknown) => {
                          if (err instanceof ReachRefusal) return err.message;
                          throw err;
                        },
                      ),
                    );
              if (unpicked) skipped.push(`account for ${r.platform} ${r.draft.id}: ${unpicked}`);
            }
            if (!settings.approve) continue;
            const refused = await ctx.run(`approve ${r.draft.id}`, () =>
              approveDrafts(db, [r.draft.id], {
                now,
                at: new Date(slot),
                by: "ContentPlanner",
              }).then(
                () => null,
                (err: unknown) => (err instanceof Error ? err.message : String(err)),
              ),
            );
            if (refused) skipped.push(`approving ${r.platform} ${r.draft.id}: ${refused}`);
          }
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
