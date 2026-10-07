/**
 * AccountsConsole (designs/2026-10-07-setup-and-vendors.md, Pages): a client's accounts, each
 * with its facts and setup runs, and its vendors with mode, room and the month's usage. A
 * client's people read both and act on their own steps; Wren's team adds accounts, starts and
 * switches setups, and sets vendor modes. A key is never read back. Moves on a setup go onto the
 * spine (`spineEmit`) once the write is journaled.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { WREN } from "./access.js";
import { ACCOUNTS_CONSOLE_APPS, ACCOUNTS_CONSOLE_ROUTES } from "./accounts-console-routes.js";
import { clients, SETUP_MODES, type SetupMode } from "./clients/schema.js";
import { keyRef, noRawKeys } from "./key-refs.js";
import { KeyRefusal, type KeyStore } from "./keys.js";
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
} from "./portal.js";
import { PORTAL_FIELDS, serviceHandler } from "./restate/form.js";
import {
  type AccountView,
  accountsOf,
  addAccount,
  checkNow,
  markStep,
  REGISTRY_SITES,
  type RegistrySite,
  type Setup,
  type SetupEmit,
  setupOf,
  siteLabel,
  startSetup,
} from "./setup.js";
import {
  type AlertPart,
  type AlertView,
  alertTimeline,
  clientAlerts,
  openAlerts,
  pausedParts,
  pausedText,
  teamAlerts,
} from "./setup-alerts.js";
import type { SetupRunRow } from "./setup-schema.js";
import { spineEmit, waitMs } from "./spine.js";
import { vendorUsage } from "./vendor-schema.js";
import {
  clearMode,
  gate,
  isFree,
  modesOf,
  monthStart,
  priceText,
  roomToday,
  setManaged,
  setOwnKey,
  setOwnLogin,
  unitsOf,
  usageSince,
  VENDORS,
  vendorSettings,
} from "./vendors.js";

export interface AccountsDeps {
  db: Db;
  /** Every setup the worker runs (`SETUPS`). */
  setups: readonly Setup[];
  /** The checks the worker registered, by name: any other says "Check in development". */
  checks: ReadonlySet<string>;
  /** Where own keys go; null: saving one says the key store isn't set up here. */
  keys: KeyStore | null;
  /** The worker hands done-for-you steps to the agent (`WREN_SETUP_AGENT`); off: the team does them. */
  agent?: boolean;
  /** Parts that need facts (the worker's COMPONENTS): paused ones show on the page. */
  parts?: readonly AlertPart[];
  now?: () => Date;
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email ?? "unknown";

/** Whose: a client the viewer may open, or Wren's own (`wren`) for the team. */
async function ownerOf(db: Db, req: PortalRequest): Promise<{ id: string | null; name: string }> {
  if (req.client === WREN) {
    if (!teamCan(req, "read", WREN)) throw new PortalRefusal("no access", 403);
    return { id: null, name: "Wren" };
  }
  const c = await pickClient(db, req);
  return { id: c.id, name: c.name };
}

