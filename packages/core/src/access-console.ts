/**
 * The console's access handlers (designs/2026-10-06-scoped-access.md, phase 3): roles, grants,
 * issues and asks, for Wren's team (`wren`) or a client's people, wherever they look. Each reads
 * the person fresh and writes in one transaction audited as theirs. The routes need only `read`;
 * what each may do is checked here, on what it names.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type Db, type Queryable, serializable, setAuditActor } from "@wren/db";
import {
  can,
  isChannel,
  MEMBER_GRANTS,
  type Permission,
  type Target,
  TEAM_GRANTS,
  type Who,
  WREN,
} from "./access.js";
import { askAccess, decideAsk } from "./access-asks.js";
import { normalEmail } from "./clients/index.js";
import { addGrant, endGrant, grantInput, removeRole, rolesIn, saveRole } from "./grants.js";
import { type IssueView, issuesOn, raiseIssue, resolveIssue } from "./issues.js";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  type SignedViewer,
  seesInternal,
  whoIs,
} from "./portal.js";
import { DECLARED, type RecordType } from "./records.js";

type Input = PortalRequest & Record<string, unknown>;

export interface AccessDeps {
  main: Db;
  /** The types this request reads, for a record named by an issue. */
  typesFor(req: PortalRequest): Promise<RecordType[]>;
  /** Where one of Wren's rows is (its channel read off the row). */
  rowAt(t: RecordType, id: string): Promise<Target | null>;
}

/** Where the request looks and who asks: Wren's apps for the team, else the client picked. */
export async function placeOf(
  main: Db,
  req: PortalRequest,
): Promise<{ client: string; by: string; who: Who }> {
  if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
  const atWren = seesInternal(req) && (!req.client || req.client === WREN);
  const client = atWren ? WREN : (await pickClient(main, req)).id;
  const by = normalEmail((req.viewer as SignedViewer).email);
  return { client, by, who: await whoIs(main, req.viewer, atWren ? undefined : client) };
}

const str = (v: unknown, what: string, max = 200): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new PortalRefusal(`say which ${what}`, 400);
  return v.trim();
};
const idOf = (v: unknown, what: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1)
    throw new PortalRefusal(`say which ${what}`, 400);
  return n;
};
const manages = (who: Who, client: string) => {
  if (!can(who, "manage", { client })) throw new PortalRefusal("you don't manage access here", 403);
};

/** A role's grants as a role input takes them; a built-in's is its side's verbs, unscoped. */
const partsOf = async (db: Queryable, client: string, id: string) => {
  const r = (await rolesIn(db, client)).find((x) => x.id === id);
  if (!r) throw new PortalRefusal("no such role here", 404);
  const side: Record<string, readonly Permission[] | undefined> =
    client === WREN ? TEAM_GRANTS : MEMBER_GRANTS;
  return {
    role: r,
    grants: r.builtIn
      ? [{ verbs: side[r.id] ?? [] }]
      : r.grants.map((g) => ({
          verbs: g.verbs,
          apps: g.scope.apps ?? null,
          channels: g.scope.channels ?? null,
        })),
  };
};

