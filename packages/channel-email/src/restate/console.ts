/**
 * EmailConsole: Wren's team answers warm replies, pauses inboxes and sets campaigns from the
 * console, with the same acts as `wren email answers` and `wren email senders pause|resume`.
 * A campaign's kill switch and opener cap live in `campaign_controls`, read every tick, so a
 * change goes live with no deploy. Approve and drop go
 * to `Disposition/fleet`, so only its journaled steps book or send. Every handler refuses whoever
 * `seesInternal` rejects; the Worker also keeps the writes off the demo (`console-routes.ts`).
 */
import * as restate from "@restatedev/restate-sdk";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  type SignedViewer,
  seesInternal,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, type Queryable, setAuditActor } from "@wren/db";
import { parseSettings, settingsSchema } from "@wren/experiments";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  approveCandidate,
  type LlmFor,
  rejectCandidate,
  seedExperiment,
} from "../evolve/candidates.js";
import { moveExperiment, startExperiment, switchSetting } from "../evolve/experiments.js";
import { pause, resolveTarget, resume } from "../inbox/health.js";
import { openInvites } from "../inbox/invite.js";
import {
  type CampaignChange,
  campaignPolicy,
  setCampaignControl,
} from "../send/campaign-controls.js";
import type { SendPolicy } from "../send/policy.js";
import type { Campaign } from "./compose-scheduler.js";
import { DISPOSITION_KEY, type Disposition } from "./disposition.js";
import type { QueueRefresh } from "./queue-refresh.js";

export interface EmailConsoleDeps {
  db: Db;
  /** The roster's addresses: what a pause or resume may name. */
  senders: readonly string[];
  /** The env policy: what a campaign falls back to when the console clears an override. */
  policy: SendPolicy;
  /** Each niche's campaign: the template files an experiment may start from. */
  campaigns?: ReadonlyMap<string, Campaign>;
  /** The models `llm_seed` writes with. */
  llmFor?: LlmFor;
}
export interface InviteRequest extends PortalRequest {
  id: number;
  /** Approve only: the reply as edited; absent, the draft goes as written. */
  body?: string | null;
}
export interface SenderRequest extends PortalRequest {
  /** An inbox address, or a bare domain for every inbox on it. */
  target: string;
  /** Pause only: why, stored on the pause. */
  reason?: string;
}

export interface CampaignRequest extends PortalRequest {
  campaign: string;
  /** null = back to the env default. */
  killSwitch?: boolean | null;
  /** 0 = follow-ups only; null = back to the env default. */
  openersPerDay?: number | null;
}
/** A record action on campaigns: their ids, as `email.campaign` keys them. */
export interface CampaignsRequest extends PortalRequest {
  ids: string[];
}
type Done = { done: string[]; skipped: string[] };
/** A record action on experiments or candidates, by their numeric ids. */
export interface IdsRequest extends PortalRequest {
  ids: (string | number)[];
}
export interface CandidatesRequest extends IdsRequest {
  /** Approve only: William's words in place of the model's. */
  text?: string | null;
}
export interface SettingsRequest extends IdsRequest {
  /** Only the settings to change; `guards.negativeRatio` sits under `guards`. */
  settings: Record<string, unknown>;
}
export interface StartRequest extends PortalRequest {
  niche: string;
  template: string;
  selection?: string | null;
  fitness?: string | null;
  seeding?: string | null;
  /** from_winners: the experiment whose winners to take. */
  from?: number | null;
}
export type ExperimentMove = "pause" | "resume" | "stop";
/** Settings whose value is an object of settings: changed one leaf at a time. */
const NESTED = new Set(["weights", "guards", "models"]);
/** What a campaign action sets, or null when the campaign is already there (skipped). */
type Step = (now: SendPolicy, env: SendPolicy, campaign: string) => CampaignChange | null;

/**
 * The four record actions, each the other's undo. Values equal to env are stored as null, so
 * undo restores the previous value, except an opener cap set by `setCampaign` to a number,
 * which "Resume openers" clears back to env.
 */
