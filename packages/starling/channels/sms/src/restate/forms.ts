/**
 * `SmsForms`: a site application, pushed. The lander posts each one to the phone Worker, which
 * checks its signature and calls `applied` here (keyed by the application, so a repeat is one
 * call). That runs the form step now (form.ts): the run and contact are recorded, and the first
 * text is queued when it's due, else `first` is sent to run again at that moment. A queued text
 * wakes the sender at commit, and `email` follows a few minutes later; with no text (a number in
 * a country form texts skip, a landline), `email` goes two minutes after they applied. `check`
 * looks 10 minutes after the text was due and sends the one notice if none went (form-after.ts).
 *
 * SmsWatch's 30-minute pass does the same for anything a push missed, so a lost push costs
 * minutes, not the applicant.
 */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  FIRST_TEXT_AFTER_MS,
  FORM_WORKFLOW,
  type FormApplication,
  type FormOptions,
  type FormOutcome,
  formStep,
  formSubject,
  readApplication,
  type SiteSource,
} from "../form.js";
import {
  type AfterOptions,
  EMAIL_AFTER_MS,
  type EmailOutcome,
  formEmail,
  NOTICE_AFTER_MS,
  noTextNotice,
} from "../form-after.js";
import { speedRuns } from "../schema.js";
import type { SmsDeps } from "./index.js";

export const FORMS_SERVICE = { name: "SmsForms" } as const;
/** A step that couldn't tell (a lookup, the booking check, a mail send) tries again this soon. */
const AGAIN_MS = 5 * 60 * 1000;
/** Then the pass takes over. */
const MAX_TRIES = 6;

/** The form step's options from the worker's deps. */
export function formOptionsOf(
  deps: SmsDeps,
  site: SiteSource,
  now: Date,
  runId: string | null,
): FormOptions {
  return {
    site,
    bookings: deps.bookings ?? null,
    sequences: deps.sequences,
    policy: deps.policy,
    provider: deps.provider,
    senderName: deps.senderName,
    heldNiches: deps.heldNiches,
    ...(deps.formCountries ? { countries: deps.formCountries } : {}),
    now,
    runId,
  };
}

/** What runs after the text: the email and the notice. */
export function afterOptionsOf(deps: SmsDeps, now: Date): AfterOptions {
  return {
    send: deps.formMail ?? null,
    bookings: deps.bookings ?? null,
    senderName: deps.senderName,
    notifier: deps.notifier ?? null,
    policy: deps.policy,
    site: deps.site ?? null,
    now,
  };
}

/** Outcomes that end with no text: the email goes in its place. */
const NO_TEXT_KINDS: readonly Stepped["kind"][] = ["no_consent", "no_phone", "ended"];

/** One step's outcome as the journal keeps it: dates as ISO text. */
type Stepped = Exclude<FormOutcome, { kind: "waiting" }> | { kind: "waiting"; due: string };

interface FirstRequest {
  application: FormApplication;
  tries?: number;
}
interface RunRequest {
  run: number;
  tries?: number;
}

type FormsApi = {
  first: (ctx: restate.Context, req: FirstRequest) => Promise<Stepped>;
  email: (ctx: restate.Context, req: RunRequest) => Promise<EmailOutcome>;
  check: (ctx: restate.Context, req: RunRequest) => Promise<string>;
};

const APPLICATION = z.looseObject({
  id: z.number().int().positive(),
  ts: z.string(),
  offer: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  sms_consent: z.number(),
  fit: z.number(),
  page: z.string(),
});

