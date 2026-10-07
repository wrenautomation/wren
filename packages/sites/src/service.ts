/**
 * `Sites`: what the portal Worker asks for on `/o/*`, no sign-in (designs/2026-10-07-sites.md,
 * "Serving"). `serve` renders a live page or a draft behind its preview token; `track` keeps a
 * tracker event; `form` keeps a form and enters its page's door on the spine.
 */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import { SPINE, type SpineService } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { z } from "zod";
import { EVENT_NAMES, type EventName, pageUrl, WREN_SITE } from "./model.js";
import { goneHtml, renderPage } from "./render.js";
import type { SitePage } from "./schema.js";
import {
  doorOf,
  draftToPreview,
  formFieldsOf,
  keepForm,
  markForm,
  pageById,
  pageToServe,
  recordEvent,
  touchOf,
} from "./store.js";
import { templateOf } from "./templates/index.js";

export interface Served {
  status: 200 | 404 | 410;
  html: string;
}

/** Enters a form's payload through a hook: the spine's `door`, or nothing where none runs. */
export type EnterDoor = (
  hook: string,
  payload: Record<string, unknown>,
) => Promise<{ status: number; error?: string }>;

const HOST = /^[a-z0-9.-]{1,253}$/;
const CLIENT = /^[a-z][a-z0-9_]{0,39}$/;

/** Where a page is, as a lead's `page` field says it. */
const addressOf = (page: SitePage, host: string | null) =>
  page.url ?? pageUrl(host && HOST.test(host) ? host : WREN_SITE, page.slug);

export function sitesPublicApi(main: Db) {
  return {
    /** A live page on its owner's host, or a draft by its preview token. */
    async serve(req: {
      client?: string | null;
      slug?: string;
      preview?: { id: string; token: string } | null;
    }): Promise<Served> {
      if (req.preview) {
        const d = await draftToPreview(main, String(req.preview.id), String(req.preview.token));
        if (!d) return { status: 404, html: goneHtml(404) };
        const t = templateOf(d.page.template);
        return {
          status: 200,
          html: renderPage(t, d.content, {
            page: d.page.id,
            base: "",
            track: false,
            banner: `Draft preview, version ${d.number}. Not live.`,
          }),
        };
      }
      const client = req.client ?? null;
      if (client !== null && !CLIENT.test(client)) return { status: 404, html: goneHtml(404) };
      const got = await pageToServe(main, client, String(req.slug ?? ""));
      if ("status" in got) return { status: got.status, html: goneHtml(got.status) };
      const t = templateOf(got.page.template);
      return {
        status: 200,
        html: renderPage(t, got.content, { page: got.page.id, base: "", track: true }),
      };
    },

    /** One event from the kit. Unknown or retired pages are dropped. */
    async track(req: { page?: string; view?: string; name?: string; touch?: unknown; w?: number }) {
      const name = String(req.name ?? "");
      if (!(EVENT_NAMES as readonly string[]).includes(name) || name === "form")
        return { kept: false };
      const kept = await recordEvent(main, {
        page: String(req.page ?? ""),
        view: String(req.view ?? ""),
        name: name as EventName,
        touch: req.touch,
        width: typeof req.w === "number" ? req.w : null,
      });
      return { kept };
    },

    /**
     * A form from the kit or a plain post, kept and counted. Answers the payload for the page's
     * door, or the answer for the browser when there's nothing to enter. A filled trap field is
     * a bot: answered as sent, kept nowhere.
     */
    async keep(req: FormRequest): Promise<Kept | Answer> {
      const page = await pageById(main, String(req.page ?? ""));
      if (!page || page.status !== "live")
        return { status: 404, error: "This page isn't taking forms." };
      const raw = (req.fields && typeof req.fields === "object" ? req.fields : {}) as Record<
        string,
        unknown
      >;
      if (typeof raw.website === "string" && raw.website.trim()) return { status: 202 };
      const fields = formFieldsOf(raw);
      if (!fields.email && !fields.phone)
        return { status: 400, error: "Add an email or a phone number." };
      const kept = await keepForm(main, { page, view: req.view ?? null, fields, touch: req.touch });
      const hook = await doorOf(main, page);
      const t = touchOf(req.touch);
      return {
        form: kept.id,
        hook,
        payload: {
          ...fields,
          id: `sites:${kept.id}`,
          source: "site",
          form: "page",
          page: addressOf(page, req.host ?? null),
          page_id: page.id,
          offer: page.offer,
          angle: page.angle,
          utm_source: t.source,
          utm_medium: t.medium,
          utm_campaign: t.campaign,
          utm_content: t.content,
          ref: t.ref,
        },
      };
    },

    /** Whether the form got through its door. */
    async mark(form: string, res: Answer | null) {
      const ok = !!res && res.status >= 200 && res.status < 300;
      const why = !res
        ? "no door for this page's owner"
        : ok
          ? null
          : (res.error ?? `door answered ${res.status}`).slice(0, 300);
      await markForm(main, form, ok, why);
    },

    /** Keep, enter, mark: the whole form outside Restate (the preview, tests). */
    async form(req: FormRequest, enter: EnterDoor): Promise<Answer> {
      const k = await this.keep(req);
      if (!("form" in k)) return k;
      const res = k.hook ? await enter(k.hook, k.payload).catch(failed) : null;
      await this.mark(k.form, res);
      // The lead is kept either way: a door that refused is the team's to fix, not the visitor's.
      return { status: 202 };
    },
  };
}

