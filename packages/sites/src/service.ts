/**
 * `Sites`: what the portal Worker asks for on `/o/*`, no sign-in (designs/2026-10-07-sites.md,
 * "Serving"). `serve` renders a live page or a draft behind its preview token; `serveForm` a
 * hosted form (designs/2026-10-07-forms-and-pay.md); `track` keeps a tracker event; `form` keeps
 * a submit and enters its page's or form's door on the spine as `form.submitted`.
 */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import { SPINE, type SpineService } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { z } from "zod";
import { consentVersion, formById, formOf, formToServe } from "./form-store.js";
import { checkEntry, consentOf, type FormSpec } from "./forms.js";
import { EVENT_NAMES, type EventName, formUrl, pageUrl, WREN_SITE } from "./model.js";
import { goneHtml, renderFormPage, renderPage } from "./render.js";
import type { SiteFormDef, SitePage } from "./schema.js";
import {
  doorFor,
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
import { DEFAULT_CONSENT } from "./templates/parts.js";
import type { Content } from "./templates/types.js";

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
const formAddressOf = (form: SiteFormDef, host: string | null) =>
  formUrl(host && HOST.test(host) ? host : WREN_SITE, form.slug);

/** The hosted form a page's `form` field names, when its owner has it live. */
async function sectionForm(
  main: Db,
  page: Pick<SitePage, "client">,
  c: Content,
): Promise<{ id: string; spec: FormSpec } | null> {
  const key = typeof c.form === "string" ? c.form.trim() : "";
  if (!key) return null;
  const f = await formOf(main, page.client, key);
  return f && f.status === "live" ? { id: f.id, spec: f.spec } : null;
}

const humanOf = (h: unknown): "yes" | "off" | null => (h === "yes" || h === "off" ? h : null);

export function sitesPublicApi(main: Db) {
  /**
   * A hosted form's submit, checked against its spec: kept with the consent words it showed, the
   * visitor and Turnstile's answer, then the payload for its door. A page it sits on rides along.
   */
  async function keepHosted(req: FormRequest): Promise<Kept | Answer> {
    const form = await formById(main, String(req.form ?? ""));
    if (!form || form.status !== "live")
      return { status: 404, error: "This form isn't taking answers." };
    const raw = (req.fields && typeof req.fields === "object" ? req.fields : {}) as Record<
      string,
      unknown
    >;
    if (typeof raw.website === "string" && raw.website.trim()) return { status: 202 };
    const { values, errors } = checkEntry(form.spec, raw);
    if (Object.keys(errors).length)
      return { status: 400, error: "Check the marked fields.", errors };
    const p = req.page ? await pageById(main, String(req.page)) : null;
    const page = p && p.status === "live" && p.client === form.client ? p : null;
    const words = consentOf(form.spec);
    const consent =
      words && values.sms_consent === "yes" ? { text: words, version: consentVersion(words) } : null;
    const kept = await keepForm(main, {
      page,
      form: form.id,
      view: req.view ?? null,
      fields: values,
      touch: req.touch,
      consent,
      visitor: req.visitor ?? null,
      human: humanOf(req.human),
    });
    const t = touchOf(req.touch);
    const hook = await doorFor(main, form);
    return {
      form: kept.id,
      hook,
      payload: {
        ...values,
        id: `sites:${kept.id}`,
        event: "form.submitted",
        source: "site",
        form: form.slug,
        form_id: form.id,
        page: page ? addressOf(page, req.host ?? null) : formAddressOf(form, req.host ?? null),
        ...(page ? { page_id: page.id, offer: page.offer, angle: page.angle } : {}),
        ...(consent ? { consent_text: consent.text, consent_version: consent.version } : {}),
        visitor: req.visitor ?? null,
        utm_source: t.source ?? values.utm_source ?? null,
        utm_medium: t.medium ?? values.utm_medium ?? null,
        utm_campaign: t.campaign ?? values.utm_campaign ?? null,
        utm_content: t.content ?? values.utm_content ?? null,
        ref: t.ref,
      },
    };
  }

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
            form: await sectionForm(main, d.page, d.content),
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
        html: renderPage(t, got.content, {
          page: got.page.id,
          base: "",
          track: true,
          form: await sectionForm(main, got.page, got.content),
        }),
      };
    },

    /** A live hosted form on its owner's host, by slug or id; `embed` drops the page chrome. */
    async serveForm(req: {
      client?: string | null;
      slug?: string;
      embed?: boolean | null;
    }): Promise<Served> {
      const client = req.client ?? null;
      if (client !== null && !CLIENT.test(client)) return { status: 404, html: goneHtml(404) };
      const got = await formToServe(main, client, String(req.slug ?? ""));
      if ("status" in got) return { status: got.status, html: goneHtml(got.status) };
      return {
        status: 200,
        html: renderFormPage(got.form.spec, { form: got.form.id, base: "", embed: !!req.embed }),
      };
    },

    /** One event from the kit. Unknown or retired pages and forms are dropped. */
    async track(req: {
      page?: string | null;
      form?: string | null;
      view?: string;
      name?: string;
      touch?: unknown;
      w?: number;
    }) {
      const name = String(req.name ?? "");
      if (!(EVENT_NAMES as readonly string[]).includes(name) || name === "form")
        return { kept: false };
      const kept = await recordEvent(main, {
        page: req.page ? String(req.page) : null,
        form: req.form ? String(req.form) : null,
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
      if (req.form) return keepHosted(req);
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
      const kept = await keepForm(main, {
        page,
        view: req.view ?? null,
        fields,
        touch: req.touch,
        consent:
          fields.sms_consent === "yes"
            ? { text: DEFAULT_CONSENT, version: consentVersion(DEFAULT_CONSENT) }
            : null,
        visitor: req.visitor ?? null,
        human: humanOf(req.human),
      });
      const hook = await doorOf(main, page);
      const t = touchOf(req.touch);
      return {
        form: kept.id,
        hook,
        payload: {
          ...fields,
          id: `sites:${kept.id}`,
          event: "form.submitted",
          source: "site",
          form: "page",
          page: addressOf(page, req.host ?? null),
          page_id: page.id,
          offer: page.offer,
          angle: page.angle,
          ...(fields.sms_consent === "yes"
            ? { consent_text: DEFAULT_CONSENT, consent_version: consentVersion(DEFAULT_CONSENT) }
            : {}),
          visitor: req.visitor ?? null,
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
  page?: string | null;
  /** A hosted form's id: checked against its spec. */
  form?: string | null;
  view?: string | null;
  fields?: unknown;
  touch?: unknown;
  host?: string | null;
  /** The `wv` cookie the Worker read, on Wren's own host. */
  visitor?: string | null;
  /** The Worker's Turnstile answer: `yes`, or `off` where no secret is set. */
  human?: string | null;
}
export interface Answer {
  status: number;
  error?: string;
  /** Per field, what's wrong: the kit marks each. */
  errors?: Record<string, string>;
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
const FORM = z.string().max(64).nullish().describe("A hosted form's id");

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
      serveForm: serviceHandler(
        {
          input: z.looseObject({
            client: z.string().max(40).nullish().describe("The host's client; null is Wren's"),
            slug: z.string().max(80),
            embed: z.boolean().nullish().describe("Drawn in a frame on another site"),
          }),
        },
        (_: restate.Context, req: Parameters<typeof api.serveForm>[0]) => api.serveForm(req),
      ),
      track: serviceHandler(
        {
          input: z.looseObject({
            page: PAGE.nullish(),
            form: FORM,
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
            page: PAGE.nullish(),
            form: FORM,
            view: z.string().max(64).nullish(),
            fields: z.record(z.string(), z.unknown()),
            touch: TOUCH,
            host: z.string().max(253).nullish(),
            visitor: z.string().max(64).nullish().describe("The wv cookie"),
            human: z.enum(["yes", "off"]).nullish().describe("Turnstile, checked at the edge"),
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
