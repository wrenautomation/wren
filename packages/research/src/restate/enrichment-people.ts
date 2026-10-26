/** Enrichment handlers for people: profiles, teams and signals. */
import * as restate from "@restatedev/restate-sdk";
import { bucketOf } from "@wren/core/limits";
import { keyedSites } from "@wren/core/metered";
import { clientOfKey, exclusiveHandler } from "@wren/core/restate";
import { type Gate, gate, meter, modesOf } from "@wren/core/vendors";
import { z } from "zod";
import {
  countProfileUnit,
  emptyProfileStats,
  googleLeft,
  linkedinParkedUntil,
  PROFILES_COMMAND,
  type ProfileStats,
  profilesParkedUntil,
  profileUnit,
  profileWork,
} from "../enrichment/profiles.js";
import {
  countTeamUnit,
  emptyTeamStats,
  TEAM_COMMAND,
  type TeamStats,
  teamParkedUntil,
  teamRoom,
  teamUnit,
  teamWork,
} from "../enrichment/team.js";
import { keepingAnswers } from "../findings.js";
import { collectorsWithLimits, googleLimits, TEAM_LIMIT } from "../limits.js";
import { ACCOUNT_VENDOR, accountRoom, readLedger, SEARCH_VENDOR } from "../linkedin-reads.js";
import {
  type BaseDeps,
  COLLECTORS,
  clientLinkedin,
  countSignalUnit,
  emptySignalsStats,
  passOf,
  planStats,
  readAccount,
  SIGNALS_COMMAND,
  SIGNALS_COMPONENT,
  SIGNALS_HELD,
  type SignalsStats,
  signalPlan,
  signalSettings,
  signalSettingsOf,
  signalUnit,
} from "../signals/collectors.js";
import { clientBlock, type EnrichmentContext, HELD, UNIT_RETRY } from "./enrichment-context.js";
import { notHeld, stageHolds, UNITS_PER_RUN, unitBatches } from "./units.js";

/** The vendors a LinkedIn read spends: the account, or search. */
const LINKEDIN_VENDORS: ReadonlySet<string> = new Set([ACCOUNT_VENDOR, SEARCH_VENDOR]);

export interface ProfilesInput {
  /** People in the order they will be emailed; the due ones are looked up. */
  personIds: number[];
  /** People this call; each is a few site calls, so a pass stays well inside one Lambda. */
  limit?: number;
  /** The zone Google's day and hours are kept in. */
  timezone: string;
}

export interface TeamInput {
  /** Firms in the order they should be searched; the due ones are. */
  companyIds: number[];
  /** Firms this call; each is one metered search. */
  limit?: number;
}

const PROFILES = z.looseObject({
  personIds: z.array(z.number()).describe("People in send order; the due ones are looked up"),
  limit: z.number().nullish().describe("People this call"),
  timezone: z.string().describe("The zone Google's day and hours are kept in"),
});

export interface SignalsInput {
  /** People in send order; their firms follow. */
  personIds: number[];
  /** More firms to read. */
  companyIds?: number[];
  /** Subjects per collector this call. */
  limit?: number;
  /** The zone Google's day and hours are kept in. */
  timezone: string;
  /** Only this collector. */
  collector?: string;
}

const SIGNALS = z.looseObject({
  personIds: z.array(z.number()).describe("People in send order; their firms follow"),
  companyIds: z.array(z.number()).nullish().describe("More firms to read"),
  limit: z.number().nullish().describe("Subjects per collector this call"),
  timezone: z.string().describe("The zone Google's day and hours are kept in"),
  collector: z.string().nullish().describe("Only this collector"),
});

const TEAM = z.looseObject({
  companyIds: z.array(z.number()).describe("Firms in search order; the due ones are searched"),
  limit: z.number().nullish().describe("Firms this call"),
});

