/**
 * PeopleConsole: a client's People records, from its own database, for anyone who may open that
 * client (designs/2026-10-14-customerio-audit.md). The sent log, profiles and segments. Wren's own
 * People records are served by the console.
 *
 * Segments (B5) are made and changed here, in Wren's workspace (a team login naming no client) or
 * a client's: a preview counts a rule, describe asks the model for one, save checks and counts
 * it.
 *
 * Broadcasts (B6) too: saved, asked, approved (only by who may approve the workspace's To
 * approve), declined, canceled, restored, tested. Approve and Restore tell the `Broadcast` object
 * when to run; a test goes to one address on our own domain. Nothing else here sends.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type Db, snapshot } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mayApprove, WREN } from "./access.js";
import { mintMessageId } from "./bounces.js";
import { BROADCAST_RECORDS } from "./broadcast-records.js";
import { BROADCAST, type BroadcastObject, broadcastKey } from "./broadcast-run.js";
import {
  askBroadcast,
  type BroadcastInput,
  broadcastById,
  broadcastContext,
  broadcastMonth,
  cancelBroadcast,
  decideBroadcast,
  isUnset,
  type MailOf,
  markTested,
  previewBroadcast,
  renderFor,
  restoreBroadcast,
  saveBroadcast,
} from "./broadcasts.js";
import type { Client } from "./clients/schema.js";
import { PEOPLE_CONSOLE_APPS, PEOPLE_CONSOLE_ROUTES } from "./people-console-routes.js";
import {
  accessOf,
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
  whoIs,
} from "./portal.js";
import { metaOf, type RecordType } from "./records.js";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  meOf,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "./records-serve.js";
import { PORTAL_FIELDS, serviceHandler } from "./restate/form.js";
import { topics } from "./schema.js";
import { SEGMENT_RECORDS } from "./segment-records.js";
import {
  addMembers,
  archiveSegment,
  type DescribeContext,
  describeSegment,
  listSegments,
  previewRule,
  removeMembers,
  restoreSegment,
  retake,
  type SegmentInput,
  type SegmentModel,
  saveSegment,
  traitKeys,
} from "./segments.js";
import { SENT_RECORDS } from "./sent-records.js";

/** The record types a client's People serves. Each build adds its own here. */
export const PEOPLE_RECORDS = [...SENT_RECORDS, ...SEGMENT_RECORDS, ...BROADCAST_RECORDS];

export interface PeopleConsoleDeps {
  /** Main: the client registry. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** Left out: `PEOPLE_RECORDS`. */
  records?: readonly RecordType[];
  /** The model Describe asks, per workspace (null: Wren's); unset, Describe says so. */
  model?: (client: string | null) => SegmentModel | null;
  /** How a workspace's email broadcasts and their tests leave; unset, email isn't set up. */
  mail?: MailOf;
  /** The one phone a text test may go to (Wren's operator's); unset, text tests are refused. */
  testPhone?: string | null;
  now?: () => Date;
}

export interface BroadcastSaveRequest extends PortalRequest, BroadcastInput {}
/**
 * Broadcasts picked, by id or To approve's `broadcast:<id>`; `note` is a decline's why. `expect`
 * is the version the person saw, for one broadcast: a change since refuses the yes.
 */
export interface BroadcastIdsRequest extends PortalRequest {
  ids?: (string | number)[];
  note?: string;
  expect?: string;
}
/** One copy to `to`: the broadcast by `id`, or the one picked (`ids`). */
export interface BroadcastTestRequest extends PortalRequest {
  id?: number | string;
  ids?: (string | number)[];
  to?: string;
}
/** When each approved or restored broadcast runs: the service tells its `Broadcast` object. */
export interface BroadcastRun {
  key: string;
  at: string;
}

export interface SegmentIdsRequest extends PortalRequest {
  ids?: (string | number)[];
}
export interface SegmentSaveRequest extends PortalRequest, Partial<SegmentInput> {}
/** Profiles (`ids`) put in a manual segment, named by its name or id. */
export interface MemberAddRequest extends PortalRequest {
  segment?: string | number;
  ids?: (string | number)[];
}

