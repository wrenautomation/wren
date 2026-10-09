/** What a read of one app hands the sync, whichever app (designs/2026-10-09-connectors.md). */

import type { FetchLike } from "@wren/core";
import type { AppChange } from "@wren/core/logic";
import type { LinkCursor, LinkExtra } from "../schema.js";

/** A person as the app keeps them, in the CRM import's words. */
export interface PulledPerson {
  /** The app's id: the CRM row's key. */
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** When the app keeps one name only. */
  fullName: string | null;
  email: string | null;
  phone: string | null;
  /** A household with none: its own name (the CRM wants a company). */
  company: string | null;
  website: string | null;
  title: string | null;
  status: string | null;
  /** ISO. */
  created: string | null;
  lastContacted: string | null;
}

/** Something that happened, told to the spine once (`key`). */
export interface PulledChange {
  key: string;
  change: AppChange;
  /** ISO: when it happened; nothing from before the link fires. */
  at: string;
  /** Whose: the app's person id, so the sync finds their email and phone. */
  person: string | null;
  /** What else rides along: an amount, a job's title. */
  data: Record<string, unknown>;
}

export interface Pulled {
  people: PulledPerson[];
  changes: PulledChange[];
  cursor: LinkCursor;
  /** Stopped at the run's cap: the next run carries on. */
  more: boolean;
}

export interface PullInput {
  fetch: FetchLike;
  token: string;
  extra: LinkExtra;
  cursor: LinkCursor;
  /** Most records a run reads, across what it reads. */
  cap: number;
}

export type Puller = (i: PullInput) => Promise<Pulled>;

/** Who the token is: the account's id and name, read once on connect. */
export type WhoAmI = (
  fetch: FetchLike,
  token: string,
  extra: LinkExtra,
) => Promise<{ id: string; name: string | null }>;

/** An app's answer that wasn't data: `auth` when the token was refused. */
export class PullError extends Error {
  constructor(
    message: string,
    readonly auth = false,
  ) {
    super(message);
    this.name = "PullError";
  }
}

/** A JSON answer, or why not. 401 and 403 are the token's fault. */
export async function jsonOf(res: Response, app: string): Promise<Record<string, unknown>> {
  if (res.status === 401 || res.status === 403)
    throw new PullError(`${app} refused the token (${res.status})`, true);
  if (!res.ok) throw new PullError(`${app} answered ${res.status}`);
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j) throw new PullError(`${app} answered no JSON`);
  return j;
}

/** The later of two ISO times; either may be missing. */
export const later = (a: string | undefined, b: string | null | undefined): string | undefined =>
  !b ? a : !a || Date.parse(b) > Date.parse(a) ? b : a;

export const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;

/** The first page size the apps take, and a run's default cap. */
export const PAGE = 100;
export const RUN_CAP = 2000;
