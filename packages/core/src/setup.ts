/**
 * Account setup (designs/2026-10-07-setup-and-vendors.md): a setup is a workflow of steps, each
 * making one named fact true on one account. It walks the spine like any workflow, one subject
 * per account and generation. A step that isn't true yet waits on its own self wire for its
 * `every`, then checks again, for as long as the status takes. Parts name the facts they need;
 * a lost fact sends the account's setup round again.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { clients, type SetupMode } from "./clients/schema.js";
import { ACCOUNT_SITES, ACCOUNTS, type Component, type Port } from "./components.js";
import { DO_OWNER, type DoRequest } from "./content/do.js";
import type { DnsType, Resolver } from "./doh.js";
import type { Notifier } from "./notify.js";
import { type AlertPart, clearStep, factMoved, setupAlert, tellAlerts } from "./setup-alerts.js";
import {
  type AccountRow,
  accountFacts,
  clientAccounts,
  type FactRow,
  type FactState,
  type SetupRunRow,
  type SetupState,
  setupRuns,
} from "./setup-schema.js";
import { type SpineEvent, type Step, waitMs } from "./spine.js";
import { defineWorkflow, type Wire, type Workflow } from "./workflows.js";

/** Sites an account in the registry can be on: the Shop's, plus a domain, an inbox, a number. */
export const REGISTRY_SITES = [...ACCOUNT_SITES, "domain", "inbox", "number"] as const;
export type RegistrySite = (typeof REGISTRY_SITES)[number];

/** A registry site as a person says it: the Shop's label, or the registry's own three. */
export function siteLabel(site: string): string {
  const own: Record<string, string> = {
    domain: "Sending domain",
    inbox: "Sending inbox",
    number: "Phone number",
    // The Shop's "Phone number" is the texting setup as a whole; here it's the Telnyx account.
    telnyx: "Telnyx account",
  };
  return own[site] ?? ACCOUNTS[site as keyof typeof ACCOUNTS]?.label ?? site;
}

/** Who acts on a step: the client, Wren's team (or its agent), or nobody (a check waits). */
export type StepWho = "client" | "wren" | "auto";

export interface SetupStep {
  /** A node id: `campaign_approved`. */
  id: string;
  /** The fact it makes true: `telnyx.campaign_approved`. */
  fact: string;
  /** Short, said to a person: "Carriers approve the campaign". */
  label: string;
  who: StepWho;
  /** What the client does, self-serve. */
  how: string;
  /** What Wren's team or its agent does, done for you. */
  forYou: string;
  /** autobrowse `do` goal for the agent, done for you; the account's ref and site go as inputs. */
  goal?: string;
  /** It creates an account or spends: done for you waits on William's yes for the client. */
  buys?: boolean;
  /** A registered check's name; none: a person marks it done. */
  check?: string;
  /** How often to check again while it waits: "15 minutes", "1 day". */
  every?: string;
  /** How long it may wait before it's stuck and the team is told. */
  within?: string;
}

export interface Setup {
  /** The workflow's id: `setup.texting`. */
  id: string;
  name: string;
  blurb: string;
  /** The kind of account it sets up. */
  site: RegistrySite;
  steps: readonly SetupStep[];
  /** Check every fact again this often once done; a failed one starts it over. */
  repeat?: string;
}

export const defineSetup = (s: Setup): Setup => s;

export const SETUP_STEP = "setup.step";

const ACCOUNT_IN: Port = { id: "account", label: "accounts", kind: "account" };

/** A setup as the spine runs it: a line of steps, each with a self wire for its next check. */
export function setupWorkflow(s: Setup): Workflow {
  const wires: Wire[] = [];
  s.steps.forEach((st, i) => {
    const prev = i === 0 ? "in.accounts" : `${s.steps[i - 1]?.id}.done`;
    wires.push({ from: prev, to: `${st.id}.account`, via: "events" });
    if (st.every)
      wires.push({ from: `${st.id}.again`, to: `${st.id}.account`, via: "events", wait: st.every });
  });
  const last = s.steps.at(-1);
  if (last) wires.push({ from: `${last.id}.done`, to: "out.done", via: "events" });
  return defineWorkflow({
    id: s.id,
    kind: "setup",
    name: s.name,
    blurb: s.blurb,
    icon: "check",
    for: "client",
    stage: "run",
    in: [{ id: "accounts", label: "accounts to set up", kind: "account" }],
    out: [{ id: "done", label: "accounts set up", kind: "account" }],
    nodes: s.steps.map((st) => ({
      id: st.id,
      own: {
        name: st.label,
        blurb: st.how,
        icon: st.who === "auto" ? "clock" : "check",
        in: [ACCOUNT_IN],
        out: [
          { id: "done", label: "done", kind: "account" },
          { id: "again", label: "checks again", kind: "account" },
        ],
        run: SETUP_STEP,
      },
      note: st.label,
      with: { setup: s.id, step: st.id },
    })),
    wires,
  });
}

