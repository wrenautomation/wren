/**
 * Delivery as a Restate service on the worker, beside each product's portal
 * service: the edge Worker checks who is asking and passes the viewer, this
 * picks the client. Clients answer asks and decide deliverables; the rest is
 * Wren's team. The demo reads its sample and writes nothing.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  addMember,
  type Client,
  endSessions,
  isOwner,
  listMembers,
  MEMBER_ROLES,
  type MemberRole,
  normalEmail,
  removeMember,
} from "@wren/core/clients";
import {
  answer,
  clientsFor,
  isDemo,
  isOperator,
  type Me,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalMe,
  portalService,
  type SignedViewer,
  seesInternal,
  teamCan,
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
  type RecordsStat,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { type Db, type Queryable, serializable, setAuditActor } from "@wren/db";
import { type FileStore, newFileKey } from "./files.js";
import {
  addAsk,
  addComment,
  addDeliverable,
  agreementOf,
  answerAccess,
  answerAsk,
  boughtBy,
  type DeliveryHome,
  DeliveryRefusal,
  decideDeliverable,
  deliveryHome,
  type Engagement,
  engagementOf,
  hideUpdate,
  invoicesOf,
  mailLevelOf,
  markDone,
  postUpdate,
  recordInterest,
  recordPulse,
  recordResult,
  recordReview,
  setMailLevel,
  signAgreement,
  slipMilestone,
  startEngagement,
  storedFile,
  timeline,
  type UpdateView,
} from "./index.js";
import { deliveryRecords } from "./records.js";
import { DELIVERY_ROUTES, FILE_TYPES, MAX_FILE_BYTES } from "./routes.js";
import { DELIVERABLE_KINDS, type DeliverableKind, type MailLevel, type Terms } from "./schema.js";
import { type BoardRow, type DeliveryWatch, opsBoard, WATCH, WATCH_KEY } from "./watch.js";

export interface DeliveryDeps {
  /** The main database: the registry and the delivery schema. */
  main: Db;
  /** What the demo host calls its client. */
  demoName: string;
  /** The private bucket for client files; without it, uploads are refused. */
  files?: FileStore | undefined;
  /** DeliveryWatch runs here: an invite asks it for a pass, so the welcome goes now. */
  watched?: boolean;
  /** The fleet's clock, for the ops board's business days; UTC when unset. */
  zone?: string;
}

/** A browser can send anything: these turn it into what the domain takes, or refuse. */
const textOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;
const needText = (v: unknown, what: string): string => {
  const t = textOf(v);
  if (t === undefined) throw new PortalRefusal(`${what} is missing`, 400);
  return t;
};
const idOf = (v: unknown, what: string): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`no such ${what}`, 404);
  return n;
};
const maybeId = (v: unknown, what: string) =>
  v === undefined || v === null ? undefined : idOf(v, what);

/** Read as the viewer: an operator sees internal notes (unless looking as the client), a client never does. */
async function read<T>(
  deps: DeliveryDeps,
  req: PortalRequest,
  view: (db: Queryable, client: Client, operator: boolean) => Promise<T>,
): Promise<T> {
  const client = await pickClient(deps.main, req);
  return view(deps.main, client, seesInternal(req));
}

/** The projects in the asking app (`app`), as records this viewer may see: a client never reads a team note. */
type RecordsReq = PortalRequest & { app?: string };
const recordsOf = (db: Queryable, c: Client, operator: boolean, req: RecordsReq) =>
  deliveryRecords(
    db,
    c.id,
    operator,
    typeof req.app === "string" ? req.app : undefined,
    async () =>
      !isDemo(req.viewer) &&
      (operator ? teamCan(req, "money", c.id) : await isOwner(db, c.id, req.viewer.email)),
  );
const records = <T>(deps: DeliveryDeps, req: RecordsReq, use: (api: RecordsApi) => Promise<T>) =>
  read(deps, req, (db, c, operator) => use(serveRecords(recordsOf(db, c, operator, req), db)));

/**
 * A change in one transaction, logged as this person's. `team` writes are
 * Wren's only; `owner` writes are an owner's or Wren's. A domain refusal leaves
 * with its status.
 * ponytail: no journal, so a lost reply after commit retries the write (a
 * doubled update); add an idempotency key from the browser if that shows up.
 */