/** The team at this owner with `p`; a client's people never. */
const teamAt = (req: PortalRequest, id: string | null, p: "act" | "money") =>
  teamCan(req, p, id ?? WREN);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** A step's place on its run: done, the one it's on (as the run's state), or later. */
type StepState = "done" | "later" | SetupRunRow["state"];

function runView(
  a: AccountView,
  s: Setup,
  run: SetupRunRow,
  o: { team: boolean; checks: ReadonlySet<string>; now: Date },
) {
  const held = new Map(a.facts.map((f) => [f.fact, f]));
  const at = run.step ? s.steps.findIndex((x) => x.id === run.step) : s.steps.length;
  const current = s.steps[at];
  // Past its step's `within`: the page says stuck even before the round that tells the team runs.
  const late =
    !!current?.within &&
    run.state !== "done" &&
    o.now.getTime() - run.stepSince.getTime() > waitMs(current.within);
  return {
    setup: s.id,
    name: s.name,
    blurb: s.blurb,
    gen: run.gen,
    mode: run.mode,
    state: late && run.state !== "lost" ? ("stuck" as const) : run.state,
    step: run.step,
    why: run.why,
    rounds: run.rounds,
    startedAt: iso(run.startedAt),
    stepSince: iso(run.stepSince),
    doneAt: iso(run.doneAt),
    nextCheckAt: iso(run.nextCheckAt),
    steps: s.steps.map((st, i) => {
      const f = held.get(st.fact);
      const state: StepState =
        f?.state === "ok" ? "done" : i === at ? run.state : i < at ? "done" : "later";
      return {
        id: st.id,
        label: st.label,
        fact: st.fact,
        who: st.who,
        how: st.how,
        forYou: st.forYou,
        buys: !!st.buys,
        every: st.every ?? null,
        within: st.within ?? null,
        // A check the worker hasn't got waits on a person to mark the step done.
        check: st.check ? (o.checks.has(st.check) ? "live" : "development") : null,
        state,
        why: f?.state === "ok" ? null : (f?.why ?? (i === at ? run.why : null)),
        mayMark: state !== "done" && (o.team || st.who === "client"),
      };
    }),
  };
}

/** An alert as a page shows it: no internal keys. */
const alertOut = (x: AlertView) => ({
  id: x.id,
  kind: x.kind,
  for: x.for,
  level: x.level,
  title: x.title,
  why: x.why,
  at: x.at,
  open: x.open,
});

function accountView(
  a: AccountView,
  setups: readonly Setup[],
  o: {
    team: boolean;
    checks: ReadonlySet<string>;
    now: Date;
    timeline?: readonly AlertView[];
    /** The parts paused on this account's lost facts: "Paused: needs …". */
    paused?: readonly { part: string; name: string; fact: string; text: string }[];
  },
) {
  const mine = setups.filter((s) => s.site === a.site);
  return {
    id: a.id,
    site: a.site,
    siteLabel: siteLabel(a.site),
    ref: a.ref,
    role: a.role,
    mode: a.mode,
    // Which credvault login Wren signs in with: the team's to know, never the value.
    ...(o.team ? { login: a.login } : {}),
    facts: a.facts.map((f) => ({
      fact: f.fact,
      label: setupOf(f.fact, setups)?.step.label ?? f.fact,
      state: f.state,
      why: f.why,
      checkedAt: iso(f.checkedAt),
      okAt: iso(f.okAt),
    })),
    runs: a.runs.flatMap((r) => {
      const s = mine.find((x) => x.id === r.setup);
      return s ? [runView(a, s, r, o)] : [];
    }),
    /** What happened to it: each alert, newest first. */
    timeline: (o.timeline ?? []).map(alertOut),
    paused: o.paused ?? [],
    /** Setups for this account's site not started on it. */
    setups: mine
      .filter((s) => !a.runs.some((r) => r.setup === s.id))
      .map((s) => ({ id: s.id, name: s.name, blurb: s.blurb })),
  };
}

export type AccountsView = Awaited<ReturnType<ReturnType<typeof accountsApi>["accounts"]>>;
export type NowView = Awaited<ReturnType<ReturnType<typeof accountsApi>["now"]>>;
export type VendorsView = Awaited<ReturnType<ReturnType<typeof accountsApi>["vendors"]>>;
export type UsageView = Awaited<ReturnType<ReturnType<typeof accountsApi>["usage"]>>;

export interface AccountRequest extends PortalRequest {
  account: number;
  setup: string;
}

/**
 * The handlers as plain calls, each checking its own access and throwing `PortalRefusal`. Moves
 * on a setup answer the events to emit; the Restate service emits them, a preview drops them.
 */
export function accountsApi(deps: AccountsDeps) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const setupBy = (id: string) => {
    const s = deps.setups.find((x) => x.id === id);
    if (!s) throw new PortalRefusal("no such setup", 404);
    return s;
  };
  /** The account, once it's this owner's. */
  const accountOf = async (req: PortalRequest & { account: number }, owner: string | null) => {
    const all = await accountsOf(db, owner);
    const a = all.find((x) => x.id === Number(req.account));
    if (!a) throw new PortalRefusal("no such account", 404);
    return a;
  };
  /** A write's owner: never the demo, never by a client's people where `team` says Wren's. */
  const writer = async (req: PortalRequest, need: "team" | "act") => {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    const owner = await ownerOf(db, req);
    const team = teamAt(req, owner.id, "act");
    if (need === "team" && !team) throw new PortalRefusal("Wren's team does this", 403);
    if (!team && !(await canAt(db, req, "act", { client: owner.id ?? WREN, app: "account" })))
      throw new PortalRefusal("your role can't do that", 403);
    return { owner, team };
  };
  /** The owner's paused parts, each with the accounts whose lost fact holds it. */
  const pausedHere = async (client: string | null, list: readonly AccountView[]) => {
    const parts = deps.parts ?? [];
    const paused = await pausedParts(db, client, parts);
    return [...paused].map(([id, fact]) => {
      const label = setupOf(fact, deps.setups)?.step.label ?? fact;
      return {
        part: id,
        name: parts.find((p) => p.id === id)?.name ?? id,
        fact,
        label,
        text: pausedText(label),
        accounts: list
          .filter((a) => a.facts.some((f) => f.fact === fact && f.state === "lost"))
          .map((a) => a.id),
      };
    });
  };
  const fail = (err: unknown): never => {
    if (err instanceof PortalRefusal) throw err;
    // A key store refusal keeps its status: 403 someone else's key, 404 waited too long.
    if (err instanceof KeyRefusal) throw new PortalRefusal(err.message, err.status);
    throw new PortalRefusal(err instanceof Error ? err.message : String(err), 409);
  };

  return {
    /** The owner's accounts, each with its facts, runs and the setups it could start. */
    async accounts(req: PortalRequest) {
      const owner = await ownerOf(db, req);
      const team = teamAt(req, owner.id, "act");
      const o = { team, checks: deps.checks, now: now() };
      const list = await accountsOf(db, owner.id);
      const timelines = await alertTimeline(
        db,
        list.map((a) => a.id),
      );
      const paused = await pausedHere(owner.id, list);
      return {
        owner,
        team,
        mayAct: team || (await canAt(db, req, "act", { client: owner.id ?? WREN, app: "account" })),
        agent: team && !!deps.agent,
        accounts: list.map((a) =>
          accountView(a, deps.setups, {
            ...o,
            timeline: timelines.get(a.id) ?? [],
            paused: paused.filter((p) => p.accounts.includes(a.id)),
          }),
        ),
        /** Every part paused here, once: the page's head. */
        paused: paused.map(({ accounts: _, ...p }) => p),
        // What the team may add: each site with the setups that run on it.
        sites: team
          ? REGISTRY_SITES.map((site) => ({
              site,
              label: siteLabel(site),
              setups: deps.setups.filter((s) => s.site === site).map((s) => s.name),
            }))
          : [],
      };
    },

    /**
     * Now: setup items for whoever asks. Wren's team at Wren: every owner's items the team acts
     * on, and every lost or stuck one. A client's people (the guard checked their role reaches
     * the Account app): theirs to do, their paused parts, and what finished in three days. The
     * team looking at a client reads that client's items whoever acts. `count` is the open ones:
     * the Accounts badge.
     */
    async now(req: PortalRequest) {
      const owner = await ownerOf(db, req);
      const team = teamAt(req, owner.id, "act") || teamCan(req, "read", owner.id ?? WREN);
      const at = now();
      let items: AlertView[];
      if (owner.id === null) items = team ? await teamAlerts(db) : [];
      else if (team && !req.asClient) items = await openAlerts(db, { client: owner.id });
      else items = await clientAlerts(db, owner.id, at);
      const ids = [...new Set(items.map((x) => x.client).filter((c): c is string => !!c))];
      const names = new Map(
        ids.length
          ? (
              await db
                .select({ id: clients.id, name: clients.name })
                .from(clients)
                .where(inArray(clients.id, ids))
            ).map((c) => [c.id, c.name])
          : [],
      );
      return {
        owner,
        team: team && !req.asClient,
        count: items.filter((x) => x.open).length,
        items: items.map((x) => ({
          ...alertOut(x),
          client: x.client,
          clientName: x.client === null ? "Wren" : (names.get(x.client) ?? x.client),
          accountId: x.accountId,
          site: x.site,
          siteLabel: siteLabel(x.site),
          ref: x.ref,
        })),
      };
    },

    /** Each vendor: its mode here, key set or not, today's room, the month's units and est. $. */
    async vendors(req: PortalRequest) {
      const owner = await ownerOf(db, req);
      const at = now();
      const settings = await vendorSettings(db);
      const modes = owner.id ? await modesOf(db, owner.id) : [];
      const used = await usageSince(db, owner.id, monthStart(at));
      const rows = [];
      for (const v of VENDORS) {
        const m = modes.find((x) => x.vendor === v.id);
        // Today is the room alone; the cap is money, said on its own line.
        const today = await roomToday(db, owner.id, v.id, at);
        const g = today.ok ? await gate(db, owner.id, v.id, 1, at) : today;
        const sum = (mode: "managed" | "own") => {
          const mine = used.filter((u) => u.vendor === v.id && u.mode === mode);
          return {
            units: mine.reduce((n, u) => n + u.units, 0),
            micros: mine.reduce((n, u) => n + u.micros, 0),
          };
        };
        rows.push({
          id: v.id,
          name: v.name,
          units: unitsOf(v),
          price: priceText(v),
          url: v.url,
          asOf: v.asOf,
          own: v.own,
          /** What a pasted key is saved as (`/api/keys/stage`); null when it takes none. */
          keyName: v.keyName,
          free: isFree(v),
          offered:
            owner.id === null || (!v.managedDev && settings.managedForClients.includes(v.id)),
          /** "Managed by Wren" isn't built for it: the page says In development. */
          managedDev: !!v.managedDev,
          mode: owner.id === null ? ("managed" as const) : (m?.mode ?? null),
          keySet: !!m?.keyName,
          /** The saved key's last 4, so a person knows which one it is. */
          keyLast4:
            m?.keyName && owner.id && deps.keys
              ? ((await deps.keys.info({ ref: m.keyName, client: owner.id }))?.last4 ?? null)
              : null,
          perDay: m?.perDay ?? 0,
          capCents: m?.capCents ?? 0,
          quota: v.quota?.perDay ?? null,
          room: today.ok ? today.room : null,
          why: today.ok ? null : today.why,
          /** Why the cap stops it ("No monthly cap set", "... reached"); null when it doesn't. */
          capped: today.ok && !g.ok ? g.why : null,
          /** This month on Wren's key (what Wren pays and bills), and on their own key. */
          month: { managed: sum("managed"), own: sum("own") },
        });
      }
      return {
        owner,
        team: teamAt(req, owner.id, "act"),
        mayMoney: owner.id !== null && teamAt(req, owner.id, "money"),
        keyStore: deps.keys !== null,
        reservePct: settings.reservePct,
        vendors: rows,
      };
    },

    /** Start a setup on an account (the team picks done for you), or start it over. */
    async start(req: AccountRequest & { mode?: SetupMode | null }) {
      const { owner, team } = await writer(req, "act");
      const s = setupBy(String(req.setup));
      const a = await accountOf(req, owner.id);
      if (req.mode && !(SETUP_MODES as readonly string[]).includes(req.mode))
        throw new PortalRefusal("mode: self or for_you", 400);
      // Done for you, or a switch of mode on a run: Wren's team.
      if (!team && (req.mode === "for_you" || a.runs.some((r) => r.setup === s.id)))
        throw new PortalRefusal("Wren's team does this", 403);
      const emit = await startSetup(db, s, {
        accountId: a.id,
        ...(req.mode ? { mode: req.mode } : {}),
        by: by(req),
        now: now(),
      }).catch(fail);
      return { emits: [emit] };
    },

    /** A person says a step is done. A client's people mark only the steps that are theirs. */
    async mark(req: AccountRequest & { step: string }) {
      const { owner, team } = await writer(req, "act");
      const s = setupBy(String(req.setup));
      const step = s.steps.find((x) => x.id === req.step);
      if (!step) throw new PortalRefusal("no such step", 404);
      if (!team && step.who !== "client")
        throw new PortalRefusal("Wren's team does this step", 403);
      const a = await accountOf(req, owner.id);
      const emit = await markStep(db, s, {
        accountId: a.id,
        step: step.id,
        by: by(req),
        now: now(),
        ...(deps.parts ? { parts: deps.parts } : {}),
      }).catch(fail);
      return { emits: emit ? [emit] : [] };
    },

    /** Check the step a run waits on now, not at its next round. */
    async checkNow(req: AccountRequest) {
      const { owner } = await writer(req, "act");
      const s = setupBy(String(req.setup));
      const a = await accountOf(req, owner.id);
      const emit = await checkNow(db, s, { accountId: a.id, now: now() }).catch(fail);
      if (!emit) throw new PortalRefusal("It isn't waiting on a step", 409);
      return { emits: [emit] };
    },

    /** Add an account to the registry: a domain, an inbox, a number, a property. Wren's team. */
    async addAccount(
      req: PortalRequest & { site: string; ref: string; role?: string | null; mode?: SetupMode },
    ) {
      const { owner } = await writer(req, "team");
      if (!(REGISTRY_SITES as readonly string[]).includes(req.site))
        throw new PortalRefusal("no such site", 400);
      const row = await addAccount(db, {
        client: owner.id,
        site: req.site as RegistrySite,
        ref: String(req.ref ?? ""),
        role: req.role?.trim() || "main",
        mode: req.mode === "for_you" ? "for_you" : "self",
        by: by(req),
      }).catch(fail);
      return { id: row.id };
    },

    /**
     * A client's mode on a vendor: managed on Wren's key with a daily share and a monthly cap
     * (money, so an admin), the client's own key or login, or none. A key is never read back.
     */
    async setVendor(
      req: PortalRequest & {
        vendor: string;
        mode: "managed" | "own" | "none";
        /** Own key: the ref `/api/keys/stage` answered with. */
        keyRef?: string | null;
        perDay?: number | null;
        capCents?: number | null;
      },
    ) {
      const { owner } = await writer(req, "team");
      if (owner.id === null) throw new PortalRefusal("Wren is managed on every vendor", 409);
      const v = VENDORS.find((x) => x.id === req.vendor);
      if (!v) throw new PortalRefusal("no such vendor", 404);
      const client = owner.id;
      if (req.mode === "managed") {
        if (!teamAt(req, client, "money"))
          throw new PortalRefusal("Shares and caps are money: an admin sets them", 403);
        await setManaged(db, {
          client,
          vendor: v.id,
          perDay: Number(req.perDay ?? 0),
          capCents: Number(req.capCents ?? 0),
          by: by(req),
        }).catch(fail);
      } else if (req.mode === "own") {
        if (v.own === "login") await setOwnLogin(db, { client, vendor: v.id, by: by(req) });
        else if (v.own === "key")
          await setOwnKey(db, deps.keys, {
            client,
            vendor: v.id,
            keyRef: String(req.keyRef ?? ""),
            by: by(req),
          }).catch(fail);
        else throw new PortalRefusal(`${v.name} runs on Wren's only`, 409);
      } else if (req.mode === "none") await clearMode(db, client, v.id);
      else throw new PortalRefusal("mode: managed, own or none", 400);
      return { ok: true };
    },

    /**
     * This month's metered use across owners, per vendor and mode: Wren's team. Totals count
     * Wren's key only (what Wren pays and may bill); own-key use is the client's vendor bill.
     */
    async usage(req: PortalRequest) {
      if (!teamCan(req, "read", WREN)) throw new PortalRefusal("no access", 403);
      const from = monthStart(now());
      const rows = await db
        .select({
          client: vendorUsage.client,
          name: clients.name,
          vendor: vendorUsage.vendor,
          mode: vendorUsage.mode,
          units: sql<string>`sum(${vendorUsage.units})`,
          micros: sql<string>`sum(${vendorUsage.micros})`,
        })
        .from(vendorUsage)
        .leftJoin(clients, eq(clients.id, vendorUsage.client))
        .where(gte(vendorUsage.at, from))
        .groupBy(vendorUsage.client, clients.name, vendorUsage.vendor, vendorUsage.mode)
        .orderBy(sql`sum(${vendorUsage.micros}) desc`);
      const of = (id: string) => VENDORS.find((v) => v.id === id);
      const owners = new Map<string, { client: string | null; name: string; micros: number }>();
      for (const r of rows) {
        const k = r.client ?? WREN;
        const o = owners.get(k) ?? {
          client: r.client,
          name: r.client === null ? "Wren" : (r.name ?? r.client),
          micros: 0,
        };
        if (r.mode === "managed") o.micros += Number(r.micros);
        owners.set(k, o);
      }
      return {
        from: from.toISOString(),
        /** Est. micro-dollars on Wren's key this month, every owner. */
        total: [...owners.values()].reduce((n, o) => n + o.micros, 0),
        /** Each owner's month on Wren's key, in the order its rows come. */
        owners: [...owners.values()],
        rows: rows.map((r) => ({
          client: r.client,
          clientName: r.client === null ? "Wren" : (r.name ?? r.client),
          vendor: r.vendor,
          vendorName: of(r.vendor)?.name ?? r.vendor,
          mode: r.mode,
          units: Number(r.units),
          unit: unitsOf(of(r.vendor) ?? { unit: "unit" }),
          micros: Number(r.micros),
        })),
      };
    },
  };
}
export type AccountsApi = ReturnType<typeof accountsApi>;

