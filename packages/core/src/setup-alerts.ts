/**
 * Setup alerts (designs/2026-10-07-setup-and-vendors.md, Alerts): every setup state change that
 * matters goes through `setupAlert`. A fact lost, a step stuck, a step waiting on a person, a
 * setup done, a part paused or resumed because of a fact. One row per state change (its `key`),
 * never one per check round; it stays open until the state it reports changes.
 *
 * Routing is by who must act. The client's people: a client step, self-serve. They see it on
 * their Now and the Accounts badge, as far as their role reaches the Account app. Wren's team:
 * done for you, or waiting on Wren. They see it on console Now and hear it on the clients lane
 * (`tellAlerts`). Lost and stuck reach the team whoever acts. Never an Inbox: Inbox is inbound.
 */
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { clients, type SetupMode } from "./clients/schema.js";
import type { Component } from "./components.js";
import type { Notifier, NotifyLevel } from "./notify.js";
import {
  type AlertFor,
  type AlertKind,
  type AlertRow,
  accountFacts,
  clientAccounts,
  type FactState,
  setupAlerts,
} from "./setup-schema.js";

/** A part as alerts read it: what it needs. */
export type AlertPart = Pick<Component, "id" | "name" | "requires">;

/** A step as alerts read it. */
export interface AlertStep {
  id: string;
  label: string;
  fact: string;
  who: "client" | "wren" | "auto";
  within?: string;
}

export interface AlertAccount {
  id: number;
  client: string | null;
  site: string;
}

export interface AlertInput {
  kind: AlertKind;
  account: AlertAccount;
  /** The site as a person says it: "Sending domain". */
  siteLabel: string;
  setup?: { id: string; name: string } | null;
  step?: AlertStep | null;
  /** The run's mode: self-serve or done for you. */
  mode?: SetupMode | null;
  fact?: string | null;
  /** The fact as a person says it: its step's label. */
  factLabel?: string | null;
  part?: { id: string; name: string } | null;
  why?: string | null;
  /** The state change beyond kind and account, e.g. `setup.domain:g2:dns`. */
  change: string;
  now: Date;
}

/** Who must act. A client step, self-serve, is the client's; the rest is Wren's team's. */
export function alertFor(
  kind: AlertKind,
  step: Pick<AlertStep, "who"> | null | undefined,
  mode: SetupMode | null | undefined,
): AlertFor {
  if (kind === "paused" || kind === "resumed") return "client";
  if (kind === "done") return mode === "for_you" ? "wren" : "client";
  return step?.who === "client" && mode !== "for_you" ? "client" : "wren";
}

/** Lost or stuck: warning. Waiting on a person: action. The rest: info. */
export function alertLevel(kind: AlertKind): NotifyLevel {
  if (kind === "lost" || kind === "stuck") return "warning";
  return kind === "waiting" ? "action" : "info";
}

const cut = (s: string | null | undefined, n: number) =>
  s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null;

/** What the alert says, without the account's ref: the ref is the client's, the title travels. */
export function alertTitle(a: AlertInput): string {
  const what = a.factLabel ?? a.step?.label ?? a.fact ?? "";
  switch (a.kind) {
    case "lost":
      return `${a.siteLabel}: "${what}" lost`;
    case "stuck":
      return `${a.siteLabel}: "${a.step?.label ?? what}" stuck past ${a.step?.within ?? "its limit"}`;
    case "waiting":
      return `${a.siteLabel}: "${a.step?.label ?? what}" needs ${alertFor("waiting", a.step, a.mode) === "client" ? "you" : "Wren's team"}`;
    case "done":
      return `${a.siteLabel}: ${a.setup?.name ?? "setup"} done`;
    case "paused":
      return `${a.part?.name ?? "A part"} paused: needs "${what}"`;
    case "resumed":
      return `${a.part?.name ?? "A part"} running again`;
  }
}

/** Kinds an alert of `kind` settles: they're no longer the state, so they leave Now. */
const SETTLES: Record<AlertKind, AlertKind[]> = {
  lost: [],
  stuck: [],
  waiting: ["waiting"],
  done: ["waiting", "stuck", "lost"],
  paused: [],
  resumed: ["paused"],
};

/**
 * Record a setup state change, once. The first call for a `key` inserts the alert and answers
 * it; a later round for the same change answers null. An alert that settles others (a setup
 * done, a part back) clears them off Now in the same write.
 */
