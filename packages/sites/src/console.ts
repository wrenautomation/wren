/**
 * SitesConsole: the portal's page manager (designs/2026-10-07-sites.md, "Portal"). New pages from
 * an offer and a template (Claude's draft through the facts guard, or the offer's own words),
 * copy saved as versions, publish through To approve, retire in bulk, duplicate as a variant,
 * code pages registered by URL. Every page lives in Wren's database; the owner's access decides.
 * Hosted forms (designs/2026-10-07-forms-and-pay.md) are made, built and published here too:
 * publish is direct, a form only collects.
 */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import { wrenFacts } from "@wren/core/facts";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { OFFER_IDS, OFFERS, offerFor } from "@wren/offers";
import { clients } from "@wren/core/clients";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { SITES_CONSOLE_APPS, SITES_CONSOLE_ROUTES } from "./console-routes.js";
import { type PageDetail, pageDetail } from "./detail.js";
import {
  createForm,
  type FormDetail,
  formById,
  formDetail,
  formsOf,
  saveForm,
  setFormStatus,
} from "./form-store.js";
import { draftCopy, type Write } from "./draft.js";
import { PAGE_KINDS, PAGE_STAGES, type PageKind, type PageStage } from "./model.js";
import { sitePages } from "./schema.js";
import {
  approvePage,
  askPublish,
  createDataPage,
  declinePage,
  duplicatePage,
  pageById,
  registerCodePage,
  retirePages,
  SitesRefusal,
  saveVersion,
  versionOf,
} from "./store.js";
import { TEMPLATE_IDS, templateOf } from "./templates/index.js";
import type { Content } from "./templates/types.js";

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;

/** A store refusal as the Worker passes it on; anything else is a bug and retries. */
function refusal(err: unknown): never {
  if (err instanceof SitesRefusal) throw new PortalRefusal(err.message, err.status);
  throw err;
}
const refused = <T>(p: Promise<T>) => p.catch(refusal);

/** The To approve item for a page's ask: `page:<id>:<version>`. */
export const pageApprovalId = (id: string, number: number) => `page:${id}:${number}`;
export function parsePageApprovalId(id: string): { id: string; number: number } | null {
  const m = /^page:([0-9a-f-]{36}):(\d{1,9})$/i.exec(id);
  return m?.[1] && m[2] ? { id: m[1], number: Number(m[2]) } : null;
}

export interface CreateRequest extends PortalRequest {
  offer: string;
  template?: string | null;
  title?: string | null;
  slug?: string | null;
  angle?: string | null;
  audience?: string | null;
  owner?: string | null;
  /** Claude writes the first draft; off, the offer's own words. */
  ai?: boolean | null;
}
export interface IdRequest extends PortalRequest {
  id: string;
}
export interface SaveRequest extends IdRequest {
  content: unknown;
  why?: string | null;
  expect?: number | null;
}
export interface AskRequest extends IdRequest {
  number?: number | null;
}
export interface IdsRequest extends PortalRequest {
  ids: string[];
}
export interface DuplicateRequest extends IdsRequest {
  angle?: string | null;
  audience?: string | null;
  title?: string | null;
}
export interface FormCreate {
  name?: string;
  slug?: string | null;
  spec?: unknown;
  owner?: string | null;
}
export interface AddRequest extends PortalRequest {
  url: string;
  repoPath?: string | null;
  title?: string | null;
  offer?: string | null;
  kind?: string | null;
  owner?: string | null;
}

/**
 * The handlers as plain calls, each checking its own access and throwing `PortalRefusal`: the
 * Restate service wraps them (writes journaled once), and the local preview calls them straight.
 * `write` is the model behind a Claude draft; null where none runs (the preview, tests).
 */