/** The handlers as plain functions: the service wraps them, tests call them. */
export function peopleConsoleApi({
  db,
  open,
  records = PEOPLE_RECORDS,
  model,
  mail = async () => ({ unset: "Email isn't set up here" }),
  testPhone = null,
  now = () => new Date(),
}: PeopleConsoleDeps) {
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await pickClient(db, req);
    return snapshot(open(client), (tx) =>
      use(serveRecords(records, tx, undefined, fenceFor(req, client.id), meOf(req))),
    );
  };
  /**
   * Whose segments: the client named, else Wren's for Wren's team, else the login's own client.
   * Refused past what the viewer may `p` in People there; a change never on the demo.
   */
  const workspace = async (
    req: PortalRequest,
    p: "read" | "act",
  ): Promise<{ client: string | null; db: Db }> => {
    const v = req.viewer;
    const named = req.client && req.client !== WREN ? req.client : null;
    if (p === "act" && isDemo(v)) throw new PortalRefusal("the demo is read-only", 403);
    const wren = !named && !isDemo(v) && v.operator === true;
    const client = wren
      ? null
      : p === "act"
        ? (await pickForWrite(db, req)).client
        : await pickClient(db, req);
    if (!(await canAt(db, req, p, { client: client?.id ?? WREN, app: "people", channel: null })))
      throw new PortalRefusal(p === "read" ? "no access" : "your role can't do that here", 403);
    return client ? { client: client.id, db: open(client) } : { client: null, db };
  };
  const by = (req: PortalRequest) => (req.viewer as SignedViewer).email ?? "portal";
  /** May this viewer say yes in this workspace's To approve: Wren's team for Wren's. */
  const approves = async (req: PortalRequest, client: string | null) => {
    if (!client) return mayApprove(accessOf(req), null);
    const row = await pickClient(db, { ...req, client });
    const v = req.viewer;
    const who = !isDemo(v) && !v.access && !v.operator ? await whoIs(db, v, client) : accessOf(req);
    return mayApprove(who, client, row.approver);
  };
  const broadcastIds = (req: BroadcastIdsRequest) => {
    const ids = [
      ...new Set((req.ids ?? []).map((i) => Number(String(i).replace(/^broadcast:/, "")))),
    ].filter((n) => Number.isSafeInteger(n) && n > 0);
    if (!ids.length) throw new PortalRefusal("nothing picked", 404);
    return ids;
  };
  const idsOf = (req: SegmentIdsRequest) => {
    const ids = [...new Set((req.ids ?? []).map(Number))].filter(Number.isSafeInteger);
    if (!ids.length) throw new PortalRefusal("nothing picked", 404);
    return ids;
  };
  /** Each picked segment changed. A change wakes the workspace's pass at commit (`wren_wake`). */
  const each = async <T>(
    req: SegmentIdsRequest,
    fn: (w: Db, id: number, at: Date) => Promise<T>,
  ) => {
    const w = await workspace(req, "act");
    const done: number[] = [];
    for (const id of idsOf(req)) {
      await fn(w.db, id, now());
      done.push(id);
    }
    return { done };
  };

  return {
    /** What the rule editor offers: the workspace's trait keys and its active segments. */
    segmentContext: async (req: PortalRequest) => {
      const w = await workspace(req, "read");
      const segs = await listSegments(w.db, "active");
      return {
        traits: await traitKeys(w.db),
        segments: segs.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        describe: !!model?.(w.client),
      };
    },
    /** How many a rule matches now, a few by name, and the rule in words. Saves nothing. */
    segmentPreview: async (req: PortalRequest & { rule?: unknown }) => {
      const w = await workspace(req, "read");
      return previewRule(w.db, req.rule, now());
    },
    /** Plain words as a rule, by the model, shown for a yes. Saves nothing. */
    segmentDescribe: async (req: PortalRequest & { words?: string }) => {
      const w = await workspace(req, "act");
      const m = model?.(w.client);
      if (!m) throw new PortalRefusal("In development: no model is set up here", 503);
      const segs = await listSegments(w.db, "active");
      const c: DescribeContext = {
        traits: await traitKeys(w.db),
        segments: segs.map((s) => ({ id: s.id, name: s.name })),
        today: now().toISOString().slice(0, 10),
      };
      const got = await describeSegment(m, String(req.words ?? ""), c);
      if ("error" in got) throw new PortalRefusal(got.error, 422);
      return got;
    },
    /** A segment made or changed; a live one counted now, a new snapshot taken. */
    segmentSave: async (req: SegmentSaveRequest) => {
      const w = await workspace(req, "act");
      const got = await saveSegment(
        w.db,
        {
          id: req.id ?? null,
          name: String(req.name ?? ""),
          kind: req.kind ?? "live",
          rule: req.rule,
          words: req.words ?? null,
          expect: req.expect ?? null,
        },
        by(req),
        now(),
      );
      return {
        segment: got.segment,
        entered: got.change?.entered.length ?? 0,
        left: got.change?.left.length ?? 0,
      };
    },
    segmentArchive: (req: SegmentIdsRequest) => each(req, archiveSegment),
    segmentRestore: (req: SegmentIdsRequest) => each(req, restoreSegment),
    segmentRetake: (req: SegmentIdsRequest) => each(req, retake),
    /** People put in a manual segment by hand. */
    memberAdd: async (req: MemberAddRequest) => {
      const w = await workspace(req, "act");
      const named = String(req.segment ?? "")
        .trim()
        .toLowerCase();
      const seg = (await listSegments(w.db)).find(
        (s) => String(s.id) === named || s.name.toLowerCase() === named,
      );
      if (!seg) throw new PortalRefusal(`no segment called ${String(req.segment ?? "")}`, 404);
      const ids = idsOf(req);
      await addMembers(w.db, seg.id, ids, now());
      return { done: ids, segment: seg.name };
    },
    /** Members taken out of their manual segment, by member id (`<segment>:<profile>`). */
    memberRemove: async (req: PortalRequest & { ids?: string[] }) => {
      const w = await workspace(req, "act");
      const by = new Map<number, number[]>();
      for (const id of req.ids ?? []) {
        const [s, p] = String(id).split(":").map(Number);
        if (!Number.isSafeInteger(s) || !Number.isSafeInteger(p)) continue;
        by.set(s as number, [...(by.get(s as number) ?? []), p as number]);
      }
      if (!by.size) throw new PortalRefusal("nothing picked", 404);
      for (const [s, ps] of by) await removeMembers(w.db, s, ps, now());
      return { done: req.ids ?? [] };
    },
    /** The broadcast editor's lists: segments, topics, merge fields, and what may send here. */
    broadcastContext: async (req: PortalRequest) => {
      const w = await workspace(req, "read");
      const m = await mail(w.client, w.db);
      return {
        ...(await broadcastContext(w.db)),
        email: !isUnset(m),
        /** Why email can't send yet, and where to fix it. */
        emailUnset: isUnset(m) ? m.unset : null,
        text: true,
        testDomain: isUnset(m) ? null : m.domain,
        testPhone: w.client ? null : testPhone,
      };
    },
    /** The words for a sample person, and how many it would reach. Saves nothing. */
    broadcastPreview: async (req: BroadcastSaveRequest) => {
      const w = await workspace(req, "read");
      return previewBroadcast(w.db, req);
    },
    /** The calendar's broadcasts between `from` and `to` (at most 62 days). */
    broadcastMonth: async (req: PortalRequest & { from?: string; to?: string }) => {
      const w = await workspace(req, "read");
      const from = new Date(String(req.from ?? ""));
      const to = new Date(String(req.to ?? ""));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
        throw new PortalRefusal("from and to are dates", 422);
      if (to.getTime() - from.getTime() > 62 * 86_400_000)
        throw new PortalRefusal("at most 62 days at once", 422);
      return { broadcasts: await broadcastMonth(w.db, from, to) };
    },
    /** A broadcast made or changed; `ask` puts it in To approve. Email needs a mailer first. */
    broadcastSave: async (req: BroadcastSaveRequest) => {
      const w = await workspace(req, "act");
      const was = req.id ? await broadcastById(w.db, Number(req.id)) : null;
      const channel = req.channel ?? was?.channel;
      if (channel === "email") {
        const m = await mail(w.client, w.db);
        if (isUnset(m)) throw new PortalRefusal(m.unset, 409);
      }
      return { broadcast: await saveBroadcast(w.db, req, by(req), now()) };
    },
    broadcastAsk: async (req: BroadcastIdsRequest) => {
      const w = await workspace(req, "act");
      for (const id of broadcastIds(req)) await askBroadcast(w.db, id, by(req), now());
      return { done: broadcastIds(req) };
    },
    /** A yes: each scheduled, and when each runs, for the service to tell its object. */
    broadcastApprove: async (req: BroadcastIdsRequest) => {
      const w = await workspace(req, "act");
      if (!(await approves(req, w.client)))
        throw new PortalRefusal("your role can't approve here", 403);
      const runs: BroadcastRun[] = [];
      const ids = broadcastIds(req);
      const expect = ids.length === 1 ? (req.expect ?? null) : null;
      for (const id of ids) {
        const got = await decideBroadcast(w.db, id, true, by(req), now(), null, expect);
        if (got.startAt)
          runs.push({ key: broadcastKey(w.client, id), at: got.startAt.toISOString() });
      }
      return { done: broadcastIds(req), runs };
    },
    broadcastDecline: async (req: BroadcastIdsRequest) => {
      const w = await workspace(req, "act");
      if (!(await approves(req, w.client)))
        throw new PortalRefusal("your role can't decline here", 403);
      for (const id of broadcastIds(req))
        await decideBroadcast(w.db, id, false, by(req), now(), req.note ?? null);
      return { done: broadcastIds(req) };
    },
    broadcastCancel: async (req: BroadcastIdsRequest) => {
      const w = await workspace(req, "act");
      for (const id of broadcastIds(req)) await cancelBroadcast(w.db, id, by(req), now());
      return { done: broadcastIds(req) };
    },
    /** Cancel undone: a started one resumes (it had its yes), else it's a draft again. */
    broadcastRestore: async (req: BroadcastIdsRequest) => {
      const w = await workspace(req, "act");
      const runs: BroadcastRun[] = [];
      for (const id of broadcastIds(req)) {
        const got = await restoreBroadcast(w.db, id, now());
        if (got.startAt)
          runs.push({ key: broadcastKey(w.client, id), at: got.startAt.toISOString() });
      }
      return { done: broadcastIds(req), runs };
    },
    /**
     * One copy to one address, marked [test], recorded nowhere but the broadcast's last test. An
     * email only to our own domain; a text only to the operator's phone, through its thread.
     */
    broadcastTest: async (req: BroadcastTestRequest) => {
      const w = await workspace(req, "act");
      const one = req.id ?? req.ids?.[0] ?? "";
      const b = await broadcastById(w.db, Number(String(one).replace(/^broadcast:/, "")));
      if (!b) throw new PortalRefusal("no such broadcast", 404);
      const to = String(req.to ?? "").trim();
      const copy = renderFor(b, { first_name: "Sam", name: "Sam Rivera" }, "test");
      if ("missing" in copy) throw new PortalRefusal(copy.missing, 422);
      const at = now();
      if (b.channel === "email") {
        const m = await mail(w.client, w.db);
        if (isUnset(m)) throw new PortalRefusal(m.unset, 409);
        const addr = to.toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(addr) || !addr.endsWith(`@${m.domain}`))
          throw new PortalRefusal(`a test goes only to an @${m.domain} address`, 422);
        const [t] = await w.db.select().from(topics).where(eq(topics.id, b.topicId));
        const env = m.envelope(addr, { name: t?.name ?? "", publicName: t?.publicName ?? "" });
        await m.send({
          to: addr,
          subject: `[test] ${copy.subject ?? b.name}`,
          text: `${copy.body}${env.footer}`,
          headers: env.headers,
          messageId: mintMessageId(m.domain),
        });
        await markTested(w.db, b.id, addr, at);
        return { sent: addr };
      }
      if (w.client || !testPhone)
        throw new PortalRefusal("In development: a text test needs the operator's phone set", 503);
      if (to.replace(/[^\d+]/g, "") !== testPhone)
        throw new PortalRefusal("a text test goes only to the operator's phone", 422);
      const [c] = (await w.db.execute(
        sql`select id, number_id from sms_contacts where e164 = ${testPhone} and number_id is not null
          order by id desc limit 1`,
      )) as unknown as { id: number; number_id: string }[];
      if (!c) throw new PortalRefusal("no texts thread with that phone here yet", 409);
      await w.db.execute(sql`insert into sms_messages
          (contact_id, direction, kind, number_id, to_e164, body, state, due_at, created_at)
        values (${c.id}, 'out', 'manual', ${c.number_id}::uuid, ${testPhone}, ${`[test] ${copy.body}`},
          'queued', ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)`);
      await markTested(w.db, b.id, testPhone, at);
      return { sent: testPhone };
    },
    recordsTypes: async (req: PortalRequest) => {
      const fence = fenceFor(req, (await pickClient(db, req)).id);
      return records.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),
  };
}

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };

