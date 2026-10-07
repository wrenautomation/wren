/**
 * Account setup (designs/2026-10-07-setup-and-vendors.md): a setup is a workflow of steps, each
 * making one named fact true on one account. It walks the spine like any workflow, one subject
 * per account and generation. A step that isn't true yet waits on its own self wire for its
 * `every`, then checks again, for as long as the status takes. Parts name the facts they need;
 * a lost fact sends the account's setup round again.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { clients, type SetupMode } from "./clients/schema.js";
import { ACCOUNT_SITES, ACCOUNTS, type Component, type Port } from "./components.js";
import type { Do } from "./content/do.js";
import type { DnsType, Resolver } from "./doh.js";
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

async function setFact(
  db: Queryable,
  accountId: number,
  fact: string,
  state: FactState,
  o: { why: string | null; seen?: unknown; by: string; now: Date },
) {
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
  o: { accountId: number; step: string; by: string; now?: Date },
): Promise<SetupEmit | null> {
  const now = o.now ?? new Date();
  const i = s.steps.findIndex((x) => x.id === o.step);
  const step = s.steps[i];
  if (!step) throw new Error("no such step");
  const acct = await account(main, o.accountId);
  if (!acct) throw new Error("no such account");
  await setFact(main, acct.id, step.fact, "ok", { why: `Marked done by ${o.by}`, by: o.by, now });
  const run = await runOf(main, acct.id, s.id);
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
  o: { client: string | null; site: RegistrySite; fact: string; why: string; by: string },
  now: Date = new Date(),
): Promise<SetupEmit[]> {
  const rows = await main
    .select({ id: clientAccounts.id })
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
    await setFact(main, r.id, o.fact, "lost", { why: o.why, by: o.by, now });
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
  o: { now: Date; limit?: number },
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
      if (r.ok) await setFact(main, acct.id, step.fact, "ok", { ...r, by, now: o.now });
      else {
        await setFact(main, acct.id, step.fact, "lost", { ...r, by, now: o.now });
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

// ---- the step on the spine ----

export interface SetupDeps {
  main: Db;
  setups: readonly Setup[];
  checks: Readonly<Record<string, SetupCheck>>;
  /** autobrowse's `do`, for done-for-you steps; none: they wait on Wren's team. */
  do?: Do | null;
  now?: () => Date;
}

/** Said when a done-for-you step can't go on its own. */
export const WAITING_ON_WREN = "Waiting on Wren's team";

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
        .where(and(eq(setupRuns.id, run.id), eq(setupRuns.step, step.id)));

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
          await setFact(tx, acct.id, step.fact, "ok", { ...r, by: `check:${step.check}`, now });
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
      } else if (d.do) {
        const out = await d.do({
          goal: step.goal,
          inputs: {
            account: acct.ref,
            site: acct.site,
            ...(acct.client ? { client: acct.client } : {}),
            ...(acct.login ? { login: acct.login } : {}),
          },
        });
        if (out.status === "done") {
          await setFact(d.main, acct.id, step.fact, "ok", {
            why: out.summary,
            by: "agent",
            now,
          });
          await advance();
          return done;
        }
        state = "waiting_wren";
        why = out.summary || WAITING_ON_WREN;
      } else {
        state = "waiting_wren";
        why = WAITING_ON_WREN;
      }
    }

    const stuck = !!step.within && now.getTime() - run.stepSince.getTime() > waitMs(step.within);
    if (stuck) {
      state = "stuck";
      why = `Stuck past ${step.within}: ${why}`;
    }
    await atomic(d.main, async (tx) => {
      await setFact(tx, acct.id, step.fact, "waiting", {
        why,
        seen,
        by: step.check ? `check:${step.check}` : "setup",
        now,
      });
      await tx
        .update(setupRuns)
        .set({
          state,
          why,
          step: step.id,
          rounds: sql`${setupRuns.rounds} + 1`,
          nextCheckAt: step.every && !stuck ? new Date(now.getTime() + waitMs(step.every)) : null,
        })
        .where(eq(setupRuns.id, run.id));
    });
    if (!step.every || stuck) return [];
    return [{ port: "again", event: accountEvent(`${subj.base}#${run.rounds + 1}`, acct.id) }];
  };
}