// ---- subjects ----

/** A run's subject: `account:<id>:g<gen>`; a check's round adds `#<n>`. */
export const setupSubject = (accountId: number, gen: number) => `account:${accountId}:g${gen}`;

export function parseSetupSubject(
  subject: string,
): { accountId: number; gen: number; base: string } | null {
  const m = /^account:(\d+):g(\d+)(?:#[a-z0-9]+)?$/.exec(subject);
  if (!m) return null;
  const accountId = Number(m[1]);
  const gen = Number(m[2]);
  return { accountId, gen, base: setupSubject(accountId, gen) };
}

const accountEvent = (subject: string, accountId: number): SpineEvent => ({
  subject,
  kind: "account",
  data: { account: accountId },
});

/** Events into a setup: what the caller hands `spineEmit` (or the spine's `emit`). */
export interface SetupEmit {
  client: string | null;
  workflow: string;
  from: string;
  events: SpineEvent[];
}

// ---- checks ----

export interface CheckResult {
  ok: boolean;
  /** Said to a person: what it saw, or what's missing. */
  why: string;
  seen?: unknown;
}
export type SetupCheck = (c: { account: AccountRow; now: Date }) => Promise<CheckResult>;

const TXT = (rs: string[]) => rs.map((r) => r.replace(/^"|"$/g, "").replace(/" "/g, ""));

/** The free checks that read DNS (over HTTPS): a domain's mail records and Postmaster's TXT. */
export function dnsChecks(resolve: Resolver): Record<string, SetupCheck> {
  const ask = async (name: string, t: DnsType) => TXT(await resolve(name, t));
  return {
    "dns.answers": async ({ account }) => {
      const a = [...(await ask(account.ref, "A")), ...(await ask(account.ref, "MX"))];
      return a.length
        ? { ok: true, why: "The domain answers", seen: a }
        : { ok: false, why: "The domain has no records yet" };
    },
    "dns.mail_records": async ({ account }) => {
      const d = account.ref;
      const mx = await ask(d, "MX");
      const spf = (await ask(d, "TXT")).filter((r) => r.startsWith("v=spf1"));
      const dmarc = (await ask(`_dmarc.${d}`, "TXT")).filter((r) => r.startsWith("v=DMARC1"));
      const missing = [
        ...(mx.length ? [] : ["MX"]),
        ...(spf.length === 1 ? [] : [spf.length ? "one SPF record (there are two)" : "SPF"]),
        ...(dmarc.length ? [] : ["DMARC"]),
      ];
      return missing.length
        ? { ok: false, why: `Missing ${missing.join(", ")}`, seen: { mx, spf, dmarc } }
        : { ok: true, why: "MX, SPF and DMARC are set", seen: { mx, spf, dmarc } };
    },
    "dns.postmaster_txt": async ({ account }) => {
      const v = (await ask(account.ref, "TXT")).filter((r) =>
        r.startsWith("google-site-verification="),
      );
      return v.length
        ? { ok: true, why: "Google's TXT record is there", seen: v }
        : { ok: false, why: "No google-site-verification TXT record yet" };
    },
  };
}

// ---- the registry ----

export async function addAccount(
  main: Db,
  a: {
    client: string | null;
    site: RegistrySite;
    ref: string;
    role?: string;
    mode?: SetupMode;
    login?: string | null;
    by: string;
  },
): Promise<AccountRow> {
  const ref = a.ref.trim();
  if (!ref || ref.length > 200) throw new Error("account: 1 to 200 characters");
  if (!(REGISTRY_SITES as readonly string[]).includes(a.site)) throw new Error("no such site");
  await main
    .insert(clientAccounts)
    .values({
      client: a.client,
      site: a.site,
      ref,
      role: a.role ?? "main",
      mode: a.mode ?? "self",
      login: a.login ?? null,
      createdBy: a.by,
    })
    .onConflictDoNothing();
  const [row] = await main
    .select()
    .from(clientAccounts)
    .where(
      and(
        a.client === null ? isNull(clientAccounts.client) : eq(clientAccounts.client, a.client),
        eq(clientAccounts.site, a.site),
        eq(clientAccounts.ref, ref),
      ),
    );
  if (!row) throw new Error("account: insert returned nothing");
  return row;
}

export interface AccountView extends AccountRow {
  facts: FactRow[];
  runs: SetupRunRow[];
}

/** An owner's accounts, each with its facts and setup runs: the Accounts page. */
export async function accountsOf(main: Queryable, client: string | null): Promise<AccountView[]> {
  const rows = await main
    .select()
    .from(clientAccounts)
    .where(client === null ? isNull(clientAccounts.client) : eq(clientAccounts.client, client))
    .orderBy(asc(clientAccounts.site), asc(clientAccounts.ref));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const facts = await main.select().from(accountFacts).where(inArray(accountFacts.accountId, ids));
  const runs = await main.select().from(setupRuns).where(inArray(setupRuns.accountId, ids));
  return rows.map((r) => ({
    ...r,
    facts: facts.filter((f) => f.accountId === r.id).sort((a, b) => a.fact.localeCompare(b.fact)),
    runs: runs.filter((x) => x.accountId === r.id),
  }));
}

/** The facts true now for an owner, over all its accounts. */
export async function factsHeld(main: Queryable, client: string | null): Promise<Set<string>> {
  const rows = await main
    .select({ fact: accountFacts.fact })
    .from(accountFacts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, accountFacts.accountId))
    .where(
      and(
        client === null ? isNull(clientAccounts.client) : eq(clientAccounts.client, client),
        eq(accountFacts.state, "ok"),
      ),
    );
  return new Set(rows.map((r) => r.fact));
}

