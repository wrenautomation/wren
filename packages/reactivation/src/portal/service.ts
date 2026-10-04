/**
 * The portal API (R14) as a Restate service on the worker, the way the phone
 * app reads SMS: the edge Worker checks who is asking and passes the viewer,
 * this picks the client and reads its database in a read-only transaction.
 * The demo (R15) needs no login and every answer goes through the mask.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Client } from "@wren/core/clients";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  type SignedViewer,
  seesInternal,
} from "@wren/core/portal";
import { metaOf, type RecordMeta } from "@wren/core/records";
import {
  type ExportAsk,
  type GetAsk,
  type ListAsk,
  type RecordAnswer,
  type RecordsApi,
  type RecordsCsv,
  type RecordsPage,
  serveRecords,
} from "@wren/core/records/serve";
import { type Db, type Queryable, setAuditActor } from "@wren/db";
import { approveDrafts, type ReviewResult, skipDrafts } from "../approve.js";
import { type CrmHealth, crmHealth } from "../crm/health.js";
import { feedDelivery } from "../delivery.js";
import { HandoffRefusal, markMeetingBooked } from "../handoff.js";
import { readClientProfile } from "../profile.js";
import { reactivationSettingsOf } from "../settings.js";
import { makeMask } from "./mask.js";
import {
  type EmailFilter,
  type EmailsPage,
  portalEmails,
  portalReplies,
  type RepliesPage,
  type ReplyFilter,
} from "./outbox.js";
import { REACTIVATION_RECORDS } from "./records.js";
import { portalRun, type RunPage } from "./run.js";
import { portalSetup, type Setup } from "./setup.js";
import {
  listNames,
  type Overview,
  type PeopleFilter,
  type PeoplePage,
  type PersonView,
  portalOverview,
  portalPeople,
  portalPerson,
  portalRaw,
  type RawPage,
} from "./views.js";
import { portalWork, unlinkMasked, type WorkView } from "./work.js";

export { PortalRefusal, type PortalRequest, type Viewer } from "@wren/core/portal";

export interface PortalDeps {
  /** The main database: the client registry. */
  main: Db;
  /** A client's own database (the worker's per-client pool). */
  open(client: Client): Db;
}

/** The demo's name on screen; the agency it was built from is never named. */
export const DEMO_NAME = "Sample recruiting firm";

/** Read one client's database, read-only, masked when it is the demo. */
/** The demo's mask: list surnames to initials, the agency's name to the demo's. */
async function demoMask(tx: Queryable, client: Client) {
  const firm = (await readClientProfile(tx))?.firm;
  const agency = { names: [client.name, firm].filter((n): n is string => !!n), as: DEMO_NAME };
  return makeMask(await listNames(tx), agency);
}

async function read<T>(
  deps: PortalDeps,
  req: PortalRequest,
  view: (db: Queryable, client: Client) => Promise<T>,
): Promise<T> {
  const client = await pickClient(deps.main, req);
  const db = deps.open(client);
  return db.transaction(
    async (tx) => {
      const out = await view(tx, client);
      return client.demo ? (await demoMask(tx, client))(out) : out;
    },
    { accessMode: "read only" },
  );
}

/** Records over one client's database, read-only; on the demo the server masks every answer once. */
async function records<T>(
  deps: PortalDeps,
  req: PortalRequest,
  use: (api: RecordsApi) => Promise<T>,
): Promise<T> {
  const client = await pickClient(deps.main, req);
  return deps.open(client).transaction(
    async (tx) => {
      const mask = client.demo ? await demoMask(tx, client) : undefined;
      return use(serveRecords(REACTIVATION_RECORDS, tx, mask));
    },
    { accessMode: "read only" },
  );
}

/**
 * Change one client's list: never the demo, in one transaction. Settings come
 * from the registry row, so a write sees the client's current ones.
 */
async function write<T>(
  deps: PortalDeps,
  req: PortalRequest,
  change: (db: Queryable, client: Client, viewer: SignedViewer) => Promise<T>,
): Promise<T> {
  const { client, viewer } = await pickForWrite(deps.main, req);
  return deps.open(client).transaction(async (tx) => {
    // Every row this changes is logged as this person's (audit_events.actor).
    await setAuditActor(tx, viewer.email);
    return change(tx, client, viewer);
  });
}

/** Enrollment ids from a browser: whole positive numbers, at most one page's worth. */
const idsOf = (v: unknown): number[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500)
    throw new PortalRefusal("pick the emails first", 404);
  return v.map((x) => {
    const n = typeof x === "number" ? x : Number.NaN;
    if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal("no such email", 404);
    return n;
  });
};
const settingsOf = (client: Client) => reactivationSettingsOf(client.products);

