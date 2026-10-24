/**
 * A client's rows and the checks before anything changes them: the refusals (400, 404, 409), day
 * arithmetic, text and link hygiene, and finding the engagement or milestone a write names. Every
 * write names the client, and a row of another client's is "not found", so one client can never
 * reach another's by id.
 */
import { PortalRefusal } from "@wren/core/refusal";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  type DeliverableKind,
  type Engagement,
  type EngagementStatus,
  engagements,
  type Milestone,
  milestones,
  updates,
} from "./schema.js";

/** Bad input (400), nothing of this client's by that id (404), or a clash with what's there (409). */
export class DeliveryRefusal extends PortalRefusal {}

export const bad = (message: string) => new DeliveryRefusal(message, 400);

export const missing = (what: string) => new DeliveryRefusal(`no such ${what}`, 404);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day, `YYYY-MM-DD`. */
export function dayOf(v: string, what = "date"): string {
  const d = new Date(`${v}T00:00:00Z`);
  if (!DAY.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw bad(`${what} must be a day like 2026-10-01`);
  return v;
}

export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** 0 = Sunday. */
export const weekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/** The Monday of `day`'s week: a pulse's week. */
export const mondayOf = (day: string): string => addDays(day, -((weekday(day) + 6) % 7));

export function textIn(v: string, what: string, max: number): string {
  const t = v.trim();
  if (!t) throw bad(`${what} is empty`);
  if (t.length > max) throw bad(`${what} is over ${max} characters`);
  return t;
}

/** Only https: a stored link becomes an href, and `javascript:` there runs. */
export function linkOf(v: string, kind: DeliverableKind): string {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw bad("that link isn't a web address");
  }
  if (u.protocol !== "https:") throw bad("links must start with https://");
  if (kind === "loom" && !/(^|\.)loom\.com$/.test(u.hostname)) throw bad("that isn't a Loom link");
  return u.toString();
}

/** Files live under the client's own folder in the private bucket (D11). */
export function fileKeyOf(clientId: string, v: string): string {
  const key = v.trim();
  if (!key.startsWith(`clients/${clientId}/`) || key.split("/").includes(".."))
    throw bad("that file isn't in this client's folder");
  return key;
}

/** Statuses where the work is under way: one per offer per client. */
export const RUNNING: EngagementStatus[] = ["onboarding", "active"];

/** The client's engagement: by id, or the one running (onboarding or active) when there's one. */
export async function engagementOf(
  db: Queryable,
  clientId: string,
  id?: number,
): Promise<Engagement> {
  if (id !== undefined) {
    const [e] = await db
      .select()
      .from(engagements)
      .where(and(eq(engagements.id, id), eq(engagements.clientId, clientId)));
    if (!e) throw missing("engagement");
    return e;
  }
  const active = await db
    .select()
    .from(engagements)
    .where(and(eq(engagements.clientId, clientId), inArray(engagements.status, RUNNING)));
  if (active.length === 0) throw missing("running engagement");
  if (active.length > 1) throw bad("this client has more than one engagement running: pick one");
  return active[0] as Engagement;
}

export async function milestoneOf(db: Queryable, e: Engagement, key: string): Promise<Milestone> {
  const [m] = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.engagementId, e.id), eq(milestones.key, key)));
  if (!m) throw missing(`step '${key}' in this plan`);
  return m;
}

export const milestoneIdOf = async (db: Queryable, e: Engagement, key?: string) =>
  key === undefined ? null : (await milestoneOf(db, e, key)).id;

/** Rows of this client's engagements only: a row of another client's is "not found". */
export const ofClient = (db: Queryable, engagementId: AnyPgColumn, clientId: string) =>
  inArray(
    engagementId,
    db.select({ id: engagements.id }).from(engagements).where(eq(engagements.clientId, clientId)),
  );

export const CURRENCY = /^[A-Z]{3}$/;

export const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * What a viewer may see of the timeline: the one place internal and hidden
 * updates are kept from a client (D12). Every read of `updates` goes through it.
 */
export const seenBy = (operator: boolean): SQL | undefined =>
  operator ? undefined : and(eq(updates.internal, false), isNull(updates.hiddenAt));
