/**
 * Access as records (designs/2026-10-06-scoped-access.md, "Pages"): roles, grants, issues and
 * asks for one workspace (a client, or `wren` for Wren's team), read by one login. Built per
 * request, since what a row says ("yours to decide") depends on who reads it. The console
 * serves them; the portal draws them with the List template like any other type.
 */
import type { Queryable } from "@wren/db";
import { desc, eq, sql } from "drizzle-orm";
import {
  ACCESS_CHANNELS,
  APPS,
  CHANNEL_NAMES,
  can,
  type Grant,
  live,
  type Permission,
  type RoleId,
  refusal,
  type Scope,
  sentence,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail } from "./clients/index.js";
import { accessAsks, clientMembers, grants, issues, operators } from "./clients/schema.js";
import { grantsFor, rolesIn } from "./grants.js";
import { actor, date, defineRecord, number, type RecordType, status, text } from "./records.js";

export const ROLE = "access.role";
export const GRANT = "access.grant";
export const ISSUE = "access.issue";
export const ASK = "access.ask";
export const REVIEW = "access.review";
export const ACCESS_TYPES = [ROLE, GRANT, ISSUE, ASK, REVIEW] as const;

/** Where access is managed: Team at Wren, Account at a client. */
export const accessApp = (client: string) => (client === WREN ? "team" : "account");

const yes = {
  yes: { label: "Yours", tone: "good" as const },
  no: { label: "Not yours", tone: "neutral" as const },
};
const day = 864e5;

const scopeOf = (r: {
  client: string;
  apps: string[] | null;
  channels: string[] | null;
  record: string | null;
}): Scope => ({
  client: r.client,
  ...(r.apps ? { apps: r.apps } : {}),
  ...(r.channels ? { channels: r.channels } : {}),
  ...(r.record ? { record: r.record } : {}),
});

/** Everyone who signs in there with that role: a team seat at Wren, a membership at a client. */
async function holders(db: Queryable, client: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ role: string; n: number }>(
    client === WREN
      ? sql`select role, count(*)::int n from operators group by role`
      : sql`select role, count(*)::int n from client_members where client_id = ${client} group by role`,
  );
  return new Map(rows.map((r) => [r.role, Number(r.n)]));
}

export interface AccessReader {
  who: Who;
  email: string;
  client: string;
  /** The reader's time zone, for "until Fri, 5 PM". */
  zone?: string;
}

/** Strongest first: what a review line says a person can do. */
const REVIEW_VERBS: [Permission, string][] = [
  ["run", "run"],
  ["act", "act on"],
  ["comment", "raise issues on"],
  ["read", "see"],
];
/** Every place a record can sit in one app: no channel, then each channel. */
const SPOTS: (string | null)[] = [null, ...ACCESS_CHANNELS];
const and = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** One app, for one person: "Act on YouTube; raise issues on and see everything", or "". */
export function reachIn(who: Who, client: string, app: string): string {
  const by = new Map<string, string[]>();
  for (const [verb, words] of REVIEW_VERBS) {
    const on = SPOTS.filter((channel) => can(who, verb, { client, app, channel }));
    if (!on.length) continue;
    const named = on.filter((c): c is string => c !== null);
    const where =
      on.length === SPOTS.length
        ? "everything"
        : named.length
          ? and(named.map((c) => CHANNEL_NAMES[c as keyof typeof CHANNEL_NAMES] ?? c))
          : "what has no channel";
    by.set(where, [...(by.get(where) ?? []), words]);
  }
  const s = [...by].map(([where, words]) => `${and(words)} ${where}`).join("; ");
  return s ? s[0]?.toUpperCase() + s.slice(1) : "";
}

/** Each app's line, apps that read the same grouped; the biggest group is "every other app". */
export function reachLines(who: Who, client: string): string[] {
  const groups = new Map<string, string[]>();
  for (const [app, name] of Object.entries(APPS)) {
    const line = reachIn(who, client, app);
    groups.set(line, [...(groups.get(line) ?? []), name]);
  }
  const all = [...groups].sort((a, b) => b[1].length - a[1].length);
  const [rest, ...named] = all;
  const lines = named.filter(([line]) => line).map(([line, apps]) => `${and(apps)}: ${line}`);
  if (rest?.[0]) lines.push(`${named.length ? "Every other app" : "Every app"}: ${rest[0]}`);
  return lines.length ? lines : ["Nothing"];
}

/** Everyone who signs in to the workspace, with their role and where it sits. */
async function people(db: Queryable, client: string) {
  if (client === WREN)
    return (
      await db
        .select({ email: operators.email, role: operators.role, clients: operators.clients })
        .from(operators)
    ).map((r) => ({ ...r, role: r.role as RoleId }));
  return (
    await db
      .select({ email: clientMembers.email, role: clientMembers.role })
      .from(clientMembers)
      .where(eq(clientMembers.clientId, client))
  ).map((r) => ({ email: r.email, role: r.role as RoleId, clients: null }));
}