const ACCOUNT = z.number().int().positive().describe("The account's id");
const SETUP = z.string().max(64).describe("The setup's id: setup.texting");

export function makeAccountsConsole(deps: AccountsDeps) {
  const api = accountsApi(deps);
  const read =
    <R extends PortalRequest, T>(fn: (req: R) => Promise<T>) =>
    (_: restate.Context, req: R) =>
      answer(() => fn(req));
  /** A write, journaled once; its events go onto the spine after it. */
  const move =
    <R extends PortalRequest>(name: string, fn: (req: R) => Promise<{ emits: SetupEmit[] }>) =>
    async (ctx: restate.Context, req: R) => {
      const { emits } = await answer(() => ctx.run(name, () => answer(() => fn(req))));
      for (const e of emits) spineEmit(ctx, e);
      return { ok: true, moved: emits.length };
    };
  const write =
    <R extends PortalRequest, T>(name: string, fn: (req: R) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  const on = { ...PORTAL_FIELDS, account: ACCOUNT, setup: SETUP };
  return portalService({
    name: "AccountsConsole",
    main: deps.db,
    routes: ACCOUNTS_CONSOLE_ROUTES,
    apps: ACCOUNTS_CONSOLE_APPS,
    unnamed: "first",
    handlers: {
      accounts: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, read(api.accounts)),
      vendors: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, read(api.vendors)),
      now: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, read(api.now)),
      usage: serviceHandler({ input: z.looseObject(PORTAL_FIELDS) }, read(api.usage)),
      start: serviceHandler(
        { input: z.looseObject({ ...on, mode: z.enum(SETUP_MODES).nullish() }) },
        move("start", api.start),
      ),
      mark: serviceHandler(
        { input: z.looseObject({ ...on, step: z.string().max(40) }) },
        move("mark", api.mark),
      ),
      checkNow: serviceHandler({ input: z.looseObject(on) }, move("check", api.checkNow)),
      addAccount: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            site: z.enum(REGISTRY_SITES),
            ref: z.string().max(200).describe("What it is there: example.com, +15550100"),
            role: z.string().max(32).nullish(),
            mode: z.enum(SETUP_MODES).optional(),
          }),
        },
        write("add", api.addAccount),
      ),
      setVendor: serviceHandler(
        {
          // The key itself never comes here: the page stages it and sends its ref.
          input: noRawKeys(
            z.looseObject({
              ...PORTAL_FIELDS,
              vendor: z.string().max(32),
              mode: z.enum(["managed", "own", "none"]),
              keyRef: keyRef.nullish().describe("Own key: the ref the key store gave it"),
              perDay: z.number().int().min(0).nullish(),
              capCents: z.number().int().min(0).nullish(),
            }),
          ),
        },
        write("vendor", api.setVendor),
      ),
    },
  });
}
