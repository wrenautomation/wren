/**
 * EmailConsole: Wren's team answers warm replies, pauses inboxes and sets campaigns from the
 * console, with the same acts as `wren email answers` and `wren email senders pause|resume`.
 * A campaign's kill switch and opener cap live in `campaign_controls`, read every tick, so a
 * change goes live with no deploy. Approve and drop go
 * to `Disposition/fleet`, so only its journaled steps book or send. Every handler refuses whoever
 * `seesInternal` rejects; the Worker also keeps the writes off the demo (`console-routes.ts`).
 * The `records*` reads are a client's lead sheet (O1): its firms and stalls, from its own
 * database, for anyone who may open that client, once `research.lead_sheet` is installed.
 * With `client` set, Wren's team works that client's sequences instead (O2/O3): its campaigns'
 * kill switch and opener cap (`email.sequences`), its answers (`email.replies`, approve and
 * drop through `Disposition/<client>/replies`).
 */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import type { MeetingOutcome } from "@wren/core/calls";
import type { Client } from "@wren/core/clients";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  type SignedViewer,
  seesInternal,
} from "@wren/core/portal";
import { metaOf } from "@wren/core/records";
import {
  type ExportAsk,
  type Fence,
  fenceFor,
  type GetAsk,
  type ListAsk,
  meOf,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { clientKey, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, type Queryable, serializable, setAuditActor, snapshot } from "@wren/db";
import { parseSettings, settingsSchema } from "@wren/experiments";
import { DOSSIER, LEAD_SHEET } from "@wren/research/components";
import { dossierBrief, dossiers } from "@wren/research/dossier";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CallBriefs } from "../calls/restate.js";
import { markOutcome } from "../calls/restate.js";
import { CALL_OUTCOME } from "../calls/settings.js";
import { EMAIL_CONSOLE_APPS, EMAIL_CONSOLE_ROUTES } from "../console-routes.js";
import {
  approveCandidate,
  type LlmFor,
  rejectCandidate,
  seedExperiment,
} from "../evolve/candidates.js";
import { moveExperiment, startExperiment, switchSetting } from "../evolve/experiments.js";
import { pause, resolveTarget, resume } from "../inbox/health.js";
import { openInvites } from "../inbox/invite.js";
import { liveEmails } from "../outreach/live.js";
import { callRecord, firmRecord, stallRecord } from "../records.js";
import {
  type CampaignChange,
  campaignPolicy,
  setCampaignControl,
} from "../send/campaign-controls.js";
import type { SendPolicy } from "../send/policy.js";
import { sendPolicyFor } from "../sequences.js";
import { REPLIES, SEQUENCES, sequencesSettingsSchema } from "../sequences-settings.js";
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
  /** Main's client registry and each client's database: the lead sheet reads. Absent, they refuse. */
  clients?: { main: Db; open: (client: Pick<Client, "database">) => Db } | null;
}

/** What a client's Pipeline app reads, with `research.lead_sheet`. */
const SHEET_RECORDS = [firmRecord, stallRecord];
/** What a client's Calls app reads, with `calls.outcome`. */
const CALL_RECORDS = [callRecord];
/** The record types a client's products open. */
const recordsFor = (products: Readonly<Record<string, unknown>>) => [
  ...(LEAD_SHEET in products ? SHEET_RECORDS : []),
  ...(CALL_OUTCOME in products ? CALL_RECORDS : []),
];
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
/** A call action: the calls, and Not yet's reason. */
export interface CallsRequest extends IdsRequest {
  reason?: string | null;
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
  clients,
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
  const asThem = <T>(who: string, change: (tx: Queryable) => Promise<T>, on: Db = db) =>
    serializable(on, async (tx) => {
      await setAuditActor(tx, who);
      return change(tx);
    });

