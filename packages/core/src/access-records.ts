/**
 * Access as records (designs/2026-10-06-scoped-access.md, "Pages"): roles, grants, issues and
 * asks for one workspace (a client, or `wren` for Wren's team), read by one login. Built per
 * request, since what a row says ("yours to decide") depends on who reads it. The console
 * serves them; the portal draws them with the List template like any other type.
 */
import type { Queryable } from "@wren/db";
import { desc, eq, sql } from "drizzle-orm";
import {
  APPS,
  can,
  type Grant,
  live,
  refusal,
  type Scope,
  sentence,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail } from "./clients/index.js";
import { accessAsks, grants, issues } from "./clients/schema.js";
import { rolesIn } from "./grants.js";
import { actor, date, defineRecord, number, type RecordType, status, text } from "./records.js";

export const ROLE = "access.role";
export const GRANT = "access.grant";
export const ISSUE = "access.issue";
export const ASK = "access.ask";
export const ACCESS_TYPES = [ROLE, GRANT, ISSUE, ASK] as const;

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
  return [role, grant];
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