/** The facts a part needs that the owner doesn't hold. */
export const factsLacking = (c: Pick<Component, "requires">, held: ReadonlySet<string>) =>
  c.requires.facts.filter((f) => !held.has(f));

/** The setup that makes a fact true, and the step: where "Needs your account" links. */
export function setupOf(
  fact: string,
  setups: Iterable<Setup>,
): { setup: Setup; step: SetupStep } | null {
  for (const s of setups) {
    const step = s.steps.find((x) => x.fact === fact);
    if (step) return { setup: s, step };
  }
  return null;
}

/** What a fact was before a write: its state and when it last became true. */
export interface FactWas {
  from: FactState | null;
  okAt: Date | null;
}

async function setFact(
  db: Queryable,
  accountId: number,
  fact: string,
  state: FactState,
  o: { why: string | null; seen?: unknown; by: string; now: Date },
): Promise<FactWas> {
  const [was] = await db
    .select({ state: accountFacts.state, okAt: accountFacts.okAt })
    .from(accountFacts)
    .where(and(eq(accountFacts.accountId, accountId), eq(accountFacts.fact, fact)));
  const values = {
    accountId,
    fact,
    state,
    why: o.why === null ? null : pgSafe(o.why).slice(0, 500),
    seen: o.seen === undefined ? null : pgSafe(o.seen),
    by: o.by,
    checkedAt: o.now,
    okAt: state === "ok" ? o.now : null,
  };
  await db
    .insert(accountFacts)
    .values(values)
    .onConflictDoUpdate({
      target: [accountFacts.accountId, accountFacts.fact],
      set: {
        state,
        why: values.why,
        seen: values.seen,
        by: o.by,
        checkedAt: o.now,
        // When it became true: kept while it stays true.
        okAt:
          state === "ok"
            ? sql`case when ${accountFacts.state} = 'ok' then ${accountFacts.okAt} else ${o.now.toISOString()}::timestamptz end`
            : null,
      },
    });
  return { from: was?.state ?? null, okAt: was?.okAt ?? null };
}

/** Alerts' view of where a fact's account and setup stand. */
interface Moved {
  parts?: readonly AlertPart[] | undefined;
  setups: readonly Setup[];
}