async function write<T>(
  deps: DeliveryDeps,
  req: PortalRequest,
  who: "client" | "owner" | "team",
  change: (db: Queryable, client: Client, viewer: SignedViewer) => Promise<T>,
): Promise<T> {
  const { client, viewer } = await pickForWrite(deps.main, req);
  if (who === "team" && !viewer.operator) throw new PortalRefusal("that's for Wren's team", 403);
  if (who === "owner" && !viewer.operator && !(await isOwner(deps.main, client.id, viewer.email)))
    throw new PortalRefusal("only an owner of this account can do that", 403);
  try {
    return await serializable(deps.main, async (tx) => {
      await setAuditActor(tx, viewer.email);
      return change(tx, client, viewer);
    });
  } catch (err) {
    if (err instanceof DeliveryRefusal) throw new PortalRefusal(err.message, err.status);
    throw err;
  }
}

/** A project always keeps an owner: someone has to be able to invite. */
async function keepAnOwner(db: Queryable, clientId: string, email: string) {
  const owners = (await listMembers(db, clientId)).filter((m) => m.role === "owner");
  if (owners.length === 1 && owners[0]?.email === email)
    throw new PortalRefusal("the last owner stays; make someone else an owner first", 409);
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailOf = (v: unknown): string => {
  const e = typeof v === "string" ? normalEmail(v) : "";
  if (!EMAIL.test(e) || e.length > 254) throw new PortalRefusal("that isn't an email", 400);
  return e;
};
const roleOf = (v: unknown): MemberRole => {
  if (v === undefined) return "member";
  if (!MEMBER_ROLES.includes(v as MemberRole))
    throw new PortalRefusal(`role is one of ${MEMBER_ROLES.join(", ")}`, 400);
  return v as MemberRole;
};

const storeOf = (deps: DeliveryDeps): FileStore => {
  if (!deps.files) throw new PortalRefusal("files aren't set up here", 409);
  return deps.files;
};

/** Someone who sees this client, for the account's People page. */
export interface MemberView {
  email: string;
  role: MemberRole;
  invitedBy: string | null;
  invitedAt: string;
  lastSeenAt: string | null;
}

/** The client's account page: who they are to us, what they bought, who's on it, billing at a glance. */
export interface AccountView {
  name: string;
  /** When they became a client. */
  since: string;
  you: { email: string | null; role: MemberRole | null; wren: boolean };
  bought: Awaited<ReturnType<typeof boughtBy>>;
  people: number;
  owners: string[];
  /** Owners and Wren only. */
  billing: { open: number; overdue: number } | null;
}

/** The contract as an owner reads it before signing. */
export interface ContractView {
  engagementId: number;
  version: string;
  body: string;
  /** Sent back on signing: proof it's this text that was signed. */
  sha256: string;
  terms: Terms;
  issuedAt: string;
  signed: { name: string; title: string | null; email: string; at: string } | null;
}

const kindOf = (url: unknown, fileKey: unknown): DeliverableKind =>
  fileKey
    ? "file"
    : /^https:\/\/(www\.)?loom\.com\//.test(String(url))
      ? "loom"
      : /^https:\/\/docs\.google\.com\//.test(String(url))
        ? "doc"
        : "link";

type EngagementReq = PortalRequest & { engagementId?: number };
const engagementFor = (db: Queryable, client: Client, req: EngagementReq): Promise<Engagement> =>
  engagementOf(db, client.id, maybeId(req.engagementId, "engagement"));

/** The handlers as plain functions: the service wraps them, tests call them. */
export function deliveryApi(deps: DeliveryDeps) {
  return {
    me: (req: PortalRequest): Promise<Me> => portalMe(deps.main, req.viewer, deps.demoName),
    /** Wren's ops board: every client, at risk first. */
    board: async (req: PortalRequest): Promise<BoardRow[]> => {
      if (!isOperator(req.viewer)) throw new PortalRefusal("that's for Wren's team", 403);
      const mine = new Set((await clientsFor(deps.main, req.viewer)).map((c) => c.id));
      const rows = await opsBoard(deps.main, deps.zone ?? "UTC", new Date());
      return rows.filter((r) => mine.has(r.clientId));
    },
    home: (req: PortalRequest): Promise<DeliveryHome> =>
      read(deps, req, (db, c, operator) =>
        deliveryHome(db, c.id, {
          operator,
          email: isDemo(req.viewer) ? null : normalEmail(req.viewer.email),
        }),
      ),
    /** What each record type shows and lets this viewer filter, sort and search. */
    recordsTypes: (req: RecordsReq): Promise<RecordMeta[]> =>
      read(deps, req, async (db, c, operator) =>
        recordsOf(db, c, operator, req).map((t) => metaOf(t, false)),
      ),
    recordsList: (req: RecordsReq & ListAsk): Promise<RecordsPage> =>
      records(deps, req, (r) => r.list(req)),
    recordsGet: (req: RecordsReq & GetAsk): Promise<RecordAnswer> =>
      records(deps, req, (r) => r.get(req)),
    recordsExport: (req: RecordsReq & ExportAsk): Promise<RecordsCsv> =>
      records(deps, req, (r) => r.export(req)),
    recordsStats: (req: RecordsReq & StatsAsk): Promise<RecordsStat> =>
      records(deps, req, (r) => r.stats(req)),
    updates: (
      req: EngagementReq & { before?: number },
    ): Promise<{ updates: UpdateView[]; more: boolean }> =>
      read(deps, req, (db, c, operator) => {
        const engagementId = maybeId(req.engagementId, "engagement");
        const before = maybeId(req.before, "update");
        return timeline(db, c.id, {
          operator,
          ...(engagementId === undefined ? {} : { engagementId }),
          ...(before === undefined ? {} : { before }),
        });
      }),

    /** The client answers an ask in place. */
    /** Text, a file from `upload`, or both. */
    answer: (req: PortalRequest & { askId: number; answer?: string; fileKey?: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const a = await answerAsk(db, c.id, {
          id: idOf(req.askId, "ask"),
          answer: textOf(req.answer),
          fileKey: textOf(req.fileKey),
          by: v.email,
        });
        return { id: a.id, answeredAt: a.answeredAt?.toISOString() ?? null };
      }),
    /** The client approves a deliverable, or asks for changes. */
    decide: (req: PortalRequest & { deliverableId: number; decision: string; note?: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        if (req.decision !== "approved" && req.decision !== "changes")
          throw new PortalRefusal("approve it or ask for changes", 400);
        const d = await decideDeliverable(db, c.id, {
          id: idOf(req.deliverableId, "deliverable"),
          decision: req.decision,
          note: textOf(req.note),
          by: v.email,
        });
        return { id: d.id, status: d.status };
      }),

    /** A line in the thread under an update or a deliverable, from either side. */
    comment: (req: PortalRequest & { updateId?: number; deliverableId?: number; body: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const made = await addComment(db, c.id, {
          on:
            req.deliverableId !== undefined
              ? { deliverableId: idOf(req.deliverableId, "deliverable") }
              : { updateId: idOf(req.updateId, "update") },
          body: needText(req.body, "the comment"),
          by: v.email,
          fromWren: v.operator === true,
        });
        return { id: made.id };
      }),

    start: (req: PortalRequest & { offerId: string; startsOn: string }) =>
      write(deps, req, "team", async (db, c, v) => {
        const e = await startEngagement(db, {
          clientId: c.id,
          offerId: needText(req.offerId, "the offer"),
          startsOn: needText(req.startsOn, "the start"),
          by: v.email,
        });
        return { id: e.id };
      }),
    post: (req: EngagementReq & { body: string; step?: string; internal?: boolean }) =>
      write(deps, req, "team", async (db, c, v) => {
        const u = await postUpdate(db, await engagementFor(db, c, req), {
          body: needText(req.body, "the update"),
          author: v.email,
          milestone: textOf(req.step),
          internal: req.internal === true,
        });
        return { id: u.id };
      }),
    deliver: (
      req: EngagementReq & {
        title: string;
        /** Left out: a file, a Loom, a Google doc, else a link, by what was given. */
        kind?: string;
        url?: string;
        fileKey?: string;
        step?: string;
        replaces?: number;
      },
    ) =>
      write(deps, req, "team", async (db, c, v) => {
        const kind = req.kind ?? kindOf(req.url, req.fileKey);
        if (!DELIVERABLE_KINDS.includes(kind as DeliverableKind))
          throw new PortalRefusal(`a deliverable is a ${DELIVERABLE_KINDS.join(", ")}`, 400);
        const replaces = maybeId(req.replaces, "deliverable");
        const d = await addDeliverable(db, await engagementFor(db, c, req), {
          title: needText(req.title, "the title"),
          kind: kind as DeliverableKind,
          url: textOf(req.url),
          fileKey: textOf(req.fileKey),
          milestone: textOf(req.step),
          replaces,
          by: v.email,
        });
        return { id: d.id, version: d.version };
      }),
    ask: (req: EngagementReq & { text: string; dueOn?: string; step?: string }) =>
      write(deps, req, "team", async (db, c, v) => {
        const a = await addAsk(db, await engagementFor(db, c, req), {
          text: needText(req.text, "the ask"),
          dueOn: textOf(req.dueOn),
          milestone: textOf(req.step),
          by: v.email,
        });
        return { id: a.id };
      }),
    done: (req: EngagementReq & { step: string; on?: string | null }) =>
      write(deps, req, "team", async (db, c) => {
        const m = await markDone(db, await engagementFor(db, c, req), {
          milestone: needText(req.step, "the step"),
          on: req.on === null ? null : (textOf(req.on) ?? new Date().toISOString().slice(0, 10)),
        });
        return { step: m.key, doneOn: m.doneOn };
      }),
    slip: (req: EngagementReq & { step: string; to: string; reason: string }) =>
      write(deps, req, "team", async (db, c) => {
        const m = await slipMilestone(db, await engagementFor(db, c, req), {
          milestone: needText(req.step, "the step"),
          to: needText(req.to, "the new date"),
          reason: needText(req.reason, "the reason"),
        });
        return { step: m.key, dueOn: m.dueOn };
      }),
    result: (req: EngagementReq & { key: string; value: number; note?: string }) =>
      write(deps, req, "team", async (db, c, v) => {
        if (typeof req.value !== "number") throw new PortalRefusal("the value isn't a number", 400);
        await recordResult(db, await engagementFor(db, c, req), {
          key: needText(req.key, "the measure"),
          value: req.value,
          note: textOf(req.note),
          by: v.email,
        });
        return { key: req.key, value: req.value };
      }),
    hide: (req: PortalRequest & { updateId: number }) =>
      write(deps, req, "team", async (db, c) => {
        await hideUpdate(db, c.id, idOf(req.updateId, "update"));
        return { hidden: true };
      }),
    /**
     * Where to PUT a file before it's handed over or answers an ask: anyone who
     * may write here, one type from the list, up to MAX_FILE_BYTES. The key goes
     * back in `deliver` or `answer`.
     * ponytail: a file uploaded and never attached stays; sweep `clients/` against
     * the rows if that piles up.
     */
    upload: async (req: PortalRequest & { name: string; type: string; size: number }) => {
      const files = storeOf(deps);
      const { client } = await pickForWrite(deps.main, req);
      const name = needText(req.name, "the file name");
      if (typeof req.type !== "string" || !Object.hasOwn(FILE_TYPES, req.type))
        throw new PortalRefusal(
          "that kind of file isn't taken; send a PDF, image, sheet or doc",
          400,
        );
      const size = Number(req.size);
      if (!Number.isSafeInteger(size) || size <= 0)
        throw new PortalRefusal("that file is empty", 400);
      if (size > MAX_FILE_BYTES)
        throw new PortalRefusal(`files go up to ${MAX_FILE_BYTES / 1024 / 1024} MB`, 400);
      const key = newFileKey(client.id, name);
      return { key, url: await files.putUrl(key, req.type, size) };
    },
    /** A download link for a deliverable's or an answer's file, good for minutes. */
    file: async (req: PortalRequest & { deliverableId?: number; askId?: number }) => {
      const files = storeOf(deps);
      const client = await pickClient(deps.main, req);
      const key = await storedFile(
        deps.main,
        client.id,
        req.deliverableId !== undefined
          ? { deliverableId: idOf(req.deliverableId, "deliverable") }
          : { askId: idOf(req.askId, "ask") },
      );
      if (!key) throw new PortalRefusal("no such file", 404);
      return { url: await files.getUrl(key) };
    },
    account: async (req: PortalRequest): Promise<AccountView> => {
      const client = await pickClient(deps.main, req);
      const viewer = req.viewer;
      const demo = isDemo(viewer);
      const rows = demo ? [] : await listMembers(deps.main, client.id);
      const me = isDemo(viewer) ? null : normalEmail(viewer.email);
      const role = rows.find((m) => m.email === me)?.role ?? null;
      const owed = (seesInternal(req) ? teamCan(req, "money", client.id) : role === "owner")
        ? await invoicesOf(deps.main, client.id)
        : null;
      return {
        name: demo ? deps.demoName : client.name,
        since: client.createdAt.toISOString(),
        you: { email: me, role, wren: isOperator(req.viewer) },
        bought: await boughtBy(deps.main, client.id),
        people: rows.length,
        owners: rows.filter((m) => m.role === "owner").map((m) => m.email),
        billing: owed && {
          open: owed.filter((i) => i.status === "open").length,
          overdue: owed.filter((i) => i.status === "overdue").length,
        },
      };
    },
    /** The contract's text and terms: the account's owners and Wren. */
    contract: async (req: EngagementReq): Promise<ContractView> => {
      const client = await pickClient(deps.main, req);
      const viewer = req.viewer;
      if (isDemo(viewer)) throw new PortalRefusal("no such contract", 404);
      if (!seesInternal(req) && !(await isOwner(deps.main, client.id, viewer.email)))
        throw new PortalRefusal("the contract is for this account's owners", 403);
      const a = await agreementOf(deps.main, await engagementFor(deps.main, client, req));
      if (!a) throw new PortalRefusal("this work started without a contract", 404);
      return {
        engagementId: a.engagementId,
        version: a.version,
        body: a.body,
        sha256: a.sha256,
        terms: a.terms,
        issuedAt: a.issuedAt.toISOString(),
        signed:
          a.signedAt && a.signerName && a.signerEmail
            ? {
                name: a.signerName,
                title: a.signerTitle,
                email: a.signerEmail,
                at: a.signedAt.toISOString(),
              }
            : null,
      };
    },
    /** An owner signs: typed name, the box ticked, and the fingerprint of the text they read. */
    sign: (
      req: EngagementReq & {
        sha256: string;
        name: string;
        title?: string;
        agreed: boolean;
        from?: { ip?: string | null; agent?: string | null };
      },
    ) =>
      write(deps, req, "owner", async (db, c, v) => {
        if (v.operator) throw new PortalRefusal("the client signs this, not Wren", 403);
        const a = await signAgreement(db, await engagementFor(db, c, req), {
          sha256: needText(req.sha256, "the contract's fingerprint"),
          name: needText(req.name, "your full name"),
          title: textOf(req.title),
          email: normalEmail(v.email),
          agreed: req.agreed === true,
          ip: textOf(req.from?.ip),
          agent: textOf(req.from?.agent),
        });
        return { signedAt: a.signedAt?.toISOString() ?? null };
      }),
    /** The client grants, declines or takes back access we asked for. */
    access: (req: PortalRequest & { accessId: number; status: string; note?: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const r = await answerAccess(db, c.id, {
          id: idOf(req.accessId, "access request"),
          status: String(req.status),
          note: textOf(req.note),
          by: v.email,
        });
        return { id: r.id, status: r.status };
      }),
    /** Who sees this client. The demo lists nobody: its members are real people. */
    people: async (
      req: PortalRequest,
    ): Promise<{ people: MemberView[]; canManage: boolean; mail: MailLevel | null }> => {
      const client = await pickClient(deps.main, req);
      if (isDemo(req.viewer)) return { people: [], canManage: false, mail: null };
      const rows = await listMembers(deps.main, client.id);
      const me = normalEmail(req.viewer.email);
      return {
        people: rows.map((m) => ({
          email: m.email,
          role: m.role,
          invitedBy: m.invitedBy,
          invitedAt: m.invitedAt.toISOString(),
          lastSeenAt: m.lastSeenAt?.toISOString() ?? null,
        })),
        canManage: seesInternal(req)
          ? teamCan(req, "manage", client.id)
          : rows.some((m) => m.email === me && m.role === "owner"),
        mail: rows.some((m) => m.email === me) ? await mailLevelOf(deps.main, client.id, me) : null,
      };
    },
    /** Let an email sign in and see this client; again changes their role. */
    invite: (req: PortalRequest & { email: string; role?: MemberRole }) =>
      write(deps, req, "owner", async (db, c, v) => {
        const email = emailOf(req.email);
        const role = roleOf(req.role);
        if (role !== "owner") await keepAnOwner(db, c.id, email);
        const was = (await listMembers(db, c.id)).find((m) => m.email === email)?.role;
        const m = await addMember(db, c.id, email, { role, invitedBy: v.email });
        // Demoted: signed out, so the next token carries the new role.
        if (was && MEMBER_ROLES.indexOf(role) > MEMBER_ROLES.indexOf(was))
          await endSessions(db, email);
        return { email: m.email, role: m.role };
      }),
    remove: (req: PortalRequest & { email: string }) =>
      write(deps, req, "owner", async (db, c) => {
        const email = emailOf(req.email);
        await keepAnOwner(db, c.id, email);
        if (!(await removeMember(db, c.id, email)))
          throw new PortalRefusal("they don't see this project", 404);
        await endSessions(db, email);
        return { removed: email };
      }),
    /** The client person's one tap for the week (D10). */
    pulse: (req: EngagementReq & { score: number; note?: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const email = await memberOnly(
          db,
          c.id,
          v.email,
          "the week is rated by the client's people",
        );
        const e = await engagementFor(db, c, req);
        await recordPulse(db, e, { email, score: Number(req.score), note: textOf(req.note) });
        return { score: Number(req.score) };
      }),
    /** A client person's review at a moment (D13); no score is "not now". */
    review: (
      req: EngagementReq & {
        moment: string;
        score?: number | null;
        words?: string;
        mayQuote?: string;
      },
    ) =>
      write(deps, req, "client", async (db, c, v) => {
        const email = await memberOnly(db, c.id, v.email, "reviews come from the client's people");
        const e = await engagementFor(db, c, req);
        const score = req.score === null || req.score === undefined ? null : Number(req.score);
        await recordReview(db, e, {
          email,
          moment: String(req.moment),
          score,
          words: textOf(req.words),
          mayQuote: textOf(req.mayQuote),
        });
        return { moment: String(req.moment), score };
      }),
    /** A client person wants to hear about a next offer (D13). */
    interest: (req: EngagementReq & { offerId: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const email = await memberOnly(db, c.id, v.email, "the client's people say what they want");
        const e = await engagementFor(db, c, req);
        await recordInterest(db, e, { email, offerId: String(req.offerId) });
        return { offerId: String(req.offerId) };
      }),
    /** What mail the viewer gets about this client (D9). */
    mail: (req: PortalRequest & { level: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const email = await memberOnly(
          db,
          c.id,
          v.email,
          "mail is set by each person for themselves",
        );
        return { level: await setMailLevel(db, c.id, email, String(req.level)) };
      }),
  };
}

/** The viewer's own email when they're one of this client's people; else 403 with why. */
async function memberOnly(db: Queryable, clientId: string, email: string, why: string) {
  const me = normalEmail(email);
  if (!(await listMembers(db, clientId)).some((m) => m.email === me))
    throw new PortalRefusal(why, 403);
  return me;
}

export type DeliveryApi = ReturnType<typeof deliveryApi>;
export type { Me } from "@wren/core/portal";
export type {
  AccessView,
  AskView,
  CommentView,
  DeliverableView,
  DeliveryHome,
  EngagementView,
  InvoiceView,
  MilestoneState,
  MomentView,
  NextView,
  PaperworkView,
  PulseView,
  ResultView,
  ReviewView,
  StepView,
  UpdateView,
} from "./index.js";
export { DELIVERY_ROUTES, DELIVERY_WRITES } from "./routes.js";
export type { MailLevel } from "./schema.js";
export {
  type BoardRow,
  type DeliveryWatch,
  makeDeliveryWatch,
  type PortalMail,
  WATCH,
  WATCH_KEY,
  type WatchDeps,
  type WatchStats,
} from "./watch.js";

/** No journal, like every portal service: pages stay out of Restate's storage. */
export function makeDeliveryPortal(deps: DeliveryDeps) {
  const api = deliveryApi(deps);
  type Req<K extends keyof DeliveryApi> = Parameters<DeliveryApi[K]>[0];
  return portalService({
    name: "DeliveryPortal",
    main: deps.main,
    routes: DELIVERY_ROUTES,
    unnamed: "first",
    handlers: {
      me: (_: restate.Context, req: Req<"me">) => answer(() => api.me(req)),
      board: (_: restate.Context, req: Req<"board">) => answer(() => api.board(req)),
      home: (_: restate.Context, req: Req<"home">) => answer(() => api.home(req)),
      recordsTypes: (_: restate.Context, req: Req<"recordsTypes">) =>
        answer(() => api.recordsTypes(req)),
      recordsList: (_: restate.Context, req: Req<"recordsList">) =>
        answer(() => api.recordsList(req)),
      recordsGet: (_: restate.Context, req: Req<"recordsGet">) => answer(() => api.recordsGet(req)),
      recordsExport: (_: restate.Context, req: Req<"recordsExport">) =>
        answer(() => api.recordsExport(req)),
      recordsStats: (_: restate.Context, req: Req<"recordsStats">) =>
        answer(() => api.recordsStats(req)),
      updates: (_: restate.Context, req: Req<"updates">) => answer(() => api.updates(req)),
      answer: (_: restate.Context, req: Req<"answer">) => answer(() => api.answer(req)),
      decide: (_: restate.Context, req: Req<"decide">) => answer(() => api.decide(req)),
      comment: (_: restate.Context, req: Req<"comment">) => answer(() => api.comment(req)),
      start: (_: restate.Context, req: Req<"start">) => answer(() => api.start(req)),
      post: (_: restate.Context, req: Req<"post">) => answer(() => api.post(req)),
      deliver: (_: restate.Context, req: Req<"deliver">) => answer(() => api.deliver(req)),
      ask: (_: restate.Context, req: Req<"ask">) => answer(() => api.ask(req)),
      done: (_: restate.Context, req: Req<"done">) => answer(() => api.done(req)),
      slip: (_: restate.Context, req: Req<"slip">) => answer(() => api.slip(req)),
      result: (_: restate.Context, req: Req<"result">) => answer(() => api.result(req)),
      hide: (_: restate.Context, req: Req<"hide">) => answer(() => api.hide(req)),
      account: (_: restate.Context, req: Req<"account">) => answer(() => api.account(req)),
      people: (_: restate.Context, req: Req<"people">) => answer(() => api.people(req)),
      contract: (_: restate.Context, req: Req<"contract">) => answer(() => api.contract(req)),
      sign: async (ctx: restate.Context, req: Req<"sign">) => {
        const out = await answer(() => api.sign(req));
        // The signed copy goes out by mail on the next pass: ask for it now.
        if (deps.watched) ctx.objectSendClient<DeliveryWatch>({ name: WATCH }, WATCH_KEY).sync();
        return out;
      },
      access: (_: restate.Context, req: Req<"access">) => answer(() => api.access(req)),
      invite: async (ctx: restate.Context, req: Req<"invite">) => {
        const out = await answer(() => api.invite(req));
        if (deps.watched) ctx.objectSendClient<DeliveryWatch>({ name: WATCH }, WATCH_KEY).sync();
        return out;
      },
      remove: (_: restate.Context, req: Req<"remove">) => answer(() => api.remove(req)),
      upload: (_: restate.Context, req: Req<"upload">) => answer(() => api.upload(req)),
      file: (_: restate.Context, req: Req<"file">) => answer(() => api.file(req)),
      pulse: (_: restate.Context, req: Req<"pulse">) => answer(() => api.pulse(req)),
      mail: (_: restate.Context, req: Req<"mail">) => answer(() => api.mail(req)),
      // Wren hears about a review or an interest on the next pass: ask for it now.
      review: async (ctx: restate.Context, req: Req<"review">) => {
        const out = await answer(() => api.review(req));
        if (deps.watched) ctx.objectSendClient<DeliveryWatch>({ name: WATCH }, WATCH_KEY).sync();
        return out;
      },
      interest: async (ctx: restate.Context, req: Req<"interest">) => {
        const out = await answer(() => api.interest(req));
        if (deps.watched) ctx.objectSendClient<DeliveryWatch>({ name: WATCH }, WATCH_KEY).sync();
        return out;
      },
    },
  });
}