export function makeSmsForms(deps: SmsDeps) {
  const nowOf = async (ctx: restate.Context) =>
    deps.clock ? deps.clock() : new Date(await ctx.date.now());
  const self = (ctx: restate.Context) => ctx.serviceSendClient<FormsApi>(FORMS_SERVICE);
  const siteOf = () => {
    if (!deps.site)
      throw new restate.TerminalError("no form texts: WREN_SITE_EXPORT_TOKEN is unset");
    return deps.site;
  };

  /** The step for one application, and what comes next scheduled. */
  async function step(ctx: restate.Context, app: FormApplication, tries: number) {
    const site = siteOf();
    const now = await nowOf(ctx);
    // A step that keeps throwing gives up after a few tries: the pass is the net.
    const got = await ctx.run(
      "step",
      async (): Promise<Stepped> => {
        const out = await formStep(deps.db, app, formOptionsOf(deps, site, now, null));
        return out.kind === "waiting" ? { kind: "waiting", due: out.due.toISOString() } : out;
      },
      { maxRetryAttempts: 5 },
    );
    const run = await ctx.run("run", async () => {
      const [r] = await deps.db
        .select({ id: speedRuns.id, due: speedRuns.firstDueAt })
        .from(speedRuns)
        .where(
          and(eq(speedRuns.workflow, FORM_WORKFLOW), eq(speedRuns.subject, formSubject(app.id))),
        );
      return r ? { id: r.id, due: r.due?.toISOString() ?? null } : null;
    });
    if (got.kind === "waiting") {
      const delay = Math.max(0, Date.parse(got.due) - now.getTime());
      self(ctx).first({ application: app, tries }, restate.rpc.sendOpts({ delay }));
    } else if (got.kind === "error" && tries + 1 < MAX_TRIES) {
      self(ctx).first(
        { application: app, tries: tries + 1 },
        restate.rpc.sendOpts({ delay: AGAIN_MS }),
      );
    } else if (got.kind === "texted" && run) {
      // Queued due now, and the queue's commit wakes the sender (`wren_wake`). The email follows
      // once the text has left.
      self(ctx).email({ run: run.id }, restate.rpc.sendOpts({ delay: EMAIL_AFTER_MS + 30_000 }));
    } else if (NO_TEXT_KINDS.includes(got.kind) && run) {
      // No text: the email goes alone, two minutes after they applied.
      const delay = Math.max(0, Date.parse(app.ts) + FIRST_TEXT_AFTER_MS + 5_000 - now.getTime());
      self(ctx).email({ run: run.id }, restate.rpc.sendOpts({ delay }));
    }
    // The first run of an application looks once more, 10 minutes after the text was due.
    if (tries === 0 && run?.due && got.kind !== "no_consent" && got.kind !== "done") {
      const delay = Math.max(0, Date.parse(run.due) + NOTICE_AFTER_MS + 30_000 - now.getTime());
      self(ctx).check({ run: run.id }, restate.rpc.sendOpts({ delay }));
    }
    return got;
  }

  return restate.service({
    name: FORMS_SERVICE.name,
    handlers: {
      /** The lander's push: one application by id, read from the site's export and stepped now. */
      applied: serviceHandler(
        {
          input: z.looseObject({ application: z.number().int().positive() }),
          effect: "sends",
        },
        async (ctx: restate.Context, req: { application: number }): Promise<Stepped | null> => {
          const site = siteOf();
          const app = await ctx.run("read", () => readApplication(site, req.application), {
            maxRetryAttempts: 5,
          });
          // Not on the site's export yet: the pass finds it.
          if (!app) return null;
          return step(ctx, app, 0);
        },
      ),
      /** The step again when the first text is due (or after a failed check). */
      first: serviceHandler(
        {
          input: z.looseObject({ application: APPLICATION, tries: z.number().int().optional() }),
          effect: "sends",
          ingressPrivate: true,
        },
        async (ctx: restate.Context, req: FirstRequest): Promise<Stepped> =>
          step(ctx, req.application, Math.max(1, req.tries ?? 1)),
      ),
      /** The email after the first text. Not yet = again in 5 minutes, a few times. */
      email: serviceHandler(
        {
          input: z.looseObject({
            run: z.number().int().positive(),
            tries: z.number().int().optional(),
          }),
          effect: "sends",
          ingressPrivate: true,
        },
        async (ctx: restate.Context, req: RunRequest): Promise<EmailOutcome> => {
          const now = await nowOf(ctx);
          const tries = req.tries ?? 0;
          let got: EmailOutcome;
          try {
            got = await ctx.run(
              "email",
              () => formEmail(deps.db, req.run, afterOptionsOf(deps, now)),
              {
                maxRetryAttempts: 3,
              },
            );
          } catch (err) {
            // A mail outage: the claim was let go, so a later run (or the pass) sends it.
            if (!(err instanceof restate.TerminalError)) throw err;
            got = "not_yet";
          }
          if (got === "not_yet" && tries + 1 < MAX_TRIES)
            self(ctx).email(
              { run: req.run, tries: tries + 1 },
              restate.rpc.sendOpts({ delay: AGAIN_MS }),
            );
          return got;
        },
      ),
      /** 10 minutes after the text was due: the one notice when none went. */
      check: serviceHandler(
        { input: z.looseObject({ run: z.number().int().positive() }), ingressPrivate: true },
        async (ctx: restate.Context, req: RunRequest): Promise<string> => {
          const now = await nowOf(ctx);
          return ctx.run("check", () =>
            noTextNotice(deps.db, req.run, {
              notifier: deps.notifier ?? null,
              policy: deps.policy,
              now,
            }),
          );
        },
      ),
    },
  });
}

export type SmsFormsService = ReturnType<typeof makeSmsForms>;
