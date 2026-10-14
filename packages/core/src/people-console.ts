/**
 * PeopleConsole: a client's People records, from its own database, for anyone who may open that
 * client (designs/2026-10-14-customerio-audit.md). The sent log, profiles and segments. Wren's own
 * People records are served by the console.
 *
 * Segments (B5) are made and changed here, in Wren's workspace (a team login naming no client) or
 * a client's: a preview counts a rule, describe asks the model for one, save checks and counts
 * it. Nothing here sends.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type Db, snapshot } from "@wren/db";
import { z } from "zod";
import { WREN } from "./access.js";
import type { Client } from "./clients/schema.js";
import { PEOPLE_CONSOLE_APPS, PEOPLE_CONSOLE_ROUTES } from "./people-console-routes.js";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
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
export const PEOPLE_RECORDS = [...SENT_RECORDS, ...SEGMENT_RECORDS];

export interface PeopleConsoleDeps {
  /** Main: the client registry. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** Left out: `PEOPLE_RECORDS`. */
  records?: readonly RecordType[];
  /** The model Describe asks, per workspace (null: Wren's); unset, Describe says so. */
  model?: (client: string | null) => SegmentModel | null;
  now?: () => Date;
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
    },
  });
}

export type PeopleConsoleService = ReturnType<typeof makePeopleConsole>;
