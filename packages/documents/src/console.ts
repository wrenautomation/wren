/**
 * DocumentsConsole: the portal's Documents and Templates pages, Texts' "Send estimate" and To
 * approve's yes and no (designs/2026-10-09-documents.md, "Portal").
 *
 * - `records*`: a client's documents and templates, on the main database, kept to that client.
 *   The starters are added the first time a client's types are listed.
 * - `create`, `update`, `duplicate`: drafts. A sent one never changes; a duplicate does.
 * - `send`: the slots filled and checked, the text frozen. Whoever may approve for the client
 *   sends it now; anyone else's waits in To approve.
 * - `approve`, `decline`: To approve's yes and no, checked against the client's approver.
 * - `remind`: the same message again with a new link. `void`: the link stops working.
 * - `templateSave`, `templateArchive`: the client's templates.
 */
import type * as restate from "@restatedev/restate-sdk";
import { toPhoneE164 } from "@wren/channel-sms";
import { smsContacts } from "@wren/channel-sms/schema";
import { mayApprove } from "@wren/core/access";
import { type Client, findClient } from "@wren/core/clients";
import { customFacts } from "@wren/core/custom-fields";
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
} from "@wren/core/portal";
import { metaOf } from "@wren/core/records";
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
} from "@wren/core/records/serve";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { snapshot } from "@wren/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { DOCUMENTS_CONSOLE_APPS, DOCUMENTS_CONSOLE_ROUTES } from "./console-routes.js";
import { docPdf } from "./pdf.js";
import { documentRecordFor, templateRecordFor } from "./records.js";
import type { Doc, DocChannel, DocTemplate } from "./schema.js";
import { docs, docTemplates } from "./schema.js";
import {
  DOCUMENTS_SERVICE,
  type DocumentsDeps,
  type DocumentsService,
  WREN_CLIENT,
} from "./service.js";
import {
  approveDocs,
  archiveTemplates,
  askSend,
  declineDocs,
  docEventsOf,
  docIdOf,
  docOf,
  duplicateDoc,
  editDoc,
  ensureStarters,
  makeDoc,
  remindable,
  saveTemplate,
  sendBlocker,
  UUID,
  voidDocs,
} from "./store.js";

export type DocumentsConsoleDeps = Pick<DocumentsDeps, "main" | "open">;

/** What a new document or a draft's change may carry. */
export interface DocFields {
  template?: string | null;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  lines?: unknown;
  depositPct?: number | string | null;
  expiresDays?: number | string | null;
  name?: string | null;
  email?: string | null;
  /** A number with a texting thread; the thread decides `contact`. */
  phone?: string | null;
  /** A texting thread's id, as the Texts record shows it. */
  contact?: number | string | null;
  channel?: string | null;
}
export interface CreateRequest extends PortalRequest, DocFields {}
export interface UpdateRequest extends PortalRequest, DocFields {
  id: string;
}
export interface IdRequest extends PortalRequest {
  id: string;
}
export interface IdsRequest extends PortalRequest {
  ids: string[];
}
export interface TemplateRequest extends PortalRequest {
  id?: string | null;
  kind?: string | null;
  name?: string | null;
  body?: string | null;
  lines?: unknown;
  depositPct?: number | string | null;
  expiresDays?: number | string | null;
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const NOT_YOURS = { wren: "Wren's team approves these", client: "the client approves these" };

const given = <T>(v: T | undefined) => (v === undefined ? undefined : v);

/** The facts a client's documents may quote: its business facts and its name. */
export async function factsOf(main: Db, client: Pick<Client, "id" | "name">) {
  return {
    ...(await customFacts(main, client.id === WREN_CLIENT ? null : client.id)),
    "biz.name": client.name,
  };
}

/** The handlers as plain calls: the service wraps them, tests and the preview call them. */
export function documentsConsoleApi(deps: DocumentsConsoleDeps) {
  const { main, open } = deps;
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await pickClient(main, req);
    return snapshot(main, (tx) =>
      use(
        serveRecords(
          [documentRecordFor(client.id), templateRecordFor(client.id)],
          tx,
          undefined,
          fenceFor(req, client.id),
          meOf(req),
        ),
      ),
    );
  };
  /** May this viewer say yes for the client: its `approver` decides. */
  const approves = async (req: PortalRequest, client: Client) => {
    const v = req.viewer;
    const who =
      !isDemo(v) && !v.access && !v.operator ? await whoIs(main, v, client.id) : accessOf(req);
    return mayApprove(who, client.id, client.approver);
  };
  const may = async (req: PortalRequest, client: Client) => {
    if (!(await canAt(main, req, "act", { client: client.id, app: "documents" })))
      throw new PortalRefusal("your role can't do that here", 403);
  };
  /** The thread a phone or an id names, in the client's database, with its name and email. */
  const threadOf = async (client: Client, f: DocFields) => {
    const db = open(client);
    if (f.contact !== undefined && f.contact !== null && f.contact !== "") {
      const id = Number(f.contact);
      if (!Number.isSafeInteger(id) || id <= 0) throw new PortalRefusal("no such thread", 404);
      const [c] = await db
        .select({ id: smsContacts.id, name: smsContacts.name, email: smsContacts.email })
        .from(smsContacts)
        .where(eq(smsContacts.id, id));
      if (!c) throw new PortalRefusal("no such thread", 404);
      return c;
    }
    if (typeof f.phone === "string" && f.phone.trim()) {
      const e164 = toPhoneE164(f.phone);
      if (!e164) throw new PortalRefusal("type a phone number, or send it by email", 400);
      const [c] = await db
        .select({ id: smsContacts.id, name: smsContacts.name, email: smsContacts.email })
        .from(smsContacts)
        .where(eq(smsContacts.e164, e164))
        .limit(1);
      if (!c) throw new PortalRefusal("no texting thread with that number: start from Texts", 404);
      return c;
    }
    return null;
  };
  const channelOf = (v: unknown): DocChannel | null => (v === "sms" || v === "email" ? v : null);