/** A fact moved: lost, or back. The alerts (and the parts paused on it) follow (`factMoved`). */
async function moved(
  db: Queryable,
  d: Moved,
  acct: { id: number; client: string | null; site: string },
  fact: string,
  was: FactWas,
  to: FactState,
  why: string | null,
  now: Date,
  mode: SetupMode | null = null,
): Promise<void> {
  const made = setupOf(fact, d.setups);
  await factMoved(db, {
    account: acct,
    siteLabel: siteLabel(acct.site),
    fact,
    factLabel: made?.step.label ?? fact,
    step: made?.step ?? null,
    setup: made ? { id: made.setup.id, name: made.setup.name } : null,
    mode,
    from: was.from,
    to,
    okAt: was.okAt,
    why,
    parts: d.parts ?? [],
    now,
  });
}

async function account(main: Queryable, id: number) {
  const [row] = await main.select().from(clientAccounts).where(eq(clientAccounts.id, id));
  return row ?? null;
}

async function runOf(main: Queryable, accountId: number, setup: string) {
  const [row] = await main
    .select()
    .from(setupRuns)
    .where(and(eq(setupRuns.accountId, accountId), eq(setupRuns.setup, setup)));
  return row ?? null;
}

/**
 * Start a setup on an account, or start it over once it's done, lost or stuck (the next
 * generation). One in flight answers its own subject again, which the spine has already seen.
 */
export async function startSetup(
  main: Db,
  s: Setup,
  o: { accountId: number; mode?: SetupMode; by: string; now?: Date },
): Promise<SetupEmit> {
  const now = o.now ?? new Date();
  const acct = await account(main, o.accountId);
  if (!acct) throw new Error("no such account");
  if (acct.site !== s.site) throw new Error(`${s.name} sets up ${s.site}, not ${acct.site}`);
  const first = s.steps[0];
  if (!first) throw new Error(`${s.id} has no steps`);
  const run = await atomic(main, async (tx) => {
    const old = await runOf(tx, acct.id, s.id);
    const mode = o.mode ?? old?.mode ?? acct.mode;
    if (old && (old.state === "checking" || old.state.startsWith("waiting")) && !o.mode) return old;
    const fresh = {
      mode,
      state: "checking" as SetupState,
      step: first.id,
      why: null,
      rounds: 0,
      stepSince: now,
      startedAt: now,
      doneAt: null,
      nextCheckAt: null,
      by: o.by,
    };
    if (!old) {
      const [row] = await tx
        .insert(setupRuns)
        .values({ accountId: acct.id, setup: s.id, gen: 1, ...fresh })
        .returning();
      return row as SetupRunRow;
    }
    const [row] = await tx
      .update(setupRuns)
      .set({ ...fresh, gen: old.gen + 1 })
      .where(eq(setupRuns.id, old.id))
      .returning();
    return row as SetupRunRow;
  });
  return {
    client: acct.client,
    workflow: s.id,
    from: "in.accounts",
    events: [accountEvent(setupSubject(acct.id, run.gen), acct.id)],
  };
}

/**
 * A person says a step is done: its fact is true now, and a fresh round goes into that step so
 * the run moves on without waiting for its next check.
 */
export async function markStep(
  main: Db,
  s: Setup,
  o: {
    accountId: number;
    step: string;
    by: string;
    now?: Date;
    /** Parts that need facts: a fact back resumes them. */
    parts?: readonly AlertPart[];
  },
): Promise<SetupEmit | null> {
  const now = o.now ?? new Date();
  const i = s.steps.findIndex((x) => x.id === o.step);
  const step = s.steps[i];
  if (!step) throw new Error("no such step");
  const acct = await account(main, o.accountId);
  if (!acct) throw new Error("no such account");
  const why = `Marked done by ${o.by}`;
  const was = await setFact(main, acct.id, step.fact, "ok", { why, by: o.by, now });
  const run = await runOf(main, acct.id, s.id);
  await moved(main, { parts: o.parts, setups: [s] }, acct, step.fact, was, "ok", why, now);
  // Not the step it's on: the fact stands, and the run passes it when it gets there.
  if (!run || run.step !== step.id) return null;
  return {
    client: acct.client,
    workflow: s.id,
    from: i === 0 ? "in.accounts" : `${s.steps[i - 1]?.id}.done`,
    events: [accountEvent(`${setupSubject(acct.id, run.gen)}#m${now.getTime()}`, acct.id)],
  };
}

/**
 * Check a waiting step now, not at its next round: a fresh round into the step it's on. Null when
 * the run isn't on a step (done, or never started).
 */