export interface FormRequest {
  page?: string;
  view?: string | null;
  fields?: unknown;
  touch?: unknown;
  host?: string | null;
}
export interface Answer {
  status: number;
  error?: string;
}
interface Kept {
  form: string;
  hook: string | null;
  payload: Record<string, unknown>;
}
const failed = (err: unknown): Answer => ({
  status: 500,
  error: err instanceof Error ? err.message : String(err),
});

const TOUCH = z
  .looseObject({
    source: z.string().nullish(),
    medium: z.string().nullish(),
    campaign: z.string().nullish(),
    content: z.string().nullish(),
    ref: z.string().nullish(),
  })
  .nullish()
  .describe("The utm and referrer the visit arrived on");
const PAGE = z.string().max(64).describe("The page's id");

export const SITES = { name: "Sites" } as const;

/** The Restate service. Public: the Worker calls it for anyone's browser. */
export function makeSites(deps: { main: Db }) {
  const api = sitesPublicApi(deps.main);
  return restate.service({
    name: SITES.name,
    handlers: {
      serve: serviceHandler(
        {
          input: z.looseObject({
            client: z.string().max(40).nullish().describe("The host's client; null is Wren's"),
            slug: z.string().max(80).optional(),
            preview: z.object({ id: PAGE, token: z.string().max(64) }).nullish(),
          }),
        },
        (_: restate.Context, req: Parameters<typeof api.serve>[0]) => api.serve(req),
      ),
      track: serviceHandler(
        {
          input: z.looseObject({
            page: PAGE,
            view: z.string().max(64).optional(),
            name: z.string().max(8),
            touch: TOUCH,
            w: z.number().optional(),
          }),
        },
        (_: restate.Context, req: Parameters<typeof api.track>[0]) => api.track(req),
      ),
      // Kept once (journaled), then the spine's door: a Restate call of its own, then marked.
      form: serviceHandler(
        {
          input: z.looseObject({
            page: PAGE,
            view: z.string().max(64).nullish(),
            fields: z.record(z.string(), z.unknown()),
            touch: TOUCH,
            host: z.string().max(253).nullish(),
          }),
        },
        async (ctx: restate.Context, req: FormRequest): Promise<Answer> => {
          const k = await ctx.run("keep", () => api.keep(req));
          if (!("form" in k)) return k;
          const res = k.hook
            ? await ctx
                .serviceClient<SpineService>(SPINE)
                .door({ hook: k.hook, payload: k.payload })
                .catch(failed)
            : null;
          await ctx.run("mark", () => api.mark(k.form, res));
          return { status: 202 };
        },
      ),
    },
  });
}
