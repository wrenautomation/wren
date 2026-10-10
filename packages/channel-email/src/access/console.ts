/**
 * MailAccess (designs/2026-10-07-mail-access.md): Account → Mail. A client's people see their own
 * mailboxes, each with its state, what blocks it and the next step; they add one, connect it, send
 * their admin the consent link, and check. `MailCallback/land` is where Google and Microsoft send
 * the person back: public, its authority the one-time state it carries.
 */
import * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  type SignedViewer,
  teamCan,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { accountsOf, checkNow, type Setup, type SetupEmit, startSetup } from "@wren/core/setup";
import { clientAccounts } from "@wren/core/setup-schema";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { domainOf, type MailAccessApi, wantOf } from "./access.js";
import { MAIL_ACCESS_APPS, MAIL_ACCESS_ROUTES } from "./console-routes.js";
import { MAIL_ACCESS, MAIL_PROVIDERS, type MailAccess, type MailProvider } from "./schema.js";
import {
  GOOGLE_APP_ACCESS,
  GOOGLE_MAIL_SETUP,
  MAILBOX_SETUP,
  MICROSOFT_MAIL_SETUP,
} from "./setups.js";

export interface MailConsoleDeps {
  main: Db;
  access: MailAccessApi;
  /** A client's own database: Done on an email it read. */
  clientDb: (client: string) => Db;
  /** The setups by site; the worker's `SETUPS` hold the same three. */
  setups?: readonly Setup[];
  now?: () => Date;
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email ?? "unknown";

const SETUP_OF: Record<string, Setup> = {
  google_workspace: GOOGLE_MAIL_SETUP,
  microsoft_365: MICROSOFT_MAIL_SETUP,
  mailbox: MAILBOX_SETUP,
};

/** The handlers as plain calls; moves answer the events to emit. */
export function mailConsoleApi(deps: MailConsoleDeps) {
  const { main, access } = deps;
  const now = () => deps.now?.() ?? new Date();
  const setupOf = (site: string) => {
    const s = deps.setups?.find((x) => x.site === site && x.id === SETUP_OF[site]?.id);
    return s ?? SETUP_OF[site] ?? null;
  };
  /** The client the viewer may open; Wren's own mail is the Monitor's, never here. */
  const owner = async (req: PortalRequest) => {
    if (req.client === WREN) throw new PortalRefusal("Wren's own mail is the Monitor's", 409);
    return pickClient(main, req);
  };
  const writer = async (req: PortalRequest) => {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    const c = await owner(req);
    if (
      !teamCan(req, "act", c.id) &&
      !(await canAt(main, req, "act", { client: c.id, app: "account" }))
    )
      throw new PortalRefusal("your role can't do that", 403);
    return c;
  };
  const mine = async (client: string, id: number) => {
    const a = (await accountsOf(main, client)).find((x) => x.id === Number(id));
    if (!a) throw new PortalRefusal("no such account", 404);
    return a;
  };
  /** Start an account's setup, unless one is already on its way. */
  const start = async (accountId: number, site: string, who: string) => {
    const s = setupOf(site);
    return s ? [await startSetup(main, s, { accountId, by: who, now: now() })] : [];
  };

  return {
    /** The client's mailboxes and orgs, with each org's steps. */
    async mail(req: PortalRequest) {
      if (req.client === WREN)
        return {
          owner: { id: null, name: "Wren" },
          wren: true as const,
          mayAct: false,
          mailboxes: [],
          orgs: [],
        };
      const c = await owner(req);
      const v = await access.view(c.id);
      const accounts = await accountsOf(main, c.id);
      const mayAct =
        !isDemo(req.viewer) &&
        (teamCan(req, "act", c.id) ||
          (await canAt(main, req, "act", { client: c.id, app: "account" })));
      return {
        owner: { id: c.id, name: c.name },
        wren: false as const,
        mayAct,
        apps: v.apps,
        keyStore: v.keyStore,
        googleClientId: v.googleClientId,
        googleAdminUrl: GOOGLE_APP_ACCESS,
        mailboxes: v.mailboxes,
        orgs: v.orgs.map((o) => {
          const a = accounts.find((x) => x.id === o.id);
          const s = setupOf(o.site);
          const run = a?.runs.find((r) => r.setup === s?.id) ?? null;
          return {
            ...o,
            setup: s?.id ?? null,
            run: run ? { state: run.state, step: run.step, why: run.why } : null,
            steps: (s?.steps ?? []).map((st) => {
              const f = a?.facts.find((x) => x.fact === st.fact);
              return {
                id: st.id,
                label: st.label,
                who: st.who,
                how: st.how,
                forYou: st.forYou,
                done: f?.state === "ok",
                why: f?.why ?? null,
                checkedAt: f?.checkedAt ? f.checkedAt.toISOString() : null,
              };
            }),
          };
        }),
      };
    },

    /** A mailbox to connect, and its org's admin setup when it should read. */
    async addMailbox(
      req: PortalRequest & { address: string; provider: MailProvider; want: MailAccess },
    ): Promise<{ id: number; emits: SetupEmit[] }> {
      const c = await writer(req);
      const { mailbox, org } = await access.addMailbox({
        client: c.id,
        address: String(req.address ?? ""),
        provider: req.provider,
        want: req.want,
        by: by(req),
      });
      const emits = await start(mailbox.id, "mailbox", by(req));
      if (org && req.want === "read") {
        const a = await mine(c.id, org.id);
        if (!a.runs.length) emits.push(...(await start(org.id, org.site, by(req))));
      }
      return { id: mailbox.id, emits };
    },

    /** Where the person signs in as the mailbox. */
    async connect(
      req: PortalRequest & { account: number; want: MailAccess },
    ): Promise<{ url: string; emits: SetupEmit[] }> {
      const c = await writer(req);
      const a = await mine(c.id, req.account);
      if (a.site !== "mailbox") throw new PortalRefusal("no such mailbox", 404);
      const url = await access.connect({ accountId: a.id, want: req.want, by: by(req) });
      const emits: SetupEmit[] = [];
      // Asking to read now says the mailbox wants it, so its org's admin step starts too.
      if (req.want === "read" && wantOf(a) !== "read") {
        await main.update(clientAccounts).set({ role: "read" }).where(eq(clientAccounts.id, a.id));
        const org = (await accountsOf(main, c.id)).find(
          (x) =>
            (x.site === "google_workspace" || x.site === "microsoft_365") &&
            x.ref === domainOf(a.ref),
        );
        if (org && !org.runs.length) emits.push(...(await start(org.id, org.site, by(req))));
      }
      return { url, emits };
    },

    /** The Microsoft 365 admin's consent link: open it, or send it to the admin. */
    async consent(req: PortalRequest & { account: number }) {
      const c = await writer(req);
      const a = await mine(c.id, req.account);
      const url = await access.consent({ accountId: a.id, by: by(req) });
      return { url };
    },

    /** Check an org's admin step or a mailbox's sign-in now. A setup not on its way starts. */
    async check(req: PortalRequest & { account: number }): Promise<{ emits: SetupEmit[] }> {
      const c = await writer(req);
      const a = await mine(c.id, req.account);
      const s = setupOf(a.site);
      if (!s) throw new PortalRefusal("nothing to check", 409);
      const run = a.runs.find((r) => r.setup === s.id);
      if (!run || run.state === "done" || run.state === "lost")
        return { emits: await start(a.id, a.site, by(req)) };
      const emit = await checkNow(main, s, { accountId: a.id, now: now() });
      return { emits: emit ? [emit] : [] };
    },

    /** A thread it read, dealt with: every mail in it leaves "Waiting on you". */
    async done(req: PortalRequest & { id: number }) {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const c = await owner(req);
      // The Monitor's table, in the client's own database: only mail its mailboxes brought in.
      const rows = await deps.clientDb(c.id).execute(sql`update watch.mail m
        set done_at = ${now().toISOString()}::timestamptz
        from watch.mail o
        where o.id = ${Number(req.id)} and o.reader = 'mail'
          and m.mailbox = o.mailbox and m.thread_id = o.thread_id
          and m.reader = 'mail' and m.done_at is null
        returning m.id`);
      return { ok: rows.length > 0 };
    },
  };
}

const ACCOUNT = z.number().int().positive().describe("The account's id");

export function makeMailAccess(deps: MailConsoleDeps) {
  const api = mailConsoleApi(deps);
  const read =
    <R extends PortalRequest, T>(fn: (req: R) => Promise<T>) =>
    (_: restate.Context, req: R) =>
      answer(() => fn(req));
  const write =
    <R extends PortalRequest, T>(name: string, fn: (req: R) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  /** A write whose setups' events go onto the spine once it's journaled. */
  const move =
    <R extends PortalRequest, T extends { emits: SetupEmit[] }>(
      name: string,
      fn: (req: R) => Promise<T>,
    ) =>
    async (ctx: restate.Context, req: R) => {
      const out = await answer(() => ctx.run(name, () => answer(() => fn(req))));
      for (const e of out.emits) spineEmit(ctx, e);
      const { emits: _, ...rest } = out;
      return { ok: true, ...rest };
    };
  return portalService({
    name: "MailAccess",
    main: deps.main,
    routes: MAIL_ACCESS_ROUTES,
    apps: MAIL_ACCESS_APPS,
    unnamed: "first",
    handlers: {
      mail: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, read(api.mail)),
      addMailbox: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            address: z.string().max(320).describe("The mailbox: ann@acme.com"),
            provider: z.enum(MAIL_PROVIDERS),
            want: z.enum(MAIL_ACCESS).describe("send, or read and send"),
          }),
        },
        move("add", api.addMailbox),
      ),
      connect: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, account: ACCOUNT, want: z.enum(MAIL_ACCESS) }) },
        move("connect", api.connect),
      ),
      consent: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, account: ACCOUNT }) },
        write("consent", api.consent),
      ),
      check: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, account: ACCOUNT }) },
        move("check", api.check),
      ),
      done: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: z.number().int().positive() }) },
        write("done", api.done),
      ),
    },
  });
}