export async function checkNow(
  main: Queryable,
  s: Setup,
  o: { accountId: number; now?: Date },
): Promise<SetupEmit | null> {
  const now = o.now ?? new Date();
  const acct = await account(main, o.accountId);
  if (!acct) throw new Error("no such account");
  const run = await runOf(main, acct.id, s.id);
  const i = run?.step ? s.steps.findIndex((x) => x.id === run.step) : -1;
  if (!run || i < 0) return null;
  return {
    client: acct.client,
    workflow: s.id,
    from: i === 0 ? "in.accounts" : `${s.steps[i - 1]?.id}.done`,
    events: [accountEvent(`${setupSubject(acct.id, run.gen)}#c${now.getTime()}`, acct.id)],
  };
}

/**
 * A part's call failed for an account reason (a 403, a carrier block): every account of the
 * owner on `site` holding `fact` loses it, and each setup that made it starts over.
 */
export async function factLost(
  main: Db,
  setups: readonly Setup[],
  o: {
    client: string | null;
    site: RegistrySite;
    fact: string;
    why: string;
    by: string;
    parts?: readonly AlertPart[];
  },
  now: Date = new Date(),
): Promise<SetupEmit[]> {
  const rows = await main
    .select({ id: clientAccounts.id, mode: clientAccounts.mode })
    .from(accountFacts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, accountFacts.accountId))
    .where(
      and(
        o.client === null ? isNull(clientAccounts.client) : eq(clientAccounts.client, o.client),
        eq(clientAccounts.site, o.site),
        eq(accountFacts.fact, o.fact),
        eq(accountFacts.state, "ok"),
      ),
    );
  const out: SetupEmit[] = [];
  const made = setupOf(o.fact, setups);
  for (const r of rows) {
    const was = await setFact(main, r.id, o.fact, "lost", { why: o.why, by: o.by, now });
    const acct = { id: r.id, client: o.client, site: o.site };
    await moved(main, { parts: o.parts, setups }, acct, o.fact, was, "lost", o.why, now, r.mode);
    if (!made) continue;
    await main
      .update(setupRuns)
      .set({ state: "lost", why: o.why })
      .where(and(eq(setupRuns.accountId, r.id), eq(setupRuns.setup, made.setup.id)));
    out.push(await startSetup(main, made.setup, { accountId: r.id, by: o.by, now }));
  }
  return out;
}

/**
 * Done runs whose repeat is due: check each fact again. All still true: next check after the
 * repeat. One false: it's lost, the run is lost, and it starts over (the next generation).
 */
export async function recheck(
  main: Db,
  setups: readonly Setup[],
  checks: Readonly<Record<string, SetupCheck>>,
  o: { now: Date; limit?: number; parts?: readonly AlertPart[] },
): Promise<{ checked: number; lost: number; emits: SetupEmit[] }> {
  const due = await main
    .select()
    .from(setupRuns)
    .where(and(eq(setupRuns.state, "done"), lte(setupRuns.nextCheckAt, o.now)))
    .orderBy(asc(setupRuns.nextCheckAt))
    .limit(o.limit ?? 50);
  const emits: SetupEmit[] = [];
  let lost = 0;
  for (const run of due) {
    const s = setups.find((x) => x.id === run.setup);
    const acct = await account(main, run.accountId);
    if (!s || !acct) continue;
    let failed: { step: SetupStep; r: CheckResult } | null = null;
    for (const step of s.steps) {
      const c = step.check ? checks[step.check] : undefined;
      if (!c) continue;
      const r = await c({ account: acct, now: o.now });
      const by = `check:${step.check}`;
      const to = r.ok ? "ok" : "lost";
      const was = await setFact(main, acct.id, step.fact, to, { ...r, by, now: o.now });
      const d = { parts: o.parts, setups };
      await moved(main, d, acct, step.fact, was, to, r.why, o.now, run.mode);
      if (!r.ok) {
        failed = { step, r };
        break;
      }
    }
    if (failed) {
      lost++;
      await main
        .update(setupRuns)
        .set({ state: "lost", why: `${failed.step.label}: ${failed.r.why}` })
        .where(eq(setupRuns.id, run.id));
      emits.push(await startSetup(main, s, { accountId: acct.id, by: "recheck", now: o.now }));
    } else
      await main
        .update(setupRuns)
        .set({ nextCheckAt: s.repeat ? new Date(o.now.getTime() + waitMs(s.repeat)) : null })
        .where(eq(setupRuns.id, run.id));
  }
  return { checked: due.length, lost, emits };
}