export function peopleHandlers(enrich: EnrichmentContext) {
  const { deps, youtubeFor, llmOf, scope, open, close, unit } = enrich;
  return {
    profiles: exclusiveHandler(
      { input: PROFILES },
      async (ctx: restate.ObjectContext, input: ProfilesInput): Promise<ProfileStats> => {
        // Exa is metered and its cache is main's: a client's people wait for compose (O2).
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("profiles run on Wren's niches only");
        if (!deps.sites) throw new restate.TerminalError("no site client for profiles");
        const { db, niche } = scope(ctx);
        const sites = keepingAnswers(deps.sites, db);
        const { personIds, ...rest } = input;
        const runId = await open(ctx, PROFILES_COMMAND, {
          ...rest,
          people: personIds.length,
          niche,
        });
        const now = new Date(await ctx.date.now());
        const plan = await ctx.run("select", async () => {
          const parked = await profilesParkedUntil(db);
          if (parked) return { parked: parked.toISOString(), work: [], google: 0, linkedin: null };
          const work = await profileWork(db, personIds, {
            limit: input.limit ?? 5,
            pages: deps.pages ?? null,
          });
          return {
            parked: null,
            work,
            google: await googleLeft(db, {
              now,
              timezone: input.timezone,
              perDay: (await googleLimits(deps.db)).perDay,
            }),
            linkedin: (await linkedinParkedUntil(db))?.toISOString() ?? null,
          };
        });
        const stats = emptyProfileStats();
        stats.selected = plan.work.length;
        if (plan.parked) stats.stopped = `parked by a cap until ${plan.parked}`;
        let left = plan.google;
        let linkedinUntil = plan.linkedin;
        const streak = { errors: 0 };
        const holds = await stageHolds(ctx, db, HELD.profiles);
        for (const w of plan.work) {
          const id = w.person.personId;
          if (holds.held.has(String(id))) continue;
          // profileUnit returns site errors as data: a metered read is never retried.
          const r = await unit(
            ctx,
            `profile person ${id}`,
            () =>
              profileUnit(db, sites, w, {
                googleLeft: left,
                linkedin: deps.linkedin ?? null,
                linkedinCappedUntil: linkedinUntil ? new Date(linkedinUntil) : null,
                ledger: readLedger(deps.db, { client: null, part: "profiles", runId }),
                runId,
              }),
            { holds, id },
          );
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          const recheck = deps.recheck;
          if (recheck)
            await ctx.run(`recheck firm ${w.company.companyId}`, async () => {
              await recheck(db, [w.company.companyId]);
            });
          left = r.value.googleStopped ? 0 : Math.max(0, left - r.value.google);
          linkedinUntil = r.value.linkedinCappedUntil ?? linkedinUntil;
          stats.stopped = countProfileUnit(stats, r.value, streak);
          if (stats.stopped) break;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    team: exclusiveHandler(
      { input: TEAM },
      async (ctx: restate.ObjectContext, input: TeamInput): Promise<TeamStats> => {
        // Metered, and the people land on main: Wren's niches only (O2).
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("team search runs on Wren's niches only");
        if (!deps.sites) throw new restate.TerminalError("no site client for team search");
        const { db, niche } = scope(ctx);
        const sites = keepingAnswers(deps.sites, db);
        const { companyIds, ...rest } = input;
        const runId = await open(ctx, TEAM_COMMAND, {
          ...rest,
          firms: companyIds.length,
          niche,
        });
        const plan = await ctx.run("select", async () => {
          const parked = await teamParkedUntil(db);
          if (parked) return { why: `parked by a cap until ${parked.toISOString()}`, work: [] };
          const { room, nextInMs } = await teamRoom(
            db,
            new Date(),
            await bucketOf(deps.db, null, TEAM_LIMIT),
          );
          if (room === 0)
            return {
              why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
              work: [],
            };
          const limit = Math.min(input.limit ?? 10, room);
          return { why: null, work: await teamWork(db, companyIds, { limit }) };
        });
        const stats = emptyTeamStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const streak = { errors: 0 };
        const holds = await stageHolds(ctx, db, HELD.team);
        for (const w of plan.work) {
          const id = w.companyId;
          if (holds.held.has(String(id))) continue;
          // teamUnit returns site errors as data: a metered search is never retried.
          const r = await unit(ctx, `team firm ${id}`, () => teamUnit(db, sites, w, { runId }), {
            holds,
            id,
          });
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          stats.stopped = countTeamUnit(stats, r.value, streak);
          if (stats.stopped) break;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    signals: exclusiveHandler(
      { input: SIGNALS },
      async (ctx: restate.ObjectContext, input: SignalsInput): Promise<SignalsStats> => {
        // A client's key reads its own block and writes its own database; its buckets and
        // Google's day count main's reads too. Metered collectors spend through the vendor
        // gate (designs/2026-10-07-setup-and-vendors.md): a client's needs a mode, room and cap.
        const own = await ctx.run("client", () => clientBlock(deps.db, ctx.key, SIGNALS_COMPONENT));
        const { db, niche } = scope(ctx);
        const also = own ? deps.db : null;
        const owner = own?.client ?? null;
        // LinkedIn on a client's pass: its own login, or Wren's on a managed share.
        const linkedinReads = own
          ? await ctx.run("linkedin", async () => {
              const m = (await modesOf(deps.db, own.client)).find((r) => r.vendor === "linkedin");
              if (!m) return null;
              return m.mode === "own" ? clientLinkedin(own.accounts) : readAccount(deps.linkedin);
            })
          : undefined;
        const { personIds, companyIds, ...rest } = input;
        const runId = await open(ctx, SIGNALS_COMMAND, {
          ...rest,
          people: personIds.length,
          niche,
        });
        const now = new Date(await ctx.date.now());
        const plan = await ctx.run("select", async () =>
          signalPlan(
            db,
            await collectorsWithLimits(deps.db, COLLECTORS),
            own ? signalSettingsOf(own.block) : await signalSettings(db),
            await passOf(db, niche, personIds, companyIds ?? []),
            {
              now,
              limit: input.limit ?? undefined,
              only: input.collector ?? null,
              also,
              // LinkedIn on a client's pass, search or account, needs its LinkedIn set up.
              // Search reads cost nothing and have no quota: set up is enough.
              gate: async (vendor, units): Promise<Gate> =>
                own && LINKEDIN_VENDORS.has(vendor) && !linkedinReads
                  ? { ok: false, why: "Needs setup", mode: null }
                  : own && vendor === SEARCH_VENDOR
                    ? { ok: true, mode: "managed", bucket: SEARCH_VENDOR, room: null }
                    : gate(deps.db, owner, vendor, units, now),
            },
          ),
        );
        const base: BaseDeps = {
          db,
          // A client's Exa reads (news) on its own key when it saved one, else Wren's ring.
          sites: deps.sites
            ? keepingAnswers(
                owner
                  ? keyedSites(deps.sites, {
                      main: deps.db,
                      client: owner,
                      part: "signals",
                      now: () => now,
                      store: deps.keys ?? null,
                      runId,
                    })
                  : deps.sites,
                db,
              )
            : null,
          desk: deps.desk ? keepingAnswers(deps.desk, db) : null,
          fetcher: deps.fetcher,
          pages: deps.pages ?? null,
          // A client's YouTube reads (talks) on its own key or Wren's, metered on its share.
          youtube:
            deps.youtube && owner
              ? youtubeFor(owner, deps.youtube, "signals.talks", runId)
              : (deps.youtube ?? null),
          llm: llmOf(ctx, "signals", runId),
          linkedin: own ? null : readAccount(deps.linkedin),
          ...(linkedinReads === undefined ? {} : { linkedinReads }),
          // The account's 20 a day across kinds, asked before each fallback read.
          linkedinRoom: () => accountRoom(deps.db, owner),
          also,
        };
        const google = await ctx.run("google limits", () => googleLimits(deps.db));
        const stats = emptySignalsStats();
        // A unit's hold subject is `<collector>:<subject>`.
        const holds = await stageHolds(ctx, db, SIGNALS_HELD);
        for (const p of plan) {
          const line = planStats(stats, p);
          const c = COLLECTORS.find((x) => x.name === p.name);
          if (!c) continue;
          const ids = notHeld(
            holds,
            p.subjects.map((s) => `${c.name}:${s}`),
          );
          // Free reads batch; a metered one is its own step, never bought twice.
          for await (const r of unitBatches(
            ctx,
            `signals ${c.name}`,
            ids,
            (id) =>
              signalUnit(c, id.slice(c.name.length + 1), p.settings, base, {
                timezone: input.timezone,
                runId,
                google,
                meter: async (vendors) => {
                  for (const vendor of vendors)
                    await meter(deps.db, {
                      client: owner,
                      vendor,
                      units: 1,
                      part: `signals.${c.name}`,
                      runId,
                    });
                },
              }),
            { retry: UNIT_RETRY, holds, perRun: c.metered ? 1 : UNITS_PER_RUN },
          )) {
            if (countSignalUnit(stats, line, r.ok ? r.value : r)) break;
          }
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
  };
}
