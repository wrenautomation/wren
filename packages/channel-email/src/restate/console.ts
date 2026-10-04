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
import { type Db, type Queryable, setAuditActor } from "@wren/db";
import { sql } from "drizzle-orm";
import { pause, resolveTarget, resume } from "../inbox/health.js";
import { openInvites } from "../inbox/invite.js";
import {
  type CampaignChange,
  campaignPolicy,
  setCampaignControl,
} from "../send/campaign-controls.js";
import type { SendPolicy } from "../send/policy.js";
import { DISPOSITION_KEY, type Disposition } from "./disposition.js";

export interface EmailConsoleDeps {
  db: Db;
  /** The roster's addresses: what a pause or resume may name. */
  senders: readonly string[];
  /** The env policy: what a campaign falls back to when the console clears an override. */
  policy: SendPolicy;
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
export function emailConsoleApi({ db, senders, policy }: EmailConsoleDeps) {
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

  return {
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

export function makeEmailConsole(deps: EmailConsoleDeps) {
  const api = emailConsoleApi(deps);
  const disposition = (ctx: restate.Context) =>
    ctx.objectClient<Disposition>({ name: "Disposition" }, DISPOSITION_KEY);
  return restate.service({
    name: "EmailConsole",
    handlers: {
      answers: (_: restate.Context, req: PortalRequest) => answer(() => api.answers(req)),
      approve: (ctx: restate.Context, req: InviteRequest) =>
        answer(async () => {
          const outcome = await disposition(ctx).approve(api.approval(req));
          if (!outcome.ok) throw new PortalRefusal(outcome.reason, 409);
          return outcome;
        }),
      drop: (ctx: restate.Context, req: InviteRequest) =>
        answer(() => disposition(ctx).drop(api.dropping(req))),
      pause: (ctx: restate.Context, req: SenderRequest) =>
        answer(async () => api.pause(req, new Date(await ctx.date.now()))),
      resume: (ctx: restate.Context, req: SenderRequest) =>
        answer(async () => api.resume(req, new Date(await ctx.date.now()))),
      setCampaign: (_: restate.Context, req: CampaignRequest) => answer(() => api.setCampaign(req)),
      killSwitchOn: (_: restate.Context, req: CampaignsRequest) =>
        answer(() => api.campaignAction("killSwitchOn", req)),
      killSwitchOff: (_: restate.Context, req: CampaignsRequest) =>
        answer(() => api.campaignAction("killSwitchOff", req)),
      stopOpeners: (_: restate.Context, req: CampaignsRequest) =>
        answer(() => api.campaignAction("stopOpeners", req)),
      resumeOpeners: (_: restate.Context, req: CampaignsRequest) =>
        answer(() => api.campaignAction("resumeOpeners", req)),
    },
  });
}