/** Who can do what, per app and channel, and which grants end this week: one row a person. */
function reviewType(o: AccessReader): RecordType {
  return defineRecord({
    id: REVIEW,
    app: accessApp(o.client),
    channel: null,
    name: { one: "person", many: "people" },
    rows: async (db) => {
      const now = new Date();
      const [all, roles] = await Promise.all([people(db, o.client), rolesIn(db, o.client)]);
      const names = new Map(roles.map((r) => [r.id, r.name]));
      const out = [];
      for (const p of all.sort((a, b) => a.email.localeCompare(b.email))) {
        const atWren = o.client === WREN;
        const held = await grantsFor(db, p.email, p.role, atWren ? undefined : o.client);
        const who: Who = atWren
          ? { team: p.role, clients: p.clients, grants: held }
          : { member: p.role, client: o.client, grants: held };
        const extras = held.filter((g) => g.id != null);
        const ending = extras.filter(
          (g) => g.until && new Date(g.until).getTime() - now.getTime() < 7 * day,
        );
        out.push({
          id: p.email,
          email: p.email,
          role: names.get(p.role) ?? p.role,
          can: reachLines(who, o.client).join("\n"),
          extras: extras.length,
          ending: ending.map((g) => sentence(g, now, o.zone)).join("\n"),
          soon: ending.length ? "yes" : "no",
        });
      }
      return out;
    },
    key: "id",
    title: "email",
    subtitle: "role",
    fields: {
      email: text("Person"),
      role: text("Role"),
      can: text("Can"),
      extras: number("Extra grants"),
      ending: text("Ends this week"),
      soon: status(
        { yes: { label: "Ends this week", tone: "warn" }, no: { label: "No", tone: "neutral" } },
        "Grant ending",
      ),
    },
    views: [
      { id: "all", label: "Everyone" },
      { id: "ending", label: "Ending this week", where: { soon: "yes" } },
    ],
  });
}

/** Roles and grants, for whoever manages the workspace. */
function managed(o: AccessReader): RecordType[] {
  const app = accessApp(o.client);
  const role = defineRecord({
    id: ROLE,
    app,
    channel: null,
    name: { one: "role", many: "roles" },
    rows: async (db) => {
      const [all, held] = await Promise.all([rolesIn(db, o.client), holders(db, o.client)]);
      return all.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.builtIn ? "builtIn" : "custom",
        grants: r.grants.map((g) => sentence(g, new Date(), o.zone)).join("\n"),
        about: r.about ?? "",
        held: held.get(r.id) ?? 0,
      }));
    },
    key: "id",
    title: "name",
    subtitle: "about",
    fields: {
      name: text("Name"),
      kind: status(
        {
          builtIn: { label: "Built-in", tone: "neutral" },
          custom: { label: "Custom", tone: "good" },
        },
        "Kind",
      ),
      grants: text("Can"),
      about: text("About"),
      held: number("People"),
    },
    views: [{ id: "all", label: "All" }],
    actions: [
      "access.roleNew",
      "access.roleCopy",
      "access.roleGrant",
      "access.roleGive",
      "access.roleRemove",
    ],
  });
  const grant = defineRecord({
    id: GRANT,
    app,
    channel: null,
    name: { one: "grant", many: "grants" },
    rows: async (db) => {
      const now = new Date();
      const rows = await db
        .select()
        .from(grants)
        .where(eq(grants.client, o.client))
        .orderBy(desc(grants.at))
        .limit(2000);
      return rows.map((r) => {
        const g: Grant = {
          verbs: r.verbs,
          scope: scopeOf(r),
          until: r.until?.toISOString() ?? null,
          usesLeft: r.usesLeft,
        };
        const on = live(g, now);
        const ends = r.until ? r.until.getTime() - now.getTime() : null;
        return {
          id: r.id,
          email: r.email,
          what: sentence(g, now, o.zone),
          state: on ? "live" : r.usesLeft === 0 ? "used" : "ended",
          soon: on && ends !== null && ends < 7 * day ? "yes" : "no",
          until: r.until?.toISOString() ?? null,
          uses: r.usesLeft,
          reason: r.reason ?? "",
          by: r.by,
          at: r.at.toISOString(),
        };
      });
    },
    key: "id",
    title: "what",
    subtitle: "email",
    fields: {
      email: text("Person"),
      what: text("Can"),
      state: status(
        {
          live: { label: "Live", tone: "good" },
          ended: { label: "Ended", tone: "neutral" },
          used: { label: "Used up", tone: "neutral" },
        },
        "State",
      ),
      soon: status(
        { yes: { label: "Ends this week", tone: "warn" }, no: { label: "No", tone: "neutral" } },
        "Ends this week",
      ),
      until: date("Until"),
      uses: number("Uses left"),
      reason: text("Why"),
      by: actor("Given by"),
      at: date("Given"),
    },
    views: [
      { id: "live", label: "Live", where: { state: "live" }, sort: "-at", at: "at" },
      {
        id: "ending",
        label: "Ending this week",
        where: { soon: "yes" },
        sort: "until",
        at: "until",
      },
      { id: "all", label: "History", sort: "-at", at: "at" },
    ],
    actions: ["access.grantAdd", "access.grantEnd"],
  });
  return [role, grant, reviewType(o)];
}

