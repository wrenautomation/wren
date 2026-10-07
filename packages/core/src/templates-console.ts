/**
 * TemplatesConsole: the Library's template browser (designs/2026-10-07-templates-live-copy.md).
 * Lists and opens templates, previews words for the made-up lead, and writes through the store:
 * save (compare-and-swap on the version opened), publish, approve, decline, restore, reset,
 * move. Every write checks `act` at the template's own app and channel (`templateAt`). Publishing
 * copy that sends waits in To approve; only a signed-in person approves. Wren's own database.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { z } from "zod";
import { type Target, WREN } from "./access.js";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  portalService,
  type SignedViewer,
} from "./portal.js";
import { PORTAL_FIELDS, serviceHandler } from "./restate/form.js";
import { AuthoringError } from "./slots/parse.js";
import { LIBRARY_EDITS, sampleOf, WORDS_MAX } from "./template-edits.js";
import { namedParts } from "./template-labels.js";
import {
  approve,
  askPublish,
  decline,
  listTemplates,
  moveTemplate,
  openedOf,
  parseRef,
  renameFolder,
  reset,
  restore,
  SENDS,
  saveDraft,
  TemplateConflict,
  type TemplateRef,
  TemplateRefusal,
  type TemplateState,
  templateState,
  type VersionHead,
  versionsOf,
} from "./templates.js";
import { TEMPLATES_CONSOLE_APPS, TEMPLATES_CONSOLE_ROUTES } from "./templates-console-routes.js";

/** The app a prompt's words belong to, by the package that asks it. */
const PROMPT_APPS: Readonly<Record<string, string>> = {
  reactivation: "reactivation",
  content: "marketing",
};

/**
 * Where a template's words work, for the access check: email to Outbound, texts to Texts, DMs
 * (LinkedIn reach) and posts to Marketing, a prompt to the app that asks it.
 */
export function templateAt(ref: Pick<TemplateRef, "kind" | "system">): Target {
  switch (ref.kind) {
    case "email":
      return { client: WREN, app: "outbound", channel: "email" };
    case "sms":
      return { client: WREN, app: "texts", channel: "sms" };
    case "dm":
      return { client: WREN, app: "marketing", channel: "linkedin" };
    case "post":
      return { client: WREN, app: "marketing", channel: null };
    case "prompt":
      return { client: WREN, app: PROMPT_APPS[ref.system] ?? "library", channel: null };
  }
}

/** The To approve item for a template's ask: its row id and the version waiting. */
export const approvalId = (templateId: number, number: number) =>
  `template:${templateId}:${number}`;