export async function setupAlert(db: Queryable, a: AlertInput): Promise<AlertRow | null> {
  const key = `${a.kind}:${a.account.id}:${a.change}`.slice(0, 200);
  const settled = a.kind === "done" || a.kind === "resumed";
  const [row] = await db
    .insert(setupAlerts)
    .values({
      key,
      client: a.account.client,
      accountId: a.account.id,
      kind: a.kind,
      for: alertFor(a.kind, a.step, a.mode),
      level: alertLevel(a.kind),
      setup: a.setup?.id ?? null,
      step: a.step?.id ?? null,
      fact: a.fact ?? a.step?.fact ?? null,
      part: a.part?.id ?? null,
      title: alertTitle(a),
      body: cut(a.why, 500),
      at: a.now,
      // A done or a resume is news, not a to-do: on the timeline, never open on Now.
      clearedAt: settled ? a.now : null,
    })
    .onConflictDoNothing({ target: setupAlerts.key })
    .returning();
  if (!row) return null;
  const kinds = SETTLES[a.kind];
  if (kinds.length)
    await db
      .update(setupAlerts)
      .set({ clearedAt: a.now })
      .where(
        and(
          isNull(setupAlerts.clearedAt),
          ne(setupAlerts.id, row.id),
          inArray(setupAlerts.kind, kinds),
          a.kind === "resumed"
            ? and(
                a.account.client === null
                  ? isNull(setupAlerts.client)
                  : eq(setupAlerts.client, a.account.client),
                eq(setupAlerts.part, a.part?.id ?? ""),
              )
            : and(
                eq(setupAlerts.accountId, a.account.id),
                eq(setupAlerts.setup, a.setup?.id ?? ""),
              ),
        ),
      );
  return row;
}

/** Clear what an account's step said once it passes: its waiting and stuck alerts. */
export async function clearStep(
  db: Queryable,
  o: { accountId: number; setup: string; step: string; now: Date },
): Promise<void> {
  await db
    .update(setupAlerts)
    .set({ clearedAt: o.now })
    .where(
      and(
        isNull(setupAlerts.clearedAt),
        eq(setupAlerts.accountId, o.accountId),
        eq(setupAlerts.setup, o.setup),
        eq(setupAlerts.step, o.step),
        inArray(setupAlerts.kind, ["waiting", "stuck"]),
      ),
    );
}

// ---- facts and parts ----

/** An owner's facts at their best over its accounts: ok anywhere is ok; else lost; else waiting. */
export async function factStates(
  db: Queryable,
  client: string | null,
): Promise<Map<string, FactState>> {
  const rows = await db
    .select({ fact: accountFacts.fact, state: accountFacts.state })
    .from(accountFacts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, accountFacts.accountId))
    .where(client === null ? isNull(clientAccounts.client) : eq(clientAccounts.client, client));
  const rank: Record<FactState, number> = { ok: 3, lost: 2, waiting: 1 };
  const out = new Map<string, FactState>();
  for (const r of rows) {
    const had = out.get(r.fact);
    if (!had || rank[r.state] > rank[had]) out.set(r.fact, r.state);
  }
  return out;
}

/**
 * A part pauses when a fact it needs was true and is lost (and no other account holds it). A
 * fact never set yet reads "Needs your account", as before: it pauses nothing that runs today.
 * Answers the first lost fact it needs, or null.
 */
export const pausedOn = (
  part: Pick<Component, "requires">,
  states: ReadonlyMap<string, FactState>,
): string | null => part.requires.facts.find((f) => states.get(f) === "lost") ?? null;

