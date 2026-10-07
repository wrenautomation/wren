/**
 * The portal API (R14) as a Restate service on the worker, the way the phone
 * app reads SMS: the edge Worker checks who is asking and passes the viewer,
 * this picks the client and reads its database in a read-only transaction.
 * The demo (R15) needs no login and every answer goes through the mask.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Client } from "@wren/core/clients";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
  seesInternal,
} from "@wren/core/portal";
import { metaOf, type RecordMeta } from "@wren/core/records";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  type RecordAnswer,
  type RecordsApi,
  type RecordsCsv,
  type RecordsPage,
  type RecordsStat,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { type Db, type Queryable, serializable, setAuditActor, snapshot } from "@wren/db";
import { sql } from "drizzle-orm";
import { approveDrafts, type ReviewResult, skipDrafts, unapproveDrafts } from "../approve.js";
import { feedDelivery } from "../delivery.js";
import { HandoffRefusal, markMeetingBooked } from "../handoff.js";
import { readClientProfile, setClientProfile } from "../profile.js";
import { scoreCrmContacts, WHERE_STAGE, whereConflict } from "../score.js";
import { reactivationSettingsOf } from "../settings.js";
import { makeMask } from "./mask.js";
import { type EmailFilter, type EmailsPage, portalEmails } from "./outbox.js";
import { EDITABLE, REACTIVATION_RECORDS, settingOf } from "./records.js";
import { PORTAL_APPS, PORTAL_ROUTES } from "./routes.js";
import { portalRun, type RunPage } from "./run.js";
import {
  listNames,
  type Overview,
  type PersonView,
  portalOverview,
  portalPerson,
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

/**
 * The demo is masked only for a visitor with no login: its list is a real agency's, so the open
 * link never publishes a person. Anyone signed in sees real names and profile links, to check
 * a finding.
 */
const masked = (client: Client, req: PortalRequest) => client.demo && isDemo(req.viewer);

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
  return snapshot(db, async (tx) => {
    const out = await view(tx, client);
    return masked(client, req) ? (await demoMask(tx, client))(out) : out;
  });
}

const typesOf = (client: Client) => [...REACTIVATION_RECORDS, settingOf(client)];

/** Records over one client's database, read-only; a masked demo is masked once, on the server. */
async function records<T>(
  deps: PortalDeps,
  req: PortalRequest,
  use: (api: RecordsApi) => Promise<T>,
): Promise<T> {
  const client = await pickClient(deps.main, req);
  return snapshot(deps.open(client), async (tx) => {
    const mask = masked(client, req) ? await demoMask(tx, client) : undefined;
    return use(serveRecords(typesOf(client), tx, mask, fenceFor(req, client.id)));
  });
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
  return serializable(deps.open(client), async (tx) => {
    // Every row this changes is logged as this person's (audit_events.actor).
    await setAuditActor(tx, viewer.email);
    return change(tx, client, viewer);
  });
}