/**
 * Runs past their step's `within` that no round will catch: a step waiting on a person has no
 * `every`, so nothing checks it again. Each turns stuck once and alerts, as a round would.
 */
export async function sweepStuck(main: Db, setups: readonly Setup[], now: Date): Promise<number> {
  const open = await main
    .select({ run: setupRuns, acct: clientAccounts })
    .from(setupRuns)
    .innerJoin(clientAccounts, eq(clientAccounts.id, setupRuns.accountId))
    .where(inArray(setupRuns.state, ["checking", "waiting_client", "waiting_wren"]));
  let n = 0;
  for (const { run, acct } of open) {
    const s = setups.find((x) => x.id === run.setup);
    const step = s?.steps.find((x) => x.id === run.step);
    // A step with `every` has rounds of its own, and they turn it stuck.
    if (!s || !step?.within || step.every) continue;
    if (now.getTime() - run.stepSince.getTime() <= waitMs(step.within)) continue;
    const turned = await main
      .update(setupRuns)
      .set({
        state: "stuck",
        why: `Stuck past ${step.within}: ${run.why ?? step.label}`,
        nextCheckAt: null,
      })
      .where(
        and(
          eq(setupRuns.id, run.id),
          eq(setupRuns.gen, run.gen),
          eq(setupRuns.step, step.id),
          inArray(setupRuns.state, ["checking", "waiting_client", "waiting_wren"]),
        ),
      )
      .returning({ id: setupRuns.id });
    if (!turned.length) continue;
    n++;
    await setupAlert(main, {
      kind: "stuck",
      account: acct,
      siteLabel: siteLabel(acct.site),
      setup: s,
      step,
      mode: run.mode,
      why: run.why,
      change: `${s.id}:g${run.gen}:${step.id}`,
      now,
    });
  }
  return n;
}

// ---- the step on the spine ----

export interface SetupDeps {
  main: Db;
  setups: readonly Setup[];
  checks: Readonly<Record<string, SetupCheck>>;
  /** Hands a done-for-you step to the agent (`SetupAgent`); none: they wait on Wren's team. */
  agent?: AgentQueue | null;
  /** Wren's team's lane for an owner's setups (null is Wren's own); none: nobody is told. */
  notifierFor?: (client: string | null) => Notifier | null;
  /** Parts that need facts (the worker's COMPONENTS): a lost fact pauses them, a fact back resumes. */
  parts?: readonly AlertPart[];
  now?: () => Date;
}

/** Said when a done-for-you step can't go on its own. */
export const WAITING_ON_WREN = "Waiting on Wren's team";
/** Said while the agent works a step. */
export const AGENT_ON_IT = "Wren's agent is on it";

/**
 * A done-for-you step for the agent. It runs in the account owner's autobrowse (`owner`: the
 * client, or Wren for Wren's own), never in Wren's for a client.
 */
export interface AgentJob {
  accountId: number;
  gen: number;
  setup: string;
  step: string;
  owner: string;
  request: DoRequest;
}

/** Queue a job; its answer comes back through `agentDone`. One job per account, generation and step. */
export type AgentQueue = (job: AgentJob, key: string) => Promise<void>;

/** The agent's answer: the fact is true, or why it isn't. */
export interface AgentAnswer {
  done: boolean;
  why: string;
}

/**
 * The agent finished a step. Done: the fact holds and a fresh round moves the run on. Not done:
 * the run says why and waits on Wren's team. A run started over or past the step since is left be.
 */