/** A client's installed parts paused now, with the fact each needs: canvas, Shop and Accounts read it. */
export async function pausedParts(
  db: Queryable,
  client: string | null,
  parts: readonly AlertPart[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (client === null) return out;
  const states = await factStates(db, client);
  if (![...states.values()].includes("lost")) return out;
  const [c] = await db
    .select({ products: clients.products })
    .from(clients)
    .where(eq(clients.id, client));
  const installed = new Set(Object.keys(c?.products ?? {}));
  for (const p of parts) {
    if (!installed.has(p.id)) continue;
    const f = pausedOn(p, states);
    if (f) out.set(p.id, f);
  }
  return out;
}

/**
 * Should a client's loop for `part` hold this pass? The fact it's paused on, or null. Wren's own
 * loops never pause here: they predate setups, and nothing of Wren's is set up through them yet.
 */
export async function partPaused(
  db: Queryable,
  client: string | null,
  part: Pick<Component, "requires">,
): Promise<string | null> {
  if (client === null || !part.requires.facts.length) return null;
  return pausedOn(part, await factStates(db, client));
}

/** "Paused: needs <fact>", the one way every surface says it. */
export const pausedText = (factLabel: string) => `Paused: needs ${factLabel}`;

/**
 * A fact moved on an account. True to lost: a lost alert, and each installed part that needs it
 * pauses (unless another account still holds it). Lost to true: each part paused on it resumes,
 * and the lost alert clears. `okAt` names the stretch it held, so each loss alerts once.
 */
export async function factMoved(
  db: Queryable,
  o: {
    account: AlertAccount;
    siteLabel: string;
    fact: string;
    factLabel: string;
    step: AlertStep | null;
    setup: { id: string; name: string } | null;
    mode: SetupMode | null;
    from: FactState | null;
    to: FactState;
    okAt: Date | null;
    why: string | null;
    parts: readonly AlertPart[];
    now: Date;
  },
): Promise<void> {
  const lost = o.from === "ok" && o.to === "lost";
  const back = o.from === "lost" && o.to === "ok";
  if (!lost && !back) return;
  const stretch = `${o.fact}:${o.okAt?.getTime() ?? "x"}`;
  const base = { account: o.account, siteLabel: o.siteLabel, now: o.now };
  if (lost)
    await setupAlert(db, {
      ...base,
      kind: "lost",
      setup: o.setup,
      step: o.step,
      mode: o.mode,
      fact: o.fact,
      factLabel: o.factLabel,
      why: o.why,
      change: stretch,
    });
  else
    await db
      .update(setupAlerts)
      .set({ clearedAt: o.now })
      .where(
        and(
          isNull(setupAlerts.clearedAt),
          eq(setupAlerts.accountId, o.account.id),
          eq(setupAlerts.fact, o.fact),
          eq(setupAlerts.kind, "lost"),
        ),
      );
  if (o.account.client === null) return;
  const needing = o.parts.filter((p) => p.requires.facts.includes(o.fact));
  if (!needing.length) return;
  const states = await factStates(db, o.account.client);
  const [c] = await db
    .select({ products: clients.products })
    .from(clients)
    .where(eq(clients.id, o.account.client));
  const installed = new Set(Object.keys(c?.products ?? {}));
  for (const p of needing) {
    if (!installed.has(p.id)) continue;
    if (lost && states.get(o.fact) === "lost")
      await setupAlert(db, {
        ...base,
        kind: "paused",
        mode: o.mode,
        fact: o.fact,
        factLabel: o.factLabel,
        part: p,
        why: o.why,
        change: `${p.id}:${stretch}`,
      });
    if (back) {
      // Resumes only where it paused: the paused alert names the same fact.
      const [open] = await db
        .select({ id: setupAlerts.id, key: setupAlerts.key })
        .from(setupAlerts)
        .where(
          and(
            isNull(setupAlerts.clearedAt),
            eq(setupAlerts.client, o.account.client),
            eq(setupAlerts.part, p.id),
            eq(setupAlerts.kind, "paused"),
            eq(setupAlerts.fact, o.fact),
          ),
        );
      if (open && pausedOn(p, states) === null)
        await setupAlert(db, {
          ...base,
          kind: "resumed",
          mode: o.mode,
          fact: o.fact,
          factLabel: o.factLabel,
          part: p,
          why: null,
          change: open.key.slice("paused:".length),
        });
    }
  }
}

// ---- telling the team ----

/** The team hears every alert but a client's own to-do (`waiting`, the client's): Now has those. */
const teamHears = or(ne(setupAlerts.for, "client"), ne(setupAlerts.kind, "waiting"));

/**
 * Tell Wren's team each alert not told yet, on the owner's lane, named by internal id and site
 * label only: no ref, no secret. Marked told whether or not the lane took it, so a lane that is
 * down never replays a backlog. A ping that fails is logged by the notifier.
 */
export async function tellAlerts(
  db: Queryable,
  notifierFor: ((client: string | null) => Notifier | null) | undefined,
  now: Date,
): Promise<number> {
  const rows = await db
    .select()
    .from(setupAlerts)
    .where(and(isNull(setupAlerts.toldAt), teamHears))
    .orderBy(asc(setupAlerts.id))
    .limit(50);
  let told = 0;
  for (const r of rows) {
    const marked = await db
      .update(setupAlerts)
      .set({ toldAt: now })
      .where(and(eq(setupAlerts.id, r.id), isNull(setupAlerts.toldAt)))
      .returning({ id: setupAlerts.id });
    if (!marked.length) continue;
    const n = notifierFor?.(r.client);
    if (!n) continue;
    const body = [
      `Account ${r.accountId}${r.setup ? `, ${r.setup}` : ""}${r.step ? ` (${r.step})` : ""}.`,
      cut(r.body, 300),
      r.for === "client"
        ? "The client acts: it's on their Now."
        : "Open Now, or the client's Accounts.",
    ]
      .filter(Boolean)
      .join("\n");
    if (await n.notify(r.title, body, r.level).catch(() => false)) told++;
  }
  return told;
}

const DAY_MS = 86_400_000;

/**
 * Once a day per owner: lost and stuck alerts still open after a day, in one message, never a
 * repeat of each. Each named one waits a day before the next digest names it again.
 */
export async function digestAlerts(
  db: Queryable,
  notifierFor: ((client: string | null) => Notifier | null) | undefined,
  now: Date,
): Promise<number> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select()
    .from(setupAlerts)
    .where(
      and(
        isNull(setupAlerts.clearedAt),
        inArray(setupAlerts.kind, ["lost", "stuck"]),
        lte(setupAlerts.at, dayAgo),
        or(isNull(setupAlerts.digestAt), lte(setupAlerts.digestAt, dayAgo)),
      ),
    )
    .orderBy(asc(setupAlerts.client), asc(setupAlerts.at));
  const byOwner = new Map<string, AlertRow[]>();
  for (const r of rows) {
    const k = r.client ?? "";
    byOwner.set(k, [...(byOwner.get(k) ?? []), r]);
  }
  for (const [owner, list] of byOwner) {
    await db
      .update(setupAlerts)
      .set({ digestAt: now })
      .where(
        inArray(
          setupAlerts.id,
          list.map((r) => r.id),
        ),
      );
    const n = notifierFor?.(owner || null);
    if (!n) continue;
    const days = (r: AlertRow) => Math.floor((now.getTime() - r.at.getTime()) / DAY_MS);
    await n
      .notify(
        `${list.length} setup ${list.length === 1 ? "item" : "items"} still open`,
        list
          .slice(0, 15)
          .map((r) => `- ${r.title} (account ${r.accountId}, ${days(r)}d)`)
          .join("\n"),
        "info",
      )
      .catch(() => false);
  }
  return byOwner.size;
}