/** Issues the reader can see, marked "yours" where they can act on the record. */
function issueType(o: AccessReader): RecordType {
  return defineRecord({
    id: ISSUE,
    app: accessApp(o.client),
    channel: null,
    name: { one: "issue", many: "issues" },
    rows: async (db) => {
      const rows = await db
        .select()
        .from(issues)
        .where(eq(issues.client, o.client))
        .orderBy(desc(issues.at))
        .limit(2000);
      return rows.flatMap((r) => {
        const at = { client: r.client, app: r.app, channel: r.channel, record: r.record };
        if (!can(o.who, "read", at) && !can(o.who, "comment", at)) return [];
        return [
          {
            id: r.id,
            title: r.title ?? r.record,
            body: r.body,
            record: r.record,
            app: APPS[r.app] ?? r.app,
            channel: r.channel ?? "",
            state: r.resolvedAt ? "resolved" : "open",
            yours: can(o.who, "act", at) ? "yes" : "no",
            by: r.by,
            at: r.at.toISOString(),
            resolvedBy: r.resolvedBy,
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
          },
        ];
      });
    },
    key: "id",
    title: "body",
    subtitle: "title",
    fields: {
      body: text("Issue"),
      title: text("On"),
      record: text("Record"),
      app: text("App"),
      channel: text("Channel"),
      state: status(
        {
          open: { label: "Open", tone: "warn" },
          resolved: { label: "Resolved", tone: "good" },
        },
        "State",
      ),
      yours: status(yes, "Yours to fix"),
      by: actor("Raised by"),
      at: date("Raised"),
      resolvedBy: actor("Resolved by"),
      resolvedAt: date("Resolved"),
    },
    views: [
      {
        id: "waiting",
        label: "Waiting on you",
        where: { state: "open", yours: "yes" },
        sort: "-at",
        at: "at",
      },
      { id: "open", label: "Open", where: { state: "open" }, sort: "-at", at: "at" },
      { id: "all", label: "All", sort: "-at", at: "at" },
    ],
    actions: ["access.issueResolve"],
  });
}

/** Asks: the reader's own, and the ones they could hand out. */
function askType(o: AccessReader): RecordType {
  const me = normalEmail(o.email);
  return defineRecord({
    id: ASK,
    app: accessApp(o.client),
    channel: null,
    name: { one: "ask", many: "asks" },
    rows: async (db) => {
      const now = new Date();
      const rows = await db
        .select()
        .from(accessAsks)
        .where(eq(accessAsks.client, o.client))
        .orderBy(desc(accessAsks.at))
        .limit(2000);
      return rows.flatMap((r) => {
        const g: Grant = {
          verbs: r.verbs,
          scope: scopeOf(r),
          until: r.until?.toISOString() ?? null,
        };
        const decides = r.email !== me && refusal(o.who, g, now) === null;
        if (r.email !== me && !decides) return [];
        return [
          {
            id: r.id,
            email: r.email,
            what: sentence(g, now, o.zone),
            reason: r.reason ?? "",
            state: r.decidedAt ? (r.approved ? "approved" : "declined") : "open",
            yours: decides ? "yes" : "no",
            mine: r.email === me ? "yes" : "no",
            at: r.at.toISOString(),
            decidedBy: r.decidedBy,
            decidedAt: r.decidedAt?.toISOString() ?? null,
          },
        ];
      });
    },
    key: "id",
    title: "what",
    subtitle: "email",
    fields: {
      email: text("Person"),
      what: text("Asks to"),
      reason: text("Why"),
      state: status(
        {
          open: { label: "Waiting", tone: "warn" },
          approved: { label: "Approved", tone: "good" },
          declined: { label: "Declined", tone: "neutral" },
        },
        "State",
      ),
      yours: status(yes, "Yours to decide"),
      mine: status(
        { yes: { label: "Mine", tone: "neutral" }, no: { label: "Theirs", tone: "neutral" } },
        "Whose",
      ),
      at: date("Asked"),
      decidedBy: actor("Decided by"),
      decidedAt: date("Decided"),
    },
    views: [
      {
        id: "waiting",
        label: "Waiting on you",
        where: { state: "open", yours: "yes" },
        sort: "-at",
        at: "at",
      },
      { id: "mine", label: "Mine", where: { mine: "yes" }, sort: "-at", at: "at" },
      { id: "all", label: "All", sort: "-at", at: "at" },
    ],
    actions: ["access.askApprove", "access.askDecline"],
  });
}

/**
 * The access types this reader gets in this workspace: issues and asks for anyone signed in;
 * roles and grants for whoever manages it.
 */
export function accessRecords(o: AccessReader): RecordType[] {
  if (!o.who || "demo" in o.who) return [];
  const manages = can(o.who, "manage", { client: o.client });
  return [...(manages ? managed(o) : []), issueType(o), askType(o)];
}

/** Every access type, for the inventory: the shapes don't depend on the reader. */
export const ACCESS_SHAPES: readonly RecordType[] = [
  ...managed({ who: null, email: "", client: WREN }),
  issueType({ who: null, email: "", client: WREN }),
  askType({ who: null, email: "", client: WREN }),
];