  return {
    recordsTypes: async (req: PortalRequest) => {
      const client = await pickClient(main, req);
      if (!client.demo && !isDemo(req.viewer)) await ensureStarters(main, client.id, "wren");
      const fence = fenceFor(req, client.id);
      return [documentRecordFor(client.id), templateRecordFor(client.id)]
        .filter((t) => !fence || opens(t, fence(t)))
        .map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),

    /** The New document picker: the client's templates, and whether this viewer approves. */
    templates: async (req: PortalRequest) => {
      const client = await pickClient(main, req);
      const rows: DocTemplate[] = await main
        .select()
        .from(docTemplates)
        .where(and(eq(docTemplates.client, client.id), isNull(docTemplates.archivedAt)))
        .orderBy(docTemplates.kind, docTemplates.name);
      return {
        templates: rows.map((t) => ({
          id: t.id,
          kind: t.kind,
          name: t.name,
          body: t.body,
          lines: t.lines,
          depositPct: t.depositPct,
          expiresDays: t.expiresDays,
        })),
        approves: await approves(req, client),
      };
    },

    /** A new draft: from a template or blank, to an email or a texting thread. */
    create: async (req: CreateRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      const thread = await threadOf(client, req);
      const email = (typeof req.email === "string" && req.email.trim()) || thread?.email || null;
      const doc = await makeDoc(main, {
        client: client.id,
        template: req.template || null,
        kind: req.kind,
        title: given(req.title ?? undefined),
        body: given(req.body ?? undefined),
        lines: req.lines === null ? undefined : req.lines,
        depositPct: given(req.depositPct ?? undefined),
        expiresDays: given(req.expiresDays ?? undefined),
        name: (typeof req.name === "string" && req.name.trim()) || thread?.name || null,
        email,
        contact: thread?.id ?? null,
        channel: channelOf(req.channel) ?? (thread && !req.email ? "sms" : null),
        facts: await factsOf(main, client),
        by: viewer.email,
        now,
      });
      return { doc: brief(doc) };
    },

    /** A change to a draft. */
    update: async (req: UpdateRequest, now: Date) => {
      const { client } = await pickForWrite(main, req);
      const thread =
        req.phone !== undefined || req.contact !== undefined
          ? await threadOf(client, req)
          : undefined;
      const doc = await editDoc(
        main,
        client.id,
        String(req.id),
        {
          title: req.title ?? undefined,
          body: req.body ?? undefined,
          lines: req.lines === null ? undefined : req.lines,
          depositPct: req.depositPct === undefined ? undefined : req.depositPct,
          expiresDays: req.expiresDays ?? undefined,
          name: req.name === undefined ? undefined : req.name,
          email: req.email === undefined ? undefined : req.email,
          contact: thread === undefined ? undefined : (thread?.id ?? null),
          channel: req.channel ?? undefined,
        },
        now,
      );
      return { doc: brief(doc) };
    },

    /** Send asked: on its way now when this viewer approves, else To approve. */
    send: async (req: IdRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      const doc = await askSend(main, client.id, String(req.id), {
        facts: await factsOf(main, client),
        by: viewer.email,
        approved: await approves(req, client),
        now,
      });
      return { docs: [doc] };
    },

    /** To approve's yes: `doc:<id>` or bare ids, each checked against its own client. */
    approve: async (req: IdsRequest, now: Date) => {
      const ids = await decidable(req);
      return { docs: await approveDocs(main, ids, by(req), now) };
    },
    decline: async (req: IdsRequest, now: Date) => {
      const ids = await decidable(req);
      return { done: await declineDocs(main, ids, by(req), now) };
    },

    void: async (req: IdsRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      const ids = (Array.isArray(req.ids) ? req.ids : []).map((x) => docIdOf(String(x)));
      return { done: await voidDocs(main, client.id, ids, viewer.email, now) };
    },

    /** A reminder may go: checked here, sent by `Documents/send`. */
    remind: async (req: IdRequest, now: Date) => {
      const { client } = await pickForWrite(main, req);
      const d = await docOf(main, client.id, String(req.id));
      const no = remindable(d, now);
      if (no) throw new PortalRefusal(no, 409);
      return { id: d.id };
    },

    duplicate: async (req: IdRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      return {
        doc: brief(await duplicateDoc(main, client.id, String(req.id), viewer.email, now)),
      };
    },

    /** The document as a PDF: the signed copy once signed. */
    pdf: async (req: IdRequest) => {
      const client = await pickClient(main, req);
      const d = await docOf(main, client.id, String(req.id));
      const bytes = await docPdf(d, await docEventsOf(main, d.id), client.name);
      return {
        name: `${d.number}${d.status === "signed" ? "-signed" : ""}.pdf`,
        base64: Buffer.from(bytes).toString("base64"),
      };
    },

    templateSave: async (req: TemplateRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      const t = await saveTemplate(main, client.id, req, viewer.email, now);
      return { template: { id: t.id, name: t.name, kind: t.kind } };
    },
    templateArchive: async (req: IdsRequest, now: Date) => {
      const { client } = await pickForWrite(main, req);
      return { done: await archiveTemplates(main, client.id, (req.ids ?? []).map(String), now) };
    },
  };