  /**
   * The database of a client this viewer may open, and the record types its products open:
   * the lead sheet's, the Calls app's. None installed refuses.
   */
  const sheetOf = async (
    req: PortalRequest,
  ): Promise<{ db: Db; fence: Fence | undefined; types: typeof SHEET_RECORDS }> => {
    if (!clients) throw new PortalRefusal("not found", 404);
    const client = await pickClient(clients.main, req);
    const types = recordsFor(client.products ?? {});
    if (!types.length) throw new PortalRefusal("the lead sheet is not installed", 404);
    return { db: clients.open(client), fence: fenceFor(req, client.id), types };
  };
  /** The client's records, read-only: the rows this login may read. */
  const sheet = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const { db, fence, types } = await sheetOf(req);
    return snapshot(db, (tx) => use(serveRecords(types, tx, undefined, fence, meOf(req))));
  };

  /** With `client` set, that client (Wren's team, `component` installed); else null = Wren's. */
  const clientOf = async (req: PortalRequest, component: string) => {
    if (!req.client) return null;
    if (!clients) throw new PortalRefusal("not found", 404);
    const client = await pickClient(clients.main, req);
    if (!client.products || !(component in client.products))
      throw new PortalRefusal(`${component} is not installed`, 404);
    return client;
  };
  /** The database and env policy a campaign control works on: Wren's, or a client's under its caps. */
  const controlsOf = async (req: PortalRequest): Promise<{ on: Db; env: SendPolicy }> => {
    const client = await clientOf(req, SEQUENCES);
    if (!client || !clients) return { on: db, env: policy };
    const settings = sequencesSettingsSchema.safeParse(client.products[SEQUENCES]);
    if (!settings.success)
      throw new PortalRefusal("the email sequences settings do not parse", 409);
    return { on: clients.open(client), env: sendPolicyFor(settings.data, policy) };
  };

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
    /**
     * Where a call's outcome or brief works: Wren's calls, or a client's with `calls.outcome`.
     * Anyone signed in who may act there; their email is who marked it.
     */
    async callsOf(req: CallsRequest) {
      if ("demo" in req.viewer) throw new PortalRefusal("sign in to mark a call", 403);
      const client = await clientOf(req, CALL_OUTCOME);
      return {
        client: client?.id ?? null,
        on: client && clients ? clients.open(client) : db,
        ids: idsOf(req),
        by: req.viewer.email,
      };
    },
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
      const file =
        niche && name && files?.has(niche)
          ? (await liveEmails(db, niche, [name])).get(name)
          : undefined;
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
    /** The client's record types: its lead sheet's and its calls'. */
    recordsTypes: async (req: PortalRequest) => {
      const { fence, types } = await sheetOf(req);
      return types.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => sheet(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => sheet(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => sheet(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => sheet(req, (r) => r.stats(req)),
    /**
     * One firm's dossier, read only: Wren's from main for the team, a client's from its own
     * database once `research.dossier` is installed, only for a firm this login may read.
     */
    dossier: async (req: PortalRequest & { id?: unknown }) => {
      const id = Number(req.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new PortalRefusal("no such firm", 404);
      if (!req.client || req.client === WREN) {
        team(req);
        const [d] = await snapshot(db, (tx) => dossiers(tx, [id]));
        if (!d) throw new PortalRefusal("no such firm", 404);
        return dossierBrief(d);
      }
      if (!clients) throw new PortalRefusal("not found", 404);
      const client = await pickClient(clients.main, req);
      if (!client.products || !(DOSSIER in client.products))
        throw new PortalRefusal(`${DOSSIER} is not installed`, 404);
      const { db: on, fence } = await sheetOf(req);
      return snapshot(on, async (tx) => {
        // The firm row first: a fence that hides it hides its dossier too.
        await serveRecords(SHEET_RECORDS, tx, undefined, fence).get({ record: firmRecord.id, id });
        const [d] = await dossiers(tx, [id]);
        if (!d) throw new PortalRefusal("no such firm", 404);
        return dossierBrief(d);
      });
    },
    /** Warm replies waiting on William: who, their words, the proposed time and zone, the draft. */
    answers: async (req: PortalRequest) => {
      team(req);
      const client = await clientOf(req, REPLIES);
      return openInvites(client && clients ? clients.open(client) : db);
    },
    /** Which Disposition answers: Wren's, or the client's with replies installed. */
    dispositionKey: async (req: PortalRequest): Promise<string> => {
      team(req);
      const client = await clientOf(req, REPLIES);
      return client ? clientKey(client.id, "replies") : DISPOSITION_KEY;
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
      const { on, env } = await controlsOf(req);
      return asThem(
        who,
        async (tx) => {
          if (!campaign || !(await campaigns(tx)).has(campaign))
            throw new PortalRefusal("no such campaign", 404);
          return setCampaignControl(
            tx,
            env,
            { campaign, killSwitch, openersPerDay },
            `console:${who}`,
          );
        },
        on,
      );
    },
    /** A record action on `{ids}`: `done` are the campaigns it changed, the rest `skipped`. */
    async campaignAction(action: CampaignAction, req: CampaignsRequest): Promise<Done> {
      const who = team(req);
      const ids = Array.isArray(req.ids) ? req.ids.map(textOf) : [];
      if (!ids.length || ids.length > 100 || ids.some((id) => id === null))
        throw new PortalRefusal("say which campaigns: ids", 400);
      const { on, env } = await controlsOf(req);
      return asThem(
        who,
        async (tx) => {
          const known = await campaigns(tx);
          const now = await campaignPolicy(tx, env);
          const answer: Done = { done: [], skipped: [] };
          for (const id of new Set(ids as string[])) {
            const change = known.has(id) ? CAMPAIGN_STEPS[action](now, env, id) : null;
            if (change) await setCampaignControl(tx, env, change, `console:${who}`);
            answer[change ? "done" : "skipped"].push(id);
          }
          return answer;
        },
        on,
      );
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
  // The key first: an object client is a proxy, so it must never be awaited (its `then` is a call).
  const disposition = (ctx: restate.Context, key: string) =>
    ctx.objectClient<Disposition>({ name: "Disposition" }, key);
  /** Mark calls: Wren's, or the client's; `done` are the ids it changed. */
  const outcome = (ctx: restate.Context, req: CallsRequest, value: MeetingOutcome | null) =>
    answer(async () => {
      const c = await api.callsOf(req);
      const marked = await markOutcome(ctx, c.on, c.client, {
        ids: c.ids,
        outcome: value,
        reason: value === "not_yet" ? (req.reason ?? null) : null,
        by: c.by,
      });
      if (!marked.changed && value)
        throw new PortalRefusal("only a booked call that has started can be marked", 409);
      return { changed: marked.changed, done: marked.done.map(String) };
    });
  return portalService({
    name: "EmailConsole",
    main: deps.db,
    routes: EMAIL_CONSOLE_ROUTES,
    apps: EMAIL_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      answers: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.answers(req)),
      ),
      recordsTypes: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest) => answer(() => api.recordsTypes(req)),
      ),
      recordsList: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest & ListAsk) => answer(() => api.recordsList(req)),
      ),
      dossier: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest & { id?: unknown }) =>
          answer(() => api.dossier(req)),
      ),
      recordsGet: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest & GetAsk) => answer(() => api.recordsGet(req)),
      ),
      recordsExport: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest & ExportAsk) =>
          answer(() => api.recordsExport(req)),
      ),
      recordsStats: serviceHandler(
        { input: z.looseObject(PORTAL_FIELDS) },
        (_: restate.Context, req: PortalRequest & StatsAsk) => answer(() => api.recordsStats(req)),
      ),
      approve: serviceHandler(
        { input: INVITE.extend({ body: BODY }), effect: "sends" },
        (ctx: restate.Context, req: InviteRequest) =>
          answer(async () => {
            const approval = api.approval(req);
            const outcome = await disposition(ctx, await api.dispositionKey(req)).approve(approval);
            if (!outcome.ok) throw new PortalRefusal(outcome.reason, 409);
            return outcome;
          }),
      ),
      drop: serviceHandler({ input: INVITE }, (ctx: restate.Context, req: InviteRequest) =>
        answer(async () => {
          const dropping = api.dropping(req);
          return disposition(ctx, await api.dispositionKey(req)).drop(dropping);
        }),
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
      callWon: serviceHandler({ input: IDS }, (ctx: restate.Context, req: CallsRequest) =>
        outcome(ctx, req, "won"),
      ),
      callNotYet: serviceHandler(
        { input: IDS.extend({ reason: z.string().max(500).nullish().describe("Why not yet") }) },
        (ctx: restate.Context, req: CallsRequest) => outcome(ctx, req, "not_yet"),
      ),
      callNoShow: serviceHandler({ input: IDS }, (ctx: restate.Context, req: CallsRequest) =>
        outcome(ctx, req, "no_show"),
      ),
      callNotFit: serviceHandler({ input: IDS }, (ctx: restate.Context, req: CallsRequest) =>
        outcome(ctx, req, "not_fit"),
      ),
      /** Takes an outcome back: the undo for all four. */
      callClear: serviceHandler({ input: IDS }, (ctx: restate.Context, req: CallsRequest) =>
        outcome(ctx, req, null),
      ),
      /** Build a call's brief again now (`CallBriefs/build`). */
      callBrief: serviceHandler({ input: IDS }, (ctx: restate.Context, req: CallsRequest) =>
        answer(async () => {
          const { client, ids } = await ctx.run("calls", async () => {
            const c = await api.callsOf(req);
            return { client: c.client, ids: c.ids };
          });
          const done: string[] = [];
          for (const id of ids) {
            const b = await ctx
              .serviceClient<CallBriefs>({ name: "CallBriefs" })
              .build({ client, id });
            if (b.built) done.push(String(id));
          }
          return { done };
        }),
      ),
    },
  });
}