export function sitesApi(deps: { db: Db; write?: Write | null }) {
  const { db } = deps;
  const at = (owner: string | null) => ({ client: owner ?? WREN, app: "sites", channel: null });
  const may = async (req: PortalRequest, owner: string | null, p: "read" | "act") => {
    if (!(await canAt(db, req, p, at(owner))))
      throw new PortalRefusal(p === "read" ? "no access" : "your role can't do that here", 403);
  };
  /** A person's name on the change; the demo writes nothing. */
  const who = (req: PortalRequest) => {
    if (isDemo(req.viewer) || !by(req)) throw new PortalRefusal("sign in to change pages", 403);
    return by(req);
  };
  const pageFor = async (req: IdRequest, p: "read" | "act") => {
    const page = await pageById(db, String(req.id ?? ""));
    if (!page) throw new PortalRefusal("no such page", 404);
    await may(req, page.client, p);
    return page;
  };
  /** The owner a new page goes to: Wren unless the viewer names a client. */
  const ownerOf = (req: { owner?: string | null }) => {
    const o = req.owner?.trim();
    return !o || o === WREN ? null : o;
  };
  /** Each id the viewer may act on, refused whole if one isn't. */
  const actable = async (req: IdsRequest) => {
    const ids = [...new Set((req.ids ?? []).map(String))];
    if (!ids.length) throw new PortalRefusal("nothing picked", 404);
    const pages = await Promise.all(ids.map((id) => pageFor({ ...req, id }, "act")));
    return pages;
  };
  const factsFor = (owner: string | null) => (owner === null ? wrenFacts(db) : Promise.resolve([]));
  const formFor = async (req: IdRequest, p: "read" | "act") => {
    const form = await formById(db, String(req.id ?? ""));
    if (!form) throw new PortalRefusal("no such form", 404);
    await may(req, form.client, p);
    return form;
  };
  const formsTo = async (req: IdsRequest, status: "live" | "draft" | "retired") => {
    const name = who(req);
    const ids = [...new Set((req.ids ?? []).map(String))];
    if (!ids.length) throw new PortalRefusal("nothing picked", 404);
    for (const id of ids) await formFor({ ...req, id }, "act");
    const done = await setFormStatus(db, ids, status, name);
    return { done, changed: done.length };
  };
  /** The name a form's text consent gives: the client's, or Wren's. */
  const businessOf = async (owner: string | null) => {
    if (owner === null) return "Wren Automation";
    const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, owner));
    if (!c) throw new PortalRefusal("no such client", 404);
    return c.name;
  };

  return {
    /** The offers and templates a page starts from, for the New page form. */
    async offers(req: PortalRequest) {
      await may(req, null, "read");
      return {
        offers: OFFERS.filter((o) => o.status !== "retired").map((o) => ({
          id: o.id,
          name: o.name,
          status: o.status,
          audience: o.audience,
        })),
        templates: TEMPLATE_IDS.map((id) => {
          const t = templateOf(id);
          return { id, name: t.name, blurb: t.blurb };
        }),
        ai: !!deps.write,
      };
    },

    async detail(req: IdRequest): Promise<PageDetail> {
      await pageFor(req, "read");
      const d = await pageDetail(db, String(req.id));
      if (!d) throw new PortalRefusal("no such page", 404);
      return d;
    },

    /** A new data page from an offer: a draft, nothing live until a yes. */
    async create(req: CreateRequest) {
      const name = who(req);
      const owner = ownerOf(req);
      await may(req, owner, "act");
      if (!OFFER_IDS.has(String(req.offer ?? ""))) throw new PortalRefusal("no such offer", 404);
      const offer = offerFor(String(req.offer));
      const t = templateOf(req.template ?? "lander");
      const angle = req.angle?.trim() || null;
      const audience = req.audience?.trim() || null;
      const start = t.fill(offer, { angle, audience });
      let content: Content = start;
      let origin: "offer" | "ai" = "offer";
      let guard: { outcome: string; flags: string[] } | null = null;
      if (req.ai && deps.write) {
        const g = await draftCopy(deps.write, t, offer, {
          angle,
          audience,
          facts: await factsFor(owner),
          start,
        }).catch((err: unknown) => {
          // A model that fails leaves the offer's words: the page still gets made.
          guard = { outcome: "failed", flags: [err instanceof Error ? err.message : String(err)] };
          return null;
        });
        if (g) {
          guard = { outcome: g.outcome, flags: [...g.flags, ...g.still].map((f) => f.text) };
          if (g.text !== null) {
            content = g.result;
            origin = "ai";
          }
        }
      }
      const title =
        req.title?.trim() ||
        `${offer.name}${angle ? `: ${angle}` : ""}${t.id === "listicle" ? " (list)" : ""}`;
      const page = await refused(
        createDataPage(db, {
          client: owner,
          title,
          slug: req.slug ?? null,
          template: t.id,
          offer: offer.id,
          angle,
          audience,
          content,
          origin,
          why: origin === "ai" ? "Claude's draft from the offer" : "the offer's own words",
          by: name,
        }),
      );
      return { id: page.id, slug: page.slug, origin, guard };
    },

    /** The copy form's save: a new draft version, refused when someone saved since. */
    async save(req: SaveRequest) {
      const name = who(req);
      await pageFor(req, "act");
      const page = await refused(
        saveVersion(db, String(req.id), {
          content: req.content,
          origin: "edit",
          by: name,
          why: req.why ?? null,
          expect: req.expect ?? null,
        }),
      );
      return { id: page.id, draft: page.draftVersion };
    },

    /** Claude rewrites the draft from its offer, through the facts guard, as a new version. */
    async draft(req: IdRequest & { angle?: string | null }) {
      const name = who(req);
      const page = await pageFor(req, "act");
      if (!deps.write) throw new PortalRefusal("no model runs here", 503);
      if (page.source !== "data" || !page.offer || !OFFER_IDS.has(page.offer))
        throw new PortalRefusal("only a page made from an offer gets a Claude draft", 409);
      const t = templateOf(page.template);
      const v = page.draftVersion ? await versionOf(db, page.id, page.draftVersion) : null;
      const angle = req.angle?.trim() || page.angle;
      const offer = offerFor(page.offer);
      const g = await draftCopy(deps.write, t, offer, {
        angle,
        audience: page.audience,
        facts: await factsFor(page.client),
        start: v?.content ?? t.fill(offer, { angle, audience: page.audience }),
      });
      const flags = [...g.flags, ...g.still].map((f) => f.text);
      if (g.text === null) return { saved: null, outcome: g.outcome, flags };
      const out = await refused(
        saveVersion(db, page.id, {
          content: g.result,
          origin: "ai",
          by: name,
          why: angle ? `Claude's draft, angle: ${angle}` : "Claude's draft",
          expect: page.draftVersion,
        }),
      );
      return { saved: out.draftVersion, outcome: g.outcome, flags };
    },

    /** Ask for the draft (or a version) to go live: it waits in To approve. */
    async ask(req: AskRequest) {
      const name = who(req);
      await pageFor(req, "act");
      const page = await refused(
        askPublish(db, String(req.id), { by: name, number: req.number ?? null }),
      );
      return { id: page.id, waiting: page.waitingVersion };
    },

    /** To approve's yes: `page:<id>:<n>` ids, each still the version asked for. */
    async approve(req: IdsRequest) {
      const name = who(req);
      const asks = (req.ids ?? []).map((id) => parsePageApprovalId(String(id)));
      if (!asks.length || asks.some((a) => !a)) throw new PortalRefusal("nothing picked", 404);
      const done: string[] = [];
      for (const a of asks as { id: string; number: number }[]) {
        await pageFor({ ...req, id: a.id }, "act");
        const p = await refused(approvePage(db, a.id, a.number, name));
        done.push(p.id);
      }
      return { approved: done.length };
    },

    async decline(req: IdsRequest) {
      const name = who(req);
      const asks = (req.ids ?? []).map((id) => parsePageApprovalId(String(id)));
      if (!asks.length || asks.some((a) => !a)) throw new PortalRefusal("nothing picked", 404);
      let n = 0;
      for (const a of asks as { id: string; number: number }[]) {
        await pageFor({ ...req, id: a.id }, "act");
        if (await declinePage(db, a.id, a.number, name)) n++;
      }
      return { declined: n };
    },

    /** Take pages down at once: 410 at their URLs, numbers kept. */
    async retire(req: IdsRequest) {
      const name = who(req);
      const pages = await actable(req);
      const code = pages.filter((p) => p.source === "code");
      const done = await retirePages(
        db,
        pages.map((p) => p.id),
        name,
      );
      return {
        retired: done.length,
        // A code page's URL keeps answering until its own deploy takes it down.
        note: code.length
          ? "Code pages are marked retired here. Take them down in their repo."
          : null,
      };
    },

    /** A variant of each page: its draft copied to a new draft, a new angle when given. */
    async duplicate(req: DuplicateRequest) {
      const name = who(req);
      const pages = await actable(req);
      const made: { id: string; slug: string }[] = [];
      for (const p of pages) {
        const v = await refused(
          duplicatePage(db, p.id, {
            by: name,
            title: pages.length === 1 ? (req.title ?? null) : null,
            angle: req.angle ?? null,
            audience: req.audience ?? null,
          }),
        );
        made.push({ id: v.id, slug: v.slug });
      }
      return { made };
    },

    /** A code page by its URL: added, or its facts updated when it's known. */
    async add(req: AddRequest) {
      const name = who(req);
      const owner = ownerOf(req);
      await may(req, owner, "act");
      if (req.offer && !OFFER_IDS.has(req.offer)) throw new PortalRefusal("no such offer", 404);
      const kind =
        req.kind && (PAGE_KINDS as readonly string[]).includes(req.kind)
          ? (req.kind as PageKind)
          : undefined;
      const got = await refused(
        registerCodePage(db, {
          client: owner,
          url: String(req.url ?? ""),
          ...(req.repoPath !== undefined ? { repoPath: req.repoPath } : {}),
          ...(req.title !== undefined ? { title: req.title } : {}),
          ...(req.offer !== undefined ? { offer: req.offer } : {}),
          ...(kind ? { kind } : {}),
          by: name,
        }),
      );
      return { id: got.page.id, added: got.added };
    },

    /** A new hosted form, a draft: the default fields, or the spec given. */
    async formCreate(req: PortalRequest & FormCreate) {
      const name = who(req);
      const owner = ownerOf(req);
      await may(req, owner, "act");
      const form = await refused(
        createForm(db, {
          client: owner,
          name: String(req.name ?? ""),
          slug: req.slug ?? null,
          spec: req.spec ?? null,
          business: await businessOf(owner),
          by: name,
        }),
      );
      return { id: form.id, slug: form.slug };
    },

    /** A form's builder: its spec, URL, embed snippets and numbers per day and source. */
    async formDetail(req: IdRequest): Promise<FormDetail> {
      await formFor(req, "read");
      const d = await formDetail(db, String(req.id));
      if (!d) throw new PortalRefusal("no such form", 404);
      return d;
    },

    /** The builder's save: the whole spec, checked. Live forms change on the next load. */
    async formSave(req: IdRequest & { spec?: unknown; name?: string | null }) {
      const name = who(req);
      await formFor(req, "act");
      const form = await refused(
        saveForm(db, { id: String(req.id), spec: req.spec, name: req.name ?? null, by: name }),
      );
      return { id: form.id, status: form.status };
    },

    /** Make forms live at once: no To approve, a form only collects. */
    formPublish: (req: IdsRequest) => formsTo(req, "live"),
    /** Take forms back to draft: their URLs answer not found until published again. */
    formUnpublish: (req: IdsRequest) => formsTo(req, "draft"),
    /** Take forms down: their URLs answer gone, their numbers and submissions stay. */
    formRetire: (req: IdsRequest) => formsTo(req, "retired"),

    /** An owner's forms, for a page's form section. */
    async forms(req: PortalRequest & { owner?: string | null }) {
      const owner = ownerOf(req);
      await may(req, owner, "read");
      return { forms: await formsOf(db, owner) };
    },

    /** The page's notes, its stage and angle: what the team keeps about it. */
    async notes(
      req: IdRequest & { notes?: string | null; stage?: string | null; angle?: string | null },
    ) {
      const name = who(req);
      await pageFor(req, "act");
      const stage =
        req.stage && (PAGE_STAGES as readonly string[]).includes(req.stage)
          ? (req.stage as PageStage)
          : undefined;
      await db
        .update(sitePages)
        .set({
          ...(req.notes !== undefined ? { notes: req.notes?.trim().slice(0, 4000) || null } : {}),
          ...(req.angle !== undefined ? { angle: req.angle?.trim().slice(0, 120) || null } : {}),
          ...(stage ? { stage } : {}),
          updatedAt: sql`now()`,
          updatedBy: name,
        })
        .where(eq(sitePages.id, String(req.id)));
      return { ok: true };
    },
  };
}