  /** The ids this viewer may decide on: every one's client checked, the act and the approver. */
  async function decidable(req: IdsRequest): Promise<string[]> {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    const asked = (Array.isArray(req.ids) ? req.ids : []).map((x) => docIdOf(String(x)));
    const ids = asked.filter((id) => UUID.test(id));
    if (!ids.length || ids.length > 500) throw new PortalRefusal("pick a document first", 400);
    const rows = await main
      .select({ id: docs.id, client: docs.client })
      .from(docs)
      .where(inArray(docs.id, ids));
    for (const owner of new Set(rows.map((r) => r.client))) {
      const client = await findClient(main, owner);
      if (!client || client.demo) throw new PortalRefusal("the demo is read-only", 403);
      await may(req, client);
      if (!(await approves(req, client)))
        throw new PortalRefusal(NOT_YOURS[client.approver === "client" ? "client" : "wren"], 403);
    }
    return rows.map((r) => r.id);
  }
}

/** What a write answers: enough for the page to move on. */
const brief = (d: Doc) => ({
  id: d.id,
  number: d.number,
  status: d.status,
  blocked: d.status === "draft" ? sendBlocker(d) : null,
});

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };
const ID = {
  input: z.looseObject({ ...PORTAL_FIELDS, id: z.string().describe("The document's id") }),
};
const IDS = {
  input: z.looseObject({
    ...PORTAL_FIELDS,
    ids: z.array(z.string()).describe("The documents' ids, or To approve's doc:<id>"),
  }),
};
const LINE = z.looseObject({
  name: z.string().describe("What it is"),
  detail: z.string().nullish(),
  qty: z.union([z.number(), z.string()]).nullish().describe("How many; 1 when left out"),
  price: z.union([z.number(), z.string()]).nullish().describe("Dollars each, as 49.00"),
  unit_cents: z.number().int().nullish().describe("Or cents each"),
  tax_pct: z.union([z.number(), z.string()]).nullish().describe("Tax percent on this line"),
});
const FIELDS = {
  title: z.string().max(200).nullish().describe("The title the signer sees"),
  body: z.string().max(50_000).nullish().describe("The words: # and ## headings, - lists, {slots}"),
  lines: z.array(LINE).max(50).nullish().describe("Line items"),
  depositPct: z.union([z.number(), z.string()]).nullish().describe("Deposit on signing, percent"),
  expiresDays: z.union([z.number(), z.string()]).nullish().describe("Days the link stays open"),
  name: z.string().max(200).nullish().describe("Who it's for"),
  email: z.string().max(200).nullish().describe("Where the email goes"),
  phone: z.string().max(40).nullish().describe("A number with a texting thread"),
  contact: z.union([z.number(), z.string()]).nullish().describe("A texting thread's id"),
  channel: z.enum(["sms", "email"]).nullish().describe("Text or email"),
};