export async function agentDone(
  main: Db,
  s: Setup,
  job: AgentJob,
  out: AgentAnswer,
  now: Date = new Date(),
  parts: readonly AlertPart[] = [],
): Promise<SetupEmit | null> {
  const i = s.steps.findIndex((x) => x.id === job.step);
  const step = s.steps[i];
  const acct = step ? await account(main, job.accountId) : null;
  const run = acct && (await runOf(main, acct.id, s.id));
  if (!step || !acct || !run || run.gen !== job.gen || run.step !== job.step) return null;
  if (out.done) {
    const was = await setFact(main, acct.id, step.fact, "ok", { why: out.why, by: "agent", now });
    await moved(main, { parts, setups: [s] }, acct, step.fact, was, "ok", out.why, now, run.mode);
    return {
      client: acct.client,
      workflow: s.id,
      from: i === 0 ? "in.accounts" : `${s.steps[i - 1]?.id}.done`,
      events: [accountEvent(`${setupSubject(acct.id, run.gen)}#a${now.getTime()}`, acct.id)],
    };
  }
  const why = `The agent couldn't: ${out.why}`.slice(0, 2000);
  const set = await main
    .update(setupRuns)
    .set({ state: "waiting_wren", why })
    .where(
      and(
        eq(setupRuns.id, run.id),
        eq(setupRuns.gen, job.gen),
        eq(setupRuns.step, job.step),
        ne(setupRuns.state, "stuck"),
      ),
    )
    .returning({ id: setupRuns.id });
  // The agent stopped: now it waits on a person on Wren's team.
  if (set.length)
    await setupAlert(main, {
      kind: "waiting",
      account: acct,
      siteLabel: siteLabel(acct.site),
      setup: { id: s.id, name: s.name },
      step,
      mode: "for_you",
      why,
      change: `${s.id}:g${run.gen}:${step.id}:agent`,
      now,
    });
  return null;
}

/** What a step waiting on someone says, and whose turn it is. */
function waiting(step: SetupStep, mode: SetupMode): { state: SetupState; why: string } {
  if (step.who === "auto") return { state: "checking", why: step.label };
  if (step.who === "client" && mode === "self") return { state: "waiting_client", why: step.how };
  return { state: "waiting_wren", why: step.forYou };
}

/**
 * `setup.step`: is this step's fact true? Then on to the next step. Else run its check (and, done
 * for you, its agent once), record why it waits, and go round again after its `every`.
 */