const ID = z.string().max(64).describe("The page's id");
const WHY = z.string().max(500).nullish().describe("One line: why");
const IDS = z.array(z.string().max(80)).max(200);
const FORM_ID = z.string().max(64).describe("The form's id");
const OWNER = z.string().max(40).nullish().describe("The client it's for; Wren's when left out");

/** The Restate service. */
export function makeSitesConsole(deps: { db: Db; write?: Write | null }) {
  const api = sitesApi(deps);
  /** A read: not journaled, read again on a retry. */
  const read =
    <R extends PortalRequest, T>(fn: (req: R) => Promise<T>) =>
    (_: restate.Context, req: R) =>
      answer(() => fn(req));
  /** A write: journaled once, so a retry returns the same answer and never writes twice. */
  const write =
    <R extends PortalRequest, T>(name: string, fn: (req: R) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  const P = PORTAL_FIELDS;
  return portalService({
    name: "SitesConsole",
    main: deps.db,
    routes: SITES_CONSOLE_ROUTES,
    apps: SITES_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      offers: serviceHandler({ input: z.looseObject(P) }, read(api.offers)),
      detail: serviceHandler({ input: z.looseObject({ ...P, id: ID }) }, read(api.detail)),
      create: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            offer: z.string().max(64).describe("The offer's id"),
            template: z.enum(TEMPLATE_IDS as [string, ...string[]]).nullish(),
            title: z.string().max(200).nullish(),
            slug: z.string().max(80).nullish(),
            angle: z.string().max(120).nullish(),
            audience: z.string().max(120).nullish(),
            owner: OWNER,
            ai: z.boolean().nullish().describe("Claude writes the first draft"),
          }),
        },
        write("create", api.create),
      ),
      save: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            id: ID,
            content: z.record(z.string(), z.unknown()),
            why: WHY,
            expect: z.number().int().nullish().describe("The draft opened"),
          }),
        },
        write("save", api.save),
      ),
      draft: serviceHandler(
        { input: z.looseObject({ ...P, id: ID, angle: z.string().max(120).nullish() }) },
        write("draft", api.draft),
      ),
      ask: serviceHandler(
        { input: z.looseObject({ ...P, id: ID, number: z.number().int().nullish() }) },
        write("ask", api.ask),
      ),
      approve: serviceHandler(
        { input: z.looseObject({ ...P, ids: IDS }) },
        write("approve", api.approve),
      ),
      decline: serviceHandler(
        { input: z.looseObject({ ...P, ids: IDS }) },
        write("decline", api.decline),
      ),
      retire: serviceHandler(
        { input: z.looseObject({ ...P, ids: IDS }) },
        write("retire", api.retire),
      ),
      duplicate: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            ids: IDS,
            angle: z.string().max(120).nullish(),
            audience: z.string().max(120).nullish(),
            title: z.string().max(200).nullish(),
          }),
        },
        write("duplicate", api.duplicate),
      ),
      add: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            url: z.string().max(500),
            repoPath: z.string().max(300).nullish(),
            title: z.string().max(200).nullish(),
            offer: z.string().max(64).nullish(),
            kind: z.string().max(12).nullish(),
            owner: OWNER,
          }),
        },
        write("add", api.add),
      ),
      formCreate: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            name: z.string().max(200),
            slug: z.string().max(80).nullish(),
            spec: z.record(z.string(), z.unknown()).nullish().describe("The fields; default when left out"),
            owner: OWNER,
          }),
        },
        write("formCreate", api.formCreate),
      ),
      formDetail: serviceHandler(
        { input: z.looseObject({ ...P, id: FORM_ID }) },
        read(api.formDetail),
      ),
      formSave: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            id: FORM_ID,
            spec: z.record(z.string(), z.unknown()),
            name: z.string().max(200).nullish(),
          }),
        },
        write("formSave", api.formSave),
      ),
      formPublish: serviceHandler(
        { input: z.looseObject({ ...P, ids: IDS }) },
        write("formPublish", api.formPublish),
      ),
      formUnpublish: serviceHandler(
        { input: z.looseObject({ ...P, ids: IDS }) },
        write("formUnpublish", api.formUnpublish),
      ),
      formRetire: serviceHandler(
        { input: z.looseObject({ ...P, ids: IDS }) },
        write("formRetire", api.formRetire),
      ),
      forms: serviceHandler({ input: z.looseObject({ ...P, owner: OWNER }) }, read(api.forms)),
      notes: serviceHandler(
        {
          input: z.looseObject({
            ...P,
            id: ID,
            notes: z.string().max(4000).nullish(),
            stage: z.string().max(8).nullish(),
            angle: z.string().max(120).nullish(),
          }),
        },
        write("notes", api.notes),
      ),
    },
  });
}