const PLURAL: Record<string, string> = { reply: "replies", person: "people" };
/** Enrollment ids from a browser: whole positive numbers, at most one page's worth. */
const idsOf = (v: unknown, what = "email"): number[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500)
    throw new PortalRefusal(`pick the ${PLURAL[what] ?? `${what}s`} first`, 404);
  return v.map((x) => {
    const n = typeof x === "number" ? x : Number.NaN;
    if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`no such ${what}`, 404);
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

type Done = { done: (number | string)[]; skipped: (number | string)[] };
const doneOf = (ids: number[], rows: { person_id: number }[]): Done => {
  const done = rows.map((r) => r.person_id);
  return { done, skipped: ids.filter((id) => !done.includes(id)) };
};
const listOf = (ids: number[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/**
 * Mark replies booked, or take marks back. One reply alone says why it failed; several answer
 * which were skipped. The work portal's meetings and bill follow at once; a miss is the loop's
 * next pass.
 */
async function booking(
  deps: PortalDeps,
  req: PortalRequest & { ids: number[] },
  booked: boolean,
): Promise<Done> {
  const ids = idsOf(req.ids, "reply");
  const now = new Date();
  const { client, out } = await write(deps, req, async (db, client, viewer) => {
    const profile = await readClientProfile(db);
    const out: Done = { done: [], skipped: [] };
    for (const threadEventId of ids) {
      try {
        const got = await markMeetingBooked(
          db,
          { threadEventId, booked, by: viewer.email, operator: viewer.operator === true },
          profile,
          now,
        );
        // Marked before keeps its first time, so only this call's marks are its to undo.
        const mine = booked ? got.bookedAt?.getTime() === now.getTime() : true;
        (mine ? out.done : out.skipped).push(threadEventId);
      } catch (err) {
        if (!(err instanceof HandoffRefusal)) throw err;
        if (ids.length === 1)
          throw new PortalRefusal(err.message, err.kind === "forbidden" ? 403 : 404);
        out.skipped.push(threadEventId);
      }
    }
    return { client, out };
  });
  if (out.done.length)
    await feedDelivery(deps.main, deps.open(client), client.id, settingsOf(client), now).catch(
      () => undefined,
    );
  return out;
}

/** The handlers as plain functions: the service wraps them, tests call them. */
export function portalApi(deps: PortalDeps) {
  return {
    overview: (req: PortalRequest): Promise<Overview> => read(deps, req, portalOverview),
    /** What each record type shows and lets this viewer filter, sort and search. */
    recordsTypes: async (req: PortalRequest): Promise<RecordMeta[]> => {
      const client = await pickClient(deps.main, req);
      return typesOf(client).map((t) => metaOf(t, client.demo));
    },
    recordsList: (req: PortalRequest & ListAsk): Promise<RecordsPage> =>
      records(deps, req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk): Promise<RecordAnswer> =>
      records(deps, req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk): Promise<RecordsCsv> =>
      records(deps, req, (r) => r.export(req)),
    /** One number for the Overview: this period, the one before, and a daily series. */
    recordsStats: (req: PortalRequest & StatsAsk): Promise<RecordsStat> =>
      records(deps, req, (r) => r.stats(req)),
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
        if (!masked(client, req))
          return portalWork(db, { step, subject, operator: seesInternal(req) });
        const shown = await demoMask(db, client);
        const work = await portalWork(db, { step, subject, operator: seesInternal(req), shown });
        return work && unlinkMasked(work, shown);
      });
      if (!view) throw new PortalRefusal("nothing kept for that line", 404);
      return view;
    },
    person: async (req: PortalRequest & { personId: number }): Promise<PersonView> => {
      const id = idOf(req.personId);
      const view = await read(deps, req, (db) => portalPerson(db, id));
      if (!view) throw new PortalRefusal("no such person on this list", 404);
      return view;
    },
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
    /** Send these: approve the drafts of the chosen emails. */
    approve: (req: PortalRequest & { ids: number[] }): Promise<ReviewResult> =>
      write(deps, req, (db, _, viewer) =>
        approveDrafts(
          db,
          { enrollmentIds: idsOf(req.ids) },
          viewer.operator ? "operator" : "client",
        ),
      ),
    /** Undo an approve, while none of the email has started sending. */
    unapprove: (req: PortalRequest & { ids: number[] }): Promise<ReviewResult> =>
      write(deps, req, (db) => unapproveDrafts(db, idsOf(req.ids))),
    /** Don't send these: the drafts are struck and that person is left alone. */
    skip: (req: PortalRequest & { ids: number[] }): Promise<ReviewResult> =>
      write(deps, req, (db, _, viewer) =>
        skipDrafts(db, { enrollmentIds: idsOf(req.ids) }, viewer.operator ? "operator" : "client"),
      ),
    /** A meeting came of these replies. Answers the ones it marked, so undo takes back only those. */
    book: (req: PortalRequest & { ids: number[] }) => booking(deps, req, true),
    /** Take a mark back: a client login only its own, since each mark is a meeting billed. */
    unbook: (req: PortalRequest & { ids: number[] }) => booking(deps, req, false),
    /** They called these people: Last contact reads now, and their history says who called. */
    called: (req: PortalRequest & { ids: number[] }): Promise<Done> => {
      const ids = idsOf(req.ids, "person");
      return write(deps, req, async (db, _, viewer) =>
        doneOf(
          ids,
          await db.execute<{ person_id: number }>(sql`
            insert into calls (person_id, called_by)
            select distinct person_id, lower(${viewer.email}) from crm_contacts
            where person_id in (${listOf(ids)}) returning person_id`),
        ),
      );
    },
    /** Take a mark back: each person's newest call from this login. */
    uncalled: (req: PortalRequest & { ids: number[] }): Promise<Done> => {
      const ids = idsOf(req.ids, "person");
      return write(deps, req, async (db, _, viewer) =>
        doneOf(
          ids,
          await db.execute<{ person_id: number }>(sql`
            delete from calls where id in (
              select max(id) from calls
              where person_id in (${listOf(ids)}) and called_by = lower(${viewer.email})
              group by person_id)
            returning person_id`),
        ),
      );
    },
    /**
     * Their sources disagree on where they work: go with the surest reading. Holds no more, and
     * the score says so now.
     */
    settle: (req: PortalRequest & { ids: number[] }): Promise<Done> => {
      const ids = idsOf(req.ids, "person");
      return write(deps, req, async (db, _, viewer) => {
        const rows = await db.execute<{ person_id: number }>(sql`
          insert into unit_holds (stage, subject, reason, until, released_at, released_by)
          select ${WHERE_STAGE}, 'person:' || p.id, 'Settled by hand', now(), now(),
            lower(${viewer.email})
          from people p where p.id in (${listOf(ids)}) and ${whereConflict(sql`p.id`)} is not null
          on conflict (stage, subject) do update
            set released_at = now(), released_by = excluded.released_by
          returning split_part(subject, ':', 2)::int person_id`);
        if (rows.length > 0) await scoreCrmContacts(db);
        return doneOf(ids, rows);
      });
    },
    /** Reword one of the profile lines the drafts are written from. */
    change: (req: PortalRequest & { ids: string[]; value?: string }): Promise<Done> =>
      write(deps, req, async (db) => {
        const id = EDITABLE.find(
          (e) => Array.isArray(req.ids) && req.ids.length === 1 && e === req.ids[0],
        );
        const field = id?.split(".")[1];
        const value = textOf(req.value)?.trim().slice(0, 4000);
        if (!id || !field) throw new PortalRefusal("only wording can change here", 404);
        if (!value) throw new PortalRefusal("say what it should be", 400);
        const p = await readClientProfile(db);
        if (!p) throw new PortalRefusal("no profile yet: Wren sets it up with you", 404);
        const { firm, sells, feeAvg, voice, recruiters, defaultRecruiter, signature } = p;
        await setClientProfile(db, {
          ...{ firm, sells, feeAvg, voice, recruiters, defaultRecruiter, signature },
          [field]: value,
        });
        return { done: [id], skipped: [] };
      }),
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
  RecordsStat,
  Row,
  StatsAsk,
} from "@wren/core/records/serve";
export type { ReviewResult } from "../approve.js";
export type { WhyLine } from "../compose.js";
/** What the answers look like, for the portal's web app. */
export type { RankedContact } from "../ranked.js";
export type { Reason } from "../score.js";
export type { EmailFilter, EmailRow, EmailStatus, EmailsPage } from "./outbox.js";
export type { Pipeline, PipelineStep, PipelineStepId, StepState } from "./pipeline.js";
export { PORTAL_ROUTES, PORTAL_WRITES } from "./routes.js";
export type { LiveRun, RunPage } from "./run.js";
export type { Story } from "./story.js";
export type { Now, Overview, PersonRow, PersonView, Source } from "./views.js";
export type { WorkFact, WorkIcon, WorkLink, WorkOption, WorkStep, WorkView } from "./work.js";

/**
 * No journal: a retry reads again, or writes again, and every write is
 * idempotent (a second approve finds nothing waiting). Pages stay out of
 * Restate's storage. Refusals are terminal, with the status the Worker returns.
 */
export function makeReactivationPortal(deps: PortalDeps) {
  const api = portalApi(deps);
  type Req<K extends keyof PortalApi> = Parameters<PortalApi[K]>[0];
  return portalService({
    name: "ReactivationPortal",
    main: deps.main,
    routes: PORTAL_ROUTES,
    apps: PORTAL_APPS,
    unnamed: "first",
    handlers: {
      overview: (_: restate.Context, req: Req<"overview">) => answer(() => api.overview(req)),
      recordsTypes: (_: restate.Context, req: Req<"recordsTypes">) =>
        answer(() => api.recordsTypes(req)),
      recordsList: (_: restate.Context, req: Req<"recordsList">) =>
        answer(() => api.recordsList(req)),
      recordsGet: (_: restate.Context, req: Req<"recordsGet">) => answer(() => api.recordsGet(req)),
      recordsExport: (_: restate.Context, req: Req<"recordsExport">) =>
        answer(() => api.recordsExport(req)),
      recordsStats: (_: restate.Context, req: Req<"recordsStats">) =>
        answer(() => api.recordsStats(req)),
      run: (_: restate.Context, req: Req<"run">) => answer(() => api.run(req)),
      work: (_: restate.Context, req: Req<"work">) => answer(() => api.work(req)),
      person: (_: restate.Context, req: Req<"person">) => answer(() => api.person(req)),
      emails: (_: restate.Context, req: Req<"emails">) => answer(() => api.emails(req)),
      approve: (_: restate.Context, req: Req<"approve">) => answer(() => api.approve(req)),
      unapprove: (_: restate.Context, req: Req<"unapprove">) => answer(() => api.unapprove(req)),
      skip: (_: restate.Context, req: Req<"skip">) => answer(() => api.skip(req)),
      book: (_: restate.Context, req: Req<"book">) => answer(() => api.book(req)),
      unbook: (_: restate.Context, req: Req<"unbook">) => answer(() => api.unbook(req)),
      change: (_: restate.Context, req: Req<"change">) => answer(() => api.change(req)),
      called: (_: restate.Context, req: Req<"called">) => answer(() => api.called(req)),
      uncalled: (_: restate.Context, req: Req<"uncalled">) => answer(() => api.uncalled(req)),
      settle: (_: restate.Context, req: Req<"settle">) => answer(() => api.settle(req)),
    },
  });
}