/** What Google and Microsoft send back, as the portal's Worker passes it on. */
export const LANDING = z.looseObject({
  provider: z.enum(MAIL_PROVIDERS),
  state: z.string().max(128),
  code: z.string().max(4096).nullish(),
  error: z.string().max(200).nullish(),
  admin_consent: z.string().max(10).nullish(),
  tenant: z.string().max(64).nullish(),
  scope: z.string().max(2000).nullish(),
});

/**
 * The callback: the state used once, the token kept, and the setups of the accounts it touched
 * checked now. Answers only what the landing page says.
 */
export function makeMailCallback(deps: MailConsoleDeps) {
  const s = (site: string) =>
    deps.setups?.find((x) => x.id === SETUP_OF[site]?.id) ?? SETUP_OF[site] ?? null;
  return restate.service({
    name: "MailCallback",
    handlers: {
      land: serviceHandler(
        { input: LANDING },
        async (ctx: restate.Context, q: z.infer<typeof LANDING>) => {
          const out = await ctx.run("land", async () => {
            const r = await deps.access.land(q);
            const emits: SetupEmit[] = [];
            for (const id of r.check) {
              const [a] = r.client
                ? (await accountsOf(deps.main, r.client)).filter((x) => x.id === id)
                : [];
              const setup = a && s(a.site);
              if (!a || !setup) continue;
              const run = a.runs.find((x) => x.setup === setup.id);
              const e =
                run && run.state !== "done" && run.state !== "lost"
                  ? await checkNow(deps.main, setup, { accountId: a.id })
                  : await startSetup(deps.main, setup, { accountId: a.id, by: "callback" });
              if (e) emits.push(e);
            }
            return { ok: r.ok, said: r.said, emits };
          });
          for (const e of out.emits) spineEmit(ctx, e);
          return { ok: out.ok, said: out.said };
        },
      ),
    },
  });
}

/** Account → Mail's page, as `MailAccess/mail` answers it. */
export type MailPageView = Awaited<ReturnType<ReturnType<typeof mailConsoleApi>["mail"]>>;