/** A browser can send anything: a page offset is a whole number from 0 to 1,000,000. */
const offsetOf = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1_000_000) : undefined;
};
/** A feed cursor: the last line seen, 0 before any; up to the serial's top. */
const cursorOf = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 2_147_483_647) : undefined;
};
const textOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;
/** A person or reply id that isn't a positive whole number names nobody. */
const idOf = (v: unknown, what = "person on this list"): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`no such ${what}`, 404);
  return n;
};
const opt = <K extends string, V>(k: K, v: V | undefined) =>
  (v === undefined ? {} : { [k]: v }) as Partial<Record<K, V>>;

/** The handlers as plain functions: the service wraps them, tests call them. */
export function portalApi(deps: PortalDeps) {
  return {
    overview: (req: PortalRequest): Promise<Overview> => read(deps, req, portalOverview),
    /** What each record type shows and lets this viewer filter, sort and search. */
    recordsTypes: async (req: PortalRequest): Promise<RecordMeta[]> => {
      const client = await pickClient(deps.main, req);
      return REACTIVATION_RECORDS.map((t) => metaOf(t, client.demo));
    },
    recordsList: (req: PortalRequest & ListAsk): Promise<RecordsPage> =>
      records(deps, req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk): Promise<RecordAnswer> =>
      records(deps, req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk): Promise<RecordsCsv> =>
      records(deps, req, (r) => r.export(req)),
    health: (req: PortalRequest): Promise<CrmHealth> => read(deps, req, (db) => crmHealth(db)),
    setup: (req: PortalRequest): Promise<Setup> => read(deps, req, portalSetup),
    run: (req: PortalRequest & { run?: string; after?: number }): Promise<RunPage> =>
      read(deps, req, (db) =>
        portalRun(db, {
          run: textOf(req.run),
          after: cursorOf(req.after),
          operator: seesInternal(req),
        }),
      ),
    /** The work behind one run line: a step and who it was about. */
    work: async (req: PortalRequest & { step?: string; subject?: string }): Promise<WorkView> => {
      const step = textOf(req.step);
      const subject = textOf(req.subject)?.slice(0, 200);
      if (!step || !subject) throw new PortalRefusal("no such line in this run", 404);
      // The demo's lines name people as masked, so a name matches as the demo shows it.
      const view = await read(deps, req, async (db, client) => {
        if (!client.demo) return portalWork(db, { step, subject, operator: seesInternal(req) });
        const shown = await demoMask(db, client);
        const work = await portalWork(db, { step, subject, operator: seesInternal(req), shown });
        return work && unlinkMasked(work, shown);
      });
      if (!view) throw new PortalRefusal("nothing kept for that line", 404);
      return view;
    },
    people: (
      req: PortalRequest & { filter?: PeopleFilter; offset?: number; q?: string },
    ): Promise<PeoplePage> =>
      read(deps, req, (db) =>
        portalPeople(db, {
          ...opt("filter", textOf(req.filter) as PeopleFilter | undefined),
          ...opt("offset", offsetOf(req.offset)),
          ...opt("q", textOf(req.q)),
          searchNames: !isDemo(req.viewer),
        }),
      ),
    person: async (req: PortalRequest & { personId: number }): Promise<PersonView> => {
      const id = idOf(req.personId);
      const view = await read(deps, req, (db) => portalPerson(db, id));
      if (!view) throw new PortalRefusal("no such person on this list", 404);
      return view;
    },
    raw: (
      req: PortalRequest & { via?: string; kind?: string; offset?: number },
    ): Promise<RawPage> =>
      read(deps, req, (db) =>
        portalRaw(db, {
          ...opt("via", textOf(req.via)),
          ...opt("kind", textOf(req.kind)),
          ...opt("offset", offsetOf(req.offset)),
        }),
      ),
    emails: async (
      req: PortalRequest & { filter?: EmailFilter; offset?: number },
    ): Promise<EmailsPage> =>
      read(deps, req, (db, client) =>
        portalEmails(db, {
          ...opt("filter", textOf(req.filter) as EmailFilter | undefined),
          ...opt("offset", offsetOf(req.offset)),
          approval: settingsOf(client).approval,
        }),
      ),
    replies: async (
      req: PortalRequest & { filter?: ReplyFilter; offset?: number },
    ): Promise<RepliesPage> =>
      read(deps, req, (db, client) =>
        portalReplies(db, {
          ...opt("filter", textOf(req.filter) as ReplyFilter | undefined),
          ...opt("offset", offsetOf(req.offset)),
          offer: client.demo ? null : settingsOf(client).offer,
        }),
      ),
    /** Send these: approve the drafts of the chosen emails. */
    approve: (req: PortalRequest & { enrollmentIds: number[] }): Promise<ReviewResult> =>
      write(deps, req, (db, _, viewer) =>
        approveDrafts(
          db,
          { enrollmentIds: idsOf(req.enrollmentIds) },
          viewer.operator ? "operator" : "client",
        ),
      ),
    /** Don't send these: the drafts are struck and that person is left alone. */
    skip: (req: PortalRequest & { enrollmentIds: number[] }): Promise<ReviewResult> =>
      write(deps, req, (db, _, viewer) =>
        skipDrafts(
          db,
          { enrollmentIds: idsOf(req.enrollmentIds) },
          viewer.operator ? "operator" : "client",
        ),
      ),
    /** A meeting came of this reply, or (booked: false) it didn't after all. */
    book: async (
      req: PortalRequest & { threadEventId: number; booked?: boolean },
    ): Promise<{ bookedAt: string | null; by: string | null }> => {
      const { client, out } = await write(deps, req, async (db, client, viewer) => {
        const threadEventId = idOf(req.threadEventId, "reply");
        try {
          const out = await markMeetingBooked(
            db,
            {
              threadEventId,
              booked: req.booked !== false,
              by: viewer.email,
              operator: viewer.operator === true,
            },
            await readClientProfile(db),
          );
          return { client, out: { bookedAt: out.bookedAt?.toISOString() ?? null, by: out.by } };
        } catch (err) {
          if (err instanceof HandoffRefusal)
            throw new PortalRefusal(err.message, err.kind === "forbidden" ? 403 : 404);
          throw err;
        }
      });
      // The work portal's meetings and bill follow at once; a miss is the loop's next pass.
      await feedDelivery(
        deps.main,
        deps.open(client),
        client.id,
        settingsOf(client),
        new Date(),
      ).catch(() => undefined);
      return out;
    },
  };
}

