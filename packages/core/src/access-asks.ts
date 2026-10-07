/**
 * Ask for access (designs/2026-10-06-scoped-access.md): someone asks for verbs over a scope, for
 * a while, with a reason. The ask waits in the Inbox of whoever could hand it out; approving makes
 * the grant as theirs, declining closes it. Both are audited, like every table in main.
 */
import type { Queryable } from "@wren/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  ADMIN_ONLY_AT_WREN,
  can,
  type Grant,
  refusal,
  type Scope,
  sentence,
  targetsOf,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail } from "./clients/index.js";
import { type AccessAskRow, accessAsks } from "./clients/schema.js";
import { addGrant, grantInput } from "./grants.js";
import { PortalRefusal } from "./portal.js";

export interface AskView {
  id: number;
  email: string;
  client: string;
  /** What it would grant, as a sentence: "Can act on YouTube in Marketing until Fri, 5 PM." */
  what: string;
  grant: Grant;
  reason: string | null;
  at: string;
  state: "open" | "approved" | "declined";
  decidedBy: string | null;
  decidedAt: string | null;
  grantId: number | null;
}

const scopeOf = (r: Pick<AccessAskRow, "client" | "apps" | "channels" | "record">): Scope => ({
  client: r.client,
  ...(r.apps ? { apps: r.apps } : {}),
  ...(r.channels ? { channels: r.channels } : {}),
  ...(r.record ? { record: r.record } : {}),
});

const grantOf = (r: AccessAskRow): Grant => ({
  verbs: r.verbs,
  scope: scopeOf(r),
  until: r.until?.toISOString() ?? null,
  reason: r.reason,
});

export const viewOf = (r: AccessAskRow, now = new Date(), zone?: string): AskView => ({
  id: r.id,
  email: r.email,
  client: r.client,
  what: sentence(grantOf(r), now, zone),
  grant: grantOf(r),
  reason: r.reason,
  at: r.at.toISOString(),
  state: r.decidedAt ? (r.approved ? "approved" : "declined") : "open",
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  grantId: r.grantId,
});

/**
 * Ask as `by` (fresh access `who`) at `client`. Refused when it asks for nothing new, or for what
 * nobody may hand out (money and sends on Wren's apps). At most 10 open asks a person.
 */
export async function askAccess(
  tx: Queryable,
  who: Who,
  by: string,
  client: string,
  input: Record<string, unknown>,
): Promise<{ id: number }> {
  if (!who || "demo" in who) throw new PortalRefusal("sign in to ask", 403);
  const email = normalEmail(by);
  const g = grantInput({ ...input, uses: undefined }, client, email);
  if (!g.verbs.length) throw new PortalRefusal("say what you need to do", 400);
  if (client === WREN && g.verbs.some((v) => ADMIN_ONLY_AT_WREN.includes(v)))
    throw new PortalRefusal("money and sends on Wren's apps stay with admins", 400);
  if (!g.reason) throw new PortalRefusal("say why", 400);
  const scope: Scope = {
    client,
    ...(g.apps ? { apps: g.apps } : {}),
    ...(g.channels ? { channels: g.channels } : {}),
    ...(g.record ? { record: g.record } : {}),
  };
  if (targetsOf(scope).every((t) => g.verbs.every((v) => can(who, v, t))))
    throw new PortalRefusal("you can already do that", 409);
  const open = await tx
    .select({ id: accessAsks.id })
    .from(accessAsks)
    .where(and(eq(accessAsks.email, email), isNull(accessAsks.decidedAt)))
    .limit(10);
  if (open.length >= 10) throw new PortalRefusal("you have 10 asks waiting already", 409);
  const [row] = await tx
    .insert(accessAsks)
    .values({
      email,
      client,
      verbs: [...g.verbs],
      apps: g.apps ? [...g.apps] : null,
      channels: g.channels ? [...g.channels] : null,
      record: g.record ?? null,
      until: g.until ? new Date(g.until) : null,
      reason: g.reason,
    })
    .returning({ id: accessAsks.id });
  if (!row) throw new Error("ask insert returned nothing");
  return row;
}

/** Open asks at `client` that `who` could hand out, not their own: their Inbox's share. */
export async function asksFor(
  db: Queryable,
  who: Who,
  email: string,
  client: string,
  now = new Date(),
): Promise<AskView[]> {
  const me = normalEmail(email);
  const rows = await db
    .select()
    .from(accessAsks)
    .where(and(eq(accessAsks.client, client), isNull(accessAsks.decidedAt)))
    .orderBy(desc(accessAsks.at))
    .limit(500);
  return rows
    .filter((r) => r.email !== me && refusal(who, grantOf(r), now) === null)
    .map((r) => viewOf(r, now));
}

/** One person's asks at `client`, newest first, decided ones too. */
export async function asksBy(db: Queryable, email: string, client: string): Promise<AskView[]> {
  const rows = await db
    .select()
    .from(accessAsks)
    .where(and(eq(accessAsks.client, client), eq(accessAsks.email, normalEmail(email))))
    .orderBy(desc(accessAsks.at))
    .limit(50);
  return rows.map((r) => viewOf(r));
}

/**
 * Approve or decline an ask as `by` (fresh access `who`), who must be able to hand it out.
 * Approving makes the grant with the ask's end time; an ask whose end has passed can only be
 * declined. Deciding twice is refused.
 */
export async function decideAsk(
  tx: Queryable,
  who: Who,
  by: string,
  client: string,
  id: number,
  approve: boolean,
): Promise<{ decided: number; grant: number | null }> {
  const [r] = await tx
    .select()
    .from(accessAsks)
    .where(and(eq(accessAsks.id, id), eq(accessAsks.client, client)));
  if (!r) throw new PortalRefusal("no such ask", 404);
  if (r.decidedAt) throw new PortalRefusal("already decided", 409);
  if (normalEmail(by) === r.email) throw new PortalRefusal("someone else decides your ask", 403);
  const no = refusal(who, grantOf(r));
  if (no) throw new PortalRefusal(no, 403);
  let grant: number | null = null;
  if (approve) {
    if (r.until && r.until.getTime() <= Date.now())
      throw new PortalRefusal("the time it asked for has passed", 409);
    ({ id: grant } = await addGrant(tx, who, by, {
      email: r.email,
      client: r.client,
      verbs: r.verbs,
      apps: r.apps,
      channels: r.channels,
      record: r.record,
      until: r.until?.toISOString() ?? null,
      reason: r.reason ? `asked: ${r.reason}` : "asked",
    }));
  }
  await tx
    .update(accessAsks)
    .set({ decidedBy: normalEmail(by), decidedAt: new Date(), approved: approve, grantId: grant })
    .where(eq(accessAsks.id, id));
  return { decided: id, grant };
}