export function accessApi({ main, typesFor, rowAt }: AccessDeps) {
  /** One change, as `by`, in one serializable transaction. */
  const change = async <T>(
    req: PortalRequest,
    fn: (tx: Queryable, at: { client: string; by: string; who: Who }) => Promise<T>,
  ): Promise<T> => {
    const at = await placeOf(main, req);
    return serializable(main, async (tx) => {
      await setAuditActor(tx, at.by);
      return fn(tx, at);
    });
  };

  /** The record an issue is about: its app, and its channel off the row when it keeps one. */
  const issueAt = async (req: Input, client: string) => {
    const record = str(req.record, "list", 64);
    const id = String(typeof req.id === "number" ? req.id : str(req.id, "record"));
    const t = client === WREN ? (await typesFor(req)).find((x) => x.id === record) : undefined;
    // At Wren the type must be one this login reads; a client's types live in their products.
    const d = client === WREN ? t : DECLARED.get(record);
    if (!d) throw new PortalRefusal("no such list", 404);
    let channel: string | null;
    if (d.channel === null || typeof d.channel === "string") channel = d.channel;
    else if (t) {
      const at = await rowAt(t, id);
      if (!at) throw new PortalRefusal(`no such ${t.name.one}`, 404);
      channel = at.channel ?? null;
    } else channel = isChannel(req.channel) ? req.channel : null;
    const title = typeof req.title === "string" ? req.title.slice(0, 200) : null;
    return { client, record: `${record}:${id}`, app: d.app, channel, title };
  };

  return {
    /** A new custom role with one grant; more are added with `roleGrant`. */
    roleSave: (req: Input) =>
      change(req, async (tx, { client, by, who }) => {
        manages(who, client);
        const g = grantInput(req, client, by);
        return saveRole(tx, who, by, {
          client,
          name: str(req.name, "name", 60),
          about: typeof req.about === "string" ? req.about : null,
          grants: [{ verbs: g.verbs, apps: g.apps ?? null, channels: g.channels ?? null }],
        });
      }),
    /** A new custom role holding what another holds: how a role starts from a built-in. */
    roleCopy: (req: Input) =>
      change(req, async (tx, { client, by, who }) => {
        manages(who, client);
        const { role, grants } = await partsOf(tx, client, str(req.id, "role", 64));
        const name =
          typeof req.name === "string" && req.name.trim() ? req.name : `${role.name} copy`;
        return saveRole(tx, who, by, { client, name, about: role.about, grants });
      }),
    /** One more grant on a custom role. */
    roleGrant: (req: Input) =>
      change(req, async (tx, { client, by, who }) => {
        manages(who, client);
        const { role, grants } = await partsOf(tx, client, str(req.id, "role", 64));
        if (role.builtIn) throw new PortalRefusal("built-in roles don't change; copy one", 400);
        const g = grantInput(req, client, by);
        return saveRole(tx, who, by, {
          id: role.id,
          client,
          name: role.name,
          about: role.about,
          grants: [
            ...grants,
            { verbs: g.verbs, apps: g.apps ?? null, channels: g.channels ?? null },
          ],
        });
      }),
    roleRemove: (req: Input) =>
      change(req, async (tx, { client, who }) => {
        manages(who, client);
        return removeRole(tx, client, str(req.id, "role", 64));
      }),
    /** An extra grant to one person: refused past what the granter holds. */
    grantAdd: (req: Input) =>
      change(req, async (tx, { client, by, who }) =>
        addGrant(tx, who, by, grantInput(req, client, str(req.email, "person", 254))),
      ),
    grantEnd: (req: Input) =>
      change(req, (tx, { by, who }) => endGrant(tx, who, by, idOf(req.id, "grant"))),
    /** A record's issues, for its panel: anyone who can read or comment there. */
    issues: async (req: Input): Promise<IssueView[]> => {
      const { client, who } = await placeOf(main, req);
      const at = await issueAt(req, client);
      if (!can(who, "read", at) && !can(who, "comment", at))
        throw new PortalRefusal(`no such ${at.record.split(":")[0]}`, 404);
      return issuesOn(main, client, at.record);
    },
    issueRaise: (req: Input) =>
      change(req, async (tx, { client, by, who }) =>
        raiseIssue(tx, who, by, await issueAt(req, client), req.body),
      ),
    issueResolve: (req: Input) =>
      change(req, (tx, { client, by, who }) =>
        resolveIssue(tx, who, by, client, idOf(req.id, "issue")),
      ),
    accessAsk: (req: Input) =>
      change(req, (tx, { client, by, who }) => askAccess(tx, who, by, client, req)),
    askDecide: (req: Input) =>
      change(req, (tx, { client, by, who }) => {
        if (typeof req.approve !== "boolean") throw new PortalRefusal("approve or decline", 400);
        return decideAsk(tx, who, by, client, idOf(req.id, "ask"), req.approve);
      }),
  };
}

export type AccessApi = ReturnType<typeof accessApi>;

/** The Restate handlers: each write is one journaled step, so a retry finds it done. */
export function accessHandlers(api: AccessApi) {
  const write = (name: keyof AccessApi, label: string) => (ctx: restate.Context, req: Input) =>
    answer(() => ctx.run(label, () => answer(() => api[name](req) as Promise<unknown>)));
  return {
    issues: (_: restate.Context, req: Input) => answer(() => api.issues(req)),
    roleSave: write("roleSave", "save role"),
    roleCopy: write("roleCopy", "copy role"),
    roleGrant: write("roleGrant", "add to role"),
    roleRemove: write("roleRemove", "remove role"),
    grantAdd: write("grantAdd", "add grant"),
    grantEnd: write("grantEnd", "end grant"),
    issueRaise: write("issueRaise", "raise issue"),
    issueResolve: write("issueResolve", "resolve issue"),
    accessAsk: write("accessAsk", "ask access"),
    askDecide: write("askDecide", "decide ask"),
  };
}