export function makeDocumentsConsole(deps: DocumentsConsoleDeps) {
  const api = documentsConsoleApi(deps);
  /** Approved documents go to `Documents/send` once the change is journaled. */
  const sendAll = (
    ctx: restate.Context,
    list: readonly Pick<Doc, "id" | "status">[],
    who: string,
  ) => {
    for (const d of list)
      if (d.status === "sending")
        ctx.serviceSendClient<DocumentsService>(DOCUMENTS_SERVICE).send({ id: d.id, by: who });
  };
  const now = async (ctx: restate.Context) => new Date(await ctx.date.now());
  const plain = (d: Doc) => ({ id: d.id, status: d.status });
  const call =
    <R extends PortalRequest, T>(step: string, f: (req: R, at: Date) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(async () => {
        const at = await now(ctx);
        return ctx.run(step, () => answer(() => f(req, at)));
      });
  return portalService({
    name: "DocumentsConsole",
    main: deps.main,
    routes: DOCUMENTS_CONSOLE_ROUTES,
    apps: DOCUMENTS_CONSOLE_APPS,
    unnamed: "first",
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
      templates: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.templates(req)),
      ),
      /** A new draft from a template or blank. */
      create: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ...FIELDS,
            template: z.string().nullish().describe("The template's id"),
            kind: z
              .enum(["contract", "proposal", "estimate"])
              .nullish()
              .describe("Without a template"),
          }),
        },
        call("create", api.create),
      ),
      /** A change to a draft; a sent one is duplicated instead. */
      update: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ...FIELDS, id: z.string() }) },
        call("update", api.update),
      ),
      /** Send: on its way when the asker approves, else To approve. */
      send: serviceHandler({ ...ID, effect: "sends" }, (ctx: restate.Context, req: IdRequest) =>
        answer(async () => {
          const at = await now(ctx);
          const { docs: list } = await ctx.run("send", () => answer(() => api.send(req, at)));
          const [d] = list;
          if (d?.status !== "sending") return { docs: list.map(plain), url: null };
          // Sent now, so the link can be shown once: only its hash is kept.
          const out = await ctx
            .serviceClient<DocumentsService>(DOCUMENTS_SERVICE)
            .send({ id: d.id, by: by(req) });
          return {
            docs: [{ id: d.id, status: out.sent ? "sent" : "failed" }],
            url: out.url,
            why: out.sent ? null : (out.why ?? null),
          };
        }),
      ),
      approve: serviceHandler(
        { ...IDS, effect: "sends" },
        (ctx: restate.Context, req: IdsRequest) =>
          answer(async () => {
            const at = await now(ctx);
            const { docs: list } = await ctx.run("approve", () =>
              answer(() => api.approve(req, at)),
            );
            sendAll(ctx, list, by(req));
            return { done: list.map((d) => d.id) };
          }),
      ),
      decline: serviceHandler(IDS, call("decline", api.decline)),
      void: serviceHandler(IDS, call("void", api.void)),
      /** The same message again with a new link: the old one stops working. */
      remind: serviceHandler({ ...ID, effect: "sends" }, (ctx: restate.Context, req: IdRequest) =>
        answer(async () => {
          const at = await now(ctx);
          const { id } = await ctx.run("remind", () => answer(() => api.remind(req, at)));
          ctx
            .serviceSendClient<DocumentsService>(DOCUMENTS_SERVICE)
            .send({ id, remind: true, by: by(req) });
          return { id };
        }),
      ),
      duplicate: serviceHandler(ID, call("duplicate", api.duplicate)),
      pdf: serviceHandler(ID, (_: restate.Context, req: IdRequest) => answer(() => api.pdf(req))),
      templateSave: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: z.string().nullish().describe("The template to change; none: a new one"),
            kind: z.enum(["contract", "proposal", "estimate"]).nullish(),
            name: z.string().max(120).nullish(),
            body: FIELDS.body,
            lines: FIELDS.lines,
            depositPct: FIELDS.depositPct,
            expiresDays: FIELDS.expiresDays,
          }),
        },
        call("template", api.templateSave),
      ),
      templateArchive: serviceHandler(IDS, call("archive", api.templateArchive)),
    },
  });
}
export type DocumentsConsoleService = ReturnType<typeof makeDocumentsConsole>;