export type PortalApi = ReturnType<typeof portalApi>;
export type {
  Cell,
  FieldMeta,
  Kind,
  Op,
  RecordMeta,
  SavedView,
  State,
  Tone,
} from "@wren/core/records";
export type {
  ActivityLine,
  ExportAsk,
  GetAsk,
  ListAsk,
  RecordAnswer,
  RecordsCsv,
  RecordsPage,
  Row,
} from "@wren/core/records/serve";
export type { ReviewResult } from "../approve.js";
export type { WhyLine } from "../compose.js";
/** What the answers look like, for the portal's web app. */
export type { CrmHealth } from "../crm/health.js";
export type { RankedContact } from "../ranked.js";
export type { Reason } from "../score.js";
export type {
  EmailFilter,
  EmailRow,
  EmailStatus,
  EmailsPage,
  RepliesPage,
  ReplyFilter,
  ReplyRow,
} from "./outbox.js";
export type { Pipeline, PipelineStep, PipelineStepId, StepState } from "./pipeline.js";
export { PORTAL_ROUTES, PORTAL_WRITES } from "./routes.js";
export type { LiveRun, RunPage } from "./run.js";
export type { Setup } from "./setup.js";
export type { Story } from "./story.js";
export type {
  Now,
  Overview,
  PeopleFilter,
  PeoplePage,
  PersonRow,
  PersonView,
  RawFinding,
  RawPage,
  Source,
} from "./views.js";
export type { WorkFact, WorkIcon, WorkLink, WorkOption, WorkStep, WorkView } from "./work.js";

/**
 * No journal: a retry reads again, or writes again, and every write is
 * idempotent (a second approve finds nothing waiting). Pages stay out of
 * Restate's storage. Refusals are terminal, with the status the Worker returns.
 */
export function makeReactivationPortal(deps: PortalDeps) {
  const api = portalApi(deps);
  type Req<K extends keyof PortalApi> = Parameters<PortalApi[K]>[0];
  return restate.service({
    name: "ReactivationPortal",
    handlers: {
      overview: (_: restate.Context, req: Req<"overview">) => answer(() => api.overview(req)),
      recordsTypes: (_: restate.Context, req: Req<"recordsTypes">) =>
        answer(() => api.recordsTypes(req)),
      recordsList: (_: restate.Context, req: Req<"recordsList">) =>
        answer(() => api.recordsList(req)),
      recordsGet: (_: restate.Context, req: Req<"recordsGet">) => answer(() => api.recordsGet(req)),
      recordsExport: (_: restate.Context, req: Req<"recordsExport">) =>
        answer(() => api.recordsExport(req)),
      health: (_: restate.Context, req: Req<"health">) => answer(() => api.health(req)),
      setup: (_: restate.Context, req: Req<"setup">) => answer(() => api.setup(req)),
      run: (_: restate.Context, req: Req<"run">) => answer(() => api.run(req)),
      work: (_: restate.Context, req: Req<"work">) => answer(() => api.work(req)),
      people: (_: restate.Context, req: Req<"people">) => answer(() => api.people(req)),
      person: (_: restate.Context, req: Req<"person">) => answer(() => api.person(req)),
      raw: (_: restate.Context, req: Req<"raw">) => answer(() => api.raw(req)),
      emails: (_: restate.Context, req: Req<"emails">) => answer(() => api.emails(req)),
      replies: (_: restate.Context, req: Req<"replies">) => answer(() => api.replies(req)),
      approve: (_: restate.Context, req: Req<"approve">) => answer(() => api.approve(req)),
      skip: (_: restate.Context, req: Req<"skip">) => answer(() => api.skip(req)),
      book: (_: restate.Context, req: Req<"book">) => answer(() => api.book(req)),
    },
  });
}