/** Each approved or restored broadcast's object told when to run. */
function runAll(ctx: restate.Context, runs: readonly BroadcastRun[]) {
  for (const r of runs)
    ctx.objectSendClient<BroadcastObject>(BROADCAST, r.key).schedule({ at: r.at });
}

export function makePeopleConsole(deps: PeopleConsoleDeps) {
  const api = peopleConsoleApi(deps);
  return portalService({
    name: "PeopleConsole",
    main: deps.db,
    routes: PEOPLE_CONSOLE_ROUTES,
    apps: PEOPLE_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      recordsTypes: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.recordsTypes(req)),
      ),
      recordsList: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ListAsk) =>
        answer(() => api.recordsList(req)),
      ),
      recordsGet: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & GetAsk) =>
        answer(() => api.recordsGet(req)),
      ),
      recordsExport: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ExportAsk) =>
        answer(() => api.recordsExport(req)),
      ),
      recordsStats: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & StatsAsk) =>
        answer(() => api.recordsStats(req)),
      ),
      segmentContext: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.segmentContext(req)),
      ),
      segmentPreview: serviceHandler(
        RECORDS,
        (_: restate.Context, req: PortalRequest & { rule?: unknown }) =>
          answer(() => api.segmentPreview(req)),
      ),
      segmentDescribe: serviceHandler(
        RECORDS,
        (ctx: restate.Context, req: PortalRequest & { words?: string }) =>
          // The model's answer, journaled: a retry shows the same rule.
          answer(() => ctx.run("describe", () => answer(() => api.segmentDescribe(req)))),
      ),
      segmentSave: serviceHandler(RECORDS, (ctx: restate.Context, req: SegmentSaveRequest) =>
        answer(() => ctx.run("save", () => answer(() => api.segmentSave(req)))),
      ),
      segmentArchive: serviceHandler(RECORDS, (ctx: restate.Context, req: SegmentIdsRequest) =>
        answer(() => ctx.run("archive", () => answer(() => api.segmentArchive(req)))),
      ),
      segmentRestore: serviceHandler(RECORDS, (ctx: restate.Context, req: SegmentIdsRequest) =>
        answer(() => ctx.run("restore", () => answer(() => api.segmentRestore(req)))),
      ),
      segmentRetake: serviceHandler(RECORDS, (ctx: restate.Context, req: SegmentIdsRequest) =>
        answer(() => ctx.run("retake", () => answer(() => api.segmentRetake(req)))),
      ),
      memberAdd: serviceHandler(RECORDS, (ctx: restate.Context, req: MemberAddRequest) =>
        answer(() => ctx.run("add", () => answer(() => api.memberAdd(req)))),
      ),
      memberRemove: serviceHandler(
        RECORDS,
        (ctx: restate.Context, req: PortalRequest & { ids?: string[] }) =>
          answer(() => ctx.run("remove", () => answer(() => api.memberRemove(req)))),
      ),
      broadcastContext: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.broadcastContext(req)),
      ),
      broadcastPreview: serviceHandler(RECORDS, (_: restate.Context, req: BroadcastSaveRequest) =>
        answer(() => api.broadcastPreview(req)),
      ),
      broadcastMonth: serviceHandler(
        RECORDS,
        (_: restate.Context, req: PortalRequest & { from?: string; to?: string }) =>
          answer(() => api.broadcastMonth(req)),
      ),
      broadcastSave: serviceHandler(RECORDS, (ctx: restate.Context, req: BroadcastSaveRequest) =>
        answer(() => ctx.run("save", () => answer(() => api.broadcastSave(req)))),
      ),
      broadcastAsk: serviceHandler(RECORDS, (ctx: restate.Context, req: BroadcastIdsRequest) =>
        answer(() => ctx.run("ask", () => answer(() => api.broadcastAsk(req)))),
      ),
      broadcastApprove: serviceHandler(
        { ...RECORDS, effect: "sends" },
        async (ctx: restate.Context, req: BroadcastIdsRequest) => {
          const got = await answer(() =>
            ctx.run("approve", () => answer(() => api.broadcastApprove(req))),
          );
          runAll(ctx, got.runs);
          return { done: got.done };
        },
      ),
      broadcastDecline: serviceHandler(RECORDS, (ctx: restate.Context, req: BroadcastIdsRequest) =>
        answer(() => ctx.run("decline", () => answer(() => api.broadcastDecline(req)))),
      ),
      broadcastCancel: serviceHandler(RECORDS, (ctx: restate.Context, req: BroadcastIdsRequest) =>
        answer(() => ctx.run("cancel", () => answer(() => api.broadcastCancel(req)))),
      ),
      broadcastRestore: serviceHandler(
        { ...RECORDS, effect: "sends" },
        async (ctx: restate.Context, req: BroadcastIdsRequest) => {
          const got = await answer(() =>
            ctx.run("restore", () => answer(() => api.broadcastRestore(req))),
          );
          runAll(ctx, got.runs);
          return { done: got.done };
        },
      ),
      broadcastTest: serviceHandler(
        { ...RECORDS, effect: "sends" },
        (ctx: restate.Context, req: BroadcastTestRequest) =>
          answer(() => ctx.run("test", () => answer(() => api.broadcastTest(req)))),
      ),
    },
  });
}

export type PeopleConsoleService = ReturnType<typeof makePeopleConsole>;