export function setupStep(d: SetupDeps): Step {
  const byId = new Map(d.setups.map((s) => [s.id, s]));
  return async (_port, e, at) => {
    const now = d.now?.() ?? new Date();
    const subj = parseSetupSubject(e.subject);
    const s = byId.get(String(at.with.setup));
    const i = s ? s.steps.findIndex((x) => x.id === at.with.step) : -1;
    const step = s?.steps[i];
    if (!subj || !s || !step) return [];
    const acct = await account(d.main, subj.accountId);
    const run = acct && (await runOf(d.main, acct.id, s.id));
    // Another owner's account, a round from before a restart, or a step the run isn't on.
    if (!acct || !run || run.gen !== subj.gen || acct.client !== at.client) return [];
    if (run.step !== step.id) return [];
    const done = [{ port: "done", event: accountEvent(subj.base, acct.id) }];
    const advance = () =>
      d.main
        .update(setupRuns)
        .set(
          i === s.steps.length - 1
            ? {
                state: "done",
                step: null,
                why: null,
                doneAt: now,
                nextCheckAt: s.repeat ? new Date(now.getTime() + waitMs(s.repeat)) : null,
              }
            : {
                state: "checking",
                step: s.steps[i + 1]?.id ?? null,
                why: null,
                rounds: 0,
                stepSince: now,
                nextCheckAt: null,
              },
        )
        // An old round of a step already passed moves nothing.
        .where(and(eq(setupRuns.id, run.id), eq(setupRuns.step, step.id)))
        .returning({ id: setupRuns.id })
        .then(async (moved) => {
          if (!moved.length) return;
          await clearStep(d.main, { accountId: acct.id, setup: s.id, step: step.id, now });
          if (i === s.steps.length - 1)
            await setupAlert(d.main, {
              kind: "done",
              account: acct,
              siteLabel: siteLabel(acct.site),
              setup: { id: s.id, name: s.name },
              mode: run.mode,
              why: null,
              change: `${s.id}:g${run.gen}`,
              now,
            });
          await tellAlerts(d.main, d.notifierFor, now);
        });
    const facts = { parts: d.parts, setups: d.setups };

    const [held] = await d.main
      .select()
      .from(accountFacts)
      .where(and(eq(accountFacts.accountId, acct.id), eq(accountFacts.fact, step.fact)));
    if (held?.state === "ok") {
      await advance();
      return done;
    }

    let { state, why } = waiting(step, run.mode);
    let seen: unknown;
    const check = step.check ? d.checks[step.check] : undefined;
    if (check) {
      const r = await check({ account: acct, now });
      if (r.ok) {
        await atomic(d.main, async (tx) => {
          const by = `check:${step.check}`;
          const was = await setFact(tx, acct.id, step.fact, "ok", { ...r, by, now });
          await moved(tx, facts, acct, step.fact, was, "ok", r.why, now, run.mode);
        });
        await advance();
        return done;
      }
      if (step.who === "auto") why = r.why;
      seen = r.seen;
    } else if (step.check && step.who === "auto") why = "Check in development";

    // Wren's steps, and every step done for you: the agent tries once per step, never on later rounds.
    const ours = step.who === "wren" || (run.mode === "for_you" && step.who === "client");
    if (ours && step.goal && run.rounds === 0) {
      // Wren's own buys are spend too: William says yes by hand, so they wait on the team.
      const [owner] = acct.client
        ? await d.main
            .select({ buysOk: clients.buysOk })
            .from(clients)
            .where(eq(clients.id, acct.client))
        : [{ buysOk: false }];
      if (step.buys && !owner?.buysOk) {
        state = "waiting_wren";
        why = WAITING_ON_WREN;
      } else if (d.agent) {
        const job: AgentJob = {
          accountId: acct.id,
          gen: run.gen,
          setup: s.id,
          step: step.id,
          owner: acct.client ?? DO_OWNER,
          request: {
            goal: step.goal,
            inputs: {
              account: acct.ref,
              site: acct.site,
              ...(acct.client ? { client: acct.client } : {}),
              ...(acct.login ? { login: acct.login } : {}),
            },
          },
        };
        state = "waiting_wren";
        try {
          await d.agent(job, `setup-agent:${acct.id}:g${run.gen}:${step.id}`);
          why = AGENT_ON_IT;
        } catch {
          why = WAITING_ON_WREN;
        }
      } else {
        state = "waiting_wren";
        why = WAITING_ON_WREN;
      }
    }

    const stuck = !!step.within && now.getTime() - run.stepSince.getTime() > waitMs(step.within);
    // A vendor's review past its time is stuck and told once, but its check keeps going: the
    // run moves on its own the day the vendor says yes.
    const again = !!step.every && (!stuck || (step.who === "auto" && !!check));
    // Later rounds of the team's steps keep what the agent or the last round said.
    if (ours && step.goal && run.rounds > 0 && run.state === "waiting_wren" && run.why)
      why = run.why;
    const cause = why;
    if (stuck) {
      state = "stuck";
      why = `Stuck past ${step.within}: ${why}`;
    }
    const turnedStuck = await atomic(d.main, async (tx) => {
      // A lost fact stays lost until it's true again: its part stays paused meanwhile.
      await setFact(tx, acct.id, step.fact, held?.state === "lost" ? "lost" : "waiting", {
        why,
        seen,
        by: step.check ? `check:${step.check}` : "setup",
        now,
      });
      // Only the round that turns it stuck tells the team: a check now on a stuck run doesn't.
      const turned = stuck
        ? await tx
            .update(setupRuns)
            .set({ state: "stuck" })
            .where(and(eq(setupRuns.id, run.id), ne(setupRuns.state, "stuck")))
            .returning({ id: setupRuns.id })
        : [];
      await tx
        .update(setupRuns)
        .set({
          state,
          why,
          step: step.id,
          rounds: sql`${setupRuns.rounds} + 1`,
          nextCheckAt: again && step.every ? new Date(now.getTime() + waitMs(step.every)) : null,
        })
        .where(eq(setupRuns.id, run.id));
      return turned.length > 0;
    });
    const alert = { account: acct, siteLabel: siteLabel(acct.site), setup: s, step, now };
    if (turnedStuck)
      await setupAlert(d.main, {
        ...alert,
        kind: "stuck",
        mode: run.mode,
        why: cause,
        change: `${s.id}:g${run.gen}:${step.id}`,
      });
    // Waiting on a person (not a check, not the agent at work): once per step and whose turn.
    if ((state === "waiting_client" || state === "waiting_wren") && why !== AGENT_ON_IT)
      await setupAlert(d.main, {
        ...alert,
        kind: "waiting",
        mode: state === "waiting_wren" ? "for_you" : "self",
        why,
        change: `${s.id}:g${run.gen}:${step.id}:${state}`,
      });
    await tellAlerts(d.main, d.notifierFor, now);
    if (!again) return [];
    return [{ port: "again", event: accountEvent(`${subj.base}#${run.rounds + 1}`, acct.id) }];
  };
}