// ---- reading ----

export interface AlertView {
  id: number;
  kind: AlertKind;
  for: AlertFor;
  level: string;
  client: string | null;
  accountId: number;
  site: string;
  ref: string;
  setup: string | null;
  step: string | null;
  fact: string | null;
  part: string | null;
  title: string;
  why: string | null;
  at: string;
  open: boolean;
}

const view = (r: AlertRow, a: { site: string; ref: string }): AlertView => ({
  id: r.id,
  kind: r.kind,
  for: r.for,
  level: r.level,
  client: r.client,
  accountId: r.accountId,
  site: a.site,
  ref: a.ref,
  setup: r.setup,
  step: r.step,
  fact: r.fact,
  part: r.part,
  title: r.title,
  why: r.body,
  at: r.at.toISOString(),
  open: r.clearedAt === null,
});

/**
 * Open alerts. `client` undefined: every owner (console Now); else one owner. `for` narrows to
 * who acts; a client's Now asks for its own and its paused parts.
 */
export async function openAlerts(
  db: Queryable,
  o: { client?: string | null; for?: AlertFor; limit?: number } = {},
): Promise<AlertView[]> {
  const rows = await db
    .select({ a: setupAlerts, site: clientAccounts.site, ref: clientAccounts.ref })
    .from(setupAlerts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, setupAlerts.accountId))
    .where(
      and(
        isNull(setupAlerts.clearedAt),
        o.client === undefined
          ? undefined
          : o.client === null
            ? isNull(setupAlerts.client)
            : eq(setupAlerts.client, o.client),
        o.for ? eq(setupAlerts.for, o.for) : undefined,
      ),
    )
    .orderBy(desc(setupAlerts.at))
    .limit(o.limit ?? 100);
  return rows.map((r) => view(r.a, r));
}

