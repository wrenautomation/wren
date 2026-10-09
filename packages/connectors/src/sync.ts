/**
 * One sync of a link (designs/2026-10-09-connectors.md): read what changed, land the people in the
 * client's CRM by the import a CSV export takes, and hand back what to tell the spine. Nothing from
 * before the link was made is news, and each change is told once (`connector_fired`).
 */
import type { FetchLike } from "@wren/core";
import type { Fired } from "@wren/core/spine";
import type { Db, Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import type { ConnectorApp } from "./apps.js";
import { type ConnectorAccess, ConnectorRefusal } from "./connectors.js";
import { pullHubspot } from "./pull/hubspot.js";
import { pullJobber } from "./pull/jobber.js";
import { pullQuickbooks } from "./pull/quickbooks.js";
import {
  PullError,
  type PulledChange,
  type PulledPerson,
  type Puller,
  RUN_CAP,
} from "./pull/types.js";
import { type ConnectorLink, connectorFired, connectorLinks } from "./schema.js";

export const PULLERS: Record<ConnectorApp, Puller> = {
  hubspot: pullHubspot,
  quickbooks: pullQuickbooks,
  jobber: pullJobber,
};

/**
 * Where people land: the client's CRM, by the import a CSV export takes. The worker passes
 * reactivation's (`crmLanding`); a foundation never imports a product.
 */
export interface CrmLanding {
  /** A CSV in `peopleCsv`'s headers, read as `format` (the app's name). */
  land(db: Queryable, o: { format: ConnectorApp; ref: string; csv: Uint8Array }): Promise<void>;
  /** What the CRM keeps for these app ids: their email and phone. */
  contacts(
    db: Queryable,
    format: ConnectorApp,
    ids: readonly string[],
  ): Promise<{ id: string; email: string | null; phone: string | null }[]>;
}

export interface SyncDeps {
  main: Db;
  /** The client's own database. */
  clientDb: (client: string) => Queryable;
  crm: CrmLanding;
  access: ConnectorAccess;
  fetch: FetchLike;
  pullers?: Partial<Record<ConnectorApp, Puller>>;
  cap?: number;
  now?: () => Date;
}

export interface SyncResult {
  /** connected: ran; broken or gone: nothing ran, don't come back. */
  state: "connected" | "broken" | "gone";
  people: number;
  fired: Fired[];
  /** Stopped at the cap: come back soon. */
  more: boolean;
  why: string | null;
}

const COLUMNS = [
  "id",
  "first name",
  "last name",
  "full name",
  "email",
  "phone",
  "company",
  "website",
  "title",
  "status",
  "created",
  "last contacted",
] as const;

const cell = (v: string | null): string => {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The people as a CSV the import reads by its generic headers. */
export function peopleCsv(people: readonly PulledPerson[]): string {
  const rows = people.map((p) =>
    [
      p.id,
      p.firstName,
      p.lastName,
      p.fullName,
      p.email,
      p.phone,
      p.company,
      p.website,
      p.title,
      p.status,
      p.created,
      p.lastContacted,
    ]
      .map(cell)
      .join(","),
  );
  return `${[COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

/** The newest of each person in a run: a contact changed twice reads twice. */
const latest = (people: readonly PulledPerson[]) => [
  ...new Map(people.map((p) => [p.id, p])).values(),
];

/** A change as the App trigger hears it, about the person's email and phone. */
export function appFired(
  l: Pick<ConnectorLink, "id" | "client" | "app">,
  c: PulledChange,
  who: { name: string | null; email: string | null; phone: string | null } | null,
): Fired {
  const email = who?.email?.toLowerCase() ?? null;
  return {
    client: l.client,
    facts: { trigger: "trigger.app", app: l.app, change: c.change },
    about: email ? [email] : [],
    event: {
      subject: `${l.app}:${c.key}`,
      kind: "person",
      data: {
        app: l.app,
        change: c.change,
        link: l.id,
        at: c.at,
        name: who?.name ?? null,
        email,
        phone: who?.phone ?? null,
        ...c.data,
      },
    },
  };
}

export async function syncLink(deps: SyncDeps, id: number): Promise<SyncResult> {
  const now = deps.now?.() ?? new Date();
  const none = (state: SyncResult["state"], why: string | null): SyncResult => ({
    state,
    people: 0,
    fired: [],
    more: false,
    why,
  });
  const l = await deps.access.link(id);
  if (!l) return none("gone", "no such link");
  if (l.state !== "connected") return none("broken", l.why);

  let token: string;
  try {
    token = await deps.access.tokenOf(l);
  } catch (err) {
    if (err instanceof ConnectorRefusal) return none("broken", err.message);
    throw err;
  }
  const pull = deps.pullers?.[l.app] ?? PULLERS[l.app];
  let got: Awaited<ReturnType<Puller>>;
  try {
    got = await pull({
      fetch: deps.fetch,
      token,
      extra: l.extra,
      cursor: l.cursor,
      cap: deps.cap ?? RUN_CAP,
    });
  } catch (err) {
    if (err instanceof PullError && err.auth) {
      await deps.access.broke(l.id, `${err.message}. Connect it again.`);
      return none("broken", err.message);
    }
    // The app's own trouble: said on the page, tried again next hour. Retrying now won't help.
    if (err instanceof PullError) {
      await deps.main
        .update(connectorLinks)
        .set({ why: `The last read failed: ${err.message}`.slice(0, 300) })
        .where(eq(connectorLinks.id, l.id));
      return none("connected", err.message);
    }
    throw err;
  }

  const db = deps.clientDb(l.client);
  const people = latest(got.people);
  if (people.length)
    await deps.crm.land(db, {
      format: l.app,
      ref: `${l.app}:${l.id}:${now.toISOString()}`,
      csv: new TextEncoder().encode(peopleCsv(people)),
    });

  // News only: after the link was made, and told once.
  const since = l.connectedAt.getTime();
  const fresh = got.changes.filter((c) => Date.parse(c.at) > since);
  const told = fresh.length
    ? await deps.main
        .insert(connectorFired)
        .values(fresh.map((c) => ({ linkId: l.id, key: c.key.slice(0, 160) })))
        .onConflictDoNothing()
        .returning({ key: connectorFired.key })
    : [];
  const newKeys = new Set(told.map((t) => t.key));
  const news = fresh.filter((c) => newKeys.has(c.key.slice(0, 160)));
  const ids = [...new Set(news.map((c) => c.person).filter((x): x is string => !!x))];
  const byId = new Map(people.map((p) => [p.id, p]));
  const kept = ids.length ? await deps.crm.contacts(db, l.app, ids) : [];
  const keptBy = new Map(kept.map((k) => [k.id, k]));
  const fired = news.map((c) => {
    const p = c.person ? byId.get(c.person) : undefined;
    const k = c.person ? keptBy.get(c.person) : undefined;
    const name =
      (p && (p.fullName ?? ([p.firstName, p.lastName].filter(Boolean).join(" ") || null))) ??
      (typeof c.data.customer === "string" ? c.data.customer : null);
    return appFired(l, c, {
      name,
      email:
        p?.email ?? k?.email ?? (typeof c.data.billEmail === "string" ? c.data.billEmail : null),
      phone: p?.phone ?? k?.phone ?? null,
    });
  });

  await deps.main
    .update(connectorLinks)
    .set({
      cursor: got.cursor,
      syncedAt: now,
      why: null,
      people: sql`${connectorLinks.people} + ${people.length}`,
      fired: sql`${connectorLinks.fired} + ${fired.length}`,
    })
    .where(eq(connectorLinks.id, l.id));
  return { state: "connected", people: people.length, fired, more: got.more, why: null };
}
