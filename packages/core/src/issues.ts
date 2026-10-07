/**
 * Issues on records (designs/2026-10-06-scoped-access.md, "Raise an issue"): someone with
 * `comment` on a row leaves a short note; it waits in the Inbox of whoever has `act` there, who
 * resolves it. Every write is audited as the person's, like any other table in main.
 */
import type { Queryable } from "@wren/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { can, type Target, type Who } from "./access.js";
import { normalEmail } from "./clients/index.js";
import { type IssueRow, issues } from "./clients/schema.js";
import { PortalRefusal } from "./portal.js";

/** Where an issue sits: the record and its app and channel, at one client (or `wren`). */
export interface IssueAt {
  client: string;
  record: string;
  app: string;
  channel: string | null;
  /** The record's title when raised, so the Inbox reads without opening it. */
  title?: string | null;
}

export interface IssueView {
  id: number;
  record: string;
  title: string | null;
  app: string;
  channel: string | null;
  body: string;
  by: string;
  at: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

const viewOf = (r: IssueRow): IssueView => ({
  id: r.id,
  record: r.record,
  title: r.title,
  app: r.app,
  channel: r.channel,
  body: r.body,
  by: r.by,
  at: r.at.toISOString(),
  resolvedBy: r.resolvedBy,
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
});

const targetOf = (i: Pick<IssueAt, "client" | "app" | "channel" | "record">): Target => ({
  client: i.client,
  app: i.app,
  channel: i.channel,
  record: i.record,
});

/** The note: one to 1000 characters, trimmed. */
export function issueBody(v: unknown): string {
  const body = typeof v === "string" ? v.trim() : "";
  if (!body) throw new PortalRefusal("say what's wrong", 400);
  if (body.length > 1000) throw new PortalRefusal("keep it under 1000 characters", 400);
  return body;
}

/** Raise one as `by`, whose fresh access is `who`: needs `comment` on that record. */
export async function raiseIssue(
  tx: Queryable,
  who: Who,
  by: string,
  at: IssueAt,
  body: unknown,
): Promise<{ id: number }> {
  if (!can(who, "comment", targetOf(at)))
    throw new PortalRefusal("raising issues here needs comment", 403);
  const text = issueBody(body);
  const [row] = await tx
    .insert(issues)
    .values({
      client: at.client,
      record: at.record,
      title: at.title?.slice(0, 200) ?? null,
      app: at.app,
      channel: at.channel,
      body: text,
      by: normalEmail(by),
    })
    .returning({ id: issues.id });
  if (!row) throw new Error("issue insert returned nothing");
  return row;
}

/** Resolve one: needs `act` where it sits. Resolving twice is refused, so the log reads once. */
export async function resolveIssue(
  tx: Queryable,
  who: Who,
  by: string,
  client: string,
  id: number,
): Promise<{ resolved: number }> {
  const [r] = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), eq(issues.client, client)));
  if (!r) throw new PortalRefusal("no such issue", 404);
  if (!can(who, "act", targetOf(r))) throw new PortalRefusal("resolving this needs act", 403);
  if (r.resolvedAt) throw new PortalRefusal("already resolved", 409);
  await tx
    .update(issues)
    .set({ resolvedBy: normalEmail(by), resolvedAt: new Date() })
    .where(eq(issues.id, id));
  return { resolved: id };
}

/** A record's issues, newest first: what its panel shows beside History. */
export async function issuesOn(
  db: Queryable,
  client: string,
  record: string,
): Promise<IssueView[]> {
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.client, client), eq(issues.record, record)))
    .orderBy(desc(issues.at))
    .limit(50);
  return rows.map(viewOf);
}

/** Open issues at a client that `who` can act on: their Inbox's share. */
export async function openIssuesFor(db: Queryable, who: Who, client: string): Promise<IssueView[]> {
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.client, client), isNull(issues.resolvedAt)))
    .orderBy(desc(issues.at))
    .limit(500);
  return rows.filter((r) => can(who, "act", targetOf(r))).map(viewOf);
}