/**
 * A client's people's Now: what is theirs to do (open, `for: client`, paused parts included),
 * and what finished in the last three days (a setup done, a part back).
 */
export async function clientAlerts(
  db: Queryable,
  client: string,
  now: Date,
  limit = 50,
): Promise<AlertView[]> {
  const since = new Date(now.getTime() - 3 * DAY_MS);
  const rows = await db
    .select({ a: setupAlerts, site: clientAccounts.site, ref: clientAccounts.ref })
    .from(setupAlerts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, setupAlerts.accountId))
    .where(
      and(
        eq(setupAlerts.client, client),
        eq(setupAlerts.for, "client"),
        or(
          isNull(setupAlerts.clearedAt),
          and(inArray(setupAlerts.kind, ["done", "resumed"]), gte(setupAlerts.at, since)),
        ),
      ),
    )
    .orderBy(desc(setupAlerts.at))
    .limit(limit);
  return rows.map((r) => view(r.a, r));
}

/**
 * What a client's people are mailed: their open items raised in (since, now], a step theirs to
 * do, a fact lost, a part paused. The mail's own `toldThrough` keeps each to one mail.
 */
export async function clientMailAlerts(
  db: Queryable,
  client: string,
  since: Date,
  now: Date,
): Promise<AlertView[]> {
  const rows = await db
    .select({ a: setupAlerts, site: clientAccounts.site, ref: clientAccounts.ref })
    .from(setupAlerts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, setupAlerts.accountId))
    .where(
      and(
        eq(setupAlerts.client, client),
        eq(setupAlerts.for, "client"),
        inArray(setupAlerts.kind, ["waiting", "lost", "paused"]),
        isNull(setupAlerts.clearedAt),
        gt(setupAlerts.at, since),
        lte(setupAlerts.at, now),
      ),
    )
    .orderBy(asc(setupAlerts.id));
  return rows.map((r) => view(r.a, r));
}

/** Wren's team's open items: theirs to act on, and every lost or stuck one whoever acts. */
export async function teamAlerts(db: Queryable, limit = 100): Promise<AlertView[]> {
  const rows = await db
    .select({ a: setupAlerts, site: clientAccounts.site, ref: clientAccounts.ref })
    .from(setupAlerts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, setupAlerts.accountId))
    .where(
      and(
        isNull(setupAlerts.clearedAt),
        or(eq(setupAlerts.for, "wren"), inArray(setupAlerts.kind, ["lost", "stuck"])),
      ),
    )
    .orderBy(desc(setupAlerts.at))
    .limit(limit);
  return rows.map((r) => view(r.a, r));
}

/** Each account's timeline: its alerts newest first, open and settled. */
export async function alertTimeline(
  db: Queryable,
  accountIds: readonly number[],
  perAccount = 20,
): Promise<Map<number, AlertView[]>> {
  const out = new Map<number, AlertView[]>();
  if (!accountIds.length) return out;
  const rows = await db
    .select({ a: setupAlerts, site: clientAccounts.site, ref: clientAccounts.ref })
    .from(setupAlerts)
    .innerJoin(clientAccounts, eq(clientAccounts.id, setupAlerts.accountId))
    .where(inArray(setupAlerts.accountId, [...accountIds]))
    .orderBy(desc(setupAlerts.at), desc(setupAlerts.id))
    .limit(accountIds.length * perAccount);
  for (const r of rows) {
    const list = out.get(r.a.accountId) ?? [];
    if (list.length < perAccount) list.push(view(r.a, r));
    out.set(r.a.accountId, list);
  }
  return out;
}

/** Open counts per owner for a badge: `for` narrows to who acts. */
export async function openCount(
  db: Queryable,
  client: string | null,
  forWho?: AlertFor,
): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`count(*)` })
    .from(setupAlerts)
    .where(
      and(
        isNull(setupAlerts.clearedAt),
        client === null ? isNull(setupAlerts.client) : eq(setupAlerts.client, client),
        forWho ? eq(setupAlerts.for, forWho) : undefined,
      ),
    );
  return Number(r?.n ?? 0);
}