const CAMPAIGN_STEPS = {
  killSwitchOn: (now, _, campaign) =>
    now.killSwitchOn(campaign) ? null : { campaign, killSwitch: true },
  killSwitchOff: (now, _, campaign) =>
    now.killSwitchOn(campaign) ? { campaign, killSwitch: false } : null,
  stopOpeners: (now, _, campaign) =>
    now.nicheOpenerCap(campaign) === 0 ? null : { campaign, openersPerDay: 0 },
  // Clearing can't open a campaign env holds at 0; that one is skipped.
  resumeOpeners: (now, env, campaign) =>
    now.nicheOpenerCap(campaign) !== 0 || env.nicheOpenerCap(campaign) === 0
      ? null
      : { campaign, openersPerDay: null },
} satisfies Record<string, Step>;
export type CampaignAction = keyof typeof CAMPAIGN_STEPS;

const textOf = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The handlers as plain functions: the service wraps them, tests call them. */
export function emailConsoleApi({
  db,
  senders,
  policy,
  campaigns: files,
  llmFor,
}: EmailConsoleDeps) {
  /** Wren's team only; their email is who acted. */
  const team = (req: PortalRequest): string => {
    if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
    return (req.viewer as SignedViewer).email;
  };
  const idOf = (req: InviteRequest): number => {
    if (!Number.isSafeInteger(req.id) || req.id <= 0) throw new PortalRefusal("no such reply", 404);
    return req.id;
  };
  const targetOf = (req: SenderRequest, known: readonly string[]): string => {
    const target = textOf(req.target);
    if (!target || !resolveTarget(target, known).length)
      throw new PortalRefusal("no inbox on the roster matches that", 404);
    return target;
  };
  /** One transaction, every row it changes logged as this person's (audit_events.actor). */
  const asThem = <T>(who: string, change: (tx: Queryable) => Promise<T>) =>
    db.transaction(async (tx) => {
      await setAuditActor(tx, who);
      return change(tx);
    });

  /** The campaigns `email_campaign_records` lists: what a campaign control may name. */
  const campaigns = async (tx: Queryable): Promise<Set<string>> =>
    new Set(
      (await tx.execute<{ id: string }>(sql`select id from email_campaign_records`)).map((r) =>
        String(r.id),
      ),
    );

  const idsOf = (req: IdsRequest): number[] => {
    const ids = Array.isArray(req.ids) ? req.ids.map(Number) : [];
    if (!ids.length || ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
      throw new PortalRefusal("say which: ids", 400);
    return [...new Set(ids)];
  };
  /**
   * Each id through `step`. One that throws is skipped; when none worked, the first reason is
   * the refusal, so a lone approve says why ("edit refused: ...").
   */
  const each = async (ids: number[], step: (id: number) => Promise<unknown>): Promise<Done> => {
    const out: Done = { done: [], skipped: [] };
    let why: string | null = null;
    for (const id of ids) {
      try {
        await step(id);
        out.done.push(String(id));
      } catch (err) {
        why ??= err instanceof Error ? err.message : String(err);
        out.skipped.push(String(id));
      }
    }
    if (!out.done.length && why) throw new PortalRefusal(why, 409);
    return out;
  };

  return {
    /** Approve or reject copy candidates; an approve with `text` goes live in William's words. */
    async decideCandidates(move: "approve" | "reject", req: CandidatesRequest): Promise<Done> {
      const who = team(req);
      const ids = idsOf(req);
      const by = `console:${who}`;
      const text = textOf(req.text);
      if (move === "approve" && text !== null && ids.length > 1)
        throw new PortalRefusal("edit one candidate at a time", 400);
      return each(ids, (id) =>
        move === "reject"
          ? rejectCandidate(db, id, { by })
          : approveCandidate(db, id, { by, ...(text !== null ? { text } : {}) }),
      );
    },
    /** One template of one campaign as a new experiment, seeded as `seeding` says. */
    async startExperiment(req: StartRequest) {
      team(req);
      const niche = textOf(req.niche);
      const name = textOf(req.template);
      const file = niche && name ? files?.get(niche)?.templates.get(name) : undefined;
      if (!niche || !file) throw new PortalRefusal("that campaign has no such template", 404);
      const picked = Object.fromEntries(
        (["selection", "fitness", "seeding"] as const).flatMap((k) => {
          const v = textOf(req[k]);
          return v ? [[k, v]] : [];
        }),
      );
      const check = settingsSchema.safeParse(picked);
      if (!check.success)
        throw new PortalRefusal(
          check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          400,
        );
      const settings = parseSettings(picked);
      const from = req.from ?? undefined;
      if (settings.seeding === "from_winners" && from === undefined)
        throw new PortalRefusal("from_winners needs the experiment to take winners from", 400);
      if (settings.seeding === "llm_seed" && !llmFor)
        throw new PortalRefusal("no model to seed with here", 409);
      let exp: Awaited<ReturnType<typeof startExperiment>>;
      try {
        exp = await startExperiment(db, { niche, file, settings });
      } catch (err) {
        throw new PortalRefusal(err instanceof Error ? err.message : String(err), 409);
      }
      const seeded =
        settings.seeding === "from_template"
          ? { queued: 0, imported: 0, skipped: 0 }
          : await seedExperiment(db, exp.id, {
              ...(llmFor ? { llmFor } : {}),
              ...(from !== undefined ? { from } : {}),
            });
      return { id: exp.id, version: exp.liveVersion, ...seeded };
    },
    async moveExperiments(move: ExperimentMove, req: IdsRequest): Promise<Done> {
      team(req);
      return each(idsOf(req), (id) => moveExperiment(db, id, move));
    },
    /** Each setting given, checked against the schema first, then journaled one by one. */
    async switchExperiments(req: SettingsRequest): Promise<Done> {
      team(req);
      const ids = idsOf(req);
      const given = req.settings && typeof req.settings === "object" ? req.settings : {};
      const changes = Object.entries(given).flatMap(([k, v]): [string, unknown][] =>
        NESTED.has(k) && v && typeof v === "object"
          ? Object.entries(v as Record<string, unknown>).map(([leaf, x]) => [`${k}.${leaf}`, x])
          : [[k, v]],
      );
      if (!changes.length) throw new PortalRefusal("say which settings to change", 400);
      // Checked only: parsing fills defaults, and a default must never be switched in.
      const check = settingsSchema.partial().safeParse(given);
      if (!check.success)
        throw new PortalRefusal(
          check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          400,
        );
      return each(ids, async (id) => {
        for (const [key, value] of changes) await switchSetting(db, id, key, value);
      });
    },
    /** Warm replies waiting on William: who, their words, the proposed time and zone, the draft. */
    answers: async (req: PortalRequest) => {
      team(req);
      return openInvites(db);
    },
    /** What approve hands Disposition; refused before any call. */
    approval: (req: InviteRequest) => {
      team(req);
      return { id: idOf(req), body: textOf(req.body) };
    },
    dropping: (req: InviteRequest) => {
      team(req);
      return { id: idOf(req) };
    },
    async pause(req: SenderRequest, now: Date): Promise<{ paused: string[] }> {
      const who = team(req);
      const target = targetOf(req, senders);
      const reason = textOf(req.reason);
      if (!reason) throw new PortalRefusal("say why", 400);
      const rows = await asThem(who, (tx) =>
        pause(tx, { target, reason, by: `console:${who}`, now, senders }),
      );
      return { paused: rows.map((r) => r.sender) };
    },
    async resume(req: SenderRequest, now: Date): Promise<{ resumed: string[] }> {
      const who = team(req);
      const target = textOf(req.target);
      if (!target) throw new PortalRefusal("no inbox on the roster matches that", 404);
      const rows = await asThem(who, (tx) =>
        resume(tx, { target, by: `console:${who}`, now, senders }),
      );
      return { resumed: rows.map((r) => r.sender) };
    },
    /** One campaign's kill switch and opener cap; a field left out stays, null goes back to env. */
    async setCampaign(req: CampaignRequest) {
      const who = team(req);
      const campaign = textOf(req.campaign);
      const { killSwitch, openersPerDay } = req;
      if (killSwitch !== undefined && killSwitch !== null && typeof killSwitch !== "boolean")
        throw new PortalRefusal("killSwitch is true, false or null", 400);
      if (
        openersPerDay !== undefined &&
        openersPerDay !== null &&
        !(Number.isSafeInteger(openersPerDay) && openersPerDay >= 0)
      )
        throw new PortalRefusal("openersPerDay is a whole number from 0, or null", 400);
      if (killSwitch === undefined && openersPerDay === undefined)
        throw new PortalRefusal("say killSwitch or openersPerDay", 400);
      return asThem(who, async (tx) => {
        if (!campaign || !(await campaigns(tx)).has(campaign))
          throw new PortalRefusal("no such campaign", 404);
        return setCampaignControl(
          tx,
          policy,
          { campaign, killSwitch, openersPerDay },
          `console:${who}`,
        );
      });
    },
    /** A record action on `{ids}`: `done` are the campaigns it changed, the rest `skipped`. */
    async campaignAction(action: CampaignAction, req: CampaignsRequest): Promise<Done> {
      const who = team(req);
      const ids = Array.isArray(req.ids) ? req.ids.map(textOf) : [];
      if (!ids.length || ids.length > 100 || ids.some((id) => id === null))
        throw new PortalRefusal("say which campaigns: ids", 400);
      return asThem(who, async (tx) => {
        const known = await campaigns(tx);
        const now = await campaignPolicy(tx, policy);
        const answer: Done = { done: [], skipped: [] };
        for (const id of new Set(ids as string[])) {
          const change = known.has(id) ? CAMPAIGN_STEPS[action](now, policy, id) : null;
          if (change) await setCampaignControl(tx, policy, change, `console:${who}`);
          answer[change ? "done" : "skipped"].push(id);
        }
        return answer;
      });
    },
  };
}

const INVITE = z.looseObject({
  ...PORTAL_FIELDS,
  id: z.number().describe("The invite's id, as the reply record shows it"),
});
const BODY = z.string().nullish().describe("The reply as edited; empty sends the draft as written");
const SENDER = z.looseObject({
  ...PORTAL_FIELDS,
  target: z.string().describe("An inbox address, or a bare domain for every inbox on it"),
});
const CAMPAIGNS = z.looseObject({ ...PORTAL_FIELDS, ids: z.array(z.string()) });
const IDS = z.looseObject({
  ...PORTAL_FIELDS,
  ids: z.array(z.union([z.string(), z.number()])).describe("Their ids, as the record shows them"),
});

export function makeEmailConsole(deps: EmailConsoleDeps) {
  const api = emailConsoleApi(deps);
  const disposition = (ctx: restate.Context) =>
    ctx.objectClient<Disposition>({ name: "Disposition" }, DISPOSITION_KEY);
  return restate.service({
    name: "EmailConsole",
    handlers: {
      answers: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.answers(req)),
      ),
      approve: serviceHandler(
        { input: INVITE.extend({ body: BODY }), effect: "sends" },
        (ctx: restate.Context, req: InviteRequest) =>
          answer(async () => {
            const outcome = await disposition(ctx).approve(api.approval(req));
            if (!outcome.ok) throw new PortalRefusal(outcome.reason, 409);
            return outcome;
          }),
      ),
      drop: serviceHandler({ input: INVITE }, (ctx: restate.Context, req: InviteRequest) =>
        answer(() => disposition(ctx).drop(api.dropping(req))),
      ),
      pause: serviceHandler(
        {
          input: SENDER.extend({
            reason: z.string().optional().describe("Why; kept on the pause"),
          }),
        },
        (ctx: restate.Context, req: SenderRequest) =>
          answer(async () => api.pause(req, new Date(await ctx.date.now()))),
      ),
      resume: serviceHandler({ input: SENDER }, (ctx: restate.Context, req: SenderRequest) =>
        answer(async () => api.resume(req, new Date(await ctx.date.now()))),
      ),
      setCampaign: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            campaign: z.string(),
            killSwitch: z
              .boolean()
              .nullish()
              .describe("On stops its sends; empty = the env default"),
            openersPerDay: z
              .number()
              .nullish()
              .describe("0 = follow-ups only; empty = the env default"),
          }),
        },
        (_: restate.Context, req: CampaignRequest) => answer(() => api.setCampaign(req)),
      ),
      killSwitchOn: serviceHandler(
        { input: CAMPAIGNS },
        (_: restate.Context, req: CampaignsRequest) =>
          answer(() => api.campaignAction("killSwitchOn", req)),
      ),
      killSwitchOff: serviceHandler(
        { input: CAMPAIGNS },
        (_: restate.Context, req: CampaignsRequest) =>
          answer(() => api.campaignAction("killSwitchOff", req)),
      ),
      stopOpeners: serviceHandler(
        { input: CAMPAIGNS },
        (_: restate.Context, req: CampaignsRequest) =>
          answer(() => api.campaignAction("stopOpeners", req)),
      ),
      startExperiment: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            niche: z.string().describe("The campaign: recruiting"),
            template: z.string().describe("Its template: book-first/opener"),
            selection: z.string().nullish(),
            fitness: z.string().nullish(),
            seeding: z.string().nullish(),
            from: z
              .number()
              .nullish()
              .describe("from_winners: the experiment to take winners from"),
          }),
        },
        (ctx: restate.Context, req: StartRequest) =>
          answer(async () => {
            const started = await api.startExperiment(req);
            if (started.imported > 0)
              ctx.serviceSendClient<QueueRefresh>({ name: "QueueRefresh" }).all();
            return started;
          }),
      ),
      approveCandidate: serviceHandler(
        {
          input: IDS.extend({
            text: z.string().nullish().describe("Your words in place of the model's; one id only"),
          }),
        },
        (ctx: restate.Context, req: CandidatesRequest) =>
          answer(async () => {
            const done = await api.decideCandidates("approve", req);
            // The new copy reaches the queue now, not at tomorrow's refresh.
            ctx.serviceSendClient<QueueRefresh>({ name: "QueueRefresh" }).all();
            return done;
          }),
      ),
      rejectCandidate: serviceHandler({ input: IDS }, (_: restate.Context, req: IdsRequest) =>
        answer(() => api.decideCandidates("reject", req)),
      ),
      pauseExperiment: serviceHandler({ input: IDS }, (_: restate.Context, req: IdsRequest) =>
        answer(() => api.moveExperiments("pause", req)),
      ),
      resumeExperiment: serviceHandler({ input: IDS }, (_: restate.Context, req: IdsRequest) =>
        answer(() => api.moveExperiments("resume", req)),
      ),
      stopExperiment: serviceHandler({ input: IDS }, (_: restate.Context, req: IdsRequest) =>
        answer(() => api.moveExperiments("stop", req)),
      ),
      switchExperiment: serviceHandler(
        {
          input: IDS.extend({
            // A record, not the settings schema: parsing that would fill in every default.
            settings: z.record(z.string(), z.unknown()).describe("Only the settings to change"),
          }),
        },
        (_: restate.Context, req: SettingsRequest) => answer(() => api.switchExperiments(req)),
      ),
      resumeOpeners: serviceHandler(
        { input: CAMPAIGNS },
        (_: restate.Context, req: CampaignsRequest) =>
          answer(() => api.campaignAction("resumeOpeners", req)),
      ),
    },
  });
}