export function parseApprovalId(id: string): { templateId: number; number: number } | null {
  const m = /^template:(\d{1,12}):(\d{1,9})$/.exec(id);
  return m ? { templateId: Number(m[1]), number: Number(m[2]) } : null;
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;

/** A store refusal as the Worker passes it on; anything else is a bug and retries. */
function refusal(err: unknown): never {
  if (err instanceof TemplateRefusal) throw new PortalRefusal(err.message, 409);
  if (err instanceof AuthoringError) throw new PortalRefusal(err.message, 400);
  throw err;
}

/** A version as the browser shows it. */
const head = (v: VersionHead | null) =>
  v
    ? { number: v.number, source: v.source, origin: v.origin, by: v.by, at: v.at.toISOString() }
    : null;

const stateView = (s: TemplateState) => ({
  id: s.id,
  ref: `${s.kind}:${s.system}/${s.name}`,
  kind: s.kind,
  system: s.system,
  name: s.name,
  folder: s.folder,
  status: s.status,
  followsDefault: s.followsDefault,
  live: head(s.live),
  draft: head(s.draft),
  waiting: head(s.waiting),
  waitingBy: s.waitingBy,
  newestDefault: head(s.newestDefault),
  opened: openedOf(s)?.number ?? null,
  editable: LIBRARY_EDITS.has(s.kind),
  sends: SENDS.has(s.kind),
});
export type TemplateView = ReturnType<typeof stateView>;

const REF = z.string().max(200).describe("<kind>:<system>/<name>");
const WHY = z.string().max(500).nullish().describe("One line: why");

export interface RefRequest extends PortalRequest {
  ref: string;
}
export interface SaveRequest extends RefRequest {
  words: string;
  why?: string | null;
  expect: number | null;
}
export interface NumberRequest extends RefRequest {
  number?: number | null;
  why?: string | null;
  expect?: number | null;
}
export interface IdsRequest extends PortalRequest {
  ids: string[];
}

/**
 * The handlers as plain calls, each checking its own access and throwing `PortalRefusal`: the
 * Restate service wraps them (writes journaled once), and the local preview calls them straight.
 */
export function templatesApi(deps: { db: Db }) {
  const { db } = deps;
  /** The ref, once the viewer may `p` at its app and channel. */
  const refFor = async (req: RefRequest, p: "read" | "act") => {
    let ref: TemplateRef;
    try {
      ref = parseRef(String(req.ref ?? ""));
    } catch (err) {
      throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
    }
    if (!(await canAt(db, req, p, templateAt(ref))))
      throw new PortalRefusal(p === "read" ? "no access" : "your role can't do that here", 403);
    return ref;
  };
  const writable = async (req: RefRequest) => {
    const ref = await refFor(req, "act");
    if (!LIBRARY_EDITS.has(ref.kind))
      throw new PortalRefusal(
        "Texts and DMs save on their copy pages in Marketing, which hold each one's rules.",
        409,
      );
    return ref;
  };
  const stateOf = async (ref: TemplateRef) => {
    const s = await templateState(db, ref);
    if (!s) throw new PortalRefusal("no such template", 404);
    return stateView(s);
  };
  /** The asks a person approves or declines, each still the one they saw. */
  const asksOf = async (req: IdsRequest) => {
    if (isDemo(req.viewer) || !by(req)) throw new PortalRefusal("only a person approves", 403);
    const ids = (req.ids ?? []).map((id) => parseApprovalId(String(id)));
    if (!ids.length || ids.some((x) => !x)) throw new PortalRefusal("nothing picked", 404);
    const rows = await listTemplates(db);
    return Promise.all(
      (ids as { templateId: number; number: number }[]).map(async ({ templateId, number }) => {
        const row = rows.find((r) => r.id === templateId);
        if (!row) throw new PortalRefusal("no such template", 404);
        const ref = { kind: row.kind, system: row.system, name: row.name };
        if (!(await canAt(db, req, "act", templateAt(ref))))
          throw new PortalRefusal("your role can't do that here", 403);
        return { ref, number };
      }),
    );
  };
  /** A save's answer: the new state, or the version there now when the one opened moved. */
  const casOf = async (fn: () => Promise<TemplateState>) => {
    try {
      return { saved: stateView(await fn()), conflict: null };
    } catch (err) {
      if (err instanceof TemplateConflict) return { saved: null, conflict: head(err.current) };
      return refusal(err);
    }
  };

  return {
    /**
     * Every template the viewer may read, by folder then name, with its status, and the parts
     * with their own label (a niche's "SEC RIA"), so the page names folders as the server does.
     */
    async list(req: PortalRequest) {
      const out = [];
      for (const r of await listTemplates(db))
        if (await canAt(db, req, "read", templateAt(r)))
          out.push({
            ...r,
            ref: `${r.kind}:${r.system}/${r.name}`,
            app: templateAt(r).app as string,
            at: r.at?.toISOString() ?? null,
            editable: LIBRARY_EDITS.has(r.kind),
          });
      return { templates: out, labels: namedParts() };
    },
    /** One template: where it stands, every version with its words, and whether it may be edited. */
    async detail(req: RefRequest) {
      const ref = await refFor(req, "read");
      const versions = (await versionsOf(db, ref)).map((v) => ({
        ...(head(v) as NonNullable<ReturnType<typeof head>>),
        why: v.why,
        openedFrom: v.openedFrom,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        publishedBy: v.publishedBy,
      }));
      return {
        ...(await stateOf(ref)),
        versions,
        mayAct: await canAt(db, req, "act", templateAt(ref)),
      };
    },
    /** Words with the made-up lead in them, or why they don't render. Nothing is kept. */
    async preview(req: RefRequest & { words: string }) {
      const ref = await refFor(req, "read");
      return sampleOf(ref.kind, ref.name, String(req.words ?? ""));
    },
    /**
     * Keep the words as the next version and make it the draft. `expect` is the version the
     * editor opened (null for an empty one); when it moved, nothing is kept and the answer is
     * the version there now, so the editor can show the diff and offer reload or save on top.
     */
    async save(req: SaveRequest) {
      const ref = await writable(req);
      return casOf(() =>
        saveDraft(db, ref, String(req.words ?? ""), {
          by: by(req),
          why: req.why ?? null,
          expect: req.expect ?? null,
        }),
      );
    },
    /**
     * Ask for the draft (or version `number`) to go live: a prompt goes live now; copy that
     * sends waits in To approve for a person's yes.
     */
    async publish(req: NumberRequest) {
      const ref = await writable(req);
      return stateView(
        await askPublish(db, ref, {
          by: by(req),
          ...(req.number ? { number: req.number } : {}),
          why: req.why ?? null,
        }).catch(refusal),
      );
    },
    /** A person's yes on To approve items (`template:<id>:<number>`): each goes live. */
    async approve(req: IdsRequest) {
      const done: string[] = [];
      for (const a of await asksOf(req)) {
        const s = await approve(db, a.ref, { by: by(req), number: a.number }).catch((err) => {
          if (err instanceof TemplateConflict)
            throw new PortalRefusal("A newer version waits now. Open it again.", 409);
          return refusal(err);
        });
        done.push(approvalId(s.id, a.number));
      }
      return { done };
    },
    /** A person's no: the ask goes away, the version stays in history. */
    async decline(req: IdsRequest) {
      const done: string[] = [];
      for (const a of await asksOf(req)) {
        const s = await templateState(db, a.ref);
        if (s?.waiting?.number !== a.number) continue;
        await decline(db, a.ref, { by: by(req) }).catch(refusal);
        done.push(approvalId(s.id, a.number));
      }
      return { done };
    },
    /** A new draft copying version `number`; nothing is overwritten. */
    async restore(req: NumberRequest) {
      const ref = await writable(req);
      return casOf(() =>
        restore(db, ref, Number(req.number), {
          by: by(req),
          why: req.why ?? null,
          ...(req.expect !== undefined ? { expect: req.expect } : {}),
        }),
      );
    },
    /** Follow the default again: Wren's own words go live now. */
    async reset(req: RefRequest & { why?: string | null }) {
      const ref = await writable(req);
      return stateView(
        await reset(db, ref, { by: by(req), why: req.why || "reset to default" }).catch(refusal),
      );
    },
    /** Move one template to a folder; its ref, and every send, stay. */
    async move(req: RefRequest & { folder: string }) {
      const ref = await refFor(req, "act");
      await moveTemplate(db, ref, String(req.folder ?? ""), by(req)).catch(refusal);
      return stateOf(ref);
    },
    /** Rename a folder: everything in or under it moves along. */
    async renameFolder(req: PortalRequest & { from: string; to: string }) {
      return {
        moved: await renameFolder(db, String(req.from ?? ""), String(req.to ?? ""), by(req)).catch(
          refusal,
        ),
      };
    },
  };
}
export type TemplatesApi = ReturnType<typeof templatesApi>;
/** A row of the Library's browser. */
export type TemplateListRow = Awaited<ReturnType<TemplatesApi["list"]>>["templates"][number];
/** An open template: its state, every version with its words, and whether the viewer may act. */
export type TemplateOpen = Awaited<ReturnType<TemplatesApi["detail"]>>;
/** A save's or restore's answer. */
export type TemplateSaved = Awaited<ReturnType<TemplatesApi["save"]>>;

const NUMBER = z.number().int().positive();

export function makeTemplatesConsole(deps: { db: Db }) {
  const api = templatesApi(deps);
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
  const ids = z.looseObject({ ...PORTAL_FIELDS, ids: z.array(z.string()) });
  return portalService({
    name: "TemplatesConsole",
    main: deps.db,
    routes: TEMPLATES_CONSOLE_ROUTES,
    apps: TEMPLATES_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      list: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, read(api.list)),
      detail: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ref: REF }) },
        read(api.detail),
      ),
      preview: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ref: REF, words: z.string().max(WORDS_MAX) }) },
        read(api.preview),
      ),
      save: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ref: REF,
            words: z.string().max(WORDS_MAX),
            why: WHY,
            expect: z.number().int().nullable().describe("The version opened, null for none"),
          }),
        },
        write("save", api.save),
      ),
      publish: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ref: REF,
            number: NUMBER.nullish().describe("A version; the draft when left out"),
            why: WHY,
          }),
        },
        write("publish", api.publish),
      ),
      approve: serviceHandler({ input: ids }, write("approve", api.approve)),
      decline: serviceHandler({ input: ids }, write("decline", api.decline)),
      restore: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ref: REF,
            number: NUMBER,
            why: WHY,
            expect: z.number().int().nullish(),
          }),
        },
        write("restore", api.restore),
      ),
      reset: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ref: REF, why: WHY }) },
        write("reset", api.reset),
      ),
      move: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ref: REF, folder: z.string().max(200) }) },
        write("move", api.move),
      ),
      renameFolder: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            from: z.string().max(200),
            to: z.string().max(200),
          }),
        },
        write("rename", api.renameFolder),
      ),
    },
  });
}
